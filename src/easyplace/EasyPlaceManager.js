const { BlockMatcher } = require('./BlockMatcher');
const { PositionConverter } = require('./PositionConverter');
const { InventoryHelper } = require('./InventoryHelper');
const { BlockConversions } = require('./BlockConversions');
const { converter } = require('../core/BlockStateConverter');
const fs = require('fs');
const path = require('path');

class EasyPlaceManager {
    static SEARCH_RADIUS = 5;
    static TICK_INTERVAL = 200;

    constructor(projectionManager, dataManager) {
        this.projectionManager = projectionManager;
        this.dataManager = dataManager;
        this.blockMatcher = new BlockMatcher();
        this.inventoryHelper = new InventoryHelper();
        this.positionConverter = new PositionConverter();
        this.playerStates = new Map();
        this.fastPlaceStates = new Map();
        this.placedLocations = new Map();
        this.tickInterval = null;
        this.debugMode = true;
        this.debugLogPath = './logs/LitematicaBE/easyplace_debug.log';
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

        // 使用空间分块索引加速查找（避免遍历全部方块）
        const CHUNK_SIZE = 16;
        const blocksToCheck = this.getBlocksInRadius(projection, centerX, centerY, centerZ, radius, CHUNK_SIZE);
        
        for (const block of blocksToCheck) {
            checkedBlocks++;
            const worldX = projPos.x + block.pos[0];
            const worldY = projPos.y + block.pos[1];
            const worldZ = projPos.z + block.pos[2];

            const dist = Math.sqrt(
                Math.pow(worldX - centerX, 2) +
                Math.pow(worldY - centerY, 2) +
                Math.pow(worldZ - centerZ, 2)
            );

            if (dist > radius) {
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

            const converted = BlockConversions.convertToValid(neededBlockType, block.state || {});
            const finalStates = BlockConversions.resetToDefaultStates(converted.states);

            const isCreative = player.gameMode === 1;
            let success = false;

            if (isCreative) {
                success = this.placeBlockAt(worldX, worldY, worldZ, dimid, converted.name, finalStates);
            } else {
                const foundSlot = this.inventoryHelper.findBlockInInventory(
                    player.getInventory(), converted.name, -1, finalStates
                );
                if (foundSlot !== -1) {
                    success = this.placeBlockAt(worldX, worldY, worldZ, dimid, converted.name, finalStates);
                    if (success) {
                        this.consumeItem(player, converted.name);
                    }
                }
            }

            if (success) {
                this.markAsPlaced(player.xuid, locationKey);
                const state = this.fastPlaceStates.get(player.xuid);
                if (state) state.placedCount++;
                placedCount++;
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

    /**
     * 使用空间分块索引获取玩家半径内的方块（性能优化）
     * 避免遍历全部方块，只返回附近分块中的方块
     */
    getBlocksInRadius(projection, centerX, centerY, centerZ, radius, chunkSize) {
        if (!projection.blockChunks || projection.blockChunks.size === 0) {
            // 回退到全量遍历
            return projection.blocks || [];
        }

        const projPos = projection.position;
        
        // 计算玩家在世界坐标系中相对于投影的位置
        const relX = centerX - projPos.x;
        const relY = centerY - projPos.y;
        const relZ = centerZ - projPos.z;
        
        // 计算需要检查的分块范围
        const minChunkX = Math.floor((relX - radius) / chunkSize);
        const maxChunkX = Math.floor((relX + radius) / chunkSize);
        const minChunkY = Math.floor((relY - radius) / chunkSize);
        const maxChunkY = Math.floor((relY + radius) / chunkSize);
        const minChunkZ = Math.floor((relZ - radius) / chunkSize);
        const maxChunkZ = Math.floor((relZ + radius) / chunkSize);

        const blocks = [];
        
        for (let cx = minChunkX; cx <= maxChunkX; cx++) {
            for (let cy = minChunkY; cy <= maxChunkY; cy++) {
                for (let cz = minChunkZ; cz <= maxChunkZ; cz++) {
                    const chunkKey = `${cx},${cy},${cz}`;
                    const chunkBlocks = projection.blockChunks.get(chunkKey);
                    if (chunkBlocks) {
                        for (const block of chunkBlocks) {
                            blocks.push(block);
                        }
                    }
                }
            }
        }

        return blocks;
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

        if (!item) {
            this.logDebug('EASYPLACE_NO_ITEM', { player: player.xuid });
            return true;
        }

        // 跳过非方块物品（剑、工具等）和空方块数据
        if (!block || !block.pos || block.pos.x === undefined) {
            return true;
        }

        const activeProj = this.projectionManager.getActiveProjectionByPlayer(player);
        if (!activeProj || !activeProj.projection) {
            this.logDebug('EASYPLACE_NO_PROJECTION', { player: player.xuid });
            return true;
        }
        
        this.logDebug('EASYPLACE_TRIGGERED', {
            player: player.xuid,
            itemType: item.type,
            blockPos: block?.pos,
            side: side,
            playerPos: player.pos
        });

        const projection = activeProj.projection;
        const projPos = projection.position;
        const projDim = projection.dimensions;
        const dimid = player.pos.dimid;

        const offsets = [
            { x: 0, y: 1, z: 0 },
            { x: 0, y: -1, z: 0 },
            { x: 0, y: 0, z: -1 },
            { x: 0, y: 0, z: 1 },
            { x: -1, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 }
        ];
        const offset = offsets[side] || offsets[0];
        
        const placeX = block.pos.x + offset.x;
        const placeY = block.pos.y + offset.y;
        const placeZ = block.pos.z + offset.z;
        const placeDim = block.pos.dimid || dimid;

        if (placeX < projPos.x || placeX >= projPos.x + projDim.x) {
            return true;
        }
        if (placeY < projPos.y || placeY >= projPos.y + projDim.y) {
            return true;
        }
        if (placeZ < projPos.z || placeZ >= projPos.z + projDim.z) {
            return true;
        }

        const currentLayer = activeProj.renderLayer;
        if (currentLayer !== -1) {
            const relativeY = placeY - projPos.y;
            if (relativeY !== currentLayer) {
                return true;
            }
        }

        const projRelativeX = placeX - projPos.x;
        const projRelativeY = placeY - projPos.y;
        const projRelativeZ = placeZ - projPos.z;

        // 使用方块位置索引加速查找 (O(1))
        const projBlock = projection.blockIndex 
            ? projection.blockIndex.get(`${projRelativeX},${projRelativeY},${projRelativeZ}`)
            : null;

        if (!projBlock) {
            this.logDebug('EASYPLACE_NO_PROJBLOCK', {
                placePos: { x: placeX, y: placeY, z: placeZ },
                projPos, projDim
            });
            return true;
        }

        let neededBlockType = projBlock.name;
        let neededBlockState = projBlock.state || {};

        this.logDebug('EASYPLACE_PROJBLOCK_FOUND', {
            placePos: { x: placeX, y: placeY, z: placeZ },
            neededBlockType,
            neededBlockState,
            itemType: item.type
        });

        if (neededBlockType === 'minecraft:air') {
            return true;
        }

        if (BlockConversions.isBanned(neededBlockType, placeDim)) {
            player.tell(`§c[EasyPlace] 禁止放置: ${neededBlockType}`);
            this.logDebug('EASYPLACE_BANNED', { neededBlockType, placeDim });
            return false;
        }

        const converted = BlockConversions.convertToValid(neededBlockType, neededBlockState);
        neededBlockType = converted.name;
        neededBlockState = BlockConversions.resetToDefaultStates(converted.states);

        this.logDebug('EASYPLACE_CONVERTED', {
            originalType: projBlock.name,
            convertedType: neededBlockType,
            convertedState: neededBlockState
        });

        const isCorrectBlock = this.blockMatcher.match(item.type, neededBlockType, null, neededBlockState);

        this.logDebug('EASYPLACE_MATCH_CHECK', {
            itemType: item.type,
            neededBlockType,
            isCorrectBlock
        });

        if (isCorrectBlock) {
            return true;
        }

        const isCreative = player.gameMode === 1;

        this.logDebug('EASYPLACE_CREATIVE_CHECK', { isCreative, gameMode: player.gameMode });

        if (isCreative) {
            const success = this.placeBlockAt(placeX, placeY, placeZ, placeDim, neededBlockType, neededBlockState);
            this.logDebug('EASYPLACE_CREATIVE_RESULT', { success, placePos: { x: placeX, y: placeY, z: placeZ } });
            if (success) {
                player.tell(`§a[EasyPlace] 已修正: ${neededBlockType}`);
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

        this.logDebug('EASYPLACE_INVENTORY_CHECK', { foundSlot, neededBlockType });

        if (foundSlot === -1) {
            const foundInShulker = this.inventoryHelper.findBlockInShulkerBoxes(
                player,
                player.getInventory(),
                neededBlockType,
                neededBlockState
            );

            this.logDebug('EASYPLACE_SHULKER_CHECK', { foundInShulker });

            if (foundInShulker === -1) {
                const totalCount = this.inventoryHelper.countBlock(player, neededBlockType);
                this.logDebug('EASYPLACE_NO_ITEM', { totalCount, neededBlockType });
                if (totalCount > 0) {
                    player.tell(`§c[EasyPlace] 无法从潜隐盒提取: §e${neededBlockType}`);
                } else {
                    player.tell(`§c[EasyPlace] 缺少: §e${neededBlockType}`);
                }
                return false;
            }
        }

        const success = this.placeBlockAt(placeX, placeY, placeZ, placeDim, neededBlockType, neededBlockState);
        this.logDebug('EASYPLACE_SURVIVAL_RESULT', { success, placePos: { x: placeX, y: placeY, z: placeZ } });
        if (success) {
            this.consumeItem(player, neededBlockType);
            player.tell(`§a[EasyPlace] 已修正: ${neededBlockType}`);
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

        const projBlock = projection.blockIndex
            ? projection.blockIndex.get(`${projRelativeX},${projRelativeY},${projRelativeZ}`)
            : null;

        if (!projBlock) return;

        const neededBlockType = projBlock.name;
        if (!neededBlockType || neededBlockType === 'minecraft:air') return;
        if (BlockConversions.isBanned(neededBlockType, blockDim)) return;

        // 转换方块
        const neededBlockState = projBlock.state || {};
        const converted = BlockConversions.convertToValid(neededBlockType, neededBlockState);
        const finalType = converted.name;
        const finalStates = BlockConversions.resetToDefaultStates(converted.states);

        // 检查放置的方块是否正确
        const actualBlockType = block.type || block.name || '';

        const isCorrect = this.blockMatcher.match(actualBlockType, finalType, null, finalStates);

        if (isCorrect) return; // 方块正确，不需要修正

        // 方块不正确，需要修正
        const success = this.placeBlockAt(blockX, blockY, blockZ, blockDim, finalType, finalStates);
        if (success) {
            player.tell(`§a[EasyPlace] 已修正: ${finalType}`);
        }
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
                const blockNbt = converter.buildBlockNbt(blockType, blockStates);
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
