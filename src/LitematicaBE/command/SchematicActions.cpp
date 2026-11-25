#include "LitematicaBE/command/SchematicActions.h"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include "LitematicaBE/core/schematic/LitematicFile.h"
#include "LitematicaBE/core/schematic/McstructureFile.h"
#include "LitematicaBE/core/place/PlaceConfig.h"
#include "LitematicaBE/core/save/SaveConfig.h"
#include "LitematicaBE/core/util/TextEncoding.h"
#include "LitematicaBE/ghost/BatchEncoder.h"
#include "LitematicaBE/ghost/DispatchQueue.h"
#include "LitematicaBE/ghost/ProjectionManager.h"
#include "LitematicaBE/ghost/ProjectionLimits.h"
#include "LitematicaBE/ghost/PacketSender.h"
#include "LitematicaBE/ghost/SurfaceCull.h"
#include "LitematicaBE/mapping/BlockStateResolve.h"
#include "LitematicaBE/mapping/GhostMap.h"
#include "LitematicaBE/printer/Printer.h"

#include "ll/api/mod/Mod.h"
#include "ll/api/mod/NativeMod.h"
#include "ll/api/service/Bedrock.h"

#include "mc/server/commands/CommandOutput.h"
#include "mc/world/actor/player/Player.h"
#include "mc/world/level/BlockPos.h"
#include "mc/world/level/Level.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <string>
#include <unordered_map>
#include <vector>

