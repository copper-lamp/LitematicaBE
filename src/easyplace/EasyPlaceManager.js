const { BlockMatcher } = require('./BlockMatcher');
const { PositionConverter } = require('./PositionConverter');
const { InventoryHelper } = require('./InventoryHelper');
const { BlockConversions } = require('./BlockConversions');
const { bidirectionalConverter } = require('../mappings/BidirectionalBlockConverter');
const { SpatialIndexUtils } = require('./SpatialIndexUtils');
const { BlockStateConverters } = require('../mappings/BlockStateConverters');
const { BlockMappingRegistry } = require('../mappings/BlockMappingRegistry');
const { PlacementLogger } = require('./PlacementLogger');
const fs = require('fs');
const path = require('path');

class EasyPlaceManager {
    static SEARCH_RADIUS = 5;
    static TICK_INTERVAL = 200;

    constructor(projectionManager, dataManager, megaManager) {
        this.projectionManager = projectionManager;
        this.dataManager = dataManager;
        this.megaManager = megaManager;
        this.blockMatcher = new BlockMatcher();
        this.inventoryHelper = new InventoryHelper();
        this.positionConverter = new PositionConverter();
        this.playerStates = new Map();
        this.fastPlaceStates = new Map();
        this.placedLocations = new Map();
        this.tickInterval = null;
        this.debugMode = true;
        this.debugLogPath = './logs/LitematicaBE/easyplace_debug.log';
        this.placementLogger = new PlacementLogger();
        this.logFailures = true;
        this.ensureDebugLogDir();
    }

