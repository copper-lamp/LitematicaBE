// LitematicLoader - 加载和解析.litematic文件
// 支持GZIP解压、NBT解析、调色板解码

const { NBTParser, NBT_TAGS } = require('./NBT');
const { PaletteDecoder } = require('./PaletteDecoder');
const { bidirectionalConverter } = require('../mappings/BidirectionalBlockConverter');

let zlib = null;
let fs = null;
try {
    zlib = global.zlib || require('zlib');
} catch (e) {
    logger.warn("zlib not available in LitematicLoader");
}

try {
    fs = global.fs || require('fs');
} catch (e) {
    logger.warn("fs not available in LitematicLoader");
}

class LitematicLoader {
    constructor() {
        this.schematics = new Map();
        this._initTagHandlers();
    }

    /**
     * 初始化NBT标签处理器注册表
     * 统一管理所有12种NBT标签类型的读写和跳过逻辑，消除重复代码
     * - size !== null: 固定大小标签，read/skip 直接使用
     * - size === null: 动态大小标签，read 返回 { value, size }，skip 返回新 offset
     */
    _initTagHandlers() {
        this._TAG_HANDLERS = {
            // TAG_Byte (1)
            1: {
                size: 1,
                read: (data, offset) => data[offset]
            },
            // TAG_Short (2)
            2: {
                size: 2,
                read: (data, offset) => {
                    let value = (data[offset] << 8) | data[offset + 1];
                    return value > 32767 ? value - 65536 : value;
                }
            },
            // TAG_Int (3)
            3: {
                size: 4,
                read: (data, offset) => {
                    let value = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
                    return value > 2147483647 ? value - 4294967296 : value;
                }
            },
            // TAG_Long (4) - 使用BigInt避免JS Number符号溢出
            4: {
                size: 8,
                read: (data, offset) => {
                    let longVal = 0n;
                    for (let j = 0; j < 8; j++) {
                        longVal = (longVal << 8n) | BigInt(data[offset + j]);
                    }
                    return longVal;
                }
            },
            // TAG_Float (5)
            5: {
                size: 4,
                read: (data, offset) => {
                    const buf = new ArrayBuffer(4);
                    new Uint8Array(buf).set(data.slice(offset, offset + 4));
                    return new DataView(buf).getFloat32(0);
                }
            },
            // TAG_Double (6)
            6: {
                size: 8,
                read: (data, offset) => {
                    const buf = new ArrayBuffer(8);
                    new Uint8Array(buf).set(data.slice(offset, offset + 8));
                    return new DataView(buf).getFloat64(0);
                }
            },
            // TAG_Byte_Array (7) - 动态大小
            7: {
                size: null,
                read: (data, offset) => {
                    const len = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
                    const value = Array.from(data.slice(offset + 4, offset + 4 + len));
                    return { value, size: 4 + len };
                },
                skip: (data, offset) => {
                    const len = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
                    return offset + 4 + len;
                }
            },
            // TAG_String (8) - 动态大小
            8: {
                size: null,
                read: (data, offset) => {
                    const len = (data[offset] << 8) | data[offset + 1];
                    const value = len > 0
                        ? new TextDecoder().decode(data.slice(offset + 2, offset + 2 + len))
                        : '';
                    return { value, size: 2 + len };
                },
                skip: (data, offset) => {
                    const len = (data[offset] << 8) | data[offset + 1];
                    return offset + 2 + len;
                }
            },
            // TAG_List (9) - 动态大小
            9: {
                size: null,
                read: (data, offset) => {
                    const listType = data[offset];
                    const listLen = (data[offset + 1] << 24) | (data[offset + 2] << 16) | (data[offset + 3] << 8) | data[offset + 4];
                    let cur = offset + 5;
                    const value = [];
                    for (let i = 0; i < listLen; i++) {
                        const { value: item, newOffset } = this.readTagValue(data, cur, listType);
                        value.push(item);
                        cur = newOffset;
                    }
                    return { value, size: cur - offset };
                },
                skip: (data, offset) => {
                    const listType = data[offset];
                    const listLen = (data[offset + 1] << 24) | (data[offset + 2] << 16) | (data[offset + 3] << 8) | data[offset + 4];
                    let cur = offset + 5;
                    for (let i = 0; i < listLen; i++) {
                        cur = this.skipTagValue(data, cur, listType);
                    }
                    return cur;
                }
            },
            // TAG_Compound (10) - 动态大小
            10: {
                size: null,
                read: (data, offset) => {
                    const { result, newOffset } = this.parseCompoundContent(data, offset);
                    return { value: result, size: newOffset - offset };
                },
                skip: (data, offset) => {
                    let cur = offset;
                    while (cur < data.length) {
                        const t = data[cur++];
                        if (t === 0) break;
                        const n = (data[cur] << 8) | data[cur + 1];
                        cur += 2 + n;
                        cur = this.skipTagValue(data, cur, t);
                    }
                    return cur;
                }
            },
            // TAG_Int_Array (11) - 动态大小
            11: {
                size: null,
                read: (data, offset) => {
                    const len = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
                    let cur = offset + 4;
                    const value = [];
                    for (let i = 0; i < len; i++) {
                        value.push((data[cur] << 24) | (data[cur + 1] << 16) | (data[cur + 2] << 8) | data[cur + 3]);
                        cur += 4;
                    }
                    return { value, size: 4 + len * 4 };
                },
                skip: (data, offset) => {
                    const len = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
                    return offset + 4 + len * 4;
                }
            },
            // TAG_Long_Array (12) - 动态大小
            12: {
                size: null,
                read: (data, offset) => {
                    const len = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
                    let cur = offset + 4;
                    const value = [];
                    for (let i = 0; i < len; i++) {
                        let laVal = 0n;
                        for (let j = 0; j < 8; j++) {
                            laVal = (laVal << 8n) | BigInt(data[cur + j]);
                        }
                        value.push(laVal);
                        cur += 8;
                    }
                    return { value, size: 4 + len * 8 };
                },
                skip: (data, offset) => {
                    const len = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
                    return offset + 4 + len * 8;
                }
            }
        };
    }

