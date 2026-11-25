#include "LitematicaBE/core/report/MaterialCounter.h"

#include <algorithm>
#include <cstddef>
#include <iterator>
#include <string_view>
#include <unordered_map>
#include <utility>

namespace litematicabe::core::report {

namespace {

struct Label {
    std::string_view value;
    std::string_view label;
};

// 16 色（基岩 `color` / Java 名字里的 `light_gray` 都走这张表）。
constexpr Label kColors[] = {
    {"white",      "白色"  },
    {"orange",     "橙色"  },
    {"magenta",    "品红色"},
    {"light_blue", "淡蓝色"},
    {"yellow",     "黄色"  },
    {"lime",       "黄绿色"},
    {"pink",       "粉红色"},
    {"gray",       "灰色"  },
    {"grey",       "灰色"  },
    {"silver",     "淡灰色"},
    {"light_gray", "淡灰色"},
    {"cyan",       "青色"  },
    {"purple",     "紫色"  },
    {"blue",       "蓝色"  },
    {"brown",      "棕色"  },
    {"green",      "绿色"  },
    {"red",        "红色"  },
    {"black",      "黑色"  },
};

// 木种（`.litematic` 里是 `oak_planks` 这种名字，基岩侧偶尔用 `wood_type=oak`）。
constexpr Label kWoods[] = {
    {"oak",        "橡木"    },
    {"spruce",     "云杉木"  },
    {"birch",      "白桦木"  },
    {"jungle",     "丛林木"  },
    {"acacia",     "金合欢木"},
    {"dark_oak",   "深色橡木"},
    {"mangrove",   "红树木"  },
    {"cherry",     "樱花木"  },
    {"bamboo",     "竹"      },
    {"crimson",    "绯红木"  },
    {"warped",     "诡异木"  },
    {"pale_oak",   "苍白橡木"},
};

// 基岩 `stone_type` / `sand_type` / `dirt_type` 的取值。
constexpr Label kStones[] = {
    {"stone",            "石头"      },
    {"granite",          "花岗岩"    },
    {"granite_smooth",   "磨制花岗岩"},
    {"diorite",          "闪长岩"    },
    {"diorite_smooth",   "磨制闪长岩"},
    {"andesite",         "安山岩"    },
    {"andesite_smooth",  "磨制安山岩"},
};

constexpr Label kSands[] = {
    {"normal", "沙子"  },
    {"red",    "红沙"  },
    {"soul",   "灵魂沙"},
    {"soul_sand", "灵魂沙"},
};

constexpr Label kDirts[] = {
    {"normal", "泥土"},
    {"coarse", "砂土"},
};

template <std::size_t N>
std::string_view lookup(Label const (&table)[N], std::string_view value) {
    for (auto const& entry : table) {
        if (entry.value == value) {
            return entry.label;
        }
    }
    return {};
}

std::string toLowerAscii(std::string text) {
    for (char& c : text) {
        if (c >= 'A' && c <= 'Z') {
            c = static_cast<char>(c - 'A' + 'a');
        }
    }
    return text;
}

std::string trim(std::string text) {
    std::size_t begin = 0;
    while (begin < text.size() && (text[begin] == ' ' || text[begin] == '\t')) {
        ++begin;
    }
    std::size_t end = text.size();
    while (end > begin && (text[end - 1] == ' ' || text[end - 1] == '\t')) {
        --end;
    }
    return text.substr(begin, end - begin);
}

// 状态值可能带引号（NBT 里字符串状态会写成 `"value"`）。
std::string unquote(std::string value) {
    if (value.size() >= 2 && (value.front() == '"' || value.front() == '\'') && value.back() == value.front()) {
        value = value.substr(1, value.size() - 2);
    }
    return value;
}

std::string stripNamespace(std::string key) {
    if (key.rfind("minecraft:", 0) == 0) {
        key.erase(0, 10);
    }
    return key;
}

} // namespace

std::string materialVariantLabel(std::string const& key, std::string const& value) {
    auto const normalizedKey   = toLowerAscii(stripNamespace(key));
    auto const normalizedValue = toLowerAscii(unquote(value));

    std::string_view label;
    if (normalizedKey == "color") {
        label = lookup(kColors, normalizedValue);
    } else if (normalizedKey == "wood_type") {
        label = lookup(kWoods, normalizedValue);
    } else if (normalizedKey == "stone_type") {
        label = lookup(kStones, normalizedValue);
    } else if (normalizedKey == "sand_type") {
        label = lookup(kSands, normalizedValue);
    } else if (normalizedKey == "dirt_type") {
        label = lookup(kDirts, normalizedValue);
    } else {
        return {};
    }

    if (!label.empty()) {
        return std::string{label};
    }
    // 认不出的取值照原样给出来：宁可显示英文也不丢弃。
    return unquote(value);
}

ParsedState parseStateText(std::string const& stateText) {
    ParsedState parsed;

    auto const open = stateText.find('[');
    parsed.name     = trim(stripNamespace(open == std::string::npos ? stateText : stateText.substr(0, open)));

    if (open == std::string::npos) {
        return parsed;
    }

    auto const  close = stateText.find(']', open);
    auto const  end   = close == std::string::npos ? stateText.size() : close;
    std::string body  = stateText.substr(open + 1, end - open - 1);

    // 变体只认「材质分支」这一组键，且按固定优先级取第一个：
    //   color > wood_type > stone_type > sand_type > dirt_type
    // 朝向（facing / direction / axis）、开关（open / powered）一律忽略。
    constexpr char const* kKeys[] = {"color", "wood_type", "stone_type", "sand_type", "dirt_type"};
    std::string           found[std::size(kKeys)];

    std::size_t begin = 0;
    while (begin <= body.size()) {
        auto const comma = body.find(',', begin);
        auto const stop  = comma == std::string::npos ? body.size() : comma;
        auto       pair  = body.substr(begin, stop - begin);

        auto const equals = pair.find('=');
        if (equals != std::string::npos) {
            auto const key   = toLowerAscii(stripNamespace(unquote(trim(pair.substr(0, equals)))));
            auto const value = unquote(trim(pair.substr(equals + 1)));
            for (std::size_t i = 0; i < std::size(kKeys); ++i) {
                if (key == kKeys[i] && found[i].empty()) {
                    found[i] = materialVariantLabel(key, value);
                }
            }
        }

        if (comma == std::string::npos) {
            break;
        }
        begin = comma + 1;
    }

    for (auto const& value : found) {
        if (!value.empty()) {
            parsed.variant = value;
            break;
        }
    }
    return parsed;
}

MaterialReport countMaterials(
    std::vector<std::string> const&   paletteStates,
    std::vector<std::uint32_t> const& blockPaletteIds,
    std::vector<bool> const*          palettePlaceable
) {
    constexpr std::size_t kNoIndex = static_cast<std::size_t>(-1);

    MaterialReport report;
    report.items.reserve(64);

    // 调色板下标 → items 下标（同一状态串只解析一次）。
    std::vector<std::size_t> slotOf(paletteStates.size(), kNoIndex);
    std::unordered_map<std::string, std::size_t> byKey;
    byKey.reserve(64);

    bool const hasPlaceable = palettePlaceable != nullptr && palettePlaceable->size() == paletteStates.size();

    for (auto const rawId : blockPaletteIds) {
        auto const id = static_cast<std::size_t>(rawId);
        if (id >= paletteStates.size()) {
            continue;
        }

        std::size_t slot = slotOf[id];
        if (slot == kNoIndex) {
            auto const parsed = parseStateText(paletteStates[id]);

            std::string key = parsed.name;
            key.push_back('\x1f'); // 分隔符：方块名与变体里都不会出现这个字节
            key.append(parsed.variant);

            auto const it = byKey.find(key);
            if (it != byKey.end()) {
                slot = it->second;
            } else {
                slot = report.items.size();
                byKey.emplace(key, slot);
                report.items.push_back(MaterialCount{parsed.name, parsed.variant, paletteStates[id], 0, true});
            }
            slotOf[id] = slot;
        }

        auto& item = report.items[slot];
        ++item.count;
        ++report.totalBlocks;

        if (hasPlaceable && !(*palettePlaceable)[id]) {
            item.placeable = false;
            ++report.unplaceable;
        }
    }

    for (auto const slot : slotOf) {
        if (slot != kNoIndex) {
            ++report.distinctStates;
        }
    }

    std::sort(report.items.begin(), report.items.end(), [](MaterialCount const& left, MaterialCount const& right) {
        if (left.count != right.count) {
            return left.count > right.count;
        }
        if (left.name != right.name) {
            return left.name < right.name;
        }
        return left.variant < right.variant;
    });

    return report;
}

} // namespace litematicabe::core::report
