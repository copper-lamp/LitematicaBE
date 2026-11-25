#include "LitematicaBE/core/save/RegionScan.h"

#include "LitematicaBE/core/nbt/NbtWriter.h"
#include "LitematicaBE/core/schematic/LitematicFile.h" // isAirOrVoid

#include "mc/nbt/ByteArrayTag.h"
#include "mc/nbt/ByteTag.h"
#include "mc/nbt/CompoundTag.h"
#include "mc/nbt/CompoundTagVariant.h"
#include "mc/nbt/DoubleTag.h"
#include "mc/nbt/FloatTag.h"
#include "mc/nbt/Int64Tag.h"
#include "mc/nbt/IntArrayTag.h"
#include "mc/nbt/IntTag.h"
#include "mc/nbt/ListTag.h"
#include "mc/nbt/ShortTag.h"
#include "mc/nbt/StringTag.h"
#include "mc/nbt/Tag.h"

#include "mc/world/item/SaveContext.h"
#include "mc/world/level/BlockPos.h"
#include "mc/world/level/BlockSource.h"
#include "mc/world/level/ChunkPos.h"
#include "mc/world/level/block/Block.h"
#include "mc/world/level/block/BlockType.h"
#include "mc/world/level/block/actor/BlockActor.h"
#include "mc/world/level/block/states/BlockState.h"
#include "mc/world/level/block/states/BlockStateInstance.h"
#include "mc/world/level/chunk/ChunkSource.h"

#include <algorithm>
#include <cstdio>
#include <string>
#include <unordered_map>
#include <utility>

