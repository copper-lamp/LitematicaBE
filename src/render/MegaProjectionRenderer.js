// MegaProjectionRenderer v3.1 — 超大型投影 LOD 渲染管理器
// 渲染策略：仅执行一次初始渲染（~10000方块），玩家重生时才重新渲染
// 分块大小: 32×32×32
// 添加玩家反馈提示

const { CHUNK_SIZE } = require('../core/BinaryChunkStorage');
const { DebugLogger } = require('../core/DebugLogger');

const TARGET_LOD_BLOCKS = 10000;
const CORE_CHUNK_RADIUS = 1;
const FAR_FILTER_RATE = 0.3;

class MegaProjectionRenderer {
    constructor(megaSchematicManager) {
        this.megaManager = megaSchematicManager;
        this.renderStates = new Map();
        this.tickCount = 0;
        this.debugMode = false;
        this.fileDebug = false;
        this.debugLogger = null;

        this.loadConfig();

        logger.info(`[MegaRender] v3.1 Initialized — palette+GZip .mcmega + render-once`);
        this.registerRespawnListener();
    }

    loadConfig() {
        try {
            if (global.configManager) {
                this.viewportUpdateInterval = global.configManager.get('megaRender.viewportUpdateInterval', 500);
                this.maxParticlesPerTick = global.configManager.get('megaRender.maxParticlesPerTick', 2000);
                this.maxRenderDistance = global.configManager.get('megaRender.maxRenderDistance', 96);
                this.debugMode = global.configManager.get('megaRender.debug', false);
                this.fileDebug = global.configManager.get('megaRender.fileDebug', false);

                if (this.fileDebug && !this.debugLogger) {
                    this.debugLogger = new DebugLogger({
                        enabled: true,
                        logDir: './plugins/LitematicaBE/logs/',
                        maxFileSize: 10 * 1024 * 1024,
                        maxFiles: 5,
                        bufferSize: 50
                    });
                }
            } else {
                this.viewportUpdateInterval = 500;
                this.maxParticlesPerTick = 2000;
                this.maxRenderDistance = 96;
                this.debugMode = false;
                this.fileDebug = false;
            }
        } catch (e) {
            logger.warn(`[MegaRender] Config load failed: ${e.message}`);
            this.viewportUpdateInterval = 500;
            this.maxParticlesPerTick = 2000;
            this.maxRenderDistance = 96;
            this.debugMode = false;
            this.fileDebug = false;
        }
    }

    registerRespawnListener() {
        mc.listen('onRespawn', (player) => {
            if (!player || !player.xuid) return;
            for (const [stateId, state] of this.renderStates) {
                if (stateId.startsWith(player.xuid + '_') && state.isActive) {
                    state.needsRespawnRender = true;
                    state._lastSyncTime = 0;
                    state._hasCompletedInitialRender = false;
                    logger.info(`[MegaRender][RESPAWN] Player ${player.name} respawned, triggering re-render for ${stateId}`);
                    if (this.debugMode) {
                        player.tell(`§7[MegaRender] 检测到重生，重新渲染投影...`);
                    }
                }
            }
        });
    }

    log(level, category, message, data = null) {
        if (level === 'WARN' || level === 'ERROR') {
            if (data) {
                logger.warn(`[MegaRender][${category}] ${message} ${JSON.stringify(data)}`);
            } else {
                logger.warn(`[MegaRender][${category}] ${message}`);
            }
            return;
        }
        if (this.debugMode) {
            if (data) {
                logger.info(`[MegaRender][${category}] ${message} ${JSON.stringify(data)}`);
            } else {
                logger.info(`[MegaRender][${category}] ${message}`);
            }
        }
        if (this.fileDebug && this.debugLogger) {
            this.debugLogger.log(level, category, message, data);
        }
    }

    // ==================== 状态管理 ====================

