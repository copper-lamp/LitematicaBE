// MegaProjectionRenderer - 超大型投影 LOD 分块管理器
// 负责视口计算、LOD分块按需加载/卸载，方块数据提供给 ProjectionRenderer 统一渲染
// 不直接生成粒子 —— 所有渲染由 ProjectionRenderer 处理
// 支持 500,000+ 方块的超大型投影流畅渲染

const { LODRenderer } = require('./LODRenderer');
const { DebugLogger } = require('../core/DebugLogger');

const CHUNK_SIZE = 16;

class MegaProjectionRenderer {
    constructor(megaSchematicManager) {
        this.megaManager = megaSchematicManager;
        this.lodRenderer = new LODRenderer();
        this.renderStates = new Map();
        this.tickCount = 0;
        this.debugMode = false; // 调试模式开关
        this.fileDebug = false; // 文件日志开关
        this.debugLogger = null;
        
        // 从配置读取参数
        this.loadConfig();
        
        logger.info(`[MegaRender] Initialized - debugMode=${this.debugMode}, fileDebug=${this.fileDebug}`);
    }
    
    /**
     * 从 ConfigManager 加载配置
     */
    loadConfig() {
        try {
            if (global.configManager) {
                this.viewportUpdateInterval = global.configManager.get('megaRender.viewportUpdateInterval', 500);
                this.maxParticlesPerTick = global.configManager.get('megaRender.maxParticlesPerTick', 2000);
                this.defaultRenderDistance = global.configManager.get('megaRender.maxRenderDistance', 96);
                this.debugMode = global.configManager.get('megaRender.debug', false);
                this.fileDebug = global.configManager.get('megaRender.fileDebug', false);
                
                // 初始化文件日志
                if (this.fileDebug && !this.debugLogger) {
                    this.debugLogger = new DebugLogger({
                        enabled: true,
                        logDir: './plugins/LitematicaBE/logs/',
                        maxFileSize: 10 * 1024 * 1024,
                        maxFiles: 5,
                        bufferSize: 50
                    });
                    logger.info('[MegaRender] File debug logging enabled');
                }
                
                // 加载LOD配置
                const lodConfig = global.configManager.get('megaRender.lodLevels', null);
                if (lodConfig) {
                    this.lodRenderer.updateConfig({
                        NEAR: { distance: lodConfig.near?.distance || 32, skipRate: lodConfig.near?.skipRate || 0 },
                        MEDIUM: { distance: lodConfig.medium?.distance || 80, skipRate: lodConfig.medium?.skipRate || 2 },
                        FAR: { distance: lodConfig.far?.distance || 160, skipRate: lodConfig.far?.skipRate || 4 }
                    });
                    logger.info(`[MegaRender] LOD config loaded: near=${lodConfig.near?.distance || 32}, medium=${lodConfig.medium?.distance || 80}, far=${lodConfig.far?.distance || 160}`);
                }
            } else {
                // 使用默认值
                this.viewportUpdateInterval = 500;
                this.maxParticlesPerTick = 2000;
                this.defaultRenderDistance = 96;
                this.debugMode = false;
                this.fileDebug = false;
            }
        } catch (e) {
            logger.warn(`[MegaRender] Failed to load config: ${e.message}`);
            this.viewportUpdateInterval = 500;
            this.maxParticlesPerTick = 2000;
            this.defaultRenderDistance = 96;
            this.debugMode = false;
            this.fileDebug = false;
        }
    }
    
    /**
     * 记录调试日志
     */
    log(level, category, message, data = null) {
        // WARN/ERROR level always output to console
        if (level === 'WARN' || level === 'ERROR') {
            if (data) {
                logger.warn(`[MegaRender][${category}] ${message} ${JSON.stringify(data)}`);
            } else {
                logger.warn(`[MegaRender][${category}] ${message}`);
            }
            return;
        }
        
        // 控制台输出（debug）
        if (this.debugMode) {
            if (data) {
                logger.info(`[MegaRender][${category}] ${message} ${JSON.stringify(data)}`);
            } else {
                logger.info(`[MegaRender][${category}] ${message}`);
            }
        }
        
        // 文件输出
        if (this.fileDebug && this.debugLogger) {
            this.debugLogger.log(level, category, message, data);
        }
    }

