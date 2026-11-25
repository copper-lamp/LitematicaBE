#pragma once

#include <filesystem>
#include <string>

class CommandOutput;
class Player;

namespace litematicabe::command::schematic {

// 相对路径按 `模组目录/schematics/<file>` 解析，绝对路径原样返回。
std::filesystem::path resolveFile(std::string const& raw);

// `/lit info <file>`：解析统计，不发包。
void printInfo(::CommandOutput& output, std::string const& file);

// `/lit load <file>`：以玩家脚下为原点铺投影（首版不做层/旋转/表面剔除）。
void loadProjection(::CommandOutput& output, ::Player& player, std::string const& file);

// `/lit load <file> <x> <y> <z>`：控制台/玩家都可以指定原点铺设。
void loadProjectionAt(::CommandOutput& output, std::string const& file, int x, int y, int z);

// `/lit layer <from> [to]`：切到指定层区间（先收回旧层，再发新层）。
void switchLayers(::CommandOutput& output, ::Player& player, int from, int to);

// `/lit unload`：收回当前显示的全部假方块（读真实方块发回）。
void unloadProjection(::CommandOutput& output, ::Player& player);

// 控制台执行 layer/unload 时只报告会话状态（假方块只能发给玩家，控制台没有目标）。
void reportSession(::CommandOutput& output);

// `/lit reload`：重载映射表并清空状态解析缓存（改完 ghost_map.json 不用重启）。
void reloadData(::CommandOutput& output);

// `/lit resend`：把当前显示层重新推给所有在线玩家（诊断镜像/重发用）。
void resendAll(::CommandOutput& output);

// 控制台切层：只计算并缓存，不发包（玩家进服后轮询自动补发）。
void prepareLayers(::CommandOutput& output, int from, int to);

// `/lit rotate`：整体顺时针转 90°（每次调用累加；无玩家时只更新缓存）。
void rotateProjection(::CommandOutput& output, ::Player* player);

// 多投影管理：列出 / 选中 / 删除。
void listProjects(::CommandOutput& output);
void selectProjection(::CommandOutput& output, int id);
void removeProjection(::CommandOutput& output, int id, ::Player* player);

// `/lit place`：把投影方块**真实写入世界**（覆盖式：目标位置已有方块也照样写）。
//
// 受 `config/place.json` 的使用门槛约束（默认要求创造模式、不要求管理员）；
// 控制台执行不受限制。
void placeProjection(::CommandOutput& output, ::Player* player, int from, int to);

// `/lit list`：列出插件目录 `schematics/` 下可用的投影文件。
void listFiles(::CommandOutput& output);

} // namespace litematicabe::command::schematic
