#pragma once

#include "LitematicaBE/core/nbt/NbtTag.h"

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <string>
#include <utility>
#include <vector>

namespace litematicabe::core::nbt {

// 写入结果（与 `ReadError` 对称，命令层直接拿来拼回显）。
struct WriteError {
    std::string message;
    [[nodiscard]] bool ok() const { return message.empty(); }
};

// Tag 树 → 字节。根必须是 Compound（NBT 文件的最外层约定）。
// 失败返回空 vector（结构不合法时才可能失败，正常构造不会）。
std::vector<std::uint8_t> serialize(Tag const& root, Endian endian);

// gzip 压缩（RFC1952：10 字节头 + raw deflate + CRC32/ISIZE）。
// 走 miniz 的 raw deflate —— 与解压侧同一条路，不依赖 BDS 的 `Core::Compression::Zlib`。
std::vector<std::uint8_t> gzipCompress(std::uint8_t const* data, std::size_t size);
std::vector<std::uint8_t> gzipCompress(std::vector<std::uint8_t> const& data);

// 二进制落盘（先写 `.tmp` 再替换，避免写一半留下半个投影文件）。
bool writeFile(std::filesystem::path const& file, std::vector<std::uint8_t> const& bytes, std::string& error);

// ───────────────────────────── 构造助手 ─────────────────────────────

TagPtr makeCompound();
TagPtr makeList(TagType elementType);

TagPtr makeByte(std::int64_t value);
TagPtr makeShort(std::int64_t value);
TagPtr makeInt(std::int64_t value);
TagPtr makeLong(std::int64_t value);
TagPtr makeFloat(double value);
TagPtr makeDouble(double value);
TagPtr makeString(std::string value);
TagPtr makeByteArray(std::vector<std::uint8_t> values);
TagPtr makeIntArray(std::vector<std::int32_t> values);
TagPtr makeLongArray(std::vector<std::uint64_t> values);

// 往 Compound 里放一个子标签（同名覆盖）。空指针忽略。
void put(Tag& compound, std::string key, TagPtr value);

} // namespace litematicabe::core::nbt