    initRenderState(player, schematicId, projection) {
        const stateId = `${player.xuid}_${schematicId}`;
        if (this.renderStates.has(stateId)) {
            return this.renderStates.get(stateId);
        }

        const state = {
            player,
            schematicId,
            projection,
            loadedChunks: new Map(),
            visibleChunkSet: new Set(),
            lastViewportUpdate: 0,
            lastSyncTime: 0,
            lastStatusLog: 0,
            isActive: true,
            isLayerMode: false,
            currentLayer: -1,
            needsSync: true,
            needsRespawnRender: false,
            _hasCompletedInitialRender: false,
            _lastSyncTime: 0,
            lastPlayerPos: player.pos ? { x: player.pos.x, y: player.pos.y, z: player.pos.z } : null,
            stats: {
                chunksLoaded: 0,
                totalCachedBlocks: 0,
                totalFilteredBlocks: 0,
                coreBlocks: 0,
                farBlocks: 0
            }
        };

        this.renderStates.set(stateId, state);
        logger.info(`[MegaRender][INIT] State: ${stateId} name="${projection.name}" blocks=${projection.totalBlocks}`);

        if (player) {
            // 静默模式 - 只在控制台输出
            logger.info(`[MegaRender] 超大型投影渲染已激活 | 名称: ${projection.name} | 方块数: ${projection.totalBlocks} | 渲染策略: LOD动态过滤 ~${TARGET_LOD_BLOCKS}方块`);
        }

        return state;
    }

    // ==================== 主循环 ====================

    onTick() {
        this.tickCount++;

        for (const [stateId, state] of this.renderStates) {
            if (!state.isActive) continue;

            const player = state.player;
            if (!player || !player.pos) {
                state.isActive = false;
                continue;
            }

            const onlinePlayer = mc.getPlayer(player.xuid);
            if (!onlinePlayer) {
                state.isActive = false;
                continue;
            }
            state.player = onlinePlayer;

            if (state.needsRespawnRender) {
                state.needsSync = true;
                state.needsRespawnRender = false;
                state._hasCompletedInitialRender = false;
            }

            const now = Date.now();
            const viewportChanged = (now - state.lastViewportUpdate) >= this.viewportUpdateInterval;

            if (viewportChanged && !state._hasCompletedInitialRender) {
                this.updateViewport(state);
                state.lastViewportUpdate = now;
                state.needsSync = true;
            }

            if (state.needsSync) {
                this.syncBlocksToRenderer(state);
                state.needsSync = false;
            }

            if (now - state.lastStatusLog >= 5000 && this.debugMode) {
                const st = state.stats;
                logger.info(`[MegaRender] status=${stateId} chunks=${state.loadedChunks.size} cached=${st.totalCachedBlocks}`);
                state.lastStatusLog = now;
            }
        }
    }

    // ==================== 视口更新 ====================

    updateViewport(state) {
        const playerPos = state.player.pos;
        const projection = state.projection;
        const projPos = projection.position;
        const maxDist = this.maxRenderDistance;

        const relX = playerPos.x - projPos.x;
        const relY = playerPos.y - projPos.y;
        const relZ = playerPos.z - projPos.z;

        const minCX = Math.floor((relX - maxDist) / CHUNK_SIZE);
        const maxCX = Math.floor((relX + maxDist) / CHUNK_SIZE);
        const minCY = Math.floor((relY - maxDist) / CHUNK_SIZE);
        const maxCY = Math.floor((relY + maxDist) / CHUNK_SIZE);
        const minCZ = Math.floor((relZ - maxDist) / CHUNK_SIZE);
        const maxCZ = Math.floor((relZ + maxDist) / CHUNK_SIZE);

        const newVisible = new Set();
        let loadedCount = 0;

        if (state.isLayerMode && state.currentLayer >= 0) {
            const layerCY = Math.floor(state.currentLayer / CHUNK_SIZE);
            for (let cx = minCX; cx <= maxCX; cx++) {
                for (let cz = minCZ; cz <= maxCZ; cz++) {
                    const chunkKey = `${cx},${layerCY},${cz}`;
                    newVisible.add(chunkKey);
                    if (!state.loadedChunks.has(chunkKey)) {
                        this.loadChunkLOD(state, cx, layerCY, cz);
                        loadedCount++;
                    }
                }
            }
        } else {
            for (let cx = minCX; cx <= maxCX; cx++) {
                for (let cy = minCY; cy <= maxCY; cy++) {
                    for (let cz = minCZ; cz <= maxCZ; cz++) {
                        const chunkKey = `${cx},${cy},${cz}`;
                        newVisible.add(chunkKey);
                        if (!state.loadedChunks.has(chunkKey)) {
                            this.loadChunkLOD(state, cx, cy, cz);
                            loadedCount++;
                        }
                    }
                }
            }
        }

        for (const oldChunk of state.visibleChunkSet) {
            if (!newVisible.has(oldChunk)) {
                this.unloadChunk(state, oldChunk);
            }
        }

        state.visibleChunkSet = newVisible;
    }

    // ==================== 分块加载 & LOD过滤 ====================

