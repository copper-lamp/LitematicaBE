// Litematica BE v3.0.0 review - Minecraft Bedrock Edition Projection Tool
// 全服共享投影系统，支持木剑操作、多模式切换

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

// 导入超大型投影模块
const { MegaSchematicManager } = require('./src/core/MegaSchematicManager');
const { StreamingLitematicLoader } = require('./src/core/StreamingLitematicLoader');
const { MegaProjectionRenderer } = require('./src/render/MegaProjectionRenderer');
const { BinaryChunkStorage } = require('./src/core/BinaryChunkStorage');

// Ghost 子系统
const { GhostBlockRegistry } = require('./src/ghost/GhostBlockRegistry');
const { GhostGuard } = require('./src/ghost/GhostGuard');
const { GhostProbe } = require('./src/ghost/GhostProbe');
const { GhostExpectStore } = require('./src/ghost/GhostExpectStore');
const { AddonVersionCheck } = require('./src/ghost/AddonVersionCheck');
const { GhostSelfCheck } = require('./src/ghost/GhostSelfCheck');
const { GhostRenderer } = require('./src/ghost/GhostRenderer');
const { RenderScheduler } = require('./src/render/RenderScheduler');
const { WorldSnapshot } = require('./src/world/WorldSnapshot');

ll.registerPlugin(
    "LitematicaBE",
    "Minecraft Bedrock Edition projection tool with shared projections",
    [3, 0, 0],
    {}
);

// 配置管理器（最先初始化，供其他模块使用）
const configManager = new ConfigManager();
const PLUGIN_VERSION = '3.0.0';
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

const easyPlaceManager = new EasyPlaceManager(projManager, dataManager, megaManager);

// 选区工具和保存器实例
const selectionTool = new SelectionTool();
const schematicSaver = new SchematicSaver();

// 验证器和材料统计器实例
const blockVerifier = new BlockVerifier();
const materialCounter = new MaterialCounter();

// Ghost 子系统
// 期望集合：记录"这一格应该有 ghost"，是玩家盖方块→破坏后能自动补回的唯一依据
// 默认落在 plugins/LitematicaBE/data/ghost_expect.json（与本文件的相对位置固定）
const ghostRegistry = new GhostBlockRegistry();
const ghostExpect = new GhostExpectStore({ logger }).load();
const ghostGuard = new GhostGuard(ghostRegistry);
// P2.3：addon 与插件版本一致性校验。不一致时只关 ghost 写入，投影/粒子/easyplace 全部照常
const addonCheck = new AddonVersionCheck({ logger });

// 写世界前的原方块快照（data/sessions/）。启动时先收拾上次异常退出留下的会话，
// 再补 ghost —— 顺序不能反：先还原成"原来的世界"，再按期望集合重放 ghost。
// 注意创建顺序：GhostProbe 要用它做"先备再写"，所以必须在 ghostProbe 之前建。
const worldSnapshot = new WorldSnapshot({
    logger,
    isGhost: (t) => ghostRegistry.isGhost(t),
}).load();

// P3.2：探针铺墙前逐格 record()，undo 走 snapshot.close()
const ghostProbe = new GhostProbe(ghostRegistry, ghostExpect, addonCheck, worldSnapshot);

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

// 投影会话层不在这里显式 attach：ProjectionRenderer 的 _gr() 会惰性取 global.ghostRenderer，
// 这样 docs/renderer-contract.md §5 的 8 项外部访问基线不会被装配细节污染。

// /litematica selfcheck —— 一条命令验证"读原状→快照→写幽灵→读回→撤销"整条链路
const ghostSelfCheck = new GhostSelfCheck({
    registry: ghostRegistry,
    addonCheck,
    snapshot: worldSnapshot,
    logger,
});
ghostGuard.install({ expectStore: ghostExpect, logger });
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
global.blockVerifier = blockVerifier;
global.materialCounter = materialCounter;
global.ghostRegistry = ghostRegistry;
global.ghostGuard = ghostGuard;
global.ghostProbe = ghostProbe;
global.ghostExpect = ghostExpect;
global.addonCheck = addonCheck;
global.worldSnapshot = worldSnapshot;
global.ghostSelfCheck = ghostSelfCheck;
global.ghostRenderer = ghostRenderer;