    ensureDebugLogDir() {
        try {
            const dir = path.dirname(this.debugLogPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        } catch (e) {
            logger.error(`[EasyPlace] Failed to create debug log directory: ${e.message}`);
        }
    }

    logDebug(message, data = null) {
        try {
            const timestamp = new Date().toISOString();
            let logLine = `[${timestamp}] ${message}`;
            if (data) {
                logLine += ` | DATA: ${JSON.stringify(data)}`;
            }
            logLine += '\n';
            fs.appendFileSync(this.debugLogPath, logLine);
        } catch (e) {
            logger.error(`[EasyPlace] Failed to write debug log: ${e.message}`);
        }
    }

    enable(player) {
        this.playerStates.set(player.xuid, {
            enabled: true,
            placedCount: 0
        });
        player.tell('§a轻松放置已启用');
        player.tell('§7放置方块时会自动修正');
    }

    disable(player) {
        this.playerStates.delete(player.xuid);
        player.tell('§c轻松放置已禁用');
    }

    toggle(player) {
        if (this.isEnabled(player)) {
            this.disable(player);
        } else {
            this.enable(player);
        }
    }

    isEnabled(player) {
        return this.playerStates.get(player.xuid)?.enabled || false;
    }

    // 投影打印机方法
    enableFastPlace(player) {
        if (this.fastPlaceStates.has(player.xuid)) {
            player.tell('§c投影打印机已启用');
            return;
        }

        this.fastPlaceStates.set(player.xuid, {
            enabled: true,
            placedCount: 0
        });

        player.tell('§a投影打印机已启用');
        player.tell('§7将在5格范围内自动放置投影方块');
        player.tell('§7使用 /lit printer 关闭');

        if (!this.tickInterval) {
            this.startTickLoop();
        }
    }

    disableFastPlace(player) {
        this.fastPlaceStates.delete(player.xuid);
        this.placedLocations.delete(player.xuid);

        player.tell('§c投影打印机已禁用');

        if (this.fastPlaceStates.size === 0 && this.tickInterval) {
            this.stopTickLoop();
        }
    }

    toggleFastPlace(player) {
        if (this.isFastPlaceEnabled(player)) {
            this.disableFastPlace(player);
        } else {
            this.enableFastPlace(player);
        }
    }

    isFastPlaceEnabled(player) {
        return this.fastPlaceStates.get(player.xuid)?.enabled || false;
    }

    startTickLoop() {
        if (this.tickInterval) return;

        this.tickInterval = setInterval(() => {
            const players = mc.getOnlinePlayers();
            for (const player of players) {
                if (!this.isFastPlaceEnabled(player)) continue;
                this.processFastPlace(player);
            }
            this.placedLocations.clear();
        }, EasyPlaceManager.TICK_INTERVAL);

        logger.info('[EasyPlace] FastPlace tick loop started');
    }

    stopTickLoop() {
        if (this.tickInterval) {
            clearInterval(this.tickInterval);
            this.tickInterval = null;
            logger.info('[EasyPlace] FastPlace tick loop stopped');
        }
    }

    processFastPlace(player) {
        const activeProj = this.projectionManager.getActiveProjectionByPlayer(player);
        if (!activeProj || !activeProj.projection) {
            this.logDebug('FASTPLACE_NO_PROJECTION', { player: player.xuid });
            return;
        }

        // 每tick清除已放置记录，防止跨tick重复放置
        this.placedLocations.delete(player.xuid);

        const projection = activeProj.projection;
        const currentLayer = activeProj.renderLayer;
        const playerPos = player.pos;
        const projPos = projection.position;
        const projDim = projection.dimensions;
        const dimid = playerPos.dimid;

        const centerX = playerPos.x;
        const centerY = playerPos.y;
        const centerZ = playerPos.z;
        const radius = EasyPlaceManager.SEARCH_RADIUS;

        let checkedBlocks = 0;
        let skippedRadius = 0;
        let skippedLayer = 0;
        let skippedNotAir = 0;
        let skippedPlaced = 0;
        let skippedBanned = 0;
        let placedCount = 0;

        // 根据模式使用不同的方块查询方式
        let blocksToCheck;
        if (projection.isMega && projection.schematicId && this.megaManager) {
            // Mega 模式：从磁盘分块查询
            const relCX = centerX - projPos.x;
            const relCY = centerY - projPos.y;
            const relCZ = centerZ - projPos.z;
            blocksToCheck = this.megaManager.getBlocksNear(projection.schematicId, relCX, relCY, relCZ, radius + 1);
        } else {
            // 普通模式：使用空间分块索引加速查找
            blocksToCheck = SpatialIndexUtils.getBlocksInRadius(
                projection, centerX, centerY, centerZ, radius
            );
        }
        const radiusSquared = radius * radius;

        for (const block of blocksToCheck) {
            checkedBlocks++;
            const worldX = projPos.x + block.pos[0];
            const worldY = projPos.y + block.pos[1];
            const worldZ = projPos.z + block.pos[2];

            const distSquared =
                Math.pow(worldX - centerX, 2) +
                Math.pow(worldY - centerY, 2) +
                Math.pow(worldZ - centerZ, 2);

            if (distSquared > radiusSquared) {
                skippedRadius++;
                continue;
            }

            if (currentLayer !== -1 && block.pos[1] !== currentLayer) {
                skippedLayer++;
                continue;
            }

            const locationKey = `${worldX},${worldY},${worldZ}`;
            if (this.wasPlacedThisTick(player.xuid, locationKey)) {
                skippedPlaced++;
                continue;
            }

            const worldBlock = mc.getBlock(worldX, worldY, worldZ, dimid);
            const blockType = worldBlock ? (worldBlock.type || worldBlock.name || '') : '';
            if (blockType !== 'minecraft:air') {
                skippedNotAir++;
                continue;
            }

            const neededBlockType = block.name;
            if (!neededBlockType || neededBlockType === 'minecraft:air') continue;
            if (BlockConversions.isBanned(neededBlockType, dimid)) {
                skippedBanned++;
                continue;
            }

            const javaStates = block.state || {};

            if (!BlockConversions.isWhitelistedState(neededBlockType, javaStates)) {
                skippedBanned++;
                continue;
            }

            const registry = new BlockMappingRegistry();
            const mapping = registry.getMapping(neededBlockType);
            let beName = mapping ? mapping.b : neededBlockType;

            const stateConverter = new BlockStateConverters();
            const beStates = stateConverter.convertJavaToBedrock(neededBlockType, javaStates);

            const converted = BlockConversions.convertToValid(beName, beStates);

            if (neededBlockType === 'minecraft:redstone_torch' || neededBlockType === 'minecraft:redstone_wall_torch') {
                if (javaStates.lit === 'false' || javaStates.lit === false) {
                    converted.name = 'unlit_redstone_torch';
                }
            }

            const finalStates = BlockConversions.resetToDefaultStates(converted.states);

            const isCreative = player.gameMode === 1;
            let success = false;
            let failReason = 'setblock失败';

            if (isCreative) {
                success = this.fastPlaceBlockAt(worldX, worldY, worldZ, dimid, converted.name, finalStates);
            } else {
                const foundSlot = this.inventoryHelper.findBlockInInventory(
                    player.getInventory(), converted.name, -1, finalStates
                );
                if (foundSlot !== -1) {
                    success = this.fastPlaceBlockAt(worldX, worldY, worldZ, dimid, converted.name, finalStates);
                    if (success) {
                        this.consumeItem(player, converted.name);
                    }
                } else {
                    failReason = `缺少物品: ${converted.name}`;
                }
            }

            if (success) {
                this.markAsPlaced(player.xuid, locationKey);
                const state = this.fastPlaceStates.get(player.xuid);
                if (state) state.placedCount++;
                placedCount++;
                if (this.logFailures) {
                    this.placementLogger.logSuccess();
                }
            } else if (this.logFailures) {
                this.placementLogger.logFailure(
                    player.name,
                    neededBlockType,
                    converted.name,
                    javaStates,
                    finalStates,
                    '',
                    failReason
                );
            }
        }

        this.logDebug('FASTPLACE_SUMMARY', {
            checkedBlocks,
            skippedRadius,
            skippedLayer,
            skippedNotAir,
            skippedPlaced,
            skippedBanned,
            placedCount
        });
    }

    getBlocksInRadius(projection, centerX, centerY, centerZ, radius) {
        return SpatialIndexUtils.getBlocksInRadius(projection, centerX, centerY, centerZ, radius);
    }

    wasPlacedThisTick(playerXuid, locationKey) {
        return this.placedLocations.get(playerXuid)?.has(locationKey) || false;
    }

    markAsPlaced(playerXuid, locationKey) {
        if (!this.placedLocations.has(playerXuid)) {
            this.placedLocations.set(playerXuid, new Set());
        }
        this.placedLocations.get(playerXuid).add(locationKey);
    }

    handleUseItemOn(player, item, block, side, pos) {
        if (!this.isEnabled(player)) {
            return true;
        }

        const activeProj = this.projectionManager.getActiveProjectionByPlayer(player);
        if (!activeProj || !activeProj.projection) {
            return true;
        }

        if (!block || !block.pos) {
            return true;
        }

        const projection = activeProj.projection;
        const projPos = projection.position;
        const projDim = projection.dimensions;
        const dimid = player.pos?.dimid ?? 0;

        const offsets = [
            { x: 0, y: -1, z: 0 },
            { x: 0, y: 1, z: 0 },
            { x: 0, y: 0, z: -1 },
            { x: 0, y: 0, z: 1 },
            { x: -1, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 }
        ];
        const offset = offsets[side] || offsets[0];

        let placeX = block.pos.x + offset.x;
        let placeY = block.pos.y + offset.y;
        let placeZ = block.pos.z + offset.z;
        const placeDim = block.pos.dimid ?? dimid;

        if (pos && typeof pos.x === 'number') {
            const preciseX = Math.floor(pos.x);
            const preciseY = Math.floor(pos.y);
            const preciseZ = Math.floor(pos.z);
            if (preciseX !== block.pos.x || preciseY !== block.pos.y || preciseZ !== block.pos.z) {
                placeX = preciseX;
                placeY = preciseY;
                placeZ = preciseZ;
            }
        }

        const relX = placeX - projPos.x;
        const relY = placeY - projPos.y;
        const relZ = placeZ - projPos.z;

        if (relX < 0 || relX >= projDim.x ||
            relY < 0 || relY >= projDim.y ||
            relZ < 0 || relZ >= projDim.z) {
            return true;
        }

        const currentLayer = activeProj.renderLayer;
        if (currentLayer !== -1 && relY !== currentLayer) {
            return true;
        }

        let projBlock = null;
        
        if (projection.isMega && projection.schematicId) {
            // Mega 模式：从磁盘查询方块（使用相对投影坐标，不是世界坐标）
            projBlock = this.megaManager.getBlockAt(projection.schematicId, relX, relY, relZ);
        } else if (projection.blockIndex) {
            // 普通模式：从内存索引查询
            projBlock = projection.blockIndex.get(`${relX},${relY},${relZ}`);
        }

        if (!projBlock) {
            return true;
        }

        let neededBlockType = projBlock.name;
        let neededBlockState = projBlock.state || {};

        if (neededBlockType === 'minecraft:air') {
            return true;
        }

        if (BlockConversions.isBanned(neededBlockType, placeDim)) {
            return false;
        }

        const converted = BlockConversions.convertToValid(neededBlockType, neededBlockState);
        neededBlockType = converted.name;
        neededBlockState = BlockConversions.filterDirectionStates(converted.states);

        if (item) {
            const isCorrectBlock = this.blockMatcher.match(item.type, neededBlockType, null, neededBlockState);
            if (isCorrectBlock) {
                return true;
            }
        }

        const isCreative = player.gameMode === 1;

        if (isCreative) {
            const success = this.placeBlockAt(placeX, placeY, placeZ, placeDim, neededBlockType, neededBlockState);
            if (success) {
                return false;
            }
            return true;
        }

        const foundSlot = this.inventoryHelper.findBlockInInventory(
            player.getInventory(),
            neededBlockType,
            -1,
            neededBlockState
        );

        if (foundSlot === -1) {
            const foundInShulker = this.inventoryHelper.findBlockInShulkerBoxes(
                player,
                player.getInventory(),
                neededBlockType,
                neededBlockState
            );

            if (foundInShulker === -1) {
                const totalCount = this.inventoryHelper.countBlock(player, neededBlockType);
                if (totalCount > 0) {
                    logger.info(`[EasyPlace] 无法从潜隐盒提取: ${neededBlockType}`);
                } else {
                    logger.info(`[EasyPlace] 缺少: ${neededBlockType}`);
                }
                return false;
            }
        }

        const success = this.placeBlockAt(placeX, placeY, placeZ, placeDim, neededBlockType, neededBlockState);
        if (success) {
            this.consumeItem(player, neededBlockType);
            return false;
        }

        return true;
    }

    /**
     * 在方块放置后检测并修正（onBlockPlaced 事件回调）
     * 比 onUseItemOn 更可靠，能确保正确检测到放置的方块
     */
    correctBlockPlacement(player, block) {
        if (!block || !block.pos) {
            return;
        }

        const activeProj = this.projectionManager.getActiveProjectionByPlayer(player);
        if (!activeProj || !activeProj.projection) {
            return;
        }

        const projection = activeProj.projection;
        const projPos = projection.position;
        const projDim = projection.dimensions;

        const blockX = block.pos.x;
        const blockY = block.pos.y;
        const blockZ = block.pos.z;
        const blockDim = block.pos.dimid ?? 0;

        // 检查是否在投影范围内
        if (blockX < projPos.x || blockX >= projPos.x + projDim.x) return;
        if (blockY < projPos.y || blockY >= projPos.y + projDim.y) return;
        if (blockZ < projPos.z || blockZ >= projPos.z + projDim.z) return;

        // 检查层级限制
        const currentLayer = activeProj.renderLayer;
        if (currentLayer !== -1) {
            const relativeY = blockY - projPos.y;
            if (relativeY !== currentLayer) return;
        }

        // 使用索引查找投影方块
        const projRelativeX = blockX - projPos.x;
        const projRelativeY = blockY - projPos.y;
        const projRelativeZ = blockZ - projPos.z;

        let projBlock = null;

        if (projection.isMega && projection.schematicId && this.megaManager) {
            // Mega 模式：从磁盘查询方块（使用相对投影坐标）
            projBlock = this.megaManager.getBlockAt(projection.schematicId, projRelativeX, projRelativeY, projRelativeZ);
        } else {
            projBlock = projection.blockIndex
                ? projection.blockIndex.get(`${projRelativeX},${projRelativeY},${projRelativeZ}`)
                : null;
        }

        if (!projBlock) return;

        const neededBlockType = projBlock.name;
        if (!neededBlockType || neededBlockType === 'minecraft:air') return;
        if (BlockConversions.isBanned(neededBlockType, blockDim)) return;

        // 转换方块
        const neededBlockState = projBlock.state || {};
        const converted = BlockConversions.convertToValid(neededBlockType, neededBlockState);
        const finalType = converted.name;
        const finalStates = BlockConversions.filterDirectionStates(converted.states);

        // 检查放置的方块是否正确
        const actualBlockType = block.type || block.name || '';

        const isCorrect = this.blockMatcher.match(actualBlockType, finalType, null, finalStates);

        if (isCorrect) return; // 方块正确，不需要修正

        // 方块不正确，需要修正
        this.placeBlockAt(blockX, blockY, blockZ, blockDim, finalType, finalStates);
        // 静默修正，不发送客户端提示
    }

    placeBlockAt(x, y, z, dimid, blockType, blockStates) {
        try {
            if (!blockType || typeof blockType !== 'string') {
                this.logDebug('PLACE_FAILED_INVALID_TYPE', { x, y, z, dimid, blockType });
                return false;
            }
            
            // 使用NBT对象方式放置方块
            // 这是基岩版最可靠的方块状态设置方式
            let success = false;
            
            try {
                // 构建方块NBT对象
                const blockNbt = bidirectionalConverter.buildBlockNbt(blockType, blockStates);
                success = mc.setBlock(x, y, z, dimid, blockNbt);
                
                this.logDebug('PLACE_ATTEMPT_NBT', {
                    x, y, z, dimid,
                    blockType,
                    blockStates,
                    success
                });
                
                if (success) {
                    return true;
                }
            } catch (nbtError) {
                this.logDebug('PLACE_NBT_FAILED', {
                    x, y, z, dimid,
                    blockType,
                    error: nbtError.message
                });
            }
            
            // 如果NBT方式失败，回退到简单放置（无状态）
            if (!success) {
                success = mc.setBlock(x, y, z, dimid, blockType, 0);
                this.logDebug('PLACE_ATTEMPT_SIMPLE', {
                    x, y, z, dimid,
                    blockType,
                    success
                });
            }
            
            return success;
        } catch (e) {
            this.logDebug('PLACE_EXCEPTION', {
                x, y, z, dimid,
                blockType,
                blockStates,
                error: e.message,
                stack: e.stack
            });
            logger.error(`[EasyPlace] Failed to place block: ${e.message}`);
            return false;
        }
    }

    fastPlaceBlockAt(x, y, z, dimid, blockName, blockStates) {
        try {
            if (!blockName || typeof blockName !== 'string') {
                return false;
            }

            const cmd = BlockConversions.buildSetBlockCommand(x, y, z, blockName, blockStates);
            const result = mc.runcmdEx(cmd);

            if (result.success) {
                return true;
            }

            this.logDebug('FAST_PLACE_SETBLOCK_FAILED', {
                x, y, z, dimid,
                blockName,
                blockStates,
                cmd,
                output: result.output || ''
            });
            return false;
        } catch (e) {
            this.logDebug('FAST_PLACE_EXCEPTION', {
                x, y, z, dimid,
                blockName,
                blockStates,
                error: e.message
            });
            return false;
        }
    }

    getPlacementFailureStats() {
        return this.placementLogger.getSummary();
    }

    resetPlacementFailureStats() {
        this.placementLogger.reset();
    }

    setLogFailures(enabled) {
        this.logFailures = enabled;
    }

    consumeItem(player, itemType) {
        try {
            const placeableItem = BlockConversions.getPlaceableItem(itemType);
            const consumeType = placeableItem || itemType;

            const inventory = player.getInventory();
            const selectedSlot = this.inventoryHelper.getSelectedSlot(player);
            const item = inventory.getItem(selectedSlot);

            if (!item || item.isNull()) return;

            const specialConversion = BlockConversions.getSpecialConversion(consumeType);
            if (specialConversion) {
                if (item.count === 1) {
                    const newItem = mc.newItem(specialConversion, 1);
                    inventory.setItem(selectedSlot, newItem);
                } else {
                    item.count--;
                    const newItem = mc.newItem(specialConversion, 1);
                    player.giveItem(newItem);
                }
            } else {
                if (item.count === 1) {
                    inventory.setItem(selectedSlot, null);
                } else {
                    item.count--;
                }
            }

            player.refreshItems();
        } catch (e) {
            logger.error(`[EasyPlace] Failed to consume item: ${e.message}`);
        }
    }

    setDebugMode(enabled) {
        this.debugMode = enabled;
        logger.info(`[EasyPlace] Debug mode: ${enabled}`);
    }

    getStats(player) {
        const state = this.playerStates.get(player.xuid);
        if (!state) return null;
        return {
            enabled: state.enabled,
            placedCount: state.placedCount || 0
        };
    }
}

module.exports = { EasyPlaceManager };
