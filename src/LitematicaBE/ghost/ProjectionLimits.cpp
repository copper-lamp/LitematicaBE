#include "LitematicaBE/ghost/ProjectionLimits.h"

#include "LitematicaBE/core/util/TextEncoding.h"

#include "ll/api/mod/Mod.h"
#include "ll/api/mod/NativeMod.h"

#include <nlohmann/json.hpp>

#include <cstdint>
#include <exception>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace litematicabe::ghost::limits {

namespace {

namespace util = litematicabe::util;

using Json = nlohmann::json;

Options gOptions{};

Json toJson(Options const& o) {
    return Json{
        {"maxLoadBlocks",  o.maxLoadBlocks },
        {"maxPlaceBlocks", o.maxPlaceBlocks},
    };
}

// 读一个「正整数字段」。
//
// 缺失 / null → 沿用 fallbackMissing（热重载时即「上次的值」）；
// 类型不符 → 返回 false 并写 error（和 save.json 一样硬报错，免得用户以为改了却没生效）；
// `<= 0` → 回落 fallbackInvalid：负数原样转 `std::size_t` 会变成天文数字，
// 下一次 `/lit load` 直接吃光内存。
bool readCount(
    Json const&   config,
    char const*   key,
    std::size_t   fallbackMissing,
    std::size_t   fallbackInvalid,
    std::size_t&  out,
    std::string&  error
) {
    auto const it = config.find(key);
    if (it == config.end() || it->is_null()) {
        out = fallbackMissing;
        return true;
    }
    if (!it->is_number_integer() && !it->is_number_unsigned()) {
        error = std::string{"projection.json 的 "} + key + " 必须是整数";
        return false;
    }

    std::size_t parsed = fallbackInvalid;
    try {
        if (it->is_number_unsigned()) {
            parsed = static_cast<std::size_t>(it->get<std::uint64_t>());
        } else {
            auto const raw = it->get<std::int64_t>();
            parsed         = raw > 0 ? static_cast<std::size_t>(raw) : fallbackInvalid;
        }
    } catch (std::exception const& e) {
        error = std::string{"projection.json 的 "} + key + " 读不出整数：" + e.what();
        return false;
    }
    if (parsed == 0) {
        parsed = fallbackInvalid;
    }
    out = parsed;
    return true;
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
    auto const configPath = configDir / "projection.json";

    std::error_code ec;
    std::filesystem::create_directories(configDir, ec);

    Json config;
    if (std::filesystem::exists(configPath, ec)) {
        try {
            std::ifstream in{configPath};
            in >> config;
        } catch (std::exception const& e) {
            error = std::string{"projection.json 解析失败："} + e.what();
            return false;
        }
    } else {
        config = toJson(gOptions);
    }

    Options next = gOptions; // 以当前值为基值：文件里缺哪个字段就沿用它
    if (!readCount(
            config,
            "maxLoadBlocks",
            next.maxLoadBlocks,
            Options{}.maxLoadBlocks,
            next.maxLoadBlocks,
            error
        )) {
        return false;
    }
    if (!readCount(
            config,
            "maxPlaceBlocks",
            next.maxPlaceBlocks,
            Options{}.maxPlaceBlocks,
            next.maxPlaceBlocks,
            error
        )) {
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
        "projection limits loaded from {} (maxLoadBlocks={}, maxPlaceBlocks={})",
        util::toUtf8(configPath),
        gOptions.maxLoadBlocks,
        gOptions.maxPlaceBlocks
    );
    return true;
}

bool reloadOptions(std::string& error) { return loadOptions(error); }

std::string describe() {
    return "加载上限 " + std::to_string(gOptions.maxLoadBlocks) + " 格｜放置单次上限 "
         + std::to_string(gOptions.maxPlaceBlocks) + " 格";
}

} // namespace litematicabe::ghost::limits