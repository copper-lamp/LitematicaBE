#pragma once

#include <filesystem>
#include <string>

namespace litematicabe::util {

// 宽字符 / 路径 → UTF-8。BDS 的日志、`CommandOutput` 都按 UTF-8 处理，直接输出 `path.string()` 会在中文路径上炸（`ERROR_NO_UNICODE_TRANSLATION`）。
std::string toUtf8(std::filesystem::path const& path);
std::string toUtf8(std::wstring const& text);

// UTF-8 → 路径。绝不走本地代码页猜测：字节非法时返回空 path，而不是抛 `std::system_error`。
std::filesystem::path fromUtf8(std::string const& text);

// 本地代码页（GBK 等）→ 路径。只用于控制台输入的兼容尝试，失败同样返回空 path。
std::filesystem::path fromAcp(std::string const& text);

// 把任意字节串清洗成合法 UTF-8（非法序列替换为 U+FFFD），用于日志/诊断兜底。
std::string sanitizeUtf8(std::string const& text);

} // namespace litematicabe::util
