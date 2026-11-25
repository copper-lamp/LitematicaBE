#pragma once

#include <cstddef>
#include <string>

namespace litematicabe::ghost::limits {

// `config/projection.json` 的生效值。
//
// 这两个上限以前是写死在代码里的常量（加载 40 万格 / 单次放置 20 万格），两头都难受：
// 内存富余的服拼不出 40 万格的建筑，小内存服又想调小防 OOM。现在统一由配置决定，
// 改完 `/lit reload` 热重载，下一次 `/lit load` / `/lit place` 立即按新值跑。
//
// 两者各自作用在不同阶段，别混：
//   * `maxLoadBlocks`   —— `/lit load` 解析 → 映射 → 表面剔除之前就按这个数截停，
//                          超出部分根本不进会话（只是"看不到"，不会写世界）；
//   * `maxPlaceBlocks`  —— `/lit place` 把投影**真实写进世界**的单次上限，
//                          超出的格子记为 `pending`，用 `/lit place <from> <to>` 分层接着放。
//
// 0 视为手滑，回落默认值（与 `config/save.json` 的 `maxVolume` 同口径）。
struct Options {
    std::size_t maxLoadBlocks{400000};  //< 一份投影最多收进会话的方块数（超出截断并在回显报错）
    std::size_t maxPlaceBlocks{200000}; //< `/lit place` 单次写入世界的方块数（超出记 pending）
};

// 当前生效值（只读）。
Options const& options();

// 读 `config/projection.json`；文件不存在时按默认值写一份，缺失字段补默认。
bool loadOptions(std::string& error);
bool reloadOptions(std::string& error);

// `/lit reload` 回显用的一行摘要。
[[nodiscard]] std::string describe();

} // namespace litematicabe::ghost::limits