// 超大型投影全局导出
global.megaManager = megaManager;
global.streamLoader = streamLoader;
global.megaRenderer = megaRenderer;

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
    // 3.0.0 review 决策：超大投影暂不启用（等后续优化），任务留着但默认关
    enabled: !!megaRenderer.enabled,
});
renderScheduler.add('actionbar', () => uiManager.updateActionBars(), { everyTicks: 2, priority: 60 });
renderScheduler.add('debug-flush', () => megaRenderer.flushLogs(), { everyMs: 5000, priority: 80 });
renderScheduler.add('log-cleaner', () => {
    // cleanRenderLogs 是 async：同步 try/catch 抓不到 reject，必须自己兜住
    try {
        const p = logCleaner.cleanRenderLogs();
        if (p && typeof p.catch === 'function') p.catch(() => { });
    } catch (e) { /* 清理失败不影响主循环 */ }
}, { everyMs: 60000, priority: 90 });
renderScheduler.start();

// 调度器就绪后再启动日志自动清理（LogCleaner 构造期不再自己 setInterval）
try {
    logCleaner.startAutoClean();
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
        
        // 木剑的几种可能名称
        return itemType.includes('wooden_sword') || 
               itemType === 'sword' || 
               itemType === 'minecraft:wooden_sword';
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

// 方法1: onUseItemOn - 在放置前拦截（用于取消/替换手持物品）
mc.listen("onUseItemOn", (player, item, block, side, pos) => {
    const enabled = easyPlaceManager.isEnabled(player);
    if (!enabled) return true;
    if (!item) return true;
    const result = easyPlaceManager.handleUseItemOn(player, item, block, side, pos);
    return result;
});

// 方法2: afterPlaceBlock - 在放置后检测并修正（更可靠）
// 注意：correctionEnabled 开关在 correctBlockPlacement 内部判断
mc.listen("afterPlaceBlock", (player, block) => {
    easyPlaceManager.correctBlockPlacement(player, block);
});

// ==================== 木剑操作事件监听 ====================

// 监听使用物品事件
mc.listen("onUseItemOn", (player, item, block, side, pos) => {
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
// 注意：onClick 事件在 LeviLamina 中可能不可用，使用 onUseItemOn 代替

// ==================== 模式处理函数 ====================

/**
 * 处理放置模式
 */
function handlePlaceMode(player, block, pos, session) {
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
    
    const isMegaPlace = schematic.isMega && schematic.schematicId;
    
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
        megaRenderer.initRenderState(player, schematic.schematicId, projection);
        logger.info('[LitematicaBE] 已启用超大型投影渲染模式');
        renderer.layerRenderMode.set(player.xuid, false);
        renderer.currentRenderLayer.set(player.xuid, -1);
        renderer.startRender(player, projection, -1);
    } else {
        renderer.layerRenderMode.set(player.xuid, false);
        renderer.currentRenderLayer.set(player.xuid, -1);
        renderer.startRender(player, projection);
    }

    player.tell(`投影已放置: ${projection.name}`);
    player.tell(`位置: (${projection.position.x}, ${projection.position.y}, ${projection.position.z})`);
    player.tell(`方块数: ${projection.totalBlocks}`);
    player.tell(`已自动切换到建造模式`);
    player.tell(`抬头/低头+木剑切换层，平视切换显示`);
}

/**
 * 处理旋转模式
 */
function handleRotateMode(player, session) {
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

    renderer.clearPlayerProjection(player);

    activeProj.projection.rotation = (activeProj.projection.rotation + 90) % 360;
    activeProj.lastUpdate = Date.now();

    renderer.startRender(player, activeProj.projection, activeProj.renderLayer);

    player.tell(`§a投影已旋转到 ${activeProj.projection.rotation}°`);
}

/**
 * 处理建造模式 - 逐层渲染
 */
function handleBuildMode(player, session) {
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

        // 默认关闭逐层
        renderer.layerRenderMode.set(player.xuid, false);
        renderer.currentRenderLayer.set(player.xuid, -1);
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
        const isMegaProj = result.projection.isMega && result.projection.schematicId;

        if (isMegaProj) {
            // 超大型投影：Mega 管理分层过滤，ProjectionRenderer 统一渲染
            const stateId = `${player.xuid}_${result.projection.schematicId}`;
            // 设置 Mega 层模式（标记 _needsSync，下个 tick 自动同步）
            megaRenderer.setLayerMode(stateId, newLayer);
            // ProjectionRenderer 同步层信息（用于 respawn）
            renderer.currentRenderLayer.set(player.xuid, newLayer);
            renderer.layerRenderMode.set(player.xuid, newLayer >= 0);
            // 清除旧粒子
            renderer.clearPlayerProjection(player);
            // 注意：不要调用 renderer.startRender，MegaProjectionRenderer.onTick 会处理渲染

            if (newLayer === -1) {
                const totalBlocks = result.projection.totalBlocks || 0;
                player.tell(`§a显示全部层 §7(${totalBlocks} 方块)`);
            } else {
                player.tell(`§a当前层: §e${newLayer} §7/ ${result.projection.dimensions?.y || 1}`);
            }
        } else {
            // 普通投影渲染
            renderer.currentRenderLayer.set(player.xuid, newLayer);
            renderer.layerRenderMode.set(player.xuid, true);
            renderer.clearPlayerProjection(player);
            renderer.startRender(player, result.projection, newLayer);

            const info = projManager.getLayerInfo(result.projection, newLayer);
            if (newLayer === -1) {
                player.tell(`§a显示全部层 §7(${info.totalBlocks} 方块)`);
            } else {
                player.tell(`§a当前层: §e${newLayer} §7/ ${info.totalLayers}`);
                player.tell(`§7本层方块: §f${info.currentLayerBlocks}`);
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
            logger.info(`[LitematicaBE] 命令 ${label} 已注册`);
            return true;
        }
        logger.warn(`[LitematicaBE] 命令 ${label} 注册失败: setup() 返回 false`);
        return false;
    } catch (e) {
        logger.warn(`[LitematicaBE] 命令 ${label} 注册异常: ${e.message}`);
        return false;
    }
}

/** ghost 子动作分派：主命令 `/litematica ghost` 与独立命令 `/litematica:ghost` 共用同一套逻辑 */
function dispatchGhost(player, sub) {
    if (!player) return false;
    const s = String(sub === undefined || sub === null ? '' : sub).trim().toLowerCase();
    if (s === 'undo') return ghostProbe.undo(player);
    if (s === 'info') {
        const ok = ghostProbe.info(player);
        // 追加会话级诊断：有多少格正被原地形挡住（挖掉会自动补，但玩家要知道）
        try {
            const sum = ghostRenderer.summary();
            if (sum.sessions) {
                player.tell(`§7会话 §f${sum.sessions}§7 个 / 待补 §f${sum.pending}§7 格`
                    + ` / 被原地形挡住 §f${sum.blocked}§7 格（挖掉后自动补，已补 §f${sum.counters.blockedPlaced || 0}§7 格）`);
                for (const it of sum.list) {
                    if (!it.blocked && !it.pending) continue;
                    player.tell(`§7  · §f${it.name || '?'}§7 层 §f${it.layer}§7：已写 §f${it.placed}`
                        + `§7，挡住 §f${it.blocked}§7，待补 §f${it.pending}`);
                }
            }
        } catch (e) { /* 诊断失败不影响 info 本身 */ }
        return ok;
    }
    if (s === 'restore') {
        if (!addonCheck.isEnabled()) {
            player.tell('§cghost 写入已禁用：addon 与插件版本不一致（详见 /litematica:ghost info）');
            return false;
        }
        const r = ghostGuard.restoreAll('manual');
        player.tell(`§a期望补齐：补写 §e${r.placed} §a格 / 已有方块跳过 §e${r.skipped} §a格 / 待重试 §e${r.failed}§a（共 ${r.total} 格）`);
        if (!r.total) player.tell('§7期望集合为空：先 /litematica:ghost 铺墙');
        if (r.failed) {
            player.tell(`§7待恢复队列现有 ${ghostGuard.summary().pending} 格；区块未加载是主因，靠近该区域或站在旁边再执行一次即可`);
        }
        return true;
    }
    return ghostProbe.lay(player);
}

function buildMainCommand() {
    const cmd = mc.newCommand("litematica", "Litematica projection tool", PermType.Any, 0x80);

    cmd.setEnum("ActionEnum", ["menu", "load", "place", "placeat", "rotate", "build", "easyplace", "printer", "correction", "verify", "materials", "clear", "list", "remove", "info", "debug", "save", "failures", "ghost", "selfcheck"]);

    // 重载铁律（1.1.1 的故障根因）：
    //   1. mandatory 参数必须出现在每一条重载里，`overload([])` 会让整条命令注册失败；
    //   2. RawText「只能作为最后一个参数」，而且只能有一个 —— 原来 filename 与 args
    //      都是 RawText，等于两条形态相同的重复重载，同样会被 BDS 拒收。
    cmd.mandatory("action", ParamType.Enum, "ActionEnum", 1);
    cmd.optional("x", ParamType.Int);
    cmd.optional("y", ParamType.Int);
    cmd.optional("z", ParamType.Int);
    // RawText 必须最后声明，也必须是重载里的最后一项（见 LSE 命令 API 的参数类型表）
    cmd.optional("args", ParamType.RawText);

    cmd.overload(["ActionEnum"]);
    cmd.overload(["ActionEnum", "args"]);
    cmd.overload(["ActionEnum", "x", "y", "z"]);

    cmd.setCallback((cmd, origin, output, results) => {
        const player = origin.player;
        if (!player) {
            output.success("This command must be used by a player");
            return;
        }

        const action = results.action;
        // 自由文本统一走 args；filename 是 1.1.1 遗留的重载参数名，这里做兼容读取
        const argText = (results.args !== undefined && results.args !== null) ? results.args : results.filename;

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
                handlePlaceAtCommand(player, results.x, results.y, results.z, output);
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
                // clearPlayerProjection 内部已经连同"重进自动恢复"的记录一起清掉
                renderer.clearPlayerProjection(player);
                // 先获取活动投影信息，再删除
                const activeForClear = projManager.getActiveProjection(player.xuid);
                if (activeForClear && activeForClear.projection && activeForClear.projection.schematicId) {
                    megaRenderer.stopRender(`${player.xuid}_${activeForClear.projection.schematicId}`);
                }
                projManager.removeActiveProjection(player.xuid);
                output.success("§a已清除当前投影显示");
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
    });

    return cmd;
}

function buildShortCommand() {
    const cmdShort = mc.newCommand("lit", "Litematica (Short)", PermType.Any, 0x80);
    // 短命令原来直接 setup、从未声明过重载；LSE 要求至少一条重载，否则 /lit 不可执行
    cmdShort.overload([]);
    cmdShort.setCallback((cmd, origin, output, results) => {
        const player = origin.player;
        if (player) {
            uiManager.showMainMenu(player);
        }
    });
    return cmdShort;
}

function buildLogCleanCommand() {
    // 日志清理命令
    const cmdLogClean = mc.newCommand("litematica:logclean", "Clean render logs", PermType.Any, 0x80);
    cmdLogClean.setEnum("LogCleanAction", ["status", "clean", "config"]);
    cmdLogClean.mandatory("action", ParamType.Enum, "LogCleanAction", 1);
    cmdLogClean.overload(["LogCleanAction"]);
    cmdLogClean.setCallback((cmd, origin, output, results) => {
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
    cmdConfig.setCallback((cmd, origin, output, results) => {
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
                    player.tell("§7示例: /litematica:config get render.opacity");
                }
                break;
        }
    });
    return cmdConfig;
}

/**
 * ghost 验证探针的独立命令入口。
 */
function buildGhostCommand() {
    const cmdGhost = mc.newCommand("litematica:ghost", "Ghost block probe (P1.5 verification)", PermType.Any, 0x80);
    cmdGhost.setEnum("GhostAction", ["lay", "undo", "info", "restore"]);
    cmdGhost.mandatory("action", ParamType.Enum, "GhostAction", 1);
    cmdGhost.overload(["GhostAction"]);
    cmdGhost.setCallback((cmd, origin, output, results) => {
        const player = origin.player;
        if (!player) {
            output.success("This command must be used by a player");
            return;
        }
        dispatchGhost(player, results.action);
    });
    return cmdGhost;
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

    const okList = Array.from(registeredCommands);
    logger.info(`[LitematicaBE] 命令注册(${reason}): ${okList.length}/5 条可用 [${okList.join(', ')}]`);
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
        
        const isMega = schematic.isMega && schematic.schematicId;
        
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
            megaRenderer.initRenderState(player, schematic.schematicId, projection);
            logger.info('[LitematicaBE] 已启用超大型投影渲染模式');
            renderer.layerRenderMode.set(player.xuid, false);
            renderer.currentRenderLayer.set(player.xuid, -1);
            renderer.showBounds(projection, player);
        } else {
            renderer.layerRenderMode.set(player.xuid, false);
            renderer.currentRenderLayer.set(player.xuid, -1);
            renderer.showBounds(projection, player);
            renderer.startRender(player, projection, -1);
        }

        output.success(`投影已放置: ${schematic.name}`);
        output.success(`位置: (${placePos.x}, ${placePos.y}, ${placePos.z})`);
        output.success(`方块数: ${schematic.totalBlocks}`);
        output.success(`当前层: 0 / ${projection.dimensions?.y || 1}`);
        output.success(`使用 /lit build 切换到建造模式`);
    }).catch(err => {
        logger.error(`[LitematicaBE] loadSchematicFile error: ${err.message}`);
        output.error(`§c加载失败: ${err.message}`);
    });
}

