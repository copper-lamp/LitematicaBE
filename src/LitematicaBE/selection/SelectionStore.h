#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <unordered_set>

namespace litematicabe::selection {

// 一个选点（世界坐标 + 维度）。
struct Point {
    std::int32_t x{};
    std::int32_t y{};
    std::int32_t z{};
    std::int32_t dimid{};
};

// 规整后的选区（逐轴 min/max，含端点）。
struct Box {
    std::int32_t minX{};
    std::int32_t minY{};
    std::int32_t minZ{};
    std::int32_t maxX{};
    std::int32_t maxY{};
    std::int32_t maxZ{};
    std::int32_t dimid{};

    [[nodiscard]] std::int32_t width() const noexcept { return maxX - minX + 1; }
    [[nodiscard]] std::int32_t height() const noexcept { return maxY - minY + 1; }
    [[nodiscard]] std::int32_t depth() const noexcept { return maxZ - minZ + 1; }
    [[nodiscard]] std::uint64_t volume() const noexcept {
        return static_cast<std::uint64_t>(width()) * static_cast<std::uint64_t>(height())
             * static_cast<std::uint64_t>(depth());
    }
};

enum class PickStatus : int {
    First            = 0, //< 记下了第一点，等第二点
    Second           = 1, //< 记下了第二点，选区完成
    DimensionMismatch = 2, //< 两次点击不在同一维度（保留第一点）
    Cooling          = 3, //< 冷却中，这一击不处理
};

struct PickResult {
    PickStatus status{PickStatus::First};
    Box        box{};      //< `Second` 时有效
    Point      first{};    //< 已记下的第一点（`DimensionMismatch` 时用来回显）
    bool       complete{}; //< 是否已经有完整选区
};

// 按玩家名保存的选区状态（旧项目 `SelectionTool` 的 C++ 版）。
//
// 状态机极简：没有点 → 第一点；有一点 → 第二点（完成）；完成后再次点击 = 重新开始。
// 冷却 500 ms 与旧项目同值：右键连点两下（双触发）不会把 pos2 记成 pos1。
class SelectionStore {
public:
    static SelectionStore& getInstance();

    // 记录一次点击。返回这一击被判定成什么，调用方据此回显。
    PickResult record(std::string const& playerName, Point const& point);

    // 是否有完整选区。
    [[nodiscard]] bool current(std::string const& playerName, Box& out) const;

    // 已经点了几个点（0/1/2）。
    [[nodiscard]] int pointCount(std::string const& playerName) const;

    // 第一点（`pointCount >= 1` 时有效）。
    [[nodiscard]] bool firstPoint(std::string const& playerName, Point& out) const;

    void clear(std::string const& playerName);
    void clearAll();

    // 清掉不在线的玩家，返回被清掉的人数（避免 xuid/名字长期占内存）。
    std::size_t prune(std::unordered_set<std::string> const& onlineNames);

    [[nodiscard]] std::size_t size() const noexcept { return mEntries.size(); }

    // 冷却剩余毫秒（0 = 不在冷却）。
    [[nodiscard]] std::int64_t cooldownLeft(std::string const& playerName) const;

private:
    SelectionStore() = default;

    struct Entry {
        Point        pos1{};
        Point        pos2{};
        int          points{};
        std::int64_t lastPickMs{};
    };

    static std::int64_t nowMs();

    std::unordered_map<std::string, Entry> mEntries;
};

// 选区线框（ShapeDrawer 全局形状）：与选区状态一起维护，清选区时收回。
namespace box {
void show(std::string const& playerName, Box const& box);
void hide(std::string const& playerName);
void hideAll();
void prune(std::unordered_set<std::string> const& onlineNames);
[[nodiscard]] std::size_t shownCount();
} // namespace box

} // namespace litematicabe::selection
