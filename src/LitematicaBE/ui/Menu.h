#pragma once

#include "LitematicaBE/ui/MenuState.h"

#include <string>

class Player;

namespace litematicabe::ui {

// 唤出主面板（手持木剑 + 左键）。
//
// 每次唤出都重新 `sendTo`：SimpleForm 点按钮后客户端会**立即关闭**表单，
// 所以「原地刷新」在这套交互里不成立 —— 每一页都是一次新的 `sendTo`。
void summon(::Player& player);

// 打开 / 重绘指定页。
void showPage(::Player& player, Page page);

// 玩家下线时清掉面板状态（避免长期占内存）。
void forget(std::string const& playerName);

} // namespace litematicabe::ui
