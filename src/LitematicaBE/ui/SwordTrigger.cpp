#include "LitematicaBE/ui/SwordTrigger.h"

#include "LitematicaBE/easyplace/EasyPlace.h"
#include "LitematicaBE/ui/Menu.h"
#include "LitematicaBE/ui/MenuState.h"

#include "ll/api/memory/Hook.h"
#include "ll/api/mod/NativeMod.h"
#include "ll/api/service/Bedrock.h"
#include "ll/api/thread/ServerThreadExecutor.h"

#include "mc/network/NetworkIdentifier.h"
#include "mc/network/ServerNetworkHandler.h"
#include "mc/network/packet/AnimatePacket.h"
#include "mc/network/packet/AnimatePacketPayload.h"
#include "mc/world/actor/Actor.h"
#include "mc/world/actor/player/Player.h"
#include "mc/world/item/ItemStackBase.h"
#include "mc/world/level/Level.h"

#include <atomic>
#include <chrono>
#include <cstdint>
#include <string>
#include <unordered_set>

namespace litematicabe::ui {

namespace {

// 唯一触发物（与 `selection/SwordTool` 的选点工具同一把木剑）。
constexpr char const* kSwordName = "minecraft:wooden_sword";

// 连续挥动的最小间隔。两条链路共用它去重。
constexpr std::int64_t kSummonCooldownMs = 400;

// 下线清理轮询间隔。
constexpr std::int64_t kPruneIntervalMs = 5000;

// 动作延迟（毫秒）。`$handle(AnimatePacket)` 在网络包处理栈上，
// 直接在里面发 ghost 包 / 弹表单等于在收包路径里再发包，重入风险不值得冒。
constexpr std::int64_t kDeferMs = 50;

bool gAnimatePath{};
bool gUseItemPath{};
bool gPolling{};

std::atomic<std::uint64_t> gAnimateSwings{0};
std::atomic<std::uint64_t> gSwordSwings{0};
std::atomic<bool>          gLoggedFirstTrigger{false};

bool holdingSword(::Player const& player) {
    auto const& item = player.getCarriedItem();
    if (item.isNull()) {
        return false;
    }
    return item.getTypeName() == kSwordName;
}

// **必须在主线程调用。**
//
// 两条链路最终都汇到这里：判定手持木剑 → 冷却 → 唤出面板。
// 所有 `MenuState` 访问都收敛在主线程，避免与表单回调（网络线程）并发改同一张表。
void onSwingMainThread(::Player& player) {
    if (!holdingSword(player)) {
        return;
    }

    auto const name  = player.getRealName();
    auto&      state = MenuState::getInstance().get(name);
    auto const now   = MenuState::nowMs();

    if (now - state.lastSummonMs < kSummonCooldownMs) {
        return;
    }
    state.lastSummonMs = now;
    ++gSwordSwings;

    // 第一次真正触发时留一条日志：这是判断「hook 到底通没通」最直接的证据。
    if (!gLoggedFirstTrigger.exchange(true)) {
        if (auto mod = ::ll::mod::NativeMod::current()) {
            mod->getLogger().info("wooden sword gesture fired (player {})", name);
        }
    }

    summon(player);
}

// ── 主链路：AnimatePacket(Swing) ──
//
// 客户端"挥一下"（左键：挥空气 / 挥方块 / 打实体）会发 `AnimatePacket`，
// 服务端在 `ServerNetworkHandler::$handle(AnimatePacket)` 里处理。
// 这是**唯一**能在服务端观测到左键的锚点：
//   * `Actor::swing` 是虚函数且 `MCFOLD`（COMDAT 折叠），地址不可信，hook 即崩（实测过）；
//   * `PlayerSwingEvent` 在 LL 1.9.9 服务端没有 emitter。
//
// `$handle` 有 75 个重载，必须显式转成确定类型再交给 hook 宏。
using HandleAnimateFn =
    void (::ServerNetworkHandler::*)(::NetworkIdentifier const&, ::AnimatePacket const&);

HandleAnimateFn const kHandleAnimate = static_cast<HandleAnimateFn>(&::ServerNetworkHandler::$handle);

LL_TYPE_INSTANCE_HOOK(
    AnimateSwingHook,
    ll::memory::HookPriority::Normal,
    ::ServerNetworkHandler,
    kHandleAnimate,
    void,
    ::NetworkIdentifier const& source,
    ::AnimatePacket const&     packet
) {
    origin(source, packet);

    // 只认 Swing：WakeUp / CriticalHit 之类与手势无关。
    if (static_cast<::AnimatePacketPayload::Action>(packet.mAction)
        != ::AnimatePacketPayload::Action::Swing) {
        return;
    }
    ++gAnimateSwings;

    // **本 hook 跑在网络线程**：这里只许读包字段（值拷贝），
    // 不碰世界、不碰玩家对象、不碰 MenuState —— 连 player->getRealName() 都不做。
    // 把 runtimeId 带到主线程再解析实体，是唯一安全的做法。
    auto const runtimeId = packet.mRuntimeId;

    ::ll::thread::ServerThreadExecutor::getDefault().executeAfter(
        [runtimeId] {
            auto level = ::ll::service::getLevel();
            if (!level) {
                return;
            }
            auto* actor = level->getRuntimeEntity(runtimeId, false);
            if (actor == nullptr || !actor->isPlayer()) {
                return;
            }
            onSwingMainThread(static_cast<::Player&>(*actor));
        },
        std::chrono::milliseconds(kDeferMs)
    );
}

ll::memory::HookRegistrar<AnimateSwingHook> gAnimateHook;

// ── 备用链路：Player::useItem 的只读观察者 ──
//
// `$handle(AnimatePacket)` 挂不上（LL 不回报失败）或客户端不发这个包时，
// 「手持木剑 + 右键空气」仍然能开面板。`Player::useItem` 已经被轻松放置占用，
// 所以走 easyplace 的注册点，不新增 hook。
// 这个观察者本来就在主线程，直接处理即可。
void onUseItem(::Player& player, ::ItemStackBase& item) {
    if (item.isNull() || item.getTypeName() != kSwordName) {
        return;
    }
    onSwingMainThread(player);
}

void schedulePrune(std::int64_t delayMs) {
    ::ll::thread::ServerThreadExecutor::getDefault().executeAfter(
        [] {
            if (!gPolling) {
                return;
            }
            std::unordered_set<std::string> online;
            if (auto level = ::ll::service::getLevel()) {
                level->forEachPlayer([&](::Player& p) {
                    online.insert(p.getRealName());
                    return true;
                });
            }
            (void)MenuState::getInstance().prune(online);
            schedulePrune(kPruneIntervalMs);
        },
        std::chrono::milliseconds(delayMs)
    );
}

} // namespace

bool install() {
    if (gAnimatePath || gUseItemPath) {
        return true;
    }

    // 链路 1：AnimatePacket。LL 的 hook() 失败时不抛也不回报，
    // 所以这里不把「没抛异常」当成成功 —— 真正的证据是 triggerStats()。
    try {
        gAnimateHook.hook();
        gAnimatePath = true;
    } catch (...) {
        gAnimatePath = false;
    }

    // 链路 2：右键空气兜底。与链路 1 并存，靠冷却去重。
    if (easyplace::installed()) {
        easyplace::setUseItemObserver(&onUseItem);
        gUseItemPath = true;
    }

    if ((gAnimatePath || gUseItemPath) && !gPolling) {
        gPolling = true;
        schedulePrune(kPruneIntervalMs);
    }
    return gAnimatePath || gUseItemPath;
}

void uninstall() {
    if (gAnimatePath) {
        try {
            gAnimateHook.unhook();
        } catch (...) {
        }
        gAnimatePath = false;
    }
    if (gUseItemPath) {
        easyplace::setUseItemObserver(nullptr);
        gUseItemPath = false;
    }
    gPolling = false;
}

bool installed() { return gAnimatePath || gUseItemPath; }

char const* activePath() {
    if (gAnimatePath && gUseItemPath) {
        return "animate+useitem";
    }
    if (gAnimatePath) {
        return "animate";
    }
    if (gUseItemPath) {
        return "useitem";
    }
    return "";
}

TriggerStats triggerStats() {
    TriggerStats stats;
    stats.animateSwings = gAnimateSwings.load(std::memory_order_relaxed);
    stats.swordSwings   = gSwordSwings.load(std::memory_order_relaxed);
    return stats;
}

} // namespace litematicabe::ui
