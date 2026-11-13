// Litematica BE v3.1.0
// 全服共享投影集成系统

// 测试zlib是否可用
let zlib = null;
let fs = null;
try {
    zlib = require('zlib');
    logger.info("[LitematicaBE] zlib module loaded successfully!");
} catch (e) {
    logger.warn(`[LitematicaBE] zlib not available: ${e.message}`);
}

try {
    fs = require('fs');
    logger.info("[LitematicaBE] fs module loaded successfully!");
} catch (e) {
    logger.warn(`[LitematicaBE] fs not available: ${e.message}`);
}

// 导入核心模块
const { LitematicLoader } = require('./src/core/LitematicLoader');
const { DataManager } = require('./src/data/DataManager');
const { ProjectionRenderer } = require('./src/render/ProjectionRenderer');
const { ProjectionManager } = require('./src/render/ProjectionManager');
const { UIManager } = require('./src/ui/UIManager');
const { LogCleaner } = require('./src/core/LogCleaner');
const { ConfigManager } = require('./src/core/ConfigManager');
const { EasyPlaceManager } = require('./src/easyplace/EasyPlaceManager');
const { SelectionTool } = require('./src/core/SelectionTool');
const { SchematicSaver } = require('./src/core/SchematicSaver');
const { BlockVerifier } = require('./src/easyplace/BlockVerifier');
const { MaterialCounter } = require('./src/utils/MaterialCounter');
// 坐标解析唯一实现（表单 / 命令文本 / `~` 相对坐标）
const { toIntOr, clampCoord, parseXYZText } = require('./src/utils/coordText');

// 导入超大型投影模块
const { MegaSchematicManager } = require('./src/core/MegaSchematicManager');
const { StreamingLitematicLoader } = require('./src/core/StreamingLitematicLoader');
const { MegaProjectionRenderer } = require('./src/render/MegaProjectionRenderer');
const { McstructureLoader } = require('./src/core/McstructureLoader');

// 内置 HTTP 上传站：服务器启动后拉起网页，玩家在浏览器上传结构文件到 schematics/
const { WebUploadServer } = require('./src/web/WebUploadServer');

// 版本更新检查：插件激活/服务端启动后联网问 GitHub Release，只读元数据（不下载、不自动更新）
const { UpdateChecker, formatLogLine } = require('./src/net/UpdateChecker');

// Ghost 子系统
const { GhostBlockRegistry } = require('./src/ghost/GhostBlockRegistry');
const { GhostGuard } = require('./src/ghost/GhostGuard');
const { GhostExpectStore } = require('./src/ghost/GhostExpectStore');
const { AddonVersionCheck } = require('./src/ghost/AddonVersionCheck');
const { GhostSelfCheck } = require('./src/ghost/GhostSelfCheck');
const { GhostRenderer } = require('./src/ghost/GhostRenderer');
const { RenderScheduler } = require('./src/render/RenderScheduler');
const { WorldSnapshot } = require('./src/world/WorldSnapshot');

// 版本号唯一来源。manifest / package.json / tooth.json 由 `npm run check:version` 对齐到同一个字符串，
// 这里再派生出 LSE 注册用的数字三元组。
//
// ⚠ `ll.registerPlugin` 的版本会被 legacy-script-engine 在注册插件时**回写进
// `plugins/LitematicaBE/manifest.json`**（C++ 文本模式写，LF 会变 CRLF），写成 `x.y.z`
// （丢掉 `-prerelease` 后缀）。历史坑：这里写死过旧版本三元组（3.0.0），于是每次启动清单都被刷回
// 3.0.0，与 PLUGIN_VERSION（3.0.3-test.6）对不上，排查"版本号自己变了"时被误判成清单被改。
// **永远从 PLUGIN_VERSION 派生，不要写死数字数组**（check-version 会拦）。
const PLUGIN_VERSION = '3.1.0';
// 先切掉 `-prerelease`，再取前三段数字：`3.1.0` → [3, 1, 0]
const PLUGIN_VERSION_TUPLE = PLUGIN_VERSION.split('-')[0]
    .split('.')
    .slice(0, 3)
    .map((n) => parseInt(n, 10) || 0);
const PLUGIN_VERSION_CORE = PLUGIN_VERSION_TUPLE.join('.');

ll.registerPlugin(
    "LitematicaBE",
    "Minecraft Bedrock Edition projection tool with shared projections",
    PLUGIN_VERSION_TUPLE,
    {}
);

// 配置管理器（最先初始化，供其他模块使用）
const configManager = new ConfigManager();
const SCHEMATIC_PATH = './plugins/LitematicaBE/schematics/';

// 全局实例
const loader = new LitematicLoader();
const dataManager = new DataManager();
const renderer = new ProjectionRenderer();
const projManager = new ProjectionManager();
const uiManager = new UIManager();
const logCleaner = new LogCleaner();

// 超大型投影全局实例（必须在 EasyPlaceManager 之前初始化）
const megaManager = new MegaSchematicManager();
const streamLoader = new StreamingLitematicLoader();
const megaRenderer = new MegaProjectionRenderer(megaManager);

// .mcstructure（Bedrock 结构文件）加载器：独立小端 NBT 解析，方块已是 BE 名/状态
const mcstructureLoader = new McstructureLoader();

const easyPlaceManager = new EasyPlaceManager(projManager, dataManager, megaManager);

// 选区工具和保存器实例
const selectionTool = new SelectionTool();
const schematicSaver = new SchematicSaver();

// HTTP 上传站实例（构造不碰网络；真正 listen 在 onServerStarted，那时工作目录与端口才可靠）
const webServer = new WebUploadServer({ logger, configManager });

// 版本更新检查实例（构造不碰网络：只在服务端启动、插件被激活时查一次并打一行日志）。
// 开关在 config 的 updateCheck.enabled —— false 时完全不联网。
const updateChecker = new UpdateChecker({
    currentVersion: PLUGIN_VERSION,
    getConfig: (key, def) => configManager.get(key, def),
});

// 验证器和材料统计器实例
const blockVerifier = new BlockVerifier();
const materialCounter = new MaterialCounter();

// Ghost 子系统
// 期望集合：记录 ghost ，是玩家盖方块再破坏后能自动补回的唯一依据
// 默认落在 plugins/LitematicaBE/data/ghost_expect.json
const ghostRegistry = new GhostBlockRegistry();
const ghostExpect = new GhostExpectStore({ logger }).load();
const ghostGuard = new GhostGuard(ghostRegistry);
// 服务端 addon 与插件版本一致性校验。不一致时禁用 ghost 写入
const addonCheck = new AddonVersionCheck({ logger });

// 写世界前的原方块快照（data/sessions/）。启动时先收拾上次异常退出留下的会话，
// 再补 ghost —— 顺序不能反：先还原成"原来的世界"，再按期望集合重放 ghost。
// 注意创建顺序：GhostRenderer / ProjectionRenderer 都要用它做"先备再写"，必须早于渲染管线建。
const worldSnapshot = new WorldSnapshot({
    logger,
    isGhost: (t) => ghostRegistry.isGhost(t),
}).load();

// ═══════════════════ 渲染管线（ghost 方块取代粒子） ═══════════════════
// 3.0.0 起投影不再 spawn 粒子，而是在世界里写 lit:g_* 真实方块
const ghostRenderer = new GhostRenderer({
    registry: ghostRegistry,
    expectStore: ghostExpect,
    addonCheck,
    snapshot: worldSnapshot,
    guard: ghostGuard,
    logger,
    writesPerTick: configManager.get('render.ghostWritesPerTick', 300),
    maxBlocks: configManager.get('render.ghostMaxBlocks', 60000),
    overwriteReplaceable: configManager.get('render.ghostOverwriteReplaceable', true),
});

// 投影会话层不在此处显式装配：ProjectionRenderer 通过 _gr() 惰性获取 global.ghostRenderer，
// 以保持外部访问基线不被装配细节污染。

// /litematica selfcheck ：一条命令验证"读原状→快照→写幽灵→读回→撤销"整条链路
const ghostSelfCheck = new GhostSelfCheck({
    registry: ghostRegistry,
    addonCheck,
    snapshot: worldSnapshot,
    logger,
});
ghostGuard.install({ expectStore: ghostExpect, logger });
// 轻松放置 / 投影打印机认 ghost：ghost 是真实方块（lit:g_*），判定必须显式注入，
// 否则会拿 `type !== 'minecraft:air'`比，整片投影判成"非空" ，无法放置。
try {
    easyPlaceManager.attachGhostChecks({ isAirLike: (b) => ghostGuard.isAirLike(b) });
} catch (e) {
    logger.warn(`[LitematicaBE] 注入 ghost 判定失败: ${e && e.message ? e.message : e}`);
}
giCheckWiring();

/** 把版本校验结果接到写闸门上（加载期一次；onServerStarted 会再校验一次） */
function giCheckWiring() {
    try {
        const rep = addonCheck.run(ghostRegistry.stats());
        ghostGuard.setWritesEnabled(rep.enabled, rep.enabled ? null : (rep.issues.find(i => i.level === 'error') || {}).message);
    } catch (e) {
        logger.warn(`[LitematicaBE] addon 版本校验异常: ${e && e.message ? e.message : e}`);
    }
}

// 全局导出供其他模块使用
global.zlib = zlib;
global.fs = fs;
global.configManager = configManager;
global.dataManager = dataManager;
global.renderer = renderer;
global.projManager = projManager;
global.loader = loader;
global.logCleaner = logCleaner;
global.easyPlaceManager = easyPlaceManager;
global.selectionTool = selectionTool;
global.schematicSaver = schematicSaver;
global.webServer = webServer;
global.updateChecker = updateChecker;
global.blockVerifier = blockVerifier;
global.materialCounter = materialCounter;
global.ghostRegistry = ghostRegistry;
global.ghostGuard = ghostGuard;
global.ghostExpect = ghostExpect;
global.addonCheck = addonCheck;
global.worldSnapshot = worldSnapshot;
global.ghostSelfCheck = ghostSelfCheck;
global.ghostRenderer = ghostRenderer;

// 超大型投影全局导出
global.megaManager = megaManager;
global.streamLoader = streamLoader;
global.megaRenderer = megaRenderer;

// MEGA 渲染器构造（第 75 行）早于 global.configManager 赋值（第 147 行），
// 构造期读不到配置会把 render.enableMega 永久锁成 false —— 这里补一次加载。
megaRenderer.loadConfig();

const PLUGIN_NAME = "LitematicaBE";

// 玩家临时数据（内存中）
const playerSessions = new Map();
global.playerSessions = playerSessions;

logger.info(`${PLUGIN_NAME} v${PLUGIN_VERSION} Loading...`);

// ═══════════════════ 统一 tick 调度器 ═══════════════════
const renderScheduler = new RenderScheduler({
    logger,
    budgetMs: configManager.get('render.tickBudgetMs', 8),
});
global.renderScheduler = renderScheduler;

