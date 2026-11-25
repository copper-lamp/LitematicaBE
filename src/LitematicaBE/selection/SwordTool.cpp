#include "LitematicaBE/selection/SwordTool.h"

#include "LitematicaBE/core/save/SaveConfig.h"
#include "LitematicaBE/easyplace/EasyPlace.h"

#include "ll/api/service/Bedrock.h"
#include "ll/api/thread/ServerThreadExecutor.h"

#include "mc/world/actor/player/Player.h"
#include "mc/world/item/ItemStack.h"
#include "mc/world/level/BlockPos.h"
#include "mc/world/level/Level.h"

#include <chrono>
#include <cstdio>
#include <string>
#include <unordered_set>
#include <utility>

namespace litematicabe::selection {

namespace {

// 选点工具的唯一触发物（旧项目同款）。
constexpr char const* kSwordName = "minecraft:wooden_sword";

// 下线清理轮询间隔：玩家退服/掉线后选区与线框都该消失。
constexpr std::int64_t kPruneIntervalMs = 2000;

bool gInstalled{};
bool gPolling{};

std::string pointText(Point const& point) {
    char buf[96]{};
    std::snprintf(buf, sizeof(buf), "(%d, %d, %d)", point.x, point.y, point.z);
    return buf;
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
            (void)SelectionStore::getInstance().prune(online);
            box::prune(online);
            schedulePrune(kPruneIntervalMs);
        },
        std::chrono::milliseconds(delayMs)
    );
}

} // namespace

bool install() {
    if (gInstalled) {
        return true;
    }
    // 右键入口在轻松放置的 `Item::useOn` hook 里，那边没挂上就没有任何触发点。
    if (!easyplace::installed()) {
        return false;
    }
    easyplace::setUseOnInterceptor(&onUseOn);
    gInstalled = true;
    if (!gPolling) {
        gPolling = true;
        schedulePrune(kPruneIntervalMs);
    }
    return true;
}

void uninstall() {
    easyplace::setUseOnInterceptor(nullptr);
    gInstalled    = false;
    gPolling      = false;
    box::hideAll();
    SelectionStore::getInstance().clearAll();
}

bool installed() { return gInstalled; }

bool onUseOn(::Player& player, ::ItemStack& item, ::BlockPos const& pos, unsigned char face) {
    (void)face;
    if (!gInstalled) {
        return false;
    }
    if (item.isNull()) {
        return false;
    }
    // 只认木剑：其它任何物品原样放行（轻松放置与原生交互完全不受影响）。
    if (item.getTypeName() != kSwordName) {
        return false;
    }

    auto&             store = SelectionStore::getInstance();
    std::string const name  = player.getRealName();

    // 潜行 + 右键 = 清空选区（旧项目靠 UI 取消，这里给一个不依赖界面的手势）。
    if (player.isSneaking()) {
        store.clear(name);
        box::hide(name);
        player.sendMessage("§b[选区]§r 已清空：木剑右键方块重新点第一点");
        return true;
    }

    // 冷却内的这一击直接吃掉：右键连点会触发两次 useOn，放过去会把 pos2 记成 pos1。
    if (store.cooldownLeft(name) > 0) {
        return true;
    }

    Point const point{pos.x, pos.y, pos.z, static_cast<std::int32_t>(player.getDimensionId())};
    auto const  result = store.record(name, point);

    switch (result.status) {
    case PickStatus::Cooling:
        return true;

    case PickStatus::First:
        // 第一点之后旧选区已经作废：把旧框收起来，免得和新的第一点对不上（看起来像"框错了"）。
        box::hide(name);
        player.sendMessage("§b[选区]§r 第一点 " + pointText(point) + "　§7右键方块点第二点§r");
        return true;

    case PickStatus::DimensionMismatch:
        player.sendMessage(
            "§c[选区]§r 两次选点必须同一维度：第一点在 " + pointText(result.first)
            + "　§7先回到那个维度再点第二点（潜行 + 右键可清空重来）§r"
        );
        return true;

    case PickStatus::Second:
    default: {
        auto const& box = result.box;
        char        head[192]{};
        std::snprintf(
            head,
            sizeof(head),
            "§b[选区]§r 第二点 %s　范围 %s → %s",
            pointText(point).c_str(),
            pointText(Point{box.minX, box.minY, box.minZ, box.dimid}).c_str(),
            pointText(Point{box.maxX, box.maxY, box.maxZ, box.dimid}).c_str()
        );
        char tail[192]{};
        std::snprintf(
            tail,
            sizeof(tail),
            "　　尺寸 %d × %d × %d（%llu 格）",
            box.width(),
            box.height(),
            box.depth(),
            static_cast<unsigned long long>(box.volume())
        );
        player.sendMessage(std::string{head} + "\n" + tail);
        player.sendMessage("§7/lit save stru <名字>§r 存 .mcstructure　§7/lit save lite <名字>§r 存 .litematic");
        player.sendMessage("§7或 §f潜行 + 左键挥木剑§r 打开面板，在「选区与保存」里点两下存盘");
        player.sendMessage("§7/lit sel clear§r 清空选区");
        box::show(name, box);
        return true;
    }
    }
}

void clearSelection(std::string const& playerName) {
    SelectionStore::getInstance().clear(playerName);
    box::hide(playerName);
}

std::string describeSelection(std::string const& playerName) {
    auto const& store = SelectionStore::getInstance();
    Box         box;
    if (store.current(playerName, box)) {
        char buf[224]{};
        std::snprintf(
            buf,
            sizeof(buf),
            "选区 %s → %s，%d × %d × %d（%llu 格）",
            pointText(Point{box.minX, box.minY, box.minZ, box.dimid}).c_str(),
            pointText(Point{box.maxX, box.maxY, box.maxZ, box.dimid}).c_str(),
            box.width(),
            box.height(),
            box.depth(),
            static_cast<unsigned long long>(box.volume())
        );
        return buf;
    }

    Point first;
    if (store.firstPoint(playerName, first)) {
        return "已点第一点 " + pointText(first) + "，还差第二点（木剑右键方块）";
    }
    return "还没有选区：手持木剑右键方块两次（潜行 + 右键可清空）";
}

} // namespace litematicabe::selection
