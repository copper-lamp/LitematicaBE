#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace litematicabe::ghost {

// 待发送的一个方块（剔除阶段用；javaName 只在判定遮挡时用，发送前会丢掉）。
struct PendingBlock {
    std::int32_t  x{};
    std::int32_t  y{};
    std::int32_t  z{};
    std::uint32_t runtimeId{};
    std::string   javaName;
    // 原始状态串（Java 或 Bedrock 口径，取自文件），真实放置时用。
    std::string   state;
};

struct CullStats {
    std::size_t input{};
    std::size_t kept{};
    std::size_t removed{};
};

// 去掉「6 个邻居都是不透明完整方块」的内部方块。
//
// 判定「邻居算不算遮挡」完全由 `OcclusionTable`（`occlusion.json`）决定：
// 玻璃、楼梯、半砖、栅栏、门、树叶等不完整/可透视方块**不遮挡**，它们旁边的面必须保留。
// 投影边界外视为空气，所以边界上的方块一定不会被剔除。
//
// 复杂度 O(n)，空间索引是一次性的 `unordered_map<坐标打包, 下标>`。
CullStats cullInterior(std::vector<PendingBlock>& blocks);

} // namespace litematicabe::ghost
