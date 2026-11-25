#include "LitematicaBE/ghost/ShareSwitch.h"

#include "LitematicaBE/core/util/TextEncoding.h"

#include "ll/api/mod/Mod.h"
#include "ll/api/mod/NativeMod.h"

#include <nlohmann/json.hpp>

#include <exception>
#include <filesystem>
#include <fstream>
#include <system_error>
#include <unordered_set>

namespace litematicabe::ghost::share {

namespace {

namespace util = litematicabe::util;

using Json = nlohmann::json;

// 只存「私有」的玩家名：默认是全体共享，所以这个集合通常是空的。
// 全部在服务端主线程访问（命令回调 / 定时器），不需要额外加锁。
std::unordered_set<std::string> gPrivate;

constexpr char const* kConfigName = "share.json";
constexpr char const* kField      = "private";

std::filesystem::path configPath() {
    auto mod = ::ll::mod::NativeMod::current();
    if (!mod) {
        return {};
    }
    return mod->getConfigDir() / kConfigName;
}

void logWarn(std::string const& text) {
    if (auto mod = ::ll::mod::NativeMod::current()) {
        mod->getLogger().warn("share config: {}", text);
    }
}

} // namespace

bool sharedFor(std::string const& playerName) {
    if (playerName.empty()) {
        return true;
    }
    return gPrivate.find(playerName) == gPrivate.end();
}

bool setShared(std::string const& playerName, bool shared) {
    if (playerName.empty()) {
        return true;
    }
    if (shared) {
        gPrivate.erase(playerName);
    } else {
        gPrivate.insert(playerName);
    }
    save();
    return shared;
}

bool toggle(std::string const& playerName) { return setShared(playerName, !sharedFor(playerName)); }

void clearAll() { gPrivate.clear(); }

std::size_t privateCount() { return gPrivate.size(); }

bool load() {
    auto const path = configPath();
    if (path.empty()) {
        logWarn("拿不到模组目录，开关只在内存里生效");
        return false;
    }

    std::error_code ec;
    std::filesystem::create_directories(path.parent_path(), ec);

    Json config;
    if (std::filesystem::exists(path, ec)) {
        try {
            std::ifstream in{path};
            in >> config;
        } catch (std::exception const& e) {
            logWarn(std::string{"share.json 解析失败（按默认全体共享运行）："} + e.what());
            gPrivate.clear();
            return false;
        }
    }

    gPrivate.clear();
    // 文件不存在时 config 是 null，对 null 调 find 会抛 —— 先确认是 object。
    if (config.is_object()) {
        if (auto const it = config.find(kField); it != config.end() && it->is_array()) {
            for (auto const& item : *it) {
                if (item.is_string()) {
                    auto const name = item.get<std::string>();
                    if (!name.empty()) {
                        gPrivate.insert(name);
                    }
                }
            }
        }
    }

    // 文件不存在（或字段缺失）：写一份出来，用户能直接看到可改的字段。
    if (!std::filesystem::exists(path, ec)) {
        save();
    }

    if (auto mod = ::ll::mod::NativeMod::current()) {
        mod->getLogger().info(
            "share config loaded from {} ({} private player(s), default shared)",
            util::toUtf8(path),
            gPrivate.size()
        );
    }
    return true;
}

bool save() {
    auto const path = configPath();
    if (path.empty()) {
        return false;
    }

    Json config;
    config[kField] = Json::array();
    for (auto const& name : gPrivate) {
        config[kField].push_back(name);
    }

    try {
        std::error_code ec;
        std::filesystem::create_directories(path.parent_path(), ec);
        std::ofstream out{path};
        if (!out) {
            logWarn("写不进 " + util::toUtf8(path));
            return false;
        }
        out << config.dump(2) << '\n';
        return out.good();
    } catch (std::exception const& e) {
        logWarn(std::string{"写 share.json 失败："} + e.what());
        return false;
    }
}

std::string describe() {
    if (gPrivate.empty()) {
        return "§b[投影共享]§r 全体共享（默认）";
    }
    return "§b[投影共享]§r 全体共享（默认）｜私有 " + std::to_string(gPrivate.size()) + " 人";
}

std::string describeFor(std::string const& playerName) {
    if (sharedFor(playerName)) {
        return "§a共享§r：你放置的投影所有在线玩家都能看到";
    }
    return "§e私有§r：你放置的投影只有你自己能看到";
}

} // namespace litematicabe::ghost::share
