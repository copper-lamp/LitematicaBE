#include "LitematicaBE/command/LitCommand.h"

#include "LitematicaBE/command/ProbeActions.h"
#include "LitematicaBE/command/ReportActions.h"
#include "LitematicaBE/command/SaveActions.h"
#include "LitematicaBE/command/SchematicActions.h"

#include "LitematicaBE/core/save/SaveConfig.h"
#include "LitematicaBE/core/util/TextEncoding.h"
#include "LitematicaBE/easyplace/EasyPlace.h"
#include "LitematicaBE/ghost/ProjectionManager.h"
#include "LitematicaBE/ghost/ShareSwitch.h"
#include "LitematicaBE/ghost/Wireframe.h"
#include "LitematicaBE/hologram/ShapeDrawer.h"
#include "LitematicaBE/printer/Printer.h"

#include "ll/api/command/CommandHandle.h"
#include "ll/api/command/CommandRegistrar.h"

#include "mc/server/commands/CommandOrigin.h"
#include "mc/server/commands/CommandOutput.h"
#include "mc/server/commands/CommandPermissionLevel.h"
#include "mc/world/actor/player/Player.h"

#include <cctype>
#include <exception>
#include <optional>
#include <string>
#include <utility>

namespace litematicabe::command {

// 子命令；枚举成员名就是命令补全里的候选。
enum class LitAction : int {
    probe  = 0,
    info   = 1,
    load   = 2,
    reload = 3,
    list   = 4,
    layer  = 5,
    unload = 6,
    resend = 7,
    rotate = 8,
    projects = 9,
    select   = 10,
    remove   = 11,
    place    = 12,
    diag     = 13,
    box      = 14,
    easyplace = 15,
    printer   = 16,
    share     = 17,
    sel       = 18,
    save      = 19,
    saveat    = 20,
    savediag  = 21,
    saveinfo  = 22,
    material  = 23, //< 当前选中投影的材料清单（导出 xlsx）
};

// `/lit save <kind> <name>` 的格式段用字符串而不是枚举。
struct LitParams {
    LitAction action;
};

struct LitFileParams {
    LitAction   action;
    std::string file;
};

// `/lit load <file> <x> <y> <z>`：控制台也能指定原点铺设。
struct LitLoadAtParams {
    LitAction   action;
    std::string file;
    int         x;
    int         y;
    int         z;
};

// `/lit layer <from> <to>`：显示层区间。
struct LitLayerParams {
    LitAction action;
    int       from;
    int       to;
};

// `/lit layer <from>`：只看单层。
struct LitLayerOneParams {
    LitAction action;
    int       from;
};

// `/lit save <stru|lite|both> <名字>`：选区保存。
struct LitSaveParams {
    LitAction   action;
    std::string kind; //< `stru` / `lite` / `both`（`parseFormat` 解析，含中文别名）
    std::string file;
};

// `/lit saveat <stru|lite|both> <名字> <x1> <y1> <z1> <x2> <y2> <z2>`。
struct LitSaveAtParams {
    LitAction   action;
    std::string kind;
    std::string file;
    int         x1;
    int         y1;
    int         z1;
    int         x2;
    int         y2;
    int         z2;
};

namespace {

namespace util = litematicabe::util;

// 命令行格式段 → 内部格式。解析失败返回 nullopt（调用方报错，不静默兜底）。
std::optional<core::save::Format> formatOf(std::string const& kind) {
    return core::save::parseFormat(kind);
}

::Player* playerOf(::CommandOrigin const& origin) {
    auto* actor = origin.getEntity();
    if (actor == nullptr || !actor->isPlayer()) {
        return nullptr;
    }
    return static_cast<::Player*>(actor);
}

template <class Fn>
void guard(::CommandOutput& output, Fn&& body) noexcept {
    try {
        body();
    } catch (std::exception const& e) {
        output.error("§c内部错误§r：{}", util::sanitizeUtf8(e.what()));
    } catch (...) {
        output.error("§c内部错误§r：未知异常（详情见服务器日志）");
    }
}

// `/lit share <on|off>` 的参数解析（也接受 true/false/1/0/开/关/共享/私有）。
bool parseShareArg(std::string const& raw, bool& out) {
    std::string text;
    text.reserve(raw.size());
    for (char const c : raw) {
        text.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    }
    if (text == "on" || text == "true" || text == "1" || text == "yes" || text == "开" || text == "共享") {
        out = true;
        return true;
    }
    if (text == "off" || text == "false" || text == "0" || text == "no" || text == "关" || text == "私有") {
        out = false;
        return true;
    }
    return false;
}

// 记下开关 + 立即按新可见性重发 / 收回，并把结果返回报告。
void applyShare(::CommandOutput& output, ::Player& player, bool shared) {
    auto const name = player.getRealName();
    ghost::share::setShared(name, shared);
    ghost::ProjectionManager::getInstance().applyShareChange(player, shared);

    if (shared) {
        output.success("§b[投影共享]§r §a开§r：当前投影已向全体玩家分享");
        return;
    }
    output.success("§b[投影共享]§r §e关§r：当前投影仅自己可见");
}

void runWithoutFile(::CommandOutput& output, ::CommandOrigin const& origin, LitAction action) {
    switch (action) {
    case LitAction::probe:
        probe::printProbe(output);
        return;
    case LitAction::info:
    case LitAction::load:
        output.error("该子命令需要文件参数：/lit {} <file>", action == LitAction::info ? "info" : "load");
        return;
    case LitAction::reload:
        schematic::reloadData(output);
        return;
    case LitAction::list:
        schematic::listFiles(output);
        return;
    case LitAction::projects:
        schematic::listProjects(output);
        return;
    case LitAction::diag:
        probe::diagnose(output);
        return;
    case LitAction::easyplace: {
        auto* player = playerOf(origin);
        if (player == nullptr) {
            output.error("该子命令需要以玩家身份执行（开关按玩家记录）");
            return;
        }
        if (!easyplace::installed()) {
            output.error("轻松放置：hook 没有挂载（详情见服务器日志）");
            return;
        }
        auto const name = player->getRealName();
        bool const on   = easyplace::toggle(name);
        if (on) {
            output.success(
                "§b[轻松放置]§r 已开启：在投影格上放错方块会直接落成投影要求的那一个（当前 {} 人在用）",
                easyplace::enabledCount()
            );
            output.success("    §7方块自动纠正并扣除，缺少材料则阻止这次放置§r");
        } else {
            output.success(
                "§b[轻松放置]§r 已关闭（当前 {} 人在用）",
                easyplace::enabledCount()
            );
        }
        return;
    }
    case LitAction::printer: {
        auto* player = playerOf(origin);
        if (player == nullptr) {
            output.error("该子命令需要以玩家身份执行（开关按玩家记录）");
            return;
        }
        if (!printer::installed()) {
            output.error("投影打印机：模块没有初始化（详情见服务器日志）");
            return;
        }
        bool const on = printer::toggle(player->getRealName());
        if (!on) {
            output.success("§b[投影打印机]§r 已关闭（当前 {} 人在用）", printer::enabledCount());
            return;
        }

        auto const& opts  = printer::options();
        auto const  stats = printer::stats();
        output.success("§b[投影打印机]§r 已开启（当前 {} 人在用）", printer::enabledCount());
        output.success(
            "    §7范围：半径 {} 格｜每 {} ms 最多 {} 格｜{}｜{}§r",
            opts.range,
            opts.intervalMs,
            opts.maxPerRound,
            opts.layerLimited ? "只打印 /lit layer 显示的层" : "打印整份投影",
            opts.onlyAir ? "只放空气格" : "空气 + 可替换方块"
        );
        output.success(
            "    §7扣料：{}｜累计已放 {} 格 / 缺料 {} 次 / 失败 {} 次§r",
            opts.creativeFree ? "生存扣 1 格、创造不扣" : "所有模式都扣",
            stats.placed,
            stats.noItem,
            stats.writeFailed
        );
        return;
    }
    case LitAction::share: {
        auto* player = playerOf(origin);
        if (player == nullptr) {
            output.error("该子命令需要以玩家身份执行（开关按玩家记录）");
            return;
        }
        applyShare(output, *player, ghost::share::toggle(player->getRealName()));
        return;
    }
    case LitAction::resend:
        schematic::resendAll(output);
        return;
    case LitAction::sel:
        savetool::showSelection(output, playerOf(origin));
        return;
    case LitAction::saveinfo:
        savetool::printInfo(output);
        return;
    case LitAction::savediag: {
        auto* player = playerOf(origin);
        if (player == nullptr) {
            output.error("savediag 需要以玩家身份执行（默认检查脚下一格）");
            return;
        }
        auto const pos = player->getFeetBlockPos();
        savetool::diagnose(output, player, pos.x, pos.y - 1, pos.z);
        return;
    }
    case LitAction::save:
        output.error("用法：/lit save stru|lite|both [名字]（不给名字时自动命名）");
        return;
    case LitAction::material:
        report::exportMaterials(output);
        return;
    case LitAction::saveat:
        output.error("用法：/lit saveat stru|lite|both <名字> <x1> <y1> <z1> <x2> <y2> <z2>");
        return;
    case LitAction::box: {
        auto& wireframe = ghost::Wireframe::getInstance();
        if (wireframe.enabled()) {
            wireframe.setEnabled(false);
            output.success("包围盒线框：§c关§r（已收回，/lit box 再打开）");
            return;
        }
        wireframe.setEnabled(true);
        auto& drawer = hologram::ShapeDrawer::getInstance();
        if (!drawer.available()) {
            output.error("包围盒线框：§c开§r，但形状通道不可用（{}）", drawer.reason());
            return;
        }
        ghost::ProjectionManager::getInstance().refreshWireframes();
        output.success("包围盒线框：§a开§r（形状通道：{}）", drawer.reason());
        return;
    }
    case LitAction::rotate:
        schematic::rotateProjection(output, playerOf(origin));
        return;
    case LitAction::place: {
        auto* session = ghost::ProjectionManager::getInstance().active();
        if (session == nullptr) {
            output.error("没有活动会话：先 /lit load <file> [x y z]");
            return;
        }
        auto const bounds = session->bounds();
        schematic::placeProjection(output, playerOf(origin), bounds.from, bounds.to);
        return;
    }
    case LitAction::unload: {
        auto* player = playerOf(origin);
        if (player == nullptr) {
            schematic::reportSession(output);
            return;
        }
        schematic::unloadProjection(output, *player);
        return;
    }
    default:
        probe::printState(output);
        return;
    }
}

void runWithFile(
    ::CommandOutput&       output,
    ::CommandOrigin const& origin,
    LitAction              action,
    std::string const&     file
) {
    switch (action) {
    case LitAction::info:
        schematic::printInfo(output, file);
        return;
    case LitAction::load: {
        auto* player = playerOf(origin);
        if (player == nullptr) {
            output.error("控制台执行请指定原点：/lit load {} <x> <y> <z>", file);
            return;
        }
        schematic::loadProjection(output, *player, file);
        return;
    }
    case LitAction::share: {
        auto* player = playerOf(origin);
        if (player == nullptr) {
            output.error("该子命令需要以玩家身份执行（开关按玩家记录）");
            return;
        }
        bool shared = true;
        if (!parseShareArg(file, shared)) {
            output.error("用法：/lit share [on|off]（不带参数是切换；on = 全体可见，off = 只有自己可见）");
            return;
        }
        applyShare(output, *player, shared);
        return;
    }
    case LitAction::sel: {
        if (file == "clear" || file == "清空" || file == "清除") {
            savetool::clearSelection(output, playerOf(origin));
            return;
        }
        output.error("用法：/lit sel [clear]（选点用手持木剑右键方块两次）");
        return;
    }
    case LitAction::save: {
        // `/lit save <stru|lite|both>`（不带名字）：格式词就是参数，名字交给自动命名。
        if (auto const format = core::save::parseFormat(file); format) {
            savetool::saveWithSelection(output, playerOf(origin), {}, *format);
            return;
        }
        output.error("格式必须显式给：/lit save stru|lite|both <名字>（收到的是「{}」）", util::sanitizeUtf8(file));
        return;
    }
    case LitAction::material:
        output.error(
            "材料清单统计的是「当前选中投影」：/lit material（不带参数）。"
            "要统计别的文件先 /lit load <file>，再用 /lit select <id> 选中"
        );
        return;
    case LitAction::saveat:
        output.error(
            "saveat 需要显式格式与坐标：/lit saveat stru|lite|both <名字> <x1> <y1> <z1> <x2> <y2> <z2>"
            "（收到的是「{}」）",
            util::sanitizeUtf8(file)
        );
        return;
    default:
        output.error("该子命令不接受文件参数");
        return;
    }
}

} // namespace

void registerLitCommand() {
    auto& registrar = ll::command::CommandRegistrar::getInstance(false);
    registrar.tryRegisterEnum<LitAction>();

    auto& cmd = registrar.getOrCreateCommand("lit", "LitematicaBE 投影插件", ::CommandPermissionLevel::Any);

    cmd.overload().execute([](::CommandOrigin const& origin, ::CommandOutput& output) {
        (void)origin;
        guard(output, [&] { probe::printState(output); });
    });

    cmd.overload<LitParams>()
        .required("action")
        .execute([](::CommandOrigin const& origin, ::CommandOutput& output, LitParams const& params) {
            guard(output, [&] { runWithoutFile(output, origin, params.action); });
        });

    cmd.overload<LitFileParams>()
        .required("action")
        .required("file")
        .execute([](::CommandOrigin const& origin, ::CommandOutput& output, LitFileParams const& params) {
            guard(output, [&] { runWithFile(output, origin, params.action, params.file); });
        });

    cmd.overload<LitLayerParams>()
        .required("action")
        .required("from")
        .required("to")
        .execute([](::CommandOrigin const& origin, ::CommandOutput& output, LitLayerParams const& params) {
            guard(output, [&] {
                if (params.action == LitAction::place) {
                    schematic::placeProjection(output, playerOf(origin), params.from, params.to);
                    return;
                }
                if (params.action != LitAction::layer) {
                    output.error("只有 layer / place 接受层号参数");
                    return;
                }
                auto* player = playerOf(origin);
                if (player == nullptr) {
                    // 控制台：先把层算好缓存起来，玩家进服后由轮询自动补发。
                    schematic::prepareLayers(output, params.from, params.to);
                    return;
                }
                schematic::switchLayers(output, *player, params.from, params.to);
            });
        });

    cmd.overload<LitLayerOneParams>()
        .required("action")
        .required("from")
        .execute([](::CommandOrigin const& origin, ::CommandOutput& output, LitLayerOneParams const& params) {
            guard(output, [&] {
                if (params.action == LitAction::select) {
                    schematic::selectProjection(output, params.from);
                    return;
                }
                if (params.action == LitAction::remove) {
                    schematic::removeProjection(output, params.from, playerOf(origin));
                    return;
                }
                if (params.action == LitAction::share) {
                    // /lit share 1 → 共享；/lit share 0 → 私有（on/off 的另一半别名）。
                    auto* player = playerOf(origin);
                    if (player == nullptr) {
                        output.error("该子命令需要以玩家身份执行（开关按玩家记录）");
                        return;
                    }
                    applyShare(output, *player, params.from != 0);
                    return;
                }
                if (params.action == LitAction::place) {
                    // /lit place 100 → 只放这一层（与 /lit place 100 100 等价）。
                    schematic::placeProjection(output, playerOf(origin), params.from, params.from);
                    return;
                }
                if (params.action != LitAction::layer) {
                    output.error("该子命令不接受数字参数：/lit {} 用法见 /lit", params.action == LitAction::layer ? "layer" : "?");
                    return;
                }
                auto* player = playerOf(origin);
                if (player == nullptr) {
                    schematic::reportSession(output);
                    return;
                }
                schematic::switchLayers(output, *player, params.from, params.from);
            });
        });

    cmd.overload<LitLoadAtParams>()
        .required("action")
        .required("file")
        .required("x")
        .required("y")
        .required("z")
        .execute([](::CommandOrigin const& origin, ::CommandOutput& output, LitLoadAtParams const& params) {
            (void)origin;
            guard(output, [&] {
                if (params.action != LitAction::load) {
                    output.error("只有 load 支持坐标参数：/lit load <file> <x> <y> <z>");
                    return;
                }
                schematic::loadProjectionAt(output, params.file, params.x, params.y, params.z);
            });
        });

    cmd.overload<LitSaveParams>()
        .required("action")
        .required("kind")
        .required("file")
        .execute([](::CommandOrigin const& origin, ::CommandOutput& output, LitSaveParams const& params) {
            guard(output, [&] {
                if (params.action != LitAction::save) {
                    output.error("只有 save 接受格式参数：/lit save stru|lite|both <名字>");
                    return;
                }
                auto const format = formatOf(params.kind);
                if (!format) {
                    output.error(
                        "不认识的格式「{}」：可用 stru|mcstructure|结构、lite|litematic|投影、both|双",
                        util::sanitizeUtf8(params.kind)
                    );
                    return;
                }
                savetool::saveWithSelection(output, playerOf(origin), params.file, *format);
            });
        });

    cmd.overload<LitSaveAtParams>()
        .required("action")
        .required("kind")
        .required("file")
        .required("x1")
        .required("y1")
        .required("z1")
        .required("x2")
        .required("y2")
        .required("z2")
        .execute([](::CommandOrigin const& origin, ::CommandOutput& output, LitSaveAtParams const& params) {
            guard(output, [&] {
                if (params.action != LitAction::saveat) {
                    output.error("只有 saveat 接受这段坐标参数");
                    return;
                }
                auto const format = formatOf(params.kind);
                if (!format) {
                    output.error(
                        "不认识的格式「{}」：可用 stru|mcstructure|结构、lite|litematic|投影、both|双",
                        util::sanitizeUtf8(params.kind)
                    );
                    return;
                }
                savetool::saveAt(
                    output,
                    playerOf(origin),
                    params.file,
                    *format,
                    params.x1,
                    params.y1,
                    params.z1,
                    params.x2,
                    params.y2,
                    params.z2
                );
            });
        });
}

} // namespace litematicabe::command
