#include "LitematicaBE/ghost/ProjectionSession.h"

#include "LitematicaBE/core/schematic/LitematicFile.h"
#include "LitematicaBE/core/schematic/McstructureFile.h"
#include "LitematicaBE/core/util/TextEncoding.h"
#include "LitematicaBE/ghost/BlockHook.h"
#include "LitematicaBE/ghost/DispatchQueue.h"
#include "LitematicaBE/ghost/PacketSender.h"
#include "LitematicaBE/ghost/ProjectionLimits.h"
#include "LitematicaBE/ghost/ShareSwitch.h"
#include "LitematicaBE/ghost/SurfaceCull.h"
#include "LitematicaBE/ghost/Wireframe.h"
#include "LitematicaBE/mapping/BlockStateResolve.h"
#include "LitematicaBE/mapping/GhostMap.h"
#include "LitematicaBE/mapping/PlaceResolve.h"

#include "ll/api/event/EventBus.h"
#include "ll/api/mod/Mod.h"
#include "ll/api/mod/NativeMod.h"
#include "ll/api/thread/ServerThreadExecutor.h"
#include "ll/api/event/player/PlayerDestroyBlockEvent.h"
#include "ll/api/event/world/BlockChangedEvent.h"
#include "ll/api/service/Bedrock.h"

#include "mc/server/commands/CommandOutput.h"
#include "mc/world/actor/player/Player.h"
#include "mc/world/level/BlockPos.h"
#include "mc/world/level/DimensionManager.h"
#include "mc/world/level/Level.h"
#include "mc/world/level/BlockSource.h"
#include "mc/world/level/ChunkPos.h"
#include "mc/world/level/chunk/ChunkSource.h"
#include "mc/world/level/block/Block.h"
#include "mc/world/level/dimension/Dimension.h"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace litematicabe::ghost {

namespace {

namespace util = litematicabe::util;

// 加载（收集）上限来自 `config/projection.json` 的 `maxLoadBlocks`：
// 每次 `begin()` 现取一次，`/lit reload` 之后的下一次加载就是新值。

// 放置时的方块更新标志：0x1 通知邻居 + 0x2 同步到客户端。
constexpr int kPlaceUpdateFlags = 3;

// 单次 `setBlock` 的等待窗口（挖掉后补 ghost / 放方块后压回真方块）。
constexpr std::int64_t kRepaintDelayMs = 150;

std::int64_t nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

std::string toUtf8String(std::filesystem::path const& path) { return util::toUtf8(path); }

} // namespace

ProjectionSession::ProjectionSession(std::uint32_t id, std::string label)
    : mId(id),
      mLabel(std::move(label)) {}

ProjectionSession::~ProjectionSession() {
    Wireframe::getInstance().hide(mId);
}

