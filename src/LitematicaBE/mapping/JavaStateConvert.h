#pragma once

#include "LitematicaBE/mapping/BlockStateText.h"

#include <string>
#include <string_view>

namespace litematicabe::mapping {

// Java 方块状态 → Bedrock 方块状态。
//
// 逐族移植旧项目 `src/core/BlockStateConverter.js`（LSE 版在真机上验证过的口径）：
// 每个方块族的朝向状态名和取值域都不一样 —— 楼梯用 `weirdo_direction`(0~3) +
// `upside_down_bit`，中继器用 `minecraft:cardinal_direction`（字符串），活塞用
// `facing_direction`(0~5)，火把用 `torch_facing_direction`（字符串）。
// 直接抛 Java 的 `facing` 过去，注册表认不出来就整条状态查询失败、退回默认朝向 ——
// 这就是「活塞朝向反了、楼梯上下颠倒」的成因。
//
// 键形态取自结构文件实测（Bedrock 1.21.132 的 palette）：
// 裸键 —— `weirdo_direction` / `facing_direction` / `upside_down_bit` /
//        `open_bit` / `torch_facing_direction` / `direction` / `repeater_delay` /
//        `redstone_signal` / `liquid_depth` / `pillar_axis` / `lever_direction`
// 带前缀 —— `minecraft:cardinal_direction` / `minecraft:facing_direction` /
//          `minecraft:vertical_half`
struct JavaStateResult {
    StatePairs  states;
    bool        converted{}; //< 是否命中某个方块族（false = 只做了兜底过滤）
    bool        dropped{};   //< 是否丢掉了 Java 独有键
    std::string family;      //< 命中的族名，诊断用
};

// @param bareName 去掉 `minecraft:` 的方块名（`oak_stairs` / `piston`）
[[nodiscard]] JavaStateResult convertJavaState(std::string_view bareName, StatePairs const& javaStates);

} // namespace litematicabe::mapping
