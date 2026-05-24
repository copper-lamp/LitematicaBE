// MegaSchematicManager v3.1 — 超大型投影数据管理器
// 使用 .mcmega 二进制分块存储（调色板 + 位打包 + GZip 压缩）
// 分块大小: 32×32×32，LRU 内存缓存
// 异步分批加载，不阻塞游戏进程
// LOD 过滤在渲染时动态执行

const { BinaryChunkStorage, CHUNK_SIZE } = require('./BinaryChunkStorage');

const LRU_CACHE_SIZE = 200;
const BATCH_INSERT_SIZE = 5000;
const ASYNC_YIELD_INTERVAL = 2;

class LRUCache {
    constructor(maxSize = LRU_CACHE_SIZE) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }

    get(key) {
        if (!this.cache.has(key)) return undefined;
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }

    set(key, value) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }
        this.cache.set(key, value);
    }

    has(key) {
        return this.cache.has(key);
    }

    delete(key) {
        return this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }

    get size() {
        return this.cache.size;
    }
}

class MegaSchematicManager {
    constructor() {
        this.storage = new BinaryChunkStorage();
        this.blockCache = new LRUCache(LRU_CACHE_SIZE);
        this.metaCache = new Map();
        this.loadingTasks = new Map();
        this.chunkSize = CHUNK_SIZE;
    }

    get schematicId() { return null; }

    initMegaSchematic(schematicId) {
        this.storage.ensureSchematicDir(schematicId);
        logger.info(`[MegaSchematic] Initialized storage for: ${schematicId}`);
        return { schematicId };
    }

    // ==================== 异步加载（真正不阻塞） ====================

    async loadMegaSchematic(filePath, streamResult, onProgress, player) {
        const schematicId = 'mega_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        this.storage.ensureSchematicDir(schematicId);

        logger.info(`[MegaSchematic] Starting mega load: ${filePath} -> ${schematicId}`);
        if (player) {
            // 静默模式 - 只在控制台输出
            logger.info(`[MegaSchematic] 正在加载超大型投影 | 方块数: ${streamResult.totalEstimate || '?'}`);
        }

        const loadingTask = { filePath, schematicId, progress: 0, status: 'loading' };
        this.loadingTasks.set(schematicId, loadingTask);

        try {
            if (!streamResult || !streamResult.generator) {
                throw new Error('Invalid stream result');
            }

            const { meta, totalEstimate, generator } = streamResult;

            const chunkIndex = new Map();
            const chunkBuffers = new Map();
            let totalBlocks = 0;
            let batchCount = 0;

            const startTime = Date.now();
            let lastYieldTime = startTime;
            const YIELD_INTERVAL_MS = 50;

            for (const blockBatch of generator) {
                batchCount++;

                for (const block of blockBatch) {
                    const cx = Math.floor(block.pos[0] / CHUNK_SIZE);
                    const cy = Math.floor(block.pos[1] / CHUNK_SIZE);
                    const cz = Math.floor(block.pos[2] / CHUNK_SIZE);
                    const key = `${cx},${cy},${cz}`;

                    if (!chunkBuffers.has(key)) {
                        chunkBuffers.set(key, []);
                    }
                    chunkBuffers.get(key).push(block);
                }

                totalBlocks += blockBatch.length;

                if (onProgress) {
                    onProgress(totalBlocks, totalEstimate);
                }

                if (batchCount % 20 === 0) {
                    logger.info(`[MegaSchematic] Progress: ${totalBlocks} blocks, ${chunkBuffers.size} chunks buffered...`);
                }

                const now = Date.now();
                if (now - lastYieldTime >= YIELD_INTERVAL_MS) {
                    await this.yieldToGame();
                    lastYieldTime = Date.now();
                }
            }

            let totalSizeBytes = 0;
            let totalUncompressed = 0;
            let writtenChunks = 0;
            const writeStartTime = Date.now();
            let lastProgressTime = writeStartTime;

            for (const [chunkKey, chunkBlocks] of chunkBuffers) {
                const [cxStr, cyStr, czStr] = chunkKey.split(',');
                const cx = parseInt(cxStr), cy = parseInt(cyStr), cz = parseInt(czStr);

                const result = this.storage.writeChunk(schematicId, cx, cy, cz, chunkBlocks, chunkBlocks.length);
                chunkIndex.set(chunkKey, (chunkIndex.get(chunkKey) || 0) + chunkBlocks.length);
                totalSizeBytes += result.sizeBytes;
                totalUncompressed += result.uncompressedSize;
                writtenChunks++;

                const now = Date.now();
                
                // 如果分块处理超过30秒，每30秒显示一次进度
                if (player && (now - writeStartTime) > 30000 && (now - lastProgressTime) >= 30000) {
                    const pct = Math.floor(writtenChunks / chunkBuffers.size * 100);
                    player.tell(`§7  正在写入分块... ${writtenChunks}/${chunkBuffers.size} (${pct}%)`);
                    lastProgressTime = now;
                }

                if (now - lastYieldTime >= YIELD_INTERVAL_MS) {
                    await this.yieldToGame();
                    lastYieldTime = Date.now();
                }
            }

            const finalMeta = {
                ...meta,
                totalBlocks: totalBlocks,
                chunkCount: chunkIndex.size,
                filePath: filePath,
                storageFormat: 'mcmega_v2',
                storageSizeBytes: totalSizeBytes,
                uncompressedSize: totalUncompressed,
                chunkSize: CHUNK_SIZE,
                createdAt: Date.now()
            };

            this.storage.saveMeta(schematicId, finalMeta);
            this.storage.saveChunkIndex(schematicId, chunkIndex);
            this.metaCache.set(schematicId, finalMeta);

            loadingTask.status = 'ready';
            loadingTask.progress = 100;

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const sizeMB = (totalSizeBytes / 1024 / 1024).toFixed(1);
            const uncompressedMB = (totalUncompressed / 1024 / 1024).toFixed(1);
            const chunkCount = chunkIndex.size;
            const ratio = totalUncompressed > 0 ? (totalSizeBytes / totalUncompressed * 100).toFixed(1) : '100';

            logger.info(`[MegaSchematic] Load complete: ${schematicId} - ${totalBlocks} blocks, ${chunkCount} chunks, ${sizeMB}MB (原${uncompressedMB}MB, ${ratio}%), ${elapsed}s`);

            if (player) {
                // 静默模式 - 只在控制台输出
                logger.info(`[MegaSchematic] 加载完成 | 方块总数: ${totalBlocks} | 分块数: ${chunkCount} | 压缩后: ${sizeMB}MB (原${uncompressedMB}MB, ${ratio}%) | 耗时: ${elapsed}秒`);
            }

            return { schematicId, meta: finalMeta, totalBlocks, chunkCount, totalSizeBytes };
        } catch (e) {
            loadingTask.status = 'error';
            loadingTask.error = e.message;
            logger.error(`[MegaSchematic] Load failed: ${e.message}`);
            if (player) {
                player.tell(`§c✗ 加载失败: ${e.message}`);
            }
            throw e;
        }
    }

