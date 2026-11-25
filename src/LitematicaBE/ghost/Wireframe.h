#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <unordered_map>

namespace litematicabe::ghost {

// 投影包围盒线框（HologramLib DebugShape）。
//
// 用 12 条 `createLine` 拼出立方体棱，绕开该库版本 Box 载荷在客户端上的崩溃问题。
// 一个会话一组 12 条线段：坐标变了整体重建，收起时下移（不调用 destroy）。
// 不做粒子兜底——形状通道不可用时直接不画。
class Wireframe {
public:
    static constexpr std::size_t kEdgeCount = 12;

    static Wireframe& getInstance();

    // 显示/更新 `id` 会话的包围盒。
    //
    // 坐标是方块坐标（含端点），内部按 [min, max + 1] 包到方块边界。
    void show(
        std::uint32_t id,
        float         x1,
        float         y1,
        float         z1,
        float         x2,
        float         y2,
        float         z2,
        float         r,
        float         g,
        float         b,
        float         a
    );

    void hide(std::uint32_t id);
    void hideAll();

    // 全局开关（诊断用；默认开）。关闭会立即收起全部线框。
    void setEnabled(bool on);
    [[nodiscard]] bool enabled() const noexcept { return mEnabled; }

    [[nodiscard]] std::size_t count() const noexcept { return mEntries.size(); }

private:
    struct Entry {
        std::array<std::int64_t, kEdgeCount> ids{};
        float                                x1{};
        float                                y1{};
        float                                z1{};
        float                                x2{};
        float                                y2{};
        float                                z2{};
        float                                r{};
        float                                g{};
        float                                b{};
        float                                a{};
    };

    Wireframe() = default;

    static bool sameBox(Entry const& entry, float x1, float y1, float z1, float x2, float y2, float z2);
    static void build(Entry& entry, float x1, float y1, float z1, float x2, float y2, float z2, float r, float g, float b, float a);
    // 把 12 条棱挪到世界下方（不调用 destroy，避免该库版本的移除包在客户端异常）。
    static void park(Entry& entry);

    std::unordered_map<std::uint32_t, Entry> mEntries;
    bool                                     mEnabled{true};
};

} // namespace litematicabe::ghost
