#include "LitematicaBE/core/save/SaveService.h"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include "LitematicaBE/core/save/RegionScan.h"
#include "LitematicaBE/core/schematic/LitematicFile.h"
#include "LitematicaBE/core/schematic/LitematicWriter.h"
#include "LitematicaBE/core/schematic/McstructureFile.h"
#include "LitematicaBE/core/schematic/McstructureWriter.h"
#include "LitematicaBE/core/util/TextEncoding.h"
#include "LitematicaBE/ghost/BlockHook.h"
#include "LitematicaBE/mapping/BedrockToJava.h"
#include "LitematicaBE/mapping/BlockStateText.h"
#include "LitematicaBE/mapping/PlaceResolve.h"

#include "ll/api/mod/NativeMod.h"
#include "ll/api/service/Bedrock.h"
#include "ll/api/thread/ServerThreadExecutor.h"

#include "mc/server/commands/CommandOutput.h"
#include "mc/server/commands/CommandOutputType.h"
#include "mc/world/actor/player/Player.h"
#include "mc/world/level/BlockPos.h"
#include "mc/world/level/BlockSource.h"
#include "mc/world/level/DimensionManager.h"
#include "mc/world/level/Level.h"
#include "mc/world/level/block/Block.h"
#include "mc/world/level/dimension/Dimension.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <ctime>
#include <fstream>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