    _safeNumber(val) {
        if (val === null || val === undefined) return null;
        if (typeof val === 'bigint') return Number(val);
        return val;
    }

    /**
     * 加载.litematic文件
     */
    async load(filePath) {
        try {
            if (this.schematics.has(filePath)) {
                return this.schematics.get(filePath);
            }

            logger.info(`Loading schematic from: ${filePath}`);
            
            // 读取文件
            const fileData = await this.readFileBinary(filePath);
            if (!fileData) {
                throw new Error(`Cannot read file: ${filePath}`);
            }
            
            logger.info(`File size: ${fileData.length} bytes`);
            logger.info(`First 2 bytes: 0x${fileData[0].toString(16)}, 0x${fileData[1].toString(16)}`);
            
            // 检查文件格式
            let nbtData = null;
            let decompressed = null;
            
            if (fileData[0] === 0x1f && fileData[1] === 0x8b) {
                // GZIP压缩格式 - 尝试解压
                logger.info("Detected GZIP format, attempting decompression...");
                decompressed = this.gunzip(fileData);
                if (decompressed) {
                    nbtData = this.parseNBTFromBytes(decompressed);
                }
            }
            
            // 如果GZIP解压失败或不适用，尝试直接解析
            if (!nbtData) {
                logger.info("Attempting direct NBT parsing...");
                nbtData = this.parseNBTFromBytes(fileData);
                decompressed = fileData;
            }
            
            if (!nbtData) {
                throw new Error("Failed to parse NBT data");
            }
            
            logger.info(`NBT parsed successfully, keys: ${Object.keys(nbtData).join(', ')}`);
            
            // 转换为标准格式
            const schematic = this.parseLitematic(nbtData, filePath);
            
            logger.info(`Schematic loaded: ${schematic.name}, ${schematic.totalBlocks} blocks, size: ${schematic.dimensions?.x}x${schematic.dimensions?.y}x${schematic.dimensions?.z}`);
            
            // 保存调试信息到文件
            this.saveDebugInfo(schematic, nbtData, decompressed);
            
            // 缓存
            this.schematics.set(filePath, schematic);
            
            logger.info(`[LitematicaBE] About to return schematic, blocks length: ${schematic.blocks?.length || 0}`);
            
            return schematic;
        } catch (error) {
            logger.error(`Failed to load litematic: ${error.message}`);
            throw error;
        }
    }

