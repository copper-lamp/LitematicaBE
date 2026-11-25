#include "LitematicaBE/mapping/PlaceResolve.h"

#include "LitematicaBE/mapping/BlockStateText.h"
#include "LitematicaBE/mapping/JavaStateConvert.h"

#include "ll/api/mod/NativeMod.h"

#include "mc/nbt/CompoundTag.h"
#include "mc/world/level/block/Block.h"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>
#include <unordered_set>
#include <vector>

namespace litematicabe::mapping {

namespace {

using json = nlohmann::json;

constexpr char const* kNamespace = "minecraft:";

std::string stripNamespace(std::string_view name) {
    auto const pos = name.find(':');
    return pos == std::string_view::npos ? std::string{name} : std::string{name.substr(pos + 1)};
}

std::string withNamespace(std::string_view bare) {
    if (bare.find(':') != std::string_view::npos) {
        return std::string{bare};
    }
    return std::string{kNamespace} + std::string{bare};
}

bool endsWith(std::string_view text, std::string_view suffix) {
    return text.size() >= suffix.size() && text.substr(text.size() - suffix.size()) == suffix;
}

bool startsWith(std::string_view text, std::string_view prefix) {
    return text.size() >= prefix.size() && text.substr(0, prefix.size()) == prefix;
}

bool boolOf(std::string_view value) { return value == "true" || value == "1"; }

std::string boolText(bool value) { return value ? "true" : "false"; }

char const* const kColors[] = {
    "white", "orange", "magenta", "light_blue", "yellow", "lime",    "pink", "gray",
    "silver", "cyan",  "purple", "blue",       "brown",  "green",   "red",  "black",
    "light_gray", "dark_gray",
};

bool isColor(std::string_view word) {
    for (auto const* color : kColors) {
        if (word == color) {
            return true;
        }
    }
    return false;
}

// `white_bed` → `("white", "bed")`；没有颜色前缀时返回空对。
std::pair<std::string_view, std::string_view> splitColor(std::string_view bare) {
    auto const pos = bare.find('_');
    if (pos == std::string_view::npos) {
        return {};
    }
    auto const head = bare.substr(0, pos);
    if (!isColor(head)) {
        return {};
    }
    return {head, bare.substr(pos + 1)};
}

// Bedrock 的 `facing_direction`：0=下 1=上 2=北 3=南 4=西 5=东。
std::string facingDirectionOf(std::string_view value) {
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

std::string_view bareKey(std::string_view key) {
    auto const pos = key.find(':');
    return pos == std::string_view::npos ? key : key.substr(pos + 1);
}

// Bedrock 里这些状态是 bool（结构文件里存成 Byte 0/1），其余 `0/1` 是普通整数状态
// （比如 `facing_direction: 1` 表示「朝上」，不能当 bool 传）。
bool looksBoolState(std::string_view key) {
    auto const bare = bareKey(key);
    if (bare.size() > 4 && bare.substr(bare.size() - 4) == "_bit") {
        return true;
    }
    static constexpr std::string_view kBoolNames[] = {
        "lit",
        "waterlogged",
        "bloom",
        "can_summon",
        "active",
        "powered",
        "occupied",
        "open",
        "extended",
        "short",
        "triggered",
        "unstable",
        "disarmed",
        "berries",
        "hanging",
        "persistent",
        "infiniburn",
        "update",
        "cracked",
        "stripped",
        "brewing_stand_slot_a",
        "brewing_stand_slot_b",
        "brewing_stand_slot_c",
    };
    for (auto const& name : kBoolNames) {
        if (bare == name) {
            return true;
        }
    }
    return false;
}

using StateVariants = std::vector<StatePairs>;

// 键去命名空间（结构文件里的裸键形态）。
StatePairs keysBare(StatePairs const& in) {
    StatePairs out;
    out.reserve(in.size());
    for (auto const& [key, value] : in) {
        out.emplace_back(std::string{bareKey(key)}, value);
    }
    return out;
}

// 键补 `minecraft:` 前缀（Bedrock 新式方块状态的形态）。
StatePairs keysPrefixed(StatePairs const& in) {
    StatePairs out;
    out.reserve(in.size());
    for (auto const& [key, value] : in) {
        out.emplace_back(std::string{kNamespace} + std::string{bareKey(key)}, value);
    }
    return out;
}

// bool 状态的值 `0/1` → `true/false`。
StatePairs withBoolValues(StatePairs const& in) {
    StatePairs out;
    out.reserve(in.size());
    for (auto const& [key, value] : in) {
        if ((value == "0" || value == "1") && looksBoolState(key)) {
            out.emplace_back(key, value == "1" ? "true" : "false");
        } else {
            out.emplace_back(key, value);
        }
    }
    return out;
}

// 同一份状态在不同方块/不同版本上有不同口径，逐套试到注册表接受为止。
//
// 三步口径统一（缺一个就是「放下去但朝向丢了」）：
// 1. **族转换**：Java 状态先过 `convertJavaState`（楼梯→`weirdo_direction`、
//    活塞→`facing_direction`、中继器→`minecraft:cardinal_direction`…），
//    并丢掉 Java 独有键（`snowy`/`shape`/`type`/`waterlogged`）——
//    留着它们会让方块 NBT 查询整条失败；
// 2. **值的类型**：结构文件里 bool 存成 Byte 0/1，必须转成 true/false，
//    否则按 int 匹配类型不符；
// 3. **键的命名空间**：多数状态键是裸名（`upside_down_bit`），少数带前缀
//    （`minecraft:cardinal_direction`），两种都试一遍。
StateVariants stateVariants(std::string_view bareName, StatePairs const& pairs, bool isBedrock) {
    StateVariants out;
    auto          add = [&](StatePairs states) {
        if (std::find(out.begin(), out.end(), states) == out.end()) {
            out.push_back(std::move(states));
        }
    };

    if (isBedrock) {
        auto bare = keysBare(pairs);
        add(bare);
        add(withBoolValues(bare));
        add(keysPrefixed(bare));
        add(keysPrefixed(withBoolValues(bare)));
        return out;
    }

    auto const converted = convertJavaState(bareName, pairs);
    add(converted.states);
    add(withBoolValues(converted.states));
    add(keysPrefixed(converted.states));
    add(keysPrefixed(withBoolValues(converted.states)));
    return out;
}

} // namespace

struct PlaceResolve::Impl {
    std::unordered_map<std::string, std::string> javaToBedrock;
    std::vector<std::string>                     bedrockNames;
    std::unordered_set<std::string>              bedrockNameSet;
    bool                                         loaded{};
    std::string                                  error;
};

namespace {

std::filesystem::path dataDir() {
    auto mod = ::ll::mod::NativeMod::current();
    if (!mod) {
        return {};
    }
    return mod->getModDir() / "data";
}

bool readJsonFile(std::filesystem::path const& path, json& out, std::string& error) {
    std::ifstream stream(path, std::ios::binary);
    if (!stream) {
        return false;
    }
    std::string text((std::istreambuf_iterator<char>(stream)), std::istreambuf_iterator<char>());
    try {
        out = json::parse(text);
        return true;
    } catch (std::exception const& e) {
        error = path.filename().string() + " 解析失败：" + e.what();
        return false;
    }
}

// 名字候选：越靠前越可信。
std::vector<std::string> buildCandidates(
    std::string const&                                   bare,
    std::unordered_map<std::string, std::string> const&  javaToBedrock,
    std::vector<std::string> const&                      bedrockNames
) {
    std::vector<std::string> out;
    auto                     add = [&](std::string value) {
        if (value.empty()) {
            return;
        }
        if (std::find(out.begin(), out.end(), value) == out.end()) {
            out.push_back(std::move(value));
        }
    };

    add(bare); // 1. 原样（Bedrock 1.21 起已大量与 Java 对齐）

    // 2. 显式映射
    if (auto const it = javaToBedrock.find(bare); it != javaToBedrock.end()) {
        add(it->second);
    }

    // 3. 规则变形
    if (auto const [color, rest] = splitColor(bare); !rest.empty()) {
        if (rest == "bed") {
            add("bed");
        } else if (rest == "banner") {
            add("standing_banner");
        } else if (rest == "wall_banner") {
            add("wall_banner");
        }
    }
    if (startsWith(bare, "potted_")) {
        add("flower_pot");
    }
    if (startsWith(bare, "oak_")) {
        auto const suffix = bare.substr(4);
        if (suffix == "door") {
            add("wooden_door");
        } else if (suffix == "trapdoor") {
            add("trapdoor");
        } else if (suffix == "button") {
            add("wooden_button");
        } else if (suffix == "pressure_plate") {
            add("wooden_pressure_plate");
        } else if (suffix == "sign") {
            add("standing_sign");
        } else if (suffix == "wall_sign") {
            add("wall_sign");
        }
    }
    if (endsWith(bare, "_wall_sign")) {
        add(bare.substr(0, bare.size() - 10) + "_standing_sign");
    } else if (endsWith(bare, "_sign")) {
        add(bare.substr(0, bare.size() - 5) + "_standing_sign");
    }
    if (endsWith(bare, "_wall_banner")) {
        add("wall_banner");
    } else if (endsWith(bare, "_banner")) {
        add("standing_banner");
    }
    if (endsWith(bare, "_bricks")) {
        add(bare.substr(0, bare.size() - 1));
    }
    if (endsWith(bare, "_planks")) {
        add(bare.substr(0, bare.size() - 1));
    }
    if (endsWith(bare, "_block") && bare.size() > 6) {
        add(bare.substr(0, bare.size() - 6));
    } else if (!endsWith(bare, "_block")) {
        add(bare + "_block");
    }
    if (endsWith(bare, "_stairs")) {
        add(bare.substr(0, bare.size() - 1));
    }
    if (endsWith(bare, "_slab")) {
        add(bare + "s");
    }
    if (endsWith(bare, "s") && bare.size() > 3) {
        add(bare.substr(0, bare.size() - 1));
    }

    // 4. 候选池近似：互相包含且长度差 ≤ 8 的取最短
    if (!bedrockNames.empty()) {
        std::string best;
        bool        exact = false;
        for (auto const& candidate : bedrockNames) {
            if (candidate == bare) {
                exact = true;
                break;
            }
            auto const longer  = std::max(candidate.size(), bare.size());
            auto const shorter = std::min(candidate.size(), bare.size());
            if (longer - shorter > 8) {
                continue;
            }
            if (candidate.find(bare) == std::string::npos && bare.find(candidate) == std::string::npos) {
                continue;
            }
            if (best.empty() || candidate.size() < best.size()) {
                best = candidate;
            }
        }
        if (!exact) {
            add(best);
        }
    }

    return out;
}

} // namespace

PlaceResolve::PlaceResolve()
    : mImpl(std::make_unique<Impl>()) {}

PlaceResolve::~PlaceResolve() = default;

PlaceResolve& PlaceResolve::getInstance() {
    static PlaceResolve instance;
    return instance;
}

bool PlaceResolve::ensureLoaded() {
    if (mImpl->loaded) {
        return true;
    }
    mImpl->loaded = true;

    auto const dir = dataDir();
    if (dir.empty()) {
        mImpl->error = "拿不到模组目录（只用内置规则）";
        return false;
    }

    json parsed;
    if (readJsonFile(dir / "java_bedrock.json", parsed, mImpl->error) && parsed.contains("names")
        && parsed["names"].is_object()) {
        for (auto const& [java, bedrock] : parsed["names"].items()) {
            if (bedrock.is_string()) {
                mImpl->javaToBedrock.emplace(java, bedrock.get<std::string>());
            }
        }
    }

    if (readJsonFile(dir / "bedrock_names.json", parsed, mImpl->error) && parsed.contains("names")
        && parsed["names"].is_array()) {
        mImpl->bedrockNames = parsed["names"].get<std::vector<std::string>>();
        mImpl->bedrockNameSet.insert(mImpl->bedrockNames.begin(), mImpl->bedrockNames.end());
    }

    return !mImpl->javaToBedrock.empty() || !mImpl->bedrockNames.empty();
}

std::string const& PlaceResolve::lastError() const { return mImpl->error; }

void PlaceResolve::clear() { mCache.clear(); }

PlaceResolve::Result PlaceResolve::resolve(std::string_view stateText, bool isBedrock) {
    ensureLoaded();

    std::string key{stateText};
    key.push_back(isBedrock ? '\x02' : '\x01');
    if (auto const it = mCache.find(key); it != mCache.end()) {
        return it->second;
    }

    auto const bare  = stripNamespace(stateNameOf(stateText));
    auto const pairs = parseStatePairs(stateBodyOf(stateText));

    Result result;

    auto const candidates = isBedrock ? std::vector<std::string>{bare} : buildCandidates(bare, mImpl->javaToBedrock, mImpl->bedrockNames);
    auto const variants   = stateVariants(bare, pairs, isBedrock);

    // 带状态查方块：**必须走方块 NBT**。
    //
    // `Block::tryGetFromRegistry(name, BlockStatesType)` 这个重载在本服务端上完全不看
    // 状态 —— 活塞传 `facing_direction=1`、`=up`、带不带命名空间，拿回来的
    // `mSerializationIdHash` 全部等于默认值，放下去朝向就丢了。
    // 实测（tools/diag）：改用 `tryGetFromRegistry(CompoundTag)` 且状态键**用裸名 +
    // 强类型**（int 写 int、bool 写 bool），hash 才会真的变。
    auto lookup = [](std::string const& name, StatePairs const& states) -> ::Block const* {
        if (states.empty()) {
            auto const block = ::Block::tryGetFromRegistry(std::string_view{name});
            return block ? block.operator->() : nullptr;
        }

        CompoundTag stateTag;
        for (auto const& [key, value] : states) {
            auto const& bare = key;
            if (value == "true" || value == "false") {
                stateTag[bare] = value == "true"; // CompoundTagVariant 存 bool → ByteTag
                continue;
            }
            char* end      = nullptr;
            long  intValue = std::strtol(value.c_str(), &end, 10);
            if (end != nullptr && *end == '\0' && !value.empty()) {
                stateTag[bare] = static_cast<int>(intValue);
                continue;
            }
            stateTag[bare] = value; // 枚举类状态（cardinal_direction / lever_direction）
        }

        CompoundTag nbt;
        nbt["name"]    = name;
        nbt["states"]  = std::move(stateTag);
        nbt["version"] = 18168865; // BDS 认的方块状态版本号（旧项目实测值）

        auto const block = ::Block::tryGetFromRegistry(nbt);
        return block ? block.operator->() : nullptr;
    };

    // 状态是否真的被注册表采纳。
    // `tryGetFromRegistry` 对不认识的状态**不报错**，而是返回默认状态的方块 —— 这正是
    // 「活塞朝向反了、楼梯上下颠倒」的根因，所以必须逐套变体验证。
    // 判据用 `mSerializationIdHash`（`mNetworkId` 是方块类型级的，同一方块所有状态共用一个值）。
    auto stateApplied = [&](std::string const& name, ::Block const& block, StatePairs const& variant) -> bool {
        // 转换后没有剩下任何状态（比如草方块只剩 Java 的 `snowy`，已被剔除）：
        // 这个方块本来就无状态可传，不算「未生效」。
        if (variant.empty()) {
            return true;
        }
        auto const defaultBlock = ::Block::tryGetFromRegistry(std::string_view{name});
        if (!defaultBlock) {
            return true;
        }
        return defaultBlock.operator->()->mSerializationIdHash != block.mSerializationIdHash;
    };

    ::Block const* fallbackBlock       = nullptr;
    std::string    fallbackSample;
    std::size_t    fallbackNameIndex   = 0;

    for (std::size_t ni = 0; ni < candidates.size() && result.block == nullptr; ++ni) {
        auto const full        = withNamespace(candidates[ni]);
        bool const nameChanged = ni != 0;

        for (std::size_t vi = 0; vi < variants.size(); ++vi) {
            auto const* block = lookup(full, variants[vi]);
            if (block == nullptr) {
                continue;
            }
            if (!stateApplied(full, *block, variants[vi])) {
                // 命中的是默认状态：留作兜底，继续试下一套口径。
                if (fallbackBlock == nullptr) {
                    fallbackBlock     = block;
                    fallbackSample    = buildStateText(full, variants[vi]);
                    fallbackNameIndex = ni;
                }
                continue;
            }
            result.block        = block;
            result.sample       = buildStateText(full, variants[vi]);
            result.stateApplied = true;
            result.precision    = nameChanged ? Precision::Mapped : Precision::Exact;
            break;
        }
        if (result.block != nullptr) {
            break;
        }

        // 这个候选名一条状态都过不了：它本身能查（默认状态）就当兜底。
        if (auto const block = ::Block::tryGetFromRegistry(std::string_view{full}); block) {
            if (fallbackBlock == nullptr) {
                fallbackBlock     = block.operator->();
                fallbackSample    = full;
                fallbackNameIndex = ni;
            }
        }
    }

    // 所有口径都没能让状态生效：用兜底（方块种类对、朝向降级），并在 stateApplied 里标出来。
    if (result.block == nullptr && fallbackBlock != nullptr) {
        result.block        = fallbackBlock;
        result.sample       = fallbackSample;
        result.stateApplied = pairs.empty();
        result.precision    = fallbackNameIndex != 0 ? Precision::Mapped : Precision::Exact;
    }

    if (result.block == nullptr) {
        result.precision = Precision::Failed;
    }

    switch (result.precision) {
    case Precision::Exact:
        ++mStats.exact;
        break;
    case Precision::Mapped:
        ++mStats.mapped;
        break;
    case Precision::Default:
        ++mStats.defaulted;
        break;
    case Precision::Failed:
        ++mStats.failed;
        break;
    }

    mCache.emplace(std::move(key), result);
    return result;
}

std::string PlaceResolve::explain(std::string_view stateText, bool isBedrock) {
    ensureLoaded();
    auto const bare  = stripNamespace(stateNameOf(stateText));
    auto const parts = isBedrock ? std::vector<std::string>{bare} : buildCandidates(bare, mImpl->javaToBedrock, mImpl->bedrockNames);

    std::string out = bare;
    out += " → ";
    for (std::size_t i = 0; i < parts.size(); ++i) {
        if (i != 0) {
            out += " | ";
        }
        out += parts[i];
    }
    return out;
}

PlaceResolve::Stats PlaceResolve::stats() const {
    auto s          = mStats;
    s.cached        = mCache.size();
    s.javaToBedrock = mImpl->javaToBedrock.size();
    s.bedrockNames  = mImpl->bedrockNames.size();
    return s;
}

} // namespace litematicabe::mapping
