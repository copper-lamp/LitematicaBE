#include "LitematicaBE/command/ReportActions.h"

#include "LitematicaBE/Version.h"
#include "LitematicaBE/core/report/MaterialCounter.h"
#include "LitematicaBE/core/report/XlsxWriter.h"
#include "LitematicaBE/core/util/TextEncoding.h"
#include "LitematicaBE/ghost/ProjectionManager.h"
#include "LitematicaBE/ghost/ProjectionSession.h"

#include "ll/api/mod/NativeMod.h"

#include "mc/server/commands/CommandOutput.h"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <ctime>
#include <filesystem>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

namespace litematicabe::command::report {

namespace {

namespace rep = litematicabe::core::report;
namespace util = litematicabe::util;

// 报表里「TOP 材料」最多列几项：聊天栏只适合一行，完整清单在 xlsx 里。
constexpr std::size_t kTopListed = 5;

// `exports` 里文件名的安全化：Windows 不允许 `\ / : * ? " < > |` 与控制字符，
// 也不允许以空格或点结尾。非 ASCII 字节原样保留（不会切坏 UTF-8）。
std::string sanitizeFileName(std::string name) {
    for (char& c : name) {
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
            c = '_';
            break;
        default:
            if (static_cast<unsigned char>(c) < 0x20) {
                c = '_';
            }
            break;
        }
    }
    while (!name.empty() && (name.back() == ' ' || name.back() == '.')) {
        name.pop_back();
    }
    if (name.empty()) {
        name = "projection";
    }
    return name;
}

std::string stripExtension(std::string name) {
    auto const dot = name.find_last_of('.');
    if (dot != std::string::npos && dot > 0) {
        name.resize(dot);
    }
    return name;
}

std::string localTimestamp() {
    auto const now = std::chrono::system_clock::now();
    auto const time = std::chrono::system_clock::to_time_t(now);
    std::tm    local{};
#if defined(_WIN32)
    localtime_s(&local, &time);
#else
    localtime_r(&time, &local);
#endif
    char buffer[32]{};
    std::snprintf(
        buffer,
        sizeof(buffer),
        "%04d-%02d-%02d %02d:%02d:%02d",
        local.tm_year + 1900,
        local.tm_mon + 1,
        local.tm_mday,
        local.tm_hour,
        local.tm_min,
        local.tm_sec
    );
    return buffer;
}

std::string layerRangeText(ghost::ProjectionSession::LayerRange range) {
    if (range.to < range.from) {
        return "未显示";
    }
    return std::to_string(range.from) + " ~ " + std::to_string(range.to) + "（" + std::to_string(range.to - range.from + 1)
         + " 层）";
}

// 「材料清单」表：序号 / 方块名 / 变体 / 数量 / 占比 / 可放置 / 状态串样例。
rep::Sheet buildMaterialSheet(rep::MaterialReport const& materials) {
    rep::Sheet sheet;
    sheet.name       = "材料清单";
    sheet.widths     = {6.0, 34.0, 12.0, 10.0, 10.0, 9.0, 52.0};
    sheet.frozenRows = 1;
    sheet.autoFilter = true;

    sheet.rows.push_back(
        {rep::Cell::str("序号", true),
         rep::Cell::str("方块名", true),
         rep::Cell::str("变体", true),
         rep::Cell::str("数量", true),
         rep::Cell::str("占比", true),
         rep::Cell::str("可放置", true),
         rep::Cell::str("状态串样例", true)}
    );

    auto const total = static_cast<double>(materials.totalBlocks);
    for (std::size_t i = 0; i < materials.items.size(); ++i) {
        auto const& item  = materials.items[i];
        auto const  ratio = total > 0 ? static_cast<double>(item.count) / total : 0.0;
        sheet.rows.push_back(
            {rep::Cell::integer(static_cast<double>(i + 1)),
             rep::Cell::str(item.name),
             rep::Cell::str(item.variant.empty() ? "—" : item.variant),
             rep::Cell::integer(static_cast<double>(item.count)),
             rep::Cell::percent(ratio),
             rep::Cell::str(item.placeable ? "是" : "否"),
             rep::Cell::str(item.state)}
        );
    }

    sheet.rows.push_back(
        {rep::Cell::blank(),
         rep::Cell::str("合计", true),
         rep::Cell::blank(),
         rep::Cell::integer(static_cast<double>(materials.totalBlocks), true),
         rep::Cell::percent(materials.totalBlocks > 0 ? 1.0 : 0.0, true),
         rep::Cell::blank(),
         rep::Cell::str(std::to_string(materials.items.size()) + " 种材料", true)}
    );

    return sheet;
}

// 「投影信息」表：这份清单是从哪份投影、哪一层、什么时候统计出来的。
rep::Sheet buildInfoSheet(ghost::ProjectionSession const& session, rep::MaterialReport const& materials) {
    rep::Sheet sheet;
    sheet.name   = "投影信息";
    sheet.widths = {18.0, 72.0};

    auto const bounds = session.bounds();
    auto const shown  = session.shown();

    std::vector<std::pair<std::string, std::string>> lines;
    lines.emplace_back("投影名", session.label());
    lines.emplace_back("文件", session.file());
    lines.emplace_back("会话编号", "#" + std::to_string(session.id()));
    lines.emplace_back("方块总数", std::to_string(materials.totalBlocks));
    lines.emplace_back("材料种类", std::to_string(materials.items.size()));
    lines.emplace_back("状态数", std::to_string(materials.distinctStates));
    lines.emplace_back(
        "层范围",
        std::to_string(bounds.from) + " ~ " + std::to_string(bounds.to) + "（"
            + std::to_string(bounds.to - bounds.from + 1) + " 层）"
    );
    lines.emplace_back("当前显示层", layerRangeText(shown));
    lines.emplace_back("旋转", std::to_string(session.rotation()) + "°");
    if (materials.unplaceable > 0) {
        lines.emplace_back("不可放置格数", std::to_string(materials.unplaceable));
    }
    lines.emplace_back("导出时间", localTimestamp());
    lines.emplace_back("插件版本", std::string{kVersion});
    lines.emplace_back("统计口径", "按调色板状态聚合；同种方块合并，朝向/开关不区分；空气不计入");

    sheet.rows.push_back({rep::Cell::str("项目", true), rep::Cell::str("值", true)});
    for (auto const& [key, value] : lines) {
        sheet.rows.push_back({rep::Cell::str(key), rep::Cell::str(value)});
    }
    return sheet;
}

// 聊天栏那行 TOP 列表。
std::string describeTop(rep::MaterialReport const& materials) {
    std::string out;
    auto const  count = std::min(kTopListed, materials.items.size());
    for (std::size_t i = 0; i < count; ++i) {
        auto const& item = materials.items[i];
        if (i != 0) {
            out.append("、");
        }
        out.append(item.name);
        if (!item.variant.empty()) {
            out.push_back('(');
            out.append(item.variant);
            out.push_back(')');
        }
        out.append(" ×");
        out.append(std::to_string(item.count));
    }
    if (materials.items.size() > count) {
        out.append(" …");
    }
    return out;
}

} // namespace

