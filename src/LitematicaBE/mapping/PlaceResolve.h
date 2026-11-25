#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>

class Block;

namespace litematicabe::mapping {

// 把投影里的方块状态串变成「能真正写进世界」的 `Block` 单例。
//
// 和 `BlockStateResolve` 的分工：
// - `BlockStateResolve` 解析的是 **ghost 假方块**（`lit:g_*`），只关心网络 id，用于显示；
// - `PlaceResolve` 解析的是 **真实方块**，需要拿到注册表里的 `Block` 才能 `setBlock`。
//
// 候选链（首个让 `Block::tryGetFromRegistry` 返回非空者胜出，结果按状态串缓存）：
// 1. 原名 + 原状态 —— Bedrock 结构文件（`.mcstructure`）的 palette 走这条，精确命中；
// 2. 显式映射 `java_bedrock.json`（`bricks`→`brick_block`、`cobweb`→`web`…）；
// 3. 规则变形（`oak_door`→`wooden_door`、`white_bed`→`bed`、去 `_block` / 去复数 …）；
// 4. 候选池近似（`bedrock_names.json` 里长度接近且互相包含的名字）；
// 5. 只认名字，用默认状态（精度降级，但位置和方块种类仍然对）。
//
// 状态属性逐级尝试多套别名（`facing` 可能是 `minecraft:cardinal_direction` 也可能是
// `minecraft:facing_direction`，`half`→`upside_down_bit`，`axis`→`minecraft:pillar_axis`），
// 都不认时退回默认状态。
class PlaceResolve {
public:
    static PlaceResolve& getInstance();

    // 精度：Exact 原样命中 / Mapped 改名后命中 / Default 只认出名字 / Failed 放不了。
    enum class Precision : std::uint8_t { Exact, Mapped, Default, Failed };

    struct Result {
        ::Block const* block{};
        Precision      precision{Precision::Failed};
        std::string    sample;        // 实际命中的 `name[states]`，诊断用
        bool           stateApplied{}; // 状态是否真的被注册表采纳（false = 退回默认状态，方向会丢）
    };

    // @param isBedrock true 表示状态串已经是 Bedrock 口径（结构文件），不做名字/属性转换。
    Result resolve(std::string_view stateText, bool isBedrock);

    // 懒加载 `java_bedrock.json` + `bedrock_names.json`；缺文件时退化为「只有规则」。
    bool ensureLoaded();

    [[nodiscard]] std::string const& lastError() const;

    // 清空解析缓存（`/lit reload` 后调用）。
    void clear();

    struct Stats {
        std::uint64_t exact{};
        std::uint64_t mapped{};
        std::uint64_t defaulted{};
        std::uint64_t failed{};
        std::uint64_t cached{};
        std::uint64_t javaToBedrock{};
        std::uint64_t bedrockNames{};
    };

    [[nodiscard]] Stats stats() const;

    // 诊断：把状态串的候选链打印成一行，`/lit place` 出错时用。
    [[nodiscard]] std::string explain(std::string_view stateText, bool isBedrock);

private:
    PlaceResolve();
    ~PlaceResolve();
    PlaceResolve(PlaceResolve const&)            = delete;
    PlaceResolve& operator=(PlaceResolve const&) = delete;

    struct Impl;
    std::unique_ptr<Impl> mImpl;

    std::unordered_map<std::string, Result> mCache;
    Stats                                   mStats{};
};

} // namespace litematicabe::mapping