namespace litematicabe::core::save {

namespace {

namespace util = litematicabe::util;
namespace mb   = litematicabe::mapping;

std::string extensionOf(Format format) {
    switch (format) {
    case Format::Litematic:
        return ".litematic";
    case Format::Mcstructure:
    default:
        return ".mcstructure";
    }
}

std::string lowerAscii(std::string text) {
    for (char& c : text) {
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    }
    return text;
}

std::string stripKnownExtension(std::string name) {
    auto const lower = lowerAscii(name);
    for (auto const* ext : {".litematic", ".mcstructure"}) {
        auto const len = std::string{ext}.size();
        if (lower.size() > len && lower.compare(lower.size() - len, len, ext) == 0) {
            name.resize(name.size() - len);
            break;
        }
    }
    return name;
}

// 没给名字时自动起一个`sel_<yyyyMMdd-HHmmss>`（本地时间，纯 ASCII，不依赖选区坐标）。
std::string autoSaveName() {
    auto const now = std::chrono::system_clock::now();
    auto const seconds = std::chrono::system_clock::to_time_t(now);
    std::tm    local{};
#ifdef _WIN32
    ::localtime_s(&local, &seconds);
#else
    ::localtime_r(&seconds, &local);
#endif
    char buffer[64]{};
    if (std::strftime(buffer, sizeof(buffer), "sel_%Y%m%d-%H%M%S", &local) == 0) {
        return "sel";
    }
    return buffer;
}

// 状态串：`name[k=v,k=v]`（`PlaceResolve` 与 `LitematicFile` 用的是同一套写法）。
std::string joinStateText(std::string const& name, mb::JavaStatePairs const& properties) {
    mb::StatePairs pairs;
    pairs.reserve(properties.size());
    for (auto const& [key, value] : properties) {
        pairs.emplace_back(key, value);
    }
    return mb::buildStateText(name, pairs);
}

// 回读自检：把刚写出的文件解析回来，逐格和世界的方块比 `mSerializationIdHash`。
// 这是本功能唯一能自己证明「导出确实对」的手段：状态提取一旦退化（类型丢了、朝向翻了、调色板错位），这一项会立刻掉下来，而不是等玩家在 Litematica 里发现。
void verifyFile(
    ::CommandOutput&             output,
    ::BlockSource&               source,
    selection::Box const&        box,
    Format                       format,
    std::filesystem::path const& file,
    SaveResult&                  result
) {
    auto& resolver = mb::PlaceResolve::getInstance();
    resolver.ensureLoaded();

    std::size_t total      = 0;
    std::size_t matched    = 0;
    std::size_t failed     = 0;
    std::size_t unresolved = 0;
    std::string firstBad;

    auto const compare = [&](std::int32_t wx, std::int32_t wy, std::int32_t wz, std::string const& stateText) {
        ++total;
        auto const resolved = resolver.resolve(stateText, format == Format::Mcstructure);
        if (resolved.block == nullptr) {
            ++unresolved;
            if (firstBad.empty()) {
                firstBad = stateText + "（解析不出方块）";
            }
            return;
        }
        auto const& world = source.getBlock(::BlockPos{wx, wy, wz});
        if (world.mSerializationIdHash == resolved.block->mSerializationIdHash) {
            ++matched;
            return;
        }
        ++failed;
        if (firstBad.empty()) {
            firstBad = stateText + "（回读状态不一致）";
        }
    };

    if (format == Format::Mcstructure) {
        schematic::McstructureFile parsed;
        auto const                error = schematic::readMcstructure(file, parsed);
        if (!error.ok()) {
            output.error("    回读自检：解析失败（{}）", error.message);
            return;
        }
        schematic::forEachBlock(parsed, [&](schematic::BlockRef const& ref) {
            mb::JavaStatePairs properties;
            if (ref.properties != nullptr) {
                properties = *ref.properties;
            }
            compare(
                box.minX + parsed.origin[0] + ref.x,
                box.minY + parsed.origin[1] + ref.y,
                box.minZ + parsed.origin[2] + ref.z,
                joinStateText(std::string{ref.name}, properties)
            );
            return true;
        });
    } else {
        schematic::LitematicFile parsed;
        auto const               error = schematic::readLitematic(file, parsed);
        if (!error.ok()) {
            output.error("    回读自检：解析失败（{}）", error.message);
            return;
        }
        if (parsed.regions.empty()) {
            output.error("    回读自检：文件里没有 Region");
            return;
        }
        auto const& region = parsed.regions.front();
        schematic::forEachBlock(region, [&](schematic::BlockRef const& ref) {
            mb::JavaStatePairs properties;
            if (ref.properties != nullptr) {
                properties = *ref.properties;
            }
            compare(
                box.minX + region.position[0] + ref.x,
                box.minY + region.position[1] + ref.y,
                box.minZ + region.position[2] + ref.z,
                joinStateText(std::string{ref.name}, properties)
            );
            return true;
        });
    }

    result.verifyChecked = total;
    result.verifyMatched = matched;
    result.verifyFailed  = failed + unresolved;

    if (total == 0) {
        output.error("    回读自检：文件里没有非空气方块");
        return;
    }
    auto const percent = 100.0 * static_cast<double>(matched) / static_cast<double>(total);
    if (failed == 0 && unresolved == 0) {
        output.success("    回读自检：{} 格全部一致（100%）", total);
        return;
    }
    output.success(
        "    回读自检：{:.1f}%（一致 {} / 不一致 {} / 解析失败 {}）",
        percent,
        matched,
        failed,
        unresolved
    );
    if (!firstBad.empty()) {
        output.success("      首条不一致：{}", firstBad);
    }
}

// 扫描结果 → Java 口径（`.litematic` 用）。
schematic::JavaRegion toJavaRegion(RegionScan const& scan) {
    schematic::JavaRegion region;
    region.sizeX       = scan.sizeX;
    region.sizeY       = scan.sizeY;
    region.sizeZ       = scan.sizeZ;
    region.grid        = scan.grid;
    region.totalBlocks = scan.stats.nonAir;

    auto& converter = mb::BedrockToJava::getInstance();
    converter.resetStats();

    region.palette.reserve(scan.palette.size());
    for (auto const& slot : scan.palette) {
        std::vector<mb::BedrockState> states;
        states.reserve(slot.states.size());
        for (auto const& state : slot.states) {
            states.push_back(mb::BedrockState{state.key, state.value, state.tagType});
        }
        auto const java = converter.convert(slot.name, states);

        schematic::JavaPaletteSlot entry;
        entry.name       = java.name;
        entry.properties = java.properties;
        region.palette.push_back(std::move(entry));
    }
    return region;
}

} // namespace

::BlockSource* acquireSource(::Player* player, std::int32_t dimid, std::string& how) {
    auto level = ::ll::service::getLevel();
    if (!level) {
        how = "没有加载的世界";
        return nullptr;
    }

    // 控制台执行时借用一名在线玩家：优先挑与选区同维度的那位，没有再退回第一位。
    ::Player* context = player;
    if (context == nullptr) {
        level->forEachPlayer([&](::Player& candidate) {
            if (context == nullptr) {
                context = &candidate;
            }
            if (static_cast<std::int32_t>(candidate.getDimensionId()) == dimid) {
                context = &candidate;
                return false;
            }
            return true;
        });
    }
    if (context != nullptr) {
        how = "玩家 " + context->getRealName() + " 所在维度";
        return &context->getDimensionBlockSource();
    }

    // 控制台：靠 hook `BlockSource::` 捕获到的实例（世界一旦有玩家活动就会有）。
    if (auto* captured = ghost::capturedBlockSource(); captured != nullptr) {
        how = "运行时捕获的 BlockSource";
        return captured;
    }

    // 控制台空服：维度表是唯一还活着的入口（`Level::getDimension` 在本服务端恒返回空，但 `DimensionManager::mDimensions` 是实打实的容器）。
    {
        ::Dimension* first    = nullptr;
        ::Dimension* matching = nullptr;
        level->getDimensionManager().forEachDimension([&](::Dimension& dimension) {
            if (first == nullptr) {
                first = &dimension;
            }
            if (static_cast<std::int32_t>(dimension.getDimensionId()) == dimid) {
                matching = &dimension;
                return false;
            }
            return true;
        });
        if (auto* chosen = matching != nullptr ? matching : first; chosen != nullptr) {
            how = matching != nullptr ? "维度表（目标维度）" : "维度表（默认维度）";
            return &chosen->getBlockSourceFromMainChunkSource();
        }
    }

    auto& regions = *level->mRegions;
    for (auto* region : regions) {
        if (region != nullptr) {
            how = "已加载 region";
            return region;
        }
    }

    how = "拿不到 BlockSource（需要至少一名玩家在线，或在游戏内执行）";
    return nullptr;
}

std::string sanitizeName(std::string const& raw) {
    auto name = stripKnownExtension(mb::trimText(raw));

    std::string cleaned;
    cleaned.reserve(name.size());
    for (char const c : name) {
        switch (c) {
        case '\\':
        case '/':
        case ':':
        case '*':
        case '?':
        case '"':
        case '<':
        case '>':
        case '|':
            cleaned.push_back('_');
            break;
        default:
            cleaned.push_back(c);
            break;
        }
    }
    // Windows 不允许以点或空格结尾
    while (!cleaned.empty() && (cleaned.front() == ' ' || cleaned.front() == '.')) {
        cleaned.erase(cleaned.begin());
    }
    while (!cleaned.empty() && (cleaned.back() == ' ' || cleaned.back() == '.')) {
        cleaned.pop_back();
    }
    return cleaned;
}

std::filesystem::path targetPath(std::string const& name, Format format) {
    auto nativeMod = ::ll::mod::NativeMod::current();
    if (!nativeMod) {
        return std::filesystem::path{name + extensionOf(format)};
    }
    return nativeMod->getModDir() / "schematics" / (name + extensionOf(format));
}

bool saveSelection(
    ::CommandOutput&      output,
    ::Player*             player,
    selection::Box const& box,
    SaveRequest const&    request,
    SaveResult&           result
) {
    result = SaveResult{};

    auto const& opts = options();
    if (opts.requireOp) {
        if (player == nullptr) {
            output.error("§c保存被拒绝§r：config/save.json 的 requireOp 开着，必须以管理员玩家身份执行");
            return false;
        }
        if (!player->isOperator()) {
            output.error("§c保存被拒绝§r：需要管理员（OP）—— config/save.json 的 requireOp 现在是开着的");
            return false;
        }
    }

    result.volume     = box.volume();
    bool const needsMc = request.format != Format::Litematic;
    auto const limit   = needsMc ? opts.maxVolume : opts.maxVolumeLitematic;
    if (result.volume > limit) {
        output.error(
            "§c选区太大§r：{} × {} × {} = {} 格，超过 {} 格式的上限 {} 格",
            box.width(),
            box.height(),
            box.depth(),
            result.volume,
            needsMc ? "mcstructure" : "litematic",
            limit
        );
        output.success("    §7缩小选区，或改 config/save.json 的 maxVolume / maxVolumeLitematic§r");
        return false;
    }

    auto name = sanitizeName(request.name);
    if (name.empty()) {
        // 命令里没给名字（`/lit save stru`）：自动起名，别让整个操作失败。
        name = autoSaveName();
        output.success("§7没有给文件名，自动命名为 {}§r", name);
    }

    // 选区记的是点选时的维度：玩家换维度后按「当前维度」读会静默导出一片错内容。
    if (player != nullptr) {
        auto const current = static_cast<std::int32_t>(player->getDimensionId());
        if (current != box.dimid) {
            output.error(
                "§c维度不符§r：选区在下界/主世界维度 {}，你当前在维度 {}　§7回到那个维度再保存§r",
                box.dimid,
                current
            );
            return false;
        }
    }

    std::vector<Format> formats;
    switch (request.format) {
    case Format::Litematic:
        formats.push_back(Format::Litematic);
        break;
    case Format::Mcstructure:
        formats.push_back(Format::Mcstructure);
        break;
    case Format::Both:
    default:
        formats.push_back(Format::Mcstructure);
        formats.push_back(Format::Litematic);
        break;
    }

    // 先查同名：overwrite=false 时一个都不写，绝不留下一份新一份旧的半成品。
    std::error_code ec;
    for (auto const format : formats) {
        auto const path = targetPath(name, format);
        if (!opts.overwrite && std::filesystem::exists(path, ec)) {
            output.error(
                "§c同名文件已存在§r：{}　§7换个名字，或把 config/save.json 的 overwrite 改成 true§r",
                util::toUtf8(path.filename())
            );
            return false;
        }
    }

    std::string how;
    auto*       source = acquireSource(player, box.dimid, how);
    if (source == nullptr) {
        output.error("§c拿不到世界§r：{}", how);
        return false;
    }

    auto const started = std::chrono::steady_clock::now();

    RegionScan  scan;
    ScanOptions scanOptions;
    scanOptions.includeBlockEntities = opts.includeBlockEntities;
    if (!scanRegion(*source, box, scanOptions, scan)) {
        output.error("§c扫描失败§r：{}", scan.stats.error);
        return false;
    }

    result.nonAir        = static_cast<std::size_t>(scan.stats.nonAir);
    result.palette       = scan.palette.size();
    result.loadedChunks  = scan.stats.loadedChunks;
    result.failedChunks  = scan.stats.failedChunks;
    result.stateFallback = scan.stats.stateFallback;
    result.entities      = scan.stats.entities;

    auto const scanMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                            std::chrono::steady_clock::now() - started
    )
                            .count();

    output.success(
        "§b[扫描]§r {} × {} × {}（{} 格，{}）→ 非空气 {} 格，调色板 {} 项，耗时 {} ms",
        box.width(),
        box.height(),
        box.depth(),
        result.volume,
        how,
        result.nonAir,
        result.palette,
        scanMs
    );
    if (result.failedChunks > 0) {
        output.success("    §e有 {} 个区块拉不起来，那一带可能是空洞§r", result.failedChunks);
    }
    if (result.stateFallback > 0) {
        output.success(
            "    §e{} 种方块的状态只能按整型写§r（见 /lit savediag；必要时补 BedrockToJava 的族规则）",
            result.stateFallback
        );
    }
    if (result.entities > 0) {
        output.success("    方块实体 {} 个已收录", result.entities);
    }

    for (auto const format : formats) {
        auto const  path       = targetPath(name, format);
        std::string error;
        std::size_t bytes      = 0;
        std::size_t paletteOut = 0;
        std::size_t entityOut  = 0;

        bool ok = false;
        if (format == Format::Mcstructure) {
            schematic::McstructureWriteOptions writeOptions;
            writeOptions.blockVersion     = opts.blockVersion;
            writeOptions.writeLiquidLayer = opts.writeLiquidLayer;
            ok = schematic::writeMcstructureFile(path, scan, writeOptions, error, &bytes, &paletteOut, &entityOut);
        } else {
            auto const region = toJavaRegion(scan);

            schematic::LitematicWriteOptions writeOptions;
            writeOptions.name       = name;
            writeOptions.author     = request.author.empty() ? "LitematicaBE" : request.author;
            writeOptions.description = "由 LitematicaBE 选区导出（" + std::to_string(box.minX) + ","
                                     + std::to_string(box.minY) + "," + std::to_string(box.minZ) + "）→（"
                                     + std::to_string(box.maxX) + "," + std::to_string(box.maxY) + ","
                                     + std::to_string(box.maxZ) + "）";
            writeOptions.regionName  = name;
            writeOptions.dataVersion = opts.dataVersion;
            ok = schematic::writeLitematicFile(path, region, writeOptions, error, &bytes, &paletteOut);
            entityOut = 0;
        }

        if (!ok) {
            output.error("§c写出失败§r（{}）：{}", formatName(format), error);
            continue;
        }

        result.bytes = std::max(result.bytes, bytes);
        result.files.push_back(path);

        if (entityOut > 0) {
            output.success(
                "§a已写出§r {}：{}　{} 字节，调色板 {} 项，方块实体 {} 个",
                formatName(format),
                util::toUtf8(path.filename()),
                bytes,
                paletteOut,
                entityOut
            );
        } else {
            output.success(
                "§a已写出§r {}：{}　{} 字节，调色板 {} 项",
                formatName(format),
                util::toUtf8(path.filename()),
                bytes,
                paletteOut
            );
        }

        if (request.verify) {
            verifyFile(output, *source, box, format, path, result);
        }
    }

    if (result.files.empty()) {
        result.error = "所有格式都写出失败";
        return false;
    }

    auto const totalMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                             std::chrono::steady_clock::now() - started
    )
                             .count();
    output.success("§b完成§r：耗时 {} ms　§7文件在 <模组目录>/schematics/ 下§r", totalMs);
    result.ok = true;
    return true;
}

void diagnoseBlock(::CommandOutput& output, ::Player* player, int x, int y, int z) {
    std::string how;
    auto const  dimid  = player != nullptr ? static_cast<std::int32_t>(player->getDimensionId()) : 0;
    auto*       source = acquireSource(player, dimid, how);
    if (source == nullptr) {
        output.error("拿不到世界：{}", how);
        return;
    }

    auto const& block = source->getBlock(::BlockPos{x, y, z});
    std::string name  = block.getTypeName();
    if (name.find(':') == std::string::npos) {
        name = "minecraft:" + name;
    }

    std::vector<StateValue> states;
    bool                    fallback = false;
    probeBlockStates(block, states, fallback);

    output.success(
        "位置 ({}, {}, {})：{}　状态 {} 条{}",
        x,
        y,
        z,
        name,
        states.size(),
        fallback ? "（有类型兜底）" : ""
    );
    for (auto const& state : states) {
        output.success("    {} = {}  [类型 {}]", state.key, state.value, static_cast<int>(state.tagType));
    }

    std::vector<mb::BedrockState> convertedStates;
    convertedStates.reserve(states.size());
    for (auto const& state : states) {
        convertedStates.push_back(mb::BedrockState{state.key, state.value, state.tagType});
    }
    auto const converted = mb::BedrockToJava::getInstance().convert(name, convertedStates);
    output.success("→ Java：{}", joinStateText(converted.name, converted.properties));
}

bool runSelfTestFromEnv() {
    // 用 Win32 读环境变量：`std::getenv` 在 /W4 + MSVC 下是弃用告警（项目把告警当错误看）。
    std::string raw;
    {
        wchar_t buffer[1024]{};
        auto const length = ::GetEnvironmentVariableW(L"LITEMATICABE_SELF_TEST", buffer, 1024);
        if (length == 0 || length >= 1024) {
            return false;
        }
        int const needed = ::WideCharToMultiByte(
            CP_UTF8,
            0,
            buffer,
            static_cast<int>(length),
            nullptr,
            0,
            nullptr,
            nullptr
        );
        if (needed <= 0) {
            return false;
        }
        raw.resize(static_cast<std::size_t>(needed));
        ::WideCharToMultiByte(
            CP_UTF8,
            0,
            buffer,
            static_cast<int>(length),
            raw.data(),
            needed,
            nullptr,
            nullptr
        );
    }
    if (raw.empty()) {
        return false;
    }

    std::vector<std::string> parts;
    {
        std::string current;
        for (char const c : raw) {
            if (c == ' ' || c == ',' || c == '\t') {
                if (!current.empty()) {
                    parts.push_back(current);
                    current.clear();
                }
                continue;
            }
            current.push_back(c);
        }
        if (!current.empty()) {
            parts.push_back(current);
        }
    }
    if (parts.size() < 6) {
        if (auto mod = ::ll::mod::NativeMod::current()) {
            mod->getLogger().warn(
                "LITEMATICABE_SELF_TEST 参数不足：需要 \"x1 y1 z1 x2 y2 z2 [名字] [格式]\""
            );
        }
        return false;
    }

    std::int32_t values[6]{};
    for (std::size_t i = 0; i < 6; ++i) {
        values[i] = static_cast<std::int32_t>(std::strtol(parts[i].c_str(), nullptr, 10));
    }

    selection::Box box;
    box.minX = std::min(values[0], values[3]);
    box.minY = std::min(values[1], values[4]);
    box.minZ = std::min(values[2], values[5]);
    box.maxX = std::max(values[0], values[3]);
    box.maxY = std::max(values[1], values[4]);
    box.maxZ = std::max(values[2], values[5]);

    SaveRequest request;
    request.name   = parts.size() > 6 ? parts[6] : "selftest";
    request.author = "self-test";
    request.format = Format::Mcstructure; // 自检默认写 .mcstructure；第 7 个参数可以换成 lite/both
    request.verify = true;
    if (parts.size() > 7) {
        if (auto const parsed = parseFormat(parts[7]); parsed) {
            request.format = *parsed;
        }
    }

    if (auto mod = ::ll::mod::NativeMod::current()) {
        mod->getLogger().info(
            "[self-test] scheduled: ({},{},{})-({},{},{}) name={} format={}",
            box.minX,
            box.minY,
            box.minZ,
            box.maxX,
            box.maxY,
            box.maxZ,
            request.name,
            formatName(request.format)
        );
    }

    // 延迟 10 秒：世界刚起来时区块还没热，BlockSource 也可能没被 hook 捕获到。
    ::ll::thread::ServerThreadExecutor::getDefault().executeAfter(
        [box, request] {
            // 结果先攒成文本，最后一次性落盘：中途抛异常也能看到走到哪一步。
            std::string log = "=== begin ===\n";
            auto        append = [&log](std::string text) {
                log += text;
                log += '\n';
            };

            SaveResult result;
            bool       ok = false;
            try {
                append("before saveSelection");
                ::CommandOutput output{::CommandOutputType::AllOutput};
                ok = saveSelection(output, nullptr, box, request, result);
                append(std::string{"after saveSelection ok="} + (ok ? "1" : "0"));
                append(std::string{"messages="} + std::to_string(output.mMessages.size()));
                for (auto const& message : output.mMessages) {
                    append("msg: " + message.mMessageId);
                }
            } catch (std::exception const& e) {
                append(std::string{"exception: "} + e.what());
            } catch (...) {
                append("exception: unknown");
            }

            append(std::string{"box="} + std::to_string(box.minX) + " " + std::to_string(box.minY) + " "
                   + std::to_string(box.minZ) + " " + std::to_string(box.maxX) + " " + std::to_string(box.maxY) + " "
                   + std::to_string(box.maxZ));
            append(std::string{"format="} + formatName(request.format));
            append("files=" + std::to_string(result.files.size()));
            append("nonAir=" + std::to_string(result.nonAir));
            append("palette=" + std::to_string(result.palette));
            append("bytes=" + std::to_string(result.bytes));
            append("entities=" + std::to_string(result.entities));
            append("stateFallback=" + std::to_string(result.stateFallback));
            append("loadedChunks=" + std::to_string(result.loadedChunks) + " failedChunks="
                   + std::to_string(result.failedChunks));
            append("verify=" + std::to_string(result.verifyMatched) + "/" + std::to_string(result.verifyChecked)
                   + " failed=" + std::to_string(result.verifyFailed));
            append(std::string{"result="} + (ok ? "ok" : "failed"));
            for (auto const& file : result.files) {
                append("file: " + ::litematicabe::util::toUtf8(file));
            }

            auto mod = ::ll::mod::NativeMod::current();
            if (!mod) {
                return;
            }
            auto& logger = mod->getLogger();
            logger.info("[self-test] {}", log);

            std::error_code ec;
            auto const      dataDir = mod->getDataDir();
            std::filesystem::create_directories(dataDir, ec);
            std::ofstream file{dataDir / "selftest.log", std::ios::binary | std::ios::trunc};
            if (file) {
                file << log;
                file.flush();
            }
        },
        std::chrono::seconds(10)
    );
    return true;
}

} // namespace litematicabe::core::save
