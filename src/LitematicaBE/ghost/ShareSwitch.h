#pragma once

#include <cstddef>
#include <string>

namespace litematicabe::ghost::share {

// 「投影是否共享」的玩家级开关。
//
// 语义只有一条：**你自己放置（`/lit load`）的投影，别人能不能看到**。
//   * `true`（默认，全体共享）：所有在线玩家都能看到你的投影；
//     进服 / 重生 / 传送 / 心跳的补发照旧广播给所有人。
//   * `false`（私有）：只有你自己能看到。显示层只发给你；别人屏幕上已经看到的
//     ghost 会被立刻收回（读该格真实方块发回去），排队未发的 ghost 包也会丢掉。
//
// 实现要点：
//   * 偏好按**主人**记录，落到 `config/share.json` 的 `private` 名单
//     （默认共享，所以绝大多数服务器上这个数组是空的）；
//   * 判定发生在发包点上（`ProjectionSession::visibleTo`），所以切开关不需要重载投影 ——
//     已经显示着的层会立刻按新可见性重发 / 收回；
//   * 控制台 `/lit load <file> <x> <y> <z>` 建的会话没有主人，恒为共享，
//     不受任何玩家开关影响；
//   * 包围盒线框（hologramlib 的 DebugShape）是全局形状、没有按玩家隔离的接口，
//     私有会话因此不画线框（宁可不画，也不把位置泄露给旁人）。

// 该玩家当前的可见性偏好（没有记录 = 共享）。
[[nodiscard]] bool sharedFor(std::string const& playerName);

// 设置并立即写盘；返回设置后的值。
bool setShared(std::string const& playerName, bool shared);

// 切换；返回切换后的值。
bool toggle(std::string const& playerName);

// 只清内存（关服 / 重载配置用），不写盘。
void clearAll();

// 当前选了「私有」的玩家数（其余玩家一律共享，不占存储）。
[[nodiscard]] std::size_t privateCount();

// 启动时读 `config/share.json`（文件不存在会写一份默认的）。
bool load();

// 把当前私有名单写回 `config/share.json`。
bool save();

// `/lit` 摘要行。
[[nodiscard]] std::string describe();

// `/lit share` 的单人回显。
[[nodiscard]] std::string describeFor(std::string const& playerName);

} // namespace litematicabe::ghost::share
