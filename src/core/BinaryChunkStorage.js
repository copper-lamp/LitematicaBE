// BinaryChunkStorage v2.1 — .mcmega 二进制分块存储
// 采用与 .litematic 相同的压缩策略：调色板 + 位打包 + GZip 压缩
// 分块大小: 32×32×32 (32768 个位置)
// 使用 Node.js 内置 zlib 模块，确保压缩真正生效

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MCMEGA_MAGIC = 0x4D434D47;
const MCMEGA_VERSION = 2;
const HEADER_SIZE = 9;
const CHUNK_SIZE = 32;
const CHUNK_TOTAL = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;
const MIN_BITS_PER_ENTRY = 2;

class BinaryChunkStorage {
    constructor(basePath) {
        this.basePath = basePath || './plugins/LitematicaBE/mega_schematics/';
        this.ensureDir();
    }

    ensureDir() {
        if (!fs.existsSync(this.basePath)) {
            fs.mkdirSync(this.basePath, { recursive: true });
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
        return path.join(this.basePath, schematicId, 'chunks', `chunk_${cx}_${cy}_${cz}.mcmega`);
    }

    getMetaFilePath(schematicId) {
        return path.join(this.basePath, schematicId, 'meta.json');
    }

    getChunkIndexPath(schematicId) {
        return path.join(this.basePath, schematicId, 'chunk_index.json');
    }

    // ==================== 调色板编码 ====================

    posToIndex(rx, ry, rz) {
        return rx + ry * CHUNK_SIZE + rz * CHUNK_SIZE * CHUNK_SIZE;
    }

    indexToPos(index) {
        const rx = index % CHUNK_SIZE;
        const ry = Math.floor(index / CHUNK_SIZE) % CHUNK_SIZE;
        const rz = Math.floor(index / (CHUNK_SIZE * CHUNK_SIZE));
        return [rx, ry, rz];
    }

    buildPalette(blocks) {
        const paletteMap = new Map();
        const palette = [];
        let nextId = 1;

        for (const block of blocks) {
            const stateEntries = Object.entries(block.state || {}).sort((a, b) => a[0].localeCompare(b[0]));
            const key = block.name + '|' + stateEntries.map(([k, v]) => `${k}=${v}`).join(',');

            if (!paletteMap.has(key)) {
                paletteMap.set(key, nextId);
                palette.push({ name: block.name, state: block.state || {}, key });
                nextId++;
            }
        }

        return { palette, paletteMap };
    }

    serializePalette(palette) {
        const parts = [];
        parts.push(Buffer.from([palette.length & 0xFF, (palette.length >> 8) & 0xFF]));

        for (const entry of palette) {
            const nameBytes = Buffer.from(entry.name, 'utf8');
            parts.push(Buffer.from([nameBytes.length & 0xFF]));
            parts.push(nameBytes);

            const stateEntries = Object.entries(entry.state).sort((a, b) => a[0].localeCompare(b[0]));
            parts.push(Buffer.from([stateEntries.length & 0xFF]));

            for (const [key, value] of stateEntries) {
                const keyBytes = Buffer.from(key, 'utf8');
                const valBytes = Buffer.from(String(value), 'utf8');
                parts.push(Buffer.from([keyBytes.length & 0xFF]));
                parts.push(keyBytes);
                parts.push(Buffer.from([valBytes.length & 0xFF]));
                parts.push(valBytes);
            }
        }

        return Buffer.concat(parts);
    }

    deserializePalette(data, offset) {
        const paletteLen = data[offset] | (data[offset + 1] << 8);
        offset += 2;

        const palette = [];
        for (let i = 0; i < paletteLen; i++) {
            const nameLen = data[offset];
            offset += 1;
            const name = data.toString('utf8', offset, offset + nameLen);
            offset += nameLen;

            const stateCount = data[offset];
            offset += 1;

            const state = {};
            for (let s = 0; s < stateCount; s++) {
                const keyLen = data[offset];
                offset += 1;
                const key = data.toString('utf8', offset, offset + keyLen);
                offset += keyLen;

                const valLen = data[offset];
                offset += 1;
                const value = data.toString('utf8', offset, offset + valLen);
                offset += valLen;

                state[key] = value;
            }

            palette.push({ name, state });
        }

        return { palette, newOffset: offset };
    }

    // ==================== 位打包（支持任意 bitsPerEntry） ====================

    encodeBitPacked(paletteMap, blocks, bitsPerEntry) {
        if (blocks.length === 0) return Buffer.alloc(0);

        const totalBits = CHUNK_TOTAL * bitsPerEntry;
        const totalBytes = Math.ceil(totalBits / 8);
        const buffer = Buffer.alloc(totalBytes);
        const mask = (1 << bitsPerEntry) - 1;

        // 先构建位置→paletteId的映射
        const posMap = new Uint32Array(CHUNK_TOTAL);
        for (const block of blocks) {
            const rx = ((block.pos[0] % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
            const ry = ((block.pos[1] % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
            const rz = ((block.pos[2] % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
            const flatIndex = this.posToIndex(rx, ry, rz);

            const stateEntries = Object.entries(block.state || {}).sort((a, b) => a[0].localeCompare(b[0]));
            const key = block.name + '|' + stateEntries.map(([k, v]) => `${k}=${v}`).join(',');
            posMap[flatIndex] = paletteMap.get(key) || 0;
        }

        // 将每个 paletteId 写入位打包数组
        for (let flatIndex = 0; flatIndex < CHUNK_TOTAL; flatIndex++) {
            const paletteId = posMap[flatIndex] & mask;
            if (paletteId === 0) continue;

            const bitOffset = flatIndex * bitsPerEntry;
            let byteOffset = Math.floor(bitOffset / 8);
            let bitShift = bitOffset % 8;
            let remainingBits = bitsPerEntry;
            let bitsToWrite = paletteId;

            while (remainingBits > 0 && byteOffset < totalBytes) {
                const availableBits = 8 - bitShift;
                const writeBits = Math.min(remainingBits, availableBits);
                const writeMask = (1 << writeBits) - 1;

                buffer[byteOffset] = (buffer[byteOffset] || 0) | ((bitsToWrite & writeMask) << bitShift);

                bitsToWrite >>= writeBits;
                remainingBits -= writeBits;
                byteOffset++;
                bitShift = 0;
            }
        }

        return buffer;
    }

    decodeBitPacked(data, offset, palette, bitsPerEntry) {
        const blocks = [];
        const mask = (1 << bitsPerEntry) - 1;
        const totalBits = CHUNK_TOTAL * bitsPerEntry;
        const totalBytes = Math.ceil(totalBits / 8);

        for (let flatIndex = 0; flatIndex < CHUNK_TOTAL; flatIndex++) {
            const bitOffset = flatIndex * bitsPerEntry;
            let byteOffset = offset + Math.floor(bitOffset / 8);
            let bitShift = bitOffset % 8;
            let remainingBits = bitsPerEntry;
            let paletteId = 0;
            let outShift = 0;

            while (remainingBits > 0 && byteOffset < data.length) {
                const availableBits = 8 - bitShift;
                const readBits = Math.min(remainingBits, availableBits);
                const readMask = (1 << readBits) - 1;

                paletteId |= ((data[byteOffset] >> bitShift) & readMask) << outShift;

                outShift += readBits;
                remainingBits -= readBits;
                byteOffset++;
                bitShift = 0;
            }

            paletteId &= mask;

            if (paletteId > 0 && paletteId <= palette.length) {
                const paletteEntry = palette[paletteId - 1];
                const [rx, ry, rz] = this.indexToPos(flatIndex);
                blocks.push({
                    pos: [rx, ry, rz],
                    name: paletteEntry.name,
                    state: paletteEntry.state || {}
                });
            }
        }

        return blocks;
    }

    // ==================== 写入（异步，不阻塞） ====================

    writeChunk(schematicId, cx, cy, cz, blocks, blockCount) {
        const { chunksDir } = this.ensureSchematicDir(schematicId);
        const filePath = this.getChunkFilePath(schematicId, cx, cy, cz);

        if (!blocks || blocks.length === 0) {
            return { filePath, blockCount: 0, sizeBytes: 0 };
        }

        const { palette, paletteMap } = this.buildPalette(blocks);
        const paletteSize = palette.length;
        const bitsPerEntry = Math.max(MIN_BITS_PER_ENTRY, Math.ceil(Math.log2(paletteSize + 1)));

        const paletteData = this.serializePalette(palette);
        const packedData = this.encodeBitPacked(paletteMap, blocks, bitsPerEntry);

        const header = Buffer.alloc(HEADER_SIZE);
        header.writeUInt32LE(MCMEGA_MAGIC, 0);
        header.writeUInt16LE(MCMEGA_VERSION, 4);
        header.writeUInt8(bitsPerEntry, 6);
        header.writeUInt16LE(paletteSize, 7);

        const rawData = Buffer.concat([header, paletteData, packedData]);

        let compressed = rawData;
        try {
            compressed = zlib.gzipSync(rawData, { level: zlib.constants.Z_BEST_COMPRESSION });
        } catch (e) {
            logger.warn(`[BinaryChunk] GZip failed for chunk (${cx},${cy},${cz}): ${e.message}`);
        }

        fs.writeFileSync(filePath, compressed);

        return {
            filePath,
            blockCount: blocks.length,
            sizeBytes: compressed.length,
            uncompressedSize: rawData.length,
            paletteSize,
            bitsPerEntry,
            compressionRatio: rawData.length > 0 ? (compressed.length / rawData.length).toFixed(2) : '1.00'
        };
    }

    writeBlockBatch(schematicId, blocks, chunkIndex) {
        if (!blocks || blocks.length === 0) {
            return { totalWritten: 0, totalSizeBytes: 0, chunkCount: 0 };
        }

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

        let totalWritten = 0;
        let totalSizeBytes = 0;
        let totalUncompressed = 0;

        for (const [chunkKey, chunkBlocks] of grouped) {
            const [cxStr, cyStr, czStr] = chunkKey.split(',');
            const cx = parseInt(cxStr), cy = parseInt(cyStr), cz = parseInt(czStr);

            const result = this.writeChunk(schematicId, cx, cy, cz, chunkBlocks, chunkBlocks.length);

            chunkIndex.set(chunkKey, (chunkIndex.get(chunkKey) || 0) + chunkBlocks.length);
            totalWritten += chunkBlocks.length;
            totalSizeBytes += result.sizeBytes;
            totalUncompressed += result.uncompressedSize;
        }

        return {
            totalWritten,
            totalSizeBytes,
            totalUncompressed,
            chunkCount: grouped.size,
            overallRatio: totalUncompressed > 0 ? (totalSizeBytes / totalUncompressed).toFixed(2) : '1.00'
        };
    }

    // ==================== 读取 ====================

    readChunkRaw(schematicId, cx, cy, cz) {
        const filePath = this.getChunkFilePath(schematicId, cx, cy, cz);
        if (!fs.existsSync(filePath)) return [];

        let compressed = fs.readFileSync(filePath);
        if (!compressed || compressed.length === 0) return [];

        let data = compressed;

        try {
            if (compressed[0] === 0x1f && compressed[1] === 0x8b) {
                data = zlib.gunzipSync(compressed);
            }
        } catch (e) {
            logger.warn(`[BinaryChunk] Decompress failed for chunk (${cx},${cy},${cz}): ${e.message}`);
            data = compressed;
        }

        return this.decodeChunkData(data, cx, cy, cz);
    }

    decodeChunkData(data, cx, cy, cz) {
        if (!data || data.length < HEADER_SIZE) return [];

        const magic = data.readUInt32LE(0);
        const version = data.readUInt16LE(4);
        const bitsPerEntry = data.readUInt8(6);
        const paletteSize = data.readUInt16LE(7);

        if (magic !== MCMEGA_MAGIC) {
            throw new Error(`Invalid .mcmega magic: 0x${magic.toString(16)}`);
        }

        let offset = HEADER_SIZE;

        const { palette, newOffset } = this.deserializePalette(data, offset);
        offset = newOffset;

        const blocks = this.decodeBitPacked(data, offset, palette, bitsPerEntry);

        const globalBaseX = cx * CHUNK_SIZE;
        const globalBaseY = cy * CHUNK_SIZE;
        const globalBaseZ = cz * CHUNK_SIZE;

        for (const block of blocks) {
            block.pos[0] += globalBaseX;
            block.pos[1] += globalBaseY;
            block.pos[2] += globalBaseZ;
        }

        return blocks;
    }

    // ==================== 元数据 & 索引 ====================

    saveMeta(schematicId, meta) {
        const filePath = this.getMetaFilePath(schematicId);
        try {
            fs.writeFileSync(filePath, JSON.stringify(meta, null, 2));
            return true;
        } catch (e) {
            logger.error(`[BinaryChunk] Failed to save meta: ${e.message}`);
            return false;
        }
    }

    loadMeta(schematicId) {
        const filePath = this.getMetaFilePath(schematicId);
        try {
            if (fs.existsSync(filePath)) {
                return JSON.parse(fs.readFileSync(filePath, 'utf8'));
            }
        } catch (e) {
            logger.error(`[BinaryChunk] Failed to load meta: ${e.message}`);
        }
        return null;
    }

    saveChunkIndex(schematicId, chunkIndex) {
        const filePath = this.getChunkIndexPath(schematicId);
        try {
            const obj = {};
            for (const [key, value] of chunkIndex) {
                obj[key] = value;
            }
            fs.writeFileSync(filePath, JSON.stringify(obj));
            return true;
        } catch (e) {
            logger.error(`[BinaryChunk] Failed to save chunk index: ${e.message}`);
            return false;
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
            logger.error(`[BinaryChunk] Failed to load chunk index: ${e.message}`);
        }
        return new Map();
    }

    exists(schematicId) {
        return fs.existsSync(this.getMetaFilePath(schematicId));
    }

    deleteSchematic(schematicId) {
        const dir = path.join(this.basePath, schematicId);
        try {
            if (fs.existsSync(dir)) {
                this.deleteDirSync(dir);
                return true;
            }
        } catch (e) {
            logger.error(`[BinaryChunk] Delete failed: ${e.message}`);
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

    listChunkFiles(schematicId) {
        const chunksDir = path.join(this.basePath, schematicId, 'chunks');
        try {
            if (fs.existsSync(chunksDir)) {
                return fs.readdirSync(chunksDir)
                    .filter(f => f.endsWith('.mcmega'))
                    .map(f => {
                        const match = f.match(/chunk_(-?\d+)_(-?\d+)_(-?\d+)\.mcmega/);
                        if (match) {
                            return { cx: parseInt(match[1]), cy: parseInt(match[2]), cz: parseInt(match[3]), file: f };
                        }
                        return null;
                    })
                    .filter(x => x !== null);
            }
        } catch (e) {
            logger.error(`[BinaryChunk] List chunks failed: ${e.message}`);
        }
        return [];
    }
}

module.exports = { BinaryChunkStorage, MCMEGA_MAGIC, MCMEGA_VERSION, HEADER_SIZE, CHUNK_SIZE };
