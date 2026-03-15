// Litematica BE v2.0.0 - Minecraft Bedrock Edition Projection Tool
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
const { UIManager } = require('./src/ui/UIManager');

ll.registerPlugin(
    "LitematicaBE",
    "Minecraft Bedrock Edition projection tool with shared projections",
    [2, 0, 0],
    {}
);

const PLUGIN_NAME = "LitematicaBE";
const PLUGIN_VERSION = "2.0.0";
const SCHEMATIC_PATH = "./plugins/LitematicaBE/schematics/";

// 全局实例
const loader = new LitematicLoader();
const dataManager = new DataManager();
const renderer = new ProjectionRenderer();
const uiManager = new UIManager();

// 全局导出供其他模块使用
global.zlib = zlib;
global.fs = fs;
global.dataManager = dataManager;

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

// 监听使用物品事件
mc.listen("onUseItemOn", (player, item, block, side, pos) => {
    // 检查是否是木剑 
    if (!item || !item.type || item.type !== 'minecraft:wooden_sword') {
        return;
    }
    
    // 检查冷却 - 使用 uuid 作为 key
    const cooldownKey = `litematica_${player.uuid}`;
    const now = Date.now();
    const lastUse = playerCooldowns.get(cooldownKey) || 0;
    
    if (now - lastUse < 500) {
        return; // 冷却中
    }
    playerCooldowns.set(cooldownKey, now);
    
    // 蹲下 + 木剑 = 打开菜单
    if (player.isSneaking) {
        uiManager.showMainMenu(player);
        return;
    }
    
    const playerData = dataManager.getPlayerData(player.xuid);
    const session = getPlayerSession(player.xuid);

    // 根据当前模式执行操作
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
            player.tell('§f使用 §e/litematica menu §f打开菜单');
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

    // 渲染投影
    renderer.startRender(player, projection);

    player.tell(`§a投影已放置: §e${projection.name}`);
    player.tell(`§7位置: §f(${projection.position.x}, ${projection.position.y}, ${projection.position.z})`);
    player.tell(`§7方块数: §f${projection.totalBlocks}`);
}

/**
 * 处理旋转模式
 */
function handleRotateMode(player, session) {
    const playerData = dataManager.getPlayerData(player.xuid);
    const projectionId = playerData.currentProjectionId;

    if (!projectionId) {
        player.tell('§c你没有正在操作的投影');
        return;
    }

    const projection = dataManager.getProjection(projectionId);
    if (!projection) {
        player.tell('§c投影不存在');
        return;
    }

    // 清除当前显示
    renderer.clearPlayerProjection(player);

    // 旋转90度
    const newRotation = (projection.rotation + 90) % 360;
    dataManager.updateProjection(projectionId, { rotation: newRotation });

    // 重新显示
    renderer.startRender(player, { ...projection, rotation: newRotation });

    player.tell(`§a投影已旋转到 ${newRotation}°`);
}

/**
 * 处理建造模式
 */
function handleBuildMode(player, session) {
    const playerData = dataManager.getPlayerData(player.xuid);
    const projectionId = playerData.currentProjectionId;

    if (!projectionId) {
        player.tell('§c你没有正在操作的投影');
        return;
    }

    const projection = dataManager.getProjection(projectionId);
    if (!projection) {
        player.tell('§c投影不存在');
        return;
    }

    // 获取玩家视角
    const pitch = getPlayerLookPitch(player);

    let newLayer = projection.renderLayer;

    if (pitch < -30) {
        // 抬头 - 上一层
        newLayer = Math.min((newLayer === -1 ? 0 : newLayer) + 1, projection.dimensions.y - 1);
    } else if (pitch > 30) {
        // 低头 - 下一层
        newLayer = Math.max((newLayer === -1 ? projection.dimensions.y - 1 : newLayer) - 1, 0);
    } else {
        // 平视 - 切换显示/隐藏
        if (newLayer === -1) {
            newLayer = 0;
        } else {
            newLayer = -1; // 显示全部
        }
    }

    // 更新层
    dataManager.updateProjection(projectionId, { renderLayer: newLayer });

    // 清除并重新渲染
    renderer.clearPlayerProjection(player);
    renderer.startRender(player, { ...projection, renderLayer: newLayer }, newLayer);

    if (newLayer === -1) {
        player.tell('§a显示全部层');
    } else {
        const progress = Math.round((newLayer / projection.dimensions.y) * 100);
        player.tell(`§a当前层: ${newLayer}/${projection.dimensions.y} (${progress}%)`);
    }
}

// ==================== 范围检测系统 ====================

// 定期检查玩家位置，显示范围提示
setInterval(() => {
    const projections = dataManager.getAllProjections();
    const players = mc.getOnlinePlayers();

    for (const player of players) {
        const playerData = dataManager.getPlayerData(player.xuid);
        if (!playerData.settings?.autoLoadInRange) continue;

        for (const projection of projections) {
            // 检查是否在同一维度
            if (player.dim !== projection.dimension) continue;

            // 检查是否在范围内
            if (isPlayerInRange(player, projection, playerData.settings?.notificationRange || 50)) {
                // 检查是否已经加载了该投影
                if (!dataManager.isProjectionLoadedByPlayer(player.xuid, projection.id)) {
                    // 显示提示
                    uiManager.showRangeNotification(player, projection);
                }
            }
        }
    }
}, 15000); // 每15秒检查一次

function isPlayerInRange(player, projection, range) {
    const pos = player.pos;
    const { x, y, z } = projection.position || { x: 0, y: 0, z: 0 };
    const dims = projection.dimensions || { x: 10, y: 10, z: 10 };
    const { x: sx, y: sy, z: sz } = dims;

    return pos.x >= x - range && pos.x <= x + sx + range &&
           pos.y >= y - range && pos.y <= y + sy + range &&
           pos.z >= z - range && pos.z <= z + sz + range;
}

// ==================== 命令系统 ====================

function registerCommands() {
    const cmd = mc.newCommand("litematica", "Litematica projection tool", PermType.Any, 0x80);
    const cmdShort = mc.newCommand("lit", "Litematica (Short)", PermType.Any, 0x80);

    cmd.setEnum("ActionEnum", ["menu", "load", "place", "placeat", "rotate", "build", "clear", "list", "remove", "info"]);
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
            case "clear":
                renderer.clearPlayerProjection(player);
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
    loadSchematicFile(filename || (getPlayerSession(player.xuid).selectedSchematic?.name)).then(schematic => {
        if (!schematic) {
            output.error("§c没有加载的原理图");
            output.success("§f用法: /litematica place <文件名>");
            output.success("§f或先 /litematica load <文件名>");
            return;
        }
        
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
        
        // 保存投影
        dataManager.addProjection(projection);
        dataManager.setPlayerCurrentProjection(player.xuid, projection.id);
        
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
        output.success("§f其他玩家进入范围时会看到提示");
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
    
    // 清除该玩家的投影显示
    renderer.clearPlayerProjection(player);
    
    // 清除临时会话数据
    playerSessions.delete(player.xuid);
});

// ==================== 初始化 ====================

registerCommands();

logger.info(`${PLUGIN_NAME} v${PLUGIN_VERSION} Loaded!`);
logger.info("Commands: /litematica, /lit");
logger.info("Use wooden sword to operate");