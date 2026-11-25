#include "LitematicaBE/core/schematic/LitematicFile.h"

#include "LitematicaBE/core/nbt/NbtTag.h"
#include "LitematicaBE/core/schematic/PaletteBits.h"

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <string>

namespace litematicabe::core::schematic {

namespace {

using nbt::Tag;
using nbt::TagType;

std::uint64_t readBits(std::vector<std::uint64_t> const& longs, std::uint64_t bitIndex, int bits) {
    auto const longIndex = static_cast<std::size_t>(bitIndex / 64);
    auto const bitOffset = static_cast<int>(bitIndex % 64);
    if (longIndex >= longs.size()) {
        return 0;
    }

    std::uint64_t value = longs[longIndex] >> bitOffset;
    if (bitOffset + bits > 64 && longIndex + 1 < longs.size()) {
        value |= longs[longIndex + 1] << (64 - bitOffset);
    }
    return value & ((1ull << bits) - 1ull);
}

std::string tagString(Tag const* tag) {
    if (tag == nullptr) {
        return {};
    }
    if (tag->type == TagType::String) {
        return tag->stringValue;
    }
    return {};
}

// 属性值统一字符串化（Java NBT 里可能是 byte/short/int/string）。
std::string propertyValue(Tag const* tag) {
    if (tag == nullptr) {
        return {};
    }
    switch (tag->type) {
    case TagType::Byte:
    case TagType::Short:
    case TagType::Int:
    case TagType::Long:
        return std::to_string(tag->intValue);
    case TagType::String:
        return tag->stringValue;
    case TagType::Float:
    case TagType::Double: {
        char buffer[32]{};
        std::snprintf(buffer, sizeof(buffer), "%g", tag->doubleValue);
        return buffer;
    }
    default:
        return {};
    }
}

bool readInt3(Tag const* tag, std::int32_t out[3]) {
    if (tag == nullptr || tag->type != TagType::Compound) {
        return false;
    }
    auto const* x = tag->find("x");
    auto const* y = tag->find("y");
    auto const* z = tag->find("z");
    if (x == nullptr || y == nullptr || z == nullptr) {
        return false;
    }
    out[0] = static_cast<std::int32_t>(x->asInt());
    out[1] = static_cast<std::int32_t>(y->asInt());
    out[2] = static_cast<std::int32_t>(z->asInt());
    return true;
}

void readPalette(Tag const* list, Region& region) {
    if (list == nullptr || list->type != TagType::List) {
        return;
    }
    region.palette.reserve(list->list.size());
    for (auto const& item : list->list) {
        PaletteEntry entry;
        entry.name = tagString(item ? item->find("Name") : nullptr);
        if (auto const* props = item ? item->find("Properties") : nullptr; props && props->isCompound()) {
            entry.properties.reserve(props->compound.size());
            for (auto const& [key, value] : props->compound) {
                entry.properties.emplace_back(key, propertyValue(value.get()));
            }
            // 稳定顺序，便于缓存与差分。
            std::sort(
                entry.properties.begin(),
                entry.properties.end(),
                [](auto const& a, auto const& b) { return a.first < b.first; }
            );
        }
        region.palette.push_back(std::move(entry));
    }
}

} // namespace

bool isAirOrVoid(std::string_view name) noexcept {
    return name == "minecraft:air" || name == "minecraft:cave_air" || name == "minecraft:void_air"
        || name == "minecraft:structure_void";
}

ReadError readLitematic(std::filesystem::path const& file, LitematicFile& out) {
    ReadError error;

    auto parsed = nbt::parseFile(file);
    if (!parsed.ok()) {
        error.message = parsed.error;
        return error;
    }

    auto const* root = parsed.root.get();
    if (root == nullptr || !root->isCompound()) {
        error.message = "根标签不是 Compound";
        return error;
    }

    out.version     = root->find("Version") ? root->find("Version")->asInt() : 0;
    out.dataVersion = root->find("MinecraftDataVersion") ? root->find("MinecraftDataVersion")->asInt() : 0;

    if (auto const* metadata = root->find("Metadata"); metadata && metadata->isCompound()) {
        out.name        = tagString(metadata->find("Name"));
        out.author      = tagString(metadata->find("Author"));
        out.description = tagString(metadata->find("Description"));
        out.totalBlocks = metadata->find("TotalBlocks") ? metadata->find("TotalBlocks")->asInt() : 0;
        (void)readInt3(metadata->find("EnclosingSize"), out.enclosingSize);
    }

    auto const* regions = root->find("Regions");
    if (regions == nullptr || !regions->isCompound()) {
        error.message = "缺少 Regions（不是 .litematic 文件？）";
        return error;
    }

    for (auto const& [regionName, regionTag] : regions->compound) {
        if (!regionTag || !regionTag->isCompound()) {
            continue;
        }
        Region region;
        region.name = regionName;

        if (!readInt3(regionTag->find("Position"), region.position)) {
            region.position[0] = region.position[1] = region.position[2] = 0;
        }
        if (!readInt3(regionTag->find("Size"), region.size)) {
            error.message = "区域 " + regionName + " 缺少 Size";
            return error;
        }

        // Litematica 的 Size 可能为负（表示方向），取绝对值。
        for (auto& v : region.size) {
            if (v < 0) {
                v = -v;
            }
        }

        readPalette(regionTag->find("BlockStatePalette"), region);

        if (auto const* states = regionTag->find("BlockStates"); states && states->type == TagType::LongArray) {
            region.states = states->longArray;
        }

        out.regions.push_back(std::move(region));
    }

    if (out.regions.empty()) {
        error.message = "Regions 为空";
        return error;
    }
    return error;
}

bool forEachBlock(Region const& region, std::function<bool(BlockRef const&)> const& visit) {
    auto const sizeX = region.size[0];
    auto const sizeY = region.size[1];
    auto const sizeZ = region.size[2];
    if (sizeX <= 0 || sizeY <= 0 || sizeZ <= 0 || region.palette.empty() || region.states.empty()) {
        return false;
    }

    auto const bits      = bitsForPalette(region.palette.size());
    auto const total     = static_cast<std::uint64_t>(sizeX) * static_cast<std::uint64_t>(sizeY)
                       * static_cast<std::uint64_t>(sizeZ);
    auto const neededBits = total * static_cast<std::uint64_t>(bits);
    auto const availableBits = static_cast<std::uint64_t>(region.states.size()) * 64ull;
    if (neededBits > availableBits + 64ull) {
        // 允许 1 个 long 的余量（不同工具对末尾的填充不一致）
        return false;
    }

    std::uint64_t index = 0;
    for (std::int32_t y = 0; y < sizeY; ++y) {
        for (std::int32_t z = 0; z < sizeZ; ++z) {
            for (std::int32_t x = 0; x < sizeX; ++x, ++index) {
                auto const paletteIndex = readBits(region.states, index * static_cast<std::uint64_t>(bits), bits);
                if (paletteIndex >= region.palette.size()) {
                    continue;
                }
                auto const& entry = region.palette[paletteIndex];
                if (isAirOrVoid(entry.name)) {
                    continue;
                }
                BlockRef ref;
                ref.x            = region.position[0] + x;
                ref.y            = region.position[1] + y;
                ref.z            = region.position[2] + z;
                ref.name         = entry.name;
                ref.properties   = &entry.properties;
                ref.paletteIndex = static_cast<std::size_t>(paletteIndex);
                if (!visit(ref)) {
                    return true;
                }
            }
        }
    }
    return true;
}

} // namespace litematicabe::core::schematic
