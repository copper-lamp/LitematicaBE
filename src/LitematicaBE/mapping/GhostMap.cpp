#include "LitematicaBE/mapping/GhostMap.h"

#include "LitematicaBE/core/util/TextEncoding.h"

#include "ll/api/mod/Mod.h"
#include "ll/api/mod/NativeMod.h"

#include <nlohmann/json.hpp>

#include <filesystem>
#include <fstream>
#include <memory>
#include <system_error>

namespace litematicabe::mapping {

struct GhostMap::Impl {
    nlohmann::json root;
};

namespace {

using json = nlohmann::json;

std::string const* findState(
    std::vector<std::pair<std::string, std::string>> const& states,
    std::string const&                                     name
) {
    // 结构文件里的状态键可能带 minecraft: 也可能不带，比较时统一去掉命名空间。
    auto const bare = [](std::string_view text) {
        auto const pos = text.find(':');
        return pos == std::string_view::npos ? text : text.substr(pos + 1);
    };
    for (auto const& [key, value] : states) {
        if (bare(key) == bare(name)) {
            return &value;
        }
    }
    return nullptr;
}

// 把 `lit:g_x[{a}][{b}]` 里的 `{state}` 换成 Java 状态值。
std::string expandTemplate(
    std::string const&                                     pattern,
    std::vector<std::pair<std::string, std::string>> const& states
) {
    std::string out;
    out.reserve(pattern.size() + 16);

    for (std::size_t i = 0; i < pattern.size(); ++i) {
        if (pattern[i] != '{') {
            out.push_back(pattern[i]);
            continue;
        }
        auto const close = pattern.find('}', i + 1);
        if (close == std::string::npos) {
            out.append(pattern.substr(i));
            break;
        }
        auto const   name  = pattern.substr(i + 1, close - i - 1);
        auto const*  value = findState(states, name);
        if (value != nullptr) {
            out.append(*value);
        }
        i = close;
    }
    return out;
}

void collectSet(
    json const&                                             node,
    std::vector<std::pair<std::string, std::string>> const& states,
    std::vector<std::pair<std::string, std::string>>&       out
) {
    auto it = node.find("set");
    if (it == node.end() || !it->is_object()) {
        return;
    }
    for (auto const& [stateName, spec] : it->items()) {
        if (spec.is_string()) {
            out.emplace_back(stateName, spec.get<std::string>());
            continue;
        }
        if (!spec.is_object()) {
            continue;
        }
        auto const fromIt = spec.find("from");
        auto const mapIt  = spec.find("map");
        if (fromIt == spec.end() || mapIt == spec.end() || !fromIt->is_string() || !mapIt->is_object()) {
            continue;
        }
        auto const* source = findState(states, fromIt->get<std::string>());
        if (source == nullptr) {
            continue;
        }
        auto const mapped = mapIt->find(*source);
        if (mapped == mapIt->end()) {
            continue;
        }
        if (mapped->is_string()) {
            out.emplace_back(stateName, mapped->get<std::string>());
        } else if (mapped->is_number_integer()) {
            out.emplace_back(stateName, std::to_string(mapped->get<long long>()));
        } else if (mapped->is_boolean()) {
            out.emplace_back(stateName, mapped->get<bool>() ? "true" : "false");
        }
    }
}

std::string cacheKey(
    std::string_view                                       javaName,
    std::vector<std::pair<std::string, std::string>> const& states
) {
    std::string key{javaName};
    key.push_back('|');
    for (auto const& [k, v] : states) {
        key.append(k);
        key.push_back('=');
        key.append(v);
        key.push_back(';');
    }
    return key;
}

bool writeStateString(
    std::string const&                              ghost,
    std::vector<std::pair<std::string, std::string>> const& extra,
    std::string&                                    out
) {
    out = ghost;
    if (extra.empty()) {
        return true;
    }
    // ghost 名可能已经带状态（模板展开时不会，但手工规则可能写死）。
    if (out.find('[') == std::string::npos) {
        out.push_back('[');
        for (std::size_t i = 0; i < extra.size(); ++i) {
            if (i != 0) {
                out.push_back(',');
            }
            out.append(extra[i].first);
            out.push_back('=');
            out.append(extra[i].second);
        }
        out.push_back(']');
    }
    return true;
}

} // namespace

GhostMap& GhostMap::getInstance() {
    static GhostMap instance;
    return instance;
}

bool GhostMap::load(std::filesystem::path const& file) {
    std::error_code ec;
    if (!std::filesystem::exists(file, ec)) {
        mLastError = "找不到映射表：" + ::litematicabe::util::toUtf8(file);
        return false;
    }

    std::ifstream in(file, std::ios::binary);
    if (!in) {
        mLastError = "无法打开映射表：" + ::litematicabe::util::toUtf8(file);
        return false;
    }

    auto impl = std::make_unique<Impl>();
    try {
        in >> impl->root;
    } catch (std::exception const& e) {
        mLastError = std::string{"映射表 JSON 解析失败："} + e.what();
        return false;
    }

    if (!impl->root.is_object() || !impl->root.contains("blocks")) {
        mLastError = "映射表缺少 blocks 字段";
        return false;
    }

    mDefaultGhost = impl->root.value("default", "lit:g_generic");
    mImpl         = std::move(impl);
    mLoaded       = true;
    mStats.blocks = mImpl->root["blocks"].size();
    mCache.clear();
    mLastError.clear();
    return true;
}

bool GhostMap::ensureLoaded() {
    if (mLoaded) {
        return true;
    }

    std::vector<std::filesystem::path> candidates;
    if (auto nativeMod = ::ll::mod::NativeMod::current()) {
        auto const dir = nativeMod->getModDir();
        candidates.push_back(dir / "data" / "ghost_map.json");
        candidates.push_back(dir / "ghost_map.json");
    }

    for (auto const& path : candidates) {
        if (load(path)) {
            return true;
        }
    }
    if (mLastError.empty()) {
        mLastError = "未找到 ghost_map.json";
    }
    return false;
}

bool GhostMap::loadFromModDir() {
    mLoaded = false;
    mImpl.reset();
    mCache.clear();
    return ensureLoaded();
}

GhostResolveResult GhostMap::resolve(
    std::string_view                                       javaName,
    std::vector<std::pair<std::string, std::string>> const& states
) {
    if (!mLoaded && !ensureLoaded()) {
        GhostResolveResult fallback;
        fallback.ghost = mDefaultGhost.empty() ? "lit:g_generic" : mDefaultGhost;
        ++mStats.misses;
        return fallback;
    }

    auto key = cacheKey(javaName, states);
    if (auto const it = mCache.find(key); it != mCache.end()) {
        ++mStats.hits;
        return it->second;
    }
    ++mStats.misses;

    GhostResolveResult result;
    result.ghost = mDefaultGhost;

    auto const& blocks = mImpl->root["blocks"];
    auto const  entry  = blocks.find(std::string{javaName});
    if (entry != blocks.end() && entry->is_object()) {
        json const* current = &(*entry);
        for (int depth = 0; depth < 8 && current != nullptr && current->is_object(); ++depth) {
            collectSet(*current, states, result.extraStates);

            auto const ghostIt = current->find("ghost");
            if (ghostIt != current->end() && ghostIt->is_string()) {
                result.ghost   = expandTemplate(ghostIt->get<std::string>(), states);
                result.matched = true;
                break;
            }

            auto const statesIt = current->find("states");
            if (statesIt == current->end() || !statesIt->is_object()) {
                break;
            }

            json const* next = nullptr;
            for (auto const& [stateName, children] : statesIt->items()) {
                if (stateName == "_default") {
                    if (next == nullptr) {
                        next = &children;
                    }
                    continue;
                }
                auto const* value = findState(states, stateName);
                if (value == nullptr || !children.is_object()) {
                    continue;
                }
                if (auto const hit = children.find(*value); hit != children.end()) {
                    next = &(*hit);
                    break;
                }
                if (auto const fallback = children.find("_default"); fallback != children.end()) {
                    next = &(*fallback);
                    break;
                }
            }
            current = next;
        }

        // 树里没给 ghost 时用条目的 default（方块级兜底）。
        if (!result.matched) {
            auto const defaultIt = entry->find("default");
            if (defaultIt != entry->end() && defaultIt->is_string()) {
                result.ghost = expandTemplate(defaultIt->get<std::string>(), states);
            }
        }
    }

    mCache.emplace(std::move(key), result);
    return result;
}

std::string GhostMap::resolveStateString(
    std::string_view                                       javaName,
    std::vector<std::pair<std::string, std::string>> const& states
) {
    auto const resolved = resolve(javaName, states);
    std::string out;
    writeStateString(resolved.ghost, resolved.extraStates, out);
    return out;
}

void GhostMap::clearCache() {
    mCache.clear();
}

GhostMap::Stats GhostMap::stats() const {
    auto s       = mStats;
    s.cacheSize  = mCache.size();
    return s;
}

} // namespace litematicabe::mapping
