#include "LitematicaBE/easyplace/EasyPlace.h"

#include "LitematicaBE/core/place/PlaceGuard.h"
#include "LitematicaBE/ghost/BlockHook.h"
#include "LitematicaBE/ghost/ProjectionManager.h"

#include "ll/api/memory/Hook.h"
#include "ll/api/service/Bedrock.h"
#include "ll/api/thread/ServerThreadExecutor.h"

#include "mc/world/actor/Actor.h"
#include "mc/world/actor/player/Inventory.h"
#include "mc/world/actor/player/Player.h"
#include "mc/world/gamemode/InteractionResult.h"
#include "mc/world/item/Item.h"
#include "mc/world/item/ItemStack.h"
#include "mc/world/item/ItemUseMethod.h"
#include "mc/world/item/ItemUsedOnEventContext.h"
#include "mc/world/level/BlockPos.h"
#include "mc/world/level/BlockSource.h"
#include "mc/world/level/GameType.h"
#include "mc/world/level/Level.h"
#include "mc/world/level/block/Block.h"
#include "mc/world/level/block/BlockType.h"
#include "mc/world/level/block/actor/BlockActorType.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace litematicabe::easyplace {

namespace {

namespace place = litematicabe::core::place;

// 开关按玩家名存：命令层拿到的只有名字，会话对象随时可能重生/换维度。
std::unordered_set<std::string> gEnabled;

Stats sStats{};

// ─────────────────────────── 方块类型闸门 ───────────────────────────

// 「不该动的方块类型」判定已提取到 `core/place/PlaceGuard`（投影打印机共用同一套）。
// 这里只留一个薄包装，让调用点保持可读。
bool typeBlocked(::BlockType const& type) { return place::isRiskyType(type, place::RiskFilter{}); }

// ─────────────────────────── 放置上下文 ───────────────────────────

// 一次 `Item::useOn` / `Player::useItem` 内的统计（同一次放置可能写多格）。
struct Context {
    ::Player*          player{};
    int                slot{};
    ::Item const*      carriedItem{}; // 放置前的物品（会计退款用）
    int                carriedAux{};
    int                swaps{};       // 需要从背包扣料替换的格数
    ::BlockType const* targetType{};
    // 本次真正落下了真方块的格（决定「该格不再显示 ghost」）。
    std::vector<::BlockPos> filled;
};

thread_local Context tCtx{};

// ─────────────────────────── 物品会计 ───────────────────────────

struct Pending {
    std::string        playerName;
    int                slot{};
    ::Item const*      carriedItem{};
    int                carriedAux{};
    ::BlockType const* targetType{};
    int                amount{};
};

std::vector<Pending>                          gPending;
std::atomic<bool>                             gFlushScheduled{false};
std::unordered_map<std::string, std::int64_t> gLastNoticeMs;

std::int64_t nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch()
    )
        .count();
}

void notifyMissing(::Player& player, ::BlockType const& target) {
    auto const now  = nowMs();
    auto&      last = gLastNoticeMs[player.getRealName()];
    if (now - last < 1500) {
        return;
    }
    last = now;
    player.sendMessage("§e[投影] 背包和潜影盒里都没有 §f" + target.getTypeName() + "§e，已阻止这次放置§r");
}

// 物品判定/计数也移到了 `PlaceGuard`（投影打印机复用同一套「方块 ↔ 物品」判定）。
using place::stackIsBlockType;

// 背包里有没有（除手持槽外）目标物品。
int countItemFor(::Player& player, ::BlockType const& type, int skipSlot) {
    return place::countBlockItem(player.getInventory(), type, skipSlot);
}

void runAccounting();

void scheduleAccounting() {
    if (gFlushScheduled.exchange(true)) {
        return;
    }
    // 等一个 tick 再结算：引擎扣减手持物品的时机在 `useOn` 之后，这里让引擎先落完账，再按净额修正。
    ::ll::thread::ServerThreadExecutor::getDefault().executeAfter(
        []() {
            gFlushScheduled.store(false);
            runAccounting();
        },
        std::chrono::milliseconds(60)
    );
}

