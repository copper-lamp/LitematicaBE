#pragma once

#include <string>

class Player;

namespace litematicabe::core::place {

// `/lit place`的使用门槛。
//
// 两个开关都在 `config/place.json`，改完 `/lit reload` 即生效：
//   * `requireAdmin`    —— 需要管理员（OP）身份，默认关；
//   * `requireCreative` —— 需要创造模式，默认开。
//
// 只约束玩家执行；控制台不接受这两个限制。
// 注意这是执行时判定，不是命令注册权限：`/lit place` 仍对所有人生效于补全列表，被拦下时会得到一句可读原因，而不是「未知命令」。
struct Options {
    bool requireAdmin{false};   //< 需要 OP
    bool requireCreative{true}; //< 需要创造模式
};

[[nodiscard]] Options const& options();

// 读 `config/place.json`（文件不存在就写一份默认的；缺字段用默认值并回写）。
// @return false 时 `error` 是原因，调用方沿用旧值。
bool loadOptions(std::string& error);

// `/lit reload` 用：语义同 `loadOptions`，失败时保持原值。
bool reloadOptions(std::string& error);

// 该玩家现在能不能用 `/lit place`；不能时把中文原因写进 `reason`。
// 判定顺序：管理员 → 创造模式（先报身份，比「先切创造模式」更不容易误导）。
[[nodiscard]] bool checkAccess(::Player const& player, std::string& reason);

// `/lit` 摘要行。
[[nodiscard]] std::string describe();

} // namespace litematicabe::core::place