bool ProjectionSession::begin(
    ::CommandOutput&            output,
    std::filesystem::path const& file,
    int                         baseX,
    int                         baseY,
    int                         baseZ
) {
    auto& map     = mapping::GhostMap::getInstance();
    auto& states  = mapping::BlockStateResolve::getInstance();

    if (!map.ensureLoaded()) {
        output.error("映射表未加载：{}", map.lastError());
        return false;
    }

    auto const path = file;

    std::string ext = toUtf8String(path.extension());
    std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    bool const isMcstructure = ext == ".mcstructure";

    std::vector<PendingBlock> pending;
    pending.reserve(4096);

    std::size_t unmapped   = 0;
    std::size_t idFailures = 0;
    std::string firstBadId;
    bool        overflow = false;

    // 本次加载的收集上限（config/projection.json 的 maxLoadBlocks）。
    std::size_t const collectCap = limits::options().maxLoadBlocks;

    // 一份「方块 → 待发送项」的公共转换：两种文件格式共用，保证映射/状态串口径一致。
    auto pushBlock = [&](std::int32_t wx, std::int32_t wy, std::int32_t wz, core::schematic::BlockRef const& ref) -> bool {
        if (pending.size() >= collectCap) {
            overflow = true;
            return false;
        }

        auto const resolved = map.resolve(ref.name, *ref.properties);
        if (!resolved.matched) {
            ++unmapped;
        }

        std::string stateString = resolved.ghost;
        if (!resolved.extraStates.empty() && stateString.find('[') == std::string::npos) {
            stateString.push_back('[');
            for (std::size_t i = 0; i < resolved.extraStates.size(); ++i) {
                if (i != 0) {
                    stateString.push_back(',');
                }
                stateString.append(resolved.extraStates[i].first);
                stateString.push_back('=');
                stateString.append(resolved.extraStates[i].second);
            }
            stateString.push_back(']');
        }

        std::uint32_t runtimeId = 0;
        if (!states.resolve(stateString, runtimeId)) {
            ++idFailures;
            if (firstBadId.empty()) {
                firstBadId = stateString;
            }
            return true;
        }

        // 原始状态串：真实放置时用（跟着文件口径走，不做 ghost 替换）
        std::string originState{ref.name};
        if (ref.properties != nullptr && !ref.properties->empty()) {
            originState.push_back('[');
            for (std::size_t i = 0; i < ref.properties->size(); ++i) {
                if (i != 0) {
                    originState.push_back(',');
                }
                originState.append((*ref.properties)[i].first);
                originState.push_back('=');
                originState.append((*ref.properties)[i].second);
            }
            originState.push_back(']');
        }

        pending.push_back({wx, wy, wz, runtimeId, std::string{ref.name}, std::move(originState)});
        return true;
    };

    if (isMcstructure) {
        core::schematic::McstructureFile structure;
        auto const                       error = core::schematic::readMcstructure(path, structure);
        if (!error.ok()) {
            output.error("解析失败：{}（{}）", error.message, toUtf8String(path));
            return false;
        }
        // 结构文件内部坐标就是局部坐标，直接以 base 为原点。
        core::schematic::forEachBlock(structure, [&](core::schematic::BlockRef const& ref) {
            return pushBlock(baseX + ref.x, baseY + ref.y, baseZ + ref.z, ref);
        });
    } else {
        core::schematic::LitematicFile litematic;
        auto const                       error = core::schematic::readLitematic(path, litematic);
        if (!error.ok()) {
            output.error("解析失败：{}（{}）", error.message, toUtf8String(path));
            return false;
        }

        auto const origin = litematic.regions.front().position;
        for (auto const& region : litematic.regions) {
            core::schematic::forEachBlock(region, [&](core::schematic::BlockRef const& ref) {
                return pushBlock(
                    baseX + (ref.x - origin[0]),
                    baseY + (ref.y - origin[1]),
                    baseZ + (ref.z - origin[2]),
                    ref
                );
            });
            if (overflow) {
                break;
            }
        }
    }

    if (pending.empty()) {
        output.error("没有可显示的方块（全部未映射或解析失败）");
        return false;
    }

    auto const cull = cullInterior(pending);

    mBlocks.clear();
    mBlocks.reserve(pending.size());
    mPalette.clear();
    mPaletteIds.clear();
    mIsBedrockSource = isMcstructure;
    std::int32_t minY = pending.front().y;
    std::int32_t maxY = pending.front().y;
    for (auto const& block : pending) {
        mBlocks.push_back(Entry{
            block.x,
            block.y,
            block.z,
            block.runtimeId,
            block.x - baseX,
            block.z - baseZ,
            internPalette(block.state),
        });
        minY = std::min(minY, block.y);
        maxY = std::max(maxY, block.y);
    }

    mIndex.clear();
    mIndex.reserve(mBlocks.size() * 2);
    for (std::uint32_t i = 0; i < mBlocks.size(); ++i) {
        mIndex.emplace(packKey(mBlocks[i].x, mBlocks[i].y, mBlocks[i].z), i);
    }

    // 子区块索引：放置后只需重编「那一个子区块」，不必扫全表。
    mSubchunkCells.clear();
    for (std::uint32_t i = 0; i < mBlocks.size(); ++i) {
        auto const& e = mBlocks[i];
        mSubchunkCells[packKey(e.x >> 4, e.y >> 4, e.z >> 4)].push_back(i);
    }
    mFilledCells.clear();
    mBrokenAt.clear();

    mFile   = toUtf8String(path.filename());

    // 轻松放置：把调色板一次性解析成「可放置的 Block」。
    // 一份投影的调色板通常只有几百项，运行时按格查询就退化成一次数组下标，
    // 不再有字符串解析、哈希和分配（见 easyplace/EasyPlace.cpp）。
    mPaletteBlocks.assign(mPalette.size(), nullptr);
    {
        auto&       placer = mapping::PlaceResolve::getInstance();
        std::size_t usable = 0;
        placer.ensureLoaded();
        for (std::size_t i = 0; i < mPalette.size(); ++i) {
            auto const resolved = placer.resolve(mPalette[i], mIsBedrockSource);
            mPaletteBlocks[i]  = resolved.block;
            if (resolved.block != nullptr) {
                ++usable;
            }
        }
        output.success("轻松放置调色板：{} 项（可放置 {} 项）", mPalette.size(), usable);
    }
    mBounds = LayerRange{minY, maxY};
    mShown  = LayerRange{minY, minY - 1}; // 空区间

    // 旋转基准：load 原点 + 原始 XZ 尺寸（顺时针 90° 后宽深互换）。
    mBaseX      = baseX;
    mBaseZ      = baseZ;
    mFootprintW = 0;
    mFootprintD = 0;
    for (auto const& entry : mBlocks) {
        mFootprintW = std::max(mFootprintW, entry.odx + 1);
        mFootprintD = std::max(mFootprintD, entry.odz + 1);
    }
    mRotation = 0;
    mMinX     = baseX;
    mMaxX     = baseX + mFootprintW - 1;
    mMinZ     = baseZ;
    mMaxZ     = baseZ + mFootprintD - 1;
    mShownIndices.clear();
    mActive = true;
    ++mStats.shows;

    output.success(
        "§b[会话就绪]§r {}：{} 格（剔除 {}）→ 层 {} ~ {}（共 {} 层）",
        mFile,
        mBlocks.size(),
        cull.removed,
        minY,
        maxY,
        maxY - minY + 1
    );
    if (unmapped > 0) {
        output.success("未命中映射表（走了 default）：{} 格", unmapped);
    }
    if (idFailures > 0) {
        output.error("状态串解析失败 {} 格，例：{}", idFailures, firstBadId);
    }
    if (overflow) {
        output.error(
            "投影超过收集上限 {} 格，只处理了前 {} 格（改 config/projection.json 的 maxLoadBlocks 可放宽）",
            collectCap,
            collectCap
        );
    }
    return true;
}

std::size_t ProjectionSession::clear(::CommandOutput& output, ::Player& player) {
    if (mShownIndices.empty()) {
        output.success("当前没有显示的层");
        return 0;
    }

    auto level = ::ll::service::getLevel();
    if (!level) {
        output.error("当前没有加载的世界");
        return 0;
    }

    auto dimensionRef = level->getDimension(player.getDimensionId());
    auto dimension    = dimensionRef.lock();
    if (!dimension) {
        output.error("拿不到维度");
        return 0;
    }
    auto& source = dimension->getBlockSourceFromMainChunkSource();

    std::vector<HoloBlockChange> changes;
    changes.reserve(mShownIndices.size());
    for (auto const index : mShownIndices) {
        auto const& entry = mBlocks[index];
        auto const& block = source.getBlock(::BlockPos{entry.x, entry.y, entry.z});
        changes.push_back(
            {entry.x,
             entry.y,
             entry.z,
             static_cast<std::uint32_t>(block.mNetworkId),
             BatchEncoder::kUpdateFlags,
             0,
             0}
        );
    }

    std::vector<EncodedPacket> packets;
    auto const                 encoded = BatchEncoder::getInstance().encode(changes, packets);
    if (encoded > 0) {
        // 同步发：收回必须立刻生效，不能依赖 tick 队列。
        // 只发给「本来能看到这份投影」的玩家：私有会话的旁人屏幕上没有 ghost，发了也是白流量。
        auto& sender = PacketSender::getInstance();
        level->forEachPlayer([&](::Player& p) {
            if (!visibleTo(p.getRealName())) {
                return true;
            }
            for (auto const& packet : packets) {
                sender.send(p, packet.packetId, packet.body);
            }
            return true;
        });
    }

    mStats.clears += 1;
    mStats.clearedBlocks += mShownIndices.size();
    mStats.sentPackets += encoded;

    auto const cleared = mShownIndices.size();
    mShownIndices.clear();
    mShownPackets.clear();
    mViewers.clear();
    mShown             = LayerRange{0, -1};

    Wireframe::getInstance().hide(mId);

    output.success("已收回 {} 格（{} 包）", cleared, encoded);
    return encoded;
}