renderScheduler.add('ghost-render', () => ghostRenderer.tick(), { everyTicks: 1, priority: 10 });
renderScheduler.add('ghost-retry', () => ghostRenderer.retryPending(), { everyTicks: 20, priority: 20 });
renderScheduler.add('easyplace-fast', () => easyPlaceManager.tickFastPlace(), { everyMs: 200, priority: 30 });
renderScheduler.add('mega-render', () => megaRenderer.onTick(), {
    everyTicks: 1,
    priority: 40,
    // 任务常开：开关由 megaRenderer.isEnabled() 在任务体内实时判定。
    // 不要用 enabled: !!megaRenderer.enabled ，会在注册时求值一次并固定，导致开关永久失效。
    enabled: true,
});
// 日志清理：总开关与扫描间隔都读 config（logCleaner.enabled / logCleaner.scanInterval）。
const logCleanerEnabled = configManager.get('logCleaner.enabled', true) !== false;
const logCleanerInterval = (() => {
    const n = Number(configManager.get('logCleaner.scanInterval', 60000));
    if (!Number.isFinite(n)) return 60000;
    return Math.min(3600000, Math.max(1000, Math.floor(n)));
})();
renderScheduler.add('actionbar', () => uiManager.updateActionBars(), { everyTicks: 2, priority: 60 });
renderScheduler.add('debug-flush', () => megaRenderer.flushLogs(), { everyMs: 5000, priority: 80 });
renderScheduler.add('log-cleaner', () => {
    // cleanRenderLogs 是 async：同步 try/catch 抓不到 reject，必须自己兜住
    try {
        const p = logCleaner.cleanRenderLogs();
        if (p && typeof p.catch === 'function') p.catch(() => { });
    } catch (e) { /* 清理失败不影响主循环 */ }
}, { everyMs: logCleanerInterval, priority: 90, enabled: logCleanerEnabled });
// 版本更新检查（启动时一次，配置项 updateCheck.enabled 可关，关闭时不注册任务）：
// 网络结果只能在主线程打印，此处挂一次性任务，onServerStarted 发起后由它取结果并打日志。
if (updateChecker.isEnabled()) {
    renderScheduler.add('update-check', () => drainUpdateCheck(), { everyMs: 500, priority: 95 });
}
renderScheduler.start();

// 调度器就绪后再装配并启动日志自动清理（LogCleaner 构造期不再自己 setInterval）
try {
    // 启动期信息日志默认静默（config 的 misc.verboseStartupLog ）
    logCleaner.setVerboseStartup(configManager.get('misc.verboseStartupLog', false) === true);
    // 把 config 的 logCleaner 段真正装配进 cleaner：此前 configure() 没有调用点，
    // 段里的 scanInterval / backupEnabled / maxBackupFiles / patterns 全部形同虚设（一直吃构造期默认值）。
    // patterns 在 config 里是字符串数组，编译成 RegExp 由 LogCleaner.configure 内部完成。
    logCleaner.configure({
        scanInterval: logCleanerInterval,
        backupEnabled: configManager.get('logCleaner.backupEnabled', true),
        maxBackupFiles: configManager.get('logCleaner.maxBackupFiles', 10),
        patterns: configManager.get('logCleaner.patterns', null)
    });
    // enabled=false 时保持停用：调度器任务注册时就带了 enabled:false，不会被 tick 调度
    if (logCleanerEnabled) logCleaner.startAutoClean();
} catch (e) {
    logger.warn(`[LitematicaBE] 日志自动清理启动失败: ${e && e.message ? e.message : e}`);
}

// 确保目录存在
if (!File.exists(SCHEMATIC_PATH)) {
    File.mkdir(SCHEMATIC_PATH);
}

// ==================== 工具函数 ====================

function getPlayerSession(xuid) {
    if (!playerSessions.has(xuid)) {
        playerSessions.set(xuid, {
            selectedSchematic: null,
            tempProjection: null
        });
    }
    return playerSessions.get(xuid);
}

function isHoldingWoodenSword(player) {
    try {
        const item = player.getHand();
        if (!item) return false;
        
        const itemType = String(item.type || item.name || item.id || '');
        
        const baseName = String(itemType).split(':').pop();
        return baseName === 'wooden_sword';
    } catch (e) {
        logger.error(`Error checking hand: ${e.message}`);
        return false;
    }
}

function getPlayerLookPitch(player) {
    // 获取玩家的俯仰角
    // -90 = 正上方, 90 = 正下方
    return player.direction?.pitch || 0;
}

// ==================== 木剑交互系统 ====================

// 冷却时间，防止快速重复触发
const playerCooldowns = new Map();

// ==================== 轻松放置事件监听 ====================

// onUseItemOn ：在放置前拦截
mc.listen("onUseItemOn", (player, item, block, side, pos) => {
    const enabled = easyPlaceManager.isEnabled(player);
    if (!enabled) return true;
    if (!item) return true;
    const result = easyPlaceManager.handleUseItemOn(player, item, block, side, pos);
    return result;
});

// afterPlaceBlock ：在放置后检测并修正
// 注意：correctionEnabled 开关在 correctBlockPlacement 内部判断
mc.listen("afterPlaceBlock", (player, block) => {
    easyPlaceManager.correctBlockPlacement(player, block);
});

// ==================== 木剑操作事件监听 ====================

// 监听使用物品事件（注：_side 占位）
mc.listen("onUseItemOn", (player, item, block, _side, pos) => { 
    // 检查是否是木剑
    if (!item || !item.type || item.type !== 'minecraft:wooden_sword') {
        return;
    }

    const cooldownKey = `litematica_${player.uuid}`;
    const now = Date.now();
    const lastUse = playerCooldowns.get(cooldownKey) || 0;

    if (now - lastUse < 500) {
        return;
    }
    playerCooldowns.set(cooldownKey, now);

    // 检查是否正在选区
    if (selectionTool.isSelecting(player.xuid)) {
        const consumed = selectionTool.handleSwordClick(player, block);
        if (!consumed) {
            // 选区完成，打开保存UI
            const sel = selectionTool.getSelection(player.xuid);
            if (sel && sel.state === 'completed') {
                const region = selectionTool.calculateRegion(sel.pos1, sel.pos2);
                uiManager.showSaveSchematicForm(player, region);
            }
        }
        return;
    }

    if (player.isSneaking) {
        uiManager.showMainMenu(player);
        return;
    }

    const playerData = dataManager.getPlayerData(player.xuid);
    const session = getPlayerSession(player.xuid);

    switch (playerData.toolMode) {
        case 'place':
            handlePlaceMode(player, block, pos, session);
            break;
        case 'rotate':
            handleRotateMode(player, session);
            break;
        case 'build':
            handleBuildMode(player, session);
            break;
        default:
            player.tell('§7请先选择操作模式');
            player.tell('§e/litematica build §7- 切换到建造模式(逐层渲染)');
            player.tell('§e/litematica place §7- 切换到放置模式');
            player.tell('§e/litematica rotate §7- 切换到旋转模式');
            break;
    }
});

// 监听木剑使用事件（不需要对着方块）- 用于建造模式切层
mc.listen("onUseItem", (player, item) => {
    // 检查是否是木剑
    if (!item || !item.type || item.type !== 'minecraft:wooden_sword') {
        return;
    }

    const cooldownKey = `litematica_${player.uuid}`;
    const now = Date.now();
    const lastUse = playerCooldowns.get(cooldownKey) || 0;

    if (now - lastUse < 500) {
        return;
    }

    // 检查是否正在选区
    if (selectionTool.isSelecting(player.xuid)) {
        return;
    }

    if (player.isSneaking) {
        return;
    }

    const playerData = dataManager.getPlayerData(player.xuid);
    const session = getPlayerSession(player.xuid);

    // 只处理建造模式
    if (playerData.toolMode === 'build') {
        playerCooldowns.set(cooldownKey, now);
        handleBuildMode(player, session);
    }
});

// 监听点击空气事件（用于旋转模式和建造模式）
// onClick 事件在 LeviLamina 中可能不可用？使用 onUseItemOn 代替

// ==================== 模式处理函数 ====================

/**
 * 处理放置模式
 */
function handlePlaceMode(player, _block, pos, session) {
    if (!session.selectedSchematic) {
        player.tell('§c请先加载原理图');
        player.tell('§f使用 §e/litematica menu §f打开菜单');
        return;
    }

    // 获取玩家数据
    const playerData = dataManager.getPlayerData(player.xuid);
    const opacity = playerData?.settings?.defaultOpacity || 0.8;

    // 创建投影
    const schematic = session.selectedSchematic;
    
    const isMegaPlace = !!(schematic.isMega && schematic.schematicId);
    
    // 创建新的投影
    const projection = {
        id: dataManager.generateId(),
        name: schematic.name,
        filePath: schematic.filePath,
        position: {
            x: pos.x,
            y: pos.y + 1,
            z: pos.z
        },
        dimension: (player.pos && typeof player.pos.dimid === 'number') ? player.pos.dimid : 0,
        rotation: 0,
        mirrorX: false,
        mirrorZ: false,
        enabled: true,
        opacity: opacity,
        renderLayer: -1,
        showBounds: true,
        boundsColor: "#00FF00",
        author: player.xuid,
        createdAt: Date.now(),
        totalBlocks: schematic.totalBlocks || 0,
        dimensions: schematic.dimensions || { x: 1, y: 1, z: 1 },
        blocks: schematic.blocks || [],
        isMega: isMegaPlace,
        schematicId: schematic.schematicId || null,
        blockIndex: schematic.blockIndex || null,
        blockChunks: schematic.blockChunks || null
    };

    // 保存投影
    dataManager.addProjection(projection);
    dataManager.setPlayerCurrentProjection(player.xuid, projection.id);
    dataManager.setPlayerToolMode(player.xuid, 'build');

    projManager.activateProjection(player, projection);

    if (isMegaPlace) {
        // 顺序要紧：先建 Mega 注入状态（读分块索引），再建 ghost 会话（空队列）。
        // onTick 里的 pumpChunks 会先确认会话存在再注入，所以两者都就绪后才开始喂数据。
        const megaState = megaRenderer.initRenderState(player, schematic.schematicId, projection);
        renderer.startRender(player, projection, -1);
        if (megaState) logger.info('[LitematicaBE] 超大型投影注入已启动');
    } else {
        renderer.startRender(player, projection);
    }

    player.tell(`投影已放置: ${projection.name}`);
    player.tell(`位置: (${projection.position.x}, ${projection.position.y}, ${projection.position.z})`);
    player.tell(`方块数: ${projection.totalBlocks}`);
    player.tell(`已自动切换到建造模式`);
    player.tell(`抬头/低头+木剑切换层，平视切换显示`);
    reportActiveCount(player);
}

/**
 * 放置/加载完一个投影后，告诉玩家"现在一共几个、木剑控制哪一个"。
 * 多投影并存时这条提示是玩家理解"点加载不会挤掉上一个"的唯一反馈。
 */
function reportActiveCount(player) {
    try {
        if (!player || typeof renderer.getPlayerProjections !== 'function') return;
        const list = renderer.getPlayerProjections(player);
        if (list.length <= 1) return;
        const primary = list.find(t => t.primary);
        player.tell(`§7当前同时显示 §f${list.length}§7 个投影，木剑控制：§f${(primary && primary.projection && primary.projection.name) || '—'}`);
        player.tell('§7菜单「投影操作 → 选择木剑控制的投影」或 §f/litematica select§7 可切换');
    } catch (e) { /* 提示失败不影响放置 */ }
}

/**
 * 处理旋转模式
 */
function handleRotateMode(player, _session) {
    const activeProj = projManager.getActiveProjectionByPlayer(player);

    if (!activeProj) {
        player.tell('§c你没有正在操作的投影');
        player.tell('§e请先放置投影');
        return;
    }

    if (activeProj.projection.isMega) {
        player.tell('§c超大型投影暂不支持旋转操作');
        return;
    }

    // 多投影：只重建**这一个**投影的会话，其它已加载的投影必须原样留着
    const rotateId = activeProj.projection.id;
    renderer.clearProjection(player, rotateId);

    activeProj.projection.rotation = (activeProj.projection.rotation + 90) % 360;
    activeProj.lastUpdate = Date.now();
    try {
        dataManager.updateProjection(rotateId, { rotation: activeProj.projection.rotation });
    } catch (e) { /* 落盘失败不影响本次旋转 */ }

    renderer.startRender(player, activeProj.projection, activeProj.renderLayer);

    player.tell(`§a投影已旋转到 ${activeProj.projection.rotation}°`);
}

/**
 * 处理建造模式 - 逐层渲染
 */
