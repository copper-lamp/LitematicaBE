#include "LitematicaBE/core/place/PlaceGuard.h"

#include "mc/nbt/ByteTag.h"
#include "mc/nbt/CompoundTag.h"
#include "mc/nbt/ListTag.h"
#include "mc/nbt/StringTag.h"
#include "mc/nbt/Tag.h"
#include "mc/nbt/UniqueTagPtr.h"
#include "mc/world/actor/player/Inventory.h"
#include "mc/world/item/Item.h"
#include "mc/world/item/ItemStack.h"
#include "mc/world/item/ItemStackBase.h"
#include "mc/world/level/block/Block.h"
#include "mc/world/level/block/BlockType.h"
#include "mc/world/level/block/actor/BlockActorType.h"

#include <algorithm>
#include <array>
#include <cstddef>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>

namespace litematicabe::core::place {

namespace {

bool nameHas(std::string_view haystack, std::string_view needle) {
    return haystack.find(needle) != std::string_view::npos;
}

// `BlockType` 是注册表单例，生命周期等于进程 —— 指针做键即可。
std::unordered_map<::BlockType const*, RiskBits> gRiskCache;

RiskBits computeRisk(::BlockType const& type) {
    RiskBits bits;

    // 有方块实体：`BlockItem::_useOn` 在写入之后还会按原物品做实体/数据后处理，
    // 程序化放置会错配，直接不碰。
    if (type.mBlockEntityType != ::BlockActorType::Undefined) {
        bits.blockEntity = true;
    }

    auto const& name = type.getTypeName();

    // 流体本轮不纳入放置范围。
    if (nameHas(name, "water") || nameHas(name, "lava") || nameHas(name, "flowing")) {
        bits.fluid = true;
    }

    // 多格方块：一次放置会写两格，逐格改写会拼出「目标方块 + 原方块残肢」。
    if (nameHas(name, "door") || name == "minecraft:bed" || nameHas(name, "double_plant")) {
        bits.multiblock = true;
    }
    if (name == "minecraft:tall_grass" || name == "minecraft:large_fern" || name == "minecraft:sunflower"
        || name == "minecraft:lilac" || name == "minecraft:rose_bush" || name == "minecraft:peony") {
        bits.multiblock = true;
    }

    return bits;
}

// 可顶替物品类型表：投影打印机在 `onlyAir=false` 时允许覆盖这些方块。
// 不收藤蔓 / 睡莲 / 甘蔗 / 珊瑚扇（它们是玩家可能故意保留的装饰），要顶掉请用配置的 `extraReplaceable` 显式追加。
constexpr std::string_view kReplaceable[] = {
    "minecraft:short_grass",    "minecraft:grass",          "minecraft:tallgrass",
    "minecraft:fern",           "minecraft:large_fern",     "minecraft:double_plant",
    "minecraft:snow_layer",     "minecraft:deadbush",       "minecraft:seagrass",
    "minecraft:kelp",           "minecraft:kelp_top",       "minecraft:fire",
    "minecraft:soul_fire",      "minecraft:structure_void", "minecraft:light_block",
    "minecraft:brown_mushroom", "minecraft:red_mushroom",   "minecraft:mushroom",
    "minecraft:cave_vines",     "minecraft:glow_lichen",    "minecraft:short_dry_grass",
    "minecraft:tall_dry_grass", "minecraft:bush",           "minecraft:firefly_bush",
    "minecraft:leaf_litter",    "minecraft:wildflowers",    "minecraft:pale_moss_carpet",
};

} // namespace

// ─────────────────────────── 潜影盒 ───────────────────────────
//
// 潜影盒的内容不在容器槽位里：槽位上只有一个物品栈，东西放在该栈的 `mUserData`（物品 NBT）中。
//
// 结构：{ Items: [ { Name: "minecraft:stone", Count: 5b, Damage: 0s, Slot: 0b }, ... ] }
// 往根层写 Items 会被引擎丢弃、写进 tag.Items 才保留。
// 少数导出工具/附加包会按 Java 习惯包一层 `BlockEntityTag`。
// 全部实时解析。

namespace {

// 潜影盒 NBT 里的内容列表（只读）。
::ListTag const* containerItemsOf(::CompoundTag const* root) {
    if (root == nullptr) {
        return nullptr;
    }
    if (root->contains("Items", ::Tag::Type::List)) {
        return &root->at("Items").get<::ListTag>();
    }
    if (root->contains("BlockEntityTag", ::Tag::Type::Compound)) {
        auto const& inner = root->at("BlockEntityTag").get<::CompoundTag>();
        if (inner.contains("Items", ::Tag::Type::List)) {
            return &inner.at("Items").get<::ListTag>();
        }
    }
    return nullptr;
}

// 潜影盒 NBT 里的内容列表（可写）。
::ListTag* mutableContainerItemsOf(::CompoundTag* root) {
    if (root == nullptr) {
        return nullptr;
    }
    if (root->contains("Items", ::Tag::Type::List)) {
        return &root->at("Items").get<::ListTag>();
    }
    if (root->contains("BlockEntityTag", ::Tag::Type::Compound)) {
        auto& inner = root->at("BlockEntityTag").get<::CompoundTag>();
        if (inner.contains("Items", ::Tag::Type::List)) {
            return &inner.at("Items").get<::ListTag>();
        }
    }
    return nullptr;
}

::CompoundTag const* asEntry(::UniqueTagPtr const& tag) {
    if (!tag || tag->getId() != ::Tag::Type::Compound) {
        return nullptr;
    }
    return static_cast<::CompoundTag const*>(tag.get());
}

::CompoundTag* asMutableEntry(::UniqueTagPtr const& tag) { return const_cast<::CompoundTag*>(asEntry(tag)); }

// `Items` 里一项的方块 ID。基岩版字段名是 `Name`，个别工具会写成 `id`。
std::string_view entryName(::CompoundTag const& entry) {
    if (entry.contains("Name", ::Tag::Type::String)) {
        return entry.at("Name").get<::StringTag>();
    }
    if (entry.contains("id", ::Tag::Type::String)) {
        return entry.at("id").get<::StringTag>();
    }
    return {};
}

// `Items` 里一项的数量。基岩版规范是 Byte，工具产物可能是 Short/Int，都读得下。
int entryCount(::CompoundTag const& entry) {
    if (entry.contains("Count", ::Tag::Type::Byte)) {
        return static_cast<int>(entry.at("Count").get<::ByteTag>());
    }
    if (entry.contains("Count", ::Tag::Type::Short)) {
        return static_cast<int>(entry.at("Count").get<::ShortTag>());
    }
    if (entry.contains("Count", ::Tag::Type::Int)) {
        return static_cast<int>(entry.at("Count").get<::IntTag>());
    }
    return 0;
}

// 这个物品栈是不是潜影盒。基岩版没有「容器物品」标记，按方块类型名匹配。
bool isShulkerStack(::ItemStackBase const& stack) {
    if (stack.isNull() || stack.mCount == 0 || stack.mUserData == nullptr) {
        return false;
    }
    auto const* item = stack.getItem();
    if (item == nullptr) {
        return false;
    }
    auto const* type = item->mBlockType->get();
    return type != nullptr && nameHas(type->getTypeName(), "shulker_box");
}

// 从潜影盒里扣 `want` 个 `type`，返回实扣数量。
//
// 在 `userData` 的**副本**上改，全部成功才整体写回：中途任何一步不成立都不会破坏原 NBT。
int takeFromContainer(::ItemStackBase& stack, ::BlockType const& type, int want) {
    if (want <= 0 || !isShulkerStack(stack)) {
        return 0;
    }

    auto                           cloned = stack.mUserData->copy();
    std::unique_ptr<::CompoundTag> owned{static_cast<::CompoundTag*>(cloned.release())};
    if (owned == nullptr) {
        return 0;
    }

    ::ListTag* list = mutableContainerItemsOf(owned.get());
    if (list == nullptr) {
        return 0;
    }

    auto const& wantName  = type.getTypeName();
    int         remaining = want;

    for (std::size_t i = 0; i < list->size() && remaining > 0;) {
        auto* entry = asMutableEntry((*list)[i]);
        if (entry == nullptr || entryName(*entry) != wantName) {
            ++i;
            continue;
        }
        int const have = entryCount(*entry);
        if (have <= 0) {
            ++i;
            continue;
        }
        int const take = std::min(remaining, have);
        if (take >= have) {
            list->erase(list->begin() + static_cast<std::ptrdiff_t>(i)); // 扣空就整项移除
        } else {
            entry->at("Count") = ::ByteTag(static_cast<schar>(have - take));
            ++i;
        }
        remaining -= take;
    }

    int const taken = want - remaining;
    if (taken <= 0) {
        return 0;
    }
    stack.setUserData(std::move(owned));
    return taken;
}

} // namespace

RiskBits const& riskBitsOf(::BlockType const& type) {
    if (auto const it = gRiskCache.find(&type); it != gRiskCache.end()) {
        return it->second;
    }
    return gRiskCache.emplace(&type, computeRisk(type)).first->second;
}

bool isRiskyType(::BlockType const& type, RiskFilter filter) {
    auto const& bits = riskBitsOf(type);
    return (filter.blockEntity && bits.blockEntity) || (filter.multiblock && bits.multiblock)
        || (filter.fluid && bits.fluid);
}

bool isFluidType(::BlockType const& type) { return riskBitsOf(type).fluid; }

bool stackIsBlockType(::ItemStackBase const& stack, ::BlockType const& type) {
    if (stack.isNull() || stack.mCount == 0) {
        return false;
    }
    if (stack.mBlock != nullptr && &stack.mBlock->getBlockType() == &type) {
        return true;
    }
    auto const* item = stack.getItem();
    return item != nullptr && item->mBlockType->get() == &type;
}

int findBlockItemSlot(::Inventory& inv, ::BlockType const& type, int preferSlot) {
    int const size = inv.getContainerSize();

    if (preferSlot >= 0 && preferSlot < size && stackIsBlockType(inv.getItem(preferSlot), type)) {
        return preferSlot;
    }
    for (int i = 0; i < size; ++i) {
        if (i == preferSlot) {
            continue;
        }
        if (stackIsBlockType(inv.getItem(i), type)) {
            return i;
        }
    }
    return -1;
}

int countBlockItem(::Inventory& inv, ::BlockType const& type, int skipSlot) {
    int const size  = inv.getContainerSize();
    int       total = 0;
    for (int i = 0; i < size; ++i) {
        if (i == skipSlot) {
            continue;
        }
        auto const& stack = inv.getItem(i);
        if (stackIsBlockType(stack, type)) {
            total += static_cast<int>(stack.mCount);
            continue;
        }
        // 潜影盒：内容在物品 NBT 里，实时解析（不缓存）
        total += countInContainer(stack, type);
    }
    return total;
}

bool isContainerStack(::ItemStackBase const& stack) { return isShulkerStack(stack); }

int countInContainer(::ItemStackBase const& stack, ::BlockType const& type) {
    if (!isShulkerStack(stack)) {
        return 0;
    }
    auto const* list = containerItemsOf(stack.mUserData.get());
    if (list == nullptr) {
        return 0;
    }

    auto const& wantName = type.getTypeName();
    int         total    = 0;
    for (std::size_t i = 0; i < list->size(); ++i) {
        auto const* entry = asEntry((*list)[i]);
        if (entry == nullptr || entryName(*entry) != wantName) {
            continue;
        }
        total += entryCount(*entry);
    }
    return total;
}

int takeBlockItem(::Inventory& inv, ::BlockType const& type, int want, int skipSlot) {
    if (want <= 0) {
        return 0;
    }
    int const size      = inv.getContainerSize();
    int       remaining = want;

    // 1) 先扣直接放在槽位里的方块物品（不碰 NBT，代价最低）
    for (int i = 0; i < size && remaining > 0; ++i) {
        if (i == skipSlot) {
            continue;
        }
        auto const& stack = inv.getItem(i);
        if (!stackIsBlockType(stack, type)) {
            continue;
        }
        int const have = static_cast<int>(stack.mCount);
        int const take = std::min(remaining, have);
        if (take >= have) {
            inv.removeItem(i, take);
        } else {
            const_cast<::ItemStack&>(stack).mCount = static_cast<uchar>(have - take);
        }
        remaining -= take;
    }

    // 2) 不够再从潜影盒里掏（每次实时读写 NBT，不缓存）
    for (int i = 0; i < size && remaining > 0; ++i) {
        if (i == skipSlot) {
            continue;
        }
        auto const& stack = inv.getItem(i);
        if (!isShulkerStack(stack)) {
            continue;
        }
        remaining -= takeFromContainer(const_cast<::ItemStack&>(stack), type, remaining);
    }

    return want - remaining;
}

bool isReplaceableForPrint(::Block const& block, std::string_view const* extra, unsigned extraCount) {
    if (block.isAir()) {
        return true;
    }

    auto const& type = block.getBlockType();
    if (isFluidType(type)) {
        return true;
    }

    auto const& name = type.getTypeName();
    for (auto const& candidate : kReplaceable) {
        if (name == candidate) {
            return true;
        }
    }
    for (unsigned i = 0; i < extraCount; ++i) {
        if (extra[i].empty()) {
            continue;
        }
        if (name == extra[i]) {
            return true;
        }
    }
    return false;
}

} // namespace litematicabe::core::place
