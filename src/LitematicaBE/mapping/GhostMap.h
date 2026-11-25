#pragma once

#include <cstdint>
#include <filesystem>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>

namespace litematicabe::mapping {

// 一个 Java 方块 + 状态 → ghost 方块的解析结果。
struct GhostResolveResult {
    // ghost 方块 identifier（`lit:g_*`）；未命中时为映射表的 `default`。
    std::string ghost;
    // 需要额外写进 ghost 状态串的键值（来自规则的 `set`）。
    std::vector<std::pair<std::string, std::string>> extraStates;
    // 是否命中了 `blocks` 里的条目（false = 走了 default）。
    bool matched{};
};

// 运行期映射表。
//
// 数据在 `resources/data/ghost_map.json`（由 `lit-tools mapgen` 从
// `resources/data/source/ghost_index.json` 生成），结构见 `tools/lit_tools/mapgen.py` 的文档。
// **本类不包含任何方块知识**：新增方块、改模型、加状态都只改 JSON，不改 C++。
//
// 规则能力（对应"后期维护留口"）：
//   * 状态树：`blocks[java].states[状态名][状态值]` 逐层下钻，`_default` 同层兜底；
//   * 模板：`"ghost": "lit:g_piston_side_f{facing_direction}"`，`{name}` 用 Java 状态值替换；
//   * `set`：叶节点可附加 `{"lit:dir": "0"}` 或 `{"lit:dir": {"from": "facing", "map": {...}}}`。
class GhostMap {
public:
    static GhostMap& getInstance();

    // 从指定文件加载；失败时保留旧数据并返回 false。
    bool load(std::filesystem::path const& file);

    // 按插件目录找默认路径并加载（`data/ghost_map.json` 或 `ghost_map.json`）。
    bool ensureLoaded();

    // 强制从模组目录重新加载并清空解析缓存（`/lit reload` 用）。
    bool loadFromModDir();

    [[nodiscard]] bool loaded() const noexcept { return mLoaded; }

    // 解析一个方块。线程不安全：只在主线程调用。
    GhostResolveResult resolve(
        std::string_view                                       javaName,
        std::vector<std::pair<std::string, std::string>> const& states
    );

    // 解析并直接得到 ghost 的完整状态串（`name[k=v,...]`）。
    std::string resolveStateString(
        std::string_view                                       javaName,
        std::vector<std::pair<std::string, std::string>> const& states
    );

    // 清空解析缓存（热重载映射表后调用）。
    void clearCache();

    struct Stats {
        std::size_t   blocks{};
        std::uint64_t hits{};
        std::uint64_t misses{};
        std::uint64_t cacheSize{};
    };

    [[nodiscard]] Stats stats() const;

    [[nodiscard]] std::string const& lastError() const noexcept { return mLastError; }

private:
    GhostMap() = default;

    bool        mLoaded{};
    std::string mLastError;
    std::string mDefaultGhost;

    // 用 pimpl 隔离 nlohmann::json，避免头文件把 60k 行的依赖带进到处 include 的地方。
    struct Impl;
    std::unique_ptr<Impl> mImpl;

    std::unordered_map<std::string, GhostResolveResult> mCache;
    Stats                                              mStats{};
};

} // namespace litematicabe::mapping