    /**
     * 读取文件为Uint8Array (异步方式)
     */
    readFileBinary(filePath) {
        return new Promise((resolve, reject) => {
            // 使用fs异步读取
            if (fs) {
                try {
                    fs.readFile(filePath, (err, buffer) => {
                        if (err) {
                            logger.warn(`fs.readFile failed: ${err.message}`);
                            // 回退到File.readFrom
                            resolve(this.readFileBinarySync(filePath));
                        } else {
                            logger.info(`fs.readFile succeeded, got ${buffer.length} bytes`);
                            resolve(new Uint8Array(buffer));
                        }
                    });
                    return;
                } catch (e) {
                    logger.warn(`fs.readFile error: ${e.message}`);
                }
            }
            
            // 同步回退
            resolve(this.readFileBinarySync(filePath));
        });
    }
    
    /**
     * 同步读取文件 (回退方案)
     */
    readFileBinarySync(filePath) {
        try {
            const content = File.readFrom(filePath);
            if (!content) {
                logger.error("File.readFrom returned null");
                return null;
            }

            if (typeof content === 'string') {
                if (/^[A-Za-z0-9+/=\s]*$/.test(content.trim())) {
                    try {
                        const binaryStr = atob(content.trim());
                        const bytes = new Uint8Array(binaryStr.length);
                        for (let i = 0; i < binaryStr.length; i++) {
                            bytes[i] = binaryStr.charCodeAt(i) & 0xFF;
                        }
                        return bytes;
                    } catch (e) {}
                }
                const bytes = new Uint8Array(content.length);
                for (let i = 0; i < content.length; i++) {
                    bytes[i] = content.charCodeAt(i) & 0xFF;
                }
                return bytes;
            }

            if (content instanceof Uint8Array) {
                return content;
            }

            const str = String(content);
            const bytes = new Uint8Array(str.length);
            for (let i = 0; i < str.length; i++) {
                bytes[i] = str.charCodeAt(i) & 0xFF;
            }
            return bytes;
        } catch (e) {
            logger.error(`Error reading file: ${e.message}`);
            return null;
        }
    }
    
    /**
     * 将JSON格式转换为简化的NBT格式
     */
    convertJsonToNbtBuffer(json) {
        // 解析自定义JSON格式
        // 这种格式直接在Metadata和Region中包含数据
        const result = {
            Version: 4,
            Metadata: json.Metadata || {},
            SizeX: json.Region?.LiteTickets?.[0]?.Blocks?.length ? Math.sqrt(json.Region.LiteTickets[0].Blocks.length) || 0 : 0,
            SizeY: 10,
            SizeZ: json.Region?.LiteTickets?.[0]?.Blocks?.length ? Math.sqrt(json.Region.LiteTickets[0].Blocks.length) || 0 : 0,
            Dimension: 0,
            Regions: []
        };
        
        // 解析方块数据
        if (json.Region?.LiteTickets) {
            for (const ticket of json.Region.LiteTickets) {
                if (ticket.Blocks) {
                    const blocks = [];
                    for (let i = 0; i < ticket.Blocks.length; i++) {
                        const block = ticket.Blocks[i];
                        if (block && block.id !== 0) {
                            const x = i % result.SizeX;
                            const z = Math.floor(i / result.SizeX) % result.SizeZ;
                            const y = Math.floor(i / (result.SizeX * result.SizeZ));
                            blocks.push({
                                pos: [x, y, z],
                                id: block.id,
                                data: block.data || 0
                            });
                        }
                    }
                    result.Regions.push({
                        Blocks: blocks
                    });
                }
            }
        }
        
        logger.info(`Converted JSON: ${result.SizeX}x${result.SizeY}x${result.SizeZ}, ${result.Regions[0]?.Blocks?.length || 0} blocks`);
        
        // 存储原始JSON供后续使用
        this.lastJsonData = json;
        
        return result;
    }

    /**
     * GZIP解压 - 简化版，直接使用zlib
     */
    gunzip(data) {
        if (!zlib) {
            logger.error("zlib module not available");
            return null;
        }

        try {
            logger.info(`GZIP data length: ${data.length}, first bytes: ${data[0].toString(16)} ${data[1].toString(16)}`);
            
            // 首先尝试直接用gunzipSync解压整个数据
            try {
                const result = zlib.gunzipSync(data);
                logger.info(`gunzipSync success! Decompressed size: ${result.length}`);
                return result;
            } catch (e) {
                logger.warn(`gunzipSync failed: ${e.message}`);
            }

            // 如果上面失败，尝试解压原始DEFLATE数据
            // 跳过GZIP头
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
            if (flags & 0x02) {
                pos += 2;
            }
            
            const compressedSize = data.length - 8 - pos;
            const compressed = new Uint8Array(compressedSize);
            for (let i = 0; i < compressedSize; i++) {
                compressed[i] = data[pos + i];
            }
            
            try {
                const result = zlib.inflateSync(compressed);
                logger.info(`inflateSync success! Decompressed size: ${result.length}`);
                return result;
            } catch (e) {
                logger.warn(`inflateSync failed: ${e.message}`);
            }

            logger.error("All decompression methods failed");
            return null;
            
        } catch (e) {
            logger.error(`GZIP decompression error: ${e.message}`);
            return null;
        }
    }
    