function handleBuildMode(player, _session) {
    // 首先检查 projManager 中是否有活动投影
    let activeProj = projManager.getActiveProjectionByPlayer(player);

    // 如果 projManager 中没有，尝试从 dataManager 恢复
    if (!activeProj) {
        const playerData = dataManager.getPlayerData(player.xuid);
        const projectionId = playerData?.currentProjectionId;

        if (!projectionId) {
            player.tell('§c你没有正在操作的投影');
            player.tell('§e请先使用 §e/litematica place §e放置投影');
            return;
        }

        const projection = dataManager.getProjection(projectionId);

        if (!projection) {
            player.tell('§c投影不存在或已被删除');
            player.tell('§e请重新放置投影');
            return;
        }

        // 激活投影
        activeProj = projManager.activateProjection(player, projection);
    }

    // 获取当前俯仰角和方向
    const pitch = getPlayerLookPitch(player);
    let direction = 'down';

    if (pitch < -30) {
        direction = 'up';
    } else if (pitch > 30) {
        direction = 'down';
    } else {
        direction = 'toggle';
    }

    // 切换层级
    const result = projManager.switchLayer(player, direction);

    if (result) {
        const newLayer = result.renderLayer;
        const isMegaProj = !!(result.projection.isMega && result.projection.schematicId);

        // 统一入口：普通投影 gr.setLayer / MEGA setLayerMode，且**只动这一个投影的会话**
        const r = renderer.applyLayer(player, result.projection, newLayer);
        if (!r.ok) {
            const why = (r.reason === 'mega-not-ready')
                ? '分块注入状态缺失，请重新放置该投影'
                : renderer._reasonText(r.reason);
            player.tell(`§c分层切换失败：${why}`);
            return;
        }
        if (r.unchanged) return;

        // 成功提示默认静默（config）；失败提示始终保留
        const showLayerInfo = configManager.get('misc.showLayerInfo', false);
        if (isMegaProj) {
            if (newLayer === -1) {
                const totalBlocks = result.projection.totalBlocks || 0;
                if (showLayerInfo) player.tell(`§a显示全部层 §7(${totalBlocks} 方块，${r.chunks} 个分块)`);
            } else {
                const layers = (result.projection.dimensions && result.projection.dimensions.y) || 1;
                if (showLayerInfo) player.tell(`§a当前层: §e${newLayer} §7/ ${layers}§a，${r.chunks} 个分块待注入`);
            }
        } else {
            const info = projManager.getLayerInfo(result.projection, newLayer);
            if (newLayer === -1) {
                if (showLayerInfo) player.tell(`§a显示全部层 §7(${info.totalBlocks} 方块)`);
            } else {
                if (showLayerInfo) {
                    player.tell(`§a当前层: §e${newLayer} §7/ ${info.totalLayers}`);
                    player.tell(`§7本层方块: §f${info.currentLayerBlocks}`);
                }
            }
        }
    }
}

// ==================== 命令系统 ====================

/**
 * 命令注册簿。
 */
const registeredCommands = new Set();

function setupCommand(label, builder) {
    if (registeredCommands.has(label)) return true;
    let cmd = null;
    try {
        cmd = builder();
    } catch (e) {
        logger.warn(`[LitematicaBE] 构建命令 ${label} 失败: ${e.message}`);
        return false;
    }
    if (!cmd || typeof cmd.setup !== 'function') {
        logger.warn(`[LitematicaBE] 构建命令 ${label} 失败: 未得到指令对象`);
        return false;
    }
    try {
        const ok = cmd.setup();
        if (ok) {
            registeredCommands.add(label);
            // 注册成功属于启动噪音（6 条命令 × 每次启动）：默认静默，
            // 排查命令注册问题时把 config 的 misc.verboseCommandLog（或总开关 verboseStartupLog）改 true。
            if (configManager.get('misc.verboseStartupLog', false) || configManager.get('misc.verboseCommandLog', false)) {
                logger.info(`[LitematicaBE] 命令 ${label} 已注册`);
            }
            return true;
        }
        logger.warn(`[LitematicaBE] 命令 ${label} 注册失败: setup() 返回 false`);
        return false;
    } catch (e) {
        logger.warn(`[LitematicaBE] 命令 ${label} 注册异常: ${e.message}`);
        return false;
    }
}

/** ghost 子动作分派：主命令 `/litematica ghost` 与独立命令 `/litematica:ghost` 共用同一套逻辑。
 *  运维兜底 clean（清无主 ghost）与 sweep（坐标读世界清理）。 */
function dispatchGhost(player, sub) {
    if (!player) return false;
    const s = String(sub === undefined || sub === null ? '' : sub).trim().toLowerCase();
    if (s === 'clean') {
        // 不依赖任何内存会话：把"世界里留着 ghost、期望账本还认、但没会话能撤销"的残留
        // （强退/重启后的 MEGA 投影是必踩场景）一次性清干净。活跃会话不受影响。
        const r = renderer.reclaimOrphans(player);
        player.tell(`§a清理无主 ghost：期望删 §e${r.expect} §a格 / 会话 §e${r.sessions} §a个`
            + ` / 还原世界 §e${r.restored} §a格 / 失败 §e${r.failed}`);
        if (r.remaining) {
            player.tell(`§7还有 ${r.remaining} 格未还原（区块未加载居多）：靠近残留区域再执行一次`);
            player.tell('§7或者重启服务器后再执行（启动时也会自动清理）');
        }
        if (!r.expect && !r.sessions) player.tell('§7未发现无主 ghost');
        return true;
    }
    if (s.indexOf('sweep') === 0 || s.indexOf('scan') === 0) {
        // /lit ghost sweep                     → 以自身为中心的 5×5 区块（默认）
        // /lit ghost sweep 3                   → 3×3 区块（1..9 视为区块数）
        // /lit ghost sweep 32                  → 兼容旧用法：>9 按"格半径"处理（上限 32）
        // /lit ghost sweep box x1 y1 z1 x2 y2 z2 [dry]
        // 用于"快照与期望都已散失"的残留：只能按坐标读世界、判 ghost、写回空气。
        if (!addonCheck.isEnabled()) {
            player.tell('§cghost 写入已禁用：addon 与插件版本不一致（详见 /litematica:ghost clean）');
            return false;
        }
        const parts = s.split(/\s+/).filter(Boolean);
        const opts = { chunks: 5 };
        if (parts[1] === 'box' && parts.length >= 8) {
            const n = parts.slice(2, 8).map((v) => Number(v));
            if (n.every(Number.isFinite)) {
                opts.box = {
                    minX: Math.floor(Math.min(n[0], n[3])), maxX: Math.floor(Math.max(n[0], n[3])),
                    minY: Math.floor(Math.min(n[1], n[4])), maxY: Math.floor(Math.max(n[1], n[4])),
                    minZ: Math.floor(Math.min(n[2], n[5])), maxZ: Math.floor(Math.max(n[2], n[5])),
                };
                delete opts.chunks;
            }
        } else if (parts[1]) {
            const n = Number(parts[1]);
            if (Number.isFinite(n) && n > 0) {
                if (n <= 9) {
                    opts.chunks = n;          // 区块数（N×N，以自身所在区块为中心）
                } else {
                    opts.radius = n;          // 兼容旧用法：格半径
                    delete opts.chunks;
                }
            }
        }
        if (parts.includes('dry')) opts.dryRun = true;

        const r = renderer.sweepGhosts(player, opts);
        if (r.error === 'no-player') {
            player.tell('§c取不到玩家位置，无法扫描');
            return false;
        }
        const bx = r.box || {};
        const where = (bx.minX !== undefined)
            ? `(${bx.minX},${bx.minY},${bx.minZ})~(${bx.maxX},${bx.maxY},${bx.maxZ})`
            : '未知范围';
        const scope = opts.chunks ? `${opts.chunks}×${opts.chunks} 区块 ` : '';
        player.tell(`§aghost 扫描 ${scope}${where}：扫描 §e${r.scanned}§a 格，${opts.dryRun ? '发现' : '清掉'} ghost §e${r.cleared}§a 个`
            + (r.kept ? `，§7活跃投影保留 ${r.kept} 格` : '')
            + (r.failed ? `，失败 §c${r.failed}` : '')
            + (r.skipped ? `§7，区块未加载跳过 ${r.skipped} 格（靠近后再扫一次）` : ''));
        if (opts.dryRun) player.tell('§7演练模式：只统计、未写世界（去掉末尾 dry 才真清）');
        if (!r.cleared && !r.skipped) player.tell('§7这个范围内没有 ghost 方块，世界是干净的');
        return true;
    }
    player.tell('§7用法：/litematica:ghost clean | sweep [n|box x y z x2 y2 z2] [dry]');
    return false;
}

function buildMainCommand() {
    const cmd = mc.newCommand("litematica", "Litematica projection tool", PermType.Any, 0x80);

    cmd.setEnum("ActionEnum", ["menu", "load", "place", "placeat", "rotate", "build", "easyplace", "printer", "correction", "verify", "materials", "clear", "list", "remove", "info", "debug", "save", "failures", "ghost", "selfcheck", "web", "select"]);

    // 重载铁律（远古bug）：
    //   1. mandatory 参数必须出现在每一条重载里，`overload([])` 会让整条命令注册失败；
    //   2. RawText「只能作为最后一个参数」，而且只能有一个：原来 filename 与 args都是 RawText，等于两条形态相同的重复重载，同样会被 BDS 拒收。
    cmd.mandatory("action", ParamType.Enum, "ActionEnum", 1);
    cmd.optional("x", ParamType.Int);
    cmd.optional("y", ParamType.Int);
    cmd.optional("z", ParamType.Int);
    // RawText 必须最后声明，也必须是重载里的最后一项（见 LSE 命令 API 的参数类型表）
    cmd.optional("args", ParamType.RawText);

    cmd.overload(["ActionEnum"]);
    cmd.overload(["ActionEnum", "args"]);
    cmd.overload(["ActionEnum", "x", "y", "z"]);

    cmd.setCallback((_cmd, origin, output, results) => {    // _cmd 占位
        const player = origin.player;
        if (!player) {
            output.success("This command must be used by a player");
            return;
        }

        // 自由文本统一走 args
        const argText = results.args;
        dispatchMainAction(player, results.action, results, argText, output);
    });

    return cmd;
}

/**
 * 主命令动作分发（/litematica 与 /lit 共用）。
 *
 * 抽出来的原因：`/lit` 原来只声明了空重载，玩家照着提示敲 `/lit printer` 会被 BDS 判成"重载不匹配"，命令在、功能在，但入口不可达。
 * 现在短命令把文本转成 action 后直接走这里，两条命令的行为永远一致。
 *
 * @param {object} player
 * @param {string} action
 * @param {object} results 主命令的重载结果（含 x/y/z）；短命令路径下为空
 * @param {string} argText 自由文本参数
 * @param {object} output
 */
