// 材料清单 xlsx 导出侧的离线自检：
//   1) 材料聚合（颜色分开、朝向合并、可放置标记、总数）
//   2) 生成一份带中文/数字/百分比/加粗表头的 xlsx，交给 check.py 用 openpyxl 打开断言
//
// 这些代码路径不碰 BDS，所以能脱离游戏跑：Excel 打不开的报表在生产环境是
// 「玩家看不到、日志里也没有」的静默失败，必须在这里钉死。

#include "LitematicaBE/core/report/MaterialCounter.h"
#include "LitematicaBE/core/report/XlsxWriter.h"
#include "LitematicaBE/core/schematic/LitematicFile.h"
#include "LitematicaBE/core/schematic/McstructureFile.h"

#include <cctype>
#include <cstdio>
#include <filesystem>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>

namespace {

namespace rep = litematicabe::core::report;
namespace sch = litematicabe::core::schematic;

int gFailures = 0;

void expect(bool condition, std::string const& what) {
    if (condition) {
        std::printf("[ok] %s\n", what.c_str());
        return;
    }
    ++gFailures;
    std::printf("[FAIL] %s\n", what.c_str());
}

void testMaterialCounter() {
    std::vector<std::string> const palette = {
        "minecraft:wool[color=red]",                                // 0
        "minecraft:wool[color=blue]",                               // 1
        "minecraft:oak_planks",                                     // 2
        "minecraft:oak_stairs[facing_direction=2,upslope_direction=0]", // 3
        "minecraft:oak_stairs[facing_direction=0,upslope_direction=0]", // 4
        "minecraft:stone",                                          // 5
    };
    // 3 红羊毛 / 2 蓝羊毛 / 5 橡木板 / 2+1 橡木楼梯（两个朝向）/ 4 石头 = 17 格
    std::vector<std::uint32_t> const ids = {0, 0, 0, 1, 1, 2, 2, 2, 2, 2, 3, 3, 4, 5, 5, 5, 5};
    std::vector<bool> const         placeable = {true, true, true, true, true, false};

    auto const report = rep::countMaterials(palette, ids, &placeable);

    expect(report.totalBlocks == 17, "总格数 17");
    expect(report.items.size() == 5, "材料种类 5（朝向不同不拆开）");
    expect(report.distinctStates == 6, "用到的状态数 6");
    expect(report.unplaceable == 4, "不可放置 4 格（石头）");

    auto find = [&report](std::string const& name, std::string const& variant) -> rep::MaterialCount const* {
        for (auto const& item : report.items) {
            if (item.name == name && item.variant == variant) {
                return &item;
            }
        }
        return nullptr;
    };

    auto const* redWool = find("wool", "红色");
    expect(redWool != nullptr && redWool->count == 3, "红羊毛 3 格，颜色分开");

    auto const* blueWool = find("wool", "蓝色");
    expect(blueWool != nullptr && blueWool->count == 2, "蓝羊毛 2 格");

    auto const* stairs = find("oak_stairs", "");
    expect(stairs != nullptr && stairs->count == 3, "橡木楼梯两种朝向合并为 3 格");

    auto const* stone = find("stone", "");
    expect(stone != nullptr && stone->count == 4 && !stone->placeable, "石头 4 格且被标为不可放置");

    // 排序：数量降序
    bool sorted = true;
    for (std::size_t i = 1; i < report.items.size(); ++i) {
        if (report.items[i - 1].count < report.items[i].count) {
            sorted = false;
        }
    }
    expect(sorted, "按数量降序排列");

    // 越界调色板下标不应该崩
    std::vector<std::uint32_t> const bad = {0, 99, 1};
    auto const                      tolerant = rep::countMaterials(palette, bad, nullptr);
    expect(tolerant.totalBlocks == 2, "越界下标被跳过");
}

void testVariantParsing() {
    auto const wool = rep::parseStateText("minecraft:wool[color=red]");
    expect(wool.name == "wool" && wool.variant == "红色", "颜色变体 → 红色");

    auto const door = rep::parseStateText("minecraft:spruce_door[open=false,upper_block_bit=true,direction=1]");
    expect(door.name == "spruce_door" && door.variant.empty(), "开关/朝向不算变体");

    auto const wood = rep::parseStateText("double_wooden_slab[wood_type=birch,top_slot_bit=false]");
    expect(wood.variant == "白桦木", "wood_type → 白桦木");

    auto const quoted = rep::parseStateText("minecraft:standing_banner[\"color\"=\"lime\"]");
    expect(quoted.variant == "黄绿色", "带引号的状态键值也能解析");
}

void testWorkbook(std::filesystem::path const& file) {
    rep::Workbook book;
    book.title   = "材料清单 - 自检样例";
    book.subject = "LitematicaBE 离线回归";
    book.creator = "LitematicaBE test";

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
    sheet.rows.push_back(
        {rep::Cell::integer(1),
         rep::Cell::str("oak_planks"),
         rep::Cell::str("—"),
         rep::Cell::integer(12345),
         rep::Cell::percent(0.7352),
         rep::Cell::str("是"),
         rep::Cell::str("minecraft:oak_planks")}
    );
    sheet.rows.push_back(
        {rep::Cell::integer(2),
         rep::Cell::str("wool"),
         rep::Cell::str("红色"),
         rep::Cell::integer(17),
         rep::Cell::percent(0.0001),
         rep::Cell::str("否"),
         rep::Cell::str("minecraft:wool[color=red]")}
    );
    sheet.rows.push_back(
        {rep::Cell::blank(),
         rep::Cell::str("合计", true),
         rep::Cell::blank(),
         rep::Cell::integer(12362, true),
         rep::Cell::percent(1.0, true),
         rep::Cell::blank(),
         rep::Cell::str("2 种材料", true)}
    );

    rep::Sheet info;
    info.name   = "投影信息";
    info.widths = {18.0, 72.0};
    info.rows.push_back({rep::Cell::str("项目", true), rep::Cell::str("值", true)});
    info.rows.push_back({rep::Cell::str("投影名"), rep::Cell::str("自检样例 <&\"'>")});
    info.rows.push_back({rep::Cell::str("导出时间"), rep::Cell::str("2026-11-24 02:07:28")});

    book.sheets.push_back(sheet);
    book.sheets.push_back(info);

    std::string error;
    bool const  ok = rep::writeWorkbook(file, book, error);
    expect(ok, "xlsx 写出成功" + (error.empty() ? std::string{} : "（" + error + "）"));
    if (!ok) {
        return;
    }

    std::error_code ec;
    auto const      size = std::filesystem::file_size(file, ec);
    expect(!ec && size > 1000, "文件大小 > 1 KB");
    std::printf("[info] 输出：%s（%llu 字节）\n", file.string().c_str(), static_cast<unsigned long long>(size));
}

/// 与 `ProjectionSession::begin` 的拼串口径一致：`name[key=value,...]`。
std::string stateTextOf(std::string_view name, std::vector<std::pair<std::string, std::string>> const* properties) {
    std::string state{name};
    if (properties != nullptr && !properties->empty()) {
        state.push_back('[');
        for (std::size_t i = 0; i < properties->size(); ++i) {
            if (i != 0) {
                state.push_back(',');
            }
            state.append((*properties)[i].first);
            state.push_back('=');
            state.append((*properties)[i].second);
        }
        state.push_back(']');
    }
    return state;
}

/// 真实投影文件 → 每格调色板下标 → 材料聚合（不经过映射表，与 `/lit material` 的统计段等价）。
rep::MaterialReport countFromProjection(std::filesystem::path const& file, std::string& error) {
    std::vector<std::string>                       palette;
    std::unordered_map<std::string, std::uint32_t> paletteIds;
    std::vector<std::uint32_t>                     blockIds;

    auto intern = [&](std::string const& state) -> std::uint32_t {
        auto const it = paletteIds.find(state);
        if (it != paletteIds.end()) {
            return it->second;
        }
        auto const id = static_cast<std::uint32_t>(palette.size());
        palette.push_back(state);
        paletteIds.emplace(state, id);
        return id;
    };
    auto push = [&](sch::BlockRef const& ref) {
        blockIds.push_back(intern(stateTextOf(ref.name, ref.properties)));
        return true;
    };

    auto ext = file.extension().string();
    for (char& c : ext) {
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    }

    if (ext == ".mcstructure") {
        sch::McstructureFile structure;
        if (auto const readError = sch::readMcstructure(file, structure); !readError.ok()) {
            error = readError.message;
            return {};
        }
        sch::forEachBlock(structure, push);
    } else {
        sch::LitematicFile litematic;
        if (auto const readError = sch::readLitematic(file, litematic); !readError.ok()) {
            error = readError.message;
            return {};
        }
        for (auto const& region : litematic.regions) {
            sch::forEachBlock(region, push);
        }
    }

    return rep::countMaterials(palette, blockIds, nullptr);
}

void writeRealReport(rep::MaterialReport const& report, std::string const& title, std::filesystem::path const& out) {
    rep::Workbook book;
    book.title   = title;
    book.creator = "LitematicaBE test";

    rep::Sheet sheet;
    sheet.name       = "材料清单";
    sheet.widths     = {6.0, 34.0, 12.0, 10.0, 10.0};
    sheet.frozenRows = 1;
    sheet.autoFilter = true;
    sheet.rows.push_back(
        {rep::Cell::str("序号", true),
         rep::Cell::str("方块名", true),
         rep::Cell::str("变体", true),
         rep::Cell::str("数量", true),
         rep::Cell::str("占比", true)}
    );

    auto const total = static_cast<double>(report.totalBlocks);
    for (std::size_t i = 0; i < report.items.size(); ++i) {
        auto const& item = report.items[i];
        sheet.rows.push_back(
            {rep::Cell::integer(static_cast<double>(i + 1)),
             rep::Cell::str(item.name),
             rep::Cell::str(item.variant.empty() ? "—" : item.variant),
             rep::Cell::integer(static_cast<double>(item.count)),
             rep::Cell::percent(total > 0 ? static_cast<double>(item.count) / total : 0.0)}
        );
    }
    book.sheets.push_back(sheet);

    std::string error;
    expect(rep::writeWorkbook(out, book, error), "真实投影的 xlsx 写出成功" + error);
    std::printf("[info] 输出：%s\n", out.string().c_str());
}

void testRealProjection(std::filesystem::path const& input, std::filesystem::path const& out) {
    std::string error;
    auto const  report = countFromProjection(input, error);
    if (!error.empty()) {
        expect(false, "解析 " + input.string() + "：" + error);
        return;
    }
    expect(report.totalBlocks > 0, "真实投影统计到方块（" + std::to_string(report.totalBlocks) + " 格）");
    expect(!report.items.empty(), "真实投影统计出材料（" + std::to_string(report.items.size()) + " 种）");

    std::printf("[info] %s 前 10 项：\n", input.filename().string().c_str());
    auto const count = report.items.size() < 10 ? report.items.size() : std::size_t{10};
    for (std::size_t i = 0; i < count; ++i) {
        auto const& item = report.items[i];
        std::printf(
            "       %-28s %-8s %8llu\n",
            item.name.c_str(),
            item.variant.empty() ? "-" : item.variant.c_str(),
            static_cast<unsigned long long>(item.count)
        );
    }

    writeRealReport(report, "材料清单 - " + input.filename().string(), out);
}

} // namespace

int main(int argc, char** argv) {
    std::filesystem::path output = "material-sample.xlsx";
    if (argc > 1) {
        output = std::filesystem::path{argv[1]};
    }

    testMaterialCounter();
    testVariantParsing();
    testWorkbook(output);

    // 可选：传一个真实投影文件，跑「文件 → 状态串 → 材料统计 → xlsx」的完整链路。
    if (argc > 2) {
        auto realOut = output;
        realOut.replace_filename("material-real.xlsx");
        testRealProjection(std::filesystem::path{argv[2]}, realOut);
    }

    if (gFailures != 0) {
        std::printf("\n%d 项失败\n", gFailures);
        return 1;
    }
    std::printf("\n全部通过\n");
    return 0;
}
