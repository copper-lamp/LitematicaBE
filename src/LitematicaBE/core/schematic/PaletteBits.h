#pragma once

#include <cstddef>

namespace litematicabe::core::schematic {

// Litematica（Masa）的 `BlockStates` 位宽规则：`max(2, ceil(log2(n)))`，
// 并对大调色板做下限修正（>256 至少 9 位、>512 至少 10 位）。
//
// 读端（`forEachBlock`）与写端（`LitematicWriter`）必须共用这一个函数：
// 任一边单独改公式，都会出现「自己写出来的文件自己读不出来」这种最难查的错位（调色板正好落在 257~512 项时最典型）。
[[nodiscard]] inline int bitsForPalette(std::size_t paletteSize) noexcept {
    int bits = 2;
    while ((static_cast<unsigned long long>(1) << bits) < paletteSize) {
        ++bits;
    }
    if (paletteSize > 256 && bits < 9) {
        bits = 9;
    }
    if (paletteSize > 512 && bits < 10) {
        bits = 10;
    }
    return bits;
}

} // namespace litematicabe::core::schematic
