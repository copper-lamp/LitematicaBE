// ProjectionManager - 统一的投影活动状态管理器
// 管理玩家的活动投影状态，解决状态分离导致的同步问题

class ProjectionManager {
    constructor() {
        this.activeProjections = new Map();
        this.onLayerChange = null;
        this.debugMode = false;
    }

    setLayerChangeCallback(callback) {
        this.onLayerChange = callback;
    }

    activateProjection(player, projection) {
        const playerId = player.xuid;
        const playerName = player.name;

        if (this.debugMode) {
            logger.info(`[ProjMgr] activateProjection called for ${playerName} (${playerId})`);
            logger.info(`[ProjMgr] Projection ID: ${projection.id}, Name: ${projection.name}`);
            logger.info(`[ProjMgr] Current active projections: ${JSON.stringify([...this.activeProjections.keys()])}`);
        }

        const activeProj = {
            projection: { ...projection },
            renderLayer: projection.renderLayer !== undefined ? projection.renderLayer : -1,
            lastUpdate: Date.now(),
            playerXuid: playerId
        };

        this.activeProjections.set(playerId, activeProj);

        if (this.debugMode) {
            logger.info(`[ProjMgr] Activated projection ${projection.id} for ${playerName}`);
            logger.info(`[ProjMgr] Active projections after: ${JSON.stringify([...this.activeProjections.keys()])}`);
        }

        return activeProj;
    }

    getActiveProjection(playerXuid) {
        const result = this.activeProjections.get(playerXuid);
        if (this.debugMode) {
            logger.info(`[ProjMgr] getActiveProjection(${playerXuid}): ${result ? 'found' : 'null'}`);
        }
        return result;
    }

    getActiveProjectionByPlayer(player) {
        const playerId = player.xuid;
        const playerName = player.name;
        const result = this.activeProjections.get(playerId);

        if (this.debugMode) {
            logger.info(`[ProjMgr] getActiveProjectionByPlayer(${playerName}) xuid=${playerId}: ${result ? 'found' : 'null'}`);
            logger.info(`[ProjMgr] All active player IDs: ${JSON.stringify([...this.activeProjections.keys()])}`);
        }

        return result;
    }

    hasActiveProjection(playerXuid) {
        return this.activeProjections.has(playerXuid);
    }

    removeActiveProjection(playerXuid) {
        const removed = this.activeProjections.delete(playerXuid);
        if (this.debugMode) {
            logger.info(`[ProjMgr] Removed active projection for ${playerXuid}, was present: ${removed}`);
        }
        return removed;
    }

    switchLayer(player, direction) {
        const active = this.getActiveProjectionByPlayer(player);
        if (!active) {
            logger.warn(`[ProjMgr] switchLayer failed: No active projection for ${player.name}`);
            return null;
        }

        const { projection, renderLayer } = active;
        const maxLayer = (projection.dimensions?.y || 1) - 1;
        let newLayer = renderLayer;

        switch (direction) {
            case 'up':
                if (renderLayer === -1) {
                    newLayer = 0;
                } else {
                    newLayer = Math.min(renderLayer + 1, maxLayer);
                }
                break;
            case 'down':
                if (renderLayer === -1) {
                    newLayer = maxLayer;
                } else {
                    newLayer = Math.max(renderLayer - 1, 0);
                }
                break;
            case 'toggle':
                newLayer = renderLayer === -1 ? 0 : -1;
                break;
            case 'all':
                newLayer = -1;
                break;
            default:
                break;
        }

        if (newLayer !== renderLayer) {
            active.renderLayer = newLayer;
            active.lastUpdate = Date.now();

            logger.info(`[ProjMgr] Layer switched for ${player.name}: ${renderLayer} -> ${newLayer}`);

            if (this.onLayerChange) {
                this.onLayerChange(player, active.projection, newLayer);
            }
        } else {
            logger.info(`[ProjMgr] Layer unchanged for ${player.name}: ${renderLayer}`);
        }

        return active;
    }

    getFilteredBlocks(projection, layer) {
        if (!projection.blocks) {
            logger.error(`[ProjMgr] No blocks in projection ${projection.id}`);
            return [];
        }

        if (layer === -1) {
            return projection.blocks;
        }

        return projection.blocks.filter(b => b.pos[1] === layer);
    }

    getLayerInfo(projection, currentLayer) {
        const totalLayers = projection.dimensions?.y || 1;
        const totalBlocks = projection.blocks?.length || 0;
        let currentLayerBlocks = totalBlocks;

        if (currentLayer !== -1) {
            currentLayerBlocks = projection.blocks?.filter(b => b.pos[1] === currentLayer).length || 0;
        }

        return {
            currentLayer,
            totalLayers,
            totalBlocks,
            currentLayerBlocks,
            progress: currentLayer === -1 ? 100 : Math.round(((currentLayer + 1) / totalLayers) * 100)
        };
    }

    clearAll() {
        const count = this.activeProjections.size;
        this.activeProjections.clear();
        logger.info(`[ProjMgr] Cleared all ${count} active projections`);
    }

    getStats() {
        return {
            activeCount: this.activeProjections.size,
            projections: Array.from(this.activeProjections.entries()).map(([xuid, active]) => ({
                playerXuid: xuid,
                projectionId: active.projection.id,
                layer: active.renderLayer
            }))
        };
    }
}

module.exports = { ProjectionManager };