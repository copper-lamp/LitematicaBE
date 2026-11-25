#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace litematicabe::core::report {

// 一条材料（一种方块名 + 变体）。
//
// 变体只用来把同名的染色/材质分支分开（`wool[color=red]` 与 `wool[color=blue]` 是两种材料），朝向、开关这类状态不影响材料，故意丢掉，与旧实现（`MaterialCounter.getVariantInfo`）同口径。
struct MaterialCount {
    std::string   name;      //< 方块名（去 `minecraft:` 前缀，保持文件口径：`.litematic` 是 Java 名）
    std::string   variant;   //< 变体标签（中文如「红色」，空 = 无变体）
    std::string   state;     //< 首次出现的完整状态串（诊断 / 排查映射用）
    std::uint64_t count{};   //< 该材料在投影里占多少格
    bool          placeable{true}; //< 全部状态都能解析成可放置方块（false = 有状态在当前映射下放不出来）
};

struct MaterialReport {
    std::vector<MaterialCount> items;             //< 数量降序；同数量按名字、变体升序
    std::uint64_t              totalBlocks{};     //< 参与统计的方块总数
    std::uint64_t              distinctStates{};  //< 实际用到的调色板状态数（去重）
    std::uint64_t              unplaceable{};     //< 映射失败（放不出来）的格数
};

// 按「名字 + 变体」聚合材料。
//
// @param paletteStates    调色板状态串（`name[state=value,...]`）
// @param blockPaletteIds  每格对应的调色板下标（越界的下标直接跳过，不崩）
// @param palettePlaceable 可选的「调色板项是否可放置」表（长度与调色板一致，可为 nullptr）
MaterialReport countMaterials(
    std::vector<std::string> const&   paletteStates,
    std::vector<std::uint32_t> const& blockPaletteIds,
    std::vector<bool> const*          palettePlaceable = nullptr
);

// 单条状态串拆成「名字 + 变体」。
struct ParsedState {
    std::string name;    //< 去 `minecraft:` 前缀后的方块名
    std::string variant; //< 变体中文标签（无则空）
};

ParsedState parseStateText(std::string const& stateText);

// 颜色 / 木种 / 石材 / 沙土这些「材质分支值」的中文标签；认不出返回空串。
//
// 这张表只影响报表可读性，**不参与任何映射或判定**，加新方块不需要动它。
[[nodiscard]] std::string materialVariantLabel(std::string const& key, std::string const& value);

} // namespace litematicabe::core::report
