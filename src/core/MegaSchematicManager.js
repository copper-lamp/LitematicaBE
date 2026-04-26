// MegaSchematicManager - 超大型投影数据管理器
// 使用分块JSON文件存储 + 纯JS LRU缓存
// 支持 500,000+ 方块的大型投影

const fs = require('fs');
const path = require('path');

const CHUNK_SIZE = 16;
const LRU_CACHE_SIZE = 200;
const BATCH_INSERT_SIZE = 5000;

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
        this.basePath = './plugins/LitematicaBE/mega_schematics/';
        this.blockCache = new LRUCache(LRU_CACHE_SIZE);
        this.metaCache = new Map();
        this.loadingTasks = new Map();
        this.ensureDir();
    }

    ensureDir() {
        if (!fs.existsSync(this.basePath)) {
            fs.mkdirSync(this.basePath, { recursive: true });
            logger.info('[MegaSchematic] Created mega_schematics directory');
        }
    }

    ensureSchematicDir(schematicId) {
        const dir = path.join(this.basePath, schematicId);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const chunksDir = path.join(dir, 'chunks');
        if (!fs.existsSync(chunksDir)) {
            fs.mkdirSync(chunksDir, { recursive: true });
        }
        return { dir, chunksDir };
    }

    getChunkFilePath(schematicId, cx, cy, cz) {
        return path.join(this.basePath, schematicId, 'chunks', `chunk_${cx}_${cy}_${cz}.json`);
    }

    getMetaFilePath(schematicId) {
        return path.join(this.basePath, schematicId, 'meta.json');
    }

    getChunkIndexPath(schematicId) {
        return path.join(this.basePath, schematicId, 'chunk_index.json');
    }

    async saveMeta(schematicId, meta) {
        const filePath = this.getMetaFilePath(schematicId);
        try {
            fs.writeFileSync(filePath, JSON.stringify(meta, null, 2));
            this.metaCache.set(schematicId, meta);
        } catch (e) {
            logger.error(`[MegaSchematic] Failed to save meta: ${e.message}`);
        }
    }

    getMeta(schematicId) {
        if (this.metaCache.has(schematicId)) {
            return this.metaCache.get(schematicId);
        }
        const filePath = this.getMetaFilePath(schematicId);
        try {
            if (fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                this.metaCache.set(schematicId, data);
                return data;
            }
        } catch (e) {
            logger.error(`[MegaSchematic] Failed to load meta: ${e.message}`);
        }
        return null;
    }

    async saveChunkIndex(schematicId, chunkIndex) {
        const filePath = this.getChunkIndexPath(schematicId);
        try {
            const obj = {};
            for (const [key, value] of chunkIndex) {
                obj[key] = value;
            }
            fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
        } catch (e) {
            logger.error(`[MegaSchematic] Failed to save chunk index: ${e.message}`);
        }
    }

    loadChunkIndex(schematicId) {
        const filePath = this.getChunkIndexPath(schematicId);
        try {
            if (fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                const map = new Map();
                for (const key in data) {
                    map.set(key, data[key]);
                }
                return map;
            }
        } catch (e) {
            logger.error(`[MegaSchematic] Failed to load chunk index: ${e.message}`);
        }
        return new Map();
    }

    /**
     * 初始化超大型原理图存储
     * @param {string} schematicId 唯一ID
     * @returns {object} { schematicId, dir, chunksDir }
     */
    initMegaSchematic(schematicId) {
        const dirs = this.ensureSchematicDir(schematicId);
        logger.info(`[MegaSchematic] Initialized storage for: ${schematicId}`);
        return { schematicId, ...dirs };
    }

    /**
     * 批量写入方块到分块文件
     * 将一个数组中的方块按 chunk 分组写入磁盘
     * @param {string} schematicId
     * @param {Array} blocks [ {pos:[x,y,z], name, state}, ... ]
     * @param {Map} chunkIndex 分块索引累加器
     * @param {number} totalBlocks 累计方块数（会被更新）
     */
    async writeBlockBatch(schematicId, blocks, chunkIndex) {
        const grouped = new Map();

        for (const block of blocks) {
            const cx = Math.floor(block.pos[0] / CHUNK_SIZE);
            const cy = Math.floor(block.pos[1] / CHUNK_SIZE);
            const cz = Math.floor(block.pos[2] / CHUNK_SIZE);
            const key = `${cx},${cy},${cz}`;

            if (!grouped.has(key)) {
                grouped.set(key, []);
            }
            grouped.get(key).push(block);
        }

        for (const [chunkKey, chunkBlocks] of grouped) {
            const [cxStr, cyStr, czStr] = chunkKey.split(',');
            const cx = parseInt(cxStr), cy = parseInt(cyStr), cz = parseInt(czStr);

            let existing = [];
            const filePath = this.getChunkFilePath(schematicId, cx, cy, cz);

            try {
                if (fs.existsSync(filePath)) {
                    existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                }
            } catch (e) {
                logger.warn(`[MegaSchematic] Error reading chunk ${chunkKey}: ${e.message}`);
            }

            existing = existing.concat(chunkBlocks);
            fs.writeFileSync(filePath, JSON.stringify(existing));

            chunkIndex.set(chunkKey, (chunkIndex.get(chunkKey) || 0) + chunkBlocks.length);
        }
    }

    /**
     * 流式加载大型 .litematic 文件
     * 使用已有的生成器逐块写入磁盘，避免重复解析
     * @param {string} filePath .litematic 文件路径
     * @param {object} streamResult StreamingLitematicLoader.prepareStream 的结果
     * @param {function} onProgress 进度回调 (blocks, total)
     * @returns {object} { schematicId, meta, totalBlocks }
     */
    async loadMegaSchematic(filePath, streamResult, onProgress) {
        const schematicId = 'mega_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const dirs = this.ensureSchematicDir(schematicId);

        logger.info(`[MegaSchematic] Starting mega load: ${filePath} -> ${schematicId}`);

        const loadingTask = { filePath, schematicId, progress: 0, status: 'loading' };
        this.loadingTasks.set(schematicId, loadingTask);

        try {
            if (!streamResult || !streamResult.generator) {
                throw new Error('Invalid stream result');
            }

            const { meta, totalEstimate, generator } = streamResult;

            const chunkIndex = new Map();
            let totalBlocks = 0;
            let batch = [];

            // 使用生成器逐块处理
            for await (const blockBatch of generator) {
                for (const block of blockBatch) {
                    batch.push(block);
                    if (batch.length >= BATCH_INSERT_SIZE) {
                        await this.writeBlockBatch(schematicId, batch, chunkIndex);
                        totalBlocks += batch.length;
                        batch = [];

                        if (onProgress) {
                            onProgress(totalBlocks, totalEstimate);
                        }

                        if (totalBlocks % 50000 === 0) {
                            logger.info(`[MegaSchematic] Progress: ${totalBlocks} blocks written...`);
                        }
                    }
                }
            }

            // 处理剩余批次
            if (batch.length > 0) {
                await this.writeBlockBatch(schematicId, batch, chunkIndex);
                totalBlocks += batch.length;
            }

            // 更新元数据
            const finalMeta = {
                ...meta,
                totalBlocks: totalBlocks,
                filePath: filePath,
                createdAt: Date.now()
            };
            
            await this.saveMeta(schematicId, finalMeta);
            await this.saveChunkIndex(schematicId, chunkIndex);

            loadingTask.status = 'ready';
            loadingTask.progress = 100;

            logger.info(`[MegaSchematic] Load complete: ${schematicId} - ${totalBlocks} blocks, ${chunkIndex.size} chunks`);

            return { schematicId, meta: finalMeta, totalBlocks, chunkCount: chunkIndex.size };
        } catch (e) {
            loadingTask.status = 'error';
            loadingTask.error = e.message;
            logger.error(`[MegaSchematic] Load failed: ${e.message}`);
            throw e;
        }
    }

    *streamDecodeBlocks(palette, blockStates, sizeX, sizeY, sizeZ) {
        const totalBlocks = sizeX * sizeY * sizeZ;
        let bitsPerBlock = Math.max(2, Math.ceil(Math.log2(palette.length)));

        if (palette.length > 256 && bitsPerBlock < 9) bitsPerBlock = 9;
        if (palette.length > 512 && bitsPerBlock < 10) bitsPerBlock = 10;

        const mask = (1n << BigInt(bitsPerBlock)) - 1n;

        for (let blockIndex = 0; blockIndex < totalBlocks; blockIndex++) {
            const x = blockIndex % sizeX;
            const z = Math.floor(blockIndex / sizeX) % sizeZ;
            const y = Math.floor(blockIndex / (sizeX * sizeZ));

            const bitIndex = blockIndex * bitsPerBlock;
            const longIndex = Math.floor(bitIndex / 64);
            const bitOffset = bitIndex % 64;

            if (longIndex >= blockStates.length) continue;

            let paletteIndex;
            if (bitOffset + bitsPerBlock <= 64) {
                paletteIndex = Number((BigInt(blockStates[longIndex]) >> BigInt(bitOffset)) & mask);
            } else {
                const bitsFromLong1 = 64 - bitOffset;
                const bitsFromLong2 = bitsPerBlock - bitsFromLong1;

                if (longIndex + 1 < blockStates.length) {
                    const long1 = BigInt(blockStates[longIndex]);
                    const long2 = BigInt(blockStates[longIndex + 1]);
                    const val1 = (long1 >> BigInt(bitOffset)) & ((1n << BigInt(bitsFromLong1)) - 1n);
                    const val2 = long2 & ((1n << BigInt(bitsFromLong2)) - 1n);
                    paletteIndex = Number(val1 | (val2 << BigInt(bitsFromLong1)));
                } else {
                    paletteIndex = 0;
                }
            }

            if (paletteIndex >= palette.length) {
                paletteIndex = 0;
            }

            const blockState = palette[paletteIndex];
            if (blockState && blockState.Name && !blockState.Name.includes('air')) {
                yield {
                    pos: [x, y, z],
                    name: blockState.Name,
                    state: blockState.Properties || blockState.properties || {}
                };
            }
        }
    }

    parseNBTHeader(data) {
        try {
            if (data[0] !== 10) {
                logger.warn(`[MegaSchematic] NBT root is not TAG_Compound, type=${data[0]}`);
                return null;
            }

            let offset = 1;
            const nameLen = (data[offset] << 8) | data[offset + 1];
            offset += 2 + nameLen;
            return this.parseCompoundLite(data, offset);
        } catch (e) {
            logger.error(`[MegaSchematic] NBT header parse error: ${e.message}`);
            return null;
        }
    }

    parseCompoundLite(data, startOffset) {
        const result = {};
        let offset = startOffset;

        while (offset < data.length) {
            const tagType = data[offset++];
            if (tagType === 0) break;

            if (offset + 2 > data.length) break;
            const nameLen = (data[offset] << 8) | data[offset + 1];
            offset += 2;

            let tagName = '';
            if (nameLen > 0 && offset + nameLen <= data.length) {
                tagName = new TextDecoder().decode(data.slice(offset, offset + nameLen));
                offset += nameLen;
            }

            const result1 = this.readTagValueLite(data, offset, tagType);
            offset = result1.newOffset;

            if (tagName) {
                result[tagName] = result1.value;
            }
        }
        return result;
    }

    readTagValueLite(data, offset, type) {
        let value = null;
        switch (type) {
            case 1: value = data[offset]; offset += 1; break;
            case 2:
                value = (data[offset] << 8) | data[offset + 1];
                if (value > 32767) value -= 65536;
                offset += 2;
                break;
            case 3:
                value = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
                if (value > 2147483647) value -= 4294967296;
                offset += 4;
                break;
            case 4: offset += 8; value = 0; break;
            case 5: offset += 4; value = 0; break;
            case 6: offset += 8; value = 0; break;
            case 7:
                const baLen = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
                offset += 4 + baLen;
                value = [];
                break;
            case 8:
                const strLen = (data[offset] << 8) | data[offset + 1];
                offset += 2;
                if (strLen > 0) {
                    value = new TextDecoder().decode(data.slice(offset, offset + strLen));
                    offset += strLen;
                } else { value = ''; }
                break;
            case 9: {
                const listType = data[offset++];
                const listLen = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
                offset += 4;
                value = [];
                for (let i = 0; i < listLen; i++) {
                    const r = this.readTagValueLite(data, offset, listType);
                    value.push(r.value);
                    offset = r.newOffset;
                }
                break;
            }
            case 10:
                value = this.parseCompoundLite(data, offset);
                let tempOffset = offset, depth = 1;
                while (tempOffset < data.length && depth > 0) {
                    const t = data[tempOffset++];
                    if (t === 0) { depth--; }
                    else if (t === 10) {
                        const n = (data[tempOffset] << 8) | data[tempOffset + 1];
                        tempOffset += 2 + n; depth++;
                    } else {
                        const n = (data[tempOffset] << 8) | data[tempOffset + 1];
                        tempOffset += 2 + n;
                        const skip = this.skipTagLite(data, tempOffset, t);
                        if (skip > 0) tempOffset = skip; else break;
                    }
                }
                offset = tempOffset;
                break;
            case 11: {
                const iaLen = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
                offset += 4 + iaLen * 4;
                value = [];
                break;
            }
            case 12: {
                const laLen = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
                offset += 4 + laLen * 8;
                value = [];
                break;
            }
            default:
                logger.warn(`[MegaSchematic] Unknown NBT tag: ${type}`);
        }
        return { value, newOffset: offset };
    }

    skipTagLite(data, offset, type) {
        try {
            switch (type) {
                case 1: return offset + 1;
                case 2: return offset + 2;
                case 3: return offset + 4;
                case 4: return offset + 8;
                case 5: return offset + 4;
                case 6: return offset + 8;
                case 7: {
                    const len = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
                    return offset + 4 + len;
                }
                case 8: {
                    const len = (data[offset] << 8) | data[offset + 1];
                    return offset + 2 + len;
                }
                case 9:
                case 10: return -1;
                case 11: {
                    const len = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
                    return offset + 4 + len * 4;
                }
                case 12: {
                    const len = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
                    return offset + 4 + len * 8;
                }
                default: return -1;
            }
        } catch (e) {
            return -1;
        }
    }

    /**
     * 读取文件为Uint8Array
     */
    async readFileAsync(filePath) {
        return new Promise((resolve) => {
            try {
                if (fs && fs.readFile) {
                    fs.readFile(filePath, (err, buffer) => {
                        if (err) {
                            const content = File.readFrom(filePath);
                            if (typeof content === 'string') {
                                resolve(new TextEncoder().encode(content));
                            } else if (content instanceof Uint8Array) {
                                resolve(content);
                            } else {
                                resolve(null);
                            }
                        } else {
                            resolve(new Uint8Array(buffer));
                        }
                    });
                } else {
                    const content = File.readFrom(filePath);
                    if (typeof content === 'string') {
                        resolve(new TextEncoder().encode(content));
                    } else if (content instanceof Uint8Array) {
                        resolve(content);
                    } else {
                        resolve(null);
                    }
                }
            } catch (e) {
                logger.error(`[MegaSchematic] Read error: ${e.message}`);
                resolve(null);
            }
        });
    }

    gunzipSync(data) {
        const zlib = global.zlib;
        if (!zlib) {
            logger.error('[MegaSchematic] zlib not available');
            return null;
        }
        try {
            return zlib.gunzipSync(data);
        } catch (e) {
            logger.warn(`[MegaSchematic] gunzipSync failed: ${e.message}`);
        }
        try {
            const inflate = zlib.inflateSync(data);
            return inflate;
        } catch (e2) {
            logger.warn(`[MegaSchematic] inflateSync failed: ${e2.message}`);
        }
        try {
            let pos = 10;
            const flags = data[3];
            if (flags & 0x04) {
                const xlen = data[pos] | (data[pos + 1] << 8);
                pos += 2 + xlen;
            }
            if (flags & 0x08) {
                while (data[pos++] !== 0) {}
            }
            if (flags & 0x10) {
                while (data[pos++] !== 0) {}
            }
            if (flags & 0x02) pos += 2;
            const compressedSize = data.length - 8 - pos;
            const compressed = new Uint8Array(compressedSize);
            for (let i = 0; i < compressedSize; i++) {
                compressed[i] = data[pos + i];
            }
            return zlib.inflateSync(compressed);
        } catch (e3) {
            logger.warn(`[MegaSchematic] All decompression failed: ${e3.message}`);
        }
        return null;
    }

    /**
     * 查询指定范围方块（空间查询）
     * 先查LRU缓存，miss则从磁盘读取
     */
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

    /**
     * 从磁盘加载单个分块
     */
    loadChunkFromDisk(schematicId, cx, cy, cz) {
        const filePath = this.getChunkFilePath(schematicId, cx, cy, cz);
        try {
            if (fs.existsSync(filePath)) {
                return JSON.parse(fs.readFileSync(filePath, 'utf8'));
            }
        } catch (e) {
            logger.warn(`[MegaSchematic] Failed to load chunk (${cx},${cy},${cz}): ${e.message}`);
        }
        return null;
    }

    /**
     * 获取指定层的所有方块
     */
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

    /**
     * 快速空间查询 - 返回附近的所有方块
     * 用于轻松放置的快速查找
     */
    getBlocksNear(schematicId, relX, relY, relZ, radius) {
        return this.getBlocksInRange(
            schematicId,
            relX - radius, relY - radius, relZ - radius,
            relX + radius, relY + radius, relZ + radius
        );
    }

    /**
     * 获取单个方块
     */
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

    /**
     * 获取加载状态
     */
    getLoadingStatus(schematicId) {
        return this.loadingTasks.get(schematicId) || null;
    }

    /**
     * 检查是否存在
     */
    exists(schematicId) {
        return fs.existsSync(this.getMetaFilePath(schematicId));
    }

    /**
     * 删除超大型投影数据
     */
    deleteSchematic(schematicId) {
        const dir = path.join(this.basePath, schematicId);
        this.metaCache.delete(schematicId);
        this.loadingTasks.delete(schematicId);

        for (const [key] of this.blockCache.cache) {
            if (key.startsWith(schematicId + ':')) {
                this.blockCache.delete(key);
            }
        }

        try {
            if (fs.existsSync(dir)) {
                this.deleteDirSync(dir);
                logger.info(`[MegaSchematic] Deleted: ${schematicId}`);
                return true;
            }
        } catch (e) {
            logger.error(`[MegaSchematic] Delete failed: ${e.message}`);
        }
        return false;
    }

    deleteDirSync(dirPath) {
        if (fs.existsSync(dirPath)) {
            const entries = fs.readdirSync(dirPath);
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry);
                if (fs.statSync(fullPath).isDirectory()) {
                    this.deleteDirSync(fullPath);
                } else {
                    fs.unlinkSync(fullPath);
                }
            }
            fs.rmdirSync(dirPath);
        }
    }

    getStats() {
        return {
            basePath: this.basePath,
            metaCacheSize: this.metaCache.size,
            blockCacheSize: this.blockCache.size,
            maxCacheSize: LRU_CACHE_SIZE,
            chunkSize: CHUNK_SIZE,
            loadingTasks: this.loadingTasks.size
        };
    }
}

module.exports = { MegaSchematicManager, LRUCache };