    /**
     * 从字节数组解析NBT
     */
    parseNBTFromBytes(data) {
        try {
            // 如果数据看起来像JSON，尝试解析
            if (data[0] === 123) {
                const str = new TextDecoder().decode(data);
                try {
                    const json = JSON.parse(str);
                    return this.convertJsonToNbtBuffer(json);
                } catch (e) {
                    logger.warn(`JSON parse failed: ${e.message}`);
                }
            }
            
            // NBT格式: type(1) + nameLen(2) + name + payload
            // 检查是否是TAG_Compound
            if (data[0] !== 10) {
                logger.warn(`NBT root is not TAG_Compound, type=${data[0]}`);
                return null;
            }
            
            let offset = 0;
            
            // 读取type
            const rootType = data[offset++];
            
            // 读取名字长度
            const nameLen = (data[offset] << 8) | data[offset + 1];
            offset += 2;
            
            // 跳过名字
            offset += nameLen;
            
            // 解析compound内容
            const { result } = this.parseCompoundContent(data, offset);
            
            logger.info(`Parsed NBT keys: ${Object.keys(result).length}`);
            if (result.Version !== undefined) {
                logger.info(`Version: ${JSON.stringify(result.Version)}`);
            }
            if (result.Metadata) {
                logger.info(`Metadata type: ${typeof result.Metadata}`);
            }
            if (result.Regions) {
                logger.info(`Regions type: ${typeof result.Regions}`);
            }
            
            return result;
        } catch (e) {
            logger.error(`NBT parse error: ${e.message}`);
            return null;
        }
    }
    
    // 解析Compound内容 (不包含type和name)
    // 返回 { result, newOffset } 便于调用方获取解析后的偏移量
    parseCompoundContent(data, startOffset) {
        const result = {};
        let offset = startOffset;
        
        while (offset < data.length) {
            // 读取tag type
            const tagType = data[offset++];
            
            if (tagType === 0) { // TAG_End
                break;
            }
            
            // 读取tag名字
            if (offset + 2 > data.length) break;
            const nameLen = (data[offset] << 8) | data[offset + 1];
            offset += 2;
            
            let tagName = '';
            if (nameLen > 0 && offset + nameLen <= data.length) {
                tagName = new TextDecoder().decode(data.slice(offset, offset + nameLen));
                offset += nameLen;
            }
            
            // 读取tag值
            const { value, newOffset } = this.readTagValue(data, offset, tagType);
            offset = newOffset;
            
            if (tagName) {
                result[tagName] = value;
            }
        }
        
        return { result, newOffset: offset };
    }
    
    // 读取tag值 - 基于TAG_HANDLERS注册表统一处理
    readTagValue(data, offset, type) {
        const handler = this._TAG_HANDLERS[type];
        if (!handler) {
            logger.warn(`Unknown NBT tag type: ${type} at offset ${offset}`);
            return { value: null, newOffset: offset };
        }
        
        if (handler.size !== null) {
            // 固定大小标签
            const value = handler.read(data, offset);
            return { value, newOffset: offset + handler.size };
        } else {
            // 动态大小标签，read返回 { value, size }
            const { value, size } = handler.read(data, offset);
            return { value, newOffset: offset + size };
        }
    }
    
    // 跳过tag值 (用于计算offset) - 基于TAG_HANDLERS注册表统一处理
    skipTagValue(data, offset, type) {
        try {
            const handler = this._TAG_HANDLERS[type];
            if (!handler) {
                return -1;
            }
            
            if (handler.size !== null) {
                return offset + handler.size;
            } else {
                return handler.skip(data, offset);
            }
        } catch (e) {
            return -1;
        }
    }

