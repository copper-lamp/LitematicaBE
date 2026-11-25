#include "LitematicaBE/core/schematic/McstructureFile.h"

#include "LitematicaBE/core/nbt/NbtTag.h"

#include <algorithm>
#include <cstdint>
#include <string>

namespace litematicabe::core::schematic {

namespace {

using nbt::Tag;
using nbt::TagType;

std::string tagString(Tag const* tag) {
    return tag != nullptr && tag->type == TagType::String ? tag->stringValue : std::string{};
}

std::string stripNamespace(std::string const& key) {
    constexpr std::string_view kPrefix = "minecraft:";
    if (key.size() > kPrefix.size() && key.compare(0, kPrefix.size(), kPrefix) == 0) {
        return key.substr(kPrefix.size());
    }
    return key;
}

// 状态值统一字符串化（基岩侧可能是 byte/int/string/float）。
std::string valueToString(Tag const* tag) {
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

// 名字归一化：Bedrock 的 "flowing_water" 在映射表里是 "water"。
std::string normaliseName(std::string const& name) {
    if (name == "minecraft:flowing_water") {
        return "minecraft:water";
    }
    if (name == "minecraft:flowing_lava") {
        return "minecraft:lava";
    }
    return name;
}

// 读 Int 列表（TAG_List<Int> 或 TAG_IntArray 都认）。
std::vector<std::int32_t> readIntList(Tag const* tag) {
    std::vector<std::int32_t> out;
    if (tag == nullptr) {
        return out;
    }
    if (tag->type == TagType::List) {
        out.reserve(tag->list.size());
        for (auto const& item : tag->list) {
            if (item) {
                out.push_back(static_cast<std::int32_t>(item->intValue));
            }
        }
    } else if (tag->type == TagType::IntArray) {
        out.reserve(tag->longArray.size());
        for (auto const value : tag->longArray) {
            out.push_back(static_cast<std::int32_t>(value));
        }
    }
    return out;
}

// palette 有两种形态：新版 `{default: {...}}`，旧版 `[{...}]`。
Tag const* paletteBody(Tag const* palette) {
    if (palette == nullptr) {
        return nullptr;
    }
    if (palette->type == TagType::List) {
        return palette->list.empty() ? nullptr : palette->list.front().get();
    }
    if (palette->type == TagType::Compound) {
        for (auto const& [key, value] : palette->compound) {
            (void)key;
            return value.get();
        }
    }
    return nullptr;
}

} // namespace

ReadError readMcstructure(std::filesystem::path const& file, McstructureFile& out) {
    ReadError error;

    // .mcstructure 是小端 NBT；部分工具会 gzip，parseFile 内部已经处理。
    auto parsed = nbt::parseFile(file, nbt::Endian::Little);
    if (!parsed.ok()) {
        error.message = parsed.error;
        return error;
    }

    auto const* root = parsed.root.get();
    if (root == nullptr || !root->isCompound()) {
        error.message = "根标签不是 Compound";
        return error;
    }

    out.formatVersion = root->find("format_version") ? root->find("format_version")->asInt() : 0;

    auto const size = readIntList(root->find("size"));
    if (size.size() < 3) {
        error.message = "缺少 size";
        return error;
    }
    out.size[0] = size[0];
    out.size[1] = size[1];
    out.size[2] = size[2];

    auto const origin = readIntList(root->find("structure_world_origin"));
    if (origin.size() >= 3) {
        out.origin[0] = origin[0];
        out.origin[1] = origin[1];
        out.origin[2] = origin[2];
    }

    auto const* structure = root->find("structure");
    if (structure == nullptr || !structure->isCompound()) {
        error.message = "缺少 structure（不是 .mcstructure 文件？）";
        return error;
    }

    // palette（可能挂在 structure 下，也可能在 palette 条目里）
    auto const* body = paletteBody(structure->find("palette"));
    if (body == nullptr) {
        body = structure;
    }

    auto const* blockPalette = body->find("block_palette");
    if (blockPalette == nullptr || blockPalette->type != TagType::List) {
        error.message = "缺少 block_palette";
        return error;
    }

    out.palette.reserve(blockPalette->list.size());
    for (auto const& item : blockPalette->list) {
        if (item == nullptr) {
            continue;
        }
        McstructureFile::PaletteEntry entry;
        entry.name       = tagString(item->find("name"));
        entry.renderName = normaliseName(entry.name);

        if (auto const* states = item->find("states"); states != nullptr && states->isCompound()) {
            entry.states.reserve(states->compound.size());
            for (auto const& [key, value] : states->compound) {
                // 键保留原样：Bedrock 结构文件里状态键混用两套命名空间
            // （minecraft:cardinal_direction 与裸 upside_down_bit 并存），strip 掉会让放置时无法还原成注册表认的那一个。
            entry.states.emplace_back(key, valueToString(value.get()));
            }
            std::sort(
                entry.states.begin(),
                entry.states.end(),
                [](auto const& a, auto const& b) { return a.first < b.first; }
            );
        }
        if (out.dataVersion == 0) {
            if (auto const* version = item->find("version"); version != nullptr) {
                out.dataVersion = version->asInt();
            }
        }
        out.palette.push_back(std::move(entry));
    }

    // block_indices：两层
    auto const* indices = structure->find("block_indices");
    if (indices == nullptr) {
        indices = body->find("block_indices");
    }
    if (indices == nullptr || indices->type != TagType::List || indices->list.empty()) {
        error.message = "缺少 block_indices";
        return error;
    }
    out.blocks = readIntList(indices->list[0].get());
    if (indices->list.size() > 1) {
        out.liquids = readIntList(indices->list[1].get());
    }

    if (out.blocks.empty()) {
        error.message = "block_indices[0] 为空";
        return error;
    }

    auto const expected = static_cast<std::size_t>(out.size[0]) * static_cast<std::size_t>(out.size[1])
                        * static_cast<std::size_t>(out.size[2]);
    if (out.blocks.size() < expected) {
        error.message = "block_indices 长度小于 size 体积（文件损坏？）";
        return error;
    }

    if (auto const* positionData = body->find("block_position_data"); positionData != nullptr) {
        out.blockEntityData = positionData->compound.size();
    }
    if (auto const* entities = structure->find("entities"); entities != nullptr && entities->type == TagType::List) {
        out.entityCount = entities->list.size();
    }

    return error;
}

bool forEachBlock(McstructureFile const& file, std::function<bool(BlockRef const&)> const& visit) {
    auto const sizeX = file.size[0];
    auto const sizeY = file.size[1];
    auto const sizeZ = file.size[2];
    if (sizeX <= 0 || sizeY <= 0 || sizeZ <= 0 || file.palette.empty()) {
        return false;
    }

    // index = x·sizeZ·sizeY + y·sizeZ + z（z 最快），与旧实现一致。
    auto const planeYZ = static_cast<std::size_t>(sizeZ) * static_cast<std::size_t>(sizeY);
    auto const zy      = static_cast<std::size_t>(sizeZ);

    for (std::size_t index = 0; index < file.blocks.size(); ++index) {
        auto pick = [&](std::vector<std::int32_t> const& layer) -> std::int32_t {
            if (index >= layer.size()) {
                return -1;
            }
            auto const value = layer[index];
            if (value < 0 || static_cast<std::size_t>(value) >= file.palette.size()) {
                return -1;
            }
            if (isAirOrVoid(file.palette[static_cast<std::size_t>(value)].name)) {
                return -1;
            }
            return value;
        };

        auto value = pick(file.blocks);
        if (value < 0) {
            value = pick(file.liquids); // 主层为空 → 用液体层
        }
        if (value < 0) {
            continue;
        }

        auto const& entry = file.palette[static_cast<std::size_t>(value)];

        BlockRef ref;
        ref.x            = static_cast<std::int32_t>(index / planeYZ);
        ref.y            = static_cast<std::int32_t>((index / zy) % static_cast<std::size_t>(sizeY));
        ref.z            = static_cast<std::int32_t>(index % zy);
        ref.name         = entry.renderName;
        ref.properties   = &entry.states;
        ref.paletteIndex = static_cast<std::size_t>(value);

        if (!visit(ref)) {
            return true;
        }
    }
    return true;
}

} // namespace litematicabe::core::schematic
