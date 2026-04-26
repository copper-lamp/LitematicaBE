// StreamingLitematicLoader - 流式.litematic文件加载器
// 使用生成器逐块产出方块，避免一次性全量加载到内存
// 用于超大型投影（500,000+ 方块）的流式加载

class StreamingLitematicLoader {
    constructor() {
        this.debugMode = false;
    }

    /**
     * 流式解析 .litematic 文件
     * @param {LitematicLoader} loader LitematicLoader实例（复用NBT解析能力）
     * @param {string} filePath .litematic 文件路径
     * @returns {object} generator result
     *   - generator: 异步生成器，逐块yield方块数组
     *   - meta: { name, author, dimensions, version }
     *   - totalEstimate: 预估总方块数
     */
    async prepareStream(loader, filePath) {
        const fileData = await this.readFileAsync(filePath);
        if (!fileData) {
            throw new Error(`Cannot read file: ${filePath}`);
        }

        logger.info(`[StreamLoader] File size: ${fileData.length} bytes`);

        let decompressed = null;
        let nbtData = null;

        if (fileData[0] === 0x1f && fileData[1] === 0x8b) {
            decompressed = this.gunzipData(fileData);
            if (decompressed) {
                nbtData = this.parseNBTHeader(decompressed);
            }
        }

        if (!nbtData) {
            nbtData = this.parseNBTHeader(fileData);
            decompressed = fileData;
        }

        if (!nbtData) {
            throw new Error('Failed to parse NBT header');
        }

        const meta = {
            name: (nbtData.Metadata && nbtData.Metadata.Name) || 'Unknown',
            author: (nbtData.Metadata && nbtData.Metadata.Author) || 'Unknown',
            description: (nbtData.Metadata && nbtData.Metadata.Description) || '',
            version: nbtData.Version || 0,
            dimensions: { x: 0, y: 0, z: 0 }
        };

        const regions = nbtData.Regions || {};
        const regionSpecs = [];
        let totalEstimate = 0;

        for (const regionName in regions) {
            const region = regions[regionName];
            if (typeof region !== 'object') continue;

            let size = region.Size;
            if (!size) {
                size = {
                    x: Math.abs(region.SizeX || 0),
                    y: Math.abs(region.SizeY || 0),
                    z: Math.abs(region.SizeZ || 0)
                };
            }
            const sizeX = Math.abs(size.x || 0);
            const sizeY = Math.abs(size.y || 0);
            const sizeZ = Math.abs(size.z || 0);

            if (sizeX > meta.dimensions.x) meta.dimensions.x = sizeX;
            if (sizeY > meta.dimensions.y) meta.dimensions.y = sizeY;
            if (sizeZ > meta.dimensions.z) meta.dimensions.z = sizeZ;

            const palette = region.BlockStatePalette || region.Palette || region.palette || [];
            const blockStates = region.BlockStates || region.blockStates || region.block_states || [];

            regionSpecs.push({ palette, blockStates, sizeX, sizeY, sizeZ });
            totalEstimate += sizeX * sizeY * sizeZ;
        }

        const generator = this.createBlockGenerator(regionSpecs, meta.dimensions);

        return { generator, meta, totalEstimate };
    }

    /**
     * 创建方块生成器
     */
    *createBlockGenerator(regionSpecs, totalDims) {
        let globalOffsetX = 0;
        let globalOffsetY = 0;
        let globalOffsetZ = 0;

        for (const spec of regionSpecs) {
            const { palette, blockStates, sizeX, sizeY, sizeZ } = spec;
            if (palette.length === 0 || blockStates.length === 0) continue;

            let bitsPerBlock = Math.max(2, Math.ceil(Math.log2(palette.length)));
            if (palette.length > 256 && bitsPerBlock < 9) bitsPerBlock = 9;
            if (palette.length > 512 && bitsPerBlock < 10) bitsPerBlock = 10;

            const mask = (1n << BigInt(bitsPerBlock)) - 1n;
            const totalBlocks = sizeX * sizeY * sizeZ;
            const BATCH_SIZE = 5000;
            let batch = [];

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

                if (paletteIndex >= palette.length) paletteIndex = 0;

                const blockState = palette[paletteIndex];
                if (blockState && blockState.Name && !blockState.Name.includes('air')) {
                    batch.push({
                        pos: [globalOffsetX + x, globalOffsetY + y, globalOffsetZ + z],
                        name: blockState.Name,
                        state: blockState.Properties || blockState.properties || {}
                    });

                    if (batch.length >= BATCH_SIZE) {
                        yield batch;
                        batch = [];
                    }
                }
            }

            if (batch.length > 0) {
                yield batch;
            }
        }
    }

    /**
     * 读取文件为Uint8Array
     */
    async readFileAsync(filePath) {
        return new Promise((resolve) => {
            try {
                const fs = global.fs;
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
                logger.error(`[StreamLoader] Read error: ${e.message}`);
                resolve(null);
            }
        });
    }

    /**
     * GZIP解压
     */
    gunzipData(data) {
        const zlib = global.zlib;
        if (!zlib) return null;

        try {
            return zlib.gunzipSync(data);
        } catch (e) {
            logger.warn(`[StreamLoader] gunzipSync failed: ${e.message}`);
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
        } catch (e) {
            logger.warn(`[StreamLoader] inflateSync failed: ${e.message}`);
        }

        return null;
    }

    /**
     * 解析NBT头部（只解析到顶层结构，不解析所有方块）
     */
    parseNBTHeader(data) {
        try {
            if (data[0] !== 10) {
                logger.warn(`[StreamLoader] Root is not TAG_Compound, type=${data[0]}`);
                return null;
            }

            let offset = 1;
            const nameLen = (data[offset] << 8) | data[offset + 1];
            offset += 2 + nameLen;
            return this.parseCompoundLite(data, offset);
        } catch (e) {
            logger.error(`[StreamLoader] NBT parse error: ${e.message}`);
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

            const r = this.readTagLite(data, offset, tagType);
            offset = r.newOffset;

            if (tagName) {
                result[tagName] = r.value;
            }
        }
        return result;
    }

    readTagLite(data, offset, type) {
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
                value = strLen > 0 ? new TextDecoder().decode(data.slice(offset, offset + strLen)) : '';
                offset += strLen;
                break;
            case 9: {
                const listType = data[offset++];
                const listLen = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
                offset += 4;
                value = [];
                for (let i = 0; i < listLen; i++) {
                    const r = this.readTagLite(data, offset, listType);
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
                        const skip = this.skipTag(data, tempOffset, t);
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
                logger.warn(`[StreamLoader] Unknown tag type: ${type}`);
        }
        return { value, newOffset: offset };
    }

    skipTag(data, offset, type) {
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
}

module.exports = { StreamingLitematicLoader };