    /**
     * 初始化渲染状态
     */
    initRenderState(player, schematicId, projection) {
        const stateId = `${player.xuid}_${schematicId}`;

        if (this.renderStates.has(stateId)) {
            return this.renderStates.get(stateId);
        }

        const state = {
            player,
            schematicId,
            projection,
            visibleChunks: new Set(),
            loadedChunks: new Map(),
            lastViewportUpdate: 0,
            lastChunkLoad: 0,
            lastStatusLog: 0,
            isActive: true,
            isLayerMode: false,
            currentLayer: -1,
            _needsSync: true,
            stats: {
                chunksLoaded: 0,
                lodStats: { NEAR: 0, MEDIUM: 0, FAR: 0, filtered: 0 }
            }
        };

        this.renderStates.set(stateId, state);
        
        logger.info(`[MegaRender][INIT] State created: ${stateId} name="${projection.name}" totalBlocks=${projection.totalBlocks} isMega=${!!projection.isMega}`);
        
        if (this.debugMode) {
            player.tell(`§7[Debug] MegaRender init: ${projection.name}, blocks=${projection.totalBlocks}`);
        }
        
        return state;
    }

    /**
     * 每tick调用 - 渲染循环入口
     */
    onTick() {
        this.tickCount++;

        const now = Date.now();

        for (const [stateId, state] of this.renderStates) {
            if (!state.isActive) continue;

            const player = state.player;
            if (!player || !player.pos) {
                state.isActive = false;
                logger.warn(`[MegaRender] State ${stateId} inactive: no player reference`);
                continue;
            }

            const onlinePlayer = mc.getPlayer(player.xuid);
            if (!onlinePlayer) {
                state.isActive = false;
                logger.warn(`[MegaRender] State ${stateId} inactive: player offline`);
                continue;
            }
            
            state.player = onlinePlayer;

            const viewportChanged = now - state.lastViewportUpdate >= this.viewportUpdateInterval;
            if (viewportChanged) {
                this.updateViewport(state);
                state.lastViewportUpdate = now;
                state._needsSync = true;
            }
            
            // 层模式切换或视口变化后，同步方块数据到 ProjectionRenderer
            if (state._needsSync) {
                this.syncBlocksToRenderer(state);
                state._needsSync = false;
            }
            
            if (now - state.lastStatusLog >= 2000) {
                logger.info(`[MegaRender] status=${stateId} chunks=${state.loadedChunks.size} cachedBlocks=${this.countCachedBlocks(state)} N=${state.stats.lodStats.NEAR} M=${state.stats.lodStats.MEDIUM} F=${state.stats.lodStats.FAR}`);
                state.lastStatusLog = now;
            }
            
            if (this.debugMode && this.tickCount % 100 === 0) {
                this.outputDebugInfo(state);
            }
        }
    }
    
    /**
     * 统计当前缓存的方块数
     */
    countCachedBlocks(state) {
        let count = 0;
        for (const chunk of state.loadedChunks.values()) {
            count += chunk.worldBlocks.length;
        }
        return count;
    }
    
    /**
     * 将当前分块中的方块数据同步给 ProjectionRenderer
     * 应用 LOD 和 layer 过滤
     */
    syncBlocksToRenderer(state) {
        const renderer = global.renderer;
        if (!renderer || !state.player) return;
        
        // 严格节流：3秒内最多同步一次，确保批次渲染有足够时间完成
        const now = Date.now();
        if (!state._lastSyncTime) state._lastSyncTime = 0;
        if (now - state._lastSyncTime < 3000) {
            return;
        }
        
        const allBlocks = [];
        for (const chunk of state.loadedChunks.values()) {
            for (const block of chunk.worldBlocks) {
                if (state.isLayerMode && state.currentLayer >= 0 && block.pos[1] !== state.currentLayer) {
                    continue;
                }
                allBlocks.push(block);
            }
        }
        
        state._lastSyncTime = now;
        state._lastSyncBlockCount = allBlocks.length;
        
        logger.info(`[MegaRender][SYNC] feeding ${allBlocks.length} blocks (layerMode=${state.isLayerMode} layer=${state.currentLayer})`);
        renderer.updateBlocks(state.player.xuid, allBlocks);
    }
    