function dispatchMainAction(player, action, results, argText, output) {
    if (!results) results = {};
    switch (action) {
            case "menu":
                uiManager.showMainMenu(player);
                break;
            case "load":
                handleLoadCommand(player, argText, output);
                break;
            case "place":
                handlePlaceCommand(player, argText, output);
                break;
            case "placeat":
                // 短命令/ RawText 重载拿不到 results.x，必须把 argText 一起传下去兜底解析
                handlePlaceAtCommand(player, results.x, results.y, results.z, output, argText);
                break;
            case "rotate":
                dataManager.setPlayerToolMode(player.xuid, 'rotate');
                uiManager.sendModeChangeTip(player, 'rotate');
                output.success("§a已切换到旋转模式");
                output.success("§f使用木剑点击来旋转投影");
                break;
            case "build":
                dataManager.setPlayerToolMode(player.xuid, 'build');
                uiManager.sendModeChangeTip(player, 'build');
                output.success("§a已切换到建造模式");
                output.success("§f使用木剑（抬头/低头）切换层");
                break;
            case "easyplace":
                easyPlaceManager.toggle(player);
                break;
            case "printer":
                easyPlaceManager.toggleFastPlace(player);
                break;
            case "correction":
                easyPlaceManager.toggleCorrection(player);
                break;
            case "failures":
                handleFailuresCommand(player, output);
                break;
            case "verify":
                handleVerifyCommand(player, output);
                break;
            case "materials":
                handleMaterialsCommand(player, output);
                break;
            case "clear":
                // clearPlayerProjection 内部已经连同"重进自动恢复"的记录一起清掉。
                // 多投影：/lit clear 是"全部清掉"；只清一个请用「投影操作 → 卸载某个投影」。
                renderer.clearPlayerProjection(player);
                // 逐个回收 MEGA 注入状态（不能只看主控那一个）
                try {
                    const leftList = (typeof renderer.getPlayerProjections === 'function')
                        ? renderer.getPlayerProjections(player) : [];
                    for (const row of leftList) {
                        const pj = row.projection;
                        if (!pj || !pj.schematicId) continue;
                        const sid = (typeof megaRenderer.stateIdFor === 'function')
                            ? megaRenderer.stateIdFor(player, pj)
                            : `${player.xuid}_${pj.schematicId}`;
                        if (sid) megaRenderer.stopRender(sid);
                    }
                } catch (e) { /* 状态回收失败不影响清除 */ }
                projManager.removeActiveProjection(player.xuid);
                output.success("§a已清除全部投影显示");
                break;
            case "select":
                handleSelectCommand(player, argText, output);
                break;
            case "list":
                listProjections(player, output);
                break;
            case "remove":
                handleRemoveCommand(player, argText, output);
                break;
            case "info":
                showProjectionInfo(player, output);
                break;
            case "debug":
                // RawText 是整串文本，handleDebugCommand 期望数组；原来直接传字符串，
                // args[0] 取到的是第一个字符，所有 debug 子命令都落进 default 分支
                handleDebugCommand(player, String(argText || '').trim().split(/\s+/).filter(Boolean), output);
                break;
            case "save":
                uiManager.showSaveSchematicMenu(player);
                output.success("§a已打开保存原理图菜单");
                break;
            case "ghost":
                dispatchGhost(player, argText);
                break;
            case "web":
                // `/litematica web` 等价于 `/litematica:web status`
                sendWebStatus(player, output);
                break;
            case "selfcheck":
                // 写世界链路自检。逐项 PASS/FAIL，失败停在该层并说明原因
                try {
                    ghostSelfCheck.run(player);
                } catch (e) {
                    output.error(`§cselfcheck 异常: ${e && e.message ? e.message : e}`);
                }
                break;
            default:
                uiManager.showMainMenu(player);
        }
}

function buildShortCommand() {
    const cmdShort = mc.newCommand("lit", "Litematica (Short)", PermType.Any, 0x80);
    // 短命令原来只声明了空重载，玩家照着提示敲 `/lit printer` 会被 BDS 判成
    // "重载不匹配" —— 命令在、功能在，入口不可达。RawText 只能有一个且必须放最后。
    cmdShort.optional("args", ParamType.RawText);
    cmdShort.overload([]);
    cmdShort.overload(["args"]);
    cmdShort.setCallback((_cmd, origin, output, results) => {
        const player = origin.player;
        if (!player) return;
        const text = String((results && results.args) || '').trim();
        if (!text) {
            uiManager.showMainMenu(player);
            return;
        }
        // `/lit printer` → action=printer，其余文本原样交给 args（与长命令同一套分发）
        const parts = text.split(/\s+/);
        const action = parts[0];
        const argText = parts.slice(1).join(' ');
        dispatchMainAction(player, action, {}, argText, output);
    });
    return cmdShort;
}

function buildLogCleanCommand() {
    // 日志清理命令
    const cmdLogClean = mc.newCommand("litematica:logclean", "Clean render logs", PermType.Any, 0x80);
    cmdLogClean.setEnum("LogCleanAction", ["status", "clean", "config"]);
    cmdLogClean.mandatory("action", ParamType.Enum, "LogCleanAction", 1);
    cmdLogClean.overload(["LogCleanAction"]);
    cmdLogClean.setCallback((_cmd, origin, _output, results) => {
        const action = results.action;

        // 支持玩家和后台执行
        const isConsole = !origin.player;
        const sendMessage = isConsole
            ? (msg) => logger.info(msg)
            : (msg) => origin.player.tell(msg);

        switch (action) {
            case "status":
                const stats = logCleaner.getStats();
                sendMessage("§6========== 日志清理状态 ==========");
                sendMessage(`§e总扫描次数: §f${stats.totalScans}`);
                sendMessage(`§e总清除行数: §f${stats.totalLinesRemoved}`);
                sendMessage(`§e处理文件数: §f${stats.totalFilesProcessed}`);
                sendMessage(`§e上次扫描: §f${stats.lastScanTime}`);
                sendMessage(`§e扫描间隔: §f${stats.config.scanInterval}ms`);
                break;
            case "clean":
                sendMessage("§7正在清理渲染日志...");
                const cleanResult = logCleaner.cleanRenderLogsSync();
                if (cleanResult.success) {
                    sendMessage(`§a日志清理完成！`);
                    sendMessage(`§7处理文件: ${cleanResult.filesProcessed}`);
                    sendMessage(`§7清除行数: ${cleanResult.linesRemoved}`);
                } else {
                    sendMessage(`§c日志清理失败: ${cleanResult.errors.join(', ')}`);
                }
                break;
            case "config":
                const config = logCleaner.getConfig();
                sendMessage("§6========== 日志清理配置 ==========");
                sendMessage(`§e日志目录: §f${config.logDir}`);
                sendMessage(`§e扫描间隔: §f${config.scanInterval}ms`);
                sendMessage(`§e备份启用: §f${config.backupEnabled ? '是' : '否'}`);
                sendMessage(`§e模式数量: §f${config.patterns.length}`);
                sendMessage(`§e最大备份: §f${config.maxBackupFiles}`);
                break;
        }
    });
    return cmdLogClean;
}

function buildConfigCommand() {
    // 配置管理命令
    const cmdConfig = mc.newCommand("litematica:config", "Config management", PermType.Any, 0x80);
    cmdConfig.setEnum("ConfigAction", ["reload", "reset", "get"]);
    cmdConfig.mandatory("action", ParamType.Enum, "ConfigAction", 1);
    cmdConfig.optional("key", ParamType.RawText);
    cmdConfig.overload(["ConfigAction"]);
    cmdConfig.overload(["ConfigAction", "key"]);
    cmdConfig.setCallback((_cmd, origin, output, results) => {
        const player = origin.player;
        if (!player) {
            output.success("This command must be used by a player");
            return;
        }

        const action = results.action;
        switch (action) {
            case "reload":
                configManager.reload();
                player.tell("§a配置文件已重新加载");
                break;
            case "reset":
                configManager.reset();
                player.tell("§a配置已重置为默认值");
                break;
            case "get":
                if (results.key) {
                    const value = configManager.get(results.key);
                    if (value !== null) {
                        output.success(`§e${results.key}: §f${JSON.stringify(value)}`);
                    } else {
                        player.tell(`§c找不到配置: ${results.key}`);
                    }
                } else {
                    player.tell("§c请指定配置键");
                    player.tell("§7用法: /litematica:config get <key>");
                    player.tell("§7示例: /litematica:config get render.ghostWritesPerTick");
                }
                break;
        }
    });
    return cmdConfig;
}

/**
 * ghost 运维兜底命令的独立入口：clean（按无主快照/期望清）与 sweep（按坐标读世界清）。
 */
function buildGhostCommand() {
    const cmdGhost = mc.newCommand("litematica:ghost", "Ghost cleanup: clean | sweep", PermType.Any, 0x80);
    // 运维兜底 clean / sweep
    cmdGhost.setEnum("GhostAction", ["clean", "sweep"]);
    cmdGhost.mandatory("action", ParamType.Enum, "GhostAction", 1);
    cmdGhost.optional("args", ParamType.RawText);
    cmdGhost.overload(["GhostAction"]);
    cmdGhost.overload(["GhostAction", "args"]);
    cmdGhost.setCallback((_cmd, origin, output, results) => {
        const player = origin.player;
        if (!player) {
            output.success("This command must be used by a player");
            return;
        }
        // sweep 可带参数（sweep 3 / box ...）：枚举只认 "sweep"，参数经 RawText 追加后交给同一分派
        const sub = (results.action === 'sweep' && results.args)
            ? `sweep ${String(results.args)}`
            : results.action;
        dispatchGhost(player, sub);
    });
    return cmdGhost;
}

/**
 * 上传站状态输出（`/litematica web` 与 `/litematica:web status` 共用）。
 * 令牌只对控制台与 OP 展示。
 */
function sendWebStatus(player, output) {
    const s = webServer.summary();
    const say = player
        ? (m) => player.tell(m)
        : (m) => { try { output.success(m); } catch (e) { logger.info(m); } };
    const isOp = !player || (typeof player.isOP === 'function' && player.isOP());

    say('§6========== HTTP 上传站 ==========');
    say(`§e状态: §f${s.running ? '运行中' : (s.enabled ? '已停止' : '未启用 (web.enabled=false)')}`);
    say(`§e监听: §f${s.host}:${s.port}  §7公共地址: ${s.url}`);
    say(`§e目录: §f${s.targetDir}`);
    const wc = webServer.config();
    say(`§e分片/上限: §f${wc.chunkKB} KB / ${wc.maxFileMB} MB`);
    say(`§e进行中会话: §f${s.sessions}`);
    const st = s.stats;
    say(`§e累计: §f文件 ${st.files} 个 / 分片 ${st.chunks} / ${(st.bytes / 1048576).toFixed(1)} MB / 拒绝 ${st.rejected}`);
    if (st.lastFile) say(`§e最近: §f${st.lastFile.name} §7(${st.lastFile.size} 字节)`);
    if (s.tokenRequired) {
        if (isOp) {
            say(`§e令牌: §f${s.token}`);
            say(`§7访问: http://${s.host}:${s.port}/?token=${s.token}`);
            say(`§7令牌文件: ${s.tokenFile}`);
        } else {
            say('§7令牌仅管理员可见');
        }
    } else {
        say('§c令牌校验已关闭（web.tokenRequired=false）');
    }
}

/**
 * `/litematica:web` 独立命令：上传站的启停与令牌管理。
 */
function buildWebCommand() {
    const cmdWeb = mc.newCommand("litematica:web", "Structure upload web server", PermType.Any, 0x80);
    cmdWeb.setEnum("WebAction", ["status", "start", "stop", "restart", "token", "url"]);
    cmdWeb.mandatory("action", ParamType.Enum, "WebAction", 1);
    cmdWeb.overload(["WebAction"]);
    cmdWeb.setCallback((_cmd, origin, output, results) => {
        const player = origin.player;
        const say = player
            ? (m) => player.tell(m)
            : (m) => { try { output.success(m); } catch (e) { logger.info(m); } };
        const isOp = !player || (typeof player.isOP === 'function' && player.isOP());
        const action = results.action;

        // 启停与令牌属于服务端管理动作：控制台或 OP
        if (action !== 'status' && action !== 'url' && !isOp) {
            say('§c该操作需要管理员权限');
            return;
        }

        switch (action) {
            case "status":
                sendWebStatus(player, output);
                break;
            case "start":
                if (webServer.isRunning()) {
                    say('§7上传站已在运行');
                    break;
                }
                if (webServer.start()) {
                    const s = webServer.summary();
                    say(`§a上传站已启动: §f${s.url}`);
                    if (s.tokenRequired) say(`§7带令牌地址: §fhttp://${s.host}:${s.port}/?token=${s.token}`);
                } else {
                    say('§c启动失败：详见服务端控制台日志（常见原因：端口被占用 / web.enabled=false / 运行时无 HttpServer）');
                }
                break;
            case "stop":
                if (webServer.stop()) say('§a上传站已停止');
                else say('§7上传站未在运行');
                break;
            case "restart":
                webServer.stop();
                say(webServer.start() ? '§a上传站已重启' : '§c重启失败，详见控制台日志');
                break;
            case "token": {
                const t = webServer.regenerateToken();
                const wc = webServer.config();
                say('§a已重新生成上传令牌（旧地址立即失效）');
                say(`§e新令牌: §f${t}`);
                say(`§7访问: http://${wc.host}:${wc.port}/?token=${t}`);
                say(`§7已写入: ${webServer.summary().tokenFile}`);
                break;
            }
            case "url": {
                const s = webServer.summary();
                if (!s.running) say('§7上传站未运行，先执行 §f/litematica:web start');
                say(`§e访问地址: §fhttp://${s.host}:${s.port}/`
                    + (s.tokenRequired && isOp ? `?token=${s.token}` : ''));
                if (!isOp) say('§7（令牌请向服主索取）');
                break;
            }
        }
    });
    return cmdWeb;
}

