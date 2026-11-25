#include "LitematicaBE/printer/PrinterConfig.h"

#include "LitematicaBE/core/util/TextEncoding.h"

#include "ll/api/mod/Mod.h"
#include "ll/api/mod/NativeMod.h"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <exception>
#include <filesystem>
#include <fstream>
#include <string>
#include <system_error>
#include <utility>

namespace litematicabe::printer {

namespace {

using Json = nlohmann::json;

Json toJson(Options const& o) {
    return Json{
        {"range",                 o.range                },
        {"intervalMs",            o.intervalMs           },
        {"maxPerRound",           o.maxPerRound          },
        {"eyeOffsetMilli",        o.eyeOffsetMilli       },
        {"creativeFree",          o.creativeFree         },
        {"consumeInSurvival",     o.consumeInSurvival    },
        {"onlyAir",               o.onlyAir              },
        {"layerLimited",          o.layerLimited         },
        {"skipBlockEntities",     o.skipBlockEntities    },
        {"skipMultiblock",        o.skipMultiblock       },
        {"skipFluids",            o.skipFluids           },
        {"skipPlayerCells",       o.skipPlayerCells      },
        {"respectPlayerBreaks",   o.respectPlayerBreaks  },
        {"playerBreakCooldownMs", o.playerBreakCooldownMs},
        {"notifyCooldownMs",      o.notifyCooldownMs     },
        {"maxRange",              o.maxRange             },
        {"extraReplaceable",      o.extraReplaceable     },
    };
}

void clampOptions(Options& o) {
    o.maxRange              = std::clamp(o.maxRange, 1.0f, 32.0f);
    o.range                 = std::clamp(o.range, 0.5f, o.maxRange);
    o.intervalMs            = std::clamp(o.intervalMs, 20, 2000);
    o.maxPerRound           = std::clamp(o.maxPerRound, 1, 64);
    o.eyeOffsetMilli        = std::clamp(o.eyeOffsetMilli, 0, 2000);
    o.playerBreakCooldownMs = std::clamp(o.playerBreakCooldownMs, 0, 60000);
    o.notifyCooldownMs      = std::clamp(o.notifyCooldownMs, 200, 60000);
}

} // namespace

bool loadOptionsFile(Options& out, std::string& error) {
    auto nativeMod = ::ll::mod::NativeMod::current();
    if (!nativeMod) {
        error = "拿不到模组目录";
        return false;
    }

    auto const configDir  = nativeMod->getConfigDir();
    auto const configPath = configDir / "printer.json";

    std::error_code ec;
    std::filesystem::create_directories(configDir, ec);

    Json config;
    if (std::filesystem::exists(configPath, ec)) {
        try {
            std::ifstream in{configPath};
            in >> config;
        } catch (std::exception const& e) {
            error = std::string{"printer.json 解析失败："} + e.what();
            return false;
        }
    } else {
        config = toJson(Options{});
    }

    Options options = out; // 以调用方给的默认值为基值，文件里缺哪个字段就用默认
    try {
        options.range                 = config.value("range", options.range);
        options.intervalMs            = config.value("intervalMs", options.intervalMs);
        options.maxPerRound           = config.value("maxPerRound", options.maxPerRound);
        options.eyeOffsetMilli        = config.value("eyeOffsetMilli", options.eyeOffsetMilli);
        options.creativeFree          = config.value("creativeFree", options.creativeFree);
        options.consumeInSurvival     = config.value("consumeInSurvival", options.consumeInSurvival);
        options.onlyAir               = config.value("onlyAir", options.onlyAir);
        options.layerLimited          = config.value("layerLimited", options.layerLimited);
        options.skipBlockEntities     = config.value("skipBlockEntities", options.skipBlockEntities);
        options.skipMultiblock        = config.value("skipMultiblock", options.skipMultiblock);
        options.skipFluids            = config.value("skipFluids", options.skipFluids);
        options.skipPlayerCells       = config.value("skipPlayerCells", options.skipPlayerCells);
        options.respectPlayerBreaks   = config.value("respectPlayerBreaks", options.respectPlayerBreaks);
        options.playerBreakCooldownMs = config.value("playerBreakCooldownMs", options.playerBreakCooldownMs);
        options.notifyCooldownMs      = config.value("notifyCooldownMs", options.notifyCooldownMs);
        options.maxRange              = config.value("maxRange", options.maxRange);

        if (auto const it = config.find("extraReplaceable"); it != config.end() && it->is_array()) {
            options.extraReplaceable.clear();
            for (auto const& item : *it) {
                if (item.is_string()) {
                    options.extraReplaceable.push_back(item.get<std::string>());
                }
            }
        }
    } catch (std::exception const& e) {
        error = std::string{"printer.json 字段类型不符："} + e.what();
        return false;
    }

    clampOptions(options);
    out = std::move(options);

    // 回写：让用户能直接看到全部生效字段（也把缺失字段补齐）。
    try {
        std::ofstream outFile{configPath};
        outFile << toJson(out).dump(4) << '\n';
    } catch (std::exception const&) {
        // 写不进去不影响运行。
    }

    nativeMod->getLogger().info("printer config loaded from {}", util::toUtf8(configPath));
    return true;
}

} // namespace litematicabe::printer
