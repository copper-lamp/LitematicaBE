#pragma once

#include <cstdint>

class Block;
class BlockPos;
class BlockSource;

namespace litematicabe::ghost {

// `$setBlock` 的前置判定结果（轻松放置用）。
enum class SetBlockVerdict : std::uint8_t {
    Pass,    // 不干预，按原方块写入
    Replace, // 改写为 out 指向的方块（引擎只发一次更新，不闪帧）
    Deny,    // 拒绝本次写入（返回 false，引擎不会扣物品）
};

// 前置过滤回调：返回 Replace 时必须写 out。回调里禁止再调 `setBlock`（会重入）。
using SetBlockFilter = SetBlockVerdict (*)(
    ::BlockSource&,
    ::BlockPos const&,
    ::Block const&,
    ::Block const*&
);

// 注入/清除前置过滤（传 nullptr 关闭）。默认没有过滤，行为与之前完全一致。
void setBlockFilter(SetBlockFilter fn);
[[nodiscard]] SetBlockFilter blockFilter();

// 方块变化的底层 hook。
//
// LL 1.9.9 的 `EventBus` 在服务端没有 `BlockChangedEvent` / `PlayerDestroyBlockEvent` 的 emitter
// （`emplaceListener` 返回 null，不抛异常），所以改为直接 hook `BlockSource` 的虚函数：
//   * `removeBlock` —— 挖掉方块（变空气），必须补 ghost；
//   * `setBlock`    —— 写入方块，只有写成空气时才补（玩家放上去的真方块不抢）。
void installBlockChangedHook();
void uninstallBlockChangedHook();

[[nodiscard]] bool          blockHookInstalled();
std::uint64_t               blockSetCalls();

// 布置 BlockSource 捕获 hook。
// @return hook 是否挂上（不代表已经捕获到实例）。世界还没加载 / 完全空闲时 `BlockSource` 的函数不会被调用，所以「已布置但未捕获」是正常状态。
bool installBlockSourceCapture();

// hook 当前是否挂着（诊断用）。
bool blockSourceCaptureInstalled();

// 捕获到的 BlockSource；还没捕获到时返回 nullptr。
::BlockSource* capturedBlockSource();

// 卸载捕获 hook（拿到之后就没必要继续挂着）。
void stopBlockSourceCapture();

} // namespace litematicabe::ghost
