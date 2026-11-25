#pragma once

#include "LitematicaBE/core/nbt/NbtTag.h"
#include "LitematicaBE/core/save/RegionScan.h"

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace litematicabe::core::schematic {

// `.mcstructure` 的写入口径（与旧项目 `McstructureWriter` 对齐）。
struct McstructureWriteOptions {
    std::int64_t blockVersion{18168865}; //< `block_palette[*].version`（实测样本值）
    std::int64_t formatVersion{1};       //< 根上的 `format_version`
    bool         writeLiquidLayer{true}; //< 是否写第二层（整层 -1 占位）
};

struct McstructureBuild {
    std::vector<std::uint8_t> bytes;
    std::size_t               paletteSize{};
    std::size_t               entityBlocks{};
    std::string               error;

    [[nodiscard]] bool ok() const { return error.empty(); }
};

// 从扫描结果构建 `.mcstructure` 字节。
//
// 关键约定（读端 `McstructureFile` 已按同一口径解析，两边必须一致）：
//   * 索引顺序 `x·sizeZ·sizeY + y·sizeZ + z`（z 最快）；
//   * `block_indices[0]` 主层，`block_indices[1]` 液体层（无内容时整层 -1）；
//   * palette 0 号是 air；`states` 的值类型按 CBDS 原样（Byte/Int/String）。
McstructureBuild buildMcstructure(core::save::RegionScan const& scan, McstructureWriteOptions const& options);

// 构建并落盘（未压缩的小端 NBT）。
bool writeMcstructureFile(
    std::filesystem::path const&        file,
    core::save::RegionScan const&       scan,
    McstructureWriteOptions const&      options,
    std::string&                        error,
    std::size_t*                        bytesOut = nullptr,
    std::size_t*                        paletteOut = nullptr,
    std::size_t*                        entityOut = nullptr
);

} // namespace litematicabe::core::schematic
