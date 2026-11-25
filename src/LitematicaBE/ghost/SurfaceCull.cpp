#include "LitematicaBE/ghost/SurfaceCull.h"

#include "LitematicaBE/core/schematic/OcclusionTable.h"

#include <cstdint>
#include <unordered_map>
#include <vector>

namespace litematicabe::ghost {

namespace {

// 21 位/轴：±1M 方块范围（投影远小于这个量级）。
constexpr std::uint64_t kMask = 0x1FFFFF;

std::uint64_t packKey(std::int32_t x, std::int32_t y, std::int32_t z) noexcept {
    auto const ux = static_cast<std::uint64_t>(static_cast<std::uint32_t>(x)) & kMask;
    auto const uy = static_cast<std::uint64_t>(static_cast<std::uint32_t>(y)) & kMask;
    auto const uz = static_cast<std::uint64_t>(static_cast<std::uint32_t>(z)) & kMask;
    return (ux << 42) | (uy << 21) | uz;
}

constexpr std::int32_t kOffsets[6][3] = {
    {1, 0, 0},
    {-1, 0, 0},
    {0, 1, 0},
    {0, -1, 0},
    {0, 0, 1},
    {0, 0, -1},
};

} // namespace

CullStats cullInterior(std::vector<PendingBlock>& blocks) {
    CullStats stats;
    stats.input = blocks.size();
    if (blocks.size() < 7) {
        // 少于 7 个方块不可能有「被完全包住」的格子。
        stats.kept = blocks.size();
        return stats;
    }

    std::unordered_map<std::uint64_t, std::uint32_t> index;
    index.reserve(blocks.size() * 2);
    for (std::uint32_t i = 0; i < blocks.size(); ++i) {
        index.emplace(packKey(blocks[i].x, blocks[i].y, blocks[i].z), i);
    }

    auto& occlusion = core::schematic::OcclusionTable::getInstance();

    std::vector<bool> drop(blocks.size(), false);
    for (std::size_t i = 0; i < blocks.size(); ++i) {
        auto const& block = blocks[i];

        int hiddenFaces = 0;
        for (auto const& offset : kOffsets) {
            auto const key = packKey(block.x + offset[0], block.y + offset[1], block.z + offset[2]);
            auto const it  = index.find(key);
            if (it == index.end()) {
                break; // 邻居是空气：这个面一定可见
            }
            if (!occlusion.occludes(blocks[it->second].javaName)) {
                break; // 邻居不遮挡（楼梯/玻璃/半砖…）：面可见
            }
            ++hiddenFaces;
        }
        if (hiddenFaces == 6) {
            drop[i] = true;
        }
    }

    std::size_t write = 0;
    for (std::size_t read = 0; read < blocks.size(); ++read) {
        if (!drop[read]) {
            if (write != read) {
                blocks[write] = std::move(blocks[read]);
            }
            ++write;
        }
    }
    stats.removed = blocks.size() - write;
    blocks.resize(write);
    stats.kept = blocks.size();
    return stats;
}

} // namespace litematicabe::ghost
