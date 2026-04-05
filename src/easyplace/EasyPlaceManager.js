const { BlockMatcher } = require('./BlockMatcher');
const { PositionConverter } = require('./PositionConverter');
const { InventoryHelper } = require('./InventoryHelper');

class EasyPlaceManager {
    constructor(projectionManager, dataManager) {
        this.projectionManager = projectionManager;
        this.dataManager = dataManager;
        this.blockMatcher = new BlockMatcher();
        this.inventoryHelper = new InventoryHelper();
        this.positionConverter = new PositionConverter();
        this.playerStates = new Map();
        this.debugMode = false;
    }

    enable(player) {
        this.playerStates.set(player.xuid, { 
            enabled: true,
            placedCount: 0
        });
        player.tell('§a轻松放置已启用');
        player.tell('§7放置方块时会自动选择正确的方块');
        player.tell('§7支持从潜隐盒中提取物品');
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

    handleUseItemOn(player, item, block, side, pos) {
        logger.info(`[EasyPlace] handleUseItemOn called for ${player.name}`);

        if (!this.isEnabled(player)) {
            logger.info(`[EasyPlace] Not enabled for ${player.name}`);
            return true;
        }

        if (!item) {
            logger.info(`[EasyPlace] No item`);
            return true;
        }

        logger.info(`[EasyPlace] Item type: ${item.type}, isBlock: ${item.isBlock}`);

        const activeProj = this.projectionManager.getActiveProjectionByPlayer(player);
        if (!activeProj) {
            logger.info(`[EasyPlace] No active projection for ${player.name}`);
            return true;
        }

        logger.info(`[EasyPlace] Active projection: ${activeProj.projection?.name}`);

        const placePos = this.calculatePlacePosition(block, side);
        logger.info(`[EasyPlace] Place position: ${JSON.stringify(placePos)}`);

        if (!this.isInProjectionRange(placePos, activeProj.projection)) {
            logger.info(`[EasyPlace] Position not in projection range`);
            return true;
        }

        const projPos = this.positionConverter.worldToProjection(placePos, activeProj.projection);
        logger.info(`[EasyPlace] Projection position: ${JSON.stringify(projPos)}`);

        const projBlock = this.findProjectionBlock(activeProj.projection, projPos);

        if (!projBlock) {
            logger.info(`[EasyPlace] No projection block at this position`);
            return true;
        }

        const neededBlockType = projBlock.name;
        const neededBlockState = projBlock.state || null;

        logger.info(`[EasyPlace] Need: ${neededBlockType}, Have: ${item.type}`);

        if (this.blockMatcher.match(item.type, neededBlockType, null, neededBlockState)) {
            logger.info(`[EasyPlace] Correct block!`);
            return true;
        }

        logger.info(`[EasyPlace] Wrong block, trying to auto-select`);

        const selected = this.inventoryHelper.selectBlock(player, neededBlockType, neededBlockState);
        if (selected) {
            logger.info(`[EasyPlace] Auto-selected: ${neededBlockType}`);
            return true;
        }

        const totalCount = this.inventoryHelper.countBlock(player, neededBlockType);
        if (totalCount > 0) {
            player.tell(`§c无法从潜隐盒提取: §e${neededBlockType}`);
        } else {
            player.tell(`§c缺少: §e${neededBlockType}`);
        }
        return false;
    }

    calculatePlacePosition(block, side) {
        const pos = block.pos;
        const offsets = [
            { x: 0, y: 1, z: 0 },
            { x: 0, y: -1, z: 0 },
            { x: 0, y: 0, z: -1 },
            { x: 0, y: 0, z: 1 },
            { x: -1, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 }
        ];
        const offset = offsets[side] || { x: 0, y: 1, z: 0 };
        return {
            x: pos.x + offset.x,
            y: pos.y + offset.y,
            z: pos.z + offset.z,
            dimid: pos.dimid
        };
    }

    findProjectionBlock(projection, projPos) {
        if (!projection.blocks) return null;

        for (const block of projection.blocks) {
            if (block.pos[0] === projPos.x &&
                block.pos[1] === projPos.y &&
                block.pos[2] === projPos.z) {
                return block;
            }
        }
        return null;
    }

    isInProjectionRange(pos, projection) {
        const pPos = projection.position;
        const dim = projection.dimensions;

        if (!pPos || !dim) return false;

        return pos.dimid === projection.dimension &&
               pos.x >= pPos.x && pos.x < pPos.x + dim.x &&
               pos.y >= pPos.y && pos.y < pPos.y + dim.y &&
               pos.z >= pPos.z && pos.z < pPos.z + dim.z;
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
