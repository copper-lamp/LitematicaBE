#pragma once

#include "LitematicaBE/core/nbt/NbtTag.h"

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <string>
#include <utility>
#include <vector>

namespace litematicabe::core::schematic {

// 一份 Java 口径的调色板条目（`.litematic` 的 `BlockStatePalette[*]`）。
struct JavaPaletteSlot {
    std::string                                      name; // `minecraft:oak_stairs`
    std::vector<std::pair<std::string, std::string>> properties;
};

// 转好 Java 口径的区域数据。
// 刻意与 `core::save::RegionScan` 分开：扫描结果是**基岩**口径（名字/状态都来自 BDS），`.litematic` 要的是 Java 口径，转换由 `mapping::BedrockToJava` 完成，这里只负责编码。
struct JavaRegion {
    std::int32_t sizeX{};
    std::int32_t sizeY{};
    std::int32_t sizeZ{};
    // 调色板；0 号固定 `minecraft:air`。
    std::vector<JavaPaletteSlot> palette;
    // 满网格调色板下标（-1 = 空气），顺序与 `RegionScan::grid` 相同：`x·sy·sz + y·sz + z`。
    std::vector<std::int32_t> grid;
    std::uint64_t             totalBlocks{};

    [[nodiscard]] std::uint64_t volume() const noexcept {
        return static_cast<std::uint64_t>(sizeX) * static_cast<std::uint64_t>(sizeY)
             * static_cast<std::uint64_t>(sizeZ);
    }
};

struct LitematicWriteOptions {
    std::string  name;
    std::string  author;
    std::string  description;
    std::string  regionName;
    std::int64_t dataVersion{3953}; //< `MinecraftDataVersion`（旧项目实测 Litematica 可读）
    std::int64_t version{7};
    std::int64_t subVersion{1};
};

struct LitematicBuild {
    std::vector<std::uint8_t> bytes; //< 已 gzip（`.litematic` 就是 gzip 后的大端 NBT）
    std::size_t               paletteSize{};
    int                       bitsPerBlock{};
    std::string               error;

    [[nodiscard]] bool ok() const { return error.empty(); }
};

// 构建 `.litematic` 字节（大端 NBT + gzip）。
LitematicBuild buildLitematic(JavaRegion const& region, LitematicWriteOptions const& options);

// 构建并落盘。
bool writeLitematicFile(
    std::filesystem::path const&    file,
    JavaRegion const&               region,
    LitematicWriteOptions const&    options,
    std::string&                    error,
    std::size_t*                    bytesOut = nullptr,
    std::size_t*                    paletteOut = nullptr
);

} // namespace litematicabe::core::schematic