namespace litematicabe::command::schematic {

namespace {

namespace ghost = litematicabe::ghost;
namespace util  = litematicabe::util;

std::string toUtf8(std::filesystem::path const& path) { return util::toUtf8(path); }

std::string pathToUtf8(std::filesystem::path const& path) { return util::toUtf8(path); }

std::string lowerAscii(std::string text) {
    for (char& c : text) {
        if (c >= 'A' && c <= 'Z') {
            c = static_cast<char>(c - 'A' + 'a');
        }
    }
    return text;
}

std::string stripSchemeExt(std::string name) {
    for (auto const* ext : {".litematic", ".mcstructure"}) {
        auto const len = std::strlen(ext);
        if (name.size() > len && lowerAscii(name.substr(name.size() - len)) == ext) {
            name.resize(name.size() - len);
        }
    }
    return name;
}

// 控制台会把 GBK 字节当 Latin-1 再编码成 UTF-8（双跳）；这里把 U+0080..U+00FF 还原成单字节。
std::string restoreLatin1(std::string const& raw) {
    std::string out;
    out.reserve(raw.size());
    for (std::size_t i = 0; i < raw.size();) {
        auto const c = static_cast<unsigned char>(raw[i]);
        if (c < 0x80) {
            out.push_back(static_cast<char>(c));
            ++i;
            continue;
        }
        if ((c & 0xE0) == 0xC0 && i + 1 < raw.size()) {
            unsigned const cp = ((c & 0x1Fu) << 6) | (static_cast<unsigned char>(raw[i + 1]) & 0x3Fu);
            if (cp >= 0x80 && cp <= 0xFF) {
                out.push_back(static_cast<char>(cp));
                i += 2;
                continue;
            }
        }
        out.push_back(static_cast<char>(c));
        ++i;
    }
    return out;
}

// 命令参数的编码没法可靠判断：游戏内是 UTF-8，控制台可能是 GBK，GBK 字节还可能被双跳。
// 这里把几种解释都给出，让调用方逐个试。
std::vector<std::filesystem::path> interpretationsOf(std::string const& raw) {
    std::vector<std::filesystem::path> out;
    auto push = [&out](std::filesystem::path candidate) {
        if (candidate.empty()) {
            return;
        }
        for (auto const& existing : out) {
            if (existing == candidate) {
                return;
            }
        }
        out.push_back(std::move(candidate));
    };

    // 游戏内聊天栏给的是 UTF-8；控制台可能是 GBK，GBK 还可能被双跳成 Latin-1（U+00xx）。
    // 这里绝不直接 `std::filesystem::path{std::string}` —— 那会按本地代码页转换，
    // 中文 UTF-8 字节在 GBK 里非法，会抛 std::system_error（ERROR_NO_UNICODE_TRANSLATION）。
    //
    // 顺序按命中概率排：每个候选都只用来拼路径，最后由 exists() 决定用哪个。
    push(util::fromUtf8(raw));                  // 游戏内：原始 UTF-8
    push(util::fromAcp(restoreLatin1(raw)));    // 控制台：双跳还原成 GBK 字节后按 ACP
    push(util::fromAcp(raw));                   // 控制台：原始 GBK
    push(util::fromUtf8(restoreLatin1(raw)));   // 还原后本来就是 UTF-8 的情况

    return out;
}

// 目录扫描兜底：解决编码差异、大小写、少写扩展名。
std::filesystem::path scanForFile(std::filesystem::path const& dir, std::string const& raw) {
    std::error_code ec;
    if (!std::filesystem::is_directory(dir, ec)) {
        return {};
    }
    auto const needle = lowerAscii(stripSchemeExt(raw));
    for (auto const& entry : std::filesystem::directory_iterator(dir, ec)) {
        if (!entry.is_regular_file(ec)) {
            continue;
        }
        auto const candidate = lowerAscii(stripSchemeExt(toUtf8(entry.path().filename())));
        if (candidate == needle) {
            return entry.path();
        }
    }
    return {};
}

} // namespace

std::filesystem::path resolveFile(std::string const& raw) {
    auto const interpretations = interpretationsOf(raw);
    if (interpretations.empty()) {
        return {};
    }

    std::error_code ec;

    // 绝对路径：先按原样试，再按其它编码解释试。
    for (auto const& p : interpretations) {
        if (p.is_absolute() && std::filesystem::exists(p, ec)) {
            return p;
        }
    }

    if (auto nativeMod = ::ll::mod::NativeMod::current()) {
        auto const dir  = nativeMod->getModDir() / "schematics";
        auto const base = nativeMod->getModDir();

        // 允许省略扩展名：my_project → my_project.litematic
        for (auto const& p : interpretations) {
            std::filesystem::path candidates[] = {
                dir / p,
                dir / (p.wstring() + L".litematic"),
                dir / (p.wstring() + L".mcstructure"),
                base / p,
            };
            for (auto const& candidate : candidates) {
                if (std::filesystem::exists(candidate, ec)) {
                    return candidate;
                }
            }
        }

        // 精确候选都不存在：退化成目录扫描（解决编码差异/大小写/少写扩展名）。
        if (auto scanned = scanForFile(dir, raw); !scanned.empty()) {
            return scanned;
        }

        // 诊断：把入参字节与每个候选的解析结果写进日志，用于定位编码问题。
        if (auto current = ::ll::mod::NativeMod::current()) {
            std::string diag = "resolveFile miss: raw-hex=";
            char        buf[8]{};
            for (unsigned char c : raw) {
                std::snprintf(buf, sizeof(buf), "%02X ", c);
                diag += buf;
            }
            for (auto const& p : interpretations) {
                std::error_code inner;
                diag += " | ";
                diag += pathToUtf8(p);
                diag += std::filesystem::exists(p, inner) ? "=exists" : "=missing";
            }
            current->getLogger().warn("{}", diag);
        }
        return dir / interpretations.front();
    }
    return interpretations.front();
}

void printInfo(::CommandOutput& output, std::string const& file) {
    auto const path = resolveFile(file);
    if (path.empty()) {
        output.error("文件名无法识别：{}（用 /lit list 看可用文件）", util::sanitizeUtf8(file));
        return;
    }

    auto const start = std::chrono::steady_clock::now();

    auto ext = toUtf8(path.extension());
    std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });

    if (ext == ".mcstructure") {
        core::schematic::McstructureFile structure;
        auto const                       error = core::schematic::readMcstructure(path, structure);
        if (!error.ok()) {
            output.error("解析失败：{}（{}）", error.message, pathToUtf8(path));
            return;
        }

        output.success("§b[投影信息]§r {}", pathToUtf8(path.filename()));
        output.success(
            "格式：.mcstructure（基岩结构）格式版本 {} / 方块数据版本 {}",
            structure.formatVersion,
            structure.dataVersion
        );
        output.success(
            "尺寸：{} × {} × {}（{} 格），调色板 {} 项，方块实体 {}，实体 {}",
            structure.size[0],
            structure.size[1],
            structure.size[2],
            static_cast<std::size_t>(structure.size[0]) * structure.size[1] * structure.size[2],
            structure.palette.size(),
            structure.blockEntityData,
            structure.entityCount
        );

        std::unordered_map<std::string, std::size_t> histogram;
        std::size_t                                  nonAir = 0;
        std::string                                  sample;
        bool const ok = core::schematic::forEachBlock(structure, [&](core::schematic::BlockRef const& ref) {
            ++nonAir;
            ++histogram[std::string{ref.name}];
            if (nonAir <= 5) {
                if (!sample.empty()) {
                    sample += "、";
                }
                sample += "(" + std::to_string(ref.x) + "," + std::to_string(ref.y) + "," + std::to_string(ref.z)
                        + ")" + std::string{ref.name};
            }
            return true;
        });
        if (!ok) {
            output.error("block_indices 无法解码（长度不足或调色板为空）");
            return;
        }
        output.success("非空气方块 {}", nonAir);
        output.success("§7前 5 格：{}§r", sample);

        std::vector<std::pair<std::string, std::size_t>> top{histogram.begin(), histogram.end()};
        std::sort(top.begin(), top.end(), [](auto const& a, auto const& b) { return a.second > b.second; });
        if (!top.empty()) {
            std::string line;
            auto const  limit = std::min<std::size_t>(top.size(), 10);
            for (std::size_t i = 0; i < limit; ++i) {
                line += top[i].first + "×" + std::to_string(top[i].second);
                if (i + 1 < limit) {
                    line += "、";
                }
            }
            output.success("  前 10 种：{}", line);
        }

        auto const ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                            std::chrono::steady_clock::now() - start
        )
                            .count();
        output.success("解析完成：非空气 {} 格，耗时 {} ms", nonAir, ms);
        return;
    }

    core::schematic::LitematicFile litematic;
    auto const                     error = core::schematic::readLitematic(path, litematic);
    if (!error.ok()) {
        output.error("解析失败：{}（{}）", error.message, pathToUtf8(path));
        return;
    }

    output.success("§b[投影信息]§r {}", toUtf8(path));
    output.success(
        "名称：{} / 作者：{} / 数据版本 {}",
        litematic.name.empty() ? "(无)" : litematic.name,
        litematic.author.empty() ? "(无)" : litematic.author,
        litematic.dataVersion
    );
    output.success(
        "包围盒：{} × {} × {}，区域 {} 个，文件声明方块 {}",
        litematic.enclosingSize[0],
        litematic.enclosingSize[1],
        litematic.enclosingSize[2],
        litematic.regions.size(),
        litematic.totalBlocks
    );

    std::unordered_map<std::string, std::size_t> histogram;
    std::size_t                                  nonAir = 0;
    std::size_t                                  broken = 0;

    for (auto const& region : litematic.regions) {
        output.success(
            "  区域 {}：pos ({}, {}, {}) size {} × {} × {} 调色板 {}",
            region.name,
            region.position[0],
            region.position[1],
            region.position[2],
            region.size[0],
            region.size[1],
            region.size[2],
            region.palette.size()
        );

        std::size_t count = 0;
        bool const  ok    = core::schematic::forEachBlock(region, [&](core::schematic::BlockRef const& ref) {
            ++count;
            ++histogram[std::string{ref.name}];
            return true;
        });
        if (!ok) {
            ++broken;
            output.error("  区域 {} 的 BlockStates 无法解码（长度不足或调色板为空）", region.name);
            continue;
        }
        nonAir += count;
        output.success("    非空气方块 {}", count);
    }

    std::vector<std::pair<std::string, std::size_t>> top{histogram.begin(), histogram.end()};
    std::sort(top.begin(), top.end(), [](auto const& a, auto const& b) { return a.second > b.second; });
    if (!top.empty()) {
        std::string line;
        auto const  limit = std::min<std::size_t>(top.size(), 10);
        for (std::size_t i = 0; i < limit; ++i) {
            line += top[i].first + "×" + std::to_string(top[i].second);
            if (i + 1 < limit) {
                line += "、";
            }
        }
        output.success("  前 10 种：{}", line);
    }

    auto const ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                        std::chrono::steady_clock::now() - start
    )
                        .count();
    output.success("解析完成：非空气 {} 格，耗时 {} ms{}", nonAir, ms, broken > 0 ? "（有区域解码失败）" : "");
}