namespace litematicabe::core::save {

namespace {

namespace nb = litematicabe::core::nbt;

// 基岩版世界高度：超出的 y 不去 `getBlock`（那些格按空气处理）。
constexpr std::int32_t kMinY = -64;
constexpr std::int32_t kMaxY = 320;

// 诊断样例上限：够定位问题就行，不要刷屏。
constexpr std::size_t kMaxSamples = 6;

std::string floatText(double value) {
    char buf[40]{};
    std::snprintf(buf, sizeof(buf), "%g", value);
    return buf;
}

// 方块注册名。`BlockType::getTypeName()` 在不同版本里可能带/不带命名空间，
// 这里统一补成 `minecraft:xxx`，两种形态都能得到结构文件要的名字。
std::string blockNameOf(::Block const& block) {
    std::string name = block.getTypeName();
    if (name.empty()) {
        auto const& info = block.getBlockType().mNameInfo.get();
        name             = info.mFullName.get().getString();
    }
    if (name.empty()) {
        return {};
    }
    if (name.find(':') == std::string::npos) {
        name.insert(0, "minecraft:");
    }
    return name;
}

// BDS 的 Tag → 本项目的 Tag 树（写方块实体 NBT 用）。
nb::TagPtr convertTag(::Tag const& tag) {
    switch (tag.getId()) {
    case ::Tag::Byte:
        return nb::makeByte(tag.as<::ByteTag>().data);
    case ::Tag::Short:
        return nb::makeShort(tag.as<::ShortTag>().data);
    case ::Tag::Int:
        return nb::makeInt(tag.as<::IntTag>().data);
    case ::Tag::Int64:
        return nb::makeLong(tag.as<::Int64Tag>().data);
    case ::Tag::Float:
        return nb::makeFloat(tag.as<::FloatTag>().data);
    case ::Tag::Double:
        return nb::makeDouble(tag.as<::DoubleTag>().data);
    case ::Tag::ByteArray: {
        auto const& array = tag.as<::ByteArrayTag>();
        std::vector<std::uint8_t> bytes;
        bytes.reserve(array.size());
        for (auto const value : array) {
            bytes.push_back(static_cast<std::uint8_t>(value));
        }
        return nb::makeByteArray(std::move(bytes));
    }
    case ::Tag::String:
        return nb::makeString(static_cast<std::string const&>(tag.as<::StringTag>()));
    case ::Tag::List: {
        auto const& list = tag.as<::ListTag>();
        auto        out  = nb::makeList(static_cast<nb::TagType>(static_cast<std::uint8_t>(list.mType)));
        out->list.reserve(list.size());
        for (auto const& item : list) {
            if (!item) {
                continue;
            }
            out->list.push_back(convertTag(*item));
        }
        return out;
    }
    case ::Tag::Compound: {
        auto const& compound = tag.as<::CompoundTag>();
        auto        out      = nb::makeCompound();
        for (auto const& [key, variant] : compound.mTags) {
            auto child = convertTag(variant.get());
            if (child) {
                out->compound.emplace(key, std::move(child));
            }
        }
        return out;
    }
    case ::Tag::IntArray: {
        auto const& array = tag.as<::IntArrayTag>();
        std::vector<std::int32_t> values;
        values.reserve(array.size());
        for (auto const value : array) {
            values.push_back(value);
        }
        return nb::makeIntArray(std::move(values));
    }
    case ::Tag::End:
    default:
        return nullptr;
    }
}

// 调色板去重键：名字 + 状态（带类型，避免 Byte 1 与 Int 1 被合并）。
std::string paletteKeyOf(PaletteSlot const& slot) {
    std::string key = slot.name;
    for (auto const& state : slot.states) {
        key += '|';
        key += state.key;
        key += '=';
        key += std::to_string(static_cast<int>(state.tagType));
        key += ':';
        key += state.value;
    }
    return key;
}

// 方块实体：读出来转成本项目的 NBT 树；没有实体或读失败返回空。
nb::TagPtr readBlockEntity(::BlockSource& source, ::BlockPos const& pos, ScanStats& stats) {
    auto const* actor = source.getBlockEntity(pos);
    if (actor == nullptr) {
        return nullptr;
    }

    ::CompoundTag tag;
    ::SaveContext context{};
    context.mSaveUseCase = ::SaveContext::SaveUseCase::SaveToDisk;
    if (!actor->save(tag, context)) {
        return nullptr;
    }
    if (tag.empty()) {
        return nullptr;
    }

    auto converted = convertTag(tag);
    if (converted) {
        ++stats.entities;
    }
    return converted;
}

void pushSample(ScanStats& stats, std::string text) {
    if (stats.samples.size() < kMaxSamples) {
        stats.samples.push_back(std::move(text));
    }
}

} // namespace

bool RegionScan::indexOf(std::int32_t wx, std::int32_t wy, std::int32_t wz, std::uint64_t& out) const {
    auto const x = wx - originX;
    auto const y = wy - originY;
    auto const z = wz - originZ;
    if (x < 0 || y < 0 || z < 0 || x >= sizeX || y >= sizeY || z >= sizeZ) {
        return false;
    }
    out = gridIndex(x, y, z);
    return true;
}

void probeBlockStates(::Block const& block, std::vector<StateValue>& out, bool& usedFallback) {
    out.clear();
    usedFallback = false;

    auto const& type   = block.getBlockType();
    auto const  data   = block.getData();
    auto const& states = *type.mStates;
    out.reserve(states.size());

    for (auto const& [id, instance] : states) {
        (void)id;
        // `TypedStorage<…, BlockState const*>` 对指针是「直接就是指针」（见 ll/api/base/Alias.h 的
        // TypedStorageType 特化），所以这里不需要 `.get()`。
        auto const* state = instance.mState;
        if (state == nullptr) {
            continue;
        }
        std::string key = state->mName.get().getString();
        if (key.empty()) {
            continue;
        }

        StateValue value;
        value.key = std::move(key);

        // 主路径：让引擎自己把这一条状态写成一个 NBT 项 —— 值和对的类型都是它给的
        // （`upside_down_bit` 是 Byte、`facing_direction` 是 Int、`cardinal_direction` 是 String）。
        ::CompoundTag probed;
        state->toNBT(probed, static_cast<int>(data));

        bool filled = false;
        if (probed.size() == 1) {
            auto const& variant = probed.mTags.begin()->second;
            switch (variant.getId()) {
            case ::Tag::Byte:
                value.value   = std::to_string(static_cast<int>(variant.get<::ByteTag>().data));
                value.tagType = static_cast<std::uint8_t>(nb::TagType::Byte);
                filled        = true;
                break;
            case ::Tag::Short:
                value.value   = std::to_string(static_cast<int>(variant.get<::ShortTag>().data));
                value.tagType = static_cast<std::uint8_t>(nb::TagType::Int);
                filled        = true;
                break;
            case ::Tag::Int:
                value.value   = std::to_string(variant.get<::IntTag>().data);
                value.tagType = static_cast<std::uint8_t>(nb::TagType::Int);
                filled        = true;
                break;
            case ::Tag::Int64:
                value.value   = std::to_string(static_cast<long long>(variant.get<::Int64Tag>().data));
                value.tagType = static_cast<std::uint8_t>(nb::TagType::Int);
                filled        = true;
                break;
            case ::Tag::Float:
                value.value   = floatText(variant.get<::FloatTag>().data);
                value.tagType = static_cast<std::uint8_t>(nb::TagType::Float);
                filled        = true;
                break;
            case ::Tag::Double:
                value.value   = floatText(variant.get<::DoubleTag>().data);
                value.tagType = static_cast<std::uint8_t>(nb::TagType::Double);
                filled        = true;
                break;
            case ::Tag::String:
                value.value   = static_cast<std::string const&>(variant.get<::StringTag>());
                value.tagType = static_cast<std::uint8_t>(nb::TagType::String);
                filled        = true;
                break;
            default:
                break;
            }
        }

        if (!filled) {
            // 兜底：值仍然是准的（按位域读），但类型只能写 Int。
            // 字符串型状态（朝向枚举）落到这条路上会被结构方块退回默认值，靠 `stateFallback` 计数暴露。
            auto const raw = instance.get<unsigned>(data);
            value.value    = std::to_string(raw);
            value.tagType  = static_cast<std::uint8_t>(nb::TagType::Int);
            usedFallback   = true;
        }

        out.push_back(std::move(value));
    }
}

bool scanRegion(::BlockSource& source, selection::Box const& box, ScanOptions const& options, RegionScan& out) {
    out = RegionScan{};
    out.dimid   = box.dimid;
    out.originX = box.minX;
    out.originY = box.minY;
    out.originZ = box.minZ;
    out.sizeX   = box.width();
    out.sizeY   = box.height();
    out.sizeZ   = box.depth();

    if (out.sizeX <= 0 || out.sizeY <= 0 || out.sizeZ <= 0) {
        out.stats.error = "选区尺寸非法（宽/高/深必须为正）";
        return false;
    }
    auto const volume = out.volume();
    if (options.maxBlocks > 0 && volume > options.maxBlocks) {
        out.stats.error = "选区超过单次上限（" + std::to_string(volume) + " 格 > " + std::to_string(options.maxBlocks)
                        + " 格）";
        return false;
    }

    // 0 号固定 air：两种格式的调色板都靠这个下标表示"空"。
    PaletteSlot air;
    air.name = "minecraft:air";
    out.palette.push_back(std::move(air));
    out.grid.assign(static_cast<std::size_t>(volume), -1);

    // ── 区块预加载 ──
    // BDS 对未加载区块的读会给出空气（不报错），不拉起来就会导出一堆洞。
    auto& chunks    = source.getChunkSource();
    auto const minCx = box.minX >> 4;
    auto const maxCx = box.maxX >> 4;
    auto const minCz = box.minZ >> 4;
    auto const maxCz = box.maxZ >> 4;
    for (auto cx = minCx; cx <= maxCx; ++cx) {
        for (auto cz = minCz; cz <= maxCz; ++cz) {
            auto chunk = chunks.$getOrLoadChunk(::ChunkPos{cx, cz}, ::ChunkSource::LoadMode::None, false);
            if (chunk) {
                ++out.stats.loadedChunks;
            } else {
                ++out.stats.failedChunks;
            }
        }
    }

    std::unordered_map<std::uint64_t, std::int32_t> comboToPalette;
    std::unordered_map<std::string, std::int32_t>   keyToPalette;
    keyToPalette.emplace(paletteKeyOf(out.palette[0]), 0);

    std::vector<StateValue> stateBuffer;

    for (std::int32_t y = box.minY; y <= box.maxY; ++y) {
        if (y < kMinY || y >= kMaxY) {
            continue; // 世界外的 y：整层按空气
        }
        for (std::int32_t z = box.minZ; z <= box.maxZ; ++z) {
            for (std::int32_t x = box.minX; x <= box.maxX; ++x) {
                ++out.stats.scanned;
                ::BlockPos const pos{x, y, z};
                auto const&      block = source.getBlock(pos);

                auto const name = blockNameOf(block);
                if (name.empty() || schematic::isAirOrVoid(name)) {
                    continue;
                }

                auto const gridAt = out.gridIndex(x - box.minX, y - box.minY, z - box.minZ);

                // 同一种 BlockType + 同一份 mData 必定是同一套状态：只提取一次。
                auto const comboKey = reinterpret_cast<std::uint64_t>(&block.getBlockType()) * 0x9E3779B97F4A7C15ull
                                    + block.getData();

                std::int32_t paletteIndex = -1;
                if (auto const it = comboToPalette.find(comboKey); it != comboToPalette.end()) {
                    paletteIndex = it->second;
                } else {
                    bool usedFallback = false;
                    probeBlockStates(block, stateBuffer, usedFallback);

                    PaletteSlot slot;
                    slot.name   = name;
                    slot.states = stateBuffer;

                    auto const key = paletteKeyOf(slot);
                    if (auto const known = keyToPalette.find(key); known != keyToPalette.end()) {
                        paletteIndex = known->second;
                    } else {
                        paletteIndex = static_cast<std::int32_t>(out.palette.size());
                        keyToPalette.emplace(key, paletteIndex);
                        out.palette.push_back(std::move(slot));
                    }
                    comboToPalette.emplace(comboKey, paletteIndex);

                    if (usedFallback) {
                        ++out.stats.stateFallback;
                        std::string text = name;
                        for (auto const& state : stateBuffer) {
                            text += " ";
                            text += state.key;
                            text += '=';
                            text += state.value;
                        }
                        pushSample(out.stats, "状态类型兜底：" + text);
                    }
                }

                out.grid[static_cast<std::size_t>(gridAt)] = paletteIndex;
                ++out.stats.nonAir;

                if (options.includeBlockEntities) {
                    if (auto tag = readBlockEntity(source, pos, out.stats)) {
                        out.blockEntities.emplace_back(gridAt, std::move(tag));
                    }
                }
            }
        }
    }

    out.stats.paletteSize = out.palette.size();
    if (out.stats.nonAir == 0) {
        out.stats.error = "选区内没有非空气方块";
        return false;
    }
    return true;
}

} // namespace litematicabe::core::save