    /**
     * 输出调试信息
     */
    outputDebugInfo(state) {
        const stats = state.stats;
        const player = state.player;
        if (!player) return;
        
        const lod = stats.lodStats;
        
        player.tell(`§8[Debug] Chunks:${state.loadedChunks.size} Cached:${this.countCachedBlocks(state)} LOD[N:${lod.NEAR} M:${lod.MEDIUM} F:${lod.FAR}]`);
    }

    /**
     * 更新视口范围
     * 根据LOD级别决定是否加载分块：
     * - NEAR (≤32格): 加载全部分块
     * - MEDIUM (32-80格): 稀疏加载分块 (每3个加载1个)
     * - FAR (80-160格): 更稀疏加载 (每5个加载1个)
     * - OUTLINE (>160格): 不加载分块，只显示轮廓
     */
    updateViewport(state) {
        const playerPos = state.player.pos;
        const projection = state.projection;
        const projPos = projection.position;

        // LOD 距离配置
        const LOD_NEAR = 32;
        const LOD_MEDIUM = 80;
        const LOD_FAR = 160;

        const relX = playerPos.x - projPos.x;
        const relY = playerPos.y - projPos.y;
        const relZ = playerPos.z - projPos.z;

        // 计算各LOD级别的分块范围
        const nearMinCX = Math.floor((relX - LOD_NEAR) / CHUNK_SIZE);
        const nearMaxCX = Math.floor((relX + LOD_NEAR) / CHUNK_SIZE);
        const nearMinCY = Math.floor((relY - LOD_NEAR) / CHUNK_SIZE);
        const nearMaxCY = Math.floor((relY + LOD_NEAR) / CHUNK_SIZE);
        const nearMinCZ = Math.floor((relZ - LOD_NEAR) / CHUNK_SIZE);
        const nearMaxCZ = Math.floor((relZ + LOD_NEAR) / CHUNK_SIZE);

        const mediumMinCX = Math.floor((relX - LOD_MEDIUM) / CHUNK_SIZE);
        const mediumMaxCX = Math.floor((relX + LOD_MEDIUM) / CHUNK_SIZE);
        const mediumMinCY = Math.floor((relY - LOD_MEDIUM) / CHUNK_SIZE);
        const mediumMaxCY = Math.floor((relY + LOD_MEDIUM) / CHUNK_SIZE);
        const mediumMinCZ = Math.floor((relZ - LOD_MEDIUM) / CHUNK_SIZE);
        const mediumMaxCZ = Math.floor((relZ + LOD_MEDIUM) / CHUNK_SIZE);

        const farMinCX = Math.floor((relX - LOD_FAR) / CHUNK_SIZE);
        const farMaxCX = Math.floor((relX + LOD_FAR) / CHUNK_SIZE);
        const farMinCY = Math.floor((relY - LOD_FAR) / CHUNK_SIZE);
        const farMaxCY = Math.floor((relY + LOD_FAR) / CHUNK_SIZE);
        const farMinCZ = Math.floor((relZ - LOD_FAR) / CHUNK_SIZE);
        const farMaxCZ = Math.floor((relZ + LOD_FAR) / CHUNK_SIZE);

        const newVisible = new Set();
        const toLoad = [];

        // 辅助函数：计算分块中心到玩家的距离
        const getChunkDistance = (cx, cy, cz) => {
            const chunkCenterX = projPos.x + cx * CHUNK_SIZE + CHUNK_SIZE / 2;
            const chunkCenterY = projPos.y + cy * CHUNK_SIZE + CHUNK_SIZE / 2;
            const chunkCenterZ = projPos.z + cz * CHUNK_SIZE + CHUNK_SIZE / 2;
            const dx = chunkCenterX - playerPos.x;
            const dy = chunkCenterY - playerPos.y;
            const dz = chunkCenterZ - playerPos.z;
            return Math.sqrt(dx * dx + dy * dy + dz * dz);
        };

        // 辅助函数：根据距离决定是否加载分块
        const shouldLoadChunk = (cx, cy, cz, distance) => {
            const chunkKey = `${cx},${cy},${cz}`;
            
            if (distance <= LOD_NEAR) {
                // NEAR: 全加载
                return { shouldLoad: true, lodLevel: 'NEAR' };
            } else if (distance <= LOD_MEDIUM) {
                // MEDIUM: 稀疏加载 (每3个加载1个)
                const hash = Math.abs((cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791));
                return { shouldLoad: (hash % 3) === 0, lodLevel: 'MEDIUM' };
            } else if (distance <= LOD_FAR) {
                // FAR: 更稀疏加载 (每5个加载1个)
                const hash = Math.abs((cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791));
                return { shouldLoad: (hash % 5) === 0, lodLevel: 'FAR' };
            } else {
                // OUTLINE: 不加载
                return { shouldLoad: false, lodLevel: 'OUTLINE' };
            }
        };

        // 遍历FAR范围内的所有分块
        if (state.isLayerMode && state.currentLayer >= 0) {
            const layerCY = Math.floor(state.currentLayer / CHUNK_SIZE);
            for (let cx = farMinCX; cx <= farMaxCX; cx++) {
                for (let cz = farMinCZ; cz <= farMaxCZ; cz++) {
                    const distance = getChunkDistance(cx, layerCY, cz);
                    const { shouldLoad, lodLevel } = shouldLoadChunk(cx, layerCY, cz, distance);
                    const chunkKey = `${cx},${layerCY},${cz}`;
                    
                    newVisible.add(chunkKey);
                    
                    if (shouldLoad && !state.visibleChunks.has(chunkKey)) {
                        toLoad.push({ cx, cy: layerCY, cz, lodLevel, distance });
                    }
                }
            }
        } else {
            for (let cx = farMinCX; cx <= farMaxCX; cx++) {
                for (let cy = farMinCY; cy <= farMaxCY; cy++) {
                    for (let cz = farMinCZ; cz <= farMaxCZ; cz++) {
                        const distance = getChunkDistance(cx, cy, cz);
                        const { shouldLoad, lodLevel } = shouldLoadChunk(cx, cy, cz, distance);
                        const chunkKey = `${cx},${cy},${cz}`;
                        
                        newVisible.add(chunkKey);
                        
                        if (shouldLoad && !state.visibleChunks.has(chunkKey)) {
                            toLoad.push({ cx, cy, cz, lodLevel, distance });
                        }
                    }
                }
            }
        }

        // 加载新分块
        let nearCount = 0, mediumCount = 0, farCount = 0;
        for (const { cx, cy, cz, lodLevel, distance } of toLoad) {
            this.loadChunk(state, cx, cy, cz, lodLevel);
            if (lodLevel === 'NEAR') nearCount++;
            else if (lodLevel === 'MEDIUM') mediumCount++;
            else if (lodLevel === 'FAR') farCount++;
        }

        // 卸载不再可见的分块
        const unloadedCount = state.visibleChunks.size;
        for (const oldChunk of state.visibleChunks) {
            if (!newVisible.has(oldChunk)) {
                this.unloadChunk(state, oldChunk);
            }
        }

        state.visibleChunks = newVisible;
        
        const totalLoaded = nearCount + mediumCount + farCount;
        if (totalLoaded > 0 || unloadedCount > newVisible.size) {
            logger.info(`[MegaRender][VIEWPORT] visible=${newVisible.size} loaded=${totalLoaded} N=${nearCount} M=${mediumCount} F=${farCount} unloaded=${unloadedCount - newVisible.size}`);
        }
    }

