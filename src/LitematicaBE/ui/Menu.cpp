#include "LitematicaBE/ui/Menu.h"

#include "LitematicaBE/ui/ActionSink.h"

#include "LitematicaBE/command/ProbeActions.h"
#include "LitematicaBE/command/ReportActions.h"
#include "LitematicaBE/command/SaveActions.h"
#include "LitematicaBE/command/SchematicActions.h"
#include "LitematicaBE/core/util/TextEncoding.h"
#include "LitematicaBE/easyplace/EasyPlace.h"
#include "LitematicaBE/ghost/ProjectionManager.h"
#include "LitematicaBE/ghost/ProjectionSession.h"
#include "LitematicaBE/ghost/ShareSwitch.h"
#include "LitematicaBE/ghost/Wireframe.h"
#include "LitematicaBE/printer/Printer.h"
#include "LitematicaBE/selection/SelectionStore.h"

#include "ll/api/form/CustomForm.h"
#include "ll/api/form/FormBase.h"
#include "ll/api/form/SimpleForm.h"
#include "ll/api/mod/NativeMod.h"
#include "ll/api/service/Bedrock.h"
#include "ll/api/thread/ServerThreadExecutor.h"

#include "mc/server/commands/CommandOutput.h"
#include "mc/world/actor/player/Player.h"
#include "mc/world/level/Level.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdint>
#include <ctime>
#include <filesystem>
#include <functional>
#include <memory>
#include <string>
#include <unordered_set>
#include <utility>
#include <variant>
#include <vector>

