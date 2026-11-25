#include "LitematicaBE/printer/Printer.h"

#include "LitematicaBE/core/place/PlaceGuard.h"
#include "LitematicaBE/ghost/ProjectionManager.h"
#include "LitematicaBE/ghost/ProjectionSession.h"
#include "LitematicaBE/printer/PrinterConfig.h"

#include "ll/api/mod/Mod.h"
#include "ll/api/mod/NativeMod.h"
#include "ll/api/service/Bedrock.h"
#include "ll/api/thread/ServerThreadExecutor.h"

#include "mc/world/actor/Actor.h"
#include "mc/world/actor/player/Inventory.h"
#include "mc/world/actor/player/Player.h"
#include "mc/world/level/BlockPos.h"
#include "mc/world/level/BlockSource.h"
#include "mc/world/level/ChunkPos.h"
#include "mc/world/level/GameType.h"
#include "mc/world/level/Level.h"
#include "mc/world/level/block/Block.h"
#include "mc/world/level/block/BlockType.h"
#include "mc/world/level/chunk/ChunkSource.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace litematicabe::printer {

namespace {

namespace place = litematicabe::core::place;

// 放置时的方块更新标志：0x1 通知邻居 + 0x2 同步到客户端（与 `/lit place` 同一组值）。
constexpr int kPlaceUpdateFlags = 3;

// 全部状态都在服务端主线程读写（定时器 / 命令回调同一线程），因此不加锁。
Options                                       gOptions{};
bool                                          gInstalled{false};
bool                                          gRunning{false};
std::unordered_set<std::string>               gEnabled;
Stats                                         sStats{};
std::unordered_map<std::string, std::int64_t> gLastNoticeMs;

std::int64_t nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

// 同一玩家同一类提示的最小间隔。
bool noticeAllowed(::Player& player, std::int64_t cooldownMs) {
    auto const now  = nowMs();
    auto&      last = gLastNoticeMs[player.getRealName()];
    if (last != 0 && now - last < cooldownMs) {
        return false;
    }
    last = now;
    return true;
}

void notifyMissingItem(::Player& player, ::BlockType const& type) {
    if (!noticeAllowed(player, gOptions.notifyCooldownMs)) {
        return;
    }
    player.sendMessage("§e[投影打印机] 背包里没有 §f" + type.getTypeName() + "§e，已跳过该格§r");
}

void notifyNoShownLayer(::Player& player) {
    if (!noticeAllowed(player, gOptions.notifyCooldownMs)) {
        return;
    }
    player.sendMessage("§e[投影打印机] 先 /lit layer <from> [to] 选定要打印的层§r");
}

// 玩家碰撞盒（0.6 × 1.8，脚在 pos.y）是否与该格相交。
bool overlapsPlayer(::Player& player, int x, int y, int z) {
    auto const  pos  = player.getPosition();
    float const minX = pos.x - 0.3f;
    float const maxX = pos.x + 0.3f;
    float const minZ = pos.z - 0.3f;
    float const maxZ = pos.z + 0.3f;
    float const minY = pos.y;
    float const maxY = pos.y + 1.8f;

    return maxX > static_cast<float>(x) && minX < static_cast<float>(x + 1) && maxZ > static_cast<float>(z)
        && minZ < static_cast<float>(z + 1) && maxY > static_cast<float>(y) && minY < static_cast<float>(y + 1);
}

struct Candidate {
    int            x{};
    int            y{};
    int            z{};
    float          dist2{};
    ::Block const* target{}; //< 该格投影要求的目标方块（注册表单例，整轮有效）
};

// 逐格写入 + 回读校验；失败时补载一次区块再试。
bool writeCell(::BlockSource& source, ::BlockPos const& pos, ::Block const& target) {
    auto const written = [&]() {
        // 不能拿 mNetworkId 比对：方块类型级的值，同类型不同状态共用一个 id。
        return source.getBlock(pos).mSerializationIdHash == target.mSerializationIdHash;
    };

    bool ok = source.setBlockAndRetainCompatibleBlockActor(pos, target, kPlaceUpdateFlags);
    if (ok && written()) {
        return true;
    }

    // 未加载区块的写入会静默失败：补载一次再重试。
    (void)source.getChunkSource()
        .$getOrLoadChunk(::ChunkPos{pos.x >> 4, pos.z >> 4}, ::ChunkSource::LoadMode::None, false);
    ok = source.setBlockAndRetainCompatibleBlockActor(pos, target, kPlaceUpdateFlags);
    return ok && written();
}

void runForPlayer(::Player& player, ghost::ProjectionSession& session);

void runOnce() {
    auto level = ::ll::service::getLevel();
    if (!level) {
        return;
    }
    auto* session = ghost::ProjectionManager::getInstance().active();
    if (session == nullptr || !session->active()) {
        return;
    }

    level->forEachPlayer([session](::Player& player) {
        if (!enabledFor(player.getRealName())) {
            return true;
        }
        if (player.isDead()) {
            return true;
        }
        if (player.getPlayerGameType() == ::GameType::Spectator) {
            return true;
        }
        runForPlayer(player, *session);
        return true;
    });

    ++sStats.rounds;
}

void runForPlayer(::Player& player, ghost::ProjectionSession& session) {
    ++sStats.playerRuns;

    // ── 范围：先按层限制收窄 y，再与投影自身范围求交 ──
    auto span = session.bounds();
    if (gOptions.layerLimited) {
        auto const shown = session.shown();
        if (shown.from > shown.to) {
            notifyNoShownLayer(player);
            return;
        }
        span.from = std::max(span.from, shown.from);
        span.to   = std::min(span.to, shown.to);
    }

    auto const  ground = player.getPosition();
    float const cx     = ground.x;
    float const cy     = ground.y + static_cast<float>(gOptions.eyeOffsetMilli) / 1000.0f;
    float const cz     = ground.z;
    float const range  = gOptions.range;
    float const range2 = range * range;

    int const yLow  = std::max(span.from, static_cast<int>(std::floor(cy - range)));
    int const yHigh = std::min(span.to, static_cast<int>(std::floor(cy + range)));
    if (yLow > yHigh) {
        return;
    }

    int const radiusCells = static_cast<int>(std::ceil(range));
    int const xLow        = static_cast<int>(std::floor(cx)) - radiusCells;
    int const xHigh       = static_cast<int>(std::floor(cx)) + radiusCells;
    int const zLow        = static_cast<int>(std::floor(cz)) - radiusCells;
    int const zHigh       = static_cast<int>(std::floor(cz)) + radiusCells;

    // ── 候选：球内 + 属于投影 + 还没填充（targetCell 内部先做 XZ AABB 拒绝） ──
    std::vector<Candidate> candidates;
    candidates.reserve(128);
    for (int y = yLow; y <= yHigh; ++y) {
        for (int x = xLow; x <= xHigh; ++x) {
            for (int z = zLow; z <= zHigh; ++z) {
                float const dx = static_cast<float>(x) + 0.5f - cx;
                float const dy = static_cast<float>(y) + 0.5f - cy;
                float const dz = static_cast<float>(z) + 0.5f - cz;
                float const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 > range2) {
                    continue;
                }
                ::Block const* target = nullptr;
                if (!session.targetCell(x, y, z, target) || target == nullptr) {
                    continue; // 不在投影里，或该格解析不出可放置方块
                }
                if (session.isFilled(x, y, z)) {
                    continue;
                }
                // 玩家刚拆掉这一格：冷却期内不补，否则玩家永远拆不掉打印区，
                // 而且「挖掉 → 补回」会反复触发 ghost 补发，容易踩到叠加态。
                if (gOptions.respectPlayerBreaks && session.brokenRecently(x, y, z, gOptions.playerBreakCooldownMs)) {
                    ++sStats.playerBreakSkipped;
                    continue;
                }
                if (gOptions.skipPlayerCells && overlapsPlayer(player, x, y, z)) {
                    ++sStats.playerCellSkipped;
                    continue;
                }
                candidates.push_back({x, y, z, d2, target});
            }
        }
    }
    sStats.candidates += candidates.size();
    if (candidates.empty()) {
        return;
    }

