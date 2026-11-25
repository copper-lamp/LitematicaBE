#pragma once

#include "LitematicaBE/printer/Printer.h"

#include <string>

namespace litematicabe::printer {

// 从 `<模组目录>/config/printer.json` 读配置。
//
// * 文件不存在：写入一份默认值并返回成功；
// * 文件存在但解析/字段类型出错：返回 false，`error` 里带原因（调用方沿用旧值）；
// * 成功：把结果写回 `out`，并顺手把文件补全（缺失字段固化成当前生效值）。
bool loadOptionsFile(Options& out, std::string& error);

} // namespace litematicabe::printer