    yieldToGame() {
        return new Promise(resolve => setImmediate(resolve));
    }

    // ==================== 读取 ====================

    getMeta(schematicId) {
        if (this.metaCache.has(schematicId)) {
            return this.metaCache.get(schematicId);
        }
        const meta = this.storage.loadMeta(schematicId);
        if (meta) {
            this.metaCache.set(schematicId, meta);
        }
        return meta;
    }

    loadChunkIndex(schematicId) {
        return this.storage.loadChunkIndex(schematicId);
    }

    loadChunkFromDisk(schematicId, cx, cy, cz) {
        try {
            return this.storage.readChunkRaw(schematicId, cx, cy, cz);
        } catch (e) {
            logger.warn(`[MegaSchematic] Failed to load chunk (${cx},${cy},${cz}): ${e.message}`);
            return null;
        }
    }

    // ==================== 空间查询 ====================

    getBlocksInRange(schematicId, minX, minY, minZ, maxX, maxY, maxZ) {
        const blocks = [];
        const missedChunks = [];

        const minCX = Math.floor(minX / CHUNK_SIZE);
        const maxCX = Math.floor(maxX / CHUNK_SIZE);
        const minCY = Math.floor(minY / CHUNK_SIZE);
        const maxCY = Math.floor(maxY / CHUNK_SIZE);
        const minCZ = Math.floor(minZ / CHUNK_SIZE);
        const maxCZ = Math.floor(maxZ / CHUNK_SIZE);

        for (let cx = minCX; cx <= maxCX; cx++) {
            for (let cy = minCY; cy <= maxCY; cy++) {
                for (let cz = minCZ; cz <= maxCZ; cz++) {
                    const cacheKey = `${schematicId}:${cx},${cy},${cz}`;
                    const cached = this.blockCache.get(cacheKey);

                    if (cached) {
                        for (const block of cached) {
                            if (block.pos[0] >= minX && block.pos[0] <= maxX &&
                                block.pos[1] >= minY && block.pos[1] <= maxY &&
                                block.pos[2] >= minZ && block.pos[2] <= maxZ) {
                                blocks.push(block);
                            }
                        }
                    } else {
                        missedChunks.push({ cx, cy, cz, cacheKey });
                    }
                }
            }
        }

        for (const { cx, cy, cz, cacheKey } of missedChunks) {
            const chunkBlocks = this.loadChunkFromDisk(schematicId, cx, cy, cz);
            if (chunkBlocks) {
                this.blockCache.set(cacheKey, chunkBlocks);
                for (const block of chunkBlocks) {
                    if (block.pos[0] >= minX && block.pos[0] <= maxX &&
                        block.pos[1] >= minY && block.pos[1] <= maxY &&
                        block.pos[2] >= minZ && block.pos[2] <= maxZ) {
                        blocks.push(block);
                    }
                }
            }
        }

        return blocks;
    }

