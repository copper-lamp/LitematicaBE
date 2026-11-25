#include "LitematicaBE/core/save/SaveConfig.h"

#include "LitematicaBE/core/util/TextEncoding.h"

#include "ll/api/mod/Mod.h"
#include "ll/api/mod/NativeMod.h"

#include <nlohmann/json.hpp>

#include <cctype>
#include <exception>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace litematicabe::core::save {

namespace {

namespace util = litematicabe::util;

using Json = nlohmann::json;

Options gOptions{};

std::string lowerAscii(std::string_view raw) {
    std::string text;
    text.reserve(raw.size());
    for (char const c : raw) {
        text.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    }
    return text;
}

char const* formatKey(Format format) {
    switch (format) {
    case Format::Litematic:
        return "litematic";
    case Format::Mcstructure:
        return "mcstructure";
    case Format::Both:
    default:
        return "both";
    }
}

char const* boxStyleKey(BoxStyle style) {
    switch (style) {
    case BoxStyle::Lines:
        return "lines";
    case BoxStyle::Box:
    default:
        return "box";
    }
}

Json toJson(Options const& o) {
    return Json{
        {"maxVolume",            o.maxVolume              },
        {"maxVolumeLitematic",   o.maxVolumeLitematic     },
        {"includeBlockEntities", o.includeBlockEntities   },
        {"writeLiquidLayer",     o.writeLiquidLayer       },
        {"blockVersion",         o.blockVersion           },
        {"dataVersion",          o.dataVersion            },
        {"overwrite",            o.overwrite              },
        {"requireOp",            o.requireOp              },
        {"showSelectionBox",     o.showSelectionBox       },
        {"selectionBoxStyle",    boxStyleKey(o.boxStyle)  },
    };
}

} // namespace

Options const& options() { return gOptions; }

std::optional<Format> parseFormat(std::string_view raw) {
    auto const text = lowerAscii(raw);
    if (text.empty()) {
        return std::nullopt;
    }
    if (text == "litematic" || text == "lite" || text == "lit" || text == "l" || text == "java"
        || text == "投影" || text == "投影文件") {
        return Format::Litematic;
    }
    if (text == "mcstructure" || text == "stru" || text == "structure" || text == "mc" || text == "be"
        || text == "bedrock" || text == "结构" || text == "结构文件") {
        return Format::Mcstructure;
    }
    if (text == "both" || text == "all" || text == "双" || text == "两个") {
        return Format::Both;
    }
    return std::nullopt;
}

char const* formatName(Format format) { return formatKey(format); }

std::optional<BoxStyle> parseBoxStyle(std::string_view raw) {
    auto const text = lowerAscii(raw);
    if (text.empty()) {
        return std::nullopt;
    }
    if (text == "box" || text == "盒" || text == "盒子" || text == "盒体") {
        return BoxStyle::Box;
    }
    if (text == "lines" || text == "line" || text == "线" || text == "线框" || text == "12线") {
        return BoxStyle::Lines;
    }
    return std::nullopt;
}

char const* boxStyleName(BoxStyle style) { return boxStyleKey(style); }

bool loadOptions(std::string& error) {
    auto nativeMod = ::ll::mod::NativeMod::current();
    if (!nativeMod) {
        error = "拿不到模组目录";
        return false;
    }

    auto const configDir  = nativeMod->getConfigDir();
    auto const configPath = configDir / "save.json";

    std::error_code ec;
    std::filesystem::create_directories(configDir, ec);

    Json config;
    if (std::filesystem::exists(configPath, ec)) {
        try {
            std::ifstream in{configPath};
            in >> config;
        } catch (std::exception const& e) {
            error = std::string{"save.json 解析失败："} + e.what();
            return false;
        }
    } else {
        config = toJson(gOptions);
    }

    Options next = gOptions; // 以当前值为基值：文件里缺哪个字段就沿用它
    try {
        next.maxVolume            = config.value("maxVolume", next.maxVolume);
        next.maxVolumeLitematic   = config.value("maxVolumeLitematic", next.maxVolumeLitematic);
        next.includeBlockEntities = config.value("includeBlockEntities", next.includeBlockEntities);
        next.writeLiquidLayer     = config.value("writeLiquidLayer", next.writeLiquidLayer);
        next.blockVersion         = config.value("blockVersion", next.blockVersion);
        next.dataVersion          = config.value("dataVersion", next.dataVersion);
        next.overwrite            = config.value("overwrite", next.overwrite);
        next.requireOp            = config.value("requireOp", next.requireOp);
        next.showSelectionBox     = config.value("showSelectionBox", next.showSelectionBox);
        if (config.contains("selectionBoxStyle")) {
            auto const parsed = parseBoxStyle(config.value("selectionBoxStyle", std::string{"box"}));
            if (!parsed) {
                error = "save.json 的 selectionBoxStyle 不认识（可用 box / lines）";
                return false;
            }
            next.boxStyle = *parsed;
        }
    } catch (std::exception const& e) {
        error = std::string{"save.json 字段类型不符："} + e.what();
        return false;
    }
    if (next.maxVolume == 0) {
        next.maxVolume = 1'000'000;
    }
    if (next.maxVolumeLitematic == 0) {
        next.maxVolumeLitematic = 8'000'000;
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
        "save config loaded from {} (maxVolume={}, requireOp={}, boxStyle={})",
        util::toUtf8(configPath),
        gOptions.maxVolume,
        gOptions.requireOp,
        boxStyleKey(gOptions.boxStyle)
    );
    return true;
}

bool reloadOptions(std::string& error) { return loadOptions(error); }

std::string describe() {
    std::string text = "§b[投影保存]§r /lit save <stru|lite> <名字>：";
    text += gOptions.requireOp ? "需要管理员" : "不限身份";
    text += gOptions.overwrite ? "｜同名覆盖" : "｜同名不覆盖";
    text += gOptions.includeBlockEntities ? "｜含方块实体" : "｜仅方块";
    text += "｜线框 ";
    text += boxStyleKey(gOptions.boxStyle);
    return text;
}

} // namespace litematicabe::core::save