    /**
     * 从文件名提取原理图名称
     */
    extractNameFromFilename(filePath) {
        if (!filePath) return '';
        
        const fullName = filePath.split('/').pop().split('\\').pop() || '';
        const nameWithoutExt = fullName.replace(/\.(litematic|json|dat|nbt)$/i, '');
        
        return nameWithoutExt || '';
    }

    /**
     * 解析Litematic NBT数据
     */
    parseLitematic(nbtData, filename = '') {
        if (!nbtData) {
            throw new Error("No NBT data to parse");
        }
        
        const version = nbtData.Version || 0;
        const metadata = nbtData.Metadata || {};
        
        let schematicName = metadata.Name || '';
        if (!schematicName || schematicName === 'Unnamed' || schematicName.trim() === '') {
            schematicName = this.extractNameFromFilename(filename);
        }
        
        const schematic = {
            version,
            name: schematicName || 'Unnamed',
            author: metadata.Author || 'Unknown',
            description: metadata.Description || '',
            timeCreated: this._safeNumber(metadata.TimeCreated) || this._safeNumber(metadata.timeCreated) || null,
            timeModified: this._safeNumber(metadata.TimeModified) || this._safeNumber(metadata.timeModified) || null,
            dimensions: { x: 0, y: 0, z: 0 },
            dimension: 0,
            blocks: [],
            blockIndex: new Map(),
            blockChunks: new Map(), // 空间分块索引: "chunkX,chunkY,chunkZ" -> Block[]
            entities: [],
            tileEntities: [],
            totalBlocks: 0,
            filePath: ''
        };
        
        // 解析区域 - Litematic格式: Regions是一个COMPOUND，每个区域是一个子COMPOUND
        const regions = nbtData.Regions || {};
        
        let totalSize = { x: 0, y: 0, z: 0 };
        let regionCount = 0;
        
        for (const regionName in regions) {
            const region = regions[regionName];
            if (typeof region !== 'object') {
                logger.warn(`parseLitematic: region "${regionName}" is not an object, type=${typeof region}`);
                continue;
            }
            
            regionCount++;
            
            logger.info(`parseLitematic: Processing region "${regionName}"`);
            logger.info(`parseLitematic: region keys = ${Object.keys(region).join(', ')}`);
            
            // 读取区域尺寸 - 尝试多种可能的字段名
            let size = region.Size;
            if (!size) {
                size = region.size;
                logger.info(`parseLitematic: Using lowercase "size"`);
            }
            if (!size) {
                size = { x: region.SizeX || region.sizeX || 0, 
                         y: region.SizeY || region.sizeY || 0, 
                         z: region.SizeZ || region.sizeZ || 0 };
                logger.info(`parseLitematic: Constructed size from SizeX/SizeY/SizeZ`);
            }

            // 处理TAG_Int_Array格式（数组）vs 对象格式
            let sizeX, sizeY, sizeZ;
            if (Array.isArray(size)) {
                // TAG_Int_Array: [x, y, z]
                sizeX = Math.abs(size[0] || 0);
                sizeY = Math.abs(size[1] || 0);
                sizeZ = Math.abs(size[2] || 0);
                logger.info(`parseLitematic: Size is array [${size[0]}, ${size[1]}, ${size[2]}]`);
            } else {
                // 对象格式: {x, y, z}
                sizeX = Math.abs(size.x || 0);
                sizeY = Math.abs(size.y || 0);
                sizeZ = Math.abs(size.z || 0);
            }
            
            logger.info(`Region "${regionName}": ${sizeX}x${sizeY}x${sizeZ}`);
            
            // 更新总尺寸
            if (sizeX > totalSize.x) totalSize.x = sizeX;
            if (sizeY > totalSize.y) totalSize.y = sizeY;
            if (sizeZ > totalSize.z) totalSize.z = sizeZ;
            
            // 读取方块调色板 - 尝试多种可能的字段名
            let palette = region.BlockStatePalette || region.Palette || region.palette || [];
            if (region.BlockStatePalette) {
                logger.info(`Palette size: ${palette.length} (from BlockStatePalette)`);
            } else if (region.Palette) {
                logger.info(`Palette size: ${palette.length} (from Palette)`);
            } else {
                logger.warn(`Palette not found! region keys: ${Object.keys(region).join(', ')}`);
            }
            
            // 读取方块状态数据 - 尝试多种可能的字段名
            let blockStates = region.BlockStates || region.blockStates || region.block_states || [];
            if (region.BlockStates) {
                logger.info(`BlockStates length: ${blockStates.length} (from BlockStates)`);
            } else if (region.blockStates) {
                logger.info(`BlockStates length: ${blockStates.length} (from blockStates)`);
            } else {
                logger.warn(`BlockStates not found!`);
            }
            
            logger.info(`decodeBlocks check: palette.length=${palette.length}, blockStates.length=${blockStates.length}`);
            
            // 解码方块数据
            if (palette.length > 0 && blockStates.length > 0) {
                const blocks = this.decodeBlocks(palette, blockStates, sizeX, sizeY, sizeZ);
                schematic.blocks = schematic.blocks.concat(blocks);
            }
        }
        
        schematic.dimensions = totalSize;
        schematic.totalBlocks = schematic.blocks.length;
        
        // 构建方块位置索引，加速轻松放置查找
        const CHUNK_SIZE = 16;
        for (const block of schematic.blocks) {
            const key = `${block.pos[0]},${block.pos[1]},${block.pos[2]}`;
            schematic.blockIndex.set(key, block);
            
            // 构建空间分块索引
            const cx = Math.floor(block.pos[0] / CHUNK_SIZE);
            const cy = Math.floor(block.pos[1] / CHUNK_SIZE);
            const cz = Math.floor(block.pos[2] / CHUNK_SIZE);
            const chunkKey = `${cx},${cy},${cz}`;
            if (!schematic.blockChunks.has(chunkKey)) {
                schematic.blockChunks.set(chunkKey, []);
            }
            schematic.blockChunks.get(chunkKey).push(block);
        }
        
        logger.info(`Parsing schematic: ${schematic.name}, dimensions: ${totalSize.x}x${totalSize.y}x${totalSize.z}`);
        logger.info(`Total blocks: ${schematic.totalBlocks}, chunks: ${schematic.blockChunks.size}`);

        return schematic;
    }
    
