#include "LitematicaBE/selection/SelectionStore.h"

#include "LitematicaBE/core/save/SaveConfig.h"
#include "LitematicaBE/hologram/ShapeDrawer.h"

#include "ll/api/mod/NativeMod.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <unordered_map>
#include <unordered_set>

namespace litematicabe::selection {

namespace {

using litematicabe::hologram::ShapeDrawer;

// 与旧项目 `SelectionTool` 同值：右键连点的双触发不会把第二点记成第一点。
constexpr std::int64_t kCooldownMs = 500;

Box boxOf(Point const& a, Point const& b) {
    Box box;
    box.minX  = std::min(a.x, b.x);
    box.minY  = std::min(a.y, b.y);
    box.minZ  = std::min(a.z, b.z);
    box.maxX  = std::max(a.x, b.x);
    box.maxY  = std::max(a.y, b.y);
    box.maxZ  = std::max(a.z, b.z);
    box.dimid = a.dimid;
    return box;
}

} // namespace

std::int64_t SelectionStore::nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch()
    )
        .count();
}

SelectionStore& SelectionStore::getInstance() {
    static SelectionStore instance;
    return instance;
}

PickResult SelectionStore::record(std::string const& playerName, Point const& point) {
    PickResult result;
    auto&      entry = mEntries[playerName];
    auto const now   = nowMs();

    if (entry.lastPickMs != 0 && now - entry.lastPickMs < kCooldownMs) {
        result.status = PickStatus::Cooling;
        return result;
    }
    entry.lastPickMs = now;

    // 没有点，或者上一次已经选完 → 这次是新一轮的第一点。
    if (entry.points <= 0 || entry.points >= 2) {
        entry.pos1   = point;
        entry.points = 1;
        result.status = PickStatus::First;
        return result;
    }

    // 第二点必须与第一点同维度：跨维度的包围盒没有任何意义。
    if (entry.pos1.dimid != point.dimid) {
        result.status = PickStatus::DimensionMismatch;
        result.first  = entry.pos1;
        return result;
    }

    entry.pos2   = point;
    entry.points = 2;
    result.status   = PickStatus::Second;
    result.box      = boxOf(entry.pos1, entry.pos2);
    result.complete = true;
    return result;
}

bool SelectionStore::current(std::string const& playerName, Box& out) const {
    auto const it = mEntries.find(playerName);
    if (it == mEntries.end() || it->second.points < 2) {
        return false;
    }
    out = boxOf(it->second.pos1, it->second.pos2);
    return true;
}

int SelectionStore::pointCount(std::string const& playerName) const {
    auto const it = mEntries.find(playerName);
    return it == mEntries.end() ? 0 : it->second.points;
}

bool SelectionStore::firstPoint(std::string const& playerName, Point& out) const {
    auto const it = mEntries.find(playerName);
    if (it == mEntries.end() || it->second.points < 1) {
        return false;
    }
    out = it->second.pos1;
    return true;
}

std::int64_t SelectionStore::cooldownLeft(std::string const& playerName) const {
    auto const it = mEntries.find(playerName);
    if (it == mEntries.end() || it->second.lastPickMs == 0) {
        return 0;
    }
    auto const elapsed = nowMs() - it->second.lastPickMs;
    return elapsed < kCooldownMs ? kCooldownMs - elapsed : 0;
}

void SelectionStore::clear(std::string const& playerName) { mEntries.erase(playerName); }

void SelectionStore::clearAll() { mEntries.clear(); }

std::size_t SelectionStore::prune(std::unordered_set<std::string> const& onlineNames) {
    std::size_t removed = 0;
    for (auto it = mEntries.begin(); it != mEntries.end();) {
        if (onlineNames.find(it->first) == onlineNames.end()) {
            it = mEntries.erase(it);
            ++removed;
        } else {
            ++it;
        }
    }
    return removed;
}

// ───────────────────────────── 选区线框 ─────────────────────────────
//
// 坐标系（基岩版）：`BlockPos` 是整数格点，方块 (x,y,z) 占世界空间
// [x, x+1] × [y, y+1] × [z, z+1]，中心在 (x+0.5, y+0.5, z+0.5)。
// 要框住「从 min 到 max（含端点）」这一块，角点就取 min 与 max+1 ——
// 与投影包围盒（`ProjectionSession::refreshWireframe`）同一套口径。
//
// 画框走 `createBox`（六个参数 = 两个角点，与 `createLine` 同签名）。
// 角点取 min 与 max+1，正好框住含端点的整格 —— 与投影包围盒同一口径。
// 注：早期版本的盒体载荷在客户端会崩/偏移，已由库侧修复；若某个库版本又出问题，
// 可以退回 12 条 `createLine` 拼棱（`ghost/Wireframe.cpp` 里就是那种写法）。

