#pragma once

#include <string_view>

namespace litematicabe {

// 版本唯一真源。lip.toml 的 version、CHANGELOG 的最新条目必须与这里一致，
// tools/ 下的 check_version.py 会在 CI 与本地构建前做校验。
inline constexpr std::string_view kVersion = "4.0.0";

// 目标平台基线，只用于日志与现场排查。
inline constexpr std::string_view kTargetBaseline = "BDS 1.21.132.x / LeviLamina 1.9.x";

} // namespace litematicabe
