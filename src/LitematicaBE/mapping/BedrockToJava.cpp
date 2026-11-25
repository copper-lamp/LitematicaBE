#include "LitematicaBE/mapping/BedrockToJava.h"

#include "LitematicaBE/core/util/TextEncoding.h"

#include "ll/api/mod/NativeMod.h"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <exception>
#include <fstream>
#include <map>
#include <string_view>
#include <system_error>
#include <unordered_map>
#include <unordered_set>

namespace litematicabe::mapping {

namespace {

using Json = nlohmann::json;

constexpr std::size_t kMaxSamples = 6;

std::string stripNamespace(std::string_view name) {
    auto const pos = name.find(':');
    return pos == std::string_view::npos ? std::string{name} : std::string{name.substr(pos + 1)};
}

std::string withNamespace(std::string_view bare) {
    if (bare.find(':') != std::string_view::npos) {
        return std::string{bare};
    }
    return "minecraft:" + std::string{bare};
}

int toInt(std::string const& text) { return static_cast<int>(std::strtol(text.c_str(), nullptr, 10)); }

bool toBool(std::string const& text) { return text == "1" || text == "true" || text == "True"; }

bool endsWith(std::string_view text, std::string_view suffix) {
    return text.size() >= suffix.size() && text.substr(text.size() - suffix.size()) == suffix;
}

bool contains(std::string_view text, std::string_view needle) {
    return text.find(needle) != std::string_view::npos;
}

// 基岩 `facing_direction`(0..5) → Java `facing` 值域。
std::string facingOf(int value) {
    switch (value) {
    case 0:
        return "down";
    case 1:
        return "up";
    case 2:
        return "north";
    case 3:
        return "south";
    case 4:
        return "west";
    case 5:
        return "east";
    default:
        return "north";
    }
}

// 基岩 `direction`(0..3) → Java 水平朝向（门/床/箱子/熔炉/中继器口径）。
std::string horizontalOf(int value) {
    switch (value & 3) {
    case 0:
        return "south";
    case 1:
        return "west";
    case 2:
        return "north";
    default:
        return "east";
    }
}

// 楼梯 `weirdo_direction` 的低两位 → Java `facing`。
std::string stairFacingOf(int value) {
    switch (value & 3) {
    case 0:
        return "east";
    case 1:
        return "west";
    case 2:
        return "south";
    default:
        return "north";
    }
}

// 活塞族 / 按钮的 `facing_direction`：与通用表**同名不同义**（水平四向整体相反）。
//
// 依据（旧项目 `PistonFacing.js` 实测结论）：活塞与按钮在存档里
// `0=down 1=up 2=south 3=north 4=east 5=west`，而发射器/漏斗/熔炉等用通用表
// `2=north 3=south 4=west 5=east`。把两者搞混会让活塞水平朝向整体反 180°。
std::string pistonFacingOf(int value) {
    switch (value) {
    case 0:
        return "down";
    case 1:
        return "up";
    case 2:
        return "south";
    case 3:
        return "north";
    case 4:
        return "east";
    case 5:
        return "west";
    default:
        return "north";
    }
}

bool isNumericText(std::string const& text) {
    return !text.empty() && (std::isdigit(static_cast<unsigned char>(text.front())) || text.front() == '-');
}

// `facing_direction` 的值：数字走枚举表，字符串（观察者这类）原样透传。
std::string facingFromText(std::string const& text, bool pistonFamily) {
    if (!isNumericText(text)) {
        return text;
    }
    return pistonFamily ? pistonFacingOf(toInt(text)) : facingOf(toInt(text));
}

// 拉杆 `lever_direction`(0..7) → Java `face` + `facing`。
void leverOf(int value, std::string& face, std::string& facing) {
    switch (value & 7) {
    case 0:
        face = "floor";
        facing = "south";
        break;
    case 1:
        face = "floor";
        facing = "west";
        break;
    case 2:
        face = "wall";
        facing = "east";
        break;
    case 3:
        face = "wall";
        facing = "west";
        break;
    case 4:
        face = "wall";
        facing = "south";
        break;
    case 5:
        face = "wall";
        facing = "north";
        break;
    case 6:
        face = "ceiling";
        facing = "south";
        break;
    default:
        face = "ceiling";
        facing = "north";
        break;
    }
}

// 铁轨 `rail_direction`(0..9) → Java `shape`。
std::string railShapeOf(int value) {
    static char const* const kShapes[10] = {
        "north_south",
        "east_west",
        "ascending_east",
        "ascending_west",
        "ascending_north",
        "ascending_south",
        "south_east",
        "south_west",
        "north_west",
        "north_east",
    };
    if (value < 0 || value >= 10) {
        return "north_south";
    }
    return kShapes[value];
}

// 基岩专有、Java 侧没有对应属性的状态键：直接丢掉，不要透传成垃圾属性。
bool isBedrockOnlyKey(std::string_view key) {
    static std::unordered_set<std::string> const kKeys = {
        "stone_slab_type",
        "stone_slab_type_2",
        "stone_slab_type_3",
        "stone_slab_type_4",
        "wood_type",
        "old_log_type",
        "new_log_type",
        "old_leaf_type",
        "new_leaf_type",
        "flower_type",
        "double_plant_type",
        "sapling_type",
        "sand_type",
        "dirt_type",
        "stone_type",
        "color",
        "cauldron_liquid",
        "multi_face_direction_bits",
        "block_light_level",
        "composter_fill_level",
        "update_bit",
        "explode_bit",
        "allow_underwater_bit",
        "stripped_bit",
        "deprecated",
        "corr_bits",
        "coral_color",
        "coral_direction",
        "coral_hang_type_bit",
        "dead_bit",
        "vine_direction_bits",
        "wall_connection_type_east",
        "wall_connection_type_north",
        "wall_connection_type_south",
        "wall_connection_type_west",
        "wall_post_bit",
        "brewing_stand_slot_a_bit",
        "brewing_stand_slot_b_bit",
        "brewing_stand_slot_c_bit",
        "end_portal_eye_bit",
        "infiniburn_bit",
        "toggle_bit",
        "covered_bit",
        "occupied_bit",
        "powered_bit",
        "stability_check",
        "book_type",
        "chisel_type",
        "weirdo_direction_legacy",
    };
    return kKeys.find(std::string{key}) != kKeys.end();
}

} // namespace

struct BedrockToJava::Impl {
    std::unordered_map<std::string, std::string> names; //< 基岩裸名 → Java 全名
    std::unordered_map<std::string, std::unordered_map<std::string, std::string>> stateMaps;
};

BedrockToJava& BedrockToJava::getInstance() {
    static BedrockToJava instance;
    return instance;
}

BedrockToJava::BedrockToJava() : mImpl(std::make_unique<Impl>()) {}

BedrockToJava::~BedrockToJava() = default;

void BedrockToJava::clearCache() { mCache.clear(); }

void BedrockToJava::resetStats() { mStats = ConvertStats{}; }

BedrockToJava::TableStats BedrockToJava::table() const {
    TableStats stats;
    stats.names = mImpl->names.size();
    stats.stateMaps = mImpl->stateMaps.size();
    return stats;
}

void BedrockToJava::reportSample(std::string text) {
    if (mStats.samples.size() < kMaxSamples) {
        mStats.samples.push_back(std::move(text));
    }
}

bool BedrockToJava::load(std::filesystem::path const& file) {
    std::error_code ec;
    if (!std::filesystem::exists(file, ec)) {
        mLastError = "没有 export_map.json（只用内置规则）：" + ::litematicabe::util::toUtf8(file);
        return false;
    }

    Json root;
    try {
        std::ifstream in{file};
        in >> root;
    } catch (std::exception const& e) {
        mLastError = std::string{"export_map.json 解析失败："} + e.what();
        return false;
    }

    Impl next;
    try {
        if (auto const it = root.find("blocks"); it != root.end() && it->is_object()) {
            for (auto const& [bedrockName, entry] : it->items()) {
                if (!entry.is_object()) {
                    continue;
                }
                auto const bare = stripNamespace(bedrockName);
                if (auto const java = entry.find("java"); java != entry.end() && java->is_string()) {
                    next.names.emplace(bare, withNamespace(java->get<std::string>()));
                }
                if (auto const states = entry.find("states"); states != entry.end() && states->is_object()) {
                    auto& target = next.stateMaps[bare];
                    for (auto const& [bedrockKey, javaKey] : states->items()) {
                        if (!javaKey.is_string()) {
                            continue;
                        }
                        target.emplace(stripNamespace(bedrockKey), javaKey.get<std::string>());
                    }
                }
            }
        }
    } catch (std::exception const& e) {
        mLastError = std::string{"export_map.json 结构不符："} + e.what();
        return false;
    }

    mImpl->names     = std::move(next.names);
    mImpl->stateMaps = std::move(next.stateMaps);
    mLoaded          = true;
    mLastError.clear();
    clearCache();
    return true;
}

bool BedrockToJava::loadFromModDir() {
    auto nativeMod = ::ll::mod::NativeMod::current();
    if (!nativeMod) {
        mLastError = "拿不到模组目录";
        return false;
    }
    auto const modDir = nativeMod->getModDir();
    for (auto const& candidate : {modDir / "data" / "export_map.json", modDir / "export_map.json"}) {
        std::error_code ec;
        if (std::filesystem::exists(candidate, ec)) {
            return load(candidate);
        }
    }
    mLastError = "没有 export_map.json（只用内置规则）";
    return false;
}

JavaBlock BedrockToJava::convert(std::string const& bedrockName, std::vector<BedrockState> const& states) {
    // 缓存键：名字 + 全部状态（同一份调色板只会真正转换一次）。
    std::string cacheKey = bedrockName;
    for (auto const& state : states) {
        cacheKey += '|';
        cacheKey += state.key;
        cacheKey += '=';
        cacheKey += state.value;
    }
    if (auto const it = mCache.find(cacheKey); it != mCache.end()) {
        return it->second.block;
    }

    auto const bare = stripNamespace(bedrockName);

    JavaBlock block;
    block.name = withNamespace(bare);

    bool renamed = false;
    if (auto const it = mImpl->names.find(bare); it != mImpl->names.end() && !it->second.empty()) {
        block.name = it->second;
        renamed    = stripNamespace(block.name) != bare;
    }

    // 原始状态表：值域不同的族（楼梯/门/按钮）需要组合判断，不能一条一条瞎翻。
    std::unordered_map<std::string, std::string> raw;
    raw.reserve(states.size());
    for (auto const& state : states) {
        raw.emplace(stripNamespace(state.key), state.value);
    }

    std::map<std::string, std::string> props;
    std::unordered_set<std::string>    consumed;

    auto const has = [&raw](std::string_view key) { return raw.find(std::string{key}) != raw.end(); };
    auto const get = [&raw](std::string_view key) -> std::string {
        auto const it = raw.find(std::string{key});
        return it == raw.end() ? std::string{} : it->second;
    };
    auto const put = [&props](std::string key, std::string value) {
        if (!key.empty()) {
            props.emplace(std::move(key), std::move(value));
        }
    };

    // ── 族规则（值域/键名都要翻的） ──
    bool const isStairs   = endsWith(bare, "_stairs") || bare == "stairs";
    bool const isSlab     = endsWith(bare, "_slab") || bare == "double_stone_slab";
    bool const isDoor     = endsWith(bare, "_door") || bare == "wooden_door";
    bool const isTrapdoor = endsWith(bare, "_trapdoor") || bare == "trapdoor";
    bool const isButton   = endsWith(bare, "_button") || bare == "button";
    bool const isLever    = bare == "lever";
    bool const isRail     = endsWith(bare, "_rail") || bare == "rail";
    // 活塞族：本体 / 黏性 / 活塞头 / 活塞臂 / 移动中的活塞壳
    bool const isPiston = contains(bare, "piston");

    if (isStairs || isTrapdoor) {
        if (has("weirdo_direction")) {
            put("facing", stairFacingOf(toInt(get("weirdo_direction"))));
            consumed.insert("weirdo_direction");
        }
        if (has("direction")) {
            put("facing", horizontalOf(toInt(get("direction"))));
            consumed.insert("direction");
        }
        if (has("upside_down_bit")) {
            put("half", toBool(get("upside_down_bit")) ? "top" : "bottom");
            consumed.insert("upside_down_bit");
        } else if (has("weirdo_direction") && (toInt(get("weirdo_direction")) & 4) != 0) {
            put("half", "top");
        }
        if (has("vertical_half")) {
            put("half", get("vertical_half"));
            consumed.insert("vertical_half");
        }
        if (has("open_bit")) {
            put("open", toBool(get("open_bit")) ? "true" : "false");
            consumed.insert("open_bit");
        }
    }

    if (isSlab) {
        if (has("top_slot_bit")) {
            put("type", toBool(get("top_slot_bit")) ? "top" : "bottom");
            consumed.insert("top_slot_bit");
        }
        if (has("vertical_half")) {
            put("type", get("vertical_half"));
            consumed.insert("vertical_half");
        }
    }

    if (isDoor) {
        if (has("direction")) {
            put("facing", horizontalOf(toInt(get("direction"))));
            consumed.insert("direction");
        }
        if (has("open_bit")) {
            put("open", toBool(get("open_bit")) ? "true" : "false");
            consumed.insert("open_bit");
        }
        if (has("upper_block_bit")) {
            put("half", toBool(get("upper_block_bit")) ? "upper" : "lower");
            consumed.insert("upper_block_bit");
        }
        if (has("door_hinge_bit")) {
            put("hinge", toBool(get("door_hinge_bit")) ? "right" : "left");
            consumed.insert("door_hinge_bit");
        }
    }

    if (isButton && has("facing_direction")) {
        // 基岩按钮：0=贴顶、1=贴地、2..5=墙面（墙面四向用按钮自己的枚举，与通用表相反）。
        auto const value = toInt(get("facing_direction"));
        if (value == 1) {
            put("face", "floor");
            put("facing", "north");
        } else if (value == 0) {
            put("face", "ceiling");
            put("facing", "north");
        } else {
            put("face", "wall");
            put("facing", pistonFacingOf(value));
        }
        consumed.insert("facing_direction");
    }

    if (isPiston && !isButton && has("facing_direction")) {
        put("facing", facingFromText(get("facing_direction"), true));
        consumed.insert("facing_direction");
    }

    if (isLever && has("lever_direction")) {
        std::string face;
        std::string facing;
        leverOf(toInt(get("lever_direction")), face, facing);
        put("face", face);
        put("facing", facing);
        consumed.insert("lever_direction");
    }

    if (isRail && has("rail_direction")) {
        put("shape", railShapeOf(toInt(get("rail_direction"))));
        consumed.insert("rail_direction");
    }

    // ── 通用状态 ──
    std::unordered_map<std::string, std::string> const* mapped = nullptr;
    if (auto const it = mImpl->stateMaps.find(bare); it != mImpl->stateMaps.end()) {
        mapped = &it->second;
    }

    for (auto const& state : states) {
        auto const key = stripNamespace(state.key);
        if (consumed.find(key) != consumed.end()) {
            continue;
        }

        // 1) 数据表里给的键名对照
        if (mapped != nullptr) {
            if (auto const it = mapped->find(key); it != mapped->end()) {
                put(it->second, state.value);
                continue;
            }
        }

        // 2) 内置通用规则
        if (key == "facing_direction") {
            put("facing", facingFromText(state.value, isPiston));
            continue;
        }
        if (key == "direction") {
            put("facing", horizontalOf(toInt(state.value)));
            continue;
        }
        if (key == "cardinal_direction" || key == "facing") {
            put("facing", state.value);
            continue;
        }
        if (key == "weirdo_direction") {
            put("facing", stairFacingOf(toInt(state.value)));
            continue;
        }
        if (key == "vertical_half") {
            put("half", state.value);
            continue;
        }
        if (key == "upside_down_bit") {
            put("half", toBool(state.value) ? "top" : "bottom");
            continue;
        }
        if (key == "open_bit") {
            put("open", toBool(state.value) ? "true" : "false");
            continue;
        }
        if (key == "upper_block_bit") {
            put("half", toBool(state.value) ? "upper" : "lower");
            continue;
        }
        if (key == "door_hinge_bit") {
            put("hinge", toBool(state.value) ? "right" : "left");
            continue;
        }
        if (key == "button_pressed_bit" || key == "output_lit_bit") {
            put("powered", toBool(state.value) ? "true" : "false");
            continue;
        }
        if (key == "output_subtract_bit") {
            put("mode", toBool(state.value) ? "subtract" : "compare");
            continue;
        }
        if (key == "repeater_delay") {
            put("delay", std::to_string((toInt(state.value) & 3) + 1));
            continue;
        }
        if (key == "top_slot_bit") {
            put("type", toBool(state.value) ? "top" : "bottom");
            continue;
        }
        if (key == "pillar_axis") {
            put("axis", state.value);
            continue;
        }
        if (key == "liquid_depth") {
            put("level", state.value);
            continue;
        }
        if (key == "redstone_signal") {
            put("power", state.value);
            continue;
        }
        if (key == "torch_facing_direction") {
            if (state.value == "top") {
                // 地面火把在 Java 里没有 facing（墙上的才是 wall_torch + facing），直接丢掉。
            } else if (state.value == "unknown") {
                // 同 Java 的默认 5 向之外的中间态，丢掉。
            } else {
                put("facing", state.value);
            }
            continue;
        }
        if (key == "rail_direction") {
            put("shape", railShapeOf(toInt(state.value)));
            continue;
        }
        if (key == "lever_direction") {
            std::string face;
            std::string facing;
            leverOf(toInt(state.value), face, facing);
            put("face", face);
            put("facing", facing);
            continue;
        }
        if (key == "growth" || key == "age_bit") {
            put("age", state.value);
            continue;
        }
        if (key == "hanging") {
            put("hanging", toBool(state.value) ? "true" : "false");
            continue;
        }

        // 3) 基岩专有键：丢掉（透传过去 Java 会当成未知属性）
        if (isBedrockOnlyKey(key)) {
            ++mStats.droppedKeys;
            continue;
        }

        // 4) 其余同名透传：旧项目就是这么干的，Java 侧多出来的属性会被忽略，
        //    比"整条状态丢掉导致朝向丢失"要好。
        put(key, state.value);
        ++mStats.fallbackValues;
    }

    block.properties.assign(props.begin(), props.end());

    ++mStats.names;
    if (renamed) {
        ++mStats.renamed;
    } else {
        ++mStats.sameName;
    }
    if (mStats.droppedKeys > 0 && mStats.samples.size() < kMaxSamples) {
        reportSample(bedrockName + " → " + block.name + "（丢弃 " + std::to_string(props.size()) + " 项后保留）");
    }

    mCache.emplace(std::move(cacheKey), CacheEntry{block, renamed});
    return block;
}

} // namespace litematicabe::mapping