    /**
     * 解码方块数据
     * 使用与Minecraft Litematic格式兼容的解码方式
     */
    decodeBlocks(palette, blockStates, sizeX, sizeY, sizeZ) {
        const blocks = [];
        const totalBlocks = sizeX * sizeY * sizeZ;
        
        if (palette.length === 0 || blockStates.length === 0) {
            logger.warn(`decodeBlocks: empty palette (${palette.length}) or blockStates (${blockStates.length})`);
            return blocks;
        }
        
        // 计算每个方块状态需要的位数
        // 对于 n 个 palette 项，需要 ceil(log2(n)) 位，但至少 2 位
        // 例如：259 个项需要 9 位 (2^9 = 512 >= 259)
        let bitsPerBlock = Math.max(2, Math.ceil(Math.log2(palette.length)));
        
        // Minecraft Litematic 格式使用特定的 bitsPerBlock 规则
        // 当 palette 大小 > 256 时，必须使用 9 位或更多
        if (palette.length > 256 && bitsPerBlock < 9) {
            bitsPerBlock = 9;
        }
        if (palette.length > 512 && bitsPerBlock < 10) {
            bitsPerBlock = 10;
        }
        
        const mask = (1n << BigInt(bitsPerBlock)) - 1n;
        
        logger.info(`[DECODE] Palette size: ${palette.length}, bitsPerBlock: ${bitsPerBlock}, mask: 0x${mask.toString(16)}`);
        
        // 调试：显示 palette 内容
        logger.info(`[DECODE] Palette contents (first 20):`);
        for (let i = 0; i < Math.min(20, palette.length); i++) {
            const entry = palette[i];
            logger.info(`[DECODE]   [${i}] ${entry?.Name || 'null'}`);
        }
        
        // 统计 palette 中的空气方块
        let airCount = 0;
        for (const entry of palette) {
            if (entry && entry.Name && entry.Name.includes('air')) {
                airCount++;
            }
        }
        logger.info(`[DECODE] Air blocks in palette: ${airCount}/${palette.length}`);
        
        logger.info(`[DECODE] Starting decode: ${totalBlocks} total blocks, palette size: ${palette.length}, bitsPerBlock: ${bitsPerBlock}`);
        
        let blockIndex = 0;
        let decodedCount = 0;
        let errorCount = 0;
        const maxErrors = 10; // 最多显示10个错误
        
        for (let y = 0; y < sizeY && blockIndex < totalBlocks; y++) {
            for (let z = 0; z < sizeZ && blockIndex < totalBlocks; z++) {
                for (let x = 0; x < sizeX && blockIndex < totalBlocks; x++) {
                    // 计算该方块在bit流中的位置
                    const bitIndex = blockIndex * bitsPerBlock;
                    const longIndex = Math.floor(bitIndex / 64);
                    const bitOffset = bitIndex % 64;
                    
                    if (longIndex >= blockStates.length) {
                        if (errorCount < maxErrors) {
                            logger.warn(`[DECODE] longIndex ${longIndex} >= blockStates.length ${blockStates.length}`);
                            errorCount++;
                        }
                        blockIndex++;
                        continue;
                    }
                    
                    // 从long数组中提取方块索引（处理跨long的情况）
                    let paletteIndex;
                    
                    if (bitOffset + bitsPerBlock <= 64) {
                        // 不跨long，直接读取
                        const longValue = BigInt(blockStates[longIndex]);
                        paletteIndex = Number((longValue >> BigInt(bitOffset)) & mask);
                    } else {
                        // 跨long，需要组合两个long的值
                        const long1 = BigInt(blockStates[longIndex]);
                        const bitsFromLong1 = 64 - bitOffset;
                        const bitsFromLong2 = bitsPerBlock - bitsFromLong1;
                        
                        if (longIndex + 1 < blockStates.length) {
                            const long2 = BigInt(blockStates[longIndex + 1]);
                            const val1 = (long1 >> BigInt(bitOffset)) & ((1n << BigInt(bitsFromLong1)) - 1n);
                            const val2 = long2 & ((1n << BigInt(bitsFromLong2)) - 1n);
                            paletteIndex = Number(val1 | (val2 << BigInt(bitsFromLong1)));
                        } else {
                            // 没有足够的long，使用默认值
                            paletteIndex = 0;
                        }
                    }
                    
                    // 验证palette索引
                    if (paletteIndex >= palette.length) {
                        if (errorCount < maxErrors) {
                            logger.warn(`[DECODE] Invalid paletteIndex ${paletteIndex} at block ${blockIndex}, using 0`);
                            errorCount++;
                        }
                        paletteIndex = 0;
                    }
                    
                    const blockState = palette[paletteIndex];
                if (blockState && blockState.Name) {
                    // 跳过空气方块
                    if (!blockState.Name.includes('air')) {
                        // 获取Java版方块状态
                        const javaStates = blockState.Properties || blockState.properties || {};
                        
                        // 转换为基岩版方块状态（保护异常）
                        let bedrockData = { name: blockState.Name, states: {} };
                        try {
                            bedrockData = bidirectionalConverter.javaToBedrock({ name: blockState.Name, states: javaStates });
                        } catch (e) {
                            // 转换失败，保留原始状态
                        }

                        blocks.push({
                            pos: [x, y, z],
                            name: blockState.Name,
                            state: javaStates,
                            bedrockState: bedrockData.states
                        });
                        decodedCount++;
                    }
                }
                    
                    blockIndex++;
                }
            }
        }
        
        logger.info(`[DECODE] Completed: ${blocks.length} non-air blocks decoded out of ${totalBlocks} positions`);
        
        // 调试：统计解码后的方块类型
        const blockTypeCount = {};
        for (const block of blocks) {
            const name = block.name || 'unknown';
            blockTypeCount[name] = (blockTypeCount[name] || 0) + 1;
        }
        logger.info(`[DECODE] Decoded block types: ${JSON.stringify(blockTypeCount).substring(0, 1000)}`);
        
        return blocks;
    }

