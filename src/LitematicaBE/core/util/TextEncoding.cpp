#include "LitematicaBE/core/util/TextEncoding.h"

#include <Windows.h>

#include <cstddef>
#include <string>

namespace litematicabe::util {

namespace {

std::wstring toWide(std::string const& text, UINT codePage, bool strict) {
    if (text.empty()) {
        return {};
    }
    DWORD const flags = strict ? MB_ERR_INVALID_CHARS : 0;
    int const   length =
        ::MultiByteToWideChar(codePage, flags, text.data(), static_cast<int>(text.size()), nullptr, 0);
    if (length <= 0) {
        return {};
    }
    std::wstring out(static_cast<std::size_t>(length), L'\0');
    ::MultiByteToWideChar(codePage, flags, text.data(), static_cast<int>(text.size()), out.data(), length);
    return out;
}

std::string toNarrow(std::wstring const& text, UINT codePage) {
    if (text.empty()) {
        return {};
    }
    int const length = ::WideCharToMultiByte(
        codePage,
        0,
        text.data(),
        static_cast<int>(text.size()),
        nullptr,
        0,
        nullptr,
        nullptr
    );
    if (length <= 0) {
        return {};
    }
    std::string out(static_cast<std::size_t>(length), '\0');
    ::WideCharToMultiByte(codePage, 0, text.data(), static_cast<int>(text.size()), out.data(), length, nullptr, nullptr);
    return out;
}

} // namespace

std::string toUtf8(std::wstring const& text) { return toNarrow(text, CP_UTF8); }

std::string toUtf8(std::filesystem::path const& path) {
    // 走 wstring 而不是 u8string：文件名里有本地代码页无法映射的字符时，u8string() 在部分标准库实现上会抛异常，wstring() 永远不抛。
    return toUtf8(path.wstring());
}

std::filesystem::path fromUtf8(std::string const& text) {
    auto const wide = toWide(text, CP_UTF8, true);
    if (wide.empty()) {
        return {};
    }
    return std::filesystem::path{wide};
}

std::filesystem::path fromAcp(std::string const& text) {
    auto const wide = toWide(text, CP_ACP, true);
    if (wide.empty()) {
        return {};
    }
    return std::filesystem::path{wide};
}

std::string sanitizeUtf8(std::string const& text) {
    if (text.empty()) {
        return {};
    }
    // 非严格模式：非法序列由系统替换成 U+FFFD，保证输出一定是合法 UTF-8。
    auto const wide = toWide(text, CP_UTF8, false);
    if (wide.empty()) {
        return text;
    }
    return toUtf8(wide);
}

} // namespace litematicabe::util
