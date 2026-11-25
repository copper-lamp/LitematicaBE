#include "LitematicaBE/core/schematic/McstructureWriter.h"

#include "LitematicaBE/core/nbt/NbtWriter.h"

#include <cstdint>
#include <cstdlib>
#include <string>
#include <utility>
#include <vector>

namespace litematicabe::core::schematic {

namespace {

namespace nb    = litematicabe::core::nbt;
namespace store = litematicabe::core::save;

// 一条状态按原类型写成 NBT 子标签（类型错了结构方块会退回默认状态）。
nb::TagPtr stateTag(store::StateValue const& state) {
    auto const type = static_cast<nb::TagType>(state.tagType);
    switch (type) {
    case nb::TagType::Byte:
        return nb::makeByte(std::strtoll(state.value.c_str(), nullptr, 10));
    case nb::TagType::Short:
        return nb::makeShort(std::strtoll(state.value.c_str(), nullptr, 10));
    case nb::TagType::Int:
        return nb::makeInt(std::strtoll(state.value.c_str(), nullptr, 10));
    case nb::TagType::Long:
        return nb::makeLong(std::strtoll(state.value.c_str(), nullptr, 10));
    case nb::TagType::Float:
        return nb::makeFloat(std::strtod(state.value.c_str(), nullptr));
    case nb::TagType::Double:
        return nb::makeDouble(std::strtod(state.value.c_str(), nullptr));
    case nb::TagType::String:
    default:
        return nb::makeString(state.value);
    }
}

} // namespace

McstructureBuild buildMcstructure(store::RegionScan const& scan, McstructureWriteOptions const& options) {
    McstructureBuild build;

    if (scan.sizeX <= 0 || scan.sizeY <= 0 || scan.sizeZ <= 0) {
        build.error = ".mcstructure 尺寸非法";
        return build;
    }
    auto const volume = scan.volume();
    if (scan.grid.size() != static_cast<std::size_t>(volume)) {
        build.error = "扫描网格与选区尺寸不一致";
        return build;
    }

    // ── 主层：网格下标 → palette 下标（-1 表示空气，写 0 号）──
    auto layer0 = nb::makeList(nb::TagType::Int);
    layer0->list.reserve(scan.grid.size());
    for (auto const index : scan.grid) {
        layer0->list.push_back(nb::makeInt(index < 0 ? 0 : index));
    }

    auto layers = nb::makeList(nb::TagType::List);
    layers->list.push_back(std::move(layer0));

    if (options.writeLiquidLayer) {
        // 第二层是液体层：没有液体时整层 -1（与旧项目一致，结构方块也认这种写法）。
        auto layer1 = nb::makeList(nb::TagType::Int);
        layer1->list.reserve(scan.grid.size());
        for (std::size_t i = 0; i < scan.grid.size(); ++i) {
            layer1->list.push_back(nb::makeInt(-1));
        }
        layers->list.push_back(std::move(layer1));
    }

    // ── block_palette ──
    auto palette = nb::makeList(nb::TagType::Compound);
    palette->list.reserve(scan.palette.size());
    for (auto const& slot : scan.palette) {
        auto entry = nb::makeCompound();
        nb::put(*entry, "name", nb::makeString(slot.name));

        auto states = nb::makeCompound();
        for (auto const& state : slot.states) {
            nb::put(*states, state.key, stateTag(state));
        }
        nb::put(*entry, "states", std::move(states));
        nb::put(*entry, "version", nb::makeInt(options.blockVersion));
        palette->list.push_back(std::move(entry));
    }

    // ── block_position_data（方块实体）──
    auto positionData = nb::makeCompound();
    for (auto const& [index, tag] : scan.blockEntities) {
        if (!tag) {
            continue;
        }
        auto holder = nb::makeCompound();
        nb::put(*holder, "block_entity_data", tag);
        nb::put(*positionData, std::to_string(index), std::move(holder));
        ++build.entityBlocks;
    }

    auto paletteDefault = nb::makeCompound();
    nb::put(*paletteDefault, "block_palette", std::move(palette));
    nb::put(*paletteDefault, "block_position_data", std::move(positionData));

    auto paletteRoot = nb::makeCompound();
    nb::put(*paletteRoot, "default", std::move(paletteDefault));

    auto structure = nb::makeCompound();
    nb::put(*structure, "block_indices", std::move(layers));
    nb::put(*structure, "entities", nb::makeList(nb::TagType::Compound));
    nb::put(*structure, "palette", std::move(paletteRoot));

    auto size = nb::makeList(nb::TagType::Int);
    size->list.push_back(nb::makeInt(scan.sizeX));
    size->list.push_back(nb::makeInt(scan.sizeY));
    size->list.push_back(nb::makeInt(scan.sizeZ));

    auto origin = nb::makeList(nb::TagType::Int);
    origin->list.push_back(nb::makeInt(scan.originX));
    origin->list.push_back(nb::makeInt(scan.originY));
    origin->list.push_back(nb::makeInt(scan.originZ));

    auto root = nb::makeCompound();
    nb::put(*root, "format_version", nb::makeInt(options.formatVersion));
    nb::put(*root, "size", std::move(size));
    nb::put(*root, "structure", std::move(structure));
    nb::put(*root, "structure_world_origin", std::move(origin));

    build.bytes = nb::serialize(*root, nb::Endian::Little);
    if (build.bytes.empty()) {
        build.error = "NBT 序列化失败（结构不合法）";
        return build;
    }
    build.paletteSize = scan.palette.size();
    return build;
}

bool writeMcstructureFile(
    std::filesystem::path const&   file,
    store::RegionScan const&       scan,
    McstructureWriteOptions const& options,
    std::string&                   error,
    std::size_t*                   bytesOut,
    std::size_t*                   paletteOut,
    std::size_t*                   entityOut
) {
    auto const build = buildMcstructure(scan, options);
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
    if (entityOut != nullptr) {
        *entityOut = build.entityBlocks;
    }
    return true;
}

} // namespace litematicabe::core::schematic
