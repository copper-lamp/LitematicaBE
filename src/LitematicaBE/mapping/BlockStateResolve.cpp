#include "LitematicaBE/mapping/BlockStateResolve.h"

#include "mc/deps/core/string/HashedString.h"
#include "mc/world/level/block/Block.h"

#include <cctype>
#include <cstdlib>
#include <string>
#include <vector>

namespace litematicabe::mapping {

namespace {

std::string trim(std::string s) {
    while (!s.empty() && std::isspace(static_cast<unsigned char>(s.front()))) {
        s.erase(s.begin());
    }
    while (!s.empty() && std::isspace(static_cast<unsigned char>(s.back()))) {
        s.pop_back();
    }
    return s;
}

std::string unquote(std::string s) {
    if (s.size() >= 2 && (s.front() == '"' || s.front() == '\'') && s.back() == s.front()) {
        return s.substr(1, s.size() - 2);
    }
    return s;
}

// 把 `k=v,k2=v2` 拆成 BlockStatesType。与库的 parseBlockState 同口径。
bool parseStates(std::string_view body, ::Block::BlockStatesType& outStates) {
    std::vector<std::string> parts;
    std::string              current;
    bool                     inQuote   = false;
    char                     quoteChar = 0;

    for (char ch : body) {
        if (inQuote) {
            current += ch;
            if (ch == quoteChar) {
                inQuote = false;
            }
            continue;
        }
        if (ch == '"' || ch == '\'') {
            inQuote   = true;
            quoteChar = ch;
            current += ch;
            continue;
        }
        if (ch == ',') {
            parts.push_back(current);
            current.clear();
            continue;
        }
        current += ch;
    }
    if (!current.empty()) {
        parts.push_back(current);
    }

    for (auto const& raw : parts) {
        auto const part = trim(raw);
        if (part.empty()) {
            continue;
        }
        auto const eq = part.find('=');
        if (eq == std::string::npos) {
            return false;
        }
        auto const key = trim(part.substr(0, eq));
        auto const val = unquote(trim(part.substr(eq + 1)));
        if (key.empty()) {
            return false;
        }

        if (val == "true" || val == "false") {
            outStates.emplace_back(key, val == "true");
            continue;
        }

        char* end      = nullptr;
        long  intValue = std::strtol(val.c_str(), &end, 10);
        if (end != nullptr && *end == '\0' && !val.empty()) {
            outStates.emplace_back(key, static_cast<int>(intValue));
            continue;
        }

        double floatValue = std::strtod(val.c_str(), &end);
        if (end != nullptr && *end == '\0' && !val.empty()) {
            outStates.emplace_back(key, static_cast<float>(floatValue));
            continue;
        }

        outStates.emplace_back(key, val);
    }
    return true;
}

} // namespace

BlockStateResolve& BlockStateResolve::getInstance() {
    static BlockStateResolve instance;
    return instance;
}

std::string_view BlockStateResolve::nameOf(std::string_view stateText) noexcept {
    auto const open = stateText.find('[');
    return open == std::string_view::npos ? stateText : stateText.substr(0, open);
}

bool BlockStateResolve::resolve(std::string_view stateText, std::uint32_t& outId) {
    std::string key{stateText};

    if (auto const it = mCache.find(key); it != mCache.end()) {
        ++mStats.hits;
        outId = it->second;
        return true;
    }
    ++mStats.misses;

    auto const name = trim(std::string{nameOf(key)});
    if (name.empty()) {
        ++mStats.failures;
        return false;
    }

    ::Block::BlockStatesType states;
    auto const               open = key.find('[');
    if (open != std::string::npos) {
        auto const close = key.rfind(']');
        if (close == std::string::npos || close <= open) {
            ++mStats.failures;
            return false;
        }
        if (!parseStates(std::string_view{key}.substr(open + 1, close - open - 1), states)) {
            ++mStats.failures;
            return false;
        }
    }

    auto block = ::Block::tryGetFromRegistry(::HashedString{name}, states);
    if (!block) {
        ++mStats.failures;
        return false;
    }

    auto const id = static_cast<std::uint32_t>(block->mNetworkId);
    mCache.emplace(std::move(key), id);
    outId = id;
    return true;
}

void BlockStateResolve::clear() {
    mCache.clear();
}

BlockStateResolve::Stats BlockStateResolve::stats() const {
    auto s   = mStats;
    s.cached = mCache.size();
    return s;
}

} // namespace litematicabe::mapping
