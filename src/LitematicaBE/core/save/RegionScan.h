#pragma once

#include "LitematicaBE/core/nbt/NbtTag.h"
#include "LitematicaBE/selection/SelectionStore.h"

#include <cstdint>
#include <string>
#include <utility>
#include <vector>

class Block;
class BlockSource;

namespace litematicabe::core::save {

// 一条基岩方块状态：键 + 文本值 + NBT 类型。
// `.mcstructure` 的 `states` 值带类型（`upside_down_bit` 是 Byte、`facing_direction` 是 Int、`minecraft:cardinal_direction` 是 String）。
struct StateValue {
    std::string  key;
    std::string  value;
    std::uint8_t tagType{3}; // `nbt::TagType`：1=Byte 3=Int 8=String
};

// 调色板条目：方块名 + 状态集合。
struct PaletteSlot {
    std::string             name;
    std::vector<StateValue> states;
};

// 扫描统计（命令回显与排查用）。
struct ScanStats {
    std::uint64_t scanned{};
    std::uint64_t nonAir{};
    std::uint64_t entities{};
    std::uint64_t stateFallback{};    // 状态值只能按整型兜底的格数（类型可能不保真）
    std::size_t   paletteSize{};
    std::size_t   loadedChunks{};
    std::size_t   failedChunks{};
    std::vector<std::string> samples; // 前几条异常样例（名字/状态），便于补映射
    std::string              error;
};

// 一次选区扫描的结果。
// 内存形态刻意做成「调色板 + 满网格 int32」，而不是每格一个结构体：
// 一百万格的选区按结构体存要上百 MB，按网格只有 4 MB，而且两种格式都能直接从这里取数。
struct RegionScan {
    std::int32_t sizeX{};
    std::int32_t sizeY{};
    std::int32_t sizeZ{};
    std::int32_t originX{};
    std::int32_t originY{};
    std::int32_t originZ{};
    std::int32_t dimid{};

    std::vector<PaletteSlot> palette; // 0 号固定是 minecraft:air
    std::vector<std::int32_t> grid;   // 满网格调色板下标；-1 = 空气/结构空
    // 方块实体（箱子/告示牌等内容）：网格下标 → NBT 子树。
    std::vector<std::pair<std::uint64_t, nbt::TagPtr>> blockEntities;

    ScanStats stats;

    [[nodiscard]] std::uint64_t volume() const noexcept {
        return static_cast<std::uint64_t>(sizeX) * static_cast<std::uint64_t>(sizeY)
             * static_cast<std::uint64_t>(sizeZ);
    }

    // `.mcstructure` 的线性下标：`x·sizeZ·sizeY + y·sizeZ + z`（z 最快）。
    [[nodiscard]] std::uint64_t gridIndex(std::int32_t x, std::int32_t y, std::int32_t z) const noexcept {
        return static_cast<std::uint64_t>(x) * static_cast<std::uint64_t>(sizeY)
                 * static_cast<std::uint64_t>(sizeZ)
             + static_cast<std::uint64_t>(y) * static_cast<std::uint64_t>(sizeZ)
             + static_cast<std::uint64_t>(z);
    }

    // 世界坐标 → 网格下标（越界返回 false）。
    [[nodiscard]] bool indexOf(std::int32_t wx, std::int32_t wy, std::int32_t wz, std::uint64_t& out) const;
};

struct ScanOptions {
    bool        includeBlockEntities{true};
    std::size_t maxBlocks{0}; // 0 = 不限（调用方已按体积上限检查过）
};

// 扫描一个选区。
// 前置：区块会被主动拉起（BDS 对未加载区块的读会给出空气，导出就缺洞）。
// 线程：只在服务端主线程调用（`getBlock` / `getBlockEntity` 都不线程安全）。
bool scanRegion(::BlockSource& source, selection::Box const& box, ScanOptions const& options, RegionScan& out);

// 单个方块的状态提取（`/lit savediag` 诊断用，也供 `scanRegion` 内部复用）。
// `usedFallback` 为 true 表示至少有一条状态没能从引擎拿到带类型的值，只能按整型写。这条信息决定了 `.mcstructure` 里的状态类型是否保真。
void probeBlockStates(::Block const& block, std::vector<StateValue>& out, bool& usedFallback);

} // namespace litematicabe::core::save
