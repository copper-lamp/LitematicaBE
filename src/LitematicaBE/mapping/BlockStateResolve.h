#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <unordered_map>

namespace litematicabe::mapping {

// 方块状态串 → 网络 id（`Block::mNetworkId`）。
//
// 走 BDS 自己的方块注册表：`Block::tryGetFromRegistry(HashedString(name), BlockStatesType)`，
// 与 HologramLib 内部 `blockstate::resolveNetworkId` 是同一条路（`platform/levilamina/src/block/BlockState.cpp:108`）。
// 因此不依赖库的 C ABI，也不依赖 LSE。
//
// 状态串形如 `lit:g_acacia_door[lit:dir=2]`；值按 bool → int → float → string 的顺序推断，
// 与库的解析口径保持一致，避免同一条状态串在两边解析出不同的状态集合。
class BlockStateResolve {
public:
    static BlockStateResolve& getInstance();

    // 解析状态串；成功时写入 outId 并返回 true。
    bool resolve(std::string_view stateText, std::uint32_t& outId);

    // 只取方块名：`a:b[c=d]` → `a:b`。
    [[nodiscard]] static std::string_view nameOf(std::string_view stateText) noexcept;

    // 清空缓存（重载数据包 / 换维度 / 热更 BP 后调用）。
    void clear();

    struct Stats {
        std::uint64_t hits{};
        std::uint64_t misses{};
        std::uint64_t failures{};
        std::size_t   cached{};
    };

    [[nodiscard]] Stats stats() const;

private:
    BlockStateResolve() = default;

    std::unordered_map<std::string, std::uint32_t> mCache;
    Stats                                          mStats{};
};

} // namespace litematicabe::mapping
