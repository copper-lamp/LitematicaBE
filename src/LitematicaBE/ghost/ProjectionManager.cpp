#include "LitematicaBE/ghost/ProjectionManager.h"

#include "LitematicaBE/core/util/TextEncoding.h"
#include "LitematicaBE/ghost/BlockHook.h"
#include "LitematicaBE/ghost/DispatchQueue.h"
#include "LitematicaBE/ghost/Wireframe.h"

#include "ll/api/mod/Mod.h"
#include "ll/api/mod/NativeMod.h"
#include "ll/api/service/Bedrock.h"
#include "ll/api/thread/ServerThreadExecutor.h"

#include "mc/server/commands/CommandOutput.h"
#include "mc/world/actor/player/Player.h"
#include "mc/world/level/Level.h"

#include <chrono>
#include <cmath>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

namespace litematicabe::ghost {

namespace {

constexpr std::int32_t kTeleportThreshold = 64;

} // namespace

ProjectionManager& ProjectionManager::getInstance() {
    static ProjectionManager instance;
    return instance;
}

std::string ProjectionManager::nextLabel(std::string const& file) const {
    return file;
}

ProjectionSession* ProjectionManager::create(
    ::CommandOutput&             output,
    std::filesystem::path const& file,
    int                          baseX,
    int                          baseY,
    int                          baseZ,
    std::string const&           owner
) {
    auto const id = mNextId++;
    auto session  = std::make_unique<ProjectionSession>(id, nextLabel(util::toUtf8(file.filename())));
    session->setOwner(owner);

    if (!session->begin(output, file, baseX, baseY, baseZ)) {
        return nullptr;
    }

    auto* raw      = session.get();
    mSessions[id]  = std::move(session);
    mActiveId      = id;
    return raw;
}

ProjectionSession* ProjectionManager::active() {
    auto const it = mSessions.find(mActiveId);
    return it == mSessions.end() ? nullptr : it->second.get();
}

ProjectionSession* ProjectionManager::find(std::uint32_t id) {
    auto const it = mSessions.find(id);
    return it == mSessions.end() ? nullptr : it->second.get();
}

void ProjectionManager::forEachSession(std::function<bool(ProjectionSession&)> const& fn) {
    if (!fn) {
        return;
    }
    // mSessions 是 std::map，天然按 id 升序。回调里允许 select/remove 之外的读操作；
    // 删除会话请走 remove()，不要在回调里直接改容器。
    for (auto& [id, session] : mSessions) {
        (void)id;
        if (session && !fn(*session)) {
            return;
        }
    }
}

bool ProjectionManager::select(::CommandOutput& output, std::uint32_t id) {
    if (mSessions.find(id) == mSessions.end()) {
        output.error("没有 #{} 这份投影（用 /lit projects 查看）", id);
        return false;
    }
    mActiveId = id;
    auto& session = *mSessions[id];
    output.success(
        "已选中 #{} {}（{} 格，层 {}~{}）",
        session.id(),
        session.label(),
        session.blockCount(),
        session.bounds().from,
        session.bounds().to
    );
    return true;
}

bool ProjectionManager::remove(::CommandOutput& output, std::uint32_t id, ::Player* player) {
    auto const it = mSessions.find(id);
    if (it == mSessions.end()) {
        output.error("没有 #{} 这份投影（用 /lit projects 查看）", id);
        return false;
    }

    auto& session = *it->second;
    if (player != nullptr) {
        session.clear(output, *player);
    }

    output.success("已删除投影 #{} {}（{} 格）", session.id(), session.label(), session.blockCount());
    Wireframe::getInstance().hide(id);
    mSessions.erase(it);

    if (mActiveId == id) {
        mActiveId = mSessions.empty() ? 0 : mSessions.rbegin()->first;
        if (auto* next = active()) {
            output.success("当前选中切换到 #{} {}", next->id(), next->label());
        }
    }
    return true;
}

void ProjectionManager::applyShareChange(::Player& player, bool shared) {
    auto level = ::ll::service::getLevel();
    if (!level) {
        return;
    }

    auto const owner = player.getRealName();
    for (auto& [id, session] : mSessions) {
        (void)id;
        if (session->owner() != owner) {
            continue; // 只动自己放置的投影，别人的可见性跟他自己的开关走
        }

        if (shared) {
            // 私有 → 共享：把当前显示层补发给所有在线玩家（sendCachedTo 自带可见性判定）。
            level->forEachPlayer([&](::Player& p) {
                session->sendCachedTo(p);
                return true;
            });
        } else {
            // 共享 → 私有：把旁人屏幕上已经出现的 ghost 擦掉。
            // 先丢队列：不然排队中的 ghost 包会在收回之后才到，投影又「冒」出来。
            level->forEachPlayer([&](::Player& p) {
                if (p.getRealName() == owner) {
                    return true;
                }
                DispatchQueue::getInstance().dropPlayer(p.getRealName());
                session->revokeFrom(p);
                // 队列按玩家归组、分不清是哪个会话的包，刚把他整组丢了：
                // 把其它「他仍然看得到」的会话补发一遍，免得收回操作顺手把他别的投影也抹了。
                for (auto& [otherId, other] : mSessions) {
                    (void)otherId;
                    if (other.get() == session.get()) {
                        continue;
                    }
                    other->sendCachedTo(p);
                }
                return true;
            });
        }

        // 线框是全局形状：私有会话收起，共享会话按需重画。
        session->refreshWireframe();
    }

    if (auto mod = ::ll::mod::NativeMod::current()) {
        mod->getLogger().info(
            "share switch applied: owner='{}' shared={} sessions={}",
            owner,
            shared,
            mSessions.size()
        );
    }
}

void ProjectionManager::list(::CommandOutput& output) const {
    if (mSessions.empty()) {
        output.success("当前没有投影会话（/lit load <file> [x y z] 新建）");
        return;
    }

    output.success("§b[投影列表]§r 共 {} 份，#{} 为当前选中", mSessions.size(), mActiveId);
    for (auto const& [id, session] : mSessions) {
        auto const  mirror = session->mirror();
        auto const& stats  = session->stats();
        auto const  shown  = session->shown();
        char        shownText[64]{};
        if (mirror.cachedPackets == 0) {
            std::snprintf(shownText, sizeof(shownText), "未显示");
        } else {
            std::snprintf(shownText, sizeof(shownText), "层 %d~%d（%zu 包）", shown.from, shown.to, mirror.cachedPackets);
        }

        output.success(
            "{}#{} {}｜{} 格｜层 {}~{}｜旋转 {}°｜{}｜{}｜重发 {} 次",
            id == mActiveId ? "§a→ §r" : "  ",
            id,
            session->label(),
            session->blockCount(),
            session->bounds().from,
            session->bounds().to,
            session->rotation(),
            shownText,
            session->privateMode() ? "私有（仅主人可见）" : "共享",
            stats.resyncs
        );
    }
    output.success("§7/lit select <id> 切换；/lit remove <id> 收回并删除；/lit share [on|off] 改可见性§r");
}

void ProjectionManager::requestRepaintAt(std::int32_t x, std::int32_t y, std::int32_t z) {
    for (auto& [id, session] : mSessions) {
        (void)id;
        if (!session->active()) {
            continue;
        }
        if (session->contains(x, y, z)) {
            session->requestRepaint(x, y, z);
            ++mRepaints;
        }
    }
}

bool ProjectionManager::targetBlockAt(std::int32_t x, std::int32_t y, std::int32_t z, ::Block const*& out) const {
    out               = nullptr;
    bool inProjection = false;
    for (auto const& [id, session] : mSessions) {
        (void)id;
        if (!session->active()) {
            continue;
        }
        ::Block const* cell = nullptr;
        if (!session->targetCell(x, y, z, cell)) {
            continue;
        }
        inProjection = true;
        if (cell != nullptr) {
            out = cell;
            return true;
        }
    }
    return inProjection;
}

void ProjectionManager::onCellFilled(std::int32_t x, std::int32_t y, std::int32_t z, ::Player& player) {
    bool touched = false;
    for (auto& [id, session] : mSessions) {
        (void)id;
        if (!session->active() || !session->contains(x, y, z)) {
            continue;
        }
        session->markFilled(x, y, z);
        touched = true;
    }
    if (!touched) {
        return;
    }

    auto const playerName = player.getRealName();
    // 不能立刻发：引擎自己的方块更新还在路上，先发会被它盖掉。
    ::ll::thread::ServerThreadExecutor::getDefault().executeAfter(
        [this, x, y, z, playerName]() {
            auto level = ::ll::service::getLevel();
            if (!level) {
                return;
            }
            level->forEachPlayer([&](::Player& p) {
                if (p.getRealName() != playerName) {
                    return true;
                }
                for (auto& [id, session] : mSessions) {
                    (void)id;
                    if (!session->active()) {
                        continue;
                    }
                    session->afterGhostPush(p);
                }
                return false;
            });
        },
        std::chrono::milliseconds(60)
    );
}

std::size_t ProjectionManager::filledCellCount() const {
    std::size_t total = 0;
    for (auto const& [id, session] : mSessions) {
        (void)id;
        total += session->filledCount();
    }
    return total;
}

void ProjectionManager::sendCachedTo(::Player& player) {    for (auto& [id, session] : mSessions) {
        (void)id;
        session->sendCachedTo(player);
        ++mResyncs;
    }
}

void ProjectionManager::refreshWireframes() {
    for (auto& [id, session] : mSessions) {
        (void)id;
        session->refreshWireframe();
    }
}

void ProjectionManager::start() {
    if (mPolling) {
        return;
    }
    installBlockChangedHook();
    // Level::getDimension 在本服务端始终返回空，放置需要一个真实的 BlockSource：
    // 靠 hook BlockSource:: 在第一次世界访问时捕获。
    installBlockSourceCapture();
    mPolling = true;
    DispatchQueue::getInstance().start();
    schedulePoll(1000);
    schedulePump(50);

    if (auto mod = ::ll::mod::NativeMod::current()) {
        mod->getLogger().info("projection manager started (block hook + 1s player poll)");
    }
}

void ProjectionManager::stop() {
    if (!mPolling) {
        return;
    }
    mPolling = false;
    DispatchQueue::getInstance().stop();
    Wireframe::getInstance().hideAll();
    uninstallBlockChangedHook();
    stopBlockSourceCapture();
}

void ProjectionManager::schedulePoll(std::int64_t delayMs) {
    ::ll::thread::ServerThreadExecutor::getDefault().executeAfter(
        [this]() {
            if (!mPolling) {
                return;
            }
            pollPlayers();
            schedulePoll(1000);
        },
        std::chrono::milliseconds(delayMs)
    );
}

void ProjectionManager::schedulePump(std::int64_t delayMs) {
    // 发包队列要平滑（8 包/50ms），玩家状态检测没必要这么勤 —— 所以两条定时器分开。
    ::ll::thread::ServerThreadExecutor::getDefault().executeAfter(
        [this]() {
            if (!mPolling) {
                return;
            }
            DispatchQueue::getInstance().pump();
            schedulePump(50);
        },
        std::chrono::milliseconds(delayMs)
    );
}

void ProjectionManager::pollPlayers() {
    auto level = ::ll::service::getLevel();
    if (!level) {
        return;
    }

    ++mPollTicks;
    // 兜底心跳：5 分钟一次全量补发（正常情况下进服/重生/传送/换维度都会被下面的信号捕获）。
    bool const heartbeat = (mPollTicks % 300) == 0;

    std::unordered_set<std::string> online;
    level->forEachPlayer([&](::Player& player) {
        auto const name = player.getRealName();
        online.insert(name);

        auto const dimension      = static_cast<std::int32_t>(player.getDimensionId());
        auto const seenDim        = mSeenDimension.find(name);
        bool const isNew          = seenDim == mSeenDimension.end();
        bool const dimensionMoved = !isNew && seenDim->second != dimension;
        mSeenDimension[name]      = dimension;

        // 重生：Actor::isDead() 由 true 变 false。
        bool const alive     = !player.isDead();
        auto const aliveIt   = mSeenAlive.find(name);
        bool const respawned = aliveIt != mSeenAlive.end() && !aliveIt->second && alive;
        mSeenAlive[name]     = alive;

        // 大跨度位移（传送/跨维度回程）会让客户端重建区块。
        auto const   pos = player.getPosition();
        PosKey const now{
            static_cast<std::int32_t>(std::floor(pos.x)),
            static_cast<std::int32_t>(std::floor(pos.y)),
            static_cast<std::int32_t>(std::floor(pos.z))
        };
        bool teleported = false;
        if (auto const posIt = mSeenPos.find(name); posIt != mSeenPos.end()) {
            auto const& prev = posIt->second;
            teleported       = std::abs(now.x - prev.x) > kTeleportThreshold
                       || std::abs(now.y - prev.y) > kTeleportThreshold
                       || std::abs(now.z - prev.z) > kTeleportThreshold;
        }
        mSeenPos[name] = now;

        if (isNew || dimensionMoved || respawned || teleported) {
            mPendingResend.insert(name);
            return true;
        }

        if (auto const pending = mPendingResend.find(name); pending != mPendingResend.end()) {
            mPendingResend.erase(pending);
            sendCachedTo(player);
            return true;
        }

        if (heartbeat) {
            sendCachedTo(player);
        }
        return true;
    });

    for (auto it = mSeenDimension.begin(); it != mSeenDimension.end();) {
        if (online.find(it->first) == online.end()) {
            mSeenAlive.erase(it->first);
            mSeenPos.erase(it->first);
            mPendingResend.erase(it->first);
            it = mSeenDimension.erase(it);
        } else {
            ++it;
        }
    }
}

ProjectionManager::Stats ProjectionManager::stats() const {
    Stats stats;
    stats.sessions = mSessions.size();
    stats.active   = mActiveId;
    stats.repaints = mRepaints;
    stats.resyncs  = mResyncs;
    return stats;
}

} // namespace litematicabe::ghost