/**
 * 注册全部命令。可在加载期调用一次，并在 onServerStarted 再调用一次做兜底重试：
 * 已成功的命令记在 registeredCommands 里，不会被重复注册。
 */
function registerCommands(reason = 'load') {
    setupCommand('/litematica', buildMainCommand);
    setupCommand('/lit', buildShortCommand);
    setupCommand('/litematica:logclean', buildLogCleanCommand);
    setupCommand('/litematica:config', buildConfigCommand);
    setupCommand('/litematica:ghost', buildGhostCommand);
    setupCommand('/litematica:web', buildWebCommand);

    const okList = Array.from(registeredCommands);
    logger.info(`[LitematicaBE] 命令注册(${reason}): ${okList.length} 条可用 [${okList.join(', ')}]`);
    return okList.length;
}

function handleLoadCommand(player, filename, output) {
    if (!filename) {
        output.error("§c请指定文件名");
        output.success("§f用法: /litematica load <文件名>");
        output.success("§f可用文件:");
        const files = getSchematicFiles();
        for (const f of files) {
            output.success(`§7  - ${f}`);
        }
        return;
    }

    loadSchematicFile(filename, player).then(schematic => {
        if (schematic) {
            const session = getPlayerSession(player.xuid);
            session.selectedSchematic = schematic;
            
            output.success(`§a已加载: §e${schematic.name}`);
            output.success(`§7方块数: §f${schematic.totalBlocks}`);
            output.success(`§7尺寸: §f${schematic.dimensions?.x || '?'}x${schematic.dimensions?.y || '?'}x${schematic.dimensions?.z || '?'}`);
            output.success("§f请先选择操作模式");
        } else {
            output.error(`§c找不到文件: ${filename}`);
        }
    });
}

function handlePlaceCommand(player, filename, output) {
    loadSchematicFile(filename || (getPlayerSession(player.xuid).selectedSchematic?.name), player).then(schematic => {
        if (!schematic) {
            output.error("§c没有加载的原理图");
            output.success("§f用法: /litematica place <文件名>");
            output.success("§f或先 /litematica load <文件名>");
            return;
        }
        
        const session = getPlayerSession(player.xuid);
        session.selectedSchematic = schematic;
        
        const pos = player.pos;
        const placePos = {
            x: Math.floor(pos.x),
            y: Math.floor(pos.y) - 1,
            z: Math.floor(pos.z)
        };
        
        // 必须是布尔：`schematic.isMega && schematic.schematicId` 会短路返回字符串，
        // 落盘成 `"isMega":"mega_xxx"`，之后任何 `isMega !== true` 的严格判定都会失效。
        const isMega = !!(schematic.isMega && schematic.schematicId);
        
        const projection = {
            id: dataManager.generateId(),
            name: schematic.name,
            filePath: schematic.filePath || filename,
            position: placePos,
            dimension: (player.pos && typeof player.pos.dimid === 'number') ? player.pos.dimid : 0,
            rotation: 0,
            mirrorX: false,
            mirrorZ: false,
            enabled: true,
            opacity: 0.8,
            renderLayer: -1,
            showBounds: true,
            boundsColor: "#00FF00",
            author: player.xuid,
            createdAt: Date.now(),
            totalBlocks: schematic.totalBlocks,
            dimensions: schematic.dimensions,
            blocks: schematic.blocks,
            isMega: isMega,
            schematicId: schematic.schematicId || null,
            blockIndex: schematic.blockIndex || null,
            blockChunks: schematic.blockChunks || null
        };
        
        // 保存投影
        dataManager.addProjection(projection);
        dataManager.setPlayerCurrentProjection(player.xuid, projection.id);

        projManager.activateProjection(player, projection);

        if (isMega) {
            const megaState = megaRenderer.initRenderState(player, schematic.schematicId, projection);
            renderer.showBounds(projection, player);
            // 之前这里缺 startRender：MEGA 投影只建了注入状态、没有 ghost 会话，等于不出投影
            renderer.startRender(player, projection, -1);
            if (megaState) logger.info('[LitematicaBE] 超大型投影注入已启动');
        } else {
            renderer.showBounds(projection, player);
            renderer.startRender(player, projection, -1);
        }

        output.success(`投影已放置: ${schematic.name}`);
        output.success(`位置: (${placePos.x}, ${placePos.y}, ${placePos.z})`);
        output.success(`方块数: ${schematic.totalBlocks}`);
        output.success(`当前层: 0 / ${projection.dimensions?.y || 1}`);
        output.success(`使用 /lit build 切换到建造模式`);
        reportActiveCount(player);
    }).catch(err => {
        logger.error(`[LitematicaBE] loadSchematicFile error: ${err.message}`);
        output.error(`§c加载失败: ${err.message}`);
    });
}

/**
 * 在指定坐标放置投影：`/litematica placeat <x> <y> <z>`（或 `/lit placeat ...`）。
 *
 * 短命令 `/lit` 只有一个 RawText 参数，拿不到 x/y/z 三个 Int；长命令也可能被
 * `ActionEnum + args(RawText)` 重载先吃掉（BDS 的重载匹配顺序），于是 results.x 恒为
 * undefined —— 旧实现直接报"缺少坐标"，玩家只能改用界面或 `/lit place`（按玩家位置），
 * 表现出来就是"设置坐标无效、只在玩家位置生成"。这里统一从 argText 兜底解析，
 * 并支持 `~` 相对玩家坐标。
 *
 * @param {object} player
 * @param {number|undefined} x
 * @param {number|undefined} y
 * @param {number|undefined} z
 * @param {object} output
 * @param {string} [argText] 自由文本（"100 64 200" / "~ ~5 ~-3"）
 */
function handlePlaceAtCommand(player, x, y, z, output, argText) {
    const base = (player.pos && typeof player.pos.x === 'number')
        ? [player.pos.x, player.pos.y, player.pos.z]
        : [0, 0, 0];

    let px = toIntOr(x, NaN);
    let py = toIntOr(y, NaN);
    let pz = toIntOr(z, NaN);

    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) {
        const parsed = parseXYZText(argText, base);
        if (parsed) [px, py, pz] = parsed;
    }

    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) {
        output.error("§c缺少坐标");
        output.success("§f用法: /litematica placeat <x> <y> <z>");
        output.success("§f示例: /litematica placeat 100 64 200  或  /lit placeat ~ ~ ~");
        return;
    }

    const session = getPlayerSession(player.xuid);

    const schematic = session.selectedSchematic;

    if (!schematic) {
        output.error("§c没有加载的原理图");
        output.success("§f打开gui或使用 /litematica load <文件名>");
        return;
    }

    const placePos = { x: clampCoord(px), y: clampCoord(py), z: clampCoord(pz) };
    
    const isMega2 = !!(schematic.isMega && schematic.schematicId);
    
    const projection = {
        id: dataManager.generateId(),
        name: schematic.name,
        filePath: schematic.filePath,
        position: placePos,
        dimension: (player.pos && typeof player.pos.dimid === 'number') ? player.pos.dimid : 0,
        rotation: 0,
        mirrorX: false,
        mirrorZ: false,
        enabled: true,
        opacity: 0.8,
        renderLayer: -1,
        showBounds: true,
        boundsColor: "#00FF00",
        author: player.xuid,
        createdAt: Date.now(),
        totalBlocks: schematic.totalBlocks || 0,
        dimensions: schematic.dimensions || { x: 1, y: 1, z: 1 },
        blocks: schematic.blocks || [],
        isMega: isMega2,
        schematicId: schematic.schematicId || null,
        blockIndex: schematic.blockIndex || null,
        blockChunks: schematic.blockChunks || null
    };
    
    dataManager.addProjection(projection);
    dataManager.setPlayerCurrentProjection(player.xuid, projection.id);

    projManager.activateProjection(player, projection);

    if (isMega2) {
        const megaState = megaRenderer.initRenderState(player, schematic.schematicId, projection);
        renderer.showBounds(projection, player);
        // 同前，补上 ghost 会话，否则 MEGA 投影不会出现
        renderer.startRender(player, projection, -1);
        if (megaState) logger.info('[LitematicaBE] 超大型投影注入已启动');
    } else {
        renderer.showBounds(projection, player);
        renderer.startRender(player, projection, -1);
    }

    output.success(`投影已放置: ${schematic.name}`);
    output.success(`位置: (${placePos.x}, ${placePos.y}, ${placePos.z})`);
    output.success(`方块数: ${schematic.totalBlocks || 0}`);
    output.success(`当前层: 0 / ${projection.dimensions?.y || 1}`);
    reportActiveCount(player);
}

async function loadSchematicFile(filename, player) {
    const filePath = SCHEMATIC_PATH + filename;
    let fullPath = null;
    
    if (File.exists(filePath + ".litematic")) {
        fullPath = filePath + ".litematic";
    } else if (File.exists(filePath + ".mcstructure")) {
        fullPath = filePath + ".mcstructure";
    } else if (File.exists(filePath + ".json")) {
        fullPath = filePath + ".json";
    } else if (File.exists(filePath)) {
        fullPath = filePath;
    }
    
    if (!fullPath) {
        return null;
    }
    
    try {
        const megaThreshold = configManager.get('megaSchematic.threshold', 30000);
        // mega 渲染未启用时不能走 mega 加载：方块会被写进 .mcmega 分块、projection.blocks 留空，
        // 普通渲染拿不到数据，投影将完全不可见。此时直接按普通投影加载。
        const megaAvailable = megaRenderer.isEnabled() === true;
        
        let useMegaMode = false;
        let streamResult = null;
        
        if (megaAvailable) {
            try {
                if (!streamLoader) {
                    throw new Error('streamLoader is not initialized');
                }
                // .mcstructure 与 .litematic 的字节序/压缩/坐标顺序均不同，必须走各自的流式解析
                const ext = require('path').extname(fullPath).toLowerCase();
                if (ext === '.mcstructure') {
                    streamResult = await mcstructureLoader.prepareStream(fullPath);
                } else {
                    streamResult = await streamLoader.prepareStream(loader, fullPath);
                }
                if (streamResult && streamResult.totalEstimate > megaThreshold) {
                    useMegaMode = true;
                    logger.info(`[MegaSchematic] Auto-detected mega schematic: ${streamResult.totalEstimate} blocks (threshold: ${megaThreshold})`);
                }
            } catch (streamErr) {
                logger.error(`[MegaSchematic] Stream detection failed: ${streamErr.message}`);
                logger.info(`[MegaSchematic] Falling back to standard loading`);
            }
        } else {
            logger.info(`[MegaSchematic] mega 渲染未启用，大型投影回退普通加载: ${fullPath}`);
        }
        
        if (useMegaMode && streamResult) {
            if (player) {
                logger.info(`[MegaSchematic] 正在加载超大型投影 | 方块数: ${streamResult.totalEstimate || '?'}`);
            }
            
            try {
                const megaResult = await megaManager.loadMegaSchematic(
                    fullPath,
                    streamResult,
                    (blocks) => {
                        logger.info(`[MegaSchematic] Loading progress: ${blocks} blocks...`);
                    },
                    player
                );
                
                const path = require('path');
                let megaName = megaResult.meta.name;
                if (!megaName || megaName === 'Unknown' || megaName === 'Unnamed' || megaName.trim() === '') {
                    megaName = path.basename(fullPath, path.extname(fullPath)) || 'Unnamed';
                }

                const schematic = {
                    name: megaName,
                    author: megaResult.meta.author,
                    description: megaResult.meta.description || '',
                    dimensions: megaResult.meta.dimensions,
                    totalBlocks: megaResult.totalBlocks,
                    filePath: fullPath,
                    isMega: true,
                    schematicId: megaResult.schematicId,
                    version: megaResult.meta.version || 0,
                    timeCreated: megaResult.meta.timeCreated || null,
                    timeModified: megaResult.meta.timeModified || null,
                    blocks: [],
                    blockIndex: null,
                    blockChunks: null
                };
                
                logger.info(`[MegaSchematic] Loaded mega schematic: ${schematic.name}, ${megaResult.totalBlocks} blocks, ${megaResult.chunkCount} chunks`);
                return schematic;
            } catch (megaErr) {
                // mega 加载失败时回退普通加载，避免整个投影加载失败
                logger.warn(`[MegaSchematic] 加载失败，回退普通加载: ${megaErr.message}`);
            }
        }

        logger.info(`[LitematicaBE] Using standard loader for: ${fullPath}`);
        // .mcstructure 用独立加载器（小端 NBT + BE 方块直通），其余走原 .litematic 加载器
        const ext = require('path').extname(fullPath).toLowerCase();
        const schematic = (ext === '.mcstructure')
            ? await mcstructureLoader.load(fullPath)
            : await loader.load(fullPath);
        schematic.isMega = false;
        schematic.schematicId = null;
        schematic.version = schematic.version || 0;
        schematic.timeCreated = schematic.timeCreated || null;
        schematic.timeModified = schematic.timeModified || null;
        return schematic;
    } catch (e) {
        logger.error(`[LitematicaBE] Error loading file: ${e.message}`);
        if (player) {
            player.tell(`§c✗ 加载失败: ${e.message}`);
        }
        return null;
    }
}