    /**
     * 加载一个分块到内存
     * @param {string} lodLevel - 'NEAR', 'MEDIUM', 'FAR' 用于决定分块内方块的LOD级别
     */
    loadChunk(state, cx, cy, cz, lodLevel = 'NEAR') {
        const chunkKey = `${cx},${cy},${cz}`;
        const { schematicId, projection } = state;

        const chunkBlocks = this.megaManager.loadChunkFromDisk(schematicId, cx, cy, cz);
        if (!chunkBlocks || chunkBlocks.length === 0) {
            state.visibleChunks.delete(chunkKey);
            return;
        }

        // 首次加载chunk时有日志
        if (!state.loadedChunks.has(chunkKey)) {
            logger.info(`[MegaRender][CHUNK] loaded=${chunkKey} blocks=${chunkBlocks.length} lod=${lodLevel}`);
        }

        const playerPos = state.player.pos;
        const projPos = projection.position;

        // 根据分块的LOD级别决定如何处理方块
        let blocksToProcess;
        
        if (lodLevel === 'NEAR') {
            // NEAR: 处理所有方块
            blocksToProcess = chunkBlocks;
        } else if (lodLevel === 'MEDIUM') {
            // MEDIUM: 稀疏采样 (每2个取1个)
            blocksToProcess = chunkBlocks.filter((_, i) => i % 2 === 0);
        } else if (lodLevel === 'FAR') {
            // FAR: 更稀疏采样 (每4个取1个)
            blocksToProcess = chunkBlocks.filter((_, i) => i % 4 === 0);
        } else {
            blocksToProcess = chunkBlocks;
        }

        const worldBlocks = blocksToProcess.map(block => {
            const wx = projPos.x + block.pos[0];
            const wy = projPos.y + block.pos[1];
            const wz = projPos.z + block.pos[2];
            const dx = wx - playerPos.x;
            const dy = wy - playerPos.y;
            const dz = wz - playerPos.z;
            return {
                ...block,
                worldPos: [wx, wy, wz],
                distance: Math.sqrt(dx * dx + dy * dy + dz * dz)
            };
        });

        // 统计
        const beforeCount = chunkBlocks.length;
        const afterCount = worldBlocks.length;
        
        this.log('DEBUG', 'LOD', `Chunk ${chunkKey} [${lodLevel}]`, { 
            before: beforeCount, 
            after: afterCount,
            sampling: lodLevel
        });

        state.loadedChunks.set(chunkKey, {
            raw: chunkBlocks,
            worldBlocks: worldBlocks,
            lodLevel: lodLevel,
            loadedAt: Date.now()
        });

        state.stats.chunksLoaded++;
    }