    loadChunkLOD(state, cx, cy, cz) {
        const chunkKey = `${cx},${cy},${cz}`;
        const { schematicId, projection } = state;

        const chunkBlocks = this.megaManager.loadChunkFromDisk(schematicId, cx, cy, cz);
        if (!chunkBlocks || chunkBlocks.length === 0) {
            return;
        }

        const playerPos = state.player.pos;
        const projPos = projection.position;

        const worldBlocks = chunkBlocks.map(block => {
            const wx = projPos.x + block.pos[0];
            const wy = projPos.y + block.pos[1];
            const wz = projPos.z + block.pos[2];
            const dx = wx - playerPos.x;
            const dy = wy - playerPos.y;
            const dz = wz - playerPos.z;
            return {
                pos: block.pos,
                name: block.name,
                state: block.state || {},
                worldPos: [wx, wy, wz],
                distance: Math.sqrt(dx * dx + dy * dy + dz * dz)
            };
        });

        state.loadedChunks.set(chunkKey, {
            raw: chunkBlocks,
            worldBlocks: worldBlocks,
            cx, cy, cz,
            loadedAt: Date.now()
        });

        state.stats.chunksLoaded++;

        if (state.stats.chunksLoaded <= 5 && this.debugMode) {
            logger.info(`[MegaRender][CHUNK] loaded ${chunkKey} blocks=${chunkBlocks.length}`);
        }
    }

    unloadChunk(state, chunkKey) {
        state.loadedChunks.delete(chunkKey);
    }

    // ==================== 方块同步 & LOD过滤 ====================

    /**
     * 将当前分块中的方块经LOD过滤后同步到 ProjectionRenderer
     * 仅执行一次初始渲染，之后只在重生时重新渲染
     */
    syncBlocksToRenderer(state) {
        const renderer = global.renderer;
        if (!renderer || !state.player) return;

        const now = Date.now();
        if (!state._lastSyncTime) state._lastSyncTime = 0;

        if (state._hasCompletedInitialRender && !state.needsRespawnRender) {
            return;
        }

        const chunks = Array.from(state.loadedChunks.values());
        if (chunks.length === 0) return;

        const playerPos = state.player.pos;
        const projPos = state.projection.position;
        const playerCX = Math.floor((playerPos.x - projPos.x) / CHUNK_SIZE);
        const playerCZ = Math.floor((playerPos.z - projPos.z) / CHUNK_SIZE);

        let allBlocks = [];
        let coreBlockCount = 0;
        let farBlockCount = 0;

        // 收集所有可见分块
        const visibleChunks = chunks;
        const nonAirChunks = visibleChunks.filter(c => c.worldBlocks.length > 0);
        
        // 计算所有非空分块数量，用于平均配额分配
        const chunkCount = nonAirChunks.length;
        // 平均每个分块的配额
        const quotaPerChunk = chunkCount > 0 ? Math.floor(TARGET_LOD_BLOCKS / chunkCount) : TARGET_LOD_BLOCKS;

        for (const chunk of visibleChunks) {
            if (chunk.worldBlocks.length === 0) continue;

            let filtered;
            if (state.isLayerMode && state.currentLayer >= 0) {
                // currentLayer 是世界坐标，chunk.worldBlocks 中的 pos 也是世界坐标（相对投影原点）
                // 需要找到对应层的方块
                filtered = chunk.worldBlocks.filter(b => b.worldPos[1] === state.currentLayer);
            } else {
                filtered = chunk.worldBlocks;
            }

            // 所有分块采取平均过滤
            if (state.isLayerMode) {
                // 层模式：使用密度过滤
                const kept = this.densityFilter(filtered, FAR_FILTER_RATE);
                farBlockCount += kept.length;
                allBlocks.push(...kept);
            } else {
                // 普通模式：平均配额过滤
                const quotaFiltered = this.quotaFilter(filtered, quotaPerChunk);
                farBlockCount += quotaFiltered.length;
                allBlocks.push(...quotaFiltered);
            }
        }

        state.stats.totalCachedBlocks = allBlocks.length;
        state.stats.totalFilteredBlocks = farBlockCount;
        state.stats.coreBlocks = coreBlockCount;
        state.stats.farBlocks = farBlockCount;

        state._lastSyncTime = now;
        state._hasCompletedInitialRender = true;

        logger.info(`[MegaRender][SYNC] total=${allBlocks.length} core=${coreBlockCount} far=${farBlockCount}`);

        if (allBlocks.length > 0) {
            renderer.updateBlocks(state.player.xuid, allBlocks);

            if (state.player && !state.player._megaRenderNotified) {
                // 静默模式
                logger.info(`[MegaRender] LOD渲染就绪 | 渲染方块: ${allBlocks.length} (核心${coreBlockCount} + 远处${farBlockCount})`);
                state.player._megaRenderNotified = true;
            }
        }
    }