std::size_t ProjectionSession::showLayers(
    ::CommandOutput& output,
    ::Player&        player,
    std::int32_t     from,
    std::int32_t     to
) {
    if (!mActive) {
        output.error("没有活动会话：先 /lit load <file> [x y z]");
        return 0;
    }

    auto const low  = std::min(from, to);
    auto const high = std::max(from, to);
    if (high < mBounds.from || low > mBounds.to) {
        output.error("层 {}~{} 超出投影范围 {}~{}", low, high, mBounds.from, mBounds.to);
        return 0;
    }

    // 先收回旧层
    if (!mShownIndices.empty()) {
        std::size_t ignored = clear(output, player);
        (void)ignored;
    }

    std::vector<HoloBlockChange> changes;
    std::vector<std::size_t>     indices;
    for (std::size_t i = 0; i < mBlocks.size(); ++i) {
        auto const& entry = mBlocks[i];
        if (entry.y < low || entry.y > high) {
            continue;
        }
        indices.push_back(i);
        changes.push_back(
            {entry.x, entry.y, entry.z, entry.runtimeId, BatchEncoder::kUpdateFlags, 0, 0}
        );
    }

    if (changes.empty()) {
        output.success("层 {}~{} 没有方块", low, high);
        return 0;
    }

    std::vector<EncodedPacket> packets;
    auto const                 encoded = BatchEncoder::getInstance().encode(changes, packets);
    if (encoded == 0) {
        output.error("编码失败：批量通道不可用");
        return 0;
    }

    auto level = ::ll::service::getLevel();
    if (!level) {
        output.error("当前没有加载的世界");
        return 0;
    }

    auto&       sender  = ghost::PacketSender::getInstance();
    std::size_t players = 0;
    std::size_t sent    = 0;

    mShownIndices = std::move(indices);
    mShownPackets = packets; // 缓存：进服/重生重发时零编码开销
    mShown        = LayerRange{low, high};
    mStats.sentPackets += encoded;

    refreshWireframe();

    // 首包同步发（小投影立刻出现，绝不让队列成为「看不到投影」的唯一通道），
    // 其余包按 8 包/50ms 铺开，避免一次把几百个包砸给主线程和客户端。
    std::size_t const syncCount = std::min<std::size_t>(1, packets.size());

    level->forEachPlayer([&](::Player& p) {
        // 私有会话：旁人一包都不发（含镜像登记），这样他们屏幕上不会凭空冒出投影。
        if (!visibleTo(p.getRealName())) {
            return true;
        }
        ++players;
        for (std::size_t i = 0; i < syncCount; ++i) {
            if (sender.send(p, packets[i].packetId, packets[i].body)) {
                ++sent;
            }
        }
        if (packets.size() > syncCount) {
            DispatchQueue::getInstance().enqueue(
                p.getRealName(),
                std::vector<EncodedPacket>(packets.begin() + static_cast<std::ptrdiff_t>(syncCount), packets.end())
            );
        }
        // 显示层镜像：记下这名玩家现在看到了哪些格。
        auto& keys = mViewers[p.getRealName()];
        keys.clear();
        keys.reserve(mShownIndices.size());
        for (auto const index : mShownIndices) {
            auto const& e = mBlocks[index];
            keys.insert(packKey(e.x, e.y, e.z));
        }
        // 刚推过去的 ghost 会盖住玩家已经放好的真方块：立刻压回来。
        afterGhostPush(p);
        return true;
    });

    auto const visibilityNote = privateMode() ? "｜§e私有：只发给你自己§r" : "";

    if (players == 0) {
        output.success(
            "§b[层就绪]§r 层 {}~{}：{} 格 → {} 包（当前没有在线玩家，未发送；进入后重新执行即可）{}",
            low,
            high,
            changes.size(),
            encoded,
            visibilityNote
        );
        return encoded;
    }
    output.success(
        "§b[层显示]§r 层 {}~{}：{} 格 → {} 包 × {} 名玩家（已发 {} 包）{}",
        low,
        high,
        changes.size(),
        encoded,
        players,
        sent,
        visibilityNote
    );
    return encoded;
}

} // namespace litematicabe::ghost