    /**
     * 解析单个区域
     */
    parseRegion(region, schematic) {
        if (!region) return;
        
        // 处理调色板
        let palette = region.Palette || [];
        if (!Array.isArray(palette)) {
            palette = [];
        }
        
        const blockStates = region.BlockStates || [];
        
        // 获取区域尺寸
        const sizeX = region.SizeX || schematic.dimensions.x;
        const sizeY = region.SizeY || schematic.dimensions.y;
        const sizeZ = region.SizeZ || schematic.dimensions.z;
        const regionX = region.X || 0;
        const regionY = region.Y || 0;
        const regionZ = region.Z || 0;

        logger.info(`Region: ${sizeX}x${sizeY}x${sizeZ}, palette size: ${palette.length}, blockStates length: ${blockStates.length}`);
        
        if (sizeX * sizeY * sizeZ === 0) return;
        
        // 如果有方块数据，使用调色板解码
        if (palette.length > 0 && blockStates.length > 0) {
            const bitsPerEntry = PaletteDecoder.calculateBitsPerEntry(palette.length);
            const decoder = new PaletteDecoder(bitsPerEntry);
            
            try {
                const indices = decoder.decode(blockStates, sizeX * sizeY * sizeZ);
                
                let index = 0;
                for (let y = 0; y < sizeY; y++) {
                    for (let z = 0; z < sizeZ; z++) {
                        for (let x = 0; x < sizeX; x++) {
                            if (index >= indices.length) break;
                            
                            const paletteIndex = indices[index++];
                            const blockState = palette[paletteIndex];
                            
                            if (blockState) {
                                const block = this.parseBlockState(blockState);
                                if (block.name !== 'minecraft:air') {
                                    schematic.blocks.push({
                                        pos: [regionX + x, regionY + y, regionZ + z],
                                        ...block
                                    });
                                    schematic.totalBlocks++;
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                logger.error(`Error decoding palette: ${e.message}`);
            }
        }
        
        logger.info(`Total blocks so far: ${schematic.totalBlocks}`);
    }

    /**
     * 解析方块状态
     */
    parseBlockState(blockState) {
        let name = 'minecraft:air';
        let properties = {};
        
        if (typeof blockState === 'string') {
            name = blockState;
        } else if (typeof blockState === 'object' && blockState !== null) {
            name = blockState.Name || blockState.name || blockState || 'minecraft:air';
            properties = blockState.Properties || blockState.properties || {};
        }
        
        if (!name || typeof name !== 'string') {
            name = 'minecraft:air';
        }
        
        // 修复双命名空间问题 (minecraft:minecraft:stone)
        if (name.startsWith('minecraft:minecraft:')) {
            name = 'minecraft:' + name.substring('minecraft:minecraft:'.length);
        }
        
        // 转换Java ID到基岩版（使用新双向转换器）
        const converted = bidirectionalConverter.javaToBedrock({ name, states: properties });
        
        return {
            name: converted.name,
            states: converted.states
        };
    }

    clearCache() {
        this.schematics.clear();
    }

    /**
     * 保存调试信息到文件
     */
    saveDebugInfo(schematic, nbtData, rawDecompressed) {
        try {
            // 保存完整的原始NBT二进制数据
            if (rawDecompressed && fs) {
                const rawPath = './plugins/LitematicaBE/debug_raw_nbt.dat';
                const buffer = Buffer.from(rawDecompressed);
                fs.writeFileSync(rawPath, buffer);
                logger.info(`[DEBUG] Raw NBT data saved to ${rawPath} (${rawDecompressed.length} bytes)`);
            }

            const debugData = {
                timestamp: new Date().toISOString(),
                schematic: {
                    name: schematic.name,
                    author: schematic.author,
                    dimensions: schematic.dimensions,
                    totalBlocks: schematic.totalBlocks,
                    blocksSample: schematic.blocks.slice(0, 10),
                    blocksLength: schematic.blocks.length
                },
                nbtKeys: Object.keys(nbtData),
                rawNbtLength: rawDecompressed ? rawDecompressed.length : 0,
                nbtTopLevel: {}
            };

            // 保存NBT顶层数据
            for (const key of Object.keys(nbtData)) {
                const val = nbtData[key];
                if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
                    debugData.nbtTopLevel[key] = val;
                } else if (Array.isArray(val)) {
                    debugData.nbtTopLevel[key] = `[Array: ${val.length} items]`;
                } else if (typeof val === 'object') {
                    debugData.nbtTopLevel[key] = `[Object: ${Object.keys(val).slice(0, 10).join(', ')}]`;
                }
            }

            const debugPath = './plugins/LitematicaBE/debug_schematic_full.json';
            
            if (fs) {
                fs.writeFileSync(debugPath, JSON.stringify(debugData, null, 2));
            } else {
                File.writeTo(debugPath, JSON.stringify(debugData, null, 2));
            }
            
            logger.info(`[DEBUG] Schematic debug info saved to ${debugPath}`);
        } catch (e) {
            logger.warn(`[DEBUG] Failed to save debug info: ${e.message}`);
        }
    }
}

module.exports = { LitematicLoader };
