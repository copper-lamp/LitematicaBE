// DataManager - 数据持久化管理
// 管理投影数据、玩家数据的存储和加载

const DATA_PATH = './plugins/LitematicaBE/data/';
const PROJECTIONS_FILE = 'projections.json';
const PLAYER_DATA_FILE = 'player_data.json';

class DataManager {
    constructor() {
        this.projections = new Map();
        this.playerData = new Map();
        this.ensureDataDirectory();
        this.loadAll();
    }

    /**
     * 确保数据目录存在
     */
    ensureDataDirectory() {
        if (!File.exists(DATA_PATH)) {
            File.mkdir(DATA_PATH);
            logger.info(`Created data directory: ${DATA_PATH}`);
        }
    }

    /**
     * 加载所有数据
     */
    loadAll() {
        this.loadProjections();
        this.loadPlayerData();
    }

    /**
     * 保存所有数据
     */
    saveAll() {
        this.saveProjections();
        this.savePlayerData();
    }

    // ==================== 投影数据管理 ====================

    /**
     * 加载投影数据
     */
    loadProjections() {
        const filePath = DATA_PATH + PROJECTIONS_FILE;
        
        if (!File.exists(filePath)) {
            logger.info('No projections file found, starting with empty projections');
            return;
        }

        try {
            const content = File.readFrom(filePath);
            const data = JSON.parse(content);
            
            if (data.projections && Array.isArray(data.projections)) {
                for (const proj of data.projections) {
                    this.projections.set(proj.id, proj);
                }
            }
            
            logger.info(`Loaded ${this.projections.size} projections`);
        } catch (e) {
            logger.error(`Failed to load projections: ${e.message}`);
        }
    }

    /**
     * 保存投影数据
     * 对于超大型投影，不保存 blocks 数组（因为数据存储在分块文件中）
     */
    saveProjections() {
        const filePath = DATA_PATH + PROJECTIONS_FILE;
        
        try {
            // 处理投影数据，移除超大数组
            const processedProjections = Array.from(this.projections.values()).map(proj => {
                // 如果是超大型投影或 blocks 数组过大，移除 blocks
                if (proj.isMega || (proj.blocks && proj.blocks.length > 100000)) {
                    return {
                        ...proj,
                        blocks: [], // 清空 blocks 数组
                        blockIndex: null, // 清空索引
                        blockChunks: null
                    };
                }
                return proj;
            });
            
            const data = {
                version: '2.0.0',
                lastUpdate: Date.now(),
                projections: processedProjections
            };
            
            File.writeTo(filePath, JSON.stringify(data, null, 2));
            logger.debug(`Saved ${this.projections.size} projections`);
        } catch (e) {
            logger.error(`Failed to save projections: ${e.message}`);
        }
    }

    /**
     * 添加投影
     */
    addProjection(projection) {
        this.projections.set(projection.id, projection);
        this.saveProjections();
        return projection;
    }

    /**
     * 获取投影
     */
    getProjection(id) {
        return this.projections.get(id);
    }

    /**
     * 获取所有投影
     */
    getAllProjections() {
        return Array.from(this.projections.values());
    }

    /**
     * 更新投影
     */
    updateProjection(id, updates) {
        const projection = this.projections.get(id);
        if (!projection) return null;

        Object.assign(projection, updates);
        projection.lastUpdate = Date.now();
        this.saveProjections();
        return projection;
    }

    /**
     * 删除投影
     */
    removeProjection(id) {
        const projection = this.projections.get(id);

        // Delete mega schematic chunk files if this is a mega projection
        if (projection && projection.isMega && projection.schematicId) {
            try {
                const megaManager = global.megaManager;
                if (megaManager) {
                    megaManager.deleteSchematic(projection.schematicId);
                    logger.info(`[DataManager] Deleted mega schematic chunks for: ${projection.schematicId}`);
                }
            } catch (e) {
                logger.error(`[DataManager] Failed to delete mega schematic chunks: ${e.message}`);
            }
        }

        const result = this.projections.delete(id);
        if (result) {
            this.saveProjections();
        }
        return result;
    }

    /**
     * 获取指定维度的所有投影
     */
    getProjectionsByDimension(dimension) {
        return this.getAllProjections().filter(p => p.dimension === dimension);
    }

