#include "LitematicaBE/ghost/Wireframe.h"

#include "LitematicaBE/hologram/ShapeDrawer.h"

#include "ll/api/mod/NativeMod.h"

#include <windows.h>

#include <cmath>

namespace litematicabe::ghost {

namespace {

using litematicabe::hologram::ShapeDrawer;

// 形状被"收起"时下移的距离（世界下方，客户端不会再画）。
constexpr float kParkDistance = 512.0f;

// 逃生开关：设置环境变量 LITEMATICABE_NO_WIREFRAME=1 后完全停用线框。
bool wireframeDisabledByEnv() {
    static bool const disabled = [] {
        wchar_t value[8]{};
        return ::GetEnvironmentVariableW(L"LITEMATICABE_NO_WIREFRAME", value, 8) > 0;
    }();
    return disabled;
}

// 诊断日志开关：构建明细默认走 DEBUG（日志等级为 Info 时不输出）。
// 排查「框画到哪了」时设 LITEMATICABE_WIREFRAME_LOG=1 恢复到 INFO。
bool wireframeLogVerbose() {
    static bool const verbose = [] {
        wchar_t value[8]{};
        return ::GetEnvironmentVariableW(L"LITEMATICABE_WIREFRAME_LOG", value, 8) > 0;
    }();
    return verbose;
}

struct Corner {
    float x;
    float y;
    float z;
};

// 角点索引：bit0 = x(0/1)、bit1 = y(0/1)、bit2 = z(0/1)。
Corner cornerAt(float x1, float y1, float z1, float x2, float y2, float z2, unsigned index) {
    return Corner{
        (index & 1u) != 0 ? x2 : x1,
        (index & 2u) != 0 ? y2 : y1,
        (index & 4u) != 0 ? z2 : z1,
    };
}

// 12 条棱（角点对）：底面 4、顶面 4、竖棱 4。
constexpr unsigned kEdges[Wireframe::kEdgeCount][2] = {
    {0, 1},
    {1, 3},
    {3, 2},
    {2, 0},
    {4, 5},
    {5, 7},
    {7, 6},
    {6, 4},
    {0, 4},
    {1, 5},
    {2, 6},
    {3, 7},
};

void drawLine(std::int64_t id, float r, float g, float b, float a) {
    auto& drawer = ShapeDrawer::getInstance();
    (void)drawer.setColor(id, r, g, b, a);
    (void)drawer.draw(id);
}

} // namespace

Wireframe& Wireframe::getInstance() {
    static Wireframe instance;
    return instance;
}

bool Wireframe::sameBox(Entry const& e, float x1, float y1, float z1, float x2, float y2, float z2) {
    return e.x1 == x1 && e.y1 == y1 && e.z1 == z1 && e.x2 == x2 && e.y2 == y2 && e.z2 == z2;
}

void Wireframe::build(
    Entry& entry,
    float  x1,
    float  y1,
    float  z1,
    float  x2,
    float  y2,
    float  z2,
    float  r,
    float  g,
    float  b,
    float  a
) {
    auto& drawer = ShapeDrawer::getInstance();

    entry.x1 = x1;
    entry.y1 = y1;
    entry.z1 = z1;
    entry.x2 = x2;
    entry.y2 = y2;
    entry.z2 = z2;
    entry.r  = r;
    entry.g  = g;
    entry.b  = b;
    entry.a  = a;

    for (std::size_t i = 0; i < kEdgeCount; ++i) {
        auto const start = cornerAt(x1, y1, z1, x2, y2, z2, kEdges[i][0]);
        auto const end   = cornerAt(x1, y1, z1, x2, y2, z2, kEdges[i][1]);
        entry.ids[i]     = drawer.createLine(start.x, start.y, start.z, end.x, end.y, end.z);
    }
    for (std::size_t i = 0; i < kEdgeCount; ++i) {
        if (entry.ids[i] > 0) {
            drawLine(entry.ids[i], r, g, b, a);
        }
    }

    // 默认降级到 DEBUG：日志等级为 Info(4) 的服务端看不到这行，线框行为不变。
    if (auto mod = ::ll::mod::NativeMod::current()) {
        auto& logger = mod->getLogger();
        if (wireframeLogVerbose()) {
            logger.info("[wireframe] lines built: ({},{},{})-({},{},{})", x1, y1, z1, x2, y2, z2);
        } else {
            logger.debug("[wireframe] lines built: ({},{},{})-({},{},{})", x1, y1, z1, x2, y2, z2);
        }
    }
}

void Wireframe::park(Entry& entry) {
    auto& drawer = ShapeDrawer::getInstance();
    for (std::size_t i = 0; i < kEdgeCount; ++i) {
        if (entry.ids[i] <= 0) {
            continue;
        }
        auto const start = cornerAt(entry.x1, entry.y1, entry.z1, entry.x2, entry.y2, entry.z2, kEdges[i][0]);
        (void)drawer.setLocation(entry.ids[i], start.x, start.y - kParkDistance, start.z);
        (void)drawer.update(entry.ids[i]);
        entry.ids[i] = 0;
    }
}

void Wireframe::show(
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
) {
    if (!mEnabled || wireframeDisabledByEnv()) {
        return;
    }

    auto& drawer = ShapeDrawer::getInstance();
    if (!drawer.available()) {
        // 无粒子兜底：形状通道不可用时什么都不画。
        return;
    }

    auto it = mEntries.find(id);
    if (it == mEntries.end()) {
        Entry entry{};
        build(entry, x1, y1, z1, x2, y2, z2, r, g, b, a);
        mEntries[id] = entry;
        return;
    }

    Entry& entry = it->second;
    if (sameBox(entry, x1, y1, z1, x2, y2, z2) && entry.r == r && entry.g == g && entry.b == b && entry.a == a) {
        return;
    }

    // 坐标或颜色变了：旧棱收起，按新坐标重画（createLine 不能改长度）。
    park(entry);
    build(entry, x1, y1, z1, x2, y2, z2, r, g, b, a);
}

void Wireframe::hide(std::uint32_t id) {
    auto it = mEntries.find(id);
    if (it == mEntries.end()) {
        return;
    }
    park(it->second);
    mEntries.erase(it);
}

void Wireframe::hideAll() {
    for (auto& [key, entry] : mEntries) {
        (void)key;
        park(entry);
    }
    mEntries.clear();
}

void Wireframe::setEnabled(bool on) {
    mEnabled = on;
    if (!on) {
        hideAll();
    }
}

} // namespace litematicabe::ghost
