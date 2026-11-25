#pragma once

#include "LitematicaBE/ghost/ProjectionSession.h"

#include <cstdint>
#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <unordered_map>
#include <unordered_set>

class CommandOutput;
class Player;
class Block;

namespace litematicabe::ghost {

// 多投影管理：会话表 + 当前选中 + 全局的玩家状态轮询 + 方块变化分发。
//
// 旧版（3.x）用「手持木剑选择投影」来表达"当前操作哪一份"；这里换成命令：
//   `/lit load <file>`      新建会话并自动选中（输出 `#id`）
//   `/lit projects`         列出所有会话（id / 文件 / 格数 / 层范围 / 当前显示）
//   `/lit select <id>`      切换选中
//   `/lit remove <id>`      收回并删除某个会话
//   `/lit layer|rotate|unload|resend` 都作用于**当前选中**会话。
class ProjectionManager {
public:
    static ProjectionManager& getInstance();

    // 新建会话（解析 + 剔除 + 选中），失败返回 nullptr（原因写入 output）。
    //
    // @param owner `/lit load` 的玩家名；空 = 控制台创建（没有主人，恒为共享）。
    ProjectionSession* create(
        ::CommandOutput&              output,
        std::filesystem::path const&  file,
        int                           baseX,
        int                           baseY,
        int                           baseZ,
        std::string const&            owner = {}
    );

    // `/lit share` 切换可见性之后调用：把属于该玩家的会话按新状态重发 / 收回。
    //
    // 私有 → 共享：把当前显示层补发给所有在线玩家；
    // 共享 → 私有：给旁人发一遍真实方块擦掉 ghost，并丢掉他们排队中的 ghost 包。
    void applyShareChange(::Player& player, bool shared);

    [[nodiscard]] ProjectionSession* active();
    [[nodiscard]] ProjectionSession* find(std::uint32_t id);

    // 按 id 升序遍历所有会话（面板/诊断用，避免为了拿列表去解析 `list()` 的文本）。
    // @param fn 返回 false 提前结束遍历。
    void forEachSession(std::function<bool(ProjectionSession&)> const& fn);

    bool select(::CommandOutput& output, std::uint32_t id);
    bool remove(::CommandOutput& output, std::uint32_t id, ::Player* player);
    void list(::CommandOutput& output) const;

    // 方块变化分发：哪份投影包含该坐标就由谁补格（可能同时命中多份）。
    void requestRepaintAt(std::int32_t x, std::int32_t y, std::int32_t z);

    // 轻松放置：跨会话查「这格投影要求什么方块」。
    //
    // @param out 命中的目标方块；nullptr 表示格子在投影里但解析不出可放置方块。
    // @return false = 没有任何会话包含该坐标（绝大多数放置走这条，O(会话数) 的 AABB 拒绝）。
    [[nodiscard]] bool targetBlockAt(std::int32_t x, std::int32_t y, std::int32_t z, ::Block const*& out) const;

    // 玩家在投影格上放下了真方块。
    //
    // 处理两件事：
    //   1. 所有包含该格的会话把该格记成「已填充」，之后的 ghost 发包都跳过它；
    //   2. 下一 tick 给该玩家补两包——把该格压回真方块（消掉 ghost/真方块叠加态），
    //      再重发该子区块的邻居 ghost（修掉被引擎更新顺手吞掉的邻居）。
    void onCellFilled(std::int32_t x, std::int32_t y, std::int32_t z, ::Player& player);

    // 所有会话里「已被真方块填上」的格数（诊断用）。
    [[nodiscard]] std::size_t filledCellCount() const;

    // 玩家状态变化（进服/重生/传送/换维度）时，对所有会话补发当前显示层。
    void sendCachedTo(::Player& player);

    // 重新绘制所有会话的包围盒线框（`/lit box` 重新打开时用）。
    void refreshWireframes();

    void start();
    void stop();

    struct Stats {
        std::size_t   sessions{};
        std::uint32_t active{};
        std::uint64_t repaints{};
        std::uint64_t resyncs{};
    };

    [[nodiscard]] Stats stats() const;

private:
    ProjectionManager() = default;

    void schedulePoll(std::int64_t delayMs);

    void schedulePump(std::int64_t delayMs);
    void pollPlayers();
    [[nodiscard]] std::string nextLabel(std::string const& file) const;

    std::map<std::uint32_t, std::unique_ptr<ProjectionSession>> mSessions;
    std::uint32_t mNextId{1};
    std::uint32_t mActiveId{0};

    bool          mPolling{};
    std::uint32_t mPollTicks{};

    // 玩家状态是全局的（与会话无关），检测到变化就通知所有会话补发。
    std::unordered_map<std::string, std::int32_t> mSeenDimension;
    std::unordered_map<std::string, bool>         mSeenAlive;

    struct PosKey {
        std::int32_t x{};
        std::int32_t y{};
        std::int32_t z{};
    };

    std::unordered_map<std::string, PosKey> mSeenPos;
    std::unordered_set<std::string>         mPendingResend;

    std::uint64_t mRepaints{};
    std::uint64_t mResyncs{};
};

} // namespace litematicabe::ghost