    // 自下而上（依附 / 下落类先落地），同层由近到远。
    std::sort(candidates.begin(), candidates.end(), [](Candidate const& a, Candidate const& b) {
        if (a.y != b.y) {
            return a.y < b.y;
        }
        return a.dist2 < b.dist2;
    });

    // ── 逐格放置 ──
    auto&      source     = player.getDimensionBlockSource();
    auto&      inv        = player.getInventory();
    auto const opts       = gOptions; // 本轮快照：reload 不会在一轮中途改参数
    bool const creative   = player.getPlayerGameType() == ::GameType::Creative;
    bool const needItem   = creative ? !opts.creativeFree : opts.consumeInSurvival;
    int const  preferSlot = player.getSelectedItemSlot();

    std::vector<std::string_view> extraReplaceable;
    extraReplaceable.reserve(opts.extraReplaceable.size());
    for (auto const& name : opts.extraReplaceable) {
        extraReplaceable.emplace_back(name);
    }

    place::RiskFilter riskFilter;
    riskFilter.blockEntity = opts.skipBlockEntities;
    riskFilter.multiblock  = opts.skipMultiblock;
    riskFilter.fluid       = opts.skipFluids;

    int  placed   = 0;
    bool invDirty = false;

    for (auto const& cell : candidates) {
        if (placed >= opts.maxPerRound) {
            break;
        }

        ::Block const* target = cell.target;
        if (target == nullptr) {
            continue;
        }

        ::BlockPos const pos{cell.x, cell.y, cell.z};
        auto const&      current = source.getBlock(pos);

        // 世界已经是目标方块：顺手登记已填充，ghost 层不再盖它。
        if (current.mSerializationIdHash == target->mSerializationIdHash) {
            session.markFilled(cell.x, cell.y, cell.z);
            ++sStats.alreadyRight;
            continue;
        }

        // 非空气格：只放空气，还是要连可替换方块一起顶掉。
        if (!current.isAir()) {
            bool const replaceable = !opts.onlyAir
                                  && place::isReplaceableForPrint(
                                      current,
                                      extraReplaceable.data(),
                                      static_cast<unsigned>(extraReplaceable.size())
                                  );
            if (!replaceable) {
                ++sStats.occupiedSkipped;
                continue;
            }
        }

        auto const& targetType = target->getBlockType();
        if (place::isRiskyType(targetType, riskFilter)) {
            ++sStats.riskySkipped;
            continue;
        }

        // 扣料：手上没有就看背包。创造模式默认豁免。
        int slot = -1;
        if (needItem) {
            slot = place::findBlockItemSlot(inv, targetType, preferSlot);
            if (slot < 0) {
                ++sStats.noItem;
                notifyMissingItem(player, targetType);
                continue;
            }
        }

        if (!writeCell(source, pos, *target)) {
            ++sStats.writeFailed;
            continue;
        }

        // 写成功之后才扣料；槽位在两步之间没变，这里再确认一次只是防御。
        if (needItem) {
            if (!place::stackIsBlockType(inv.getItem(slot), targetType)) {
                slot = place::findBlockItemSlot(inv, targetType, preferSlot);
            }
            if (slot >= 0) {
                inv.removeItem(slot, 1);
                invDirty = true;
            } else {
                ++sStats.freePlaced;
            }
        }

        // ghost 层：这一格从此是真方块，后续发包跳过它。
        session.markFilled(cell.x, cell.y, cell.z);
        ++placed;
        ++sStats.placed;
    }

