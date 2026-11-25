#pragma once

#include "LitematicaBE/core/schematic/LitematicFile.h"

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <string>
#include <utility>
#include <vector>

namespace litematicabe::core::schematic {

// `.mcstructure`（基岩版结构文件）。
// 与小端的 `.litematic` 不同，它是 未压缩的小端 NBT（也有的工具会 gzip，解析器两种都认）。
//
// 关键约定（与旧 JS 实现 `McstructureLoader` 对齐，避免同一份文件在两代实现里解出不同坐标）：
//    索引顺序：`index = x·sizeZ·sizeY + y·sizeZ + z`（z 变化最快）；
//    `block_indices[0]` 是主方块层，值为调色板下标，`-1` 或空气视为空；
//    `block_indices[1]` 是液体层，主层为空时用它（水/岩浆）；
//    状态键可能带 `minecraft:` 前缀（如 `minecraft:facing_direction`），解析时去掉前缀，原始键名保留在 `rawStates` 里供诊断。
struct McstructureFile {
    struct PaletteEntry {
        std::string                                     name;      // 原始名字（如 minecraft:flowing_water）
        std::string                                     renderName; // 归一化名字（flowing_water → water）
        std::vector<std::pair<std::string, std::string>> states;     // 去前缀后的状态
    };

    std::int32_t                size[3]{};      // x, y, z
    std::int32_t                origin[3]{};    // structure_world_origin（可选）
    std::int64_t                formatVersion{};
    std::int64_t                dataVersion{};  // palette 里第一个条目的 version
    std::vector<PaletteEntry>   palette;
    std::vector<std::int32_t>   blocks;         // layer 0
    std::vector<std::int32_t>   liquids;        // layer 1（可能为空）
    std::size_t                 blockEntityData{}; // block_position_data 条目数
    std::size_t                 entityCount{};
};

// 读 `.mcstructure`。
ReadError readMcstructure(std::filesystem::path const& file, McstructureFile& out);

// 遍历非空气方块（顺序与索引一致：x 最慢、z 最快）。
bool forEachBlock(McstructureFile const& file, std::function<bool(BlockRef const&)> const& visit);

} // namespace litematicabe::core::schematic
