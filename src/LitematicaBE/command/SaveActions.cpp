#include "LitematicaBE/command/SaveActions.h"

#include "LitematicaBE/core/save/SaveConfig.h"
#include "LitematicaBE/core/save/SaveService.h"
#include "LitematicaBE/core/util/TextEncoding.h"
#include "LitematicaBE/selection/SelectionStore.h"
#include "LitematicaBE/selection/SwordTool.h"

#include "mc/server/commands/CommandOutput.h"
#include "mc/world/actor/player/Player.h"

#include <algorithm>
#include <cctype>
#include <optional>
#include <string>

namespace litematicabe::command::savetool {

namespace {

namespace save      = litematicabe::core::save;
namespace selection = litematicabe::selection;

// `/lit save` 的统一收尾提示。
void printHint(::CommandOutput& output, save::SaveResult const& result) {
    if (!result.files.empty()) {
        output.success("§7用 /lit info <文件名> 复核，/lit load <文件名> 铺投影§r");
    }
}

} // namespace

void showSelection(::CommandOutput& output, ::Player* player) {
    if (player == nullptr) {
        output.error("选区是按玩家记录的：请在游戏内执行 /lit sel（控制台可用 /lit saveat stru <名字> <坐标>）");
        return;
    }
    auto const name = player->getRealName();
    output.success("§b[选区]§r {}", selection::describeSelection(name));

    if (auto const* opts = &save::options(); opts->requireOp) {
        output.success("    §7保存门槛：需要管理员（config/save.json 的 requireOp）§r");
    }
    output.success(
        "    §7保存：/lit save stru <名字>（.mcstructure）　/lit save lite <名字>（.litematic）§r"
    );
}

void clearSelection(::CommandOutput& output, ::Player* player) {
    if (player == nullptr) {
        output.error("选区是按玩家记录的：请在游戏内执行 /lit sel clear");
        return;
    }
    selection::clearSelection(player->getRealName());
    output.success("§b[选区]§r 已清空（线框也已收回）");
}

void saveWithSelection(
    ::CommandOutput&   output,
    ::Player*          player,
    std::string const& name,
    save::Format       format
) {
    if (player == nullptr) {
        output.error(
            "控制台执行请用 /lit saveat stru|lite|both <名字> <x1> <y1> <z1> <x2> <y2> <z2>（选区是按玩家记录的）"
        );
        return;
    }

    auto const playerName = player->getRealName();
    selection::Box box;
    if (!selection::SelectionStore::getInstance().current(playerName, box)) {
        output.error("还没有完整选区：手持木剑右键方块两次（/lit sel 看状态）");
        return;
    }

    save::SaveRequest request;
    request.name   = name;
    request.author = playerName;
    request.format = format;
    request.verify = false;

    save::SaveResult result;
    (void)save::saveSelection(output, player, box, request, result);
    printHint(output, result);
}

void saveAt(
    ::CommandOutput&   output,
    ::Player*          player,
    std::string const& name,
    save::Format       format,
    int                x1,
    int                y1,
    int                z1,
    int                x2,
    int                y2,
    int                z2
) {
    selection::Box box;
    box.minX = std::min(x1, x2);
    box.minY = std::min(y1, y2);
    box.minZ = std::min(z1, z2);
    box.maxX = std::max(x1, x2);
    box.maxY = std::max(y1, y2);
    box.maxZ = std::max(z1, z2);
    box.dimid = player != nullptr ? static_cast<std::int32_t>(player->getDimensionId()) : 0;

    save::SaveRequest request;
    request.name   = name;
    request.author = player != nullptr ? player->getRealName() : "console";
    request.format = format;
    request.verify = true; // 命令行的坐标式保存就是给无人值守自测用的，默认带自检

    save::SaveResult result;
    (void)save::saveSelection(output, player, box, request, result);
    printHint(output, result);
}

void diagnose(::CommandOutput& output, ::Player* player, int x, int y, int z) {
    save::diagnoseBlock(output, player, x, y, z);
}

void printInfo(::CommandOutput& output) {
    auto const& opts = save::options();
    output.success("§b[保存设置]§r config/save.json");
    output.success("    格式：命令里显式指定 —— /lit save stru <名字> 或 /lit save lite <名字>");
    output.success("    体积上限：mcstructure/both {} 格｜litematic {} 格", opts.maxVolume, opts.maxVolumeLitematic);
    output.success(
        "    方块实体：{}｜液体层：{}｜blockVersion {}｜dataVersion {}",
        opts.includeBlockEntities ? "写入" : "不写",
        opts.writeLiquidLayer ? "写" : "不写",
        opts.blockVersion,
        opts.dataVersion
    );
    output.success(
        "    门槛：{}｜同名文件：{}｜选区线框：{}{}",
        opts.requireOp ? "需要管理员" : "不限身份",
        opts.overwrite ? "覆盖" : "不覆盖（报错）",
        opts.showSelectionBox ? "显示" : "不显示",
        opts.showSelectionBox ? (std::string{"（样式 "} + save::boxStyleName(opts.boxStyle) + "）") : std::string{}
    );
}

} // namespace litematicabe::command::savetool
