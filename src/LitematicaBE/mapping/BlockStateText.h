#pragma once

#include "mc/world/level/block/Block.h"

#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace litematicabe::mapping {

// 一条状态：`("minecraft:cardinal_direction", "north")`。
using StatePair  = std::pair<std::string, std::string>;
using StatePairs = std::vector<StatePair>;

// 状态串的一段：`a:b[c=d,e=f]` → `a:b`。
[[nodiscard]] inline std::string_view stateNameOf(std::string_view stateText) noexcept {
    auto const open = stateText.find('[');
    return open == std::string_view::npos ? stateText : stateText.substr(0, open);
}

// 状态串里的 `c=d,e=f` 部分；没有 `[` 时返回空串。
[[nodiscard]] inline std::string_view stateBodyOf(std::string_view stateText) noexcept {
    auto const open = stateText.find('[');
    if (open == std::string_view::npos) {
        return {};
    }
    auto const close = stateText.rfind(']');
    if (close == std::string_view::npos || close <= open) {
        return {};
    }
    return stateText.substr(open + 1, close - open - 1);
}

inline std::string trimText(std::string s) {
    auto const notSpace = [](unsigned char c) { return c != ' ' && c != '\t' && c != '\r' && c != '\n'; };
    while (!s.empty() && !notSpace(static_cast<unsigned char>(s.front()))) {
        s.erase(s.begin());
    }
    while (!s.empty() && !notSpace(static_cast<unsigned char>(s.back()))) {
        s.pop_back();
    }
    return s;
}

inline std::string unquoteText(std::string s) {
    if (s.size() >= 2 && (s.front() == '"' || s.front() == '\'') && s.back() == s.front()) {
        return s.substr(1, s.size() - 2);
    }
    return s;
}

// 把 `c=d,e=f` 拆成文本对（保留原始字面值，不做类型推断）。引号内的逗号不切分。
inline StatePairs parseStatePairs(std::string_view body) {
    StatePairs parts;
    std::string current;
    bool        inQuote   = false;
    char        quoteChar = 0;

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
            parts.push_back({"", trimText(current)});
            current.clear();
            continue;
        }
        current += ch;
    }
    if (!current.empty()) {
        parts.push_back({"", trimText(current)});
    }

    StatePairs out;
    out.reserve(parts.size());
    for (auto& part : parts) {
        auto const eq = part.second.find('=');
        if (eq == std::string::npos) {
            continue;
        }
        auto key = trimText(part.second.substr(0, eq));
        auto val = unquoteText(trimText(part.second.substr(eq + 1)));
        if (key.empty()) {
            continue;
        }
        out.emplace_back(std::move(key), std::move(val));
    }
    return out;
}

// 文本对 → 注册表要的类型（按 bool → int → float → string 顺序推断，与库同口径）。
inline ::Block::BlockStatesType toBlockStates(StatePairs const& pairs) {
    ::Block::BlockStatesType states;
    states.reserve(pairs.size());
    for (auto const& [key, raw] : pairs) {
        if (raw == "true" || raw == "false") {
            states.emplace_back(key, raw == "true");
            continue;
        }
        char* end      = nullptr;
        long  intValue = std::strtol(raw.c_str(), &end, 10);
        if (end != nullptr && *end == '\0' && !raw.empty()) {
            states.emplace_back(key, static_cast<int>(intValue));
            continue;
        }
        double floatValue = std::strtod(raw.c_str(), &end);
        if (end != nullptr && *end == '\0' && !raw.empty()) {
            states.emplace_back(key, static_cast<float>(floatValue));
            continue;
        }
        states.emplace_back(key, raw);
    }
    return states;
}

// `name[state]`；states 为空时只返回名字。
inline std::string buildStateText(std::string_view name, StatePairs const& states) {
    if (states.empty()) {
        return std::string{name};
    }
    std::string out{name};
    out.push_back('[');
    bool first = true;
    for (auto const& [key, value] : states) {
        if (!first) {
            out.push_back(',');
        }
        first = false;
        out.append(key);
        out.push_back('=');
        out.append(value);
    }
    out.push_back(']');
    return out;
}

} // namespace litematicabe::mapping