    /**
     * 卸载一个分块
     */
    unloadChunk(state, chunkKey) {
        if (state.loadedChunks.has(chunkKey)) {
            state.loadedChunks.delete(chunkKey);
        }
    }

    /**
     * 获取维度名称
     */
    getDimensionName(dimension) {
        switch (dimension) {
            case 1: return 'the_nether';
            case 2: return 'the_end';
            default: return 'overworld';
        }
    }

    /**
     * 检查方块是否在玩家可见范围内
     */
    isInPlayerRange(player, block) {
        const pp = player.pos;
        if (!pp) return false;

        const [wx, wy, wz] = block.worldPos;
        const dx = wx - pp.x;
        const dy = wy - pp.y;
        const dz = wz - pp.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz) <= this.defaultRenderDistance;
    }

    /**
     * 切换到层次渲染模式
     */
    setLayerMode(stateId, layerY) {
        const state = this.renderStates.get(stateId);
        if (!state) return false;

        state.isLayerMode = true;
        state.currentLayer = layerY;
        state._needsSync = true;

        logger.info(`[MegaRender][LAYER] stateId=${stateId} layer=${layerY}`);
        
        if (this.debugMode && state.player) {
            state.player.tell(`§7[Debug] Layer mode: ${layerY}`);
        }
        
        return true;
    }

    /**
     * 停止渲染
     */
    stopRender(stateId) {
        const state = this.renderStates.get(stateId);
        if (!state) return;

        state.isActive = false;
        const chunkCount = state.loadedChunks.size;
        this.renderStates.delete(stateId);
        logger.info(`[MegaRender][STOP] stopped=${stateId} chunks=${chunkCount}`);
    }

    /**
     * 获取查询范围内的方块（用于轻松放置）
     */
    getBlocksInRadius(stateId, worldCenterX, worldCenterY, worldCenterZ, radius) {
        const state = this.renderStates.get(stateId);
        if (!state) return [];

        const projection = state.projection;
        const projPos = projection.position;

        const relX = worldCenterX - projPos.x;
        const relY = worldCenterY - projPos.y;
        const relZ = worldCenterZ - projPos.z;

        return this.megaManager.getBlocksNear(state.schematicId, relX, relY, relZ, radius);
    }

    /**
     * 获取渲染统计
     */
    getStats(stateId) {
        const state = this.renderStates.get(stateId);
        if (!state) return null;

        return {
            ...state.stats,
            loadedChunks: state.loadedChunks.size,
            visibleChunks: state.visibleChunks.size,
            isLayerMode: state.isLayerMode,
            currentLayer: state.currentLayer
        };
    }
    
    /**
     * 获取详细调试信息
     */
    getDebugInfo(stateId) {
        const state = this.renderStates.get(stateId);
        if (!state) return null;
        
        const player = state.player;
        const lod = state.stats.lodStats;
        
        return {
            stateId,
            isActive: state.isActive,
            playerPos: player ? { x: player.pos.x, y: player.pos.y, z: player.pos.z } : null,
            projection: {
                name: state.projection.name,
                position: state.projection.position,
                totalBlocks: state.projection.totalBlocks,
                isMega: state.projection.isMega,
                schematicId: state.projection.schematicId
            },
            stats: state.stats,
            lodDistribution: {
                near: lod.NEAR,
                medium: lod.MEDIUM,
                far: lod.FAR,
                filtered: lod.filtered,
                total: lod.NEAR + lod.MEDIUM + lod.FAR + lod.filtered
            },
            memory: {
                loadedChunks: state.loadedChunks.size,
                visibleChunks: state.visibleChunks.size,
                pendingRender: state.pendingRender.length,
                renderedPositions: state.renderedPositions.size,
                placedPositions: state.placedPositions.size
            },
            config: {
                viewportUpdateInterval: this.viewportUpdateInterval,
                maxParticlesPerTick: this.maxParticlesPerTick,
                defaultRenderDistance: this.defaultRenderDistance,
                debugMode: this.debugMode
            }
        };
    }

    /**
     * 清除所有渲染状态
     */
    clearAll() {
        this.renderStates.clear();
    }
    
    /**
     * 切换调试模式
     */
    setDebugMode(enabled) {
        this.debugMode = enabled;
        this.log('INFO', 'CONFIG', `Debug mode: ${enabled}`);
    }
    
    /**
     * 切换文件日志模式
     */
    setFileDebug(enabled) {
        this.fileDebug = enabled;
        if (enabled && !this.debugLogger) {
            this.debugLogger = new DebugLogger({
                enabled: true,
                logDir: './plugins/LitematicaBE/logs/',
                maxFileSize: 10 * 1024 * 1024,
                maxFiles: 5,
                bufferSize: 50
            });
        }
        this.log('INFO', 'CONFIG', `File debug: ${enabled}`);
    }
    
    /**
     * 刷新日志到文件
     */
    flushLogs() {
        if (this.debugLogger) {
            this.debugLogger.flush();
        }
    }
}

module.exports = { MegaProjectionRenderer };
