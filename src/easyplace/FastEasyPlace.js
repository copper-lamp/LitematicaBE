const { BlockConversions } = require('./BlockConversions');
const { InventoryHelper } = require('./InventoryHelper');
const { SpatialIndexUtils } = require('./SpatialIndexUtils');
const { BlockStateConverters } = require('../mappings/BlockStateConverters');
const { BlockMappingRegistry } = require('../mappings/BlockMappingRegistry');
const { PlacementLogger } = require('./PlacementLogger');

class FastEasyPlace {
    static SEARCH_RADIUS = 5;
    static TICK_INTERVAL = 50;
    static MAX_PLACES_PER_TICK = 5;

    constructor(projectionManager, dataManager) {
        this.projectionManager = projectionManager;
        this.dataManager = dataManager;
        this.inventoryHelper = new InventoryHelper();
        
        this.playerStates = new Map();
        this.placedLocations = new Map();
        this.tickInterval = null;
        this.debugMode = false;
        this.placementLogger = new PlacementLogger();
        this.logFailures = true;
    }

    enable(player) {
        if (this.playerStates.has(player.xuid)) {
            player.tell('§c投影打印机已启用');
            return;
        }

        this.playerStates.set(player.xuid, {
            enabled: true,
            placedCount: 0,
            lastPlaceTime: 0
        });

        player.tell('§a投影打印机已启用');
        player.tell('§7将在5格范围内自动放置投影方块');
        player.tell('§7使用 /lit printer 关闭');

        if (!this.tickInterval) {
            this.startTickLoop();
        }
    }

