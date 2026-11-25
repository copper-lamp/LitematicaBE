#include "LitematicaBE/command/ProbeActions.h"

#include "LitematicaBE/ghost/DispatchQueue.h"

#include "LitematicaBE/mapping/BlockStateText.h"
#include "LitematicaBE/mapping/JavaStateConvert.h"
#include "LitematicaBE/mapping/PlaceResolve.h"

#include "ll/api/service/Bedrock.h"

#include "mc/world/level/BlockSource.h"
#include "mc/world/level/DimensionManager.h"
#include "mc/world/level/Level.h"
#include "mc/world/level/block/Block.h"
#include "mc/nbt/CompoundTag.h"
#include "mc/world/level/block/states/BlockState.h"
#include "mc/world/level/dimension/Dimension.h"

#include "LitematicaBE/Version.h"
#include "LitematicaBE/core/place/PlaceConfig.h"
#include "LitematicaBE/easyplace/EasyPlace.h"
#include "LitematicaBE/printer/Printer.h"
#include "LitematicaBE/ghost/BatchEncoder.h"
#include "LitematicaBE/ghost/BlockHook.h"
#include "LitematicaBE/ghost/ProjectionManager.h"
#include "LitematicaBE/ghost/PacketSender.h"
#include "LitematicaBE/ghost/ShareSwitch.h"
#include "LitematicaBE/ghost/Wireframe.h"
#include "LitematicaBE/hologram/HologramFacade.h"
#include "LitematicaBE/hologram/ShapeDrawer.h"
#include "LitematicaBE/mapping/BlockStateResolve.h"
#include "LitematicaBE/mapping/GhostMap.h"

#include "mc/server/commands/CommandOutput.h"
#include "mc/world/actor/player/Player.h"
#include "mc/world/level/BlockPos.h"

#include <windows.h>

#include <cstdint>
#include <string>
#include <vector>