function getSchematicFiles() {
    const files = [];
    if (!File.exists(SCHEMATIC_PATH)) {
        return files;
    }
    
    const fileList = File.getFilesList(SCHEMATIC_PATH);
    for (const f of fileList) {
        if (f.endsWith('.litematic') || f.endsWith('.mcstructure') || f.endsWith('.json')) {
            files.push(f.replace(SCHEMATIC_PATH, ''));
        }
    }
    return files;
}

function showProjectionInfo(player, output) {
    const playerData = dataManager.getPlayerData(player.xuid);
    const projectionId = playerData.currentProjectionId;
    
    if (!projectionId) {
        output.success("§c当前没有激活的投影");
        return;
    }
    
    const projection = dataManager.getProjection(projectionId);
    if (!projection) {
        output.success("§c投影不存在");
        return;
    }
    
    output.success("§6========== 投影信息 ==========");
    output.success(`§e名称: §f${projection.name}`);
    output.success(`§e位置: §f(${projection.position.x}, ${projection.position.y}, ${projection.position.z})`);
    output.success(`§e维度: §f${projection.dimension}`);
    output.success(`§e旋转: §f${projection.rotation}°`);
    output.success(`§e方块数: §f${projection.totalBlocks}`);
    output.success(`§e尺寸: §f${projection.dimensions?.x}x${projection.dimensions?.y}x${projection.dimensions?.z}`);
    output.success(`§e创建时间: §f${new Date(projection.createdAt).toLocaleString()}`);
    output.success(`§e超大型模式: §f${projection.isMega ? '是' : '否'}`);
    
    // 如果是Mega模式，显示额外调试信息
    if (projection.isMega && projection.schematicId) {
        const stateId = `${player.xuid}_${projection.schematicId}`;
        const debugInfo = megaRenderer.getDebugInfo(stateId);
        if (debugInfo) {
            output.success("§6========== Mega渲染调试 ==========");
            output.success(`§e调试模式: §f${debugInfo.config.debugMode}`);
            output.success(`§e渲染距离: §f${debugInfo.config.maxRenderDistance}`);
            output.success(`§e每tick粒子: §f${debugInfo.config.maxParticlesPerTick}`);
            output.success(`§e视口更新间隔: §f${debugInfo.config.viewportUpdateInterval}ms`);
            output.success(`§e目标LOD方块: §f~${debugInfo.config.targetLODBlocks}`);
            output.success(`§e存储格式: §f.mcmega`);
            output.success(`§e核心区配置: §f${debugInfo.config.coreChunkRadius * 2 + 1}×${debugInfo.config.coreChunkRadius * 2 + 1} 完整渲染`);
            output.success(`§e远处过滤率: §f${(debugInfo.config.farFilterRate * 100).toFixed(0)}%`);
        }
    }
}

/**
 * 处理调试命令
 */
function handleDebugCommand(player, args, output) {
    const subCommand = args[0]?.toLowerCase();
    
    switch (subCommand) {
        case 'mega':
        case 'megarender': {
            const enabled = args[1] === 'on' || args[1] === 'true';
            megaRenderer.setDebugMode(enabled);
            output.success(`§aMega渲染调试模式: §f${enabled ? '开启' : '关闭'}`);
            break;
        }
        
        case 'lod': {
            const enabled = args[1] === 'on' || args[1] === 'true';
            megaRenderer.setDebugMode(enabled);
            output.success(`§aLOD调试模式（已内置到 MegaRender）: §f${enabled ? '开启' : '关闭'}`);
            break;
        }
        
        case 'stats': {
            const playerData = dataManager.getPlayerData(player.xuid);
            const projectionId = playerData.currentProjectionId;
            
            if (!projectionId) {
                output.error("§c当前没有激活的投影");
                return;
            }
            
            const projection = dataManager.getProjection(projectionId);
            if (!projection || !projection.isMega) {
                output.error("§c当前投影不是超大型模式");
                return;
            }
            
            const stateId = `${player.xuid}_${projection.schematicId}`;
            const stats = megaRenderer.getStats(stateId);
            const debugInfo = megaRenderer.getDebugInfo(stateId);
            
            if (!stats) {
                output.error("§c无法获取渲染统计");
                return;
            }
            
            output.success("§6========== Mega渲染统计 ==========");
            output.success(`§e已缓存方块数: §f${stats.totalCachedBlocks || 0}`);
            output.success(`§e核心区方块: §f${stats.coreBlocks || 0}`);
            output.success(`§e远处过滤方块: §f${stats.farBlocks || 0}`);
            output.success(`§e总过滤方块: §f${stats.totalFilteredBlocks || 0}`);
            output.success(`§e已加载区块: §f${stats.loadedChunks}`);
            output.success(`§e可见区块: §f${stats.visibleChunks}`);
            output.success(`§e层模式: §f${stats.isLayerMode ? '是' : '否'}`);
            if (stats.isLayerMode) {
                output.success(`§e当前层: §f${stats.currentLayer}`);
            }

            if (debugInfo) {
                output.success("§6========== LOD分布 ==========");
                const st = debugInfo.stats;
                const total = (st.coreBlocks || 0) + (st.farBlocks || 0);
                const corePct = total > 0 ? ((st.coreBlocks / total) * 100).toFixed(1) : '0';
                const farPct = total > 0 ? ((st.farBlocks / total) * 100).toFixed(1) : '0';
                output.success(`§e核心区(3×3): §f${st.coreBlocks} (${corePct}%)`);
                output.success(`§e远处(30%): §f${st.farBlocks} (${farPct}%)`);
                output.success(`§e总计渲染: §f${total}`);
                output.success(`§e存储格式: §f.mcmega`);
            }
            break;
        }
        
        case 'config': {
            output.success("§6========== 当前配置 ==========");
            output.success(`§e视口更新间隔: §f${megaRenderer.viewportUpdateInterval}ms`);
            output.success(`§e每tick粒子: §f${megaRenderer.maxParticlesPerTick}`);
            output.success(`§e渲染距离: §f${megaRenderer.maxRenderDistance}`);
            output.success(`§e调试模式: §f${megaRenderer.debugMode}`);

            output.success("§6========== LOD配置 ==========");
            output.success(`§e目标LOD方块总数: §f~10000`);
            output.success(`§e核心区: §f3×3分块完整渲染`);
            output.success(`§e远处过滤率: §f保留30%`);
            output.success(`§e存储格式: §f.mcmega 二进制`);
            break;
        }
        
        default:
            output.success("§6========== 调试命令帮助 ==========");
            output.success("§e/lit debug mega <on|off> §f- 切换Mega渲染调试模式");
            output.success("§e/lit debug lod <on|off> §f- 切换LOD调试模式");
            output.success("§e/lit debug stats §f- 显示渲染统计");
            output.success("§e/lit debug config §f- 显示当前配置");
            break;
    }
}

function handleFailuresCommand(_player, output) {
    const stats = easyPlaceManager.getPlacementFailureStats();
    if (!stats) {
        output.success("§7暂无放置失败统计");
        return;
    }
    output.success("§6========== 一键放置失败统计 ==========");
    output.success(`§e总尝试: §f${stats.totalAttempts} §e失败: §f${stats.totalFailures} §e失败率: §f${stats.failureRate}`);
    output.success(`§e持续时间: §f${stats.sessionDuration}秒`);
    if (stats.topFailures && stats.topFailures.length > 0) {
        output.success("§c--- 失败最多的方块 (前20) ---");
        for (const f of stats.topFailures) {
            const javaShort = f.javaName.replace('minecraft:', '');
            const beShort = f.beName.replace('minecraft:', '');
            output.success(`§c${f.count}次 §f${javaShort} → §7${beShort} §f(${f.lastError})`);
        }
    }
    output.success("§7详细日志: plugins/LitematicaBE/logs/placement_failures_YYYY-MM-DD.log");
}

function listProjections(_player, output) {
    const projections = dataManager.getAllProjections();
    if (projections.length === 0) {
        output.success("当前没有放置的投影");
        return;
    }

    output.success(`当前共有 ${projections.length} 个投影:`);
    for (const proj of projections) {
        const author = mc.getPlayer(proj.author)?.name || "Unknown";
        output.success(`  - ${proj.name} (${proj.position.x}, ${proj.position.y}, ${proj.position.z}) by ${author}`);
    }
}

function handleRemoveCommand(player, projectionId, output) {
    if (!projectionId) {
        output.error("请指定投影ID");
        return;
    }

    const projection = dataManager.getProjection(projectionId);
    if (!projection) {
        output.error("投影不存在");
        return;
    }

    // 检查权限（只有创建者或OP可以删除）
    if (projection.author !== player.xuid && !player.isOP()) {
        output.error("你没有权限删除这个投影");
        return;
    }

    // ═══ 删除前先把世界清干净 ═══
    // MEGA 注入状态纯内存，强退/重启后内存会话消失，世界残留 ghost。
    // 现在的顺序：世界净空之前不删记录（保留撤销线索，玩家靠近后重新删除）。
    const purgeTargets = [];
    try {
        for (const onlinePlayer of mc.getOnlinePlayers()) purgeTargets.push(onlinePlayer);
    } catch (e) { /* 取在线玩家失败不阻塞删除 */ }
    try {
        // 离线玩家也有快照残留：把他们按 xuid 补进来（伪玩家对象足够：只用到 xuid）
        const loading = (typeof dataManager.getPlayersLoadingProjection === 'function')
            ? dataManager.getPlayersLoadingProjection(projectionId) : [];
        const seen = new Set(purgeTargets.map((p) => p && p.xuid));
        for (const xuid of loading) {
            if (!xuid || seen.has(xuid)) continue;
            const pl = mc.getPlayer(xuid);
            purgeTargets.push(pl || { xuid });
            seen.add(xuid);
        }
    } catch (e) { /* 忽略 */ }

    const purge = renderer.purgeProjection(purgeTargets, projection, { dimid: projection.dimension });
    if (!purge.ok) {
        output.error(`§c还有 §e${purge.remaining}§c 格投影未还原（区块未加载）—— 记录已保留`);
        output.success(`§7请靠近投影再执行一次 §f/litematica remove ${projectionId}`);
        output.success(`§7或先执行 §f/litematica ghost clean§7 清除无主 ghost `);
        return;
    }
    output.success(`§7清理世界：还原 §f${purge.restored}§7 格（会话 ${purge.sessions} / 期望 ${purge.expect} / MEGA状态 ${purge.megaStopped}）`);

    // 净空再动记录：先撤各玩家的会话与"已加载"记录，再删投影本身
    for (const onlinePlayer of mc.getOnlinePlayers()) {
        try {
            if (typeof renderer.isProjectionLoaded === 'function'
                && renderer.isProjectionLoaded(onlinePlayer, projectionId)) {
                renderer.cancelRender(onlinePlayer, projectionId);
            }
        } catch (e) {
            logger.warn(`[LitematicaBE] 撤销 ${onlinePlayer.name} 的投影 ${projectionId} 失败: ${e && e.message ? e.message : e}`);
        }
    }

    // 离线玩家的"已加载列表"也要摘掉，否则下次进服会恢复一个已删除的投影
    try {
        if (typeof dataManager.removeProjectionFromAllPlayers === 'function') {
            dataManager.removeProjectionFromAllPlayers(projectionId);
        }
    } catch (e) { /* 记录清理失败不影响删除本身 */ }

    dataManager.removeProjection(projectionId);
    output.success(`已删除投影: ${projection.name}`);
}

