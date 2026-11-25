#pragma once

#include <cstdint>

namespace litematicabe::hologram {

// HologramLib 形状绘制（DebugShape）接入点。
//
// HologramLib 以独立 DLL 分发，随附导入库只带 import descriptor、没有函数符号，
// 链接期拿不到 `IHologramLib::getInstance`。因此这里不引用任何导入符号：运行期从
// `HologramLib.dll` 的导出表解析 `?getInstance@IHologramLib@hologramlib@@SAAEAV12@XZ`
// 得到 `IHologramLib&`，再经虚表调用 `shapes()`。
//
// 形状只存在于客户端：`createBox` 画一个长方体线框，`draw` 后全体在线玩家可见，
// `destroy` 收回；不写世界、不落盘。
class ShapeDrawer {
public:
    static ShapeDrawer& getInstance();

    // 形状通道是否可用（构建时带上头文件 + 运行期解析到 DLL 且 ABI 匹配）。
    [[nodiscard]] bool available();

    // 不可用时一律返回 false / 0，调用方不需要判空。

    [[nodiscard]] std::int64_t createBox(float x1, float y1, float z1, float x2, float y2, float z2);
    [[nodiscard]] std::int64_t createLine(float x1, float y1, float z1, float x2, float y2, float z2);
    [[nodiscard]] bool         setColor(std::int64_t id, float r, float g, float b, float a);
    [[nodiscard]] bool         setMaxRenderDistance(std::int64_t id, float distance);
    [[nodiscard]] bool         setLocation(std::int64_t id, float x, float y, float z);
    [[nodiscard]] bool         draw(std::int64_t id);
    [[nodiscard]] bool         update(std::int64_t id);
    [[nodiscard]] bool         remove(std::int64_t id);
    [[nodiscard]] bool         destroy(std::int64_t id);
    [[nodiscard]] bool         exists(std::int64_t id);

    // 最近一次探测结论（日志 / `/lit probe` / `/lit box` 用）。
    [[nodiscard]] char const* reason() const noexcept { return mReason; }

private:
    ShapeDrawer() = default;

    void resolve();

    void*       mShapes{};
    void*       mShapeExt{};
    bool        mProbed{};
    bool        mAvailable{};
    char const* mReason{"not probed"};
};

} // namespace litematicabe::hologram