namespace litematicabe::ghost {

std::uint64_t ProjectionSession::packKey(std::int32_t x, std::int32_t y, std::int32_t z) noexcept {
    constexpr std::uint64_t kMask = 0x1FFFFF;
    auto const              ux    = static_cast<std::uint64_t>(static_cast<std::uint32_t>(x)) & kMask;
    auto const              uy    = static_cast<std::uint64_t>(static_cast<std::uint32_t>(y)) & kMask;
    auto const              uz    = static_cast<std::uint64_t>(static_cast<std::uint32_t>(z)) & kMask;
    return (ux << 42) | (uy << 21) | uz;
}

void ProjectionSession::unpackKey(std::uint64_t key, std::int32_t& x, std::int32_t& y, std::int32_t& z) noexcept {
    constexpr std::uint64_t kMask = 0x1FFFFF;
    auto const              sx    = static_cast<std::uint32_t>((key >> 42) & kMask);
    auto const              sy    = static_cast<std::uint32_t>((key >> 21) & kMask);
    auto const              sz    = static_cast<std::uint32_t>(key & kMask);
    x = static_cast<std::int32_t>(sx >= 0x100000 ? static_cast<std::int64_t>(sx) - 0x200000 : sx);
    y = static_cast<std::int32_t>(sy >= 0x100000 ? static_cast<std::int64_t>(sy) - 0x200000 : sy);
    z = static_cast<std::int32_t>(sz >= 0x100000 ? static_cast<std::int64_t>(sz) - 0x200000 : sz);
}

bool ProjectionSession::contains(std::int32_t x, std::int32_t y, std::int32_t z) const {    if (!mActive) {
        return false;
    }
    return mIndex.find(packKey(x, y, z)) != mIndex.end();
}

bool ProjectionSession::targetCell(std::int32_t x, std::int32_t y, std::int32_t z, ::Block const*& out) const {
    out = nullptr;
    if (!mActive) {
        return false;
    }
    // AABB 先拒：绝大多数「玩家随手放方块」都在这条线上返回，不碰哈希表。
    if (x < mMinX || x > mMaxX || z < mMinZ || z > mMaxZ || y < mBounds.from || y > mBounds.to) {
        return false;
    }
    auto const it = mIndex.find(packKey(x, y, z));
    if (it == mIndex.end()) {
        return false;
    }
    auto const paletteId = mBlocks[it->second].paletteId;
    if (paletteId < mPaletteBlocks.size()) {
        out = mPaletteBlocks[paletteId];
    }
    return true;
}

void ProjectionSession::requestRepaint(std::int32_t x, std::int32_t y, std::int32_t z) {
    auto const it = mIndex.find(packKey(x, y, z));
    if (it == mIndex.end()) {
        return;
    }
    // 挖掉了真方块 → 该格重新变成「需要 ghost」的状态。
    mFilledCells.erase(it->second);
    // 记下时间：打印机据此判断「玩家刚拆过」，冷却期内不抢着补回去。
    mBrokenAt[it->second] = nowMs();
    auto const& entry     = mBlocks[it->second];
    repaintOne(entry.x, entry.y, entry.z, entry.runtimeId);
}

bool ProjectionSession::brokenRecently(
    std::int32_t x,
    std::int32_t y,
    std::int32_t z,
    std::int64_t cooldownMs
) const {
    if (cooldownMs <= 0) {
        return false;
    }
    auto const it = mIndex.find(packKey(x, y, z));
    if (it == mIndex.end()) {
        return false;
    }
    auto const broken = mBrokenAt.find(it->second);
    if (broken == mBrokenAt.end()) {
        return false;
    }
    return nowMs() - broken->second < cooldownMs;
}

void ProjectionSession::markFilled(std::int32_t x, std::int32_t y, std::int32_t z) {
    if (!mActive) {
        return;
    }
    if (auto const it = mIndex.find(packKey(x, y, z)); it != mIndex.end()) {
        mFilledCells.insert(it->second);
        mFilledSubchunks.insert(packKey(x >> 4, y >> 4, z >> 4));
    }
}

bool ProjectionSession::isFilled(std::int32_t x, std::int32_t y, std::int32_t z) const {
    auto const it = mIndex.find(packKey(x, y, z));
    return it != mIndex.end() && mFilledCells.find(it->second) != mFilledCells.end();
}

std::uint32_t
ProjectionSession::ghostRuntimeIdAt(std::int32_t x, std::int32_t y, std::int32_t z) const {
    auto const it = mIndex.find(packKey(x, y, z));
    if (it == mIndex.end()) {
        return 0;
    }
    return mBlocks[it->second].runtimeId;
}

std::size_t ProjectionSession::correctFilledFor(::Player& player) {
    if (!mActive || mFilledCells.empty()) {
        return 0;
    }
    if (!visibleTo(player.getRealName())) {
        return 0;
    }
    auto level = ::ll::service::getLevel();
    if (!level) {
        return 0;
    }
    auto dimension = level->getDimension(player.getDimensionId()).lock();
    if (!dimension) {
        return 0;
    }
    auto& source = dimension->getBlockSourceFromMainChunkSource();

    // 读世界而不是读调色板：玩家可能放的是「风险闸放行」的非投影方块，
    // 那种格子的真实方块只有世界知道。
    std::vector<HoloBlockChange> changes;
    changes.reserve(mFilledCells.size());
    for (auto const index : mFilledCells) {
        auto const& entry = mBlocks[index];
        auto const& block = source.getBlock(::BlockPos{entry.x, entry.y, entry.z});
        if (block.isAir()) {
            continue;
        }
        changes.push_back(
            {entry.x,
             entry.y,
             entry.z,
             static_cast<std::uint32_t>(block.mNetworkId),
             BatchEncoder::kUpdateFlags,
             0,
             0}
        );
    }
    if (changes.empty()) {
        return 0;
    }

    std::vector<EncodedPacket> packets;
    if (BatchEncoder::getInstance().encode(changes, packets) == 0) {
        return 0;
    }
    auto&       sender = PacketSender::getInstance();
    std::size_t sent   = 0;
    for (auto const& packet : packets) {
        if (sender.send(player, packet.packetId, packet.body)) {
            ++sent;
        }
    }
    return sent;
}

std::size_t ProjectionSession::repaintSubchunkFor(
    ::Player&    player,
    std::int32_t x,
    std::int32_t y,
    std::int32_t z
) {
    return repaintSubchunkKeyFor(player, packKey(x >> 4, y >> 4, z >> 4));
}

std::size_t ProjectionSession::repaintSubchunkKeyFor(::Player& player, std::uint64_t subKey) {
    if (!mActive) {
        return 0;
    }
    if (!visibleTo(player.getRealName())) {
        return 0;
    }
    auto const subIt = mSubchunkCells.find(subKey);
    if (subIt == mSubchunkCells.end()) {
        return 0;
    }

    std::vector<HoloBlockChange> changes;
    changes.reserve(subIt->second.size());
    for (auto const index : subIt->second) {
        if (mFilledCells.find(index) != mFilledCells.end()) {
            continue; // 这一格是真方块，不能拿 ghost 盖回去
        }
        auto const& entry = mBlocks[index];
        changes.push_back({entry.x, entry.y, entry.z, entry.runtimeId, BatchEncoder::kUpdateFlags, 0, 0});
    }
    if (changes.empty()) {
        return 0;
    }

    std::vector<EncodedPacket> packets;
    if (BatchEncoder::getInstance().encode(changes, packets) == 0) {
        return 0;
    }
    auto&       sender = PacketSender::getInstance();
    std::size_t sent   = 0;
    for (auto const& packet : packets) {
        if (sender.send(player, packet.packetId, packet.body)) {
            ++sent;
        }
    }
    return sent;
}

void ProjectionSession::afterGhostPush(::Player& player) {
    if (!mActive || mFilledCells.empty()) {
        return;
    }
    if (!visibleTo(player.getRealName())) {
        return;
    }
    correctFilledFor(player);
    for (auto const subKey : mFilledSubchunks) {
        repaintSubchunkKeyFor(player, subKey);
    }
}

void ProjectionSession::repaintOne(std::int32_t x, std::int32_t y, std::int32_t z, std::uint32_t runtimeId) {
    // 关键：不能立刻发。PlayerDestroyBlockEvent 在引擎把方块更新发给客户端之前触发，
    // 立刻发 ghost 会被随后到达的 air 覆盖。延迟 150ms 让引擎的更新先落地。
    ::ll::thread::ServerThreadExecutor::getDefault().executeAfter(
        [this, x, y, z, runtimeId]() {
            if (!mActive) {
                return;
            }

            // 这 150ms 里这一格可能又被真方块填上了（投影打印机补回 / 另一个玩家放回）：
            // 再发 ghost 就是「客户端假方块 + 服务端真方块」的叠加态 —— 客户端能穿过去
            // （ghost 的 collision_box 是 false），服务端却把玩家弹回来。
            if (isFilled(x, y, z)) {
                return;
            }

            std::vector<HoloBlockChange> changes{
                {x, y, z, runtimeId, BatchEncoder::kUpdateFlags, 0, 0}
            };
            std::vector<EncodedPacket> packets;
            if (BatchEncoder::getInstance().encode(changes, packets) == 0) {
                return;
            }
            auto level = ::ll::service::getLevel();
            if (!level) {
                return;
            }
            auto&       sender = PacketSender::getInstance();
            std::size_t sent   = 0;
            level->forEachPlayer([&](::Player& player) {
                // 私有会话：旁人收不到补格包。
                if (!visibleTo(player.getRealName())) {
                    return true;
                }
                // 按玩家自己的维度确认这一格还是空气：不是空气就不能拿 ghost 盖它
                // （否则客户端显示假方块、服务端是真方块，走过去照样被弹）。
                auto& source = player.getDimensionBlockSource();
                if (!source.getBlock(::BlockPos{x, y, z}).isAir()) {
                    return true;
                }
                for (auto const& packet : packets) {
                    if (sender.send(player, packet.packetId, packet.body)) {
                        ++sent;
                    }
                }
                return true;
            });
            ++mStats.repaints;
        },
        std::chrono::milliseconds(kRepaintDelayMs)
    );
}

// ───────────────────────── 共享 / 私有（可见性） ─────────────────────────

void ProjectionSession::setOwner(std::string owner) { mOwner = std::move(owner); }

bool ProjectionSession::privateMode() const {
    if (mOwner.empty()) {
        return false;
    }
    return !share::sharedFor(mOwner);
}

bool ProjectionSession::visibleTo(std::string const& playerName) const {
    if (mOwner.empty()) {
        return true; // 控制台建的会话没有主人，恒为共享
    }
    if (playerName == mOwner) {
        return true;
    }
    return share::sharedFor(mOwner);
}

std::size_t ProjectionSession::revokeFrom(::Player& player) {
    auto const name = player.getRealName();
    mViewers.erase(name);
    if (mShownIndices.empty()) {
        return 0;
    }

    auto level = ::ll::service::getLevel();
    if (!level) {
        return 0;
    }
    auto dimension = level->getDimension(player.getDimensionId()).lock();
    if (!dimension) {
        return 0;
    }
    auto& source = dimension->getBlockSourceFromMainChunkSource();

    // 收回的做法和 clear 一样：读世界的真实方块发回去，客户端就把假方块擦掉。
    std::vector<HoloBlockChange> changes;
    changes.reserve(mShownIndices.size());
    for (auto const index : mShownIndices) {
        auto const& entry = mBlocks[index];
        auto const& block = source.getBlock(::BlockPos{entry.x, entry.y, entry.z});
        changes.push_back(
            {entry.x,
             entry.y,
             entry.z,
             static_cast<std::uint32_t>(block.mNetworkId),
             BatchEncoder::kUpdateFlags,
             0,
             0}
        );
    }

    std::vector<EncodedPacket> packets;
    auto const                 encoded = BatchEncoder::getInstance().encode(changes, packets);
    auto&                      sender  = PacketSender::getInstance();
    for (auto const& packet : packets) {
        sender.send(player, packet.packetId, packet.body);
    }
    return encoded;
}

// ─────────────────────────── 显示层镜像 / 重发调度 ───────────────────────────

std::size_t ProjectionSession::prepareLayers(::CommandOutput& output, std::int32_t from, std::int32_t to) {
    if (!mActive) {
        output.error("没有活动会话：先 /lit load <file> [x y z]");
        return 0;
    }

    auto const low  = std::min(from, to);
    auto const high = std::max(from, to);
    if (high < mBounds.from || low > mBounds.to) {
        output.error("层 {}~{} 超出投影范围 {}~{}", low, high, mBounds.from, mBounds.to);
        return 0;
    }

    std::vector<HoloBlockChange> changes;
    std::vector<std::size_t>     indices;
    for (std::size_t i = 0; i < mBlocks.size(); ++i) {
        auto const& entry = mBlocks[i];
        if (entry.y < low || entry.y > high) {
            continue;
        }
        indices.push_back(i);
        changes.push_back({entry.x, entry.y, entry.z, entry.runtimeId, BatchEncoder::kUpdateFlags, 0, 0});
    }

    if (changes.empty()) {
        output.success("层 {}~{} 没有方块", low, high);
        return 0;
    }

    std::vector<EncodedPacket> packets;
    auto const                 encoded = BatchEncoder::getInstance().encode(changes, packets);
    if (encoded == 0) {
        output.error("编码失败：批量通道不可用");
        return 0;
    }

    mShownIndices = std::move(indices);
    mShownPackets = std::move(packets);
    mShown        = LayerRange{low, high};
    mViewers.clear();

    refreshWireframe();

    output.success(
        "§b[层就绪]§r 层 {}~{}：{} 格 → {} 包（当前无玩家，已缓存；玩家进服后数秒内自动补发）",
        low,
        high,
        changes.size(),
        encoded
    );
    return encoded;
}

void ProjectionSession::sendCachedTo(::Player& player) {
    if (mShownPackets.empty()) {
        return;
    }
    if (!visibleTo(player.getRealName())) {
        return; // 私有会话：补发也轮不到旁人
    }
    auto& sender = PacketSender::getInstance();
    for (auto const& packet : mShownPackets) {
        sender.send(player, packet.packetId, packet.body);
    }

    auto& keys = mViewers[player.getRealName()];
    keys.clear();
    keys.reserve(mShownIndices.size());
    for (auto const index : mShownIndices) {
        auto const& entry = mBlocks[index];
        keys.insert(packKey(entry.x, entry.y, entry.z));
    }
    mStats.sentPackets += mShownPackets.size();
    ++mStats.resyncs;

    // 缓存的预编码包不带「哪些格已经被真方块填了」的信息，
    // 所以发完必须把已填充格压回真方块，否则重登/传送/心跳之后又会出现叠加态。
    afterGhostPush(player);
}

void ProjectionSession::refreshWireframe() {
    auto& wireframe = Wireframe::getInstance();
    if (!mActive || !wireframe.enabled()) {
        wireframe.hide(mId);
        return;
    }

    // 私有会话不画包围盒线框：hologramlib 的 DebugShape 是全局形状、没有按玩家隔离的接口，
    // 画出来等于把「投影在哪」直接告诉所有人。
    if (privateMode()) {
        wireframe.hide(mId);
        return;
    }

    if (mMinX > mMaxX || mMinZ > mMaxZ) {
        wireframe.hide(mId);
        return;
    }

    // 有显示层就框住显示层；没有就框住整份投影（load 后先给一个"投影在哪"的答案）。
    bool const haveShown = !mShownIndices.empty() && mShown.from <= mShown.to;
    std::int32_t const yFrom = haveShown ? mShown.from : mBounds.from;
    std::int32_t const yTo   = haveShown ? mShown.to : mBounds.to;
    if (yFrom > yTo) {
        wireframe.hide(mId);
        return;
    }

    // 显示中的层用绿色，仅有投影范围（还没切层）用黄色。
    float const r = haveShown ? 0.35f : 1.00f;
    float const g = haveShown ? 0.95f : 0.85f;
    float const b = haveShown ? 0.45f : 0.20f;

    wireframe.show(
        mId,
        static_cast<float>(mMinX),
        static_cast<float>(yFrom),
        static_cast<float>(mMinZ),
        static_cast<float>(mMaxX + 1),
        static_cast<float>(yTo + 1),
        static_cast<float>(mMaxZ + 1),
        r,
        g,
        b,
        1.0f
    );
}

ProjectionSession::MirrorInfo ProjectionSession::mirror() const {
    MirrorInfo info;
    info.viewers         = mViewers.size();
    info.blocksPerViewer = mShownIndices.size();
    info.cachedPackets   = mShownPackets.size();
    return info;
}

std::size_t ProjectionSession::rotate(::CommandOutput& output, ::Player* player) {
    if (!mActive) {
        output.error("没有活动会话：先 /lit load <file> [x y z]");
        return 0;
    }

    auto const wasShown = !mShownIndices.empty();
    auto const from     = mShown.from;
    auto const to       = mShown.to;

    if (wasShown && player != nullptr) {
        std::size_t ignored = clear(output, *player);
        (void)ignored;
    }

    mRotation = (mRotation + 90) % 360;

    for (auto& entry : mBlocks) {
        std::int32_t nx = 0;
        std::int32_t nz = 0;
        switch (mRotation) {
        case 90:
            nx = mFootprintD - 1 - entry.odz;
            nz = entry.odx;
            break;
        case 180:
            nx = mFootprintW - 1 - entry.odx;
            nz = mFootprintD - 1 - entry.odz;
            break;
        case 270:
            nx = entry.odz;
            nz = mFootprintW - 1 - entry.odx;
            break;
        case 0:
        default:
            nx = entry.odx;
            nz = entry.odz;
            break;
        }
        entry.x = mBaseX + nx;
        entry.z = mBaseZ + nz;
    }

    mIndex.clear();
    mIndex.reserve(mBlocks.size() * 2);
    for (std::uint32_t i = 0; i < mBlocks.size(); ++i) {
        mIndex.emplace(packKey(mBlocks[i].x, mBlocks[i].y, mBlocks[i].z), i);
    }

    // 子区块索引重建（坐标变了）。
    mSubchunkCells.clear();
    for (std::uint32_t i = 0; i < mBlocks.size(); ++i) {
        auto const& e = mBlocks[i];
        mSubchunkCells[packKey(e.x >> 4, e.y >> 4, e.z >> 4)].push_back(i);
    }

    // 世界里的真方块不会跟着投影转，已填充记录全部作废，ghost 重新接管所有格。
    mFilledCells.clear();
    mFilledSubchunks.clear();
    mBrokenAt.clear();

    // 坐标全变了，旧镜像失效。
    mViewers.clear();

    // 诊断：旋转后的 XZ 包围盒（宽深应互换）。
    std::int32_t minX = INT32_MAX;
    std::int32_t maxX = INT32_MIN;
    std::int32_t minZ = INT32_MAX;
    std::int32_t maxZ = INT32_MIN;
    for (auto const& entry : mBlocks) {
        minX = std::min(minX, entry.x);
        maxX = std::max(maxX, entry.x);
        minZ = std::min(minZ, entry.z);
        maxZ = std::max(maxZ, entry.z);
    }
    // x/z 都变了；显示层存在时随后 showLayers/prepareLayers 会重画线框，
    // 没显示层时旧框已在 clear() 收起。
    mMinX = minX;
    mMaxX = maxX;
    mMinZ = minZ;
    mMaxZ = maxZ;

    output.success(
        "§b[旋转]§r 当前 {}°，占用 X {}~{}（{}）/ Z {}~{}（{}）",
        mRotation,
        minX,
        maxX,
        maxX - minX + 1,
        minZ,
        maxZ,
        maxZ - minZ + 1
    );

    if (!wasShown) {
        output.success("已旋转到 {}°（当前没有显示层；/lit layer <from> [to] 后再看）", mRotation);
        return 0;
    }
    if (player != nullptr) {
        return showLayers(output, *player, from, to);
    }
    return prepareLayers(output, from, to);
}


core::report::MaterialReport ProjectionSession::materials() const {
    // 只喂「每格的调色板下标」，聚合逻辑在 core/report 里（纯数据、可离线回归）。
    std::vector<std::uint32_t> paletteIds;
    paletteIds.reserve(mBlocks.size());
    for (auto const& entry : mBlocks) {
        paletteIds.push_back(entry.paletteId);
    }

    // 可放置性是会话加载时解析好的（`mPaletteBlocks`）：不做这一步的话，
    // 清单里会混进「映射失败、根本放不出来」的方块，玩家按清单备料会被误导。
    std::vector<bool> placeable;
    if (!mPaletteBlocks.empty()) {
        placeable.reserve(mPaletteBlocks.size());
        for (auto const* block : mPaletteBlocks) {
            placeable.push_back(block != nullptr);
        }
    }

    return core::report::countMaterials(mPalette, paletteIds, placeable.empty() ? nullptr : &placeable);
}

std::uint32_t ProjectionSession::internPalette(std::string const& stateText) {
    if (auto const it = mPaletteIds.find(stateText); it != mPaletteIds.end()) {
        return it->second;
    }
    auto const id = static_cast<std::uint32_t>(mPalette.size());
    mPalette.push_back(stateText);
    mPaletteIds.emplace(stateText, id);
    return id;
}


ProjectionSession::PlaceResult ProjectionSession::place(
    ::CommandOutput&    output,
    ::Player*           player,
    std::int32_t        from,
    std::int32_t        to,
    PlaceOptions const& options
) {
    PlaceResult result;

    if (!mActive) {
        output.error("没有活动会话：先 /lit load <file> [x y z]");
        return result;
    }

    auto level = ::ll::service::getLevel();
    if (!level) {
        output.error("当前没有加载的世界");
        return result;
    }

    auto const low  = std::min(from, to);
    auto const high = std::max(from, to);

    // 目标 BlockSource，按可靠性排序：
    //   1. 玩家 —— Actor::getDimensionBlockSource() 是 MCFOLD，直接读成员，最可靠；
    //   2. 运行时捕获 —— hook BlockSource:: / $setBlock 见过的实例；
    //   3. 逐个维度 id —— Level::getDimension（本服务端实测恒为空，留着兜底）；
    //   4. 已加载 region 集合。
    ::BlockSource* sourcePtr = nullptr;
    std::string    sourceHow;

    auto contextPlayer = player;
    if (contextPlayer == nullptr) {
        level->forEachPlayer([&](::Player& candidate) {
            contextPlayer = &candidate;
            return false;
        });
    }
    if (contextPlayer != nullptr) {
        sourcePtr = &contextPlayer->getDimensionBlockSource();
        sourceHow = "玩家 " + contextPlayer->getRealName();
    }
    if (sourcePtr == nullptr) {
        sourcePtr = capturedBlockSource();
        if (sourcePtr != nullptr) {
            sourceHow = "运行时捕获";
        }
    }
    if (sourcePtr == nullptr) {
        for (int id = 0; id < 16 && sourcePtr == nullptr; ++id) {
            auto dimension = level->getDimension(::DimensionType{id}).lock();
            if (dimension) {
                sourcePtr = &dimension->getBlockSourceFromMainChunkSource();
                sourceHow = "维度 id " + std::to_string(id);
            }
        }
    }
    if (sourcePtr == nullptr) {
        auto& regions = *level->mRegions;
        if (!regions.empty() && regions.size() < 64) {
            for (auto* region : regions) {
                if (region != nullptr) {
                    sourcePtr = region;
                    sourceHow = "已加载 region";
                    break;
                }
            }
        }
    }
    if (sourcePtr == nullptr && !options.dryRun) {
        output.error(
            "拿不到 BlockSource：控制台执行需要至少一名玩家在线（或在游戏里执行 /lit place）"
        );
        return result;
    }

    // 先把 ghost 层收回：真实方块放下去后，残留的假方块会和它抢同一格。
    if (!options.dryRun && options.clearGhost && !mShownIndices.empty()) {
        ::Player* viewer = contextPlayer;
        if (viewer != nullptr) {
            std::size_t ignored = clear(output, *viewer);
            (void)ignored;
        } else {
            mShownIndices.clear();
            mShownPackets.clear();
            mViewers.clear();
            mShown = LayerRange{0, -1};
            Wireframe::getInstance().hide(mId);
        }
    }

    // 待放清单：自下而上（y → x → z），依附类方块才不会悬空判定失败。
    std::vector<std::uint32_t> order;
    order.reserve(mBlocks.size());
    for (std::uint32_t i = 0; i < mBlocks.size(); ++i) {
        auto const& entry = mBlocks[i];
        if (entry.y < low || entry.y > high) {
            continue;
        }
        order.push_back(i);
    }
    if (order.empty()) {
        output.error("层 {}~{} 没有方块", low, high);
        return result;
    }
    std::sort(order.begin(), order.end(), [this](std::uint32_t a, std::uint32_t b) {
        auto const& left  = mBlocks[a];
        auto const& right = mBlocks[b];
        if (left.y != right.y) {
            return left.y < right.y;
        }
        if (left.x != right.x) {
            return left.x < right.x;
        }
        return left.z < right.z;
    });

    // 单次写入上限：PlaceOptions::maxBlocks 为 0 时跟随 config/projection.json 的 maxPlaceBlocks。
    auto const placeCap = options.maxBlocks != 0 ? options.maxBlocks : limits::options().maxPlaceBlocks;
    auto const limit    = std::min(order.size(), placeCap);
    auto&      placer   = mapping::PlaceResolve::getInstance();
    placer.ensureLoaded();

    // ---- 区块预加载 ----
    // BDS 往未加载区块写方块会失败（CALL 在 /fill 上实测的报错是「无法在世界外放置方块」，
    // 走 API 就是 setBlock 返回 false）。所以先把投影覆盖到的 chunk 同步拉起来再逐格写。
    ::ChunkSource* chunkSource = nullptr;
    if (sourcePtr != nullptr && !options.dryRun) {
        chunkSource = &sourcePtr->getChunkSource();
    }
    if (chunkSource != nullptr && limit > 0) {
        std::int32_t firstCx = mBlocks[order[0]].x >> 4;
        std::int32_t lastCx  = firstCx;
        std::int32_t firstCz = mBlocks[order[0]].z >> 4;
        std::int32_t lastCz  = firstCz;
        for (std::size_t k = 0; k < limit; ++k) {
            auto const& entry = mBlocks[order[k]];
            auto const  cx    = entry.x >> 4;
            auto const  cz    = entry.z >> 4;
            firstCx           = std::min(firstCx, cx);
            lastCx            = std::max(lastCx, cx);
            firstCz           = std::min(firstCz, cz);
            lastCz            = std::max(lastCz, cz);
        }
        for (auto cx = firstCx; cx <= lastCx; ++cx) {
            for (auto cz = firstCz; cz <= lastCz; ++cz) {
                auto chunk = chunkSource->$getOrLoadChunk(
                    ::ChunkPos{cx, cz},
                    ::ChunkSource::LoadMode::None,
                    false
                );
                if (chunk) {
                    ++result.loadedChunks;
                } else {
                    ++result.failedChunks;
                }
            }
        }
    }

    // 写成功后记几格，收尾再回读一次：这是「真的写进了世界」的硬证据。
    struct ReadbackSample {
        ::BlockPos   pos;
        std::uint64_t stateHash{};
    };
    std::vector<ReadbackSample> samples;
    samples.reserve(3);

    auto const started = std::chrono::steady_clock::now();

    for (std::size_t k = 0; k < limit; ++k) {
        auto const& entry     = mBlocks[order[k]];
        auto const& stateText = mPalette[entry.paletteId];
        auto const  resolved  = placer.resolve(stateText, mIsBedrockSource);

        if (resolved.block == nullptr) {
            ++result.unresolved;
            if (result.firstUnresolved.empty()) {
                result.firstUnresolved = stateText;
            }
            if (options.dryRun && result.unresolvedSamples.size() < 8) {
                result.unresolvedSamples.push_back(
                    stateText + "  ⇒  " + placer.explain(stateText, mIsBedrockSource)
                );
            }
            continue;
        }
        if (!resolved.stateApplied) {
            ++result.stateIgnored;
            if (options.dryRun && result.ignoredSamples.size() < 6
                && std::find(
                       result.ignoredSamples.begin(),
                       result.ignoredSamples.end(),
                       stateText
                   )
                       == result.ignoredSamples.end()) {
                result.ignoredSamples.push_back(stateText + "  ⇒  " + resolved.sample);
            }
        }
        switch (resolved.precision) {
        case mapping::PlaceResolve::Precision::Exact:
            ++result.exact;
            break;
        case mapping::PlaceResolve::Precision::Mapped:
            ++result.mapped;
            break;
        case mapping::PlaceResolve::Precision::Default:
            ++result.defaulted;
            break;
        case mapping::PlaceResolve::Precision::Failed:
            break;
        }

        if (options.dryRun) {
            ++result.placed; // 干跑：把「能放」记在 placed 上
            continue;
        }

        ::BlockPos const pos{entry.x, entry.y, entry.z};
        if (!options.overwrite && !sourcePtr->getBlock(pos).isAir()) {
            ++result.skipped;
            continue;
        }
        // 写完必须回读校验：setBlock 返回 true 也可能没落地（区块未就绪、被邻居更新顶掉）。
        // 比对用 mSerializationIdHash —— mNetworkId 是方块类型级的，同方块不同状态共用一个值，
        // 拿它比对会把「状态丢了」当成成功。
        auto const written = [&]() {
            return sourcePtr->getBlock(pos).mSerializationIdHash == resolved.block->mSerializationIdHash;
        };

        bool ok = sourcePtr->setBlockAndRetainCompatibleBlockActor(pos, *resolved.block, kPlaceUpdateFlags);
        if (!ok || !written()) {
            // 再拉一次区块后重试：未加载区块的写入会静默失败。
            if (chunkSource != nullptr) {
                (void)chunkSource->$getOrLoadChunk(
                    ::ChunkPos{pos.x >> 4, pos.z >> 4},
                    ::ChunkSource::LoadMode::None,
                    false
                );
            }
            ok = sourcePtr->setBlockAndRetainCompatibleBlockActor(pos, *resolved.block, kPlaceUpdateFlags);
            if (ok && written()) {
                ++result.retried;
            }
        }

        if (ok && written()) {
            ++result.placed;
            if (samples.size() < 3) {
                samples.push_back({pos, resolved.block->mSerializationIdHash});
            }
        } else {
            if (ok) {
                ++result.mismatched; // 报成功但回读不一致
            }
            ++result.failed;
        }
    }

    result.pending = order.size() - limit;

    auto const ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                        std::chrono::steady_clock::now() - started
    )
                        .count();

