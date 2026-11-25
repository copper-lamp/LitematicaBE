#pragma once

#include "LitematicaBE/ghost/BlockHook.h"

#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>

class Player;
class ItemStack;
class ItemStackBase;
class BlockPos;

namespace litematicabe::easyplace {

// 轻松放置（EasyPlace）。
//
// 玩家在投影覆盖的格子上放下「与投影不一致」的方块时，把落地方块改写成投影要求的那一个。
//
// 实现要点：
//   * 判定与改写都在已有的 `BlockSource::$setBlock` hook 里完成，不新增方块 hook：
//     只把传给 `origin` 的 block 参数换掉，所以引擎仍然只发一次方块更新（无闪烁），
//     放置流程（邻居更新 / onPlace / 音效 / 物品消耗）也照常走完。
//   * 「这次是哪个玩家在放」由 `Item::useOn` hook 提供的 thread_local 上下文回答
//     （`Player::useItem` 只覆盖「对空气使用物品」，是附带）；
//     没有上下文（世界生成 / `/lit place` / 其它插件写方块）时完全不干预。
//   * 物品扣除一致性：改写后引擎扣的仍是玩家手上那个「错物品」，所以在下一个 tick 做一次
//     净额修正——把错物品补回、从背包扣掉相应数量的目标方块物品。先补后退，补多少退多少，
//     不论引擎的扣减发生在修正之前还是之后，最终总量都一致。

// 安装/卸载（挂 `Item::useOn` + `Player::useItem`，并向 ghost 层注入 filter）。
bool install();
void uninstall();
[[nodiscard]] bool installed();

// `Item::useOn` 的「放置之前」拦截回调（木剑选点用）。
//
// 为什么走回调而不是再挂一个同函数 hook：`Item::useOn` 已经被轻松放置占用，
// 同一地址再挂一次会互踢。因此把「谁先看一眼这次右键」做成显式注册点：
// 回调在 `origin()` 之前执行，返回 true 表示这一击被吃掉
// （原版交互与放置都不再发生，返回 `InteractionResult::Success`）。
using UseOnInterceptor = std::function<bool(::Player&, ::ItemStack&, ::BlockPos const&, unsigned char)>;

// 注册/清除拦截回调（传 nullptr 清除）。同一时刻只允许一个拦截器。
void setUseOnInterceptor(UseOnInterceptor fn);
[[nodiscard]] bool hasUseOnInterceptor();

// `Player::useItem` 的「使用物品」观察回调（木剑开面板用）。
//
// 与 `UseOnInterceptor` 同一个理由：`Player::useItem` 已经被轻松放置占用，同一地址再挂一次 hook 会互踢。区别是这一个只观察、不拦截：
// 回调在 `origin()` 之后执行，返回值被忽略，原版行为完全不变。
//
// 触发范围：手持物品对空气右键 / 长按（吃、喝、扔，以及对着空气挥木剑）。
// 对着方块右键不在这里 —— 那条走 `Item::useOn`。
//
// 注意：**不要**在这个回调里再调 `Player::useItem`。
using UseItemObserver = std::function<void(::Player&, ::ItemStackBase&)>;

void setUseItemObserver(UseItemObserver fn);
[[nodiscard]] bool hasUseItemObserver();

// 按玩家切换开关；返回切换后的状态。
bool toggle(std::string const& playerName);
[[nodiscard]] bool enabledFor(std::string const& playerName);
void               clearAll();
[[nodiscard]] std::size_t enabledCount();

// ghost 层回调：由 `BlockHook` 在每次 `$setBlock` 前调用。
ghost::SetBlockVerdict filterSetBlock(
    ::BlockSource&  source,
    ::BlockPos const& pos,
    ::Block const&  incoming,
    ::Block const*& out
);

struct Stats {
    std::uint64_t useOnCalls{};       // Item::useOn 命中次数（真正承载方块放置的那条链路）
    std::uint64_t useItemCalls{};     // Player::useItem 命中次数（对空气使用物品）
    std::uint64_t candidates{};       // 落在投影格且与投影不一致
    std::uint64_t replacedSameItem{}; // 同类方块、只改状态（不需要会计）
    std::uint64_t replacedSwap{};     // 异类方块、走了背包扣料
    std::uint64_t alreadyRight{};     // 与投影一致，放行
    std::uint64_t notReplaceable{};   // 该格存在但不可替换（解析失败）
    std::uint64_t riskySkipped{};     // 手上/目标方块是多格、实体、流体，跳过
    std::uint64_t denied{};           // 背包没有目标物品，拒绝放置
    std::uint64_t accounted{};        // 完成净额修正的次数
    std::uint64_t accountMissing{};   // 修正时目标物品不足（不守恒，已计数）
    std::uint64_t accountDropped{};   // 修正时玩家已下线
};

[[nodiscard]] Stats stats();

// `/lit` 用的一行摘要。
[[nodiscard]] std::string describe();

} // namespace litematicabe::easyplace
