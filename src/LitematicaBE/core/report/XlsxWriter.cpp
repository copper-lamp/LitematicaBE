#include "LitematicaBE/core/report/XlsxWriter.h"

#include "LitematicaBE/core/util/TextEncoding.h"

#include <miniz/miniz.h>

#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <fstream>
#include <string>
#include <string_view>
#include <system_error>
#include <utility>
#include <vector>

namespace litematicabe::core::report {

namespace {

namespace util = litematicabe::util;

// XML 文本转义：`&` 必须最先换，否则会把后面造出来的实体再转一次。
// 另外丢掉 XML 1.0 不允许的控制字符（0x00–0x1F，TAB/LF/CR 除外）：方块的旧版名字里偶尔带残余字节，留着会让 Excel 报「文件已损坏」。
std::string xmlEscape(std::string_view text) {
    std::string out;
    out.reserve(text.size() + 16);
    for (char const c : text) {
        auto const byte = static_cast<unsigned char>(c);
        if (byte < 0x20 && byte != 0x09 && byte != 0x0A && byte != 0x0D) {
            continue;
        }
        switch (c) {
        case '&':
            out.append("&amp;");
            break;
        case '<':
            out.append("&lt;");
            break;
        case '>':
            out.append("&gt;");
            break;
        case '"':
            out.append("&quot;");
            break;
        case '\'':
            out.append("&apos;");
            break;
        default:
            out.push_back(c);
            break;
        }
    }
    return out;
}

// 0 → "A"，25 → "Z"，26 → "AA"。
std::string columnName(std::size_t index) {
    std::string name;
    ++index;
    while (index > 0) {
        auto const rest = (index - 1) % 26;
        name.insert(name.begin(), static_cast<char>('A' + rest));
        index = (index - 1) / 26;
    }
    return name;
}

// 定点小数（不走 locale：BDS 进程的 locale 不受本插件控制，`,` 小数点会写坏 xlsx）。
std::string formatFixed(double value, int decimals) {
    bool negative = value < 0;
    if (negative) {
        value = -value;
    }
    double const      scale  = std::pow(10.0, static_cast<double>(decimals));
    auto const        scaled = static_cast<long long>(std::llround(value * scale));
    std::string       digits = std::to_string(scaled);
    auto const        frac   = static_cast<std::size_t>(decimals);
    if (frac > 0) {
        if (digits.size() <= frac) {
            digits.insert(0, frac + 1 - digits.size(), '0');
        }
        digits.insert(digits.size() - frac, 1, '.');
    }
    return negative ? "-" + digits : digits;
}

// 单元格 → 样式表里的 xf 索引（与 `styles.xml` 的 `cellXfs` 一一对应）。
std::size_t styleOf(Cell const& cell) {
    if (cell.kind == Cell::Kind::Number) {
        switch (cell.format) {
        case Cell::Format::Integer:
            return cell.bold ? 4 : 2;
        case Cell::Format::Percent:
            return 3;
        case Cell::Format::General:
        default:
            return 0;
        }
    }
    return cell.bold ? 1 : 0;
}

std::string cellXml(std::size_t row, std::size_t col, Cell const& cell) {
    if (cell.kind == Cell::Kind::Blank) {
        return {};
    }
    std::string out;
    out.reserve(48 + cell.text.size());
    out.append("<c r=\"");
    out.append(columnName(col));
    out.append(std::to_string(row));
    out.append("\"");

    auto const style = styleOf(cell);
    if (style != 0) {
        out.append(" s=\"");
        out.append(std::to_string(style));
        out.append("\"");
    }

    if (cell.kind == Cell::Kind::Text) {
        out.append(" t=\"inlineStr\"><is><t xml:space=\"preserve\">");
        out.append(xmlEscape(cell.text));
        out.append("</t></is></c>");
        return out;
    }

    out.append("><v>");
    switch (cell.format) {
    case Cell::Format::Integer:
        out.append(formatFixed(cell.number, 0));
        break;
    case Cell::Format::Percent:
        // 存 0~1 的比值，显示格式（0.00%）交给 numFmtId=10。
        out.append(formatFixed(cell.number, 6));
        break;
    case Cell::Format::General:
    default:
        out.append(formatFixed(cell.number, 6));
        break;
    }
    out.append("</v></c>");
    return out;
}

std::string sheetXml(Sheet const& sheet, std::string const& name) {
    std::size_t rows = sheet.rows.size();
    std::size_t cols = 0;
    for (auto const& row : sheet.rows) {
        cols = cols < row.size() ? row.size() : cols;
    }

    auto const lastCell = [&]() {
        std::string ref = "A1";
        if (rows > 0 && cols > 0) {
            ref = columnName(cols - 1) + std::to_string(rows);
        }
        return ref;
    }();

    std::string out;
    out.reserve(512 + rows * cols * 32);
    out.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n");
    out.append("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" "
               "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">");
    out.append("<sheetPr><outlinePr summaryBelow=\"1\" summaryRight=\"1\"/></sheetPr>");
    out.append("<dimension ref=\"");
    out.append(lastCell);
    out.append("\"/>");

    out.append("<sheetViews><sheetView workbookViewId=\"0\"");
    if (sheet.frozenRows > 0) {
        out.append(" tabSelected=\"1\"");
    }
    out.append(">");
    if (sheet.frozenRows > 0) {
        auto const split = std::to_string(sheet.frozenRows);
        out.append("<pane ySplit=\"");
        out.append(split);
        out.append("\" topLeftCell=\"A");
        out.append(std::to_string(sheet.frozenRows + 1));
        out.append("\" activePane=\"bottomLeft\" state=\"frozen\"/>"
                   "<selection pane=\"bottomLeft\" activeCell=\"A");
        out.append(std::to_string(sheet.frozenRows + 1));
        out.append("\" sqref=\"A");
        out.append(std::to_string(sheet.frozenRows + 1));
        out.append("\"/>");
    }
    out.append("</sheetView></sheetViews>");
    out.append("<sheetFormatPr defaultRowHeight=\"15\"/>");

    if (!sheet.widths.empty()) {
        out.append("<cols>");
        for (std::size_t i = 0; i < sheet.widths.size(); ++i) {
            auto const width = sheet.widths[i];
            if (width <= 0) {
                continue;
            }
            out.append("<col min=\"");
            out.append(std::to_string(i + 1));
            out.append("\" max=\"");
            out.append(std::to_string(i + 1));
            out.append("\" width=\"");
            out.append(formatFixed(width, 2));
            out.append("\" customWidth=\"1\"/>");
        }
        out.append("</cols>");
    }

    out.append("<sheetData>");
    for (std::size_t r = 0; r < sheet.rows.size(); ++r) {
        auto const& row = sheet.rows[r];
        std::string cells;
        for (std::size_t c = 0; c < row.size(); ++c) {
            cells.append(cellXml(r + 1, c, row[c]));
        }
        out.append("<row r=\"");
        out.append(std::to_string(r + 1));
        out.append("\"");
        if (r < sheet.frozenRows) {
            out.append(" customHeight=\"1\" ht=\"18\"");
        }
        out.append(">");
        out.append(cells);
        out.append("</row>");
    }
    out.append("</sheetData>");

    if (sheet.autoFilter && rows > 1 && cols > 0) {
        out.append("<autoFilter ref=\"A1:");
        out.append(lastCell);
        out.append("\"/>");
    }
    out.append("</worksheet>");
    (void)name;
    return out;
}

// `2026-11-24T02:07:28Z`（docProps 里要求 W3CDTF，必须 UTC）。
std::string isoNow() {
    auto const now    = std::chrono::system_clock::now();
    auto const time   = std::chrono::system_clock::to_time_t(now);
    std::tm    utc{};
#if defined(_WIN32)
    gmtime_s(&utc, &time);
#else
    gmtime_r(&time, &utc);
#endif
    char buffer[32]{};
    std::snprintf(
        buffer,
        sizeof(buffer),
        "%04d-%02d-%02dT%02d:%02d:%02dZ",
        utc.tm_year + 1900,
        utc.tm_mon + 1,
        utc.tm_mday,
        utc.tm_hour,
        utc.tm_min,
        utc.tm_sec
    );
    return buffer;
}

std::string contentTypesXml(std::size_t sheetCount) {
    std::string out;
    out.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n");
    out.append("<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">");
    out.append("<Default Extension=\"rels\" "
               "ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>");
    out.append("<Default Extension=\"xml\" ContentType=\"application/xml\"/>");
    out.append("<Override PartName=\"/xl/workbook.xml\" "
               "ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>");
    out.append("<Override PartName=\"/xl/styles.xml\" "
               "ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>");
    for (std::size_t i = 1; i <= sheetCount; ++i) {
        out.append("<Override PartName=\"/xl/worksheets/sheet");
        out.append(std::to_string(i));
        out.append(".xml\" "
                   "ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>");
    }
    out.append("<Override PartName=\"/docProps/core.xml\" "
               "ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>");
    out.append("<Override PartName=\"/docProps/app.xml\" "
               "ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>");
    out.append("</Types>");
    return out;
}

std::string rootRelsXml() {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
           "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
           "<Relationship Id=\"rId1\" "
           "Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" "
           "Target=\"xl/workbook.xml\"/>"
           "<Relationship Id=\"rId2\" "
           "Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" "
           "Target=\"docProps/core.xml\"/>"
           "<Relationship Id=\"rId3\" "
           "Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" "
           "Target=\"docProps/app.xml\"/>"
           "</Relationships>";
}

std::string workbookXml(Workbook const& book, std::vector<std::string> const& names) {
    std::string out;
    out.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n");
    out.append("<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" "
               "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">");
    out.append("<workbookPr/>");
    out.append("<bookViews><workbookView activeTab=\"0\"/></bookViews>");
    out.append("<sheets>");
    for (std::size_t i = 0; i < names.size(); ++i) {
        out.append("<sheet name=\"");
        out.append(xmlEscape(names[i]));
        out.append("\" sheetId=\"");
        out.append(std::to_string(i + 1));
        out.append("\" r:id=\"rId");
        out.append(std::to_string(i + 1));
        out.append("\"/>");
    }
    out.append("</sheets>");
    (void)book;
    out.append("</workbook>");
    return out;
}

std::string workbookRelsXml(std::size_t sheetCount) {
    std::string out;
    out.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n");
    out.append("<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">");
    for (std::size_t i = 1; i <= sheetCount; ++i) {
        out.append("<Relationship Id=\"rId");
        out.append(std::to_string(i));
        out.append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" "
                   "Target=\"worksheets/sheet");
        out.append(std::to_string(i));
        out.append(".xml\"/>");
    }
    out.append("<Relationship Id=\"rId");
    out.append(std::to_string(sheetCount + 1));
    out.append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" "
               "Target=\"styles.xml\"/>");
    out.append("</Relationships>");
    return out;
}

// 表头（加粗 + 灰底 + 细框）、数字格式（千位整数 / 百分比）都靠这张表。
std::string stylesXml() {
    static std::string const kStyles =
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
        "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">"
        "<fonts count=\"2\">"
        "<font><sz val=\"11\"/><color theme=\"1\"/><name val=\"Calibri\"/><family val=\"2\"/></font>"
        "<font><b/><sz val=\"11\"/><color theme=\"1\"/><name val=\"Calibri\"/><family val=\"2\"/></font>"
        "</fonts>"
        "<fills count=\"3\">"
        "<fill><patternFill patternType=\"none\"/></fill>"
        "<fill><patternFill patternType=\"gray125\"/></fill>"
        "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFDCE6F1\"/>"
        "<bgColor indexed=\"64\"/></patternFill></fill>"
        "</fills>"
        "<borders count=\"2\">"
        "<border><left/><right/><top/><bottom/><diagonal/></border>"
        "<border><left style=\"thin\"><color rgb=\"FFB7C9DD\"/></left>"
        "<right style=\"thin\"><color rgb=\"FFB7C9DD\"/></right>"
        "<top style=\"thin\"><color rgb=\"FFB7C9DD\"/></top>"
        "<bottom style=\"thin\"><color rgb=\"FFB7C9DD\"/></bottom><diagonal/></border>"
        "</borders>"
        "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>"
        "<cellXfs count=\"5\">"
        "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>"
        "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"2\" borderId=\"1\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" "
        "applyBorder=\"1\" applyAlignment=\"1\">"
        "<alignment horizontal=\"center\" vertical=\"center\" wrapText=\"1\"/></xf>"
        "<xf numFmtId=\"3\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/>"
        "<xf numFmtId=\"10\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/>"
        "<xf numFmtId=\"3\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" "
        "applyFont=\"1\"/>"
        "</cellXfs>"
        "<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles>"
        "</styleSheet>";
    return kStyles;
}

std::string corePropsXml(Workbook const& book, std::string const& stamp) {
    std::string out;
    out.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n");
    out.append("<cp:coreProperties "
               "xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" "
               "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" "
               "xmlns:dcterms=\"http://purl.org/dc/terms/\" "
               "xmlns:dcmitype=\"http://purl.org/dc/dcmitype/\" "
               "xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">");
    if (!book.title.empty()) {
        out.append("<dc:title>");
        out.append(xmlEscape(book.title));
        out.append("</dc:title>");
    }
    if (!book.subject.empty()) {
        out.append("<dc:subject>");
        out.append(xmlEscape(book.subject));
        out.append("</dc:subject>");
    }
    out.append("<dc:creator>");
    out.append(xmlEscape(book.creator));
    out.append("</dc:creator><cp:lastModifiedBy>");
    out.append(xmlEscape(book.creator));
    out.append("</cp:lastModifiedBy><dcterms:created xsi:type=\"dcterms:W3CDTF\">");
    out.append(stamp);
    out.append("</dcterms:created><dcterms:modified xsi:type=\"dcterms:W3CDTF\">");
    out.append(stamp);
    out.append("</dcterms:modified></cp:coreProperties>");
    return out;
}

std::string appPropsXml(Workbook const& book) {
    std::string out;
    out.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n");
    out.append("<Properties "
               "xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\" "
               "xmlns:vt=\"http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes\">"
               "<Application>");
    out.append(xmlEscape(book.creator));
    out.append("</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>"
               "<LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc>"
               "<HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0300</AppVersion></Properties>");
    return out;
}

// 把 xml 片段按名字塞进 zip。
bool addEntry(mz_zip_archive& zip, char const* name, std::string const& data, std::string& error) {
    if (mz_zip_writer_add_mem(&zip, name, data.data(), data.size(), MZ_BEST_COMPRESSION) != MZ_TRUE) {
        auto const code = mz_zip_get_last_error(&zip);
        error           = std::string{"打包 "} + name + " 失败：" + mz_zip_get_error_string(code);
        return false;
    }
    return true;
}

} // namespace

std::string sanitizeSheetName(std::string const& name) {
    std::string out;
    out.reserve(name.size());
    for (char const c : name) {
        switch (c) {
        case '[':
        case ']':
        case ':':
        case '*':
        case '?':
        case '/':
        case '\\':
            out.push_back('_');
            break;
        default:
            out.push_back(c);
            break;
        }
    }
    // Excel 上限 31 字符；按字节截断可能切坏 UTF-8，所以按「整字符」截（中文 3 字节）。
    if (out.size() > 31) {
        std::size_t cut = 31;
        while (cut > 0 && (static_cast<unsigned char>(out[cut]) & 0xC0) == 0x80) {
            --cut;
        }
        out.resize(cut);
    }
    if (out.empty()) {
        out = "Sheet";
    }
    return out;
}

bool writeWorkbook(std::filesystem::path const& file, Workbook const& book, std::string& error) {
    error.clear();

    if (book.sheets.empty()) {
        error = "工作簿里没有工作表";
        return false;
    }

    std::vector<std::string> names;
    names.reserve(book.sheets.size());
    for (auto const& sheet : book.sheets) {
        names.push_back(sanitizeSheetName(sheet.name));
    }

    // 目录可能还没建（第一次导出）：创建失败留给下面的写文件报错，这里只尽力而为。
    if (!file.parent_path().empty()) {
        std::error_code ec;
        std::filesystem::create_directories(file.parent_path(), ec);
    }

    mz_zip_archive zip{};
    std::memset(&zip, 0, sizeof(zip));
    if (mz_zip_writer_init_heap(&zip, 0, 64 * 1024) != MZ_TRUE) {
        error = "无法创建压缩上下文（内存不足？）";
        return false;
    }

    auto const stamp = isoNow();

    bool ok = true;
    ok      = ok && addEntry(zip, "[Content_Types].xml", contentTypesXml(names.size()), error);
    ok      = ok && addEntry(zip, "_rels/.rels", rootRelsXml(), error);
    ok      = ok && addEntry(zip, "docProps/core.xml", corePropsXml(book, stamp), error);
    ok      = ok && addEntry(zip, "docProps/app.xml", appPropsXml(book), error);
    ok      = ok && addEntry(zip, "xl/workbook.xml", workbookXml(book, names), error);
    ok      = ok && addEntry(zip, "xl/_rels/workbook.xml.rels", workbookRelsXml(names.size()), error);
    ok      = ok && addEntry(zip, "xl/styles.xml", stylesXml(), error);
    for (std::size_t i = 0; ok && i < book.sheets.size(); ++i) {
        std::string entry = "xl/worksheets/sheet" + std::to_string(i + 1) + ".xml";
        ok = ok && addEntry(zip, entry.c_str(), sheetXml(book.sheets[i], names[i]), error);
    }

    void*  buffer = nullptr;
    size_t size   = 0;
    if (ok && mz_zip_writer_finalize_heap_archive(&zip, &buffer, &size) != MZ_TRUE) {
        auto const code = mz_zip_get_last_error(&zip);
        error           = std::string{"压缩收尾失败："} + mz_zip_get_error_string(code);
        ok              = false;
    }
    mz_zip_writer_end(&zip);

    if (!ok) {
        return false;
    }

    bool written = false;
    {
        std::ofstream out{file, std::ios::binary | std::ios::trunc};
        if (!out) {
            error = "无法写入文件：" + util::toUtf8(file);
        } else {
            out.write(static_cast<char const*>(buffer), static_cast<std::streamsize>(size));
            out.close();
            if (!out) {
                error = "写入失败（磁盘已满或被占用）：" + util::toUtf8(file);
            } else {
                written = true;
            }
        }
    }

    mz_free(buffer);

    if (!written) {
        return false;
    }
    return true;
}

} // namespace litematicabe::core::report
