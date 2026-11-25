#include "LitematicaBE/core/schematic/LitematicWriter.h"

#include "LitematicaBE/core/nbt/NbtWriter.h"
#include "LitematicaBE/core/schematic/PaletteBits.h"

#include <chrono>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

namespace litematicabe::core::schematic {

namespace {

namespace nb = litematicabe::core::nbt;

std::int64_t nowMillis() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch())
        .count();
}

// 位打包：每个 long 从低位开始塞，跨 long 时高位续到下一个 long 的低位。
// 与读端 `LitematicFile.cpp::readBits` 严格互补（同一份文件写→读必须逐格一致）。
std::vector<std::uint64_t> packBits(std::vector<std::uint32_t> const& values, int bits) {
    auto const totalBits = static_cast<std::uint64_t>(values.size()) * static_cast<std::uint64_t>(bits);
    auto const longCount = static_cast<std::size_t>((totalBits + 63ull) / 64ull);

    std::vector<std::uint64_t> longs(longCount, 0);
    std::uint64_t const        mask = (bits >= 64) ? ~0ull : ((1ull << bits) - 1ull);

    for (std::size_t i = 0; i < values.size(); ++i) {
        auto const value     = static_cast<std::uint64_t>(values[i]) & mask;
        auto const bitIndex  = static_cast<std::uint64_t>(i) * static_cast<std::uint64_t>(bits);
        auto const longIndex = static_cast<std::size_t>(bitIndex / 64ull);
        auto const bitOffset = static_cast<int>(bitIndex % 64ull);
        if (longIndex >= longs.size()) {
            break;
        }

        longs[longIndex] |= value << bitOffset;
        if (bitOffset + bits > 64 && longIndex + 1 < longs.size()) {
            longs[longIndex + 1] |= value >> (64 - bitOffset);
        }
    }
    return longs;
}

nb::TagPtr intVec3(std::int32_t x, std::int32_t y, std::int32_t z) {
    auto tag = nb::makeCompound();
    nb::put(*tag, "x", nb::makeInt(x));
    nb::put(*tag, "y", nb::makeInt(y));
    nb::put(*tag, "z", nb::makeInt(z));
    return tag;
}

} // namespace