void loadProjection(::CommandOutput& output, ::Player& player, std::string const& file) {
    auto const pos  = player.getFeetBlockPos();
    auto const path = resolveFile(file);
    if (path.empty()) {
        output.error("找不到投影文件：{}（用 /lit list 看可用文件）", util::sanitizeUtf8(file));
        return;
    }

    // owner = 执行者：可见性按他的 /lit share 开关决定（默认共享）。
    auto* session =
        ghost::ProjectionManager::getInstance().create(output, path, pos.x, pos.y, pos.z, player.getRealName());
    if (session == nullptr) {
        return;
    }
    auto const bounds = session->bounds();
    session->showLayers(output, player, bounds.from, bounds.to);
}
void loadProjectionAt(::CommandOutput& output, std::string const& file, int x, int y, int z) {
    auto const path = resolveFile(file);
    if (path.empty()) {
        output.error("找不到投影文件：{}（用 /lit list 看可用文件）", util::sanitizeUtf8(file));
        return;
    }

    auto* session = ghost::ProjectionManager::getInstance().create(output, path, x, y, z);
    if (session == nullptr) {
        return;
    }

    auto const bounds = session->bounds();
    ::Player*  first  = nullptr;
    if (auto level = ::ll::service::getLevel()) {
        level->forEachPlayer([&](::Player& p) {
            first = &p;
            return false;
        });
    }

    if (first == nullptr) {
        session->prepareLayers(output, bounds.from, bounds.to);
        return;
    }
    session->showLayers(output, *first, bounds.from, bounds.to);
}
void switchLayers(::CommandOutput& output, ::Player& player, int from, int to) {
    auto* session = ghost::ProjectionManager::getInstance().active();
    if (session == nullptr) {
        output.error("没有活动会话：先 /lit load <file> [x y z]");
        return;
    }
    session->showLayers(output, player, static_cast<std::int32_t>(from), static_cast<std::int32_t>(to));
}
void unloadProjection(::CommandOutput& output, ::Player& player) {
    auto* session = ghost::ProjectionManager::getInstance().active();
    if (session == nullptr) {
        output.error("没有活动会话：先 /lit load <file> [x y z]");
        return;
    }
    session->clear(output, player);
}
void reportSession(::CommandOutput& output) {
    auto& manager = ghost::ProjectionManager::getInstance();
    auto* session = manager.active();
    if (session == nullptr) {
        output.error("没有活动会话：先 /lit load <file> [x y z]");
        return;
    }
    auto const bounds = session->bounds();
    auto const shown  = session->shown();
    output.success(
        "会话 #{}：{}，{} 格，层范围 {}~{}（共 {} 份投影）",
        session->id(),
        session->label(),
        session->blockCount(),
        bounds.from,
        bounds.to,
        manager.stats().sessions
    );
    if (shown.from > shown.to) {
        output.success("当前没有显示任何层（进入游戏后 /lit layer <from> [to]）");
    } else {
        output.success("当前显示：层 {}~{}", shown.from, shown.to);
    }
}
void rotateProjection(::CommandOutput& output, ::Player* player) {
    auto* session = ghost::ProjectionManager::getInstance().active();
    if (session == nullptr) {
        output.error("没有活动会话：先 /lit load <file> [x y z]");
        return;
    }
    session->rotate(output, player);
}
void prepareLayers(::CommandOutput& output, int from, int to) {
    auto* session = ghost::ProjectionManager::getInstance().active();
    if (session == nullptr) {
        output.error("没有活动会话：先 /lit load <file> [x y z]");
        return;
    }
    session->prepareLayers(output, from, to);
}
void resendAll(::CommandOutput& output) {
    auto* session = ghost::ProjectionManager::getInstance().active();
    if (session == nullptr) {
        output.error("没有活动会话：先 /lit load <file> [x y z]");
        return;
    }
    auto const mirror = session->mirror();
    if (mirror.cachedPackets == 0) {
        output.error("当前没有显示任何层（先 /lit layer <from> [to]）");
        return;
    }

    auto level = ::ll::service::getLevel();
    if (!level) {
        output.error("当前没有加载的世界");
        return;
    }

    std::size_t players = 0;
    level->forEachPlayer([&](::Player& player) {
        // 私有会话：旁人不算「重发对象」。
        if (!session->visibleTo(player.getRealName())) {
            return true;
        }
        session->sendCachedTo(player);
        ++players;
        return true;
    });

    if (players == 0) {
        output.success("当前没有在线玩家，未重发（缓冲 {} 包 / {} 格）", mirror.cachedPackets, mirror.blocksPerViewer);
        return;
    }
    output.success(
        "已向 {} 名玩家重发当前层：{} 格 / {} 包{}",
        players,
        mirror.blocksPerViewer,
        mirror.cachedPackets,
        session->privateMode() ? "（私有：只有主人收到）" : ""
    );
}
void placeProjection(::CommandOutput& output, ::Player* player, int from, int to) {
    auto* session = ghost::ProjectionManager::getInstance().active();
    if (session == nullptr) {
        output.error("没有活动会话：先 /lit load <file> [x y z]");
        return;
    }

    // 使用门槛（config/place.json）：默认要求创造模式、不要求管理员。
    // 控制台没有玩家对象，不受这两条限制。
    if (player != nullptr) {
        std::string reason;
        if (!core::place::checkAccess(*player, reason)) {
            output.error("§c/lit place 被拒绝§r：{}", reason);
            return;
        }
    }

    // `/lit place` 就是「覆盖式直接放置」（旧 /lit replace 的语义）：
    // 目标位置已有非空气方块也照样写。
    ghost::ProjectionSession::PlaceOptions options;
    options.overwrite = true;
    session->place(output, player, from, to, options);
}

