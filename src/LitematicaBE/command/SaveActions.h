#pragma once

#include "LitematicaBE/core/save/SaveConfig.h"

#include <optional>
#include <string>

class CommandOutput;
class Player;

namespace litematicabe::command::savetool {

// `/lit sel`：显示当前选区（没有则给手势提示）。
void showSelection(::CommandOutput& output, ::Player* player);

// `/lit sel clear`：清空选区并收回线框。
void clearSelection(::CommandOutput& output, ::Player* player);

// `/lit save stru|lite <名字>`：按选区保存。格式由命令显式给出（没有「默认格式」配置）。
void saveWithSelection(
    ::CommandOutput&      output,
    ::Player*             player,
    std::string const&    name,
    core::save::Format    format
);

// `/lit saveat stru|lite|both <名字> <x1> <y1> <z1> <x2> <y2> <z2>`：不依赖选区直接保存一个包围盒。
// 控制台也能用（有玩家在线就能拿到 BlockSource）；格式必须显式给，命令默认带回读自检。
void saveAt(
    ::CommandOutput&   output,
    ::Player*          player,
    std::string const& name,
    core::save::Format format,
    int                x1,
    int                y1,
    int                z1,
    int                x2,
    int                y2,
    int                z2
);

// `/lit savediag <x> <y> <z>`：打印一格方块的名字、状态提取结果与 Java 转换结果。
void diagnose(::CommandOutput& output, ::Player* player, int x, int y, int z);

// `/lit saveinfo`：配置摘要（默认格式、上限、门槛、覆盖策略）。
void printInfo(::CommandOutput& output);

} // namespace litematicabe::command::savetool
