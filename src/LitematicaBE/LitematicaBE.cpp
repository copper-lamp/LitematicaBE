#include "LitematicaBE/LitematicaBE.h"

#include "LitematicaBE/Version.h"
#include "LitematicaBE/core/place/PlaceConfig.h"
#include "LitematicaBE/core/save/SaveConfig.h"
#include "LitematicaBE/core/save/SaveService.h"
#include "LitematicaBE/core/util/TextEncoding.h"
#include "LitematicaBE/command/LitCommand.h"
#include "LitematicaBE/easyplace/EasyPlace.h"
#include "LitematicaBE/hologram/HologramFacade.h"
#include "LitematicaBE/mapping/BedrockToJava.h"
#include "LitematicaBE/mapping/GhostMap.h"
#include "LitematicaBE/printer/Printer.h"
#include "LitematicaBE/selection/SwordTool.h"
#include "LitematicaBE/ui/Menu.h"
#include "LitematicaBE/ui/SwordTrigger.h"
#include "LitematicaBE/ghost/DispatchQueue.h"
#include "LitematicaBE/ghost/BlockHook.h"
#include "LitematicaBE/ghost/ProjectionManager.h"
#include "LitematicaBE/ghost/ProjectionLimits.h"
#include "LitematicaBE/ghost/ShareSwitch.h"
#include "LitematicaBE/web/UploadServer.h"

#include "ll/api/mod/RegisterHelper.h"

#include <filesystem>
#include <stdexcept>
#include <system_error>