void listProjects(::CommandOutput& output) {
    ghost::ProjectionManager::getInstance().list(output);
}

void selectProjection(::CommandOutput& output, int id) {
    ghost::ProjectionManager::getInstance().select(output, static_cast<std::uint32_t>(id));
}

void removeProjection(::CommandOutput& output, int id, ::Player* player) {
    ghost::ProjectionManager::getInstance().remove(output, static_cast<std::uint32_t>(id), player);
}

void reloadData(::CommandOutput& output) {
    auto& map    = mapping::GhostMap::getInstance();
    auto& states = mapping::BlockStateResolve::getInstance();

    states.clear();

    if (!map.loadFromModDir()) {
        output.error("映射表重载失败：{}", map.lastError());
    } else {
        output.success("映射表已重载：{} 个方块条目，状态解析缓存已清空", map.stats().blocks);
    }

    // 打印机配置与映射表一起热重载（改完 config/printer.json 不必重启）。
    if (printer::reloadOptions()) {
        output.success("打印机配置已重载（config/printer.json）");
    } else {
        output.error("打印机配置重载失败（沿用旧值，详情见服务器日志）");
    }

    // `/lit place` 的使用门槛同样热重载（config/place.json）。
    std::string placeError;
    if (core::place::reloadOptions(placeError)) {
        output.success("直接放置门槛已重载（config/place.json）：{}", core::place::describe());
    } else {
        output.error("直接放置门槛重载失败（沿用旧值）：{}", util::sanitizeUtf8(placeError));
    }

    // 投影的两处方块数上限（config/projection.json）：加载收集上限 + 单次放置上限。
    std::string limitsError;
    if (ghost::limits::reloadOptions(limitsError)) {
        output.success("投影上限已重载（config/projection.json）：{}", ghost::limits::describe());
    } else {
        output.error("投影上限重载失败（沿用旧值）：{}", util::sanitizeUtf8(limitsError));
    }

    // 投影保存的配置（config/save.json）：默认格式、体积上限、门槛、覆盖策略。
    std::string saveError;
    if (core::save::reloadOptions(saveError)) {
        output.success("保存配置已重载（config/save.json）：{}", core::save::describe());
    } else {
        output.error("保存配置重载失败（沿用旧值）：{}", util::sanitizeUtf8(saveError));
    }
}