    if (options.dryRun) {
        output.success(
            "§b[试算]§r {}：层 {}~{} → 可放置 {} 格 / 解析失败 {} 格，耗时 {} ms",
            mFile,
            low,
            high,
            result.placed,
            result.unresolved,
            ms
        );
        output.success(
            "    精度：原样 {} / 改名 {} / 仅默认状态 {}",
            result.exact,
            result.mapped,
            result.defaulted
        );
        if (result.stateIgnored > 0) {
            output.success(
                "    状态与默认相同 {} 格（含本来就等于默认值的方块；朝向请游戏内确认）",
                result.stateIgnored
            );
            for (std::size_t i = 0; i < result.ignoredSamples.size() && i < 3; ++i) {
                output.success("       {}", result.ignoredSamples[i]);
            }
        }

        for (auto const& sample : result.unresolvedSamples) {
            output.success("    失败例：{}", sample);
        }
        if (!mPalette.empty()) {
            output.success("    调色板：{} 项（去重后的方块状态）", mPalette.size());
        }
        return result;
    }

    output.success(
        "§b[放置]§r {}：层 {}~{}（{}）→ 写入 {} 格（跳过 {} 已有方块 / 解析失败 {} / 写入失败 {}），耗时 {} ms",
        mFile,
        low,
        high,
        sourceHow,
        result.placed,
        result.skipped,
        result.unresolved,
        result.failed,
        ms
    );
    output.success("    精度：原样 {} / 改名 {} / 仅默认状态 {}", result.exact, result.mapped, result.defaulted);
    if (!samples.empty() && sourcePtr != nullptr) {
        std::size_t matched = 0;
        for (auto const& sample : samples) {
            if (sourcePtr->getBlock(sample.pos).mSerializationIdHash == sample.stateHash) {
                ++matched;
            }
        }
        output.success("    收尾回读：{}/{} 格状态与目标一致", matched, samples.size());
    }
    if (result.loadedChunks > 0 || result.failedChunks > 0) {
        output.success("    区块：加载 {} 个 / 失败 {}", result.loadedChunks, result.failedChunks);
    }
    if (result.retried > 0) {
        output.success("    {} 格在重载区块后写成功", result.retried);
    }
    if (result.mismatched > 0) {
        output.error("    {} 格 setBlock 报成功但回读不一致（区块或 tick 竞争）", result.mismatched);
    }
    if (!result.firstUnresolved.empty()) {
        output.error("放不下的状态串示例：{}", result.firstUnresolved);
    }
    if (result.pending > 0) {
        output.error(
            "还有 {} 格超出单次上限 {}，用 /lit place <from> <to> 分层继续"
            "（上限改 config/projection.json 的 maxPlaceBlocks）",
            result.pending,
            placeCap
        );
    }
    return result;
}

} // namespace litematicabe::ghost
