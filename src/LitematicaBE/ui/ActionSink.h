#pragma once

#include <cstddef>
#include <memory>
#include <string>
#include <vector>

class CommandOutput;
class Player;

namespace litematicabe::ui {

// 一条被收集下来的命令回显。
struct SinkLine {
    bool        error{};
    std::string text;
};

// `CommandOutput` 收集层。
class ActionSink {
public:
    explicit ActionSink(::Player* player = nullptr);
    ~ActionSink();

    ActionSink(ActionSink const&)            = delete;
    ActionSink& operator=(ActionSink const&) = delete;

    // 传给动作函数的那个 `CommandOutput`。
    [[nodiscard]] ::CommandOutput& out();

    [[nodiscard]] std::vector<SinkLine> lines() const;

    // 有没有至少一条成功回显。
    [[nodiscard]] bool ok() const;

    [[nodiscard]] bool hasError() const;

    // 第一条错误文本；没有错误返回空串。
    [[nodiscard]] std::string firstError() const;

    // 合并成一段多行文本（保留 `§` 颜色码）。
    // @param maxLines 最多保留几条；超出时最后补一行 `…（还有 N 条）`。
    [[nodiscard]] std::string text(std::size_t maxLines = 6) const;

    // 玩家名（构造时记下，日志用；可能为空）。
    [[nodiscard]] std::string const& playerName() const;

private:
    struct Impl;
    std::unique_ptr<Impl> mImpl;
};

} // namespace litematicabe::ui
