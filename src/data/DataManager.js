// DataManager - 数据持久化管理
// 管理投影数据、玩家数据的存储和加载

const DATA_PATH = './plugins/LitematicaBE/data/';
const PROJECTIONS_FILE = 'projections.json';
const PLAYER_DATA_FILE = 'player_data.json';

const { normalizeProjection } = require('./projectionFlags');

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
    /**
     * 把一条投影记录里的类型/字段修正到当前约定。见 src/data/projectionFlags.js：
     * 判定逻辑只有一处，避免各调用方各写一套（`isMega !== true` 曾让重启后的 MEGA 无法自愈）。
     *
     * @param {object} proj
     * @returns {object} 同一个对象（就地修正）
     */
    normalizeProjection(proj) {
        return normalizeProjection(proj);
    }

    /**
     * 按 id 取投影（读的时候也归一化一次，防止运行期被写脏）
     */
    getProjection(id) {
        const proj = this.projections.get(id);
        return proj ? this.normalizeProjection(proj) : null;
    }

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
                    // 归一化 isMega：历史数据里它被写成过 schematicId 字符串
                    // （`const isMega = x.isMega && x.schematicId` 的短路返回值），
                    // 而严格判定 `isMega !== true` 会因此永远为假 → 重启后 MEGA 注入状态建不起来。
                    this.normalizeProjection(proj);
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
        this.normalizeProjection(projection);
        this.projections.set(projection.id, projection);
        this.saveProjections();
        return projection;
    }

    /**
     * 获取投影
     */
    getProjection(id) {
        const proj = this.projections.get(id);
        return proj ? this.normalizeProjection(proj) : null;
    }

    /**
     * 获取所有投影
     */
    getAllProjections() {
        return Array.from(this.projections.values()).map(p => this.normalizeProjection(p));
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
                    this.migratePlayerData(player);
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
        // 老存档补字段（多投影：loadedProjections / projectionLayers / projectionLayerModes）
        return this.migratePlayerData(this.playerData.get(xuid));
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
     * 补齐/迁移玩家数据里与"多投影"相关的字段（就地修改）。
     *
     * 3.0.x 的存档只记 `currentProjectionId`（当时只能同时看一个投影）。
     * 读入时把它当成"唯一已加载的投影 + 木剑控制的那一个"，
     * 否则老玩家升级后 `loadedProjections` 为空，进服恢复会走不到任何投影。
     *
     * @param {object} data
     * @returns {object} 同一个对象
     */
    migratePlayerData(data) {
        if (!data || typeof data !== 'object') return data;
        if (!Array.isArray(data.loadedProjections)) data.loadedProjections = [];
        // 去重 + 只留字符串（历史上有过手改坏的数据）
        data.loadedProjections = data.loadedProjections
            .filter((id) => typeof id === 'string' && id)
            .filter((id, i, arr) => arr.indexOf(id) === i);

        if (data.currentProjectionId === undefined) data.currentProjectionId = null;
        if (data.currentProjectionId && !data.loadedProjections.includes(data.currentProjectionId)) {
            data.loadedProjections.push(data.currentProjectionId);
        }
        if (!data.currentProjectionId && data.loadedProjections.length) {
            data.currentProjectionId = data.loadedProjections[data.loadedProjections.length - 1];
        }

        if (!data.projectionLayers || typeof data.projectionLayers !== 'object') {
            data.projectionLayers = {};
        }
        if (!data.projectionLayerModes || typeof data.projectionLayerModes !== 'object') {
            data.projectionLayerModes = {};
        }
        // 旧字段（主控层）落到投影级记录里，供按投影恢复
        const pid = data.currentProjectionId;
        if (pid) {
            if (!Number.isFinite(data.projectionLayers[pid])) {
                data.projectionLayers[pid] = Number.isFinite(data.currentRenderLayer) ? data.currentRenderLayer : -1;
            }
            if (typeof data.projectionLayerModes[pid] !== 'boolean') {
                data.projectionLayerModes[pid] = !!data.renderLayerMode;
            }
        }
        return data;
    }

    /**
     * 该玩家当前**同时显示**的投影 id 列表（多投影）。
     * 顺序即加载顺序；最后一项不一定是木剑控制的那一份（看 currentProjectionId）。
     */
    getPlayerLoadedProjections(xuid) {
        const data = this.migratePlayerData(this.getPlayerData(xuid));
        return Array.isArray(data.loadedProjections) ? data.loadedProjections.slice() : [];
    }

    /** 覆盖写入"已加载投影列表"（渲染器切主控/卸载时调） */
    setPlayerLoadedProjections(xuid, ids) {
        const list = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id) : [];
        return this.updatePlayerData(xuid, {
            loadedProjections: list.filter((id, i, arr) => arr.indexOf(id) === i),
        });
    }

    /**
     * 创建默认玩家数据
     */
    createDefaultPlayerData(xuid) {
        return {
            xuid: xuid,
            toolMode: 'none',           // none/place/rotate/build
            currentProjectionId: null,  // 木剑当前控制的投影
            buildLayer: 0,
            loadedProjections: [],      // 同时显示的投影ID列表（多投影）
            projectionLayers: {},       // projectionId -> 该投影当前层
            projectionLayerModes: {},   // projectionId -> 是否逐层显示
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

    /**
     * 删除一个投影时，把它从**所有**玩家的"已加载列表"里摘掉
     * （在线玩家的会话由渲染器撤，离线玩家的记录只能在这里清）。
     * @returns {number} 受影响的玩家数
     */
    removeProjectionFromAllPlayers(projectionId) {
        if (!projectionId) return 0;
        let touched = 0;
        for (const data of this.playerData.values()) {
            this.migratePlayerData(data);
            let changed = false;
            const i = data.loadedProjections.indexOf(projectionId);
            if (i >= 0) {
                data.loadedProjections.splice(i, 1);
                changed = true;
            }
            if (data.projectionLayers && projectionId in data.projectionLayers) {
                delete data.projectionLayers[projectionId];
                changed = true;
            }
            if (data.projectionLayerModes && projectionId in data.projectionLayerModes) {
                delete data.projectionLayerModes[projectionId];
                changed = true;
            }
            if (data.currentProjectionId === projectionId) {
                data.currentProjectionId = data.loadedProjections.length
                    ? data.loadedProjections[data.loadedProjections.length - 1]
                    : null;
                changed = true;
            }
            if (changed) touched++;
        }
        if (touched) this.savePlayerData();
        return touched;
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
