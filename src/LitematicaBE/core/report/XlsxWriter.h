#pragma once

#include <cstddef>
#include <filesystem>
#include <string>
#include <vector>

namespace litematicabe::core::report {

// 一个单元格。只有三种形态：空白 / 文本（inline string）/ 数字。
// 刻意不用 sharedStrings：材料清单是「一次生成、一次性打开」的报告，省掉字符串表这一层能少写一份 XML，也不会因为转义差异出现「Excel 报文件损坏」。
struct Cell {
    enum class Kind : int {
        Blank  = 0,
        Text   = 1,
        Number = 2,
    };

    // 数字的显示格式（样式表里的 xf 索引由它决定）。
    enum class Format : int {
        General = 0, //< 原样（默认）
        Integer = 1, //< 千位分隔整数：`12,345`
        Percent = 2, //< 两位小数百分比：`12.34%`（值按 0~1 存）
    };

    Kind        kind{Kind::Blank};
    Format      format{Format::General};
    bool        bold{};   //< 加粗（表头 / 合计行）
    std::string text;     //< Kind::Text
    double      number{}; //< Kind::Number

    static Cell blank() { return Cell{}; }
    static Cell str(std::string value, bool bold = false) {
        Cell cell;
        cell.kind = Kind::Text;
        cell.text = std::move(value);
        cell.bold = bold;
        return cell;
    }
    static Cell integer(double value, bool bold = false) {
        Cell cell;
        cell.kind   = Kind::Number;
        cell.format = Format::Integer;
        cell.number = value;
        cell.bold   = bold;
        return cell;
    }
    static Cell percent(double ratio, bool bold = false) {
        Cell cell;
        cell.kind   = Kind::Number;
        cell.format = Format::Percent;
        cell.number = ratio;
        cell.bold   = bold;
        return cell;
    }
};

// 一张工作表。
struct Sheet {
    std::string                    name;                // 表名（非法字符会被替换，超 31 字符会截断）
    std::vector<double>            widths;              // 每列宽（字符数；0 / 缺省 = 不设）
    std::vector<std::vector<Cell>> rows;
    std::size_t                    frozenRows{};        // 顶部冻结行数（表头行数）
    bool                           autoFilter{false};   // 是否给首行加自动筛选
};

// 一个工作簿。
struct Workbook {
    std::vector<Sheet> sheets;
    std::string        title;
    std::string        creator{"LitematicaBE"};
    std::string        subject;
};

// 写 `.xlsx`（OOXML + zip；压缩走 miniz，全程在内存里打包后用宽字符路径落盘）。
// @return false 表示写失败，原因写入 `error`（调用方负责回报给玩家，不抛异常）。
bool writeWorkbook(std::filesystem::path const& file, Workbook const& book, std::string& error);

// 把字符串处理成可用的工作表名（去非法字符、截断到 31 字符、空串兜底）。
[[nodiscard]] std::string sanitizeSheetName(std::string const& name);

} // namespace litematicabe::core::report