    if (invDirty) {
        // 一轮一次批量同步，而不是每格一包。
        player.sendInventory(false);
        ++sStats.inventorySyncs;
    }
}

void scheduleTick(std::int64_t delayMs) {
    ::ll::thread::ServerThreadExecutor::getDefault().executeAfter(
        []() {
            if (!gRunning) {
                return;
            }
            if (!gEnabled.empty()) {
                runOnce();
            }
            scheduleTick(gOptions.intervalMs);
        },
        std::chrono::milliseconds(delayMs)
    );
}

} // namespace

bool install() {
    if (gInstalled) {
        return true;
    }
    if (!reloadOptions()) {
        // 配置读失败不算致命：用默认值继续跑，玩家仍然可以 /lit printer 打开。
        gOptions = Options{};
    }
    gInstalled = true;
    gRunning   = true;
    scheduleTick(gOptions.intervalMs);

    if (auto mod = ::ll::mod::NativeMod::current()) {
        mod->getLogger().info(
            "printer armed (per-player /lit printer): range={} intervalMs={} maxPerRound={} onlyAir={} "
            "layerLimited={} creativeFree={} consumeInSurvival={}",
            gOptions.range,
            gOptions.intervalMs,
            gOptions.maxPerRound,
            gOptions.onlyAir,
            gOptions.layerLimited,
            gOptions.creativeFree,
            gOptions.consumeInSurvival
        );
    }
    return true;
}

void uninstall() {
    gRunning   = false;
    gInstalled = false;
    gEnabled.clear();
    gLastNoticeMs.clear();
}

bool installed() { return gInstalled; }

bool toggle(std::string const& playerName) {
    if (auto const it = gEnabled.find(playerName); it != gEnabled.end()) {
        gEnabled.erase(it);
        return false;
    }
    gEnabled.insert(playerName);
    return true;
}

bool enabledFor(std::string const& playerName) { return gEnabled.find(playerName) != gEnabled.end(); }

void clearAll() { gEnabled.clear(); }

std::size_t enabledCount() { return gEnabled.size(); }

Options const& options() { return gOptions; }

bool reloadOptions() {
    Options     next{};
    std::string error;
    if (!loadOptionsFile(next, error)) {
        if (auto mod = ::ll::mod::NativeMod::current()) {
            mod->getLogger().warn("printer config NOT reloaded: {}", error);
        }
        return false;
    }
    gOptions = std::move(next);
    return true;
}

Stats stats() { return sStats; }

std::string describe() {
    char buf[384]{};
    std::snprintf(
        buf,
        sizeof(buf),
        "投影打印机：%s / %zu 人在用 / 已放 %llu / 已就位 %llu / 缺料 %llu / 占用跳过 %llu / 风险跳过 %llu"
        " / 破坏冷却 %llu / 失败 %llu / 半径 %.1f 格",
        gInstalled ? "开" : "关",
        gEnabled.size(),
        static_cast<unsigned long long>(sStats.placed),
        static_cast<unsigned long long>(sStats.alreadyRight),
        static_cast<unsigned long long>(sStats.noItem),
        static_cast<unsigned long long>(sStats.occupiedSkipped),
        static_cast<unsigned long long>(sStats.riskySkipped),
        static_cast<unsigned long long>(sStats.playerBreakSkipped),
        static_cast<unsigned long long>(sStats.writeFailed),
        static_cast<double>(gOptions.range)
    );
    return buf;
}

} // namespace litematicabe::printer
