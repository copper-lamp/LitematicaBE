#pragma once

#include "LitematicaBE/core/save/SaveConfig.h"

#include <cstddef>
#include <cstdint>
#include <mutex>
#include <string>
#include <unordered_map>
#include <unordered_set>

namespace litematicabe::ui {

// 面板页。
//
// 数值会出现在日志与调试输出里，不要随意重排；新增页一律追加。
enum class Page : int {
    Main        = 0,  //< 主菜单
    Projects    = 1,  //< 投影管理（会话列表 + 加载新投影）
    ProjectOps  = 2,  //< 投影操作（对着某一会话）
    LoadNew     = 3,  //< 新的投影（未加载的文件列表）
    Aux         = 4,  //< 辅助功能（轻松放置 / 打印机 / 直接放置）
    Save        = 5,  //< 选区保存（五种保存方式）
    SaveName    = 6,  //< 保存设置（填名字，CustomForm）
    SaveAt      = 7,  //< 坐标选区（两个填坐标入口 + 三种收尾）
    Display     = 8,  //< 外观显示（分享 / 包围盒 / 旋转 / 分层）
    Layer       = 9,  //< 分层显示
    LayerRange  = 10, //< 显示特定层（CustomForm）
    About       = 11, //< 关于投影
};

[[nodiscard]] char const* pageName(Page page);

// 一个方块坐标（面板里填进来的原始值）。
struct CellPos {
    int x{};
    int y{};
    int z{};
};

// 一个玩家在面板里的全部临时状态。
//
// 刻意不持有 `Player&`：表单回调是异步的，玩家可能已经下线；
// 一律存玩家名，用时重新查在线玩家。
struct PlayerUiState {
    // ── 导航 ──
    Page page{Page::Main};

    // ── 冷却（毫秒时间戳，由 MenuState 统一打）──
    std::int64_t lastSummonMs{};

    // ── 跨页参数 ──
    // 「投影操作」页要操作哪一份会话。进入该页时写入，操作完清 0。
    std::uint32_t targetSessionId{};

    // 「保存设置」页选的是哪种格式（lite / stru / both；面板直接调 saveWithSelection，不经过命令）。
    core::save::Format pendingFormat{core::save::Format::Mcstructure};

    // ── 「坐标选区」页已填的坐标 ──
    // 分开记「填了没有」：{0,0,0} 是合法坐标，不能拿它当"没填"。
    CellPos selStart{};
    CellPos selEnd{};
    bool    selStartFilled{};
    bool    selEndFilled{};

    // ── 上次动作结果（渲染在页顶，行动反馈不必再发聊天栏）──
    std::string lastResult;
    bool        lastResultError{};
};

// 按玩家名索引的面板状态表。
//
// **线程约定**：所有访问都必须在服务端主线程（表单回调会被投递到
// `ServerThreadExecutor` 再执行）。即便这样，结构修改仍然加锁 ——
// MSVC 的 `unordered_map` 由「桶数组 + 独立 list 节点」组成，
// 并发插入会把链表指针写坏（实测崩在 `_List_node_emplace_op2`，`RDI` 是垃圾值）。
// 加锁只保护「插入 / 删除」，`get()` 返回的引用在元素被 `erase` 之前始终有效
// （rehash 只换桶数组，不动节点）。
class MenuState {
public:
    static MenuState& getInstance();

    PlayerUiState& get(std::string const& playerName);

    // 玩家下线时清掉（避免长期占内存）。
    void erase(std::string const& playerName);

    // 清掉不在线的玩家，返回被清掉的人数。
    std::size_t prune(std::unordered_set<std::string> const& onlineNames);

    [[nodiscard]] std::size_t size() const;

    // 统一的毫秒时钟（steady_clock），供冷却判定使用。
    static std::int64_t nowMs();

private:
    MenuState() = default;

    mutable std::mutex                             mMutex;
    std::unordered_map<std::string, PlayerUiState> mStates;
};

} // namespace litematicabe::ui
