#pragma once

#include <string>

class CommandOutput;
class Player;

namespace litematicabe::command::probe {

// 一行状态摘要（`/lit`）。
void printState(::CommandOutput& output);

// 完整能力矩阵（`/lit probe`）。
void printProbe(::CommandOutput& output);

// 诊断：打印 Level / 维度 / region 能不能访问（找 BlockSource 用）。
void diagnose(::CommandOutput& output);

} // namespace litematicabe::command::probe