// 一个玩家的一次结算：先把错物品补回，再扣掉同等数量的目标方块物品。
void settlePlayer(::Player& player, std::vector<Pending> const& items) {
    auto& inv     = player.getInventory();
    int   size    = inv.getContainerSize();
    bool  changed = false;

    for (auto const& p : items) {
        int need = p.amount;
        if (need <= 0 || p.targetType == nullptr) {
            continue;
        }

        // 目标物品当前可用数量（不含手持槽：那格装的是错物品）
        int available = countItemFor(player, *p.targetType, p.slot);
        if (available <= 0) {
            ++sStats.accountMissing;
            continue;
        }

        // 1) 先退错物品：失败/部分成功就只按实际退到的数量扣料
        int const   wantRefund = std::min(need, available);
        ::ItemStack refund{*p.carriedItem, wantRefund, p.carriedAux, nullptr};
        (void)inv.addItem(refund);
        int const refunded = wantRefund - (refund.isNull() ? 0 : static_cast<int>(refund.mCount));
        if (refunded <= 0) {
            ++sStats.accountMissing;
            continue;
        }
        changed = true;

        // 2) 再扣目标物品：先扣背包槽位，不够再从潜影盒里掏（潜影盒内容实时解析，不缓存）
        int const taken  = place::takeBlockItem(inv, *p.targetType, refunded, p.slot);
        int       remaining = refunded - taken;

        // 3) 没扣够（背包在两次遍历之间变了）：把多退的那部分收回去，保持守恒
        if (remaining > 0) {
            ::ItemStack undo{*p.carriedItem, remaining, p.carriedAux, nullptr};
            for (int i = 0; i < size && !undo.isNull() && undo.mCount > 0; ++i) {
                auto const& stack = inv.getItem(i);
                if (stack.isNull() || stack.getItem() != p.carriedItem) {
                    continue;
                }
                int const have = static_cast<int>(stack.mCount);
                int const take = std::min<int>(undo.mCount, have);
                if (take >= have) {
                    inv.removeItem(i, take);
                } else {
                    const_cast<::ItemStack&>(stack).mCount = static_cast<uchar>(have - take);
                }
                undo.mCount = static_cast<uchar>(undo.mCount - take);
            }
            ++sStats.accountMissing;
        }

        ++sStats.accounted;
    }

    if (changed) {
        // 一次批量同步，而不是每格一包。
        player.sendInventory(false);
    }
}

void runAccounting() {
    if (gPending.empty()) {
        return;
    }
    auto pending = std::move(gPending);
    gPending.clear();

    auto level = ::ll::service::getLevel();
    if (!level) {
        sStats.accountDropped += pending.size();
        return;
    }

    std::unordered_map<std::string, std::vector<Pending>> byPlayer;
    byPlayer.reserve(pending.size());
    for (auto& p : pending) {
        byPlayer[p.playerName].push_back(std::move(p));
    }

    level->forEachPlayer([&](::Player& player) {
        if (auto const it = byPlayer.find(player.getRealName()); it != byPlayer.end()) {
            settlePlayer(player, it->second);
            byPlayer.erase(it);
        }
        return true;
    });

    sStats.accountDropped += byPlayer.size();
}

// 一次放置结束时：登记「这些格已经有真方块」，并把需要换料的记账入队。
void flushContext() {
    // 先登记已填充格，ghost 层要据此停止覆盖它们。
    if (tCtx.player != nullptr) {
        for (auto const& cell : tCtx.filled) {
            ghost::ProjectionManager::getInstance().onCellFilled(cell.x, cell.y, cell.z, *tCtx.player);
        }
    }
    if (tCtx.swaps > 0 && tCtx.player != nullptr && tCtx.carriedItem != nullptr) {
        gPending.push_back(
            Pending{
                tCtx.player->getRealName(),
                tCtx.slot,
                tCtx.carriedItem,
                tCtx.carriedAux,
                tCtx.targetType,
                tCtx.swaps,
            }
        );
        scheduleAccounting();
    }
    tCtx = Context{};
}

// ─────────────────────────── setBlock 过滤 ───────────────────────────

} // namespace

