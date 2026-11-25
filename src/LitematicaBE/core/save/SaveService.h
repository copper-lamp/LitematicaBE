#pragma once

#include "LitematicaBE/core/save/SaveConfig.h"
#include "LitematicaBE/selection/SelectionStore.h"

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

class BlockSource;
class CommandOutput;
class Player;

namespace litematicabe::core::save {

struct SaveRequest {
    std::string name;   // 玩家给的名字（可带扩展名，会被剥掉）
    std::string author; // 玩家名 / `console`
    Format      format{Format::Mcstructure};
    bool        verify{false}; // 写完回读逐格比对
};

struct SaveResult {
    bool                              ok{};
    std::vector<std::filesystem::path> files;
    std::uint64_t                     volume{};
    std::size_t                       nonAir{};
    std::size_t                       palette{};
    std::size_t                       bytes{};
    std::size_t                       loadedChunks{};
    std::size_t                       failedChunks{};
    std::uint64_t                     stateFallback{};
    std::uint64_t                     entities{};
    std::size_t                       verifyChecked{};
    std::size_t                       verifyMatched{};
    std::size_t                       verifyFailed{};
    std::string                       error;
};

// 找 `BlockSource`：玩家所在维度 → 运行时捕获 → 维度表（DimensionManager）→ 已加载 region。
// `dimid` 用于优先挑对维度的 BlockSource（不匹配时退回第一个可用维度）。
// 控制台执行时靠后三级；一个都没有时返回 nullptr。
::BlockSource* acquireSource(::Player* player, std::int32_t dimid, std::string& how);

// 名字清理：去扩展名、去路径分隔符与 `<>:"|?*`，空名兜底 `selection`。
std::string sanitizeName(std::string const& raw);

// 目标文件路径：`<模组目录>/schematics/<name>.<ext>`。
std::filesystem::path targetPath(std::string const& name, Format format);

// 保存选区：检查门槛/体积/同名 → 扫描一遍 → 按格式落盘 → 可选回读自检。
// 所有面向玩家的回显都写进 `output`；返回值与 `result` 同步。
bool saveSelection(
    ::CommandOutput&            output,
    ::Player*                   player,
    selection::Box const&       box,
    SaveRequest const&          request,
    SaveResult&                 result
);

// `/lit savediag <x> <y> <z>`：读一个方块，打印名字与状态提取结果（排查类型兜底用）。
void diagnoseBlock(::CommandOutput& output, ::Player* player, int x, int y, int z);

// 无人值守自检：环境变量 `LITEMATICABE_SELF_TEST="x1 y1 z1 x2 y2 z2 [名字] [格式]"`。
// 启动后延迟 10 秒执行一次完整「扫描 → 导出 → 回读自检」，结果写进服务器日志。
// 用途：没有客户端（控制台 stdin 也被 LeviLamina 接管）时，验证导出链路是否真的通。
// 返回 false 表示环境变量没设（正常路径）。
bool runSelfTestFromEnv();

} // namespace litematicabe::core::save
