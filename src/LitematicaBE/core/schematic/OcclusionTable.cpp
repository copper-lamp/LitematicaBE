#include "LitematicaBE/core/schematic/OcclusionTable.h"

#include "LitematicaBE/core/util/TextEncoding.h"

#include "ll/api/mod/NativeMod.h"

#include <nlohmann/json.hpp>

#include <filesystem>
#include <fstream>
#include <system_error>

namespace litematicabe::core::schematic {

namespace {

std::string_view shortName(std::string_view name) noexcept {
    auto const colon = name.find(':');
    return colon == std::string_view::npos ? name : name.substr(colon + 1);
}

bool endsWith(std::string_view text, std::string_view suffix) noexcept {
    return text.size() >= suffix.size() && text.compare(text.size() - suffix.size(), suffix.size(), suffix) == 0;
}

} // namespace

OcclusionTable& OcclusionTable::getInstance() {
    static OcclusionTable instance;
    return instance;
}

bool OcclusionTable::load(std::filesystem::path const& file) {
    std::error_code ec;
    if (!std::filesystem::exists(file, ec)) {
        mLastError = "找不到遮挡表：" + ::litematicabe::util::toUtf8(file);
        return false;
    }

    std::ifstream in{file};
    if (!in) {
        mLastError = "无法打开遮挡表：" + ::litematicabe::util::toUtf8(file);
        return false;
    }

    nlohmann::json root;
    try {
        in >> root;
    } catch (std::exception const& e) {
        mLastError = std::string{"遮挡表 JSON 解析失败："} + e.what();
        return false;
    }

    mDefaultOccludes = root.value("defaultOccludes", true);

    mTransparent.clear();
    if (auto const it = root.find("transparent"); it != root.end()) {
        if (it->is_object()) {
            for (auto const& [name, rule] : it->items()) {
                (void)rule;
                mTransparent.insert(name);
            }
        } else if (it->is_array()) {
            for (auto const& name : *it) {
                if (name.is_string()) {
                    mTransparent.insert(name.get<std::string>());
                }
            }
        }
    }

    mSuffixes.clear();
    mContains.clear();
    if (auto const patterns = root.find("patterns"); patterns != root.end() && patterns->is_object()) {
        if (auto const suffixes = patterns->find("suffixes"); suffixes != patterns->end() && suffixes->is_array()) {
            for (auto const& value : *suffixes) {
                if (value.is_string()) {
                    mSuffixes.push_back(value.get<std::string>());
                }
            }
        }
        if (auto const contains = patterns->find("contains"); contains != patterns->end() && contains->is_array()) {
            for (auto const& value : *contains) {
                if (value.is_string()) {
                    mContains.push_back(value.get<std::string>());
                }
            }
        }
    }

    mCache.clear();
    mLoaded    = true;
    mLastError.clear();
    return true;
}

bool OcclusionTable::ensureLoaded() {
    if (mLoaded) {
        return true;
    }
    if (auto nativeMod = ::ll::mod::NativeMod::current()) {
        auto const      dir = nativeMod->getModDir();
        std::error_code ec;
        std::filesystem::path const candidates[] = {dir / "data" / "occlusion.json", dir / "occlusion.json"};
        for (auto const& candidate : candidates) {
            if (std::filesystem::exists(candidate, ec) && load(candidate)) {
                return true;
            }
        }
    }
    if (mLastError.empty()) {
        mLastError = "未找到 occlusion.json";
    }
    return false;
}

bool OcclusionTable::occludes(std::string_view javaName) {
    if (!mLoaded && !ensureLoaded()) {
        // 表缺失时退回「全部遮挡」，只是剔除得保守一点，不会误删可见方块。
        return mDefaultOccludes;
    }

    std::string key{javaName};
    if (auto const it = mCache.find(key); it != mCache.end()) {
        ++mStats.queries;
        return it->second;
    }

    bool result;
    if (mTransparent.find(key) != mTransparent.end()) {
        result = false;
    } else {
        auto const shortForm = shortName(key);
        bool       matched   = false;
        for (auto const& suffix : mSuffixes) {
            if (endsWith(shortForm, suffix)) {
                matched = true;
                break;
            }
        }
        if (!matched) {
            for (auto const& fragment : mContains) {
                if (shortForm.find(fragment) != std::string_view::npos) {
                    matched = true;
                    break;
                }
            }
        }
        result = matched ? false : mDefaultOccludes;
    }

    mCache.emplace(std::move(key), result);
    ++mStats.queries;
    if (result) {
        ++mStats.occluders;
    } else {
        ++mStats.transparent;
    }
    return result;
}

OcclusionTable::Stats OcclusionTable::stats() const {
    auto copy       = mStats;
    copy.cacheSize  = mCache.size();
    return copy;
}

} // namespace litematicabe::core::schematic