ghost::SetBlockVerdict
filterSetBlock(::BlockSource& source, ::BlockPos const& pos, ::Block const& incoming, ::Block const*& out) {
    out = nullptr;
    (void)source;

    auto& ctx = tCtx;
    if (ctx.player == nullptr) {
        return ghost::SetBlockVerdict::Pass; // 不是玩家放置
    }
    if (incoming.isAir()) {
        return ghost::SetBlockVerdict::Pass; // 挖掘/其他写空气
    }

    ::Block const* target = nullptr;
    if (!ghost::ProjectionManager::getInstance().targetBlockAt(pos.x, pos.y, pos.z, target)) {
        return ghost::SetBlockVerdict::Pass; // 不在任何投影里
    }
    if (target == nullptr) {
        ++sStats.notReplaceable;
        return ghost::SetBlockVerdict::Pass;
    }
    if (target->mSerializationIdHash == incoming.mSerializationIdHash) {
        ++sStats.alreadyRight;
        // 玩家自己放对了：这一格从此是真方块，ghost 不该再盖它。
        ctx.filled.push_back(pos);
        return ghost::SetBlockVerdict::Pass;
    }

    ::BlockType const* incomingType = &incoming.getBlockType();
    ::BlockType const* targetType   = &target->getBlockType();

    // 开关只控制「改写」，不控制「已填充登记」：
    // 没开轻松的玩家照样会在这个格子上放下真方块，ghost 层同样不该再盖住它。
    if (!enabledFor(ctx.player->getRealName())) {
        ctx.filled.push_back(pos);
        return ghost::SetBlockVerdict::Pass;
    }

    // 手上物品本身会带来多格/实体这类副作用，不碰。
    if (typeBlocked(*incomingType) || typeBlocked(*targetType)) {
        ++sStats.riskySkipped;
        // 放行意味着这一格会变成玩家放的方块（可能不是投影要求的），服务端已经有真方块了，同样不能再拿 ghost 盖。
        ctx.filled.push_back(pos);
        return ghost::SetBlockVerdict::Pass;
    }

    ++sStats.candidates;
    ::Player& player = *ctx.player;

    if (player.getPlayerGameType() == ::GameType::Creative) {
        out = target;
        ctx.filled.push_back(pos);
        ++sStats.replacedSameItem; // 创造模式不扣物品，按「无需会计」计数
        return ghost::SetBlockVerdict::Replace;
    }

    // 同一方块类型、只是状态不同（楼梯朝向/台阶上下半…）：引擎扣的就是同一个物品，
    // 直接改状态即可，不需要任何会计。
    if (incomingType == targetType) {
        out = target;
        ctx.filled.push_back(pos);
        ++sStats.replacedSameItem;
        return ghost::SetBlockVerdict::Replace;
    }

    // 不同物品：必须背包里有目标物品可扣，否则拒绝这次放置（不扣任何物品）。
    if (countItemFor(player, *targetType, ctx.slot) <= 0) {
        notifyMissing(player, *targetType);
        ++sStats.denied;
        return ghost::SetBlockVerdict::Deny;
    }

    out            = target;
    ctx.targetType = targetType;
    ++ctx.swaps;
    ctx.filled.push_back(pos);
    ++sStats.replacedSwap;
    return ghost::SetBlockVerdict::Replace;
}

namespace {

// 「使用物品」的观察回调（木剑开面板）。只读，不参与任何拦截判定。
// 定义必须早于 `PlayerUseItemHook`（宏展开后函数体直接引用它）。
UseItemObserver gUseItemObserver;

// `Player::useItem` 覆盖「对空气使用物品」（吃/喝/扔），是附带上下文；方块放置真正走 `Item::useOn`（见下）。
LL_TYPE_INSTANCE_HOOK(
    PlayerUseItemHook,
    ll::memory::HookPriority::Highest,
    ::Player,
    &::Player::$useItem,
    void,
    ::ItemStackBase& instance,
    ::ItemUseMethod  method,
    bool             consume
) {
    ++sStats.useItemCalls;

    // 嵌套调用（引擎内部再进 useItem）时先存旧上下文，出栈再恢复。
    Context const saved = tCtx;

    auto* player = thisFor<::Player>();
    tCtx         = Context{};
    if (player != nullptr) {
        tCtx.player = player;
        tCtx.slot   = player->getSelectedItemSlot();
        // `instance` 在某些服务端调用链里可能是空栈（或不是手上的那一栈），那种情况下用 `getCarriedItem()` 兜底，否则物品会计会拿不到「被扣的是哪个物品」。
        if (!instance.isNull()) {
            tCtx.carriedItem = instance.getItem();
            tCtx.carriedAux  = instance.mAuxValue;
        } else {
            auto const& carried = player->getCarriedItem();
            if (!carried.isNull()) {
                tCtx.carriedItem = carried.getItem();
                tCtx.carriedAux  = carried.mAuxValue;
            }
        }
    }

    origin(instance, method, consume);

    // 观察者（木剑开面板）：只读，放在原逻辑之后，绝不影响物品消耗与放置会计。
    if (player != nullptr) {
        if (auto const& observer = gUseItemObserver; observer != nullptr) {
            observer(*player, instance);
        }
    }

    flushContext();
    tCtx = saved;
}

ll::memory::HookRegistrar<PlayerUseItemHook> gUseItemHook;

// 「放置之前」的拦截回调（木剑选点）。只在服务端主线程读写，不加锁。
UseOnInterceptor gInterceptor;

// 方块放置链路：
//   Item::useOn(item, entity, x, y, z, face, clickPos, ctx)
//     → Item::_useOn(...)            （虚函数，BlockItem 覆盖）
//     → BlockItem::_useOn(...)       （inline）
//     → BlockSource::setBlock(...)   ← 我们的 filter 在这里改写
//
// 只挂 `Player::useItem` 是不够的：那是「使用物品」的入口，玩家对着方块右键放置走的是 `Item::useOn`。
// `Item::useOn` 参数里直接有 `Actor& entity` 和手上的 `ItemStack&`，是这个功能最准的锚点。
LL_TYPE_INSTANCE_HOOK(
    ItemUseOnHook,
    ll::memory::HookPriority::Highest,
    ::Item,
    &::Item::useOn,
    ::InteractionResult,
    ::ItemStack&             item,
    ::Actor&                 entity,
    int                      x,
    int                      y,
    int                      z,
    uchar                    face,
    ::Vec3 const&            clickPos,
    ::ItemUsedOnEventContext ctx
) {
    ++sStats.useOnCalls;

    // 嵌套调用（useItem → useOn，或 useOn 内部递归）时保存外层上下文。
    Context const saved = tCtx;

    auto* player = entity.isPlayer() ? static_cast<::Player*>(&entity) : nullptr;

    // 「放置之前」的拦截点（木剑选点等）：吃掉这一击时原版交互与放置都不发生。
    // 必须在设置 tCtx 之前返回，否则残留的上下文会让后续 $(setBlock) 误判成本次放置。
    if (player != nullptr) {
        if (auto const& interceptor = gInterceptor; interceptor != nullptr) {
            if (interceptor(*player, item, ::BlockPos{x, y, z}, face)) {
                tCtx = saved;
                return ::InteractionResult{::InteractionResult::Result::Success};
            }
        }
    }

    tCtx         = Context{};
    if (player != nullptr) {
        tCtx.player = player;
        tCtx.slot   = player->getSelectedItemSlot();
        if (!item.isNull()) {
            tCtx.carriedItem = item.getItem();
            tCtx.carriedAux  = item.mAuxValue;
        } else {
            auto const& carried = player->getCarriedItem();
            if (!carried.isNull()) {
                tCtx.carriedItem = carried.getItem();
                tCtx.carriedAux  = carried.mAuxValue;
            }
        }
    }

    auto const result = origin(item, entity, x, y, z, face, clickPos, ctx);

    flushContext();
    tCtx = saved;
    return result;
}

ll::memory::HookRegistrar<ItemUseOnHook> gUseOnHook;

bool gInstalled{false};

} // namespace