    disable(player) {
        this.playerStates.delete(player.xuid);
        this.placedLocations.delete(player.xuid);
        
        player.tell('§c投影打印机已禁用');

        if (this.playerStates.size === 0 && this.tickInterval) {
            this.stopTickLoop();
        }
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

    startTickLoop() {
        if (this.tickInterval) {
            return;
        }
        
        this.tickInterval = setInterval(() => {
            this.onTick();
        }, FastEasyPlace.TICK_INTERVAL);
        
        if (this.debugMode) {
            logger.info('[FastEasyPlace] Tick loop started');
        }
    }

    stopTickLoop() {
        if (this.tickInterval) {
            clearInterval(this.tickInterval);
            this.tickInterval = null;
            
            if (this.debugMode) {
                logger.info('[FastEasyPlace] Tick loop stopped');
            }
        }
    }

    onTick() {
        const players = mc.getOnlinePlayers();
        
        for (const player of players) {
            if (!this.isEnabled(player)) continue;
            
            try {
                this.processPlayer(player);
            } catch (e) {
                if (this.debugMode) {
                    logger.error(`[FastEasyPlace] Error processing player ${player.name}: ${e.message}`);
                }
            }
        }
    }

    processPlayer(player) {
        const activeProj = this.projectionManager.getActiveProjectionByPlayer(player);
        if (!activeProj || !activeProj.projection) {
            return;
        }

        const projection = activeProj.projection;
        const currentLayer = activeProj.renderLayer;
        const playerPos = player.pos;

        const targetBlocks = this.findBlocksInRadius(projection, playerPos, currentLayer);

        if (targetBlocks.length === 0) {
            return;
        }

        let placedThisTick = 0;
        for (const target of targetBlocks) {
            if (placedThisTick >= FastEasyPlace.MAX_PLACES_PER_TICK) {
                break;
            }
            if (this.tryPlaceBlock(player, target, projection)) {
                placedThisTick++;
            }
        }
    }

    findBlocksInRadius(projection, playerPos, currentLayer) {
        const results = [];
        const projPos = projection.position;
        const dimid = playerPos.dimid;

        const centerX = Math.floor(playerPos.x);
        const centerY = Math.floor(playerPos.y);
        const centerZ = Math.floor(playerPos.z);
        const radius = FastEasyPlace.SEARCH_RADIUS;
        const radiusSquared = radius * radius;

        const candidateBlocks = SpatialIndexUtils.getBlocksInRadius(
            projection, centerX, centerY, centerZ, radius
        );

        for (const block of candidateBlocks) {
            const worldX = projPos.x + block.pos[0];
            const worldY = projPos.y + block.pos[1];
            const worldZ = projPos.z + block.pos[2];

            const distSquared =
                Math.pow(worldX - centerX, 2) +
                Math.pow(worldY - centerY, 2) +
                Math.pow(worldZ - centerZ, 2);

            if (distSquared > radiusSquared) {
                continue;
            }

            if (currentLayer !== -1 && block.pos[1] !== currentLayer) {
                continue;
            }

            const worldBlock = mc.getBlock(worldX, worldY, worldZ, dimid);
            const blockType = worldBlock ? (worldBlock.type || worldBlock.name || '') : '';

            if (blockType !== 'minecraft:air') {
                continue;
            }

            const locationKey = `${worldX},${worldY},${worldZ}`;
            
            if (this.wasPlacedThisTick(player.xuid, locationKey)) {
                continue;
            }

            results.push({
                location: { x: worldX, y: worldY, z: worldZ, dimid: dimid },
                projBlock: block,
                locationKey: locationKey
            });
        }

        return results;
    }

    wasPlacedThisTick(playerXuid, locationKey) {
        const playerPlaces = this.placedLocations.get(playerXuid);
        return playerPlaces?.has(locationKey) || false;
    }

    markAsPlaced(playerXuid, locationKey) {
        if (!this.placedLocations.has(playerXuid)) {
            this.placedLocations.set(playerXuid, new Set());
        }
        this.placedLocations.get(playerXuid).add(locationKey);
    }

    tryPlaceBlock(player, target, projection) {
        const { location, projBlock, locationKey } = target;
        const javaName = projBlock.name;
        const javaStates = projBlock.state || {};

        if (BlockConversions.isBanned(javaName, player.pos.dimid)) {
            return false;
        }

        if (!BlockConversions.isWhitelistedState(javaName, javaStates)) {
            return false;
        }

        // 1. Java name -> BE name
        const registry = new BlockMappingRegistry();
        const mapping = registry.getMapping(javaName);
        const beName = mapping ? mapping.b : javaName;

        // 2. Java states -> BE states
        const stateConverter = new BlockStateConverters();
        const beStates = stateConverter.convertJavaToBedrock(javaName, javaStates);

        // 3. Apply banned-to-valid mapping and reset default states
        const convertedBlock = BlockConversions.convertToValid(beName, beStates);

        // 4. Redstone torch lit state -> block rename (unlit is a separate BE block)
        if (javaName === 'minecraft:redstone_torch' || javaName === 'minecraft:redstone_wall_torch') {
            if (javaStates.lit === 'false' || javaStates.lit === false) {
                convertedBlock.name = 'unlit_redstone_torch';
            }
        }

        const finalStates = BlockConversions.resetToDefaultStates(convertedBlock.states);

        const isCreative = player.gameMode === 1;

        let result;
        if (isCreative) {
            result = this.placeBlockCreative(player, location, convertedBlock.name, finalStates);
        } else {
            result = this.placeBlockSurvival(player, location, convertedBlock.name, finalStates);
        }

        if (result.success) {
            this.markAsPlaced(player.xuid, locationKey);
            if (this.logFailures) {
                this.placementLogger.logSuccess();
            }
        } else if (this.logFailures && result.error) {
            this.placementLogger.logFailure(
                player.name,
                javaName,
                convertedBlock.name,
                javaStates,
                finalStates,
                result.cmd || '',
                result.error
            );
        }

        return result.success;
    }

    placeBlockCreative(player, location, blockName, blockStates) {
        try {
            if (!blockName || typeof blockName !== 'string') {
                return { success: false, error: 'Invalid block name' };
            }
            
            const x = Math.floor(location.x);
            const y = Math.floor(location.y);
            const z = Math.floor(location.z);
            const dimid = parseInt(location.dimid) || 0;
            
            const block = mc.getBlock(x, y, z, dimid);
            if (block) {
                const existingType = block.type || block.name || '';
                if (existingType !== 'minecraft:air') {
                    return { success: false, error: `Target occupied by ${existingType}` };
                }
            }

            const cmd = this.buildSetBlockCommand(x, y, z, blockName, blockStates);
            const result = mc.runcmdEx(cmd);

            if (result.success) {
                const state = this.playerStates.get(player.xuid);
                if (state) {
                    state.placedCount++;
                }

                if (this.debugMode) {
                    player.tell(`§a[Printer] 放置: ${blockName}`);
                }
                return { success: true };
            }
            return { success: false, cmd, error: `setblock failed: ${result.output || 'unknown error'}` };
        } catch (e) {
            return { success: false, error: `Exception: ${e.message}` };
        }
    }

    buildSetBlockCommand(x, y, z, blockName, blockStates) {
        let cmd = `setblock ${x} ${y} ${z} ${blockName}`;

        if (blockStates && Object.keys(blockStates).length > 0) {
            const stateParts = [];
            for (const [key, value] of Object.entries(blockStates)) {
                let stateValue;
                if (typeof value === 'string') {
                    stateValue = `"${value}"`;
                } else if (typeof value === 'boolean') {
                    stateValue = value ? 'true' : 'false';
                } else if (typeof value === 'number' && (value === 1 || value === 0)) {
                    // BE boolean states often use true/false instead of 1/0
                    const boolStates = new Set([
                        'button_pressed_bit', 'open_bit', 'door_hinge_bit', 'upper_block_bit',
                        'upside_down_bit', 'powered_bit', 'output_lit_bit', 'output_subtract_bit',
                        'triggered_bit', 'attached_bit', 'disarmed_bit', 'suspended_bit',
                        'toggle_bit', 'infiniburn_bit', 'explode_bit', 'age_bit',
                        'allow_underwater_bit', 'dead_bit', 'occupied_bit', 'head_piece_bit',
                        'extinguished', 'persistent_bit', 'stripped_bit', 'update_bit',
                        'lit_bit', 'in_wall_bit', 'locked_bit', 'rail_data_bit', 'extended_bit'
                    ]);
                    if (boolStates.has(key)) {
                        stateValue = value === 1 ? 'true' : 'false';
                    } else {
                        stateValue = String(value);
                    }
                } else {
                    stateValue = String(value);
                }
                stateParts.push(`"${key}"=${stateValue}`);
            }
            if (stateParts.length > 0) {
                cmd += ` [${stateParts.join(',')}]`;
            }
        }

        return cmd;
    }

    placeBlockSurvival(player, location, blockName, blockStates) {
        const placeableItem = BlockConversions.getPlaceableItem(blockName);
        const itemType = placeableItem || blockName;

        const foundSlot = this.inventoryHelper.findBlockInInventory(
            player.getInventory(),
            itemType,
            -1,
            blockStates
        );

        if (foundSlot === -1) {
            const foundInShulker = this.inventoryHelper.findBlockInShulkerBoxes(
                player,
                player.getInventory(),
                itemType,
                blockStates
            );

            if (foundInShulker === -1) {
                return { success: false, error: `No ${blockName} in inventory` };
            }

            const selected = this.inventoryHelper.selectBlock(player, itemType, blockStates);
            if (!selected) {
                return { success: false, error: `Failed to select ${blockName}` };
            }
        } else {
            const selectedSlot = this.inventoryHelper.getSelectedSlot(player);
            if (foundSlot !== selectedSlot) {
                this.inventoryHelper.swapItems(player.getInventory(), selectedSlot, foundSlot);
            }
        }

        return this.placeBlockWithItemConsume(player, location, blockName, blockStates, itemType);
    }

    placeBlockWithItemConsume(player, location, blockName, blockStates, itemType) {
        try {
            if (!blockName || typeof blockName !== 'string') {
                return { success: false, error: 'Invalid block name' };
            }
            
            const x = Math.floor(location.x);
            const y = Math.floor(location.y);
            const z = Math.floor(location.z);
            const dimid = parseInt(location.dimid) || 0;
            
            const block = mc.getBlock(x, y, z, dimid);
            if (block) {
                const existingType = block.type || block.name || '';
                if (existingType !== 'minecraft:air') {
                    return { success: false, error: `Target occupied by ${existingType}` };
                }
            }

            const cmd = this.buildSetBlockCommand(x, y, z, blockName, blockStates);
            const result = mc.runcmdEx(cmd);

            if (result.success) {
                this.consumeItem(player, itemType);
                
                const state = this.playerStates.get(player.xuid);
                if (state) {
                    state.placedCount++;
                }

                return { success: true };
            }
            return { success: false, cmd, error: `setblock failed: ${result.output || 'unknown error'}` };
        } catch (e) {
            return { success: false, error: `Exception: ${e.message}` };
        }
    }

    consumeItem(player, itemType) {
        const inventory = player.getInventory();
        const selectedSlot = this.inventoryHelper.getSelectedSlot(player);
        const item = inventory.getItem(selectedSlot);

        if (!item || item.isNull()) return;

        const specialConversion = BlockConversions.getSpecialConversion(itemType);
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
    }

    setDebugMode(enabled) {
        this.debugMode = enabled;
        logger.info(`[FastEasyPlace] Debug mode: ${enabled}`);
    }

    getStats(player) {
        const state = this.playerStates.get(player.xuid);
        if (!state) return null;
        return {
            enabled: state.enabled,
            placedCount: state.placedCount || 0
        };
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

    cleanup() {
        this.stopTickLoop();
        this.playerStates.clear();
        this.placedLocations.clear();
    }
}

module.exports = { FastEasyPlace };
