#pragma once

class CommandOutput;

namespace litematicabe::command::report {

// `/lit material`：统计**当前选中**投影的材料并导出 `.xlsx`
// （落到 `<模组目录>/exports/材料清单_<投影名>.xlsx`，同名覆盖）。
//
// 统计口径：按「方块名 + 材质变体（颜色/木种/石材）」合并，朝向与开关不计入；
// 空气在解析阶段就跳过了，不参与统计。
void exportMaterials(::CommandOutput& output);

} // namespace litematicabe::command::report