namespace litematicabe::command::probe {

namespace {

namespace ghost = litematicabe::ghost;

std::string moduleState(wchar_t const* module) {
    return ::GetModuleHandleW(module) != nullptr ? "已加载" : "未加载";
}

} // namespace

void printState(::CommandOutput& output) {
    auto&      facade     = hologram::HologramFacade::getInstance();
    auto const path       = facade.probe();
    auto&      states     = mapping::BlockStateResolve::getInstance();
    auto&      encoder    = ghost::BatchEncoder::getInstance();
    auto&      map        = mapping::GhostMap::getInstance();
    auto const stateStats = states.stats();
    auto const& sendStats = ghost::PacketSender::getInstance().stats();
    auto const mapStats   = map.stats();

    output.success("§b[LitematicaBE]§r v{}（{}）", kVersion, kTargetBaseline);
    output.success("显示通道：{} / {}", hologram::toString(path), facade.describe());
    output.success(
        "状态解析：命中 {} 未命中 {} 失败 {} 缓存 {}",
        stateStats.hits,
        stateStats.misses,
        stateStats.failures,
        stateStats.cached
    );
    output.success(
        "映射表：{} 块 / 命中 {} 未命中 {} 缓存 {}",
        mapStats.blocks,
        mapStats.hits,
        mapStats.misses,
        mapStats.cacheSize
    );
    output.success(
        "编码器：packetId={} 已编码 {} 包 / 失败 {}",
        encoder.packetId(),
        encoder.stats().packets,
        encoder.stats().failed
    );
    output.success(
        "发包：成功 {} 字节 {} noPeer {} noNetwork {}",
        sendStats.sent,
        sendStats.bytes,
        sendStats.noPeer,
        sendStats.noNetwork
    );

    // 队列当前不参与发送（load/clear 都是同步发），只报「未启用」，避免 tick=0 造成误判。
    auto&       manager   = ghost::ProjectionManager::getInstance();
    auto const  mgrStats  = manager.stats();
    auto&       wireframe = ghost::Wireframe::getInstance();
    output.success(
        "包围盒线框：{} / 当前 {} 条",
        wireframe.enabled() ? "开" : "关",
        wireframe.count()
    );
    output.success("方块 hook：set {} 次 → repaint {} 次", ghost::blockSetCalls(), mgrStats.repaints);
    if (auto const queue = ghost::DispatchQueue::getInstance().stats(); queue.pendingJobs > 0 || queue.sent > 0) {
        output.success(
            "调度：首包同步 + 队列分帧（排队 {} 包 / {} 组，已发 {} 包，丢弃 {}）",
            queue.pendingPackets,
            queue.pendingJobs,
            queue.sent,
            queue.dropped
        );
    } else {
        output.success("调度：首包同步 + 队列分帧（队列空闲）");
    }

    output.success("{}", easyplace::describe());
    output.success("{}", printer::describe());
    output.success("{}", ghost::share::describe());
    output.success("{}", core::place::describe());
    if (auto* session = manager.active()) {
        auto const mirror = session->mirror();
        output.success(
            "当前投影 #{} / 共 {} 份；镜像 {} 名玩家 / 每名 {} 格 / 缓存 {} 包；重发 {} 次",
            session->id(),
            mgrStats.sessions,
            mirror.viewers,
            mirror.blocksPerViewer,
            mirror.cachedPackets,
            session->stats().resyncs
        );
    } else {
        output.success("当前没有投影会话（/lit load <file> 新建）");
    }
}


void diagnose(::CommandOutput& output) {
    auto level = ::ll::service::getLevel();
    if (!level) {
        output.error("level: null（服务未注册）");
        return;
    }
    output.success("level 指针有效");
    output.success("tick = {} / time = {} / seed = {}", level->getCurrentTick().tickID, level->getTime(), level->getSeed());

    for (int id = 0; id < 4; ++id) {
        auto weakRef = level->getDimension(::DimensionType{id});
        auto dimension = weakRef.lock();
        auto const* rawPtr = *reinterpret_cast<void* const*>(&weakRef);
        auto const* control = *(reinterpret_cast<void* const*>(&weakRef) + 1);
        output.success(
            "  dim {}: lock={} raw={} ctrl={}",
            id,
            dimension ? "ok" : "null",
            rawPtr,
            control
        );
        if (!dimension && rawPtr != nullptr) {
            auto aliased = *reinterpret_cast<std::shared_ptr<::Dimension>*>(&weakRef);
            output.success("     按 shared_ptr 读：get={} use={}", (void*)aliased.get(), aliased.use_count());
            if (aliased) {
                auto& source = aliased->getBlockSourceFromMainChunkSource();
                output.success("     BlockSource ok，(0,64,0) 网络 id = {}", source.getBlock(::BlockPos{0, 64, 0}).mNetworkId);
            }
        } else if (dimension) {
            auto& source = dimension->getBlockSourceFromMainChunkSource();
            output.success("     BlockSource ok，(0,64,0) 网络 id = {}", source.getBlock(::BlockPos{0, 64, 0}).mNetworkId);
        }
    }
    output.success("mRegions = {}", (*level->mRegions).size());
    output.success("mDimensions = {}", (*level->getDimensionManager().mDimensions).size());
    output.success("playerList = {}", level->getPlayerList().size());

    // ---- 值域探测：门 / 活板门 / 铁轨 / 拉杆 ----
    // hash 只说明「这个状态名被采纳了」，说明不了「值对应哪个方向」。
    // 这里能确认的是：状态名对不对、值域是否被区分、有没有被忽略。
    {
        auto hashOf = [](::Block const* block) -> std::string {
            if (block == nullptr) {
                return "null------------";
            }
            char buffer[32]{};
            std::snprintf(
                buffer,
                sizeof(buffer),
                "%016llx",
                static_cast<unsigned long long>(block->mSerializationIdHash)
            );
            return buffer;
        };

        auto probeGroup = [&](char const* name, std::vector<std::pair<std::string, mapping::StatePairs>> const& cases) {
            auto base      = ::Block::tryGetFromRegistry(std::string_view{name});
            auto baseBlock = base ? base.operator->() : nullptr;
            output.success("{}  默认 {}", name, hashOf(baseBlock));
            for (auto const& [label, states] : cases) {
                CompoundTag nbt;
                nbt["name"] = std::string{name};
                CompoundTag stateTag;
                for (auto const& [key, value] : states) {
                    if (value == "true" || value == "false") {
                        stateTag[key] = value == "true";
                    } else {
                        char* end      = nullptr;
                        long  intValue = std::strtol(value.c_str(), &end, 10);
                        if (end != nullptr && *end == '\0' && !value.empty()) {
                            stateTag[key] = static_cast<int>(intValue);
                        } else {
                            stateTag[key] = value;
                        }
                    }
                }
                nbt["states"]  = std::move(stateTag);
                nbt["version"] = 18168865;
                auto block     = ::Block::tryGetFromRegistry(nbt);
                auto* ptr      = block ? block.operator->() : nullptr;
                char  diff[24]{};
                std::snprintf(
                    diff,
                    sizeof(diff),
                    "%s",
                    (ptr != nullptr && baseBlock != nullptr
                     && ptr->mSerializationIdHash != baseBlock->mSerializationIdHash)
                        ? "★生效"
                        : "  同默认"
                );
                output.success("   {} → {} {}", label, hashOf(ptr), diff);
            }
        };

        probeGroup(
            "minecraft:wooden_door",
            {
                {"direction=0", {{"direction", "0"}}},
                {"direction=1", {{"direction", "1"}}},
                {"direction=2", {{"direction", "2"}}},
                {"direction=3", {{"direction", "3"}}},
                {"cardinal_direction=north", {{"minecraft:cardinal_direction", "north"}}},
                {"direction=0+upper", {{"direction", "0"}, {"upper_block_bit", "true"}}},
            }
        );
        probeGroup(
            "minecraft:trapdoor",
            {
                {"direction=0", {{"direction", "0"}}},
                {"direction=2", {{"direction", "2"}}},
                {"cardinal_direction=north", {{"minecraft:cardinal_direction", "north"}}},
                {"cardinal_direction=east", {{"minecraft:cardinal_direction", "east"}}},
                {"upside_down_bit=true", {{"upside_down_bit", "true"}}},
            }
        );
        probeGroup(
            "minecraft:bed",
            {
                {"direction=0", {{"direction", "0"}}},
                {"direction=2", {{"direction", "2"}}},
                {"cardinal_direction=north", {{"minecraft:cardinal_direction", "north"}}},
                {"head_piece_bit=true", {{"head_piece_bit", "true"}}},
            }
        );
        probeGroup(
            "minecraft:oak_fence_gate",
            {
                {"direction=0", {{"direction", "0"}}},
                {"direction=2", {{"direction", "2"}}},
                {"cardinal_direction=north", {{"minecraft:cardinal_direction", "north"}}},
            }
        );
        probeGroup(
            "minecraft:rail",
            {
                {"rail_direction=0", {{"rail_direction", "0"}}},
                {"rail_direction=1", {{"rail_direction", "1"}}},
                {"rail_direction=9", {{"rail_direction", "9"}}},
            }
        );
        probeGroup(
            "minecraft:lever",
            {
                {"lever_direction=west (字符串)", {{"lever_direction", "west"}}},
                {"lever_direction=1 (整数)", {{"lever_direction", "1"}}},
                {"lever_direction=down_north_south", {{"lever_direction", "down_north_south"}}},
                {"lever_direction=down_east_west", {{"lever_direction", "down_east_west"}}},
                {"lever_direction=up_north_south", {{"lever_direction", "up_north_south"}}},
                {"lever_direction=up_east_west", {{"lever_direction", "up_east_west"}}},
                {"lever_direction=north", {{"lever_direction", "north"}}},
            }
        );
    }

    // BlockSource 可用性：放置能不能跑，就看这两行。
    {
        ghost::installBlockSourceCapture(); // 幂等
        output.success(
            "BlockSource：hook {} / 实例 {}",
            ghost::blockSourceCaptureInstalled() ? "已挂" : "未挂",
            ghost::capturedBlockSource() != nullptr
                ? "已捕获"
                : "未捕获（世界空闲时不触发；有玩家时直接用玩家维度）"
        );
    }

    // 带状态查方块的正确姿势见 mapping::PlaceResolve（走方块 NBT，裸键 + 强类型）。
    // 下面这组是「Java 状态 → Bedrock 状态 → 注册表」的端到端自检：
    // hash 与默认状态不同，才算朝向真的被吃进去了。
    {
        struct Case {
            char const*     name;
            mapping::StatePairs java;
        };
        Case const cases[] = {
            {"oak_stairs", {{"facing", "east"}, {"half", "top"}, {"waterlogged", "false"}}},
            {"piston", {{"facing", "up"}, {"extended", "true"}}},
            {"oak_door", {{"facing", "north"}, {"half", "lower"}, {"hinge", "left"}, {"open", "false"}}},
            {"repeater", {{"facing", "south"}, {"delay", "3"}, {"powered", "false"}}},
            {"observer", {{"facing", "east"}, {"powered", "false"}}},
            {"torch", {{"facing", "up"}}},
            {"oak_slab", {{"type", "top"}, {"waterlogged", "false"}}},
            {"hopper", {{"facing", "down"}, {"enabled", "false"}}},
        };
        auto hashOf = [](::Block const* block) -> std::string {
            if (block == nullptr) {
                return "null------------";
            }
            char buffer[32]{};
            std::snprintf(
                buffer,
                sizeof(buffer),
                "%016llx",
                static_cast<unsigned long long>(block->mSerializationIdHash)
            );
            return buffer;
        };

        auto& placer = mapping::PlaceResolve::getInstance();
        for (auto const& item : cases) {
            auto const converted = mapping::convertJavaState(item.name, item.java);
            auto const stateText
                = std::string{"minecraft:"} + item.name + mapping::buildStateText("", item.java);
            auto const result = placer.resolve(stateText, false);

            std::string statesText;
            for (auto const& [k, v] : converted.states) {
                if (!statesText.empty()) {
                    statesText += ",";
                }
                statesText += k + "=" + v;
            }
            auto baseBlock
                = ::Block::tryGetFromRegistry(std::string_view{std::string{"minecraft:"} + item.name});
            output.success(
                "  {} → [{}] 生效={} hash {} / 默认 {}",
                item.name,
                statesText,
                result.stateApplied ? "是" : "否",
                hashOf(result.block),
                hashOf(baseBlock ? baseBlock.operator->() : nullptr)
            );
        }
    }

}

void printProbe(::CommandOutput& output) {
    auto& facade = hologram::HologramFacade::getInstance();
    auto  path   = facade.probe();

    output.success("§b=== LitematicaBE 能力探针 ===§r");
    output.success("版本：{} / 基线 {}", kVersion, kTargetBaseline);
    output.success(
        "构建：HologramLib={} 显示通道={}",
        hologram::HologramFacade::compiledWithHologramLib() ? "编入" : "未编入",
        hologram::toString(path)
    );
    output.success("前置模块：HologramLib.dll {}", moduleState(L"HologramLib.dll"));

    auto& shapeDrawer = hologram::ShapeDrawer::getInstance();
    // 先求值再打印：available() 里才触发探测，实参求值顺序不能依赖。
    bool const shapeOk = shapeDrawer.available();
    output.success(
        "形状通道（包围盒线框）：{}（{}）",
        shapeOk ? "可用" : "不可用",
        shapeDrawer.reason()
    );

    auto const& api = facade.batchApi();
    output.success(
        "编码器：来源 {} / 完整 {} / packetId {}",
        facade.batchEncoderModule(),
        api.complete() ? "是" : "否",
        ghost::BatchEncoder::getInstance().packetId()
    );

    auto&        states  = mapping::BlockStateResolve::getInstance();
    char const*  samples[] = {
        "minecraft:stone",
        "minecraft:air",
        "lit:g_acacia_door[lit:dir=2]",
        "minecraft:oak_stairs[upside_down_bit=false,weirdo_direction=2]",
    };
    for (auto const* text : samples) {
        std::uint32_t id = 0;
        auto const    ok = states.resolve(text, id);
        output.success("  {} → {}", text, ok ? std::to_string(id) : std::string{"失败"});
    }

    auto& map = mapping::GhostMap::getInstance();
    if (map.ensureLoaded()) {
        output.success("映射表：已加载 {} 个方块条目", map.stats().blocks);
        std::vector<std::pair<std::string, std::string>> stoneStates;
        auto const stone = map.resolve("minecraft:stone", stoneStates);
        std::vector<std::pair<std::string, std::string>> stairsStates{{"half", "top"}, {"facing", "east"}};
        auto const stairs = map.resolve("minecraft:oak_stairs", stairsStates);
        output.success("  minecraft:stone → {}", stone.ghost);
        output.success("  minecraft:oak_stairs[half=top,facing=east] → {}", stairs.ghost);
    } else {
        output.error("映射表未加载：{}", map.lastError());
    }

    output.success("§7/lit info <file> 看投影统计；/lit load <file> 铺投影；/lit share 改可见性§r");
}

} // namespace litematicabe::command::probe