LitematicBuild buildLitematic(JavaRegion const& region, LitematicWriteOptions const& options) {
    LitematicBuild build;

    if (region.sizeX <= 0 || region.sizeY <= 0 || region.sizeZ <= 0) {
        build.error = ".litematic 尺寸非法";
        return build;
    }
    auto const volume = region.volume();
    if (region.grid.size() != static_cast<std::size_t>(volume)) {
        build.error = "网格与选区尺寸不一致";
        return build;
    }
    if (region.palette.empty()) {
        build.error = "调色板为空";
        return build;
    }

    auto const bits = bitsForPalette(region.palette.size());
    build.bitsPerBlock = bits;

    // Litematica 的索引顺序：x 最快（`(y·sizeZ + z)·sizeX + x`）；而扫描网格是 z 最快（`.mcstructure` 口径）。这里做一次重排，别让两份格式共用一套错顺序。
    std::vector<std::uint32_t> ordered;
    ordered.reserve(static_cast<std::size_t>(volume));
    auto const sy = static_cast<std::uint64_t>(region.sizeY);
    auto const sz = static_cast<std::uint64_t>(region.sizeZ);
    for (std::int32_t y = 0; y < region.sizeY; ++y) {
        for (std::int32_t z = 0; z < region.sizeZ; ++z) {
            for (std::int32_t x = 0; x < region.sizeX; ++x) {
                auto const src = static_cast<std::size_t>(
                    static_cast<std::uint64_t>(x) * sy * sz + static_cast<std::uint64_t>(y) * sz
                    + static_cast<std::uint64_t>(z)
                );
                auto const index = region.grid[src];
                ordered.push_back(static_cast<std::uint32_t>(index < 0 ? 0 : index));
            }
        }
    }
    auto const blockStates = packBits(ordered, bits);

    // ── BlockStatePalette ──
    auto palette = nb::makeList(nb::TagType::Compound);
    palette->list.reserve(region.palette.size());
    for (auto const& slot : region.palette) {
        auto entry = nb::makeCompound();
        nb::put(*entry, "Name", nb::makeString(slot.name));
        if (!slot.properties.empty()) {
            auto properties = nb::makeCompound();
            for (auto const& [key, value] : slot.properties) {
                nb::put(*properties, key, nb::makeString(value));
            }
            nb::put(*entry, "Properties", std::move(properties));
        }
        palette->list.push_back(std::move(entry));
    }

    auto const nowMillisValue = nowMillis();

    auto metadata = nb::makeCompound();
    nb::put(*metadata, "Name", nb::makeString(options.name));
    nb::put(*metadata, "Author", nb::makeString(options.author));
    nb::put(*metadata, "Description", nb::makeString(options.description));
    nb::put(*metadata, "RegionCount", nb::makeInt(1));
    nb::put(*metadata, "TotalVolume", nb::makeInt(static_cast<std::int64_t>(volume)));
    nb::put(*metadata, "TotalBlocks", nb::makeInt(static_cast<std::int64_t>(region.totalBlocks)));
    nb::put(*metadata, "TimeCreated", nb::makeLong(nowMillisValue));
    nb::put(*metadata, "TimeModified", nb::makeLong(nowMillisValue));
    nb::put(*metadata, "EnclosingSize", intVec3(region.sizeX, region.sizeY, region.sizeZ));

    auto regionName = options.regionName.empty() ? options.name : options.regionName;
    if (regionName.empty()) {
        regionName = "region";
    }

    auto regionTag = nb::makeCompound();
    // Position 用 (0,0,0)：选区就是投影自己，世界坐标记在 mcstructure 的 origin 上。
    nb::put(*regionTag, "Position", intVec3(0, 0, 0));
    nb::put(*regionTag, "Size", intVec3(region.sizeX, region.sizeY, region.sizeZ));
    nb::put(*regionTag, "BlockStatePalette", std::move(palette));
    nb::put(*regionTag, "BlockStates", nb::makeLongArray(blockStates));
    // 方块实体：`.litematic` 的 TileEntities 要 Java 的方块实体 id 与字段，与基岩的 BlockActor NBT 不是一套东西 —— 首版留空（.mcstructure 侧已完整写入）。
    nb::put(*regionTag, "TileEntities", nb::makeList(nb::TagType::Compound));
    nb::put(*regionTag, "Entities", nb::makeList(nb::TagType::Compound));

    auto regions = nb::makeCompound();
    nb::put(*regions, regionName, std::move(regionTag));

    auto root = nb::makeCompound();
    nb::put(*root, "MinecraftDataVersion", nb::makeInt(options.dataVersion));
    nb::put(*root, "Version", nb::makeInt(options.version));
    nb::put(*root, "SubVersion", nb::makeInt(options.subVersion));
    nb::put(*root, "Metadata", std::move(metadata));
    nb::put(*root, "Regions", std::move(regions));

    auto plain = nb::serialize(*root, nb::Endian::Big);
    if (plain.empty()) {
        build.error = "NBT 序列化失败（结构不合法）";
        return build;
    }

    build.bytes = nb::gzipCompress(plain);
    if (build.bytes.empty()) {
        build.error = "gzip 压缩失败";
        return build;
    }
    build.paletteSize = region.palette.size();
    return build;
}

bool writeLitematicFile(
    std::filesystem::path const& file,
    JavaRegion const&            region,
    LitematicWriteOptions const& options,
    std::string&                 error,
    std::size_t*                 bytesOut,
    std::size_t*                 paletteOut
) {
    auto const build = buildLitematic(region, options);
    if (!build.ok()) {
        error = build.error;
        return false;
    }
    if (!nb::writeFile(file, build.bytes, error)) {
        return false;
    }
    if (bytesOut != nullptr) {
        *bytesOut = build.bytes.size();
    }
    if (paletteOut != nullptr) {
        *paletteOut = build.paletteSize;
    }
    return true;
}

} // namespace litematicabe::core::schematic
