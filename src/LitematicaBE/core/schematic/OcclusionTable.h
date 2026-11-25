#pragma once

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace litematicabe::core::schematic {

// 遮挡判定表：回答「这个方块能不能遮住邻居的面」。
// 数据在 `resources/data/occlusion.json`（`lit-tools occlusion` 生成），C++ 里没有方块知识：加方块/调判定只改表。
//
// 规则优先级：
//   1. `transparent` 里列出的名字 → 不遮挡（玻璃、楼梯、半砖、栅栏、门、树叶……）；
//   2. `patterns.suffixes` / `patterns.contains` 命中 → 不遮挡（兜底新方块）；
//   3. 其它 → 按 `defaultOccludes`（默认 true，即完整方块遮挡）。
class OcclusionTable {
public:
    static OcclusionTable& getInstance();

    bool ensureLoaded();
    bool load(std::filesystem::path const& file);

    // true = 该 Java 方块遮挡相邻面。
    bool occludes(std::string_view javaName);

    [[nodiscard]] bool loaded() const noexcept { return mLoaded; }
    [[nodiscard]] std::string const& lastError() const noexcept { return mLastError; }
    [[nodiscard]] std::size_t transparentCount() const noexcept { return mTransparent.size(); }

    struct Stats {
        std::uint64_t queries{};
        std::uint64_t occluders{};
        std::uint64_t transparent{};
        std::size_t   cacheSize{};
    };

    [[nodiscard]] Stats stats() const;

private:
    OcclusionTable() = default;

    bool        mLoaded{};
    bool        mDefaultOccludes{true};
    std::string mLastError;

    std::unordered_set<std::string>              mTransparent;
    std::vector<std::string>                     mSuffixes;
    std::vector<std::string>                     mContains;
    std::unordered_map<std::string, bool>        mCache;
    mutable Stats                                mStats{};
};

} // namespace litematicabe::core::schematic