namespace box {

namespace {

constexpr std::size_t kLineCount = 12;

// 一个玩家当前的线框：盒体样式填 `boxId`，线条样式填 `lineIds`。
struct Shown {
    std::int64_t                 boxId{};
    std::array<std::int64_t, kLineCount> lineIds{};
};

// 每个玩家一个框（形状是全局的，没法按玩家隔离）。
std::unordered_map<std::string, Shown> gShown;

// 收起一个形状。先 `exists` 再 `destroy`：重复销毁在部分库版本里会让整批形状失效。
void destroyShape(std::int64_t id) {
    if (id <= 0) {
        return;
    }
    auto& drawer = ShapeDrawer::getInstance();
    if (!drawer.exists(id)) {
        return;
    }
    (void)drawer.destroy(id);
}

void destroyShown(Shown const& shown) {
    destroyShape(shown.boxId);
    for (auto const id : shown.lineIds) {
        destroyShape(id);
    }
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
constexpr unsigned kEdges[kLineCount][2] = {
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

} // namespace

void show(std::string const& playerName, Box const& box) {
    // 先收起这一位玩家上一次的框：两种样式的尺寸都在创建时定死，改坐标只能重建。
    hide(playerName);

    if (!core::save::options().showSelectionBox) {
        return;
    }
    auto& drawer = ShapeDrawer::getInstance();
    if (!drawer.available()) {
        return;
    }

    Shown         shown;
    auto const    style = core::save::options().boxStyle;

    // 选区在世界里的真实范围：格 (x..x+1) 含端点 → 角点取 min 与 max+1。
    auto const x1 = static_cast<float>(box.minX);
    auto const y1 = static_cast<float>(box.minY);
    auto const z1 = static_cast<float>(box.minZ);
    auto const x2 = static_cast<float>(box.maxX + 1);
    auto const y2 = static_cast<float>(box.maxY + 1);
    auto const z2 = static_cast<float>(box.maxZ + 1);

    if (style == core::save::BoxStyle::Box) {
        // 实测：该库版本的 `createBox` 把「两点的中点」当成起画角，输出整体平移 边长/2
        // （单格偏半格、选区越大偏得越多）。所以传「以 min 为中心、跨度 = 边长」的两个点：
        //   min - 边长/2 … min + 边长/2
        // 库自己取中点后正好落回 min，框就对齐 [min, max+1]。
        auto const sx = static_cast<float>(box.width());
        auto const sy = static_cast<float>(box.height());
        auto const sz = static_cast<float>(box.depth());
        shown.boxId   = drawer.createBox(
            x1 - sx * 0.5f,
            y1 - sy * 0.5f,
            z1 - sz * 0.5f,
            x1 + sx * 0.5f,
            y1 + sy * 0.5f,
            z1 + sz * 0.5f
        );
        if (shown.boxId > 0) {
            (void)drawer.setColor(shown.boxId, 0.25f, 0.85f, 1.0f, 0.85f);
            (void)drawer.draw(shown.boxId);
        }
    } else {
        // 12 条线：与 `ghost/Wireframe`（投影包围盒）完全同一口径，坐标确定性最好。
        for (std::size_t i = 0; i < kLineCount; ++i) {
            auto const start = cornerAt(x1, y1, z1, x2, y2, z2, kEdges[i][0]);
            auto const end   = cornerAt(x1, y1, z1, x2, y2, z2, kEdges[i][1]);
            shown.lineIds[i] = drawer.createLine(start.x, start.y, start.z, end.x, end.y, end.z);
        }
        for (auto const id : shown.lineIds) {
            if (id > 0) {
                (void)drawer.setColor(id, 0.25f, 0.85f, 1.0f, 0.85f);
                (void)drawer.draw(id);
            }
        }
    }

    gShown[playerName] = shown;
}

void hide(std::string const& playerName) {
    auto const it = gShown.find(playerName);
    if (it == gShown.end()) {
        return;
    }
    destroyShown(it->second);
    gShown.erase(it);
}

void hideAll() {
    for (auto const& [name, shown] : gShown) {
        (void)name;
        destroyShown(shown);
    }
    gShown.clear();
}

void prune(std::unordered_set<std::string> const& onlineNames) {
    for (auto it = gShown.begin(); it != gShown.end();) {
        if (onlineNames.find(it->first) == onlineNames.end()) {
            destroyShown(it->second);
            it = gShown.erase(it);
        } else {
            ++it;
        }
    }
}

std::size_t shownCount() { return gShown.size(); }

} // namespace box

} // namespace litematicabe::selection