/**
 * 在指定坐标放置投影
 */
function handlePlaceAtCommand(player, x, y, z, output) {
    if (x === undefined || y === undefined || z === undefined) {
        output.error("§c缺少坐标");
        output.success("§f用法: /litematica placeat <x> <y> <z>");
        output.success("§f示例: /litematica placeat 100 64 200");
        return;
    }
    
    const session = getPlayerSession(player.xuid);
    
    const schematic = session.selectedSchematic;
    
    if (!schematic) {
        output.error("§c没有加载的原理图");
        output.success("§f打开gui或使用 /litematica load <文件名>");
        return;
    }
    
    const placePos = { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
    
    const isMega2 = schematic.isMega && schematic.schematicId;
    
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
        megaRenderer.initRenderState(player, schematic.schematicId, projection);
        logger.info('[LitematicaBE] 已启用超大型投影渲染模式');
        renderer.layerRenderMode.set(player.xuid, false);
        renderer.currentRenderLayer.set(player.xuid, -1);
        renderer.showBounds(projection, player);
    } else {
        renderer.layerRenderMode.set(player.xuid, false);
        renderer.currentRenderLayer.set(player.xuid, -1);
        renderer.showBounds(projection, player);
        renderer.startRender(player, projection, -1);
    }
    
    output.success(`投影已放置: ${schematic.name}`);
    output.success(`位置: (${placePos.x}, ${placePos.y}, ${placePos.z})`);
    output.success(`方块数: ${schematic.totalBlocks || 0}`);
    output.success(`当前层: 0 / ${projection.dimensions?.y || 1}`);
}

