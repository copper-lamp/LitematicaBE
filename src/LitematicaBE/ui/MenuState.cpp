#include "LitematicaBE/ui/MenuState.h"

#include <chrono>

namespace litematicabe::ui {

char const* pageName(Page page) {
    switch (page) {
    case Page::Main:
        return "main";
    case Page::Projects:
        return "projects";
    case Page::ProjectOps:
        return "project-ops";
    case Page::LoadNew:
        return "load-new";
    case Page::Aux:
        return "aux";
    case Page::Save:
        return "save";
    case Page::SaveName:
        return "save-name";
    case Page::SaveAt:
        return "save-at";
    case Page::Display:
        return "display";
    case Page::Layer:
        return "layer";
    case Page::LayerRange:
        return "layer-range";
    case Page::About:
        return "about";
    }
    return "?";
}

MenuState& MenuState::getInstance() {
    static MenuState instance;
    return instance;
}

std::int64_t MenuState::nowMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

PlayerUiState& MenuState::get(std::string const& playerName) {
    std::lock_guard lock(mMutex);
    return mStates[playerName];
}

void MenuState::erase(std::string const& playerName) {
    std::lock_guard lock(mMutex);
    mStates.erase(playerName);
}

std::size_t MenuState::size() const {
    std::lock_guard lock(mMutex);
    return mStates.size();
}

std::size_t MenuState::prune(std::unordered_set<std::string> const& onlineNames) {
    std::lock_guard lock(mMutex);
    std::size_t    removed = 0;
    for (auto it = mStates.begin(); it != mStates.end();) {
        if (onlineNames.contains(it->first)) {
            ++it;
            continue;
        }
        it = mStates.erase(it);
        ++removed;
    }
    return removed;
}

} // namespace litematicabe::ui