void listFiles(::CommandOutput& output) {
    auto nativeMod = ::ll::mod::NativeMod::current();
    if (!nativeMod) {
        output.error("拿不到模组目录");
        return;
    }
    auto const dir = nativeMod->getModDir() / "schematics";

    std::error_code ec;
    if (!std::filesystem::is_directory(dir, ec)) {
        output.error("目录不存在：{}（把 .litematic 放进这个目录）", pathToUtf8(dir));
        return;
    }

    std::vector<std::pair<std::string, std::uintmax_t>> files;
    for (auto const& entry : std::filesystem::directory_iterator(dir, ec)) {
        if (!entry.is_regular_file(ec)) {
            continue;
        }
        auto const ext = pathToUtf8(entry.path().extension());
        if (ext != ".litematic" && ext != ".mcstructure") {
            continue;
        }
        // 文件名用 u8string：Windows 上 string() 是本地编码（GBK），直接输出到 UTF-8 的控制台会乱码。
        auto const u8 = entry.path().filename().u8string();
        files.emplace_back(std::string(reinterpret_cast<char const*>(u8.data()), u8.size()), entry.file_size(ec));
    }
    std::sort(files.begin(), files.end(), [](auto const& a, auto const& b) { return a.first < b.first; });

    if (files.empty()) {
        output.success("目录里没有投影文件：{}", pathToUtf8(dir));
        return;
    }
    output.success("§b[可用投影]§r {}", pathToUtf8(dir));
    for (auto const& [name, size] : files) {
        output.success("  {} （{} KB）", name, size / 1024);
    }
    output.success("§7用 /lit info <file> 看统计，/lit load <file> 铺设§r");
}

} // namespace litematicabe::command::schematic
