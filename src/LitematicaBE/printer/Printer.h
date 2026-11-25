#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace litematicabe::printer {

// 投影打印机（Printer）。
//
// 玩家开启后，插件每 `intervalMs` 扫描一次「以玩家为球心、半径 `range`」的范围，
// 把投影里还没落地的方块**真实写进世界**，并从背包扣掉对应方块（生存模式）。
//
// 实现要点：
//   * 只读投影会话的 public 接口（`targetCell` / `isFilled` / `markFilled` / `shown`），
//     `ProjectionSession` 内部一行不动 —— 扫描、放置、扣料都在本模块完成；
//   * 写方块复用 `/lit place` 验证过的那条路：
//     `BlockSource::setBlockAndRetainCompatibleBlockActor(pos, block, 3)` + `mSerializationIdHash` 回读校验；
//   * **不挂任何 hook**：定时器跑在服务端主线程，`tCtx.player` 为空，
//     轻松放置的 `$setBlock` 前置过滤器自然放行，两套功能互不干扰；
//   * 放完一格就 `markFilled()` —— ghost 层之后不再覆盖它，进服/传送/心跳的
//     `correctFilledFor` 会把它压回真方块（包数按子区块算，与格数无关）；
//   * 同一轮里写成功之后才扣料，一轮最多同步一次背包（`sendInventory`），不逐格发。

struct Options {
    float range{5.0f};         //< 手长：球心到方块中心的欧氏距离
    int   intervalMs{100};     //< 每轮节拍（毫秒）
    int   maxPerRound{4};      //< 每轮每玩家最多放几格
    int   eyeOffsetMilli{900}; //< 球心相对脚部的 y 偏移（1000 = 1 格）

    bool creativeFree{true};      //< 创造模式不扣料（背包没有也能放）
    bool consumeInSurvival{true}; //< 生存模式扣 1 格/方块
    bool onlyAir{false};          //< true = 只顶空气；false = 空气 + 可替换方块（草/雪层/流体…）
    bool layerLimited{true};      //< 只打印 /lit layer 显示的层
    bool skipBlockEntities{true}; //< 跳过带方块实体的类型（箱子/告示牌/熔炉…）
    bool skipMultiblock{true};    //< 跳过门/床/双高植物这类一次写两格的
    bool skipFluids{true};        //< 跳过流体
    bool skipPlayerCells{true};   //< 跳过玩家身体占用的格（免得把自己封住）

    bool respectPlayerBreaks{true};   //< 玩家刚挖掉的格在冷却期内不补回（否则玩家拆不掉）
    int  playerBreakCooldownMs{3000}; //< 破坏冷却（毫秒）

    int   notifyCooldownMs{1500}; //< 缺料提示节流
    float maxRange{16.0f};        //< 半径硬上限（防手滑写成 100）

    // 额外的「可被顶掉」方块名（带命名空间，如 `minecraft:vine`），追加到内置小表。
    std::vector<std::string> extraReplaceable;
};

// 安装（读 `config/printer.json` 并起定时器）。幂等。
bool               install();
void               uninstall();
[[nodiscard]] bool installed();

// 按玩家切换开关；返回切换后的状态。
bool                      toggle(std::string const& playerName);
[[nodiscard]] bool        enabledFor(std::string const& playerName);
void                      clearAll();
[[nodiscard]] std::size_t enabledCount();

[[nodiscard]] Options const& options();

// 重新读 `config/printer.json`（`/lit reload` 用）。失败时沿用旧值并返回 false。
bool reloadOptions();

struct Stats {
    std::uint64_t rounds{};             //< 扫描轮数（有人开启时）
    std::uint64_t playerRuns{};         //< 逐玩家执行次数
    std::uint64_t candidates{};         //< 球内且属于投影、尚未填充的格
    std::uint64_t placed{};             //< 真正写进世界的格数
    std::uint64_t alreadyRight{};       //< 世界已是目标方块（顺手登记已填充）
    std::uint64_t occupiedSkipped{};    //< 非空气且不允许顶掉
    std::uint64_t riskySkipped{};       //< 方块实体 / 多格 / 流体
    std::uint64_t playerCellSkipped{};  //< 玩家身体占用的格
    std::uint64_t playerBreakSkipped{}; //< 玩家刚挖掉、冷却期内不补的格
    std::uint64_t noItem{};             //< 背包里没有目标方块
    std::uint64_t writeFailed{};        //< setBlock 失败或回读不一致
    std::uint64_t inventorySyncs{};     //< 背包同步次数（不是格数）
    std::uint64_t freePlaced{};         //< 写成功但没扣到料（槽位在两步之间变了）
};

[[nodiscard]] Stats stats();

// `/lit` 用的一行摘要。
[[nodiscard]] std::string describe();

} // namespace litematicabe::printer