async function loadSchematicFile(filename, player) {
    const filePath = SCHEMATIC_PATH + filename;
    let fullPath = null;
    
    if (File.exists(filePath + ".litematic")) {
        fullPath = filePath + ".litematic";
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
        const megaAvailable = megaRenderer.enabled === true
            && configManager.get('megaSchematic.enabled', true) === true;
        
        let useMegaMode = false;
        let streamResult = null;
        
        if (megaAvailable) {
            try {
                if (!streamLoader) {
                    throw new Error('streamLoader is not initialized');
                }
                streamResult = await streamLoader.prepareStream(loader, fullPath);
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
        const schematic = await loader.load(fullPath);
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
        if (f.endsWith('.litematic') || f.endsWith('.json')) {
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

function handleFailuresCommand(player, output) {
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

function listProjections(player, output) {
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

    // 清除所有玩家的显示
    for (const onlinePlayer of mc.getOnlinePlayers()) {
        renderer.clearPlayerProjection(onlinePlayer);
    }

    dataManager.removeProjection(projectionId);
    output.success(`已删除投影: ${projection.name}`);
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
    player.tell('§7手持木剑，蹲下点击打开菜单');

    // ═══ 退出重进后把投影接回来 ═══
    // 两条路：
    //   1. 内存里还留着保活会话（玩家掉线后又回来）→ 只 resume，零重写
    //   2. 会话已不在（服务器重启过）→ 按 playerData.currentProjectionId 重建
    try {
        let restored = false;
        try {
            restored = renderer.restoreForPlayer(player);
        } catch (e) {
            logger.warn(`[LitematicaBE] 恢复保活会话失败: ${e && e.message ? e.message : e}`);
        }

        if (restored) {
            const task = renderer.activeProjections.get(player.xuid);
            const nm = task && task.projection ? (task.projection.name || task.projection.id) : '投影';
            player.tell(`§a已恢复投影 "${nm}"`);
        } else {
            const pd = dataManager.getPlayerData(player.xuid) || {};
            const pid = pd.currentProjectionId;
            if (pid) {
                const projection = dataManager.getProjection(pid);
                if (projection) {
                    const lay = Number.isFinite(pd.currentRenderLayer) ? pd.currentRenderLayer : -1;
                    if (pd.renderLayerMode) renderer.layerRenderMode.set(player.xuid, true);
                    renderer.currentRenderLayer.set(player.xuid, lay);
                    // 同步 projManager：easyPlace / 建造模式都从这里取活动投影
                    try { projManager.activateProjection(player, projection); } catch (e) { /* 已有的会覆盖 */ }
                    const ok = renderer.startRender(player, projection, lay);
                    if (ok) {
                        player.tell(`§a已恢复上次的投影 "${projection.name || projection.id}"`
                            + (lay >= 0 ? `§7（第 ${lay} 层）` : ''));
                        logger.info(`[LitematicaBE] ${player.name} 重进恢复投影 ${pid}（层 ${lay}）`);
                    }
                } else {
                    // 投影已被删除：清掉记录，别每次都提示
                    dataManager.updatePlayerData(player.xuid, { currentProjectionId: null });
                    player.tell('§7上次的投影已被删除，记录已清理');
                }
            }
        }

        // 进服时他附近的区块一定已加载 —— 补一轮"当时没加载"的 ghost
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
            const task = renderer.activeProjections.get(player.xuid);
            logger.info(`[LitematicaBE] ${player.name} 离线，会话保活`
                + `（投影 ${task && task.projection ? task.projection.id : '?'}，30 分钟内回来可直接恢复）`);
        }
    } catch (e) {
        logger.warn(`[LitematicaBE] 会话保活失败，退回撤销: ${e && e.message ? e.message : e}`);
        try { renderer.clearPlayerProjection(player); } catch (e2) { /* 兜底也失败就交给 prune */ }
    }

    // 先获取活动投影信息，再删除（Mega 是纯内存状态，必须回收）
    const activeForLeft = projManager.getActiveProjection(player.xuid);
    if (activeForLeft && activeForLeft.projection && activeForLeft.projection.schematicId) {
        megaRenderer.stopRender(`${player.xuid}_${activeForLeft.projection.schematicId}`);
    }
    projManager.removeActiveProjection(player.xuid);
    playerSessions.delete(player.xuid);
    // 清理选区状态
    if (selectionTool) selectionTool.cleanup(player.xuid);
});

// ==================== 初始化 ====================

registerCommands('load');

// 命令系统在 onServerStarted 才完全就绪：加载期注册失败的在这里补一次，成功的不会重复注册
mc.listen('onServerStarted', () => {
    registerCommands('serverStarted');
    // 此刻工作目录与世界才真正就绪：再校验一次 addon 版本（部署侧路径这时才可靠）
    giCheckWiring();
    // 世界已就绪，但此刻目标区块通常还没进内存（无人在附近），setBlock 会全数失败。
    // 所以延后 3s 再补一次，失败的格会进 GhostGuard 的待恢复队列，由重试链 + tickingarea 兜。
    setTimeout(() => {
        // 先把上次异常退出留下的快照处理掉，再补 ghost 期望。
        // shouldRestore 的判据是"期望集合已不认这一格"——说明上次撤销只做了一半；
        // 期望仍认的格属于正常投影（重启后本来就该补回），绝不能在这里还原掉。
        try {
            const sr = worldSnapshot.restoreOrphaned({
                shouldRestore: (dimid, x, y, z) => !ghostExpect.get(dimid, x, y, z),
            });
            if (sr.sessions) {
                logger.info(`[LitematicaBE] 快照孤儿会话: ${sr.sessions} 个 / 续做还原 ${sr.restored} 格 / 保留待撤销 ${sr.held} 格 / 保留现状 ${sr.kept} / 失败 ${sr.failed} / 残留 ${sr.remaining}`);
            }
        } catch (e) {
            logger.warn(`[LitematicaBE] 快照孤儿会话清理失败: ${e && e.message ? e.message : e}`);
        }
        try {
            ghostGuard.restoreAll('serverStarted');
        } catch (e) {
            logger.warn(`[LitematicaBE] ghost 期望补齐失败: ${e && e.message ? e.message : e}`);
        }
    }, 3000);
});

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
logger.info(`[LitematicaBE] addon 版本校验: ${addonSummary.state}${addonSummary.enabled ? '（ghost 写入可用）' : '（ghost 写入已禁用，其余功能正常）'}`);
const snapStats = worldSnapshot.stats();
logger.info(`[LitematicaBE] 快照: ${snapStats.sessions} 个未还原会话 / ${snapStats.blocks} 格 / 目录 ${snapStats.dir}`);
logger.info(`Commands: ${Array.from(registeredCommands).join(', ') || '(none)'}`);
logger.info("Use wooden sword to operate");
logger.info("[LogCleaner] Auto-clean enabled");