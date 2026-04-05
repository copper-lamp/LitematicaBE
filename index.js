// Litematica BE v2.1.0 - Minecraft Bedrock Edition Projection Tool
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

ll.registerPlugin(
    "LitematicaBE",
    "Minecraft Bedrock Edition projection tool with shared projections",
    [2, 1, 0],
    {}
);

// 配置管理器（最先初始化，供其他模块使用）
const configManager = new ConfigManager();
const PLUGIN_VERSION = '2.1.0';
const SCHEMATIC_PATH = './plugins/LitematicaBE/schematics/';

// 全局实例
const loader = new LitematicLoader();
const dataManager = new DataManager();
const renderer = new ProjectionRenderer();
const projManager = new ProjectionManager();
const uiManager = new UIManager();
const logCleaner = new LogCleaner();
const easyPlaceManager = new EasyPlaceManager(projManager, dataManager);

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

const PLUGIN_NAME = "LitematicaBE";

// 玩家临时数据（内存中）
const playerSessions = new Map();
global.playerSessions = playerSessions;

logger.info(`${PLUGIN_NAME} v${PLUGIN_VERSION} Loading...`);

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
        logger.info(`[Debug] Player ${player.name} holding: ${itemType}`);
        
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

mc.listen("onUseItemOn", (player, item, block, side, pos) => {
    const enabled = easyPlaceManager.isEnabled(player);
    
    if (!enabled) return true;
    
    if (!item) return true;
    
    logger.info(`[EasyPlace] Player ${player.name} trying to place item: ${item.type}`);
    
    const result = easyPlaceManager.handleUseItemOn(player, item, block, side, pos);
    logger.info(`[EasyPlace] Result: ${result}`);
    
    return result;
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

    if (player.isSneaking) {
        uiManager.showMainMenu(player);
        return;
    }

    const playerData = dataManager.getPlayerData(player.xuid);
    const session = getPlayerSession(player.xuid);

    logger.info(`[ItemUse] ===============`);
    logger.info(`[ItemUse] ${player.name} (${player.xuid}) used wooden sword`);
    logger.info(`[ItemUse] toolMode: ${playerData.toolMode}`);
    logger.info(`[ItemUse] currentProjectionId: ${playerData.currentProjectionId}`);
    logger.info(`[ItemUse] projManager stats: ${JSON.stringify(projManager.getStats())}`);

    switch (playerData.toolMode) {
        case 'place':
            handlePlaceMode(player, block, pos, session);
            break;
        case 'rotate':
            handleRotateMode(player, session);
            break;
        case 'build':
            logger.info(`[ItemUse] Calling handleBuildMode`);
            handleBuildMode(player, session);
            break;
        default:
            logger.info(`[ItemUse] No tool mode set for ${player.name}`);
            player.tell('§7请先选择操作模式');
            player.tell('§e/litematica build §7- 切换到建造模式(逐层渲染)');
            player.tell('§e/litematica place §7- 切换到放置模式');
            player.tell('§e/litematica rotate §7- 切换到旋转模式');
            break;
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
        dimension: player.dim,
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
        blocks: schematic.blocks || []
    };

    // 调试日志
    logger.info(`[LitematicaBE] Placing projection: ${projection.name}`);
    logger.info(`[LitematicaBE]   - Position: (${projection.position.x}, ${projection.position.y}, ${projection.position.z})`);
    logger.info(`[LitematicaBE]   - Dimension: ${projection.dimension}`);
    logger.info(`[LitematicaBE]   - TotalBlocks: ${projection.totalBlocks}`);
    logger.info(`[LitematicaBE]   - Dimensions: ${JSON.stringify(projection.dimensions)}`);
    logger.info(`[LitematicaBE]   - Blocks array length: ${projection.blocks?.length || 0}`);

    // 保存投影
    dataManager.addProjection(projection);
    dataManager.setPlayerCurrentProjection(player.xuid, projection.id);
    dataManager.setPlayerToolMode(player.xuid, 'build');

    projManager.activateProjection(player, projection);

    // 同步渲染器层状态
    renderer.layerRenderMode.set(player.xuid, false);
    renderer.currentRenderLayer.set(player.xuid, -1);

    renderer.startRender(player, projection);

    player.tell(`§a投影已放置: §e${projection.name}`);
    player.tell(`§7位置: §f(${projection.position.x}, ${projection.position.y}, ${projection.position.z})`);
    player.tell(`§7方块数: §f${projection.totalBlocks}`);
    player.tell(`§a已自动切换到建造模式`);
    player.tell(`§7抬头/低头+木剑切换层，平视切换显示`);
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
    logger.info(`[BuildMode] ===============`);
    logger.info(`[BuildMode] Triggered by ${player.name}`);

    // 首先检查 projManager 中是否有活动投影
    let activeProj = projManager.getActiveProjectionByPlayer(player);
    logger.info(`[BuildMode] projManager activeProj: ${activeProj ? 'exists' : 'null'}`);

    // 如果 projManager 中没有，尝试从 dataManager 恢复
    if (!activeProj) {
        const playerData = dataManager.getPlayerData(player.xuid);
        const projectionId = playerData?.currentProjectionId;
        logger.info(`[BuildMode] No active projection in projManager, checking dataManager. projectionId: ${projectionId}`);
        logger.info(`[BuildMode] dataManager.projections.size: ${dataManager.projections?.size || 'unknown'}`);
        logger.info(`[BuildMode] dataManager.projections keys: ${JSON.stringify([...(dataManager.projections?.keys() || [])])}`);

        if (!projectionId) {
            player.tell('§c你没有正在操作的投影');
            player.tell('§e请先使用 §e/litematica place §e放置投影');
            return;
        }

        const projection = dataManager.getProjection(projectionId);
        logger.info(`[BuildMode] dataManager.getProjection result: ${projection ? 'exists' : 'null'}`);

        if (!projection) {
            player.tell('§c投影不存在或已被删除');
            player.tell('§e请重新放置投影');
            return;
        }

        logger.info(`[BuildMode] projection.name: ${projection.name}, blocks: ${projection.blocks?.length || 0}`);

        // 激活投影
        activeProj = projManager.activateProjection(player, projection);
        logger.info(`[BuildMode] Activated projection from dataManager: ${projection.id}`);

        // 同步到渲染器
        renderer.layerRenderMode.set(player.xuid, true);
        renderer.currentRenderLayer.set(player.xuid, projection.renderLayer !== undefined ? projection.renderLayer : -1);
        logger.info(`[BuildMode] Synced layerRenderMode and currentRenderLayer to renderer`);
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

    logger.info(`[BuildMode] Pitch: ${pitch}, Direction: ${direction}`);

    // 切换层级
    const result = projManager.switchLayer(player, direction);

    if (result) {
        const newLayer = result.renderLayer;
        logger.info(`[BuildMode] Layer switched to: ${newLayer}`);

        // 同步到渲染器
        renderer.currentRenderLayer.set(player.xuid, newLayer);
        renderer.layerRenderMode.set(player.xuid, true);

        // 清除并重新渲染
        renderer.clearPlayerProjection(player);
        renderer.startRender(player, result.projection, newLayer);

        const info = projManager.getLayerInfo(result.projection, newLayer);
        if (newLayer === -1) {
            player.tell(`§a显示全部层 §7(${info.totalBlocks} 方块)`);
        } else {
            player.tell(`§a当前层: §e${newLayer} §7/ ${info.totalLayers}`);
            player.tell(`§7本层方块: §f${info.currentLayerBlocks}`);
        }
    } else {
        logger.warn(`[BuildMode] switchLayer returned null`);
    }
}

// ==================== 命令系统 ====================

function registerCommands() {
    const cmd = mc.newCommand("litematica", "Litematica projection tool", PermType.Any, 0x80);
    const cmdShort = mc.newCommand("lit", "Litematica (Short)", PermType.Any, 0x80);

    cmd.setEnum("ActionEnum", ["menu", "load", "place", "placeat", "rotate", "build", "easyplace", "clear", "list", "remove", "info"]);
    cmd.setEnum("FileEnum", ["file"]);
    cmd.setEnum("CoordEnum", ["x", "y", "z"]);

    cmd.mandatory("action", ParamType.Enum, "ActionEnum", 1);
    cmd.optional("filename", ParamType.RawText);
    cmd.optional("x", ParamType.Int);
    cmd.optional("y", ParamType.Int);
    cmd.optional("z", ParamType.Int);

    cmd.overload([]);
    cmd.overload(["ActionEnum"]);
    cmd.overload(["ActionEnum", "filename"]);
    cmd.overload(["ActionEnum", "x", "y", "z"]);

    cmd.setCallback((cmd, origin, output, results) => {
        const player = origin.player;
        if (!player) {
            output.success("This command must be used by a player");
            return;
        }

        const action = results.action;
        logger.info(`[LitematicaBE] Command: ${action} by ${player.name}`);

        switch (action) {
            case "menu":
                uiManager.showMainMenu(player);
                break;
            case "load":
                handleLoadCommand(player, results.filename, output);
                break;
            case "place":
                handlePlaceCommand(player, results.filename, output);
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
                output.success("§f抬头/低头+木剑切换层");
                break;
            case "easyplace":
                easyPlaceManager.toggle(player);
                break;
            case "clear":
                renderer.clearPlayerProjection(player);
                projManager.removeActiveProjection(player.xuid);
                output.success("§a已清除当前投影显示");
                break;
            case "list":
                listProjections(player, output);
                break;
            case "remove":
                handleRemoveCommand(player, results.filename, output);
                break;
            case "info":
                showProjectionInfo(player, output);
                break;
            default:
                uiManager.showMainMenu(player);
        }
    });

    cmd.setup();

    // 短命令
    cmdShort.setCallback((cmd, origin, output, results) => {
        const player = origin.player;
        if (player) {
            uiManager.showMainMenu(player);
        }
    });
    cmdShort.setup();

    // 日志清理命令
    const cmdLogClean = mc.newCommand("litematica:logclean", "Clean render logs", PermType.Any, 0x80);
    cmdLogClean.setEnum("LogCleanAction", ["status", "clean", "config"]);
    cmdLogClean.mandatory("action", ParamType.Enum, "LogCleanAction", 1);
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
    cmdLogClean.setup();

    // 配置管理命令
    const cmdConfig = mc.newCommand("litematica:config", "Config management", PermType.Any, 0x80);
    cmdConfig.setEnum("ConfigAction", ["reload", "reset", "get"]);
    cmdConfig.mandatory("action", ParamType.Enum, "ConfigAction", 1);
    cmdConfig.optional("key", ParamType.RawText);
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
    cmdConfig.setup();
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

    logger.info(`[LitematicaBE] Loading schematic: ${filename}`);
    
    loadSchematicFile(filename).then(schematic => {
        if (schematic) {
            const session = getPlayerSession(player.xuid);
            session.selectedSchematic = schematic;
            
            logger.info(`[LitematicaBE] Successfully loaded: ${schematic.name}`);
            logger.info(`[LitematicaBE]   - Blocks: ${schematic.totalBlocks}`);
            logger.info(`[LitematicaBE]   - Dimensions: ${schematic.dimensions?.x}x${schematic.dimensions?.y}x${schematic.dimensions?.z}`);
            
            output.success(`§a已加载: §e${schematic.name}`);
            output.success(`§7方块数: §f${schematic.totalBlocks}`);
            output.success(`§7尺寸: §f${schematic.dimensions?.x || '?'}x${schematic.dimensions?.y || '?'}x${schematic.dimensions?.z || '?'}`);
            output.success("§f请选择操作模式:");
            output.success("§e  /litematica place §7- 放置模式");
            output.success("§e  /litematica rotate §7- 旋转模式");
            output.success("§e  /litematica build §7- 建造模式");
        } else {
            output.error(`§c找不到文件: ${filename}`);
            logger.error(`[LitematicaBE] Failed to load: ${filename}`);
        }
    });
}

function handlePlaceCommand(player, filename, output) {
    logger.info(`[LitematicaBE] handlePlaceCommand called, filename: ${filename}`);
    
    loadSchematicFile(filename || (getPlayerSession(player.xuid).selectedSchematic?.name)).then(schematic => {
        logger.info(`[LitematicaBE] loadSchematicFile.then callback, schematic: ${schematic ? 'exists' : 'null'}`);
        
        if (!schematic) {
            output.error("§c没有加载的原理图");
            output.success("§f用法: /litematica place <文件名>");
            output.success("§f或先 /litematica load <文件名>");
            return;
        }
        
        logger.info(`[LitematicaBE] schematic.blocks length: ${schematic.blocks?.length || 0}`);
        
        const session = getPlayerSession(player.xuid);
        session.selectedSchematic = schematic;
        
        logger.info(`[LitematicaBE] Placing projection: ${schematic.name} at player position`);
        
        const pos = player.pos;
        const placePos = {
            x: Math.floor(pos.x),
            y: Math.floor(pos.y) - 1,
            z: Math.floor(pos.z)
        };
        
        const projection = {
            id: dataManager.generateId(),
            name: schematic.name,
            filePath: schematic.filePath || filename,
            position: placePos,
            dimension: player.dim,
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
            blocks: schematic.blocks
        };
        
        logger.info(`[LitematicaBE] projection.blocks length: ${projection.blocks?.length || 0}`);
        
        // 保存投影
        dataManager.addProjection(projection);
        dataManager.setPlayerCurrentProjection(player.xuid, projection.id);

        projManager.activateProjection(player, projection);

        // 同步渲染器层状态
        renderer.layerRenderMode.set(player.xuid, false);
        renderer.currentRenderLayer.set(player.xuid, -1);

        logger.info(`[LitematicaBE] Projection created: ${projection.id}`);
        logger.info(`[LitematicaBE]   - Position: (${placePos.x}, ${placePos.y}, ${placePos.z})`);
        logger.info(`[LitematicaBE]   - Dimension: ${player.dim}`);
        
        // 显示范围框
        renderer.showBounds(projection, player);
        
        // 渲染投影
        renderer.startRender(player, projection);

        output.success(`§a投影已放置: §e${schematic.name}`);
        output.success(`§7位置: §f(${placePos.x}, ${placePos.y}, ${placePos.z})`);
        output.success(`§7方块数: §f${schematic.totalBlocks}`);
        output.success(`§e使用 §e/litematica build §e切换到建造模式`);
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
    logger.info(`[LitematicaBE] Session exists: ${!!session}`);
    logger.info(`[LitematicaBE] Session has selectedSchematic: ${!!session?.selectedSchematic}`);
    
    const schematic = session.selectedSchematic;
    
    if (!schematic) {
        output.error("§c没有加载的原理图");
        output.success("§f请先使用 /litematica load <文件名>");
        return;
    }
    
    logger.info(`[LitematicaBE] Placing projection: ${schematic.name}`);
    logger.info(`[LitematicaBE]   - Blocks in schematic: ${schematic.blocks?.length || 0}`);
    logger.info(`[LitematicaBE]   - TotalBlocks: ${schematic.totalBlocks}`);
    
    const placePos = { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
    
    const projection = {
        id: dataManager.generateId(),
        name: schematic.name,
        filePath: schematic.filePath,
        position: placePos,
        dimension: player.dim,
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
        blocks: schematic.blocks || []
    };
    
    logger.info(`[LitematicaBE] Projection blocks: ${projection.blocks.length}`);
    
    dataManager.addProjection(projection);
    dataManager.setPlayerCurrentProjection(player.xuid, projection.id);

    projManager.activateProjection(player, projection);

    // 同步渲染器层状态
    renderer.layerRenderMode.set(player.xuid, false);
    renderer.currentRenderLayer.set(player.xuid, -1);

    logger.info(`[LitematicaBE] Projection created: ${projection.id}`);
    logger.info(`[LitematicaBE]   - Position: (${placePos.x}, ${placePos.y}, ${placePos.z})`);
    logger.info(`[LitematicaBE]   - Dimension: ${player.dim}`);
    
    // 显示范围框
    renderer.showBounds(projection, player);
    
    // 渲染投影
    renderer.startRender(player, projection);
    
    output.success(`§a投影已放置: §e${schematic.name}`);
    output.success(`§7位置: §f(${placePos.x}, ${placePos.y}, ${placePos.z})`);
    output.success(`§7方块数: §f${schematic.totalBlocks || 0}`);
}

async function loadSchematicFile(filename) {
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
        logger.info(`[LitematicaBE] File not found: ${filePath}`);
        return null;
    }
    
    logger.info(`[LitematicaBE] Loading file: ${fullPath}`);
    
    try {
        const schematic = await loader.load(fullPath);
        logger.info(`[LitematicaBE] loadSchematicFile returned: ${schematic ? 'valid' : 'null'}`);
        if (schematic) {
            logger.info(`[LitematicaBE] File loaded successfully`);
            logger.info(`[LitematicaBE]   - Name: ${schematic.name}`);
            logger.info(`[LitematicaBE]   - TotalBlocks: ${schematic.totalBlocks}`);
            logger.info(`[LitematicaBE]   - Blocks array length: ${schematic.blocks?.length || 0}`);
            logger.info(`[LitematicaBE]   - Dimensions: ${JSON.stringify(schematic.dimensions)}`);
        }
        return schematic;
    } catch (e) {
        logger.error(`[LitematicaBE] Error loading file: ${e.message}`);
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

// ==================== 事件监听 ====================

// 玩家加入
mc.listen("onJoin", (player) => {
    logger.info(`Player ${player.name} joined`);
    
    // 更新玩家数据
    const playerData = dataManager.getPlayerData(player.xuid);
    playerData.lastLogin = Date.now();
    dataManager.updatePlayerData(player.xuid, playerData);

    // 显示欢迎消息
    player.tell(`§a欢迎使用 ${PLUGIN_NAME} v${PLUGIN_VERSION}`);
    player.tell('§7手持木剑，蹲下点击打开菜单');
});

// 玩家离开
mc.listen("onLeft", (player) => {
    logger.info(`Player ${player.name} left`);

    renderer.clearPlayerProjection(player);
    projManager.removeActiveProjection(player.xuid);
    playerSessions.delete(player.xuid);
});

// 服务器关闭时自动清理日志 - LeviLamina 不支持 onServerStop 事件
// 建议在关机前手动执行 /litematica:logclean clean 命令清理日志
// 或者依赖自动清理循环在服务器运行时清理

// ==================== 初始化 ====================

registerCommands();

logger.info(`${PLUGIN_NAME} v${PLUGIN_VERSION} Loaded!`);
logger.info("Commands: /litematica, /lit, /litematica:logclean, /litematica:config");
logger.info("Use wooden sword to operate");
logger.info("[LogCleaner] Auto-clean enabled");