    getBlocksNear(schematicId, relX, relY, relZ, radius) {
        return this.getBlocksInRange(
            schematicId,
            relX - radius, relY - radius, relZ - radius,
            relX + radius, relY + radius, relZ + radius
        );
    }

    getLayerBlocks(schematicId, layerY) {
        const meta = this.getMeta(schematicId);
        if (!meta) return [];

        const chunkIndex = this.loadChunkIndex(schematicId);
        const blocks = [];

        const minCX = 0;
        const maxCX = Math.floor((meta.dimensions.x - 1) / CHUNK_SIZE);
        const minCZ = 0;
        const maxCZ = Math.floor((meta.dimensions.z - 1) / CHUNK_SIZE);
        const cy = Math.floor(layerY / CHUNK_SIZE);

        for (let cx = minCX; cx <= maxCX; cx++) {
            for (let cz = minCZ; cz <= maxCZ; cz++) {
                const cacheKey = `${schematicId}:${cx},${cy},${cz}`;
                let chunkBlocks = this.blockCache.get(cacheKey);

                if (!chunkBlocks) {
                    chunkBlocks = this.loadChunkFromDisk(schematicId, cx, cy, cz);
                    if (chunkBlocks) {
                        this.blockCache.set(cacheKey, chunkBlocks);
                    }
                }

                if (chunkBlocks) {
                    for (const block of chunkBlocks) {
                        if (block.pos[1] === layerY) {
                            blocks.push(block);
                        }
                    }
                }
            }
        }

        return blocks;
    }

    getBlockAt(schematicId, x, y, z) {
        const cx = Math.floor(x / CHUNK_SIZE);
        const cy = Math.floor(y / CHUNK_SIZE);
        const cz = Math.floor(z / CHUNK_SIZE);
        const cacheKey = `${schematicId}:${cx},${cy},${cz}`;

        let chunkBlocks = this.blockCache.get(cacheKey);
        if (!chunkBlocks) {
            chunkBlocks = this.loadChunkFromDisk(schematicId, cx, cy, cz);
            if (chunkBlocks) {
                this.blockCache.set(cacheKey, chunkBlocks);
            }
        }

        if (chunkBlocks) {
            for (const block of chunkBlocks) {
                if (block.pos[0] === x && block.pos[1] === y && block.pos[2] === z) {
                    return block;
                }
            }
        }
        return null;
    }

    // ==================== 管理 ====================

    getLoadingStatus(schematicId) {
        return this.loadingTasks.get(schematicId) || null;
    }

    exists(schematicId) {
        return this.storage.exists(schematicId);
    }

    deleteSchematic(schematicId) {
        this.metaCache.delete(schematicId);
        this.loadingTasks.delete(schematicId);

        for (const [key] of this.blockCache.cache) {
            if (key.startsWith(schematicId + ':')) {
                this.blockCache.delete(key);
            }
        }

        return this.storage.deleteSchematic(schematicId);
    }

    getStats() {
        return {
            blockCacheSize: this.blockCache.size,
            maxCacheSize: LRU_CACHE_SIZE,
            metaCacheSize: this.metaCache.size,
            chunkSize: CHUNK_SIZE,
            loadingTasks: this.loadingTasks.size
        };
    }
}

module.exports = { MegaSchematicManager, LRUCache };
