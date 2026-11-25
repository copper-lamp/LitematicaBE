#include "LitematicaBE/core/place/PlaceConfig.h"

#include "LitematicaBE/core/util/TextEncoding.h"

#include "ll/api/mod/Mod.h"
#include "ll/api/mod/NativeMod.h"

#include "mc/world/actor/player/Player.h"
#include "mc/world/level/GameType.h"

#include <nlohmann/json.hpp>

#include <exception>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace litematicabe::core::place {

namespace {

namespace util = litematicabe::util;

using Json = nlohmann::json;

Options gOptions{};

Json toJson(Options const& o) {
    return Json{
        {"requireAdmin",    o.requireAdmin   },
        {"requireCreative", o.requireCreative}
    };
}

} // namespace

Options const& options() { return gOptions; }

bool loadOptions(std::string& error) {
    auto nativeMod = ::ll::mod::NativeMod::current();
    if (!nativeMod) {
        error = "拿不到模组目录";
        return false;
    }

    auto const configDir  = nativeMod->getConfigDir();
    auto const configPath = configDir / "place.json";

    std::error_code ec;
    std::filesystem::create_directories(configDir, ec);

    Json config;
    if (std::filesystem::exists(configPath, ec)) {
        try {
            std::ifstream in{configPath};
            in >> config;
        } catch (std::exception const& e) {
            error = std::string{"place.json 解析失败："} + e.what();
            return false;
        }
    } else {
        config = toJson(gOptions);
    }

    Options next = gOptions; // 以当前值为基值，文件里缺哪个字段就用它
    try {
        next.requireAdmin    = config.value("requireAdmin", next.requireAdmin);
        next.requireCreative = config.value("requireCreative", next.requireCreative);
    } catch (std::exception const& e) {
        error = std::string{"place.json 字段类型不符："} + e.what();
        return false;
    }
    gOptions = next;

    // 回写：让用户直接看到全部生效字段（也把缺失字段补齐）。
    try {
        std::ofstream outFile{configPath};
        outFile << toJson(gOptions).dump(4) << '\n';
    } catch (std::exception const&) {
        // 写不进去不影响运行。
    }

    nativeMod->getLogger().info(
        "place config loaded from {} (requireAdmin={}, requireCreative={})",
        util::toUtf8(configPath),
        gOptions.requireAdmin,
        gOptions.requireCreative
    );
    return true;
}

bool reloadOptions(std::string& error) { return loadOptions(error); }

bool checkAccess(::Player const& player, std::string& reason) {
    if (gOptions.requireAdmin && !player.isOperator()) {
        reason = "需要管理员（OP）身份 —— config/place.json 的 requireAdmin 现在是开着的";
        return false;
    }
    if (gOptions.requireCreative && player.getPlayerGameType() != ::GameType::Creative) {
        reason = "需要创造模式 —— config/place.json 的 requireCreative 现在是开着的（切到创造模式再试）";
        return false;
    }
    return true;
}

std::string describe() {
    std::string text = "§b[直接放置]§r /lit place：";
    text += gOptions.requireCreative ? "需要创造模式" : "任意游戏模式";
    text += gOptions.requireAdmin ? "｜需要管理员" : "｜不限身份";
    return text;
}

} // namespace litematicabe::core::place