namespace litematicabe::ui {

namespace {

namespace schematic = litematicabe::command::schematic;
namespace report    = litematicabe::command::report;
namespace savetool  = litematicabe::command::savetool;

using ActionFn = std::function<void(::Player&)>;

constexpr char const* kVersion = "4.0.0";

// ───────────────────────────────── 小工具 ─────────────────────────────────

std::string onOff(bool on) { return on ? "§a开§r" : "§c关§r"; }

// 1234567 → "1,234,567"
std::string thousandsOf(std::uint64_t value) {
    std::string const raw = std::to_string(value);
    std::string       out;
    out.reserve(raw.size() + raw.size() / 3);
    int const n = static_cast<int>(raw.size());
    for (int i = 0; i < n; ++i) {
        if (i > 0 && (n - i) % 3 == 0) {
            out += ',';
        }
        out += raw[static_cast<std::size_t>(i)];
    }
    return out;
}

// `std::filesystem::path` → UTF-8 `std::string`（Windows 上 `string()` 是 GBK，直接用会乱码）。
std::string utf8Of(std::filesystem::path const& path) {
    auto const u8 = path.u8string();
    return std::string(reinterpret_cast<char const*>(u8.data()), u8.size());
}

std::string filenameOf(std::string const& file) { return utf8Of(std::filesystem::path(file).filename()); }

// 解析整数；带空白容错，失败返回 false（调用方报错，不静默兜底）。
bool parseInt(std::string const& raw, int& out) {
    std::string text;
    text.reserve(raw.size());
    for (char const c : raw) {
        if (c != ' ' && c != '\t') {
            text.push_back(c);
        }
    }
    if (text.empty()) {
        return false;
    }
    try {
        std::size_t used = 0;
        long long const value = std::stoll(text, &used);
        if (used != text.size()) {
            return false;
        }
        if (value < -30000000LL || value > 30000000LL) { // 世界坐标合法范围
            return false;
        }
        out = static_cast<int>(value);
        return true;
    } catch (...) {
        return false;
    }
}

// 保存的默认名字：选区_1124_2130
std::string defaultSaveName() {
    auto const now = std::chrono::system_clock::now();
    auto const t   = std::chrono::system_clock::to_time_t(now);
    std::tm    tm{};
    localtime_s(&tm, &t);
    char buf[64]{};
    std::snprintf(
        buf,
        sizeof(buf),
        "选区_%02d%02d_%02d%02d",
        tm.tm_mon + 1,
        tm.tm_mday,
        tm.tm_hour,
        tm.tm_min
    );
    return buf;
}

// `schematics/` 下所有可加载的投影文件名（升序）。
std::vector<std::string> projectFiles() {
    std::vector<std::string> files;
    auto const mod = ::ll::mod::NativeMod::current();
    if (!mod) {
        return files;
    }
    auto const      dir = mod->getModDir() / "schematics";
    std::error_code ec;
    if (!std::filesystem::is_directory(dir, ec)) {
        return files;
    }
    for (auto const& entry : std::filesystem::directory_iterator(dir, ec)) {
        if (!entry.is_regular_file(ec)) {
            continue;
        }
        auto const ext = entry.path().extension().string();
        if (ext != ".litematic" && ext != ".mcstructure") {
            continue;
        }
        files.push_back(utf8Of(entry.path().filename()));
    }
    std::sort(files.begin(), files.end());
    return files;
}

// 已经被某个会话加载着的文件名集合。
std::unordered_set<std::string> loadedFileNames() {
    std::unordered_set<std::string> names;
    ghost::ProjectionManager::getInstance().forEachSession([&names](ghost::ProjectionSession& session) {
        names.insert(filenameOf(session.file()));
        return true;
    });
    return names;
}

// 「当前控制投影：XXX」这一行。
std::string activeLine() {
    if (auto* session = ghost::ProjectionManager::getInstance().active()) {
        return "当前控制投影：" + session->label();
    }
    return "当前控制投影：§7无§r";
}

// 某一会话的按钮文字。
std::string sessionButtonText(ghost::ProjectionSession const& session) {
    std::string owner = session.owner();
    if (owner.empty()) {
        owner = "控制台";
    }
    char buf[320]{};
    std::snprintf(
        buf,
        sizeof(buf),
        "#%u  %s\n§8%s 格，归属：%s§r",
        session.id(),
        session.label().c_str(),
        thousandsOf(session.blockCount()).c_str(),
        owner.c_str()
    );
    return buf;
}

// 当前选中会话（可能为空）。
ghost::ProjectionSession* activeSession() { return ghost::ProjectionManager::getInstance().active(); }

// 按名字重新查在线玩家。表单回调里拿到的 `Player&` 不能跨线程持有，只能靠名字重查。
::Player* findPlayer(std::string const& name) {
    auto level = ::ll::service::getLevel();
    if (!level) {
        return nullptr;
    }
    ::Player* found = nullptr;
    level->forEachPlayer([&](::Player& p) {
        if (p.getRealName() == name) {
            found = &p;
            return false;
        }
        return true;
    });
    return found;
}

// 把 CustomForm 的结果投递回主线程再处理。
void runOnServer(
    std::string                                              name,
    ::ll::form::CustomFormResult                             result,
    std::function<void(::Player&, ::ll::form::CustomFormResult const&)> fn
) {
    if (!fn) {
        return;
    }
    ::ll::thread::ServerThreadExecutor::getDefault().execute(
        [name = std::move(name), result = std::move(result), fn = std::move(fn)]() mutable {
            if (auto* target = findPlayer(name)) {
                fn(*target, result);
            }
        }
    );
}

// 确保某个会话是当前选中：unload / material / rotate / place 都只作用于 active。
bool makeActive(::CommandOutput& output, std::uint32_t id) {
    auto& manager = ghost::ProjectionManager::getInstance();
    if (auto* session = manager.active(); session != nullptr && session->id() == id) {
        return true;
    }
    return manager.select(output, id);
}

// ───────────────────────────────── 表单骨架 ─────────────────────────────────

// 未落地的 `MenuForm`：攒内容行 + 攒按钮回调，最后一次性发出去。
struct MenuForm {
    ::ll::form::SimpleForm form;
    std::vector<ActionFn>  actions;
    std::string            content;

    explicit MenuForm(std::string const& title) : form(title) {}

    void line(std::string const& text) {
        if (!content.empty()) {
            content += '\n';
        }
        content += text;
    }

    void blank() { line(""); }