bool install() {
    if (gInstalled) {
        return true;
    }
    bool ok = true;
    try {
        // useOn 是方块放置的真正入口，装不上就没有这个功能。
        gUseOnHook.hook();
    } catch (...) {
        ok = false;
    }
    try {
        // useItem 覆盖「对空气使用物品」，属于附带；失败不影响放置。
        gUseItemHook.hook();
    } catch (...) {
    }
    if (!ok) {
        return false;
    }
    ghost::setBlockFilter(&filterSetBlock);
    gInstalled = true;
    return true;
}

void uninstall() {
    ghost::setBlockFilter(nullptr);
    // 观察者/拦截器都要摘：hook 拆掉后它们不会再被调用，留着只会在下次 install 时误触发。
    gUseItemObserver = nullptr;
    if (!gInstalled) {
        return;
    }
    try {
        gUseOnHook.unhook();
    } catch (...) {
    }
    try {
        gUseItemHook.unhook();
    } catch (...) {
    }
    gInstalled = false;
}

bool installed() { return gInstalled; }

void setUseOnInterceptor(UseOnInterceptor fn) { gInterceptor = std::move(fn); }

bool hasUseOnInterceptor() { return gInterceptor != nullptr; }

void setUseItemObserver(UseItemObserver fn) { gUseItemObserver = std::move(fn); }

bool hasUseItemObserver() { return gUseItemObserver != nullptr; }

bool toggle(std::string const& playerName) {
    if (auto const it = gEnabled.find(playerName); it != gEnabled.end()) {
        gEnabled.erase(it);
        return false;
    }
    gEnabled.insert(playerName);
    return true;
}

bool enabledFor(std::string const& playerName) { return gEnabled.find(playerName) != gEnabled.end(); }

void clearAll() { gEnabled.clear(); }

std::size_t enabledCount() { return gEnabled.size(); }

Stats stats() { return sStats; }

std::string describe() {
    std::size_t const filled = ghost::ProjectionManager::getInstance().filledCellCount();
    char              buf[288]{};
    std::snprintf(
        buf,
        sizeof(buf),
        "轻松放置：hook %s / 开关 %zu 人 / 放置 %llu / 候选 %llu / 改状态 %llu / 换料 %llu / 拒绝 %llu"
        " / 会计 %llu（异常 %llu）/ 已填充格 %zu",
        gInstalled ? "开" : "关",
        gEnabled.size(),
        static_cast<unsigned long long>(sStats.useOnCalls + sStats.useItemCalls),
        static_cast<unsigned long long>(sStats.candidates),
        static_cast<unsigned long long>(sStats.replacedSameItem),
        static_cast<unsigned long long>(sStats.replacedSwap),
        static_cast<unsigned long long>(sStats.denied),
        static_cast<unsigned long long>(sStats.accounted),
        static_cast<unsigned long long>(sStats.accountMissing),
        filled
    );
    return buf;
}

} // namespace litematicabe::easyplace
