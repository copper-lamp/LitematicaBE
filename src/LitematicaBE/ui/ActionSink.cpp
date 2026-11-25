#include "LitematicaBE/ui/ActionSink.h"

#include "mc/server/commands/CommandOutput.h"
#include "mc/server/commands/CommandOutputMessage.h"
#include "mc/server/commands/CommandOutputMessageType.h"
#include "mc/server/commands/CommandOutputType.h"
#include "mc/world/actor/player/Player.h"

#include <utility>

namespace litematicabe::ui {

struct ActionSink::Impl {
    ::CommandOutput mOutput{::CommandOutputType::AllOutput};
    std::string     mPlayerName;
};

ActionSink::ActionSink(::Player* player) : mImpl(std::make_unique<Impl>()) {
    if (player != nullptr) {
        mImpl->mPlayerName = player->getRealName();
    }
}

ActionSink::~ActionSink() = default;

::CommandOutput& ActionSink::out() { return mImpl->mOutput; }

std::vector<SinkLine> ActionSink::lines() const {
    std::vector<SinkLine> out;
    out.reserve(mImpl->mOutput.mMessages.size());

    for (auto const& message : mImpl->mOutput.mMessages) {
        SinkLine line;
        line.error = message.mType == ::CommandOutputMessageType::Error;
        line.text  = message.mMessageId;

        // 本地化 key + params 的写法在命令里没有用到，但真收到时也要拼出来，
        // 否则面板上会出现一串 key 看不出内容。
        for (auto const& param : message.mParams) {
            line.text += ' ';
            line.text += param;
        }
        if (line.text.empty()) {
            continue;
        }
        out.push_back(std::move(line));
    }
    return out;
}

bool ActionSink::ok() const {
    for (auto const& message : mImpl->mOutput.mMessages) {
        if (message.mType == ::CommandOutputMessageType::Success && !message.mMessageId.empty()) {
            return true;
        }
    }
    return false;
}

bool ActionSink::hasError() const {
    for (auto const& message : mImpl->mOutput.mMessages) {
        if (message.mType == ::CommandOutputMessageType::Error) {
            return true;
        }
    }
    return false;
}

std::string ActionSink::firstError() const {
    for (auto const& message : mImpl->mOutput.mMessages) {
        if (message.mType == ::CommandOutputMessageType::Error) {
            return message.mMessageId;
        }
    }
    return {};
}

std::string ActionSink::text(std::size_t maxLines) const {
    auto const all = lines();
    if (all.empty()) {
        return {};
    }

    std::string out;
    std::size_t kept = 0;
    for (auto const& line : all) {
        if (kept >= maxLines) {
            break;
        }
        if (!out.empty()) {
            out += '\n';
        }
        out += line.text;
        ++kept;
    }
    if (all.size() > kept) {
        out += "\n§7…（还有 " + std::to_string(all.size() - kept) + " 条）§r";
    }
    return out;
}

std::string const& ActionSink::playerName() const { return mImpl->mPlayerName; }

} // namespace litematicabe::ui