    void button(std::string const& text, ActionFn fn) {
        form.appendButton(text);
        actions.push_back(std::move(fn));
    }
};

void deliver(::Player& player, std::string const& name, Page page, MenuForm& menu);

// 页标题 = 上一级里打开它的那个选项名（主菜单用它自己的名字）。
char const* pageTitle(Page page) {
    switch (page) {
    case Page::Main:
        return "LitematicaBE 控制面板";
    case Page::Projects:
        return "投影管理";
    case Page::ProjectOps:
        return "投影操作";
    case Page::LoadNew:
        return "加载新投影";
    case Page::Aux:
        return "辅助功能";
    case Page::Save:
        return "选区保存";
    case Page::SaveName:
        return "保存设置";
    case Page::SaveAt:
        return "按坐标保存";
    case Page::Display:
        return "外观显示";
    case Page::Layer:
        return "分层显示";
    case Page::LayerRange:
        return "显示特定层";
    case Page::About:
        return "关于投影";
    }
    return "LitematicaBE 控制面板";
}

// 保存方式对应的按钮文案。
std::string saveFormatTitle(core::save::Format format) {
    switch (format) {
    case core::save::Format::Litematic:
        return "保存为 .litematic";
    case core::save::Format::Mcstructure:
        return "保存为 .mcstructure";
    case core::save::Format::Both:
        return "双格式保存";
    }
    return "保存设置";
}

// 执行一个动作、收下它的回显、然后打开指定页。
template <class Fn>
void runAction(::Player& player, std::string const& name, Page after, Fn&& body) {
    ActionSink sink(&player);
    try {
        body(sink.out());
    } catch (std::exception const& e) {
        sink.out().error("§c内部错误§r：{}", util::sanitizeUtf8(e.what()));
    } catch (...) {
        sink.out().error("§c内部错误§r：未知异常（详情见服务器日志）");
    }

    auto& state           = MenuState::getInstance().get(name);
    state.lastResult      = sink.text(6);
    state.lastResultError = sink.hasError();

    showPage(player, after);
}

// 动作反馈：直接接在正文末尾，不额外起「上次结果」区块。
void appendFeedback(MenuForm& menu, PlayerUiState const& state) {
    if (state.lastResult.empty()) {
        return;
    }
    menu.blank();
    menu.line(state.lastResult);
}

// 页尾「返回」。
void appendBack(MenuForm& menu, Page back) {
    menu.blank();
    menu.button("返回", [back](::Player& p) { showPage(p, back); });
}

void appendCancel(MenuForm& menu, Page back) {
    menu.blank();
    menu.button("取消", [back](::Player& p) { showPage(p, back); });
}

// ─────────────────────────────────  主菜单 ─────────────────────────────────

void buildMain(MenuForm& menu) {
    menu.line("LitematicaBE " + std::string(kVersion));
    menu.line("选择一个操作");

    menu.blank();
    menu.button("投影管理", [](::Player& p) { showPage(p, Page::Projects); });
    menu.button("辅助功能", [](::Player& p) { showPage(p, Page::Aux); });
    menu.button("选区保存", [](::Player& p) { showPage(p, Page::Save); });
    menu.button("外观显示", [](::Player& p) { showPage(p, Page::Display); });
    menu.button("关于投影", [](::Player& p) { showPage(p, Page::About); });
}

// ─────────────────────────────────  投影管理 ─────────────────────────────────

void buildProjects(MenuForm& menu, PlayerUiState& state) {
    menu.line(activeLine());
    menu.blank();

    std::vector<std::pair<std::uint32_t, std::string>> entries;
    ghost::ProjectionManager::getInstance().forEachSession([&entries](ghost::ProjectionSession& session) {
        entries.emplace_back(session.id(), sessionButtonText(session));
        return true;
    });

    if (entries.empty()) {
        menu.line("§7当前没有已加载的投影。§r");
    } else {
            for (auto const& [id, text] : entries) {
            menu.button(text, [id](::Player& p) {
                auto& st = MenuState::getInstance().get(p.getRealName());
                st.targetSessionId = id;
                showPage(p, Page::ProjectOps);
            });
        }
    }

    menu.blank();
    menu.button("加载新投影", [](::Player& p) { showPage(p, Page::LoadNew); });
    appendFeedback(menu, state);
    appendBack(menu, Page::Main);
}

void buildProjectOps(MenuForm& menu, std::string const& name, PlayerUiState& state) {
    auto* session = ghost::ProjectionManager::getInstance().find(state.targetSessionId);
    if (session == nullptr) {
        menu.line("§c这份投影已经不存在。§r");
        appendBack(menu, Page::Projects);
        return;
    }

    // 标题已经是「#id 名称」，正文只补统计，不重复。
    menu.line(
        thousandsOf(session->blockCount()) + " 格，归属："
        + (session->owner().empty() ? std::string("控制台") : session->owner())
    );
    menu.blank();

    auto const id = session->id();

    // 卸载：收回客户端上的假方块，会话还在（还能重新加载显示）。
    menu.button("卸载投影", [name, id](::Player& p) {
        runAction(p, name, Page::ProjectOps, [&p, id](::CommandOutput& out) {
            if (!makeActive(out, id)) {
                return;
            }
            schematic::unloadProjection(out, p);
        });
    });

    // 移除：连同会话一起删掉。
    menu.button("移除投影", [name, id](::Player& p) {
        runAction(p, name, Page::Projects, [&p, id](::CommandOutput& out) {
            auto& manager = ghost::ProjectionManager::getInstance();
            manager.remove(out, id, &p);
            auto& st = MenuState::getInstance().get(p.getRealName());
            if (st.targetSessionId == id) {
                st.targetSessionId = 0;
            }
        });
    });

    menu.button("选为当前控制", [name, id](::Player& p) {
        runAction(p, name, Page::ProjectOps, [id](::CommandOutput& out) {
            ghost::ProjectionManager::getInstance().select(out, id);
        });
    });

    menu.button("导出材料统计", [name, id](::Player& p) {
        runAction(p, name, Page::ProjectOps, [id](::CommandOutput& out) {
            if (!makeActive(out, id)) {
                return;
            }
            report::exportMaterials(out);
        });
    });

    menu.button("重新加载", [name, id](::Player& p) {
        runAction(p, name, Page::ProjectOps, [&p, id](::CommandOutput& out) {
            auto* target = ghost::ProjectionManager::getInstance().find(id);
            if (target == nullptr) {
                out.error("这份投影已经不存在");
                return;
            }
            target->sendCachedTo(p);
            out.success("已把 #{} {} 的当前显示层重新推送", target->id(), target->label());
        });
    });

    appendBack(menu, Page::Projects);
}

void buildLoadNew(MenuForm& menu, std::string const& name, PlayerUiState& state) {
    (void)name;
    auto const all    = projectFiles();
    auto const loaded = loadedFileNames();

    std::vector<std::string> pending;
    for (auto const& file : all) {
        if (!loaded.contains(file)) {
            pending.push_back(file);
        }
    }

    if (pending.empty()) {
        menu.line("§7没有可加载的投影文件。§r");
        menu.line("§8把 .litematic 或 .mcstructure 放进插件的 schematics 目录§r");
    } else {
        for (auto const& file : pending) {
            menu.button(file, [file](::Player& p) {
                auto const who = p.getRealName();
                runAction(p, who, Page::Projects, [&p, file](::CommandOutput& out) {
                    schematic::loadProjection(out, p, file);
                });
            });
        }
    }

    appendFeedback(menu, state);
    appendCancel(menu, Page::Projects);
}

// ─────────────────────────────────  辅助功能 ─────────────────────────────────

void buildAux(MenuForm& menu, std::string const& name, PlayerUiState& state) {
    menu.line("轻松放置状态：" + onOff(easyplace::enabledFor(name)));
    menu.line("投影打印机状态：" + onOff(printer::enabledFor(name)));
    menu.line(activeLine());
    menu.blank();

    menu.button("轻松放置", [name](::Player& p) {
        runAction(p, name, Page::Aux, [&p](::CommandOutput& out) {
            if (!easyplace::installed()) {
                out.error("轻松放置：hook 未挂载（详情见服务器日志）");
                return;
            }
            bool const on = easyplace::toggle(p.getRealName());
            if (on) {
                out.success("§b[轻松放置]§r 已开启（当前 {} 人在用）", easyplace::enabledCount());
            } else {
                out.success("§b[轻松放置]§r 已关闭（当前 {} 人在用）", easyplace::enabledCount());
            }
        });
    });

    menu.button("投影打印机", [name](::Player& p) {
        runAction(p, name, Page::Aux, [&p](::CommandOutput& out) {
            if (!printer::installed()) {
                out.error("投影打印机：模块未初始化（详情见服务器日志）");
                return;
            }
            bool const on = printer::toggle(p.getRealName());
            if (!on) {
                out.success("§b[投影打印机]§r 已关闭（当前 {} 人在用）", printer::enabledCount());
                return;
            }
            out.success("§b[投影打印机]§r 已开启（当前 {} 人在用）", printer::enabledCount());
            auto const& opts = printer::options();
            out.success(
                "    §7半径 {} 格｜每 {} ms 最多 {} 格｜{}§r",
                opts.range,
                opts.intervalMs,
                opts.maxPerRound,
                opts.layerLimited ? "只打印显示的层" : "打印整份投影"
            );
        });
    });

    menu.button("直接放置", [name](::Player& p) {
        runAction(p, name, Page::Aux, [&p](::CommandOutput& out) {
            auto* session = ghost::ProjectionManager::getInstance().active();
            if (session == nullptr) {
                out.error("没有活动投影：请前往「投影管理」加载");
                return;
            }
            auto const bounds = session->bounds();
            schematic::placeProjection(out, &p, bounds.from, bounds.to);
        });
    });

    appendFeedback(menu, state);
    appendBack(menu, Page::Main);
}

// ─────────────────────────────────  选区保存 ─────────────────────────────────

void buildSave(MenuForm& menu, std::string const& name, PlayerUiState& state) {
    auto const& store = selection::SelectionStore::getInstance();
    selection::Box selected{};
    if (store.current(name, selected)) {
        menu.line(
            "当前选区：(" + std::to_string(selected.minX) + ", " + std::to_string(selected.minY) + ", "
            + std::to_string(selected.minZ) + ") → (" + std::to_string(selected.maxX) + ", "
            + std::to_string(selected.maxY) + ", " + std::to_string(selected.maxZ) + ")"
        );
        menu.line("§7体积 " + thousandsOf(selected.volume()) + " 格§r");
    } else if (store.pointCount(name) == 1) {
        menu.line("§7已记下第一点，再右键一次完成选区§r");
    } else {
        menu.line("§7当前没有选区（手持木剑右键方块两次选点）§r");
    }
    menu.blank();

    menu.button("保存为 .litematic", [name](::Player& p) {
        MenuState::getInstance().get(name).pendingFormat = core::save::Format::Litematic;
        showPage(p, Page::SaveName);
    });
    menu.button("保存为 .mcstructure", [name](::Player& p) {
        MenuState::getInstance().get(name).pendingFormat = core::save::Format::Mcstructure;
        showPage(p, Page::SaveName);
    });
    menu.button("双格式保存", [name](::Player& p) {
        MenuState::getInstance().get(name).pendingFormat = core::save::Format::Both;
        showPage(p, Page::SaveName);
    });
    menu.button("按坐标保存", [](::Player& p) { showPage(p, Page::SaveAt); });

    menu.button("清空选区", [name](::Player& p) {
        runAction(p, name, Page::Save, [&p](::CommandOutput& out) { savetool::clearSelection(out, &p); });
    });

    appendFeedback(menu, state);
    appendBack(menu, Page::Main);
}

// 「保存设置」三级菜单：填名字 → 保存 / 取消。
void showSaveNameForm(::Player& player, std::string const& name) {
    auto& state = MenuState::getInstance().get(name);
    state.page  = Page::SaveName;

    ::ll::form::CustomForm form(saveFormatTitle(state.pendingFormat));
    form.appendLabel("关闭本表单 = 取消");
    form.appendInput("name", "保存名称", "留空则自动命名", defaultSaveName());
    form.setSubmitButton("保存");

    form.sendTo(
        player,
        [name](::Player&, ::ll::form::CustomFormResult const& result, ::ll::form::FormCancelReason reason) {
            if (reason.has_value() || !result.has_value()) {
                return;
            }
            runOnServer(name, *result, [name](::Player& p, ::ll::form::CustomFormResult const& data) {
                auto& st = MenuState::getInstance().get(name);
                std::string saveName;
                if (auto it = data->find("name"); it != data->end()) {
                    if (auto const* text = std::get_if<std::string>(&it->second)) {
                        saveName = *text;
                    }
                }
                auto const format = st.pendingFormat;
                runAction(p, name, Page::Save, [&p, saveName, format](::CommandOutput& out) {
                    savetool::saveWithSelection(out, &p, saveName, format);
                });
            });
        }
    );
}

void buildSaveAt(MenuForm& menu, std::string const& name, PlayerUiState& state) {
    auto const fmtPos = [](CellPos const& pos) {
        return "(" + std::to_string(pos.x) + ", " + std::to_string(pos.y) + ", " + std::to_string(pos.z) + ")";
    };

    menu.line(
        state.selStartFilled ? "起始点：" + fmtPos(state.selStart) : std::string("起始点：§7未填§r")
    );
    menu.line(state.selEndFilled ? "结束点：" + fmtPos(state.selEnd) : std::string("结束点：§7未填§r"));
    menu.blank();

    menu.button("填写起始点坐标", [name](::Player& p) {
        auto& st = MenuState::getInstance().get(name);
        ::ll::form::CustomForm form("填写起始点坐标");
        form.appendInput("x", "X", "整数", std::to_string(st.selStart.x));
        form.appendInput("y", "Y", "整数", std::to_string(st.selStart.y));
        form.appendInput("z", "Z", "整数", std::to_string(st.selStart.z));
        form.setSubmitButton("确定");
        form.sendTo(
            p,
            [name](::Player&, ::ll::form::CustomFormResult const& result, ::ll::form::FormCancelReason reason) {
                if (reason.has_value() || !result.has_value()) {
                    return;
                }
                runOnServer(name, *result, [name](::Player& pl, ::ll::form::CustomFormResult const& data) {
                    auto& st = MenuState::getInstance().get(name);
                    auto read = [&data](char const* key, int& out) {
                        if (auto it = data->find(key); it != data->end()) {
                            if (auto const* text = std::get_if<std::string>(&it->second)) {
                                return parseInt(*text, out);
                            }
                        }
                        return false;
                    };
                    int x{}, y{}, z{};
                    if (!read("x", x) || !read("y", y) || !read("z", z)) {
                        st.lastResult      = "§c坐标必须是整数§r";
                        st.lastResultError = true;
                        showPage(pl, Page::SaveAt);
                        return;
                    }
                    st.selStart       = CellPos{x, y, z};
                    st.selStartFilled = true;
                    showPage(pl, Page::SaveAt);
                });
            }
        );
    });

    menu.button("填写结束点坐标", [name](::Player& p) {
        auto& st = MenuState::getInstance().get(name);
        ::ll::form::CustomForm form("填写结束点坐标");
        form.appendInput("x", "X", "整数", std::to_string(st.selEnd.x));
        form.appendInput("y", "Y", "整数", std::to_string(st.selEnd.y));
        form.appendInput("z", "Z", "整数", std::to_string(st.selEnd.z));
        form.setSubmitButton("确定");
        form.sendTo(
            p,
            [name](::Player&, ::ll::form::CustomFormResult const& result, ::ll::form::FormCancelReason reason) {
                if (reason.has_value() || !result.has_value()) {
                    return;
                }
                runOnServer(name, *result, [name](::Player& pl, ::ll::form::CustomFormResult const& data) {
                    auto& st = MenuState::getInstance().get(name);
                    auto read = [&data](char const* key, int& out) {
                        if (auto it = data->find(key); it != data->end()) {
                            if (auto const* text = std::get_if<std::string>(&it->second)) {
                                return parseInt(*text, out);
                            }
                        }
                        return false;
                    };
                    int x{}, y{}, z{};
                    if (!read("x", x) || !read("y", y) || !read("z", z)) {
                        st.lastResult      = "§c坐标必须是整数§r";
                        st.lastResultError = true;
                        showPage(pl, Page::SaveAt);
                        return;
                    }
                    st.selEnd       = CellPos{x, y, z};
                    st.selEndFilled = true;
                    showPage(pl, Page::SaveAt);
                });
            }
        );
    });

    auto saveWith = [name](::Player& p, core::save::Format format) {
        auto& st       = MenuState::getInstance().get(name);
        auto const a   = st.selStart;
        auto const b   = st.selEnd;
        auto const haveA = st.selStartFilled;
        auto const haveB = st.selEndFilled;
        runAction(p, name, Page::SaveAt, [&p, a, b, haveA, haveB, format](::CommandOutput& out) {
            if (!haveA || !haveB) {
                out.error("请先设置起始点和结束点坐标");
                return;
            }
            savetool::saveAt(out, &p, {}, format, a.x, a.y, a.z, b.x, b.y, b.z);
        });
    };

    menu.button("保存为 .litematic", [saveWith](::Player& p) { saveWith(p, core::save::Format::Litematic); });
    menu.button("保存为 .mcstructure", [saveWith](::Player& p) { saveWith(p, core::save::Format::Mcstructure); });

    appendFeedback(menu, state);
    appendCancel(menu, Page::Save);
}

// ─────────────────────────────────  外观显示 ─────────────────────────────────

void buildDisplay(MenuForm& menu, std::string const& name, PlayerUiState& state) {
    menu.line("投影分享：" + onOff(ghost::share::sharedFor(name)));
    menu.line("包围盒显示：" + onOff(ghost::Wireframe::getInstance().enabled()));
    menu.line(activeLine());
    menu.blank();

    menu.button("投影分享", [name](::Player& p) {
        runAction(p, name, Page::Display, [&p](::CommandOutput& out) {
            auto const  who    = p.getRealName();
            bool const  shared = ghost::share::toggle(who);
            ghost::ProjectionManager::getInstance().applyShareChange(p, shared);
            if (shared) {
                out.success("§b[投影分享]§r §a开§r：放置的投影将共享给其他玩家");
            } else {
                out.success("§b[投影分享]§r §c关§r：放置的投影仅自己可见");
            }
        });
    });

    menu.button("包围盒显示", [name](::Player& p) {
        runAction(p, name, Page::Display, [](::CommandOutput& out) {
            auto& wireframe = ghost::Wireframe::getInstance();
            if (wireframe.enabled()) {
                wireframe.setEnabled(false);
                out.success("包围盒线框：§c关§r");
                return;
            }
            wireframe.setEnabled(true);
            ghost::ProjectionManager::getInstance().refreshWireframes();
            out.success("包围盒线框：§a开§r");
        });
    });

    menu.button("投影旋转", [name](::Player& p) {
        runAction(p, name, Page::Display, [&p](::CommandOutput& out) { schematic::rotateProjection(out, &p); });
    });

    menu.button("分层显示", [](::Player& p) { showPage(p, Page::Layer); });

    appendFeedback(menu, state);
    appendBack(menu, Page::Main);
}

// ─────────────────────────────────  分层显示 ─────────────────────────────────

void buildLayer(MenuForm& menu, std::string const& name, PlayerUiState& state) {
    auto* session = ghost::ProjectionManager::getInstance().active();
    if (session == nullptr) {
        menu.line("§c没有活动投影：请前往「投影管理」加载。§r");
        appendBack(menu, Page::Display);
        return;
    }

    auto const shown  = session->shown();
    auto const bounds = session->bounds();
    menu.line("当前控制投影：" + session->label());
    menu.line(
        "显示范围：y" + std::to_string(shown.from) + " → y" + std::to_string(shown.to) + "　§8（总范围 y"
        + std::to_string(bounds.from) + " → y" + std::to_string(bounds.to) + "）§r"
    );
    menu.blank();

    // 上一层 / 下一层：以当前显示的起始层为基准，单层移动。
    menu.button("切换上一层", [name, shown, bounds](::Player& p) {
        int const target = shown.from + 1;
        if (target > bounds.to) {
            auto& st           = MenuState::getInstance().get(name);
            st.lastResult      = "已经是最上层（y" + std::to_string(bounds.to) + "）";
            st.lastResultError = false;
            showPage(p, Page::Layer);
            return;
        }
        runAction(p, name, Page::Layer, [&p, target](::CommandOutput& out) {
            schematic::switchLayers(out, p, target, target);
        });
    });

    menu.button("切换下一层", [name, shown, bounds](::Player& p) {
        int const target = shown.from - 1;
        if (target < bounds.from) {
            auto& st           = MenuState::getInstance().get(name);
            st.lastResult      = "已经是最下层（y" + std::to_string(bounds.from) + "）";
            st.lastResultError = false;
            showPage(p, Page::Layer);
            return;
        }
        runAction(p, name, Page::Layer, [&p, target](::CommandOutput& out) {
            schematic::switchLayers(out, p, target, target);
        });
    });

    menu.button("显示全部层", [name, bounds](::Player& p) {
        runAction(p, name, Page::Layer, [&p, bounds](::CommandOutput& out) {
            schematic::switchLayers(out, p, bounds.from, bounds.to);
        });
    });

    menu.button("显示特定层", [](::Player& p) { showPage(p, Page::LayerRange); });

    appendFeedback(menu, state);
    appendBack(menu, Page::Display);
}

// 「显示特定层」：填起始层 / 终点层 → 确认。
void showLayerRangeForm(::Player& player, std::string const& name) {
    {
        auto& st   = MenuState::getInstance().get(name);
        st.page    = Page::LayerRange;
    }
    auto* session = ghost::ProjectionManager::getInstance().active();
    if (session == nullptr) {
        auto& st           = MenuState::getInstance().get(name);
        st.lastResult      = "没有活动投影";
        st.lastResultError = true;
        showPage(player, Page::Layer);
        return;
    }

    auto const shown  = session->shown();
    auto const bounds = session->bounds();

    ::ll::form::CustomForm form("显示特定层");
    form.appendLabel(
        "总范围 y" + std::to_string(bounds.from) + " → y" + std::to_string(bounds.to) + "\n关闭本表单 = 取消"
    );
    form.appendInput("from", "起始层", "整数", std::to_string(shown.from));
    form.appendInput("to", "终点层", "整数", std::to_string(shown.to));
    form.setSubmitButton("确认");

    form.sendTo(
        player,
        [name](::Player&, ::ll::form::CustomFormResult const& result, ::ll::form::FormCancelReason reason) {
            if (reason.has_value() || !result.has_value()) {
                return;
            }
            runOnServer(name, *result, [name](::Player& p, ::ll::form::CustomFormResult const& data) {
                auto& st = MenuState::getInstance().get(name);
                auto read = [&data](char const* key, int& out) {
                    if (auto it = data->find(key); it != data->end()) {
                        if (auto const* text = std::get_if<std::string>(&it->second)) {
                            return parseInt(*text, out);
                        }
                    }
                    return false;
                };
                int from{}, to{};
                if (!read("from", from) || !read("to", to)) {
                    st.lastResult      = "§c层号必须是整数§r";
                    st.lastResultError = true;
                    showPage(p, Page::Layer);
                    return;
                }
                if (from > to) {
                    std::swap(from, to);
                }
                runAction(p, name, Page::Layer, [&p, from, to](::CommandOutput& out) {
                    schematic::switchLayers(out, p, from, to);
                });
            });
        }
    );
}

// ─────────────────────────────────  关于投影 ─────────────────────────────────

void buildAbout(MenuForm& menu) {
    menu.line("LitematicaBE " + std::string(kVersion));
    menu.line("重构正式版");
    menu.line("项目地址：https://github.com/copper-lamp/LitematicaBE");
    menu.line("开发仓库：https://github.com/Shisizhou0706/LitematicaBE");
    menu.line("QQ 群：861900673");
    menu.line("本项目为 AGPL v3.0 开源，欢迎参与贡献");
    menu.line("更多内容正在开发完善中，当前不代表最终品质");
    menu.blank();
    menu.button("返回", [](::Player& p) { showPage(p, Page::Main); });
}

// ───────────────────────────────── 分发 ─────────────────────────────────

void deliver(::Player& player, std::string const& name, Page page, MenuForm& menu) {
    menu.form.setContent(menu.content);

    auto actions = std::make_shared<std::vector<ActionFn>>(std::move(menu.actions));

    auto& state = MenuState::getInstance().get(name);
    state.page  = page;

    auto callback = [name, actions](::Player& p, int index, ::ll::form::FormCancelReason reason) {
        (void)p;
        if (reason.has_value() || index < 0) {
            return;
        }
        if (index >= static_cast<int>(actions->size())) {
            return;
        }

        // 表单回调来自网络线程，而相关状态都只在主线程维护，直接执行会跨线程改共享状态并写坏 MenuState 链表，因此统一投递回主线程并按名字重新查玩家（不能跨线程持有 Player&）。
        auto fn = (*actions)[static_cast<std::size_t>(index)];
        if (!fn) {
            return;
        }
        ::ll::thread::ServerThreadExecutor::getDefault().execute([name, fn] {
            if (auto* target = findPlayer(name)) {
                fn(*target);
            }
        });
    };

    // 一律 sendTo：新表单必须重新打开，`sendUpdate` 只对仍然开着的表单有效
    menu.form.sendTo(player, callback);
}

} // namespace

// ───────────────────────────────── 对外接口 ─────────────────────────────────

void summon(::Player& player) {
    auto const name  = player.getRealName();
    auto&      state = MenuState::getInstance().get(name);
    // 每次唤醒都从主菜单开始，并把上一条反馈清掉。
    state.lastResult.clear();
    state.lastResultError = false;
    showPage(player, Page::Main);
}

void showPage(::Player& player, Page page) {
    auto const name  = player.getRealName();
    auto&      state = MenuState::getInstance().get(name);

    // 标题为上一级里打开本页的选项名。
    // 「投影操作」和「保存设置」是动态的。
    std::string title = pageTitle(page);
    if (page == Page::ProjectOps) {
        if (auto* session = ghost::ProjectionManager::getInstance().find(state.targetSessionId)) {
            title = "#" + std::to_string(session->id()) + " " + session->label();
        }
    } else if (page == Page::SaveName) {
        title = saveFormatTitle(state.pendingFormat);
    }

    MenuForm menu(title);

    switch (page) {
    case Page::Main:
        buildMain(menu);
        break;
    case Page::Projects:
        buildProjects(menu, state);
        break;
    case Page::ProjectOps:
        buildProjectOps(menu, name, state);
        break;
    case Page::LoadNew:
        buildLoadNew(menu, name, state);
        break;
    case Page::Aux:
        buildAux(menu, name, state);
        break;
    case Page::Save:
        buildSave(menu, name, state);
        break;
    case Page::SaveName:
        showSaveNameForm(player, name);
        return;
    case Page::SaveAt:
        buildSaveAt(menu, name, state);
        break;
    case Page::Display:
        buildDisplay(menu, name, state);
        break;
    case Page::Layer:
        buildLayer(menu, name, state);
        break;
    case Page::LayerRange:
        showLayerRangeForm(player, name);
        return;
    case Page::About:
        buildAbout(menu);
        break;
    default:
        buildMain(menu);
        break;
    }

    deliver(player, name, page, menu);
}

void forget(std::string const& playerName) { MenuState::getInstance().erase(playerName); }

} // namespace litematicabe::ui
