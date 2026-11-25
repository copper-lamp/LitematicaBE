#pragma once

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace litematicabe::core::nbt {

// NBT 的两种字节序。
// `.litematic`（Litematica，Java 工具）是大端；`.mcstructure`（基岩版）是小端。
// 两者共用同一套解析逻辑，只切字节序。
enum class Endian {
    Big,
    Little,
};

enum class TagType : std::uint8_t {
    End       = 0,
    Byte      = 1,
    Short     = 2,
    Int       = 3,
    Long      = 4,
    Float     = 5,
    Double    = 6,
    ByteArray = 7,
    String    = 8,
    List      = 9,
    Compound  = 10,
    IntArray  = 11,
    LongArray = 12,
};

class Tag;
using TagPtr = std::shared_ptr<Tag>;

// 一棵最小可用的 NBT 节点。
//
// 只服务于「读投影文件」：保留结构、不保留名字（名字只在解析时用），
// 复合标签用 map，列表用 vector，数组按无符号读（Java 的 long 是有符号，位解包要当 u64）。
class Tag {
public:
    TagType type{TagType::End};

    // List 的元素类型。
    //
    // NBT 的 List 在字节流里一定带元素类型（空列表也带），读的时候不保留就没法原样写回。
    // 读取端顺便填上，写入端（`NbtWriter`）按它落字节。
    TagType listType{TagType::End};

    std::int64_t               intValue{};
    double                     doubleValue{};
    std::string                stringValue;
    std::vector<std::uint8_t>  byteArray;
    std::vector<std::uint64_t> longArray;
    std::vector<TagPtr>        list;
    std::unordered_map<std::string, TagPtr> compound;

    [[nodiscard]] bool isCompound() const noexcept { return type == TagType::Compound; }
    [[nodiscard]] bool isList() const noexcept { return type == TagType::List; }

    [[nodiscard]] Tag const* find(std::string_view key) const;
    [[nodiscard]] std::int64_t asInt(std::int64_t def = 0) const;
    [[nodiscard]] double       asDouble(double def = 0.0) const;
    [[nodiscard]] std::string const& asString() const;
};

struct ParseResult {
    TagPtr      root;
    std::string error;

    [[nodiscard]] bool ok() const { return root != nullptr; }
};

// 解析指定字节序的 NBT。
ParseResult parse(std::uint8_t const* data, std::size_t size, Endian endian);

// 读文件 →（必要时）gzip 解压 → 按字节序解析。
// gzip 走 miniz（BDS 的 `Core::Compression::Zlib` 没有导出符号）。
// @param endian 默认大端：`.litematic` 是 Java NBT；`.mcstructure` 传 `Endian::Little`。
ParseResult parseFile(std::filesystem::path const& file, Endian endian = Endian::Big);

// 便捷入口（.litematic）。
inline ParseResult parseBigEndian(std::uint8_t const* data, std::size_t size) {
    return parse(data, size, Endian::Big);
}

// 便捷入口（.mcstructure）。
inline ParseResult parseLittleEndian(std::uint8_t const* data, std::size_t size) {
    return parse(data, size, Endian::Little);
}

} // namespace litematicabe::core::nbt
