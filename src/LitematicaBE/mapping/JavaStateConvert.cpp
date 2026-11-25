#include "LitematicaBE/mapping/JavaStateConvert.h"

#include <array>
#include <cstdlib>
#include <string>
#include <unordered_map>
#include <unordered_set>

namespace litematicabe::mapping {

namespace {

bool endsWith(std::string_view text, std::string_view suffix) {
    return text.size() >= suffix.size() && text.substr(text.size() - suffix.size()) == suffix;
}

bool contains(std::string_view text, std::string_view needle) {
    return text.find(needle) != std::string_view::npos;
}

std::string_view get(StatePairs const& states, std::string_view key) {
    for (auto const& [k, v] : states) {
        if (k == key) {
            return v;
        }
    }
    return {};
}

bool isTrue(std::string_view value) { return value == "true" || value == "1"; }

// 只存在于 Java、Bedrock 注册表里没有的状态键。命中即丢弃。
// 移植自旧项目 `BedrockStateSchema.JAVA_ONLY_KEYS`（真机踩坑清单）。
bool isJavaOnlyKey(std::string_view key) {
    static std::unordered_set<std::string_view> const keys = {
        // 朝向 / 朝向族（各自族里会转成 Bedrock 的对应状态）
        "facing", "face", "axis", "rotation", "orientation",
        // 半砖 / 双高 / 楼梯
        "half", "type", "shape", "stairs_shape", "part",
        // 红石类：Bedrock 一律 *_bit 或无此状态
        "powered", "open", "hinge", "lit", "in_wall", "occupied", "delay", "locked",
        "mode", "power", "extended", "triggered", "has_record", "conditional", "distance",
        // 其他 Java 独有
        "waterlogged", "persistent", "snowy", "bites", "level", "pickles", "eggs",
        "leaves", "tilt", "signal_fire", "unstable", "attached",
        "disarmed", "suspended", "eye", "hatch", "drag",
        // 多向连接位（栅栏 / 墙 / 红石线 / 玻璃板）：Bedrock 按邻居自己算连接，
        // 传这些键只会让整条状态查询失败。
        "east", "west", "north", "south", "up", "down",
    };
    return keys.contains(key);
}

// Java 朝向 → Bedrock `facing_direction`（0=下 1=上 2=北 3=南 4=西 5=东）。
std::string facingDirection(std::string_view value) {
    if (value == "down") {
        return "0";
    }
    if (value == "up") {
        return "1";
    }
    if (value == "north") {
        return "2";
    }
    if (value == "south") {
        return "3";
    }
    if (value == "west") {
        return "4";
    }
    if (value == "east") {
        return "5";
    }
    return {};
}

// 楼梯 `weirdo_direction`：0=东 1=西 2=南 3=北（再加 0x4 = 上下颠倒）。
std::string stairsWeirdo(std::string_view facing) {
    if (facing == "east") {
        return "0";
    }
    if (facing == "west") {
        return "1";
    }
    if (facing == "south") {
        return "2";
    }
    if (facing == "north") {
        return "3";
    }
    return {};
}

// `direction` 整数状态（门/活板门/床/栅栏门共用的那个 BlockState）。
//
// 序是实测出来的：`wooden_door` 上 `cardinal_direction=north` 与 `direction=2`
// 落到同一个 `mSerializationIdHash` → 0=south 1=west 2=north 3=east。
// 注意这**不是**楼梯 `weirdo_direction` 的序（那是 east/west/south/north），
// 也不是旧项目 JS 里那份 door 表（east0/south1/west2/north3，错的）。
std::string cardinalDirectionIndex(std::string_view facing) {
    if (facing == "south") {
        return "0";
    }
    if (facing == "west") {
        return "1";
    }
    if (facing == "north") {
        return "2";
    }
    if (facing == "east") {
        return "3";
    }
    return {};
}

// 箱子/熔炉这一类 `facing_direction`：2=北 3=南 4=西 5=东（不含上下）。
std::string horizontalFacing(std::string_view facing) {
    if (facing == "north") {
        return "2";
    }
    if (facing == "south") {
        return "3";
    }
    if (facing == "west") {
        return "4";
    }
    if (facing == "east") {
        return "5";
    }
    return {};
}

// 把 Java 的布尔位写进 Bedrock 的 `*_bit` 键（bool 值）。
void putBit(StatePairs& out, std::string_view bitKey, std::string_view javaValue) {
    out.emplace_back(std::string{bitKey}, isTrue(javaValue) ? "true" : "false");
}

// Java 铁轨 `shape` → `rail_direction`。
std::string railDirection(std::string_view shape, bool powered) {
    if (shape == "north_south") {
        return "0";
    }
    if (shape == "east_west") {
        return "1";
    }
    if (shape == "ascending_east") {
        return "2";
    }
    if (shape == "ascending_west") {
        return "3";
    }
    if (shape == "ascending_north") {
        return "4";
    }
    if (shape == "ascending_south") {
        return "5";
    }
    if (!powered) {
        if (shape == "south_east") {
            return "6";
        }
        if (shape == "south_west") {
            return "7";
        }
        if (shape == "north_west") {
            return "8";
        }
        if (shape == "north_east") {
            return "9";
        }
    }
    return {};
}

} // namespace

JavaStateResult convertJavaState(std::string_view bareName, StatePairs const& javaStates) {
    JavaStateResult result;
    auto&           out = result.states;

    auto const facing  = get(javaStates, "facing");
    auto const half    = get(javaStates, "half");
    auto const axis    = get(javaStates, "axis");
    auto const type    = get(javaStates, "type");
    auto const powered = get(javaStates, "powered");

    // ---- 楼梯 ----
    if (endsWith(bareName, "_stairs")) {
        result.converted = true;
        result.family    = "stairs";
        auto weirdo      = stairsWeirdo(facing);
        if (!weirdo.empty()) {
            if (half == "top") {
                weirdo = std::to_string(std::stoi(weirdo) | 0x4);
            }
            out.emplace_back("weirdo_direction", weirdo);
            putBit(out, "upside_down_bit", half == "top" ? "true" : "false");
        }
        return result;
    }

    // ---- 台阶（半砖）----
    if (endsWith(bareName, "_slab") || endsWith(bareName, "_double_slab")) {
        result.converted = true;
        result.family    = "slab";
        if (type == "top" || type == "bottom") {
            out.emplace_back("minecraft:vertical_half", std::string{type});
        }
        return result;
    }

    // ---- 活板门 ----
    // 活板门**不吃** `minecraft:cardinal_direction`（实测传 north/east 都落回默认），
    // 只认 `direction` 整数 —— 和门正好相反，别一刀切。
    if (endsWith(bareName, "_trapdoor")) {
        result.converted = true;
        result.family    = "trapdoor";
        if (auto dir = cardinalDirectionIndex(facing); !dir.empty()) {
            out.emplace_back("direction", dir);
        }
        putBit(out, "upside_down_bit", half == "top" ? "true" : "false");
        putBit(out, "open_bit", get(javaStates, "open"));
        return result;
    }

    // ---- 门（含铁门）----
    if (endsWith(bareName, "_door")) {
        result.converted = true;
        result.family    = "door";
        if (!facing.empty()) {
            out.emplace_back("minecraft:cardinal_direction", std::string{facing});
        }
        putBit(out, "upper_block_bit", half == "upper" ? "true" : "false");
        putBit(out, "open_bit", get(javaStates, "open"));
        if (get(javaStates, "hinge") == "right") {
            out.emplace_back("door_hinge_bit", "true");
        }
        return result;
    }

    // ---- 栅栏门 ----
    if (endsWith(bareName, "_fence_gate")) {
        result.converted = true;
        result.family    = "fence_gate";
        if (auto dir = cardinalDirectionIndex(facing); !dir.empty()) {
            out.emplace_back("direction", dir);
        }
        putBit(out, "open_bit", get(javaStates, "open"));
        putBit(out, "in_wall_bit", "false");
        return result;
    }

    // ---- 床 ----
    if (endsWith(bareName, "_bed") || bareName == "bed") {
        result.converted = true;
        result.family    = "bed";
        // 床和活板门一样只认 `direction` 整数（实测 cardinal_direction 无效）。
        if (auto dir = cardinalDirectionIndex(facing); !dir.empty()) {
            out.emplace_back("direction", dir);
        }
        putBit(out, "occupied_bit", get(javaStates, "occupied"));
        putBit(out, "head_piece_bit", get(javaStates, "part") == "head" ? "true" : "false");
        return result;
    }

    // ---- 按钮 ----
    if (endsWith(bareName, "_button")) {
        result.converted = true;
        result.family    = "button";
        if (auto dir = facingDirection(facing); !dir.empty()) {
            out.emplace_back("facing_direction", dir);
        }
        putBit(out, "button_pressed_bit", powered);
        return result;
    }

    // ---- 压力板 ----
    if (endsWith(bareName, "_pressure_plate")) {
        result.converted = true;
        result.family    = "pressure_plate";
        out.emplace_back("redstone_signal", isTrue(powered) ? "15" : "0");
        return result;
    }

    // ---- 活塞 ----
    if (contains(bareName, "piston")) {
        result.converted = true;
        result.family    = "piston";
        if (auto dir = facingDirection(facing); !dir.empty()) {
            out.emplace_back("facing_direction", dir);
        }
        if (endsWith(bareName, "_head") || contains(bareName, "arm_collision")) {
            return result; // 活塞臂没有 extended 状态
        }
        putBit(out, "sticky_bit", contains(bareName, "sticky") ? "true" : "false");
        return result;
    }

    // ---- 观察者：Bedrock 用带命名空间的字符串朝向 ----
    if (bareName == "observer") {
        result.converted = true;
        result.family    = "observer";
        if (!facing.empty()) {
            out.emplace_back("minecraft:facing_direction", std::string{facing});
        }
        putBit(out, "powered_bit", powered);
        return result;
    }

    // ---- 火把（含墙火把/灵魂火把）----
    if (endsWith(bareName, "torch")) {
        result.converted = true;
        result.family    = "torch";
        auto dir         = facing == "up" ? std::string_view{"top"} : facing;
        if (!dir.empty()) {
            out.emplace_back("torch_facing_direction", std::string{dir});
        }
        return result;
    }

    // ---- 箱子 / 熔炉 / 漏斗 / 发射器 / 投掷器 / 熔炉类 ----
    if (endsWith(bareName, "_chest") || endsWith(bareName, "chest") || contains(bareName, "furnace")
        || bareName == "smoker" || bareName == "blast_furnace" || bareName == "hopper"
        || bareName == "dispenser" || bareName == "dropper" || contains(bareName, "campfire")) {
        result.converted = true;
        result.family    = "container";
        if (bareName == "hopper") {
            if (auto dir = facingDirection(facing); !dir.empty()) {
                out.emplace_back("facing_direction", dir);
            }
            putBit(out, "toggle_bit", get(javaStates, "enabled") == "false" ? "false" : "true");
        } else if (auto dir = horizontalFacing(facing); !dir.empty()) {
            out.emplace_back("facing_direction", dir);
        }
        if (contains(bareName, "campfire")) {
            putBit(out, "extinguished", get(javaStates, "lit") == "false" ? "true" : "false");
        }
        return result;
    }

    // ---- 中继器 ----
    if (bareName == "repeater" || bareName == "powered_repeater" || bareName == "unpowered_repeater") {
        result.converted = true;
        result.family    = "repeater";
        if (!facing.empty()) {
            out.emplace_back("minecraft:cardinal_direction", std::string{facing});
        }
        auto const delay = get(javaStates, "delay");
        if (!delay.empty()) {
            out.emplace_back("repeater_delay", std::to_string(std::max(0, std::stoi(std::string{delay}) - 1)));
        }
        return result;
    }

    // ---- 比较器 ----
    if (bareName == "comparator" || contains(bareName, "_comparator")) {
        result.converted = true;
        result.family    = "comparator";
        if (!facing.empty()) {
            out.emplace_back("minecraft:cardinal_direction", std::string{facing});
        }
        putBit(out, "output_subtract_bit", get(javaStates, "mode") == "subtract" ? "true" : "false");
        putBit(out, "output_lit_bit", powered);
        return result;
    }

    // ---- 拉杆 ----
    // 实测：`lever_direction` 是**字符串**枚举（west / down_north_south / up_north_south 都生效，
    // 整数 1 被忽略）。墙挂用四个水平方向；地板/天花板用 down_* / up_* 加轴线。
    if (bareName == "lever") {
        result.converted = true;
        result.family    = "lever";
        auto const face  = get(javaStates, "face");
        bool const sideways = facing == "east" || facing == "west";
        if (face == "wall") {
            if (!facing.empty()) {
                out.emplace_back("lever_direction", std::string{facing});
            }
        } else if (face == "ceiling") {
            out.emplace_back("lever_direction", sideways ? "up_east_west" : "up_north_south");
        } else {
            out.emplace_back("lever_direction", sideways ? "down_east_west" : "down_north_south");
        }
        putBit(out, "open_bit", powered);
        return result;
    }

    // ---- 铁轨 ----
    if (bareName == "rail" || endsWith(bareName, "_rail")) {
        result.converted = true;
        result.family    = "rail";
        auto const shape = get(javaStates, "shape");
        bool const pw    = isTrue(powered);
        if (auto dir = railDirection(shape, pw); !dir.empty()) {
            if (pw) {
                dir = std::to_string(std::stoi(dir) | 0x8);
            }
            out.emplace_back("rail_direction", dir);
        }
        return result;
    }

    // ---- 梯子 / 藤蔓 / 告示牌等依附方块 ----
    if (bareName == "ladder") {
        result.converted = true;
        result.family    = "ladder";
        if (auto dir = facingDirection(facing); !dir.empty()) {
            out.emplace_back("facing_direction", dir);
        }
        return result;
    }

    // ---- 原木 / 柱状方块 ----
    if (!axis.empty()) {
        result.converted = true;
        result.family    = "pillar";
        out.emplace_back("pillar_axis", std::string{axis});
        return result;
    }

    // ---- 兜底：丢掉 Java 独有键，其余原样传（含唯一路径 `rotation` → 牌子朝向）----
    for (auto const& [key, value] : javaStates) {
        if (key == "rotation") {
            out.emplace_back("ground_sign_direction", value);
            result.converted = true;
            result.family    = "sign";
            continue;
        }
        if (isJavaOnlyKey(key)) {
            result.dropped = true;
            continue;
        }
        out.emplace_back(key, value);
    }
    if (result.family.empty()) {
        result.family = "passthrough";
    }
    return result;
}

} // namespace litematicabe::mapping
