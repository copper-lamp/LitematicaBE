// MegaProjectionRenderer - 超大型投影渲染器
// 使用分块按需加载 + LOD细节层次 + 分批渲染
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
        // 控制台输出
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

        const state = {
            player,
            schematicId,
            projection,
            visibleChunks: new Set(),
            loadedChunks: new Map(),
            pendingRender: [],
            renderedPositions: new Set(),
            placedPositions: new Set(),
            lastViewportUpdate: 0,
            lastChunkLoad: 0,
            isActive: true,
            isLayerMode: false,
            currentLayer: -1,
            stats: {
                totalParticles: 0,
                chunksLoaded: 0,
                particlesSkipped: 0,
                lodStats: { NEAR: 0, MEDIUM: 0, FAR: 0, filtered: 0 }
            }
        };

        this.renderStates.set(stateId, state);
        this.log('INFO', 'INIT', `Initialized render state: ${stateId}`, { 
            projection: projection.name, 
            isMega: projection.isMega,
            totalBlocks: projection.totalBlocks 
        });
        
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
                if (this.debugMode) logger.info(`[MegaRender] State ${stateId} inactive: no player pos`);
                continue;
            }

            if (!mc.getPlayer(player.xuid)) {
                state.isActive = false;
                if (this.debugMode) logger.info(`[MegaRender] State ${stateId} inactive: player offline`);
                continue;
            }

            if (now - state.lastViewportUpdate >= this.viewportUpdateInterval) {
                this.updateViewport(state);
                state.lastViewportUpdate = now;
            }

            this.renderBatch(state, Math.min(this.maxParticlesPerTick, 2000));
            
            // 每100tick输出一次调试信息
            if (this.debugMode && this.tickCount % 100 === 0) {
                this.outputDebugInfo(state);
            }
        }
    }
    
    /**
     * 输出调试信息
     */
    outputDebugInfo(state) {
        const stats = state.stats;
        const player = state.player;
        if (!player) return;
        
        const lod = stats.lodStats;
        const totalLod = lod.NEAR + lod.MEDIUM + lod.FAR;
        
        player.tell(`§8[Debug] Chunks:${state.loadedChunks.size} Pending:${state.pendingRender.length} Rendered:${stats.totalParticles} LOD[N:${lod.NEAR} M:${lod.MEDIUM} F:${lod.FAR}]`);
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
            this.log('DEBUG', 'VIEWPORT', 'Update', { 
                visible: newVisible.size, 
                loaded: totalLoaded,
                near: nearCount,
                medium: mediumCount,
                far: farCount,
                unloaded: unloadedCount - newVisible.size 
            });
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
            this.log('DEBUG', 'CHUNK', `Empty or not found: ${chunkKey}`);
            return;
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

        for (const block of worldBlocks) {
            const posKey = `${block.worldPos[0]},${block.worldPos[1]},${block.worldPos[2]}`;
            if (state.isLayerMode && state.currentLayer >= 0 && block.pos[1] !== state.currentLayer) {
                continue;
            }
            if (!state.renderedPositions.has(posKey) && !state.placedPositions.has(posKey)) {
                state.pendingRender.push(block);
            }
        }

        state.stats.chunksLoaded++;
    }

    /**
     * 卸载一个分块
     */
    unloadChunk(state, chunkKey) {
        const chunk = state.loadedChunks.get(chunkKey);
        if (chunk) {
            for (const block of chunk.worldBlocks) {
                const posKey = `${block.worldPos[0]},${block.worldPos[1]},${block.worldPos[2]}`;
                state.renderedPositions.delete(posKey);
                state.pendingRender = state.pendingRender.filter(b =>
                    `${b.worldPos[0]},${b.worldPos[1]},${b.worldPos[2]}` !== posKey
                );
            }
            state.loadedChunks.delete(chunkKey);
            this.log('DEBUG', 'CHUNK', `Unloaded: ${chunkKey}`);
        }
    }

    /**
     * 渲染一批粒子
     */
    renderBatch(state, maxCount) {
        const player = state.player;
        if (!player || !player.spawnParticle) return;

        const pending = state.pendingRender;
        let rendered = 0;

        while (rendered < maxCount && pending.length > 0) {
            const block = pending.shift();
            const posKey = `${block.worldPos[0]},${block.worldPos[1]},${block.worldPos[2]}`;

            if (state.placedPositions.has(posKey)) {
                state.stats.particlesSkipped++;
                continue;
            }

            if (!this.isInPlayerRange(player, block)) {
                continue;
            }

            try {
                this.spawnParticleForBlock(player, block);
                state.renderedPositions.add(posKey);
                state.stats.totalParticles++;
                rendered++;
            } catch (e) {
                this.log('WARN', 'RENDER', `Failed to spawn particle`, { error: e.message });
            }
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
     * 为方块生成粒子
     */
    spawnParticleForBlock(player, block) {
        const [wx, wy, wz] = block.worldPos;
        const fullBlockName = block.name || '';
        const particleId = this.getParticleId(fullBlockName, false);

        const adjustedPos = [wx + 0.5, wy + 0.5, wz + 0.5];

        if (player.spawnParticle) {
            player.spawnParticle(
                particleId,
                { x: adjustedPos[0], y: adjustedPos[1], z: adjustedPos[2] }
            );
        }
    }

    /**
     * 获取粒子ID
     */
    getParticleId(fullBlockName, isError = false) {
        let baseName = fullBlockName.toLowerCase();
        if (baseName.includes(':')) {
            baseName = baseName.split(':')[1] || baseName.split(':')[0];
        }

        let textureName = baseName.replace(/[^a-z0-9_]/g, '_').replace(/_+$/, '');

        if (textureName === 'smooth_quartz') textureName = 'quartz_block_bottom';
        else if (textureName === 'quartz_block') textureName = 'quartz_block_side';

        const suffix = isError ? 'error' : 'normal';
        return `litematica:block_${textureName}_${suffix}`;
    }

    /**
     * 标记方块为已放置
     */
    markBlockPlaced(state, worldPos) {
        const posKey = `${worldPos[0]},${worldPos[1]},${worldPos[2]}`;
        state.placedPositions.add(posKey);
        state.renderedPositions.delete(posKey);

        state.pendingRender = state.pendingRender.filter(b =>
            `${b.worldPos[0]},${b.worldPos[1]},${b.worldPos[2]}` !== posKey
        );
        
        this.log('DEBUG', 'BLOCK', `Marked as placed: ${posKey}`);
    }

    /**
     * 切换到层次渲染模式
     */
    setLayerMode(stateId, layerY) {
        const state = this.renderStates.get(stateId);
        if (!state) return false;

        state.isLayerMode = true;
        state.currentLayer = layerY;
        state.pendingRender = [];
        state.renderedPositions.clear();

        for (const [chunkKey, chunk] of state.loadedChunks) {
            for (const block of chunk.worldBlocks) {
                if (block.pos[1] === layerY) {
                    const posKey = `${block.worldPos[0]},${block.worldPos[1]},${block.worldPos[2]}`;
                    if (!state.placedPositions.has(posKey)) {
                        state.pendingRender.push(block);
                    }
                }
            }
        }

        this.log('INFO', 'LAYER', `Layer mode: ${layerY}`, { pending: state.pendingRender.length });
        
        if (this.debugMode && state.player) {
            state.player.tell(`§7[Debug] Layer mode: ${layerY}, pending=${state.pendingRender.length}`);
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
        const totalParticles = state.stats.totalParticles;
        this.renderStates.delete(stateId);
        this.log('INFO', 'STOP', `Stopped: ${stateId}`, { totalParticles });
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
            pendingRender: state.pendingRender.length,
            renderedPositions: state.renderedPositions.size,
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