namespace litematicabe {

LitematicaBE& LitematicaBE::getInstance() {
    static LitematicaBE instance;
    return instance;
}

bool LitematicaBE::load() {
    auto& self   = getSelf();
    auto& logger = self.getLogger();

    // 日志一律用英文：Windows 控制台默认 GBK 代码页，中文日志会变成乱码。
    // 面向玩家的命令回显仍然用中文（游戏内是 UTF-8，显示正常）。
    logger.info("LitematicaBE {} loading (target baseline: {})", kVersion, kTargetBaseline);

    // 目录准备：数据（解析缓存 / 投影会话）、配置、日志都落在模组目录下，
    // 卸载或重装插件时不会牵连世界存档。
    std::error_code ec;
    std::filesystem::create_directories(self.getDataDir(), ec);
    if (ec) {
        logger.error("failed to create data dir: {} ({})", util::toUtf8(self.getDataDir()), ec.message());
        return false;
    }
    std::filesystem::create_directories(self.getConfigDir(), ec);
    if (ec) {
        logger.error("failed to create config dir: {} ({})", util::toUtf8(self.getConfigDir()), ec.message());
        return false;
    }

    // 投影文件目录：/lit load xxx.litematic 的相对路径就落在这里。
    auto const schematicsDir = self.getModDir() / "schematics";
    std::filesystem::create_directories(schematicsDir, ec);
    if (ec) {
        logger.warn("failed to create schematics dir: {} ({})", util::toUtf8(schematicsDir), ec.message());
    } else {
        logger.info("put .litematic/.mcstructure files here: {}", util::toUtf8(schematicsDir));
    }

    // 尽早挂上 BlockSource 捕获：世界加载时会大量调用 BlockSource 的虚函数，
    // 挂得越早越可能在世界空闲（无玩家）时就拿到一个可用实例。
    if (ghost::installBlockSourceCapture()) {
        logger.info(
            "block source capture armed (waits for world activity; console place still needs a player online)"
        );
    } else {
        logger.warn("block source capture hook FAILED to install");
    }

    logger.info("LitematicaBE loaded");
    return true;
}

bool LitematicaBE::enable() {
    auto& logger = getSelf().getLogger();

    auto& hologram    = hologram::HologramFacade::getInstance();
    auto  displayPath = hologram.probe();
    if (displayPath == hologram::DisplayPath::None) {
        // 显示通道不可用不是致命错误：解析、投影管理、命令仍然可用，
        // 只是无法把假方块推给客户端。
        logger.warn("LitematicaBE enabled, display path UNAVAILABLE: {}", hologram.describe());
    } else {
        logger.info(
            "LitematicaBE enabled, display path {}: {}",
            hologram::toString(displayPath),
            hologram.describe()
        );
    }

    // `/lit place` 的使用门槛（config/place.json）：默认要求创造模式、不要求管理员。
    // 读失败照默认值跑，不影响启动。
    {
        std::string placeError;
        if (!core::place::loadOptions(placeError)) {
            logger.warn("place config NOT loaded ({}): /lit place uses defaults (creative only)", placeError);
        }
    }

    // 「投影是否共享」的玩家级开关：默认全体共享，config/share.json 只记「私有」名单。
    // 读失败不影响启动 —— 按默认（全体共享）继续跑。
    ghost::share::load();

    // 投影的两处方块数上限（config/projection.json）：
    // `maxLoadBlocks` 是 `/lit load` 的收集上限，`maxPlaceBlocks` 是 `/lit place` 的单次写入上限。
    // 读失败照默认值跑（40 万 / 20 万），不影响启动。
    {
        std::string limitsError;
        if (!ghost::limits::loadOptions(limitsError)) {
            logger.warn(
                "projection limits NOT loaded ({}): /lit load uses 400000, /lit place uses 200000",
                limitsError
            );
        }
    }

    command::registerLitCommand();
    logger.info("command /lit registered (probe / info / load / layer / share / sel / save / saveat)");

    // 映射表是投影加载的前提；启动时就加载，失败原因能在日志里直接看到。
    auto& ghostMap = mapping::GhostMap::getInstance();
    if (ghostMap.ensureLoaded()) {
        logger.info("ghost map loaded: {} block entries", ghostMap.stats().blocks);
    } else {
        logger.warn("ghost map NOT loaded ({}): /lit load will fail", ghostMap.lastError());
    }

    // 内置上传页：默认只监听 127.0.0.1，token 在 config/upload.json。
    auto& upload = web::UploadServer::getInstance();
    if (upload.start()) {
        logger.info("upload page: {} (token in config/upload.json)", upload.url());
    } else {
        logger.info("upload page disabled: {}", upload.lastError());
    }

    // 按 tick 预算发包的队列：LevelTickEvent 在服务端并不发布（注册就会抛异常，而且会让后面的初始化整段跳过），load/clear 已经改成同步发送，这里不再启动。
    // 需要限速时再换成不依赖 tick 的驱动方式。

    // 方块变化监听：玩家把投影格挖掉后，把 ghost 补回去。
    // 事件注册失败不能中断 enable（否则插件看起来"启用"但功能全无）。
    try {
        ghost::ProjectionManager::getInstance().start();
        logger.info("projection manager listeners registered");
    } catch (std::exception const& e) {
        logger.error("projection manager listeners FAILED: {}", e.what());
    } catch (...) {
        logger.error("projection manager listeners FAILED: unknown exception");
    }

    // 轻松放置：挂 Player::useItem（拿玩家上下文）+ 给 $setBlock 装前置过滤。
    // 装不上不影响其它功能，只是 /lit easyplace 会报错。
    if (easyplace::install()) {
        logger.info(
            "easyplace armed (hooks: Item::useOn + Player::useItem; filter: BlockSource::$setBlock; per-player /lit "
            "easyplace)"
        );
    } else {
        logger.error("easyplace hook FAILED to install");
    }

    // 投影打印机：不挂 hook，只起一条按 config/printer.json 节拍的定时器；
    // 没人 /lit printer 时整轮空转（一次判断即返回）。
    if (printer::install()) {
        logger.info("printer armed (config/printer.json; per-player /lit printer)");
    } else {
        logger.error("printer FAILED to initialise");
    }

    // 投影保存（/lit save）：配置 + 基岩→Java 反查表 + 木剑选点。
    {
        std::string saveError;
        if (!core::save::loadOptions(saveError)) {
            logger.warn("save config NOT loaded ({}): /lit save uses defaults (mcstructure)", saveError);
        }

        auto& bedrockToJava = mapping::BedrockToJava::getInstance();
        if (bedrockToJava.loadFromModDir()) {
            auto const table = bedrockToJava.table();
            logger.info("export map loaded: {} names / {} state maps", table.names, table.stateMaps);
        } else {
            logger.warn("export map NOT loaded ({}): .litematic export relies on builtin rules", bedrockToJava.lastError());
        }

        if (selection::install()) {
            logger.info("selection armed (wooden sword: right-click block x2; sneak + right-click clears)");
        } else {
            logger.error("selection FAILED to install (easyplace useOn hook missing)");
        }

        // 无人值守自检（环境变量 LITEMATICABE_SELF_TEST）：没有客户端时的唯一验证通道。
        if (core::save::runSelfTestFromEnv()) {
            logger.info("self-test scheduled from LITEMATICABE_SELF_TEST (runs ~10s after enable)");
        }
    }

    // 木剑面板：潜行 + 左键唤出，左键抬头/低头切层。
    // 必须放在 selection::install() 之后 —— 两者共用同一把木剑，但吃的是不同手势
    // （选区占右键，面板占左键），互不拦截。
    if (ui::install()) {
        logger.info("wooden sword menu armed (swing path: {})", ui::activePath());
    } else {
        logger.error("wooden sword menu FAILED to install (no event emitter and swing hook missing)");
    }
    return true;
}

bool LitematicaBE::disable() {
    // 面板先摘：它依赖会话/选区状态，反过来卸载会把过期指针留在表单回调里。
    ui::uninstall();
    // 选区线框是全局形状，先收回再停投影管理器（顺序反了会把线留在客户端）。
    selection::uninstall();
    printer::uninstall();
    try {
        ghost::ProjectionManager::getInstance().stop();
    } catch (...) {
    }
    web::UploadServer::getInstance().stop();
    getSelf().getLogger().info("LitematicaBE disabled");
    return true;
}

} // namespace litematicabe

LL_REGISTER_MOD(litematicabe::LitematicaBE, litematicabe::LitematicaBE::getInstance());
