#include "LitematicaBE/ghost/DispatchQueue.h"

#include "LitematicaBE/ghost/PacketSender.h"

#include "ll/api/mod/NativeMod.h"
#include "ll/api/service/Bedrock.h"

#include "mc/world/actor/player/Player.h"
#include "mc/world/level/Level.h"

#include <algorithm>
#include <string>
#include <utility>

namespace litematicabe::ghost {

DispatchQueue& DispatchQueue::getInstance() {
    static DispatchQueue instance;
    return instance;
}

void DispatchQueue::start() {
    if (mRunning) {
        return;
    }
    mLastPump = std::chrono::steady_clock::now();
    mRunning  = true;
}

void DispatchQueue::stop() {
    if (!mRunning) {
        return;
    }
    mRunning = false;
    mJobs.clear();
}

void DispatchQueue::pump() {
    if (!mRunning) {
        return;
    }
    auto const now = std::chrono::steady_clock::now();
    auto const elapsedMs =
        std::chrono::duration_cast<std::chrono::milliseconds>(now - mLastPump).count();
    // 每 50ms 一个 tick；单次最多补 40 个 tick（2 秒），长时间停滞后不一次性爆发。
    std::size_t const ticks =
        std::min<std::size_t>(40, static_cast<std::size_t>(elapsedMs / 50));
    if (ticks == 0) {
        return;
    }
    mLastPump += std::chrono::milliseconds(static_cast<std::int64_t>(ticks) * 50);
    drain(ticks * mBudgetPerTick);
}

std::size_t DispatchQueue::enqueue(std::string const& playerName, std::vector<EncodedPacket> packets) {
    if (packets.empty()) {
        return 0;
    }
    // 同一玩家重新 show/clear：旧队列作废，别让旧层的包在新层之后到达。
    mJobs.erase(
        std::remove_if(mJobs.begin(), mJobs.end(), [&](Job const& job) { return job.playerName == playerName; }),
        mJobs.end()
    );
    auto const count = packets.size();
    mQueued += count;
    mJobs.push_back(Job{playerName, std::move(packets), 0});
    return count;
}

void DispatchQueue::clear() {
    mJobs.clear();
}

void DispatchQueue::dropPlayer(std::string const& playerName) {
    for (auto it = mJobs.begin(); it != mJobs.end();) {
        if (it->playerName != playerName) {
            ++it;
            continue;
        }
        mDropped += it->packets.size() - it->next;
        it = mJobs.erase(it);
    }
}

void DispatchQueue::drain(std::size_t budget) {
    if (mJobs.empty()) {
        return;
    }
    auto level = ::ll::service::getLevel();
    if (!level) {
        return;
    }

    auto& sender = PacketSender::getInstance();
    ++mTicks;

    while (budget > 0 && !mJobs.empty()) {
        auto& job = mJobs.front();

        bool found = false;
        level->forEachPlayer([&](::Player& player) {
            if (player.getRealName() != job.playerName) {
                return true;
            }
            found = true;
            while (budget > 0 && job.next < job.packets.size()) {
                auto const& packet = job.packets[job.next];
                if (sender.send(player, packet.packetId, packet.body)) {
                    ++job.next;
                    ++mSent;
                } else {
                    // 发送失败（刚断线等）：整组丢弃，避免每 tick 空转。
                    mDropped += job.packets.size() - job.next;
                    job.next = job.packets.size();
                }
                --budget;
            }
            return false;
        });

        if (job.next >= job.packets.size()) {
            mJobs.pop_front();
            continue;
        }
        if (!found) {
            // 玩家不在线（或名字对不上）：整组丢弃，并记一次原因。
            mDropped += job.packets.size() - job.next;
            if (auto logger = ::ll::mod::NativeMod::current()) {
                logger->getLogger().warn(
                    "dispatch: player '{}' not found, dropped {} packets",
                    job.playerName,
                    job.packets.size() - job.next
                );
            }
            mJobs.pop_front();
            continue;
        }
    }
}

DispatchQueue::Stats DispatchQueue::stats() const {
    Stats stats;
    stats.ticks  = mTicks;
    stats.queued = mQueued;
    stats.sent   = mSent;
    stats.dropped = mDropped;
    stats.pendingJobs = mJobs.size();
    for (auto const& job : mJobs) {
        stats.pendingPackets += job.packets.size() - job.next;
    }
    return stats;
}

} // namespace litematicabe::ghost