    isCoreChunk(chunk, playerCX, playerCZ, state) {
        const dx = Math.abs(chunk.cx - playerCX);
        const dz = Math.abs(chunk.cz - playerCZ);
        return dx <= CORE_CHUNK_RADIUS && dz <= CORE_CHUNK_RADIUS;
    }

    quotaFilter(blocks, quota) {
        if (quota <= 0) return [];
        if (blocks.length <= quota) return blocks;

        const sorted = [...blocks].sort((a, b) => a.distance - b.distance);

        const step = Math.max(1, Math.floor(blocks.length / quota));
        const result = [];
        for (let i = 0; i < sorted.length && result.length < quota; i += step) {
            result.push(sorted[i]);
        }

        return result;
    }

    densityFilter(blocks, keepRate) {
        if (keepRate >= 1.0) return [...blocks];
        if (keepRate <= 0 || blocks.length === 0) return [];

        const sorted = [...blocks].sort((a, b) => a.distance - b.distance);
        const keepCount = Math.max(1, Math.floor(sorted.length * keepRate));
        const step = Math.max(1, Math.floor(sorted.length / keepCount));

        const result = [];
        for (let i = 0; i < sorted.length && result.length < keepCount; i += step) {
            result.push(sorted[i]);
        }
        return result;
    }

    // ==================== 层模式 ====================

    setLayerMode(stateId, layerY) {
        const state = this.renderStates.get(stateId);
        if (!state) return false;

        state.isLayerMode = true;
        state.currentLayer = layerY;
        state.needsSync = true;
        state._hasCompletedInitialRender = false;
        if (state.player) state.player._megaRenderNotified = false;

        logger.info(`[MegaRender][LAYER] stateId=${stateId} layer=${layerY}`);

        return true;
    }

    // ==================== 轻松放置查询 ====================

    getBlocksInRadius(stateId, worldCenterX, worldCenterY, worldCenterZ, radius) {
        const state = this.renderStates.get(stateId);
        if (!state) return [];

        const projPos = state.projection.position;
        const relX = worldCenterX - projPos.x;
        const relY = worldCenterY - projPos.y;
        const relZ = worldCenterZ - projPos.z;

        return this.megaManager.getBlocksNear(state.schematicId, relX, relY, relZ, radius);
    }

    // ==================== 管理 ====================

    stopRender(stateId) {
        const state = this.renderStates.get(stateId);
        if (!state) return;
        const chunkCount = state.loadedChunks.size;
        state.isActive = false;
        this.renderStates.delete(stateId);
        logger.info(`[MegaRender][STOP] ${stateId} chunks=${chunkCount}`);
    }

    clearAll() {
        this.renderStates.clear();
    }

    getStats(stateId) {
        const state = this.renderStates.get(stateId);
        if (!state) return null;
        return {
            ...state.stats,
            loadedChunks: state.loadedChunks.size,
            visibleChunks: state.visibleChunkSet.size,
            isLayerMode: state.isLayerMode,
            currentLayer: state.currentLayer
        };
    }

    getDebugInfo(stateId) {
        const state = this.renderStates.get(stateId);
        if (!state) return null;
        const player = state.player;
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
            config: {
                viewportUpdateInterval: this.viewportUpdateInterval,
                maxParticlesPerTick: this.maxParticlesPerTick,
                maxRenderDistance: this.maxRenderDistance,
                targetLODBlocks: TARGET_LOD_BLOCKS,
                storageFormat: 'mcmega_v2 (palette+GZip)',
                chunkSize: CHUNK_SIZE,
                debugMode: this.debugMode
            }
        };
    }

    outputDebugInfo(state) {
        const player = state.player;
        if (!player) return;
        const st = state.stats;
        player.tell(`§8[D] chunks:${state.loadedChunks.size} cached:${st.totalCachedBlocks} core:${st.coreBlocks} far:${st.farBlocks} rendered:${state._hasCompletedInitialRender}`);
    }

    setDebugMode(enabled) {
        this.debugMode = enabled;
        this.log('INFO', 'CONFIG', `Debug mode: ${enabled}`);
    }

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

    flushLogs() {
        if (this.debugLogger) {
            this.debugLogger.flush();
        }
    }
}

module.exports = { MegaProjectionRenderer };