/**
 * /litematica select [序号|名称|ID]
 *
 * 多投影并存时，木剑（切层 / 旋转 / 建造）只作用于"当前控制"的那一份。
 * 不带参数时列出全部已加载投影与木剑当前控制目标。
 */
function handleSelectCommand(player, argText, output) {
    const list = (typeof renderer.getPlayerProjections === 'function')
        ? renderer.getPlayerProjections(player) : [];

    if (!list.length) {
        output.error("§c当前没有已加载的投影");
        output.success("§7用 §f/litematica load <名称>§7 或菜单加载，可同时加载多个");
        return;
    }

    const want = String(argText || '').trim();
    if (!want) {
        output.success("§6========== 已加载的投影 ==========");
        list.forEach((row, i) => {
            const tag = row.primary ? '§a← 木剑控制' : '§7       ';
            const mega = row.isMega ? ' §8[MEGA]' : '';
            const ly = row.layer < 0 ? '全部层' : `第 ${row.layer} 层`;
            output.success(`§7[${i + 1}] §f${(row.projection && row.projection.name) || row.id}${mega} ${tag} §8(${ly})`);
        });
        output.success("§7用法: §f/litematica select <序号|名称|ID>");
        return;
    }

    let hit = null;
    const num = Number(want);
    if (Number.isInteger(num) && num >= 1 && num <= list.length) hit = list[num - 1];
    if (!hit) hit = list.find(r => r.id === want);
    if (!hit) hit = list.find(r => ((r.projection && r.projection.name) || '') === want);
    if (!hit) hit = list.find(r => ((r.projection && r.projection.name) || '').includes(want));

    if (!hit) {
        output.error(`§c未找到已加载的投影: ${want}`);
        output.success("§7/litematica select §7查看序号");
        return;
    }

    renderer.setPrimaryProjection(player, hit.id, { notify: true });
    output.success(`§a木剑已切换到: §f${(hit.projection && hit.projection.name) || hit.id}`);
}

function handleVerifyCommand(player, output) {
    const activeProj = projManager.getActiveProjectionByPlayer(player);

    if (!activeProj || !activeProj.projection) {
        output.error("§c你没有正在操作的投影");
        output.success("§e请先放置投影");
        return;
    }

    const projection = activeProj.projection;
    output.success("§7正在验证投影...");

    let results;
    try {
        results = blockVerifier.verifyProjection(projection);
    } catch (e) {
        output.error("§c验证失败: " + e.message);
        return;
    }
    const matchPercent = results.total > 0 ? ((results.match / results.total) * 100).toFixed(1) : 0;

    output.success("§6========== 投影验证结果 ==========");
    output.success(`§e总方块数: §f${results.total}`);
    output.success(`§a完全匹配: §f${results.match} 个 (§a${matchPercent}%§f)`);
    output.success(`§e状态错误: §f${results.typeMatch} 个`);
    output.success(`§c错误方块: §f${results.noMatch} 个`);
    output.success(`§b缺失方块: §f${results.missing} 个`);

    // 多余方块检测
    if (projection.dimensions && projection.position) {
        const volume = projection.dimensions.x * projection.dimensions.y * projection.dimensions.z;
        if (volume <= 100000) {
            output.success("§7正在检测多余方块...");
            try {
                const extraResult = blockVerifier.detectExtraBlocks(projection);
                output.success(`§6多余方块: §f${extraResult.extraCount} 个 §7(扫描了 ${extraResult.totalScanned} 格)`);
            } catch (e) {
                output.success("§7多余方块检测跳过（投影区域过大）");
            }
        } else {
            output.success("§7提示：投影过大(>10万格)，使用 §f/lit verify §7命令仅显示基本验证");
            output.success("§7建议通过 GUI 菜单执行完整验证（含多余方块检测）");
        }
    }

    // 问题方块汇总
    const totalProblems = results.noMatch + results.typeMatch + results.missing;
    if (totalProblems > 0) {
        output.success(`§7问题方块合计: §f${totalProblems} 个`);
        if (totalProblems <= 10) {
            output.success("§7--- 问题方块列表 ---");
            for (const block of results.blocks) {
                const color = block.level === 1 ? "§c" : (block.level === 2 ? "§e" : "§b");
                output.success(`  ${color}(${block.position.x}, ${block.position.y}, ${block.position.z}) - ${block.levelName}`);
            }
        } else {
            output.success(`§7共 ${totalProblems} 个问题方块，建议通过 GUI 菜单查看详情`);
        }

        // 自动标记问题方块
        try {
            const marked = blockVerifier.markProblemBlocks(player, results.blocks, 15000);
            if (marked > 0) {
                output.success(`§a已自动标记 ${marked} 个问题方块（§c红=错误 §e黄=状态 §b蓝=缺失§r），持续15秒`);
            }
        } catch (e) {
            // 标记失败不影响主流程
        }
    } else {
        output.success("§a全部方块验证通过！");
    }
}

function handleMaterialsCommand(player, output) {
    const activeProj = projManager.getActiveProjectionByPlayer(player);

    if (!activeProj || !activeProj.projection) {
        output.error("§c你没有正在操作的投影");
        output.success("§e请先放置投影");
        return;
    }

    const projection = activeProj.projection;
    const filePath = materialCounter.generateExcel(projection, player);

    if (filePath) {
        output.success("§a材料清单已生成");
    }
}

// ==================== 事件监听 ====================

// 玩家加入
mc.listen("onJoin", (player) => {
    // 更新玩家数据
    const playerData = dataManager.getPlayerData(player.xuid);
    playerData.lastLogin = Date.now();
    dataManager.updatePlayerData(player.xuid, playerData);

    // 显示欢迎消息
    player.tell(`§a欢迎使用 ${PLUGIN_NAME} v${PLUGIN_VERSION}`);
    player.tell('§a基岩版服务器一站式投影集成工具');
    player.tell('§7手持木剑，蹲下点击即可打开菜单');

    // ═══ 退出重进后把投影接回来 ═══
    // 两条路：
    //   1. 内存里还留着保活会话（玩家掉线后又回来）→ 只 resume，零重写
    //   2. 会话已不在（服务器重启过）→ 按 playerData.loadedProjections 逐个重建，
    //      currentProjectionId 那一个是木剑控制目标
    try {
        let restored = false;
        try {
            restored = renderer.restoreForPlayer(player);
        } catch (e) {
            logger.warn(`[LitematicaBE] 恢复保活会话失败: ${e && e.message ? e.message : e}`);
        }

        if (restored) {
            const list = renderer.getPlayerProjections(player);
            const names = list.map(t => (t.projection && t.projection.name) || t.id);
            player.tell(`§a已恢复 §f${list.length}§a 个投影：§f${names.join('§7、§f')}`);
            const primary = list.find(t => t.primary);
            if (primary) player.tell(`§7木剑控制：§f${(primary.projection && primary.projection.name) || primary.id}`);
        } else {
            const pd = dataManager.getPlayerData(player.xuid) || {};
            const wanted = Array.isArray(pd.loadedProjections) ? pd.loadedProjections.slice() : [];
            if (pd.currentProjectionId && !wanted.includes(pd.currentProjectionId)) {
                wanted.push(pd.currentProjectionId);
            }
            const restoredIds = [];
            const missingIds = [];
            for (const pid of wanted) {
                const projection = dataManager.getProjection(pid);
                if (!projection) { missingIds.push(pid); continue; }
                const lay = (pd.projectionLayers && Number.isFinite(pd.projectionLayers[pid]))
                    ? pd.projectionLayers[pid]
                    : (Number.isFinite(pd.currentRenderLayer) ? pd.currentRenderLayer : -1);
                // primary:false + persist:false → 逐个恢复，最后一次性确定木剑控制并落盘
                // （中途落盘会把还没恢复的投影的层记录覆盖掉）
                const ok = renderer.startRender(player, projection, lay, { primary: false, persist: false });
                if (ok) {
                    restoredIds.push(pid);
                    logger.info(`[LitematicaBE] ${player.name} 重进恢复投影 ${pid}（层 ${lay}）`);
                }
            }

            // 木剑控制：优先 currentProjectionId，其次最后加载的那一个
            const preferPrimary = (pd.currentProjectionId && restoredIds.includes(pd.currentProjectionId))
                ? pd.currentProjectionId
                : (restoredIds.length ? restoredIds[restoredIds.length - 1] : null);
            if (preferPrimary && typeof renderer.setPrimaryProjection === 'function') {
                renderer.setPrimaryProjection(player, preferPrimary, { persist: true });
            }

            if (restoredIds.length) {
                const shown = restoredIds.map(id => {
                    const pj = dataManager.getProjection(id);
                    return (pj && pj.name) || id;
                });
                player.tell(`§a已恢复 §f${restoredIds.length}§a 个投影：§f${shown.join('§7、§f')}`);
                const pj = preferPrimary ? dataManager.getProjection(preferPrimary) : null;
                player.tell(`§7木剑控制：§f${(pj && pj.name) || preferPrimary}`);
            }

            if (missingIds.length) {
                for (const pid of missingIds) {
                    try { dataManager.removeProjectionFromAllPlayers(pid); } catch (e) { /* 已删的投影清记录失败不影响进服 */ }
                }
                const rest = Array.isArray(pd.loadedProjections) ? pd.loadedProjections.filter(id => !missingIds.includes(id)) : [];
                if (!rest.length) {
                    dataManager.updatePlayerData(player.xuid, { currentProjectionId: null });
                    player.tell('§7上次的投影已被删除，记录已清理');
                } else {
                    player.tell(`§7有 §f${missingIds.length}§7 个投影已被删除，其余照常恢复`);
                }
            }

            if (!restoredIds.length) {
                // 没有恢复记录（首进 / 上次被清掉）但有投影：给一条可操作的提示，
                // 别让玩家以为投影丢了 —— 记录在 projections.json 里，重新放置即可。
                let n = 0;
                let sample = '';
                try {
                    const all = dataManager.getAllProjections ? dataManager.getAllProjections() : [];
                    n = all.length;
                    if (n) sample = all[n - 1].name || all[n - 1].id;
                } catch (e) { /* 拿不到就不提示 */ }
                if (n > 0) {
                    player.tell(`§7你有 §f${n}§7 个投影记录（最近的：§f${sample}§7）`);
                    player.tell('§7用 §f/litematica§7 打开菜单重新放置即可；超大投影需要重新放置才会注入分块');
                }
            }
        }

        // 没有恢复出任何投影，但快照/期望账本里还保留着上一次的 ghost（强退、重启、或上次的投影已被删）：直接清掉。
        // reclaimOrphans 会跳过内存里还活着的会话，不会误伤正在显示的投影。
        const activeCount = (typeof renderer.getPlayerProjections === 'function')
            ? renderer.getPlayerProjections(player).length : 0;
        if (activeCount === 0 && !renderer.activeProjections.has(player.xuid)) {
            try {
                const orph = renderer.reclaimOrphans(player);
                if (orph.sessions || orph.expect) {
                    logger.info(`[LitematicaBE] ${player.name} 进服清理残留 ghost：期望 ${orph.expect} 格 / 会话 ${orph.sessions} 个 / 还原 ${orph.restored} 格 / 残留 ${orph.remaining}`);
                    player.tell(`§7已清理上次残留的 ghost：还原 §f${orph.restored}§7 格`
                        + (orph.remaining ? `，还有 §f${orph.remaining}§7 格因区块未加载暂缓（靠近该区域再执行 §f/litematica ghost clean§7）` : ''));
                }
            } catch (e) {
                logger.warn(`[LitematicaBE] ${player.name} 进服清理残留失败: ${e && e.message ? e.message : e}`);
            }
        }

        // 进服时附近的区块一定已加载，补一轮当时没加载的 ghost
        const r = ghostRenderer.retryPending();
        if (r && r.placed) logger.info(`[LitematicaBE] ${player.name} 进服补写 ghost ${r.placed} 格（剩余 ${r.remaining}）`);
        if (r && r.blocked && r.blocked.remaining) {
            logger.info(`[LitematicaBE] ${player.name} 进服检查被挡住的格：${r.blocked.placed} 格已补写，${r.blocked.remaining} 格仍被方块占据`);
        }
    } catch (e) {
        logger.warn(`[LitematicaBE] 进服恢复投影异常: ${e && e.message ? e.message : e}`);
    }
});

