#include "LitematicaBE/ghost/BlockHook.h"

#include "LitematicaBE/ghost/ProjectionManager.h"

#include "ll/api/memory/Hook.h"

#include "mc/world/level/BlockPos.h"
#include "mc/world/level/BlockSource.h"
#include "mc/world/level/block/Block.h"
#include "mc/world/level/chunk/LevelChunk.h"
#include "mc/world/level/dimension/Dimension.h"

#include <atomic>
#include <cstdint>

namespace litematicabe::ghost {

namespace {

std::atomic<std::uint64_t> gSetCalls{0};
SetBlockFilter             gFilter = nullptr;

// 运行时捕获到的 BlockSource。
//
// 背景：LL 1.9.9 在这个服务端上 `Level::getDimension()` 始终返回空 weak_ptr，
// `mRegions` / `mDimensions` 读出来也都是 0（结构布局与 BDS 实际不符），于是「往世界里写方块」拿不到 BlockSource。改成运行时捕获，两个入口：
//   * 区块创建（`LevelChunk::createNewNoCustomDeleter`）—— 参数直接带 `Dimension&`，世界加载时一定发生，无玩家也能命中；
//   * `BlockSource::$getBlock` / `$setBlock` —— 世界开始活动后一定能命中。
::BlockSource* gCapturedSource = nullptr;
bool           gCaptureInstalled{false};

// BlockSource:: 有两个重载，先转成确定类型再交给 hook 宏。

// `BlockSource::$getBlock` 有两个重载，先转成确定类型再交给 hook 宏。
using GetBlockPosFn = ::Block const& (::BlockSource::*)(::BlockPos const&) const;

GetBlockPosFn const kGetBlockPos = static_cast<GetBlockPosFn>(&::BlockSource::$getBlock);

LL_TYPE_INSTANCE_HOOK(
    BlockSourceCaptureHook,
    ll::memory::HookPriority::Highest,
    ::BlockSource,
    kGetBlockPos,
    ::Block const&,
    ::BlockPos const& pos
) {
    if (gCapturedSource == nullptr) {
        gCapturedSource = thisFor<::BlockSource>();
    }
    return origin(pos);
}

ll::memory::HookRegistrar<BlockSourceCaptureHook> gCaptureHook;

// 写入方块：BlockSource::$setBlock(pos, block, flags, syncMsg, ctx)
//
// 实测（LL 1.9.9 / BDS 1.21.132）玩家「挖」和「放」都走这里：
//   * 挖掉 → block 是 air，此时把那格的 ghost 补回去；
//   * 放方块 → block 不是 air，不覆盖（玩家盖上的真方块优先）。
// BlockSource::removeBlock 这条路径玩家破坏时不走（计数恒为 0），因此不挂。
LL_TYPE_INSTANCE_HOOK(
    BlockSetHook,
    ll::memory::HookPriority::Normal,
    ::BlockSource,
    &::BlockSource::$setBlock,
    bool,
    ::BlockPos const&              pos,
    ::Block const&                 block,
    int                            updateFlags,
    ::ActorBlockSyncMessage const* syncMsg,
    ::BlockChangeContext const&    changeSourceContext
) {
    ++gSetCalls;
    if (gCapturedSource == nullptr) {
        gCapturedSource = thisFor<::BlockSource>();
    }

    // 轻松放置：在调 origin 之前决定「这一格到底写什么」。有替换时不写原方块，所以客户端只会收到一次方块更新（写错再改会闪一帧）。
    if (auto const filter = gFilter; filter != nullptr && !block.isAir()) {
        ::Block const* replacement = nullptr;
        switch (filter(*thisFor<::BlockSource>(), pos, block, replacement)) {
        case SetBlockVerdict::Deny:
            return false;
        case SetBlockVerdict::Replace:
            if (replacement != nullptr) {
                return origin(pos, *replacement, updateFlags, syncMsg, changeSourceContext);
            }
            break;
        case SetBlockVerdict::Pass:
        default:
            break;
        }
    }

    bool const result = origin(pos, block, updateFlags, syncMsg, changeSourceContext);
    if (result && block.isAir()) {
        // 多投影：分发给所有包含该坐标的会话（可能同时命中多份）。
        ProjectionManager::getInstance().requestRepaintAt(pos.x, pos.y, pos.z);
    }
    return result;
}

ll::memory::HookRegistrar<BlockSetHook> gSetHook;
bool                                    gInstalled{false};

} // namespace

void installBlockChangedHook() {
    if (gInstalled) {
        return;
    }
    gSetHook.hook();
    gInstalled = true;
}

void uninstallBlockChangedHook() {
    if (!gInstalled) {
        return;
    }
    gSetHook.unhook();
    gInstalled = false;
}

bool blockHookInstalled() { return gInstalled; }

std::uint64_t blockSetCalls() { return gSetCalls.load(); }

void setBlockFilter(SetBlockFilter fn) { gFilter = fn; }

SetBlockFilter blockFilter() { return gFilter; }

bool installBlockSourceCapture() {
    if (gCapturedSource != nullptr || gCaptureInstalled) {
        return true;
    }
    try {
        gCaptureHook.hook();
        gCaptureInstalled = true;
    } catch (...) {
        gCaptureInstalled = false;
    }
    // 返回「hook 是否挂上」，不返回「是否已捕获」：世界加载前必然捕获不到，
    // 拿它当安装结果会让每次启动都报一条假的 "NOT installed"。
    return gCaptureInstalled;
}

bool blockSourceCaptureInstalled() { return gCaptureInstalled; }

::BlockSource* capturedBlockSource() { return gCapturedSource; }

void stopBlockSourceCapture() {
    if (gCaptureInstalled) {
        try {
            gCaptureHook.unhook();
        } catch (...) {
        }
        gCaptureInstalled = false;
    }
}

} // namespace litematicabe::ghost
