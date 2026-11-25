#pragma once

#include <cstdint>
#include <filesystem>
#include <functional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace litematicabe::core::schematic {

// 调色板里的一项：Java 方块名 + 属性（属性值统一转成字符串，方便映射表按键值匹配）。
struct PaletteEntry {
    std::string                                     name;
    std::vector<std::pair<std::string, std::string>> properties;
};

// .litematic 的一个 Region（Litematica 支持一个文件里放多个区域）。
struct Region {
    std::string  name;
    std::int32_t position[3]{};
    std::int32_t size[3]{};
    std::vector<PaletteEntry> palette;
    std::vector<std::uint64_t> states; // BlockStates 的 long 数组（当无符号读）
};

// 解码出来的一个方块（只在遍历回调里存活，避免一次性分配十万个字符串）。
struct BlockRef {
    std::int32_t                                    x{};
    std::int32_t                                    y{};
    std::int32_t                                    z{};
    std::string_view                                name;
    std::vector<std::pair<std::string, std::string>> const* properties{};
    std::size_t                                     paletteIndex{};
};

struct LitematicFile {
    std::string  name;
    std::string  author;
    std::string  description;
    std::int32_t enclosingSize[3]{};
    std::int64_t version{};
    std::int64_t dataVersion{};
    std::int64_t totalBlocks{}; // 文件元数据里声明的非空气方块数（文件不可信时只作参考）
    std::vector<Region> regions;
};

// 读取失败原因（给命令输出用）。
struct ReadError {
    std::string message;
    [[nodiscard]] bool ok() const { return message.empty(); }
};

// 读 .litematic（gzip + 小端 NBT）。
ReadError readLitematic(std::filesystem::path const& file, LitematicFile& out);

// 遍历一个区域内的全部非空气方块（顺序与 Litematica 一致：y → z → x）。
// 返回访问到的方块数；false 表示结构不合法（例如 BlockStates 长度不够）。
bool forEachBlock(Region const& region, std::function<bool(BlockRef const&)> const& visit);

// 空气/空结构的判定（映射表里也有 air → generic，这里直接跳过以减少包量）。
[[nodiscard]] bool isAirOrVoid(std::string_view name) noexcept;

} // namespace litematicabe::core::schematic
