#pragma once

#include <cstdint>

namespace litematicabe::ui {

// 木剑手势监听。
bool install();

void uninstall();

[[nodiscard]] bool installed();

// 实际启用的链路组合："animate" / "useitem" / "animate+useitem" / ""。
[[nodiscard]] char const* activePath();

// 诊断计数（面板诊断页与日志用）。
//
//  `animateSwings`：`AnimatePacket(Swing)` 命中次数 —— 为 0 说明 hook 没挂上，或者客户端根本没发这个包；
//  `swordSwings`：其中「手持木剑」并真正唤出面板的次数。
struct TriggerStats {
    std::uint64_t animateSwings{};
    std::uint64_t swordSwings{};
};

[[nodiscard]] TriggerStats triggerStats();

} // namespace litematicabe::ui
