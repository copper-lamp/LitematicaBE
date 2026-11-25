#pragma once

#include "LitematicaBE/ghost/BatchEncoder.h"

#include "ll/api/event/EventBus.h"

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <string>
#include <vector>

namespace litematicabe::ghost {

// 按 tick 预算发假方块包。
//
// 一个 3 万格的投影会编出上百个包，一次性 flush 会让主线程和客户端都顶不住；
// 这里把包排进队列，每个服务器刻只发 `packetsPerTick` 个（默认 8，与库内部的发包预算同量级）。
//
// 驱动方式：LL 1.9.9 不发布 `LevelTickEvent`（注册即失败），所以不挂事件 ——
// 由 `ProjectionManager` 的 1 秒轮询调用 `pump()`，`pump()` 按真实经过的时间补齐
// 错过的 tick 预算（每 50ms 一个 tick，单次最多补 40 个），吞吐不丢、也不需要事件。
//
// 队列按玩家名归组：玩家中途退出时该组直接丢弃（不重发已发部分，重进后由调用方重新 load）。
class DispatchQueue {
public:
    static DispatchQueue& getInstance();

    void start();
    void stop();

    // 由 1 秒轮询驱动：按经过的时间补发若干 tick 的预算。
    void pump();
    [[nodiscard]] bool running() const noexcept { return mRunning; }

    // 入队；返回排队包数（0 表示没有可发的包）。
    // 同一玩家已有未发完的队列会被**丢弃替换** —— 切层/重发后旧层的包不能晚到。
    std::size_t enqueue(std::string const& playerName, std::vector<EncodedPacket> packets);

    void setPacketsPerTick(std::size_t count) noexcept { mBudgetPerTick = count == 0 ? 1 : count; }
    [[nodiscard]] std::size_t packetsPerTick() const noexcept { return mBudgetPerTick; }

    // 立刻把队列清空（`/lit stop` 或关服时用）。
    void clear();

    // 丢掉某个玩家排队中未发的包（切私有 / 收回某人的显示时用）。
    //
    // 收回 ghost 必须「先清队列再发真方块」，否则排队中的 ghost 包会在收回之后到达，
    // 投影又冒出来。丢弃的包计入 `stats().dropped`。
    void dropPlayer(std::string const& playerName);

    struct Stats {
        std::uint64_t ticks{};
        std::uint64_t queued{};
        std::uint64_t sent{};
        std::uint64_t dropped{};
        std::size_t   pendingJobs{};
        std::size_t   pendingPackets{};
    };

    [[nodiscard]] Stats stats() const;

private:
    DispatchQueue() = default;

    struct Job {
        std::string                playerName;
        std::vector<EncodedPacket> packets;
        std::size_t                next{};
    };

    void drain(std::size_t budget);

    bool                        mRunning{};
    std::size_t                 mBudgetPerTick{8};
    std::deque<Job>             mJobs;
    std::chrono::steady_clock::time_point mLastPump{};

    std::uint64_t mTicks{};
    std::uint64_t mQueued{};
    std::uint64_t mSent{};
    std::uint64_t mDropped{};
};

} // namespace litematicabe::ghost