// ═══ 玩家挖掉"挡住投影"的那格 → 立刻补 ghost ═══
mc.listen("onDestroyBlock", (player, block) => {
    try {
        const p = (block && block.pos) ? block.pos : block;
        if (!p || typeof p.x !== 'number') return;
        const dimid = (typeof p.dimid === 'number')
            ? p.dimid
            : ((player && player.pos && typeof player.pos.dimid === 'number') ? player.pos.dimid : 0);
        setTimeout(() => {
            try {
                const r = ghostRenderer.retryBlockedAt(p.x, p.y, p.z, dimid);
                if (r === 'placed' && player && player.tell) {
                    player.tell(`§7投影补齐：§f(${p.x}, ${p.y}, ${p.z})`);
                }
            } catch (e) {
                logger.debug(`[LitematicaBE] blocked 定点补写失败: ${e && e.message ? e.message : e}`);
            }
        }, 1);
    } catch (e) { /* 破坏事件异常不能影响玩家 */ }
});

// 玩家离开
mc.listen("onLeft", (player) => {
    // ═══ 会话保活 ═══
    try {
        const kept = renderer.suspendPlayer(player);
        if (kept) {
            const list = (typeof renderer.getPlayerProjections === 'function')
                ? renderer.getPlayerProjections(player) : [];
            const ids = list.map(t => t.id).join(', ');
            logger.info(`[LitematicaBE] ${player.name} 离线，会话保活`
                + `（投影 ${ids || '?'}，共 ${list.length} 个，30 分钟内回来可直接恢复）`);
        }
    } catch (e) {
        logger.warn(`[LitematicaBE] 会话保活失败，退回撤销: ${e && e.message ? e.message : e}`);
        try { renderer.clearPlayerProjection(player); } catch (e2) { /* 兜底也失败就交给 prune */ }
    }

    // Mega 注入状态是纯内存的，必须逐个回收（不能只看主控那一个）
    try {
        const list = (typeof renderer.getPlayerProjections === 'function')
            ? renderer.getPlayerProjections(player) : [];
        for (const row of list) {
            const proj = row.projection;
            if (!proj || !proj.schematicId) continue;
            const stateId = (typeof megaRenderer.stateIdFor === 'function')
                ? megaRenderer.stateIdFor(player, proj)
                : `${player.xuid}_${proj.schematicId}`;
            if (stateId) megaRenderer.stopRender(stateId);
        }
    } catch (e) {
        logger.warn(`[LitematicaBE] 回收 MEGA 注入状态失败: ${e && e.message ? e.message : e}`);
    }
    projManager.removeActiveProjection(player.xuid);
    playerSessions.delete(player.xuid);
    // 清掉打印机/轻松放置按 xuid 攒的状态（否则离线玩家的 tick 空转、提示标记被永久吃掉）
    try { easyPlaceManager.onPlayerLeave(player); } catch (e) { /* 清理失败不影响其他离线逻辑 */ }
    // 清理选区状态
    if (selectionTool) selectionTool.cleanup(player.xuid);
});

// ═══════════════════ 版本更新检查（启动时一次） ═══════════════════
//   · src/net/UpdateChecker.js 在 Node 的 http(s) 回调里**只写纯数据**（没有 EngineScope，碰 logger 会抛 "call engine APIs without a ::script::EngineScope"，
//     抛出点在事件循环里，容易把服务端带走）。它全程零日志。
//   · 打印必须回到主线程，即下方的 tick 任务。
// 整个功能只有三件事：onServerStarted 发起一次 → 取结果 → 打一行日志。

/** 日志前缀（用户可见文案的一部分，改这里会影响两行提示） */
const UPDATE_LOG_TAG = '[LitematicaBE]';

let updateCheckFired = false;

/** 发起一次检查（幂等）。updateCheck.enabled=false 时什么都不做。 */
function startUpdateCheck() {
    if (updateCheckFired) return false;
    if (!updateChecker.isEnabled()) return false;
    updateCheckFired = true;
    return updateChecker.checkOnce();
}

/** 调度器任务：结果一出来就打日志，然后把自己摘掉（一次性任务） */
function drainUpdateCheck() {
    const r = updateChecker.takeResult();
    if (!r) return;
    renderScheduler.remove('update-check');

    // 文案由 UpdateChecker.formatLogLine 统一生成（纯函数、可单测）：
    //   「[LitematicaBE]发现新版本vX.Y.Z，前往<主页>以了解更多」
    //   「[LitematicaBE]当前已是最新版本」
    //   「[LitematicaBE]版本检查失败：…」
    const line = formatLogLine(r, { tag: UPDATE_LOG_TAG, home: updateChecker.homeUrl() });
    if (!line) return;
    if (r.status === 'update' || r.status === 'error') logger.warn(line);
    else logger.info(line);
}

// ==================== 初始化 ====================

registerCommands('load');

// 命令系统在 onServerStarted 才完全就绪：加载期注册失败的在这里补一次，成功的不会重复注册
mc.listen('onServerStarted', () => {
    registerCommands('serverStarted');
    // 版本更新检查：到这里才算插件被激活、服务端已启动，检查一次就结束
    // （结果由调度器的 update-check 任务在主线程打印，网络回调里没有 EngineScope）。
    startUpdateCheck();
    // HTTP 上传站：此刻端口/工作目录才可靠。启动失败（端口占用、运行时无 HttpServer）
    // 只打 warn，插件其余功能必须照常运行。
    try {
        webServer.start();
    } catch (e) {
        logger.warn(`[LitematicaBE] 上传站启动异常: ${e && e.message ? e.message : e}`);
    }
    // 此刻工作目录与世界才真正就绪：再校验一次 addon 版本（部署侧路径这时才可靠）
    giCheckWiring();
    // 世界已就绪，但此刻目标区块通常尚未加载进内存（附近无玩家），setBlock 会全部失败。
    // 因此延后 3 秒再补写一次，失败的格进入 GhostGuard 的待恢复队列，由重试链与 tickingarea 兜底。
    setTimeout(() => {
        // 先把上次异常退出留下的快照处理掉，再补 ghost 期望。
        // shouldRestore 的判据是"期望集合已不认这一格"——说明上次撤销只做了一半；
        // 期望仍认的格属于正常投影（重启后本来就该补回），绝不能在这里还原掉。
        //
        // 例外：MEGA 投影。它的注入状态（MegaProjectionRenderer.renderStates）只活在内存里，
        // 重启后没有任何东西能接管那些 ghost —— 若照普通投影那样"保留 + 补齐"，世界里就会
        // 永久留着一片 ghost，玩家进服看不到"已加载"、也没有会话可以撤销。所以先把 MEGA
        // 会话的期望记录删掉，再让 restoreOrphaned 无条件还原它们（玩家重进后重新加载投影即可）。
        try {
            const n = worldSnapshot.forEachSessionBlock(
                (s) => WorldSnapshot.isMegaSession(s),
                (dimid, x, y, z) => {
                    ghostExpect.del(dimid, x, y, z);
                    if (typeof ghostGuard.forget === 'function') ghostGuard.forget(dimid, x, y, z);
                }
            );
            if (n) {
                ghostExpect.flush();
                logger.info(`[LitematicaBE] MEGA 残留会话：清理期望 ${n} 格`);
            }
        } catch (e) {
            logger.warn(`[LitematicaBE] MEGA 残留期望清理失败: ${e && e.message ? e.message : e}`);
        }
        try {
            // 汇总日志由 WorldSnapshot.restoreOrphaned 内部统一输出（含 跳过/失败/残留），
            // 这里不再重复打一行，否则同一次清理会在控制台出现两条数字相同的汇总。
            worldSnapshot.restoreOrphaned({
                restoreMega: true,
                shouldRestore: (dimid, x, y, z) => !ghostExpect.get(dimid, x, y, z),
            });
        } catch (e) {
            logger.warn(`[LitematicaBE] 快照无主会话清理失败: ${e && e.message ? e.message : e}`);
        }
        try {
            ghostGuard.restoreAll('serverStarted');
        } catch (e) {
            logger.warn(`[LitematicaBE] ghost 期望补齐失败: ${e && e.message ? e.message : e}`);
        }
    }, 3000);
});

// 卸载/热重载时释放 HTTP 端口，避免旧 socket 把端口占死导致下次 start 失败
if (typeof ll !== 'undefined' && ll && typeof ll.onUnload === 'function') {
    try {
        ll.onUnload(() => {
            try { webServer.stop(); } catch (e) { /* 卸载期静默 */ }
        });
    } catch (e) {
        logger.warn(`[LitematicaBE] 注册 onUnload 失败: ${e && e.message ? e.message : e}`);
    }
}

// 导出加载函数供UI使用（必须在函数定义之后）
global.loadSchematicFile = loadSchematicFile;

logger.info(`${PLUGIN_NAME} v${PLUGIN_VERSION} Loaded!`);

// Ghost 子系统状态（渲染走这条路；此处先打印可用性）
function logGhostRegistryStatus() {
    const gs = ghostRegistry.stats();
    if (gs.ready) {
        logger.info(`[LitematicaBE] Ghost 注册表就绪: addon ${(gs.addonVersion || []).join('.')}, ${gs.blockCount} 种定义, javaMap ${gs.javaMapCount} 条`);
        const st = gs.javaMapStats;
        if (st) {
            logger.info(`[LitematicaBE] ghost 命中 ${st.mapped}/${st.total}，其余回落 ${gs.genericId}`);
        }
    } else {
        logger.warn(`[LitematicaBE] Ghost 注册表不可用: ${gs.loadError || '未知'}`);
        logger.warn('[LitematicaBE] 请确认已部署 ghost addon 且 data/ghost_index.json 存在');
    }
}

logGhostRegistryStatus();
const addonSummary = addonCheck.summary();
logger.info(`[LitematicaBE] addon 版本校验: ${addonSummary.state}${addonSummary.enabled ? '（ghost 写入可用）' : '（ghost 写入已禁用）'}`);
const ucOn = updateChecker.isEnabled();
logger.info(`[LitematicaBE] 版本更新检查: ${ucOn
    ? `已开启（${updateChecker.repo()}，服务端启动时检查）`
    : '已关闭（updateCheck.enabled=false）'}`);
const snapStats = worldSnapshot.stats();
logger.info(`[LitematicaBE] 快照: ${snapStats.sessions} 个未还原会话 / ${snapStats.blocks} 格 / 目录 ${snapStats.dir}`);
logger.info(`Commands: ${Array.from(registeredCommands).join(', ') || '(none)'}`);
logger.info("Use wooden sword to operate");