void exportMaterials(::CommandOutput& output) {
    auto& manager = ghost::ProjectionManager::getInstance();
    auto* session = manager.active();
    if (session == nullptr) {
        output.error("没有选中的投影：先 /lit load <file>（多份投影用 /lit projects + /lit select <id> 切换）");
        return;
    }

    auto const materials = session->materials();
    if (materials.items.empty() || materials.totalBlocks == 0) {
        output.error("§b[材料清单]§r 这份投影没有统计到方块（会话 #{}）", session->id());
        return;
    }

    auto nativeMod = ::ll::mod::NativeMod::current();
    if (!nativeMod) {
        output.error("拿不到模组目录，无法导出（详情见服务器日志）");
        return;
    }

    auto const exportsDir = nativeMod->getModDir() / "exports";
    std::error_code ec;
    std::filesystem::create_directories(exportsDir, ec);

    auto const baseName = sanitizeFileName(stripExtension(session->file()));
    auto const fileName = "材料清单_" + baseName + ".xlsx";
    auto const filePath = exportsDir / util::fromUtf8(fileName);

    rep::Workbook book;
    book.title   = "材料清单 - " + session->label();
    book.subject = "LitematicaBE 投影材料统计";
    book.creator = "LitematicaBE " + std::string{kVersion};
    book.sheets.push_back(buildMaterialSheet(materials));
    book.sheets.push_back(buildInfoSheet(*session, materials));

    bool const existed = std::filesystem::exists(filePath, ec);

    std::string error;
    if (!rep::writeWorkbook(filePath, book, error)) {
        nativeMod->getLogger().error(
            "material report write failed: {} ({})",
            util::toUtf8(filePath),
            util::sanitizeUtf8(error)
        );
        output.error("§b[材料清单]§r 导出失败：{}", util::sanitizeUtf8(error));
        return;
    }

    std::uintmax_t size = 0;
    if (std::filesystem::exists(filePath, ec)) {
        auto const measured = std::filesystem::file_size(filePath, ec);
        if (!ec) {
            size = measured;
        }
    }

    nativeMod->getLogger().info(
        "material report written: {} ({} kinds / {} blocks / {} bytes)",
        util::toUtf8(filePath),
        materials.items.size(),
        materials.totalBlocks,
        size
    );

    output.success(
        "§b[材料清单]§r {}：§a{}§r 种材料 / {} 格（{} 个状态）",
        session->label(),
        materials.items.size(),
        materials.totalBlocks,
        materials.distinctStates
    );
    output.success("    §7TOP：{}§r", describeTop(materials));
    output.success(
        "    §7已导出：exports/{}（{} KB{}）§r",
        fileName,
        size / 1024,
        existed ? "，同名文件已覆盖" : ""
    );
    if (materials.unplaceable > 0) {
        output.success(
            "    §e注意§r：{} 格在当前映射下解析不出可放置方块（表里标「否」）",
            materials.unplaceable
        );
    }
    output.success("    §7两张表：材料清单（名称/变体/数量/占比）+ 投影信息；统计口径与朝向无关§r");
}

} // namespace litematicabe::command::report
