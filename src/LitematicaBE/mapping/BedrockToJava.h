#pragma once

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>

namespace litematicabe::mapping {

// 一条基岩状态（键 + 文本值 + NBT 类型，与 `core::save::StateValue` 同构，
// 这里单独定义是为了让 mapping 层不反向依赖 save 层）。
struct BedrockState {
    std::string  key;
    std::string  value;
    std::uint8_t tagType{3};
};

// 一条 Java 方块状态（`facing=east`）。
using JavaStatePairs = std::vector<std::pair<std::string, std::string>>;

struct JavaBlock {
    std::string    name; //< `minecraft:oak_stairs`
    JavaStatePairs properties;
};

struct ConvertStats {
    std::uint64_t names{};
    std::uint64_t renamed{};
    std::uint64_t sameName{};
    std::uint64_t droppedKeys{};
    std::uint64_t fallbackValues{};
    std::vector<std::string> samples;
};

// 基岩方块（BDS 注册表口径）→ Java 方块（Litematica 口径）。
//
// 两个来源：
//   1. 数据表 `data/export_map.json`（由 `tools/lit_tools/exportmap.py` 从旧项目
//      `BlockMappingRegistry.js` + `java_bedrock.json` 生成）：名字差异 + 状态名对照；
//   2. 内置逐族规则（楼梯 / 台阶 / 门 / 活板门 / 活塞 / 红石 …）：把值域不同的
//      `facing_direction` / `weirdo_direction` / `vertical_half` 翻成 Java 的
//      `facing` / `half`。
//
// 表缺失时照样能跑：名字按 `minecraft:` 前缀对齐，状态走内置规则，
// 认不出的键丢弃并计数（`droppedKeys`），不会因为缺表就导出失败。
class BedrockToJava {
public:
    static BedrockToJava& getInstance();

    bool load(std::filesystem::path const& file);
    // 从模组目录 `data/export_map.json` 加载；文件不存在时返回 false（内置规则仍然可用）。
    bool loadFromModDir();

    [[nodiscard]] bool               loaded() const noexcept { return mLoaded; }
    [[nodiscard]] std::string const& lastError() const noexcept { return mLastError; }

    // 转换一个方块（按「基岩名 + 状态集合」缓存，调色板级别的重复调用只算一次）。
    JavaBlock convert(std::string const& bedrockName, std::vector<BedrockState> const& states);

    [[nodiscard]] ConvertStats const& stats() const noexcept { return mStats; }
    void                              resetStats();
    void                              clearCache();

    struct TableStats {
        std::size_t names{};
        std::size_t stateMaps{};
    };
    [[nodiscard]] TableStats table() const;

private:
    BedrockToJava();
    ~BedrockToJava();

    struct Impl;
    std::unique_ptr<Impl> mImpl;

    struct CacheEntry {
        JavaBlock block;
        bool      renamed{};
    };

    bool        mLoaded{};
    std::string mLastError;

    ConvertStats                               mStats{};
    std::unordered_map<std::string, CacheEntry> mCache;

    void reportSample(std::string text);
};

} // namespace litematicabe::mapping