    /**
     * 获取指定玩家创建的投影
     */
    getProjectionsByPlayer(xuid) {
        return this.getAllProjections().filter(p => p.author === xuid);
    }

    // ==================== 玩家数据管理 ====================

    /**
     * 加载玩家数据
     */
    loadPlayerData() {
        const filePath = DATA_PATH + PLAYER_DATA_FILE;
        
        if (!File.exists(filePath)) {
            logger.info('No player data file found, starting with empty data');
            return;
        }

        try {
            const content = File.readFrom(filePath);
            const data = JSON.parse(content);
            
            if (data.players && Array.isArray(data.players)) {
                for (const player of data.players) {
                    this.playerData.set(player.xuid, player);
                }
            }
            
            logger.info(`Loaded data for ${this.playerData.size} players`);
        } catch (e) {
            logger.error(`Failed to load player data: ${e.message}`);
        }
    }

    /**
     * 保存玩家数据
     */
    savePlayerData() {
        const filePath = DATA_PATH + PLAYER_DATA_FILE;
        
        try {
            const data = {
                version: '2.0.0',
                lastUpdate: Date.now(),
                players: Array.from(this.playerData.values())
            };
            
            File.writeTo(filePath, JSON.stringify(data, null, 2));
            logger.debug(`Saved data for ${this.playerData.size} players`);
        } catch (e) {
            logger.error(`Failed to save player data: ${e.message}`);
        }
    }

    /**
     * 获取玩家数据
     */
    getPlayerData(xuid) {
        if (!this.playerData.has(xuid)) {
            // 创建默认玩家数据
            const defaultData = this.createDefaultPlayerData(xuid);
            this.playerData.set(xuid, defaultData);
        }
        return this.playerData.get(xuid);
    }

    /**
     * 更新玩家数据
     */
    updatePlayerData(xuid, updates) {
        const data = this.getPlayerData(xuid);
        Object.assign(data, updates);
        this.savePlayerData();
        return data;
    }

    /**
     * 创建默认玩家数据
     */
    createDefaultPlayerData(xuid) {
        return {
            xuid: xuid,
            toolMode: 'none',           // none/place/rotate/build
            currentProjectionId: null,
            buildLayer: 0,
            loadedProjections: [],      // 已加载的投影ID列表
            settings: {
                autoLoadInRange: true,
                showActionBar: true,
                showBounds: true,
                defaultOpacity: 0.8,
                notificationRange: 50
            },
            lastLogin: Date.now()
        };
    }

    /**
     * 设置玩家工具模式
     */
    setPlayerToolMode(xuid, mode) {
        return this.updatePlayerData(xuid, { toolMode: mode });
    }

    /**
     * 设置玩家当前投影
     */
    setPlayerCurrentProjection(xuid, projectionId) {
        return this.updatePlayerData(xuid, { currentProjectionId: projectionId });
    }

    /**
     * 添加玩家已加载的投影
     */
    addPlayerLoadedProjection(xuid, projectionId) {
        const data = this.getPlayerData(xuid);
        if (!data.loadedProjections.includes(projectionId)) {
            data.loadedProjections.push(projectionId);
            this.savePlayerData();
        }
    }

    /**
     * 移除玩家已加载的投影
     */
    removePlayerLoadedProjection(xuid, projectionId) {
        const data = this.getPlayerData(xuid);
        const index = data.loadedProjections.indexOf(projectionId);
        if (index > -1) {
            data.loadedProjections.splice(index, 1);
            this.savePlayerData();
        }
    }

    // ==================== 工具方法 ====================

    /**
     * 生成唯一ID
     */
    generateId() {
        return 'proj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * 检查玩家是否加载了指定投影
     */
    isProjectionLoadedByPlayer(xuid, projectionId) {
        const data = this.getPlayerData(xuid);
        return data.loadedProjections.includes(projectionId);
    }

    /**
     * 获取加载了指定投影的所有玩家
     */
    getPlayersLoadingProjection(projectionId) {
        const players = [];
        for (const [xuid, data] of this.playerData) {
            if (data.loadedProjections.includes(projectionId)) {
                players.push(xuid);
            }
        }
        return players;
    }
}

module.exports = { DataManager };
