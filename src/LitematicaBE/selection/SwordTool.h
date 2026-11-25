#pragma once

#include "LitematicaBE/selection/SelectionStore.h"

#include <cstddef>
#include <string>
#include <unordered_set>

class Player;
class ItemStack;
class BlockPos;

namespace litematicabe::selection {

// 木剑选点（旧项目 `SelectionTool` + `index.js` 的 `onUseItemOn` 迁过来）。
//
// 与轻松放置共用同一个 `Item::useOn` hook：这里不新增 hook，而是向 `easyplace`
// 注册一个「放行前拦截」回调 —— 同函数挂两个 hook 会互踢，改成回调是唯一稳的做法。
//
// 手势：
//   * 主手木剑 + 右键方块      → 记一点（第一点 pos1，第二点 pos2，第三点重新开始）
//   * 主手木剑 + 潜行 + 右键方块 → 清空选区并收回线框
//   * 非木剑                   → 完全不干预（返回 false，原版与轻松放置照旧）
bool install();
void uninstall();
[[nodiscard]] bool installed();

// easyplace 的回调入口（`Item::useOn` 里、`origin()` 之前被调用）。
// @return true 表示这一击被选区工具吃掉（不放置、不触发方块交互）。
bool onUseOn(::Player& player, ::ItemStack& item, ::BlockPos const& pos, unsigned char face);

// 清掉选区 + 线框（命令 `/lit sel clear` 用）。
void clearSelection(std::string const& playerName);

// 位图式自检：当前选区状态（命令 `/lit sel` 用）。
[[nodiscard]] std::string describeSelection(std::string const& playerName);

} // namespace litematicabe::selection
