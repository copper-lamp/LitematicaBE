// McstructureLoader — 加载和解析 .mcstructure（Bedrock 结构方块导出文件）
//
// ⚠️ 与 .litematic 的关键格式差异（务必记住，勿混淆）：
//   - 字节序：little-endian（.litematic 是 big-endian）→ 本文件自带独立小端 NBT 解析器，
//     不复用 LitematicLoader 的大端 _TAG_HANDLERS。
//   - 压缩：通常【无压缩】（.litematic 是 gzip）。为兼容部分工具，仍检测 gzip magic。
//   - 方块数据：已经是 BE 名 + BE 状态（.litematic 是 Java 名 + Java 状态，需 javaToBedrock 转换）。
//     因此 .mcstructure【不需要】走 bidirectionalConverter / BlockStateConverters，
//     直接让 GhostBlockRegistry.resolve() + buildStates() 消费即可（形状保真度反而更高）。
//   - block_indices 顺序：ZYX（index = x·SZ·SY + y·SZ + z，z 最快；实测 i=0→(0,0,0)、i=1→(0,0,1)）。
//     .litematic 是 XYZ。此处按 ZYX 反算坐标。
//   - structure.palette 可能是 Compound{default:{block_palette,...}}（新版）或 List[0]（旧版）；
//     block_indices 可能在 structure 层直接，也可能在 palette 条目里 → 两种都兼容。

let zlib = null;
let fs = null;
try {
    zlib = global.zlib || require('zlib');
} catch (e) { /* 无 zlib 时静默 */ }
try {
    fs = global.fs || require('fs');
} catch (e) { /* 无 fs 时静默 */ }

// 内存 spatial index 分块边长（与 LitematicLoader 的 CHUNK_SIZE=16 保持一致，
// 消费端是 src/easyplace/SpatialIndexUtils.js；与 BinaryChunkStorage 的 .mcmega CHUNK_SIZE=32 无关）
const SPATIAL_CHUNK_SIZE = 16;

const NAMESPACE_PREFIX = 'minecraft:';

// ============================================================================
// 归一化表（渲染兜底）
//
// ⚠️【状态保留原则 —— 重要设计约定，勿改】：
// 下列名字在 Bedrock 版里是【独立方块类型】，本身就是状态载体，不是可合并的旧名：
//   - minecraft:flowing_water    = 流动状态的水
//   - minecraft:flowing_lava     = 流动状态的岩浆
//   - minecraft:wooden_door      = 橡木门（BE 旧 ID，现代对应 minecraft:oak_door）
//   - minecraft:unlit_redstone_torch = 熄灭的红石火把
//   - minecraft:stone_slab / wooden_slab / red_flower / yellow_flower = BE 用单一类型 + 状态区分
//
// 因此本表【只用于渲染兜底】：给 resolve() 一个"能命中 javaMap 的现代名"，避免回落 lit:g_generic
// 泛型立方体；【绝不覆盖 block.name】——block.name 始终保留 .mcstructure 读出的原始 BE 名，
// block.state / block.bedrockState 始终保留全部原始 BE 状态。这样即使当前 ghost 渲染尚不能区分
// 这些状态（投影在呈现方块状态方面仍不完善），投影数据也不丢；未来 addon 增强后，可直接从
// name / state 恢复精确呈现，无需重新加载或改写投影数据。
//
// 归一化优先级（normalizeBeName）：
//   1. 现代 BE 名 == Java 名（minecraft:stone / oak_stairs / piston / observer / unpowered_repeater /
//      oak_door / stone_stairs …）→ javaMap 直接命中，无需 renderName（本表无此键）。
//   2. 本表（flowing_water、wooden_door、stone_slab 等 getJavaNames 返回空或不准的旧 ID）→ 用表值。
//   3. 其余 → 保留原名（渲染回落 generic，但数据仍在）。
// ============================================================================
const BE_OLD_TO_JAVA = {
    'minecraft:flowing_water': 'minecraft:water',
    'minecraft:flowing_lava': 'minecraft:lava',
    'minecraft:wooden_door': 'minecraft:oak_door',
    'minecraft:wooden_slab': 'minecraft:oak_slab',
    // BE stone_slab 语义 ≈ 平滑石半砖；javaMap 里 smooth_stone_slab 未命中，故兜底到 stone（确定命中）
    'minecraft:stone_slab': 'minecraft:stone',
    'minecraft:unlit_redstone_torch': 'minecraft:redstone_torch',
    'minecraft:red_flower': 'minecraft:poppy',
    'minecraft:yellow_flower': 'minecraft:dandelion',
};

/** 去掉命名空间前缀（'minecraft:xxx' -> 'xxx'；无前缀则原样） */
function stripNamespace(name) {
    if (!name || typeof name !== 'string') return '';
    const idx = name.indexOf(':');
    return idx >= 0 ? name.slice(idx + 1) : name;
}

/** 是否为空气类方块（去命名空间、忽略大小写；结构里 air / cave_air / structure_void 等） */
function isAirName(name) {
    const n = stripNamespace(name).toLowerCase();
    if (!n) return true;
    return n === 'air' || n === 'cave_air' || n === 'void_air' || n === 'structure_void'
        || n.endsWith('_air');
}

/**
 * 渲染兜底名：原始 BE 名 → 能命中 javaMap 的现代名。
 * 返回原名字符串时表示"无需归一化"（调用方据此不设置 renderName）。
 */
function normalizeBeName(name) {
    if (!name) return name;
    const mapped = BE_OLD_TO_JAVA[name];
    return mapped || name;
}

/**
 * BE 状态键归一化：把 'minecraft:xxx' 键去掉命名空间。
 * 实测 .mcstructure 里 states 键【混用】`facing_direction` 与 `minecraft:facing_direction`；
 * 而 GhostBlockRegistry.buildStates 的 spec.from 用的是【短键】（如 weirdo_direction / direction），
 * 不去前缀会查不到、形状状态全落默认值。值原样保留（int / bool / string 都由 buildStates 归一）。
 */
function normalizeBeStates(states) {
    if (!states || typeof states !== 'object') return {};
    const out = {};
    for (const [k, v] of Object.entries(states)) {
        const key = k.startsWith(NAMESPACE_PREFIX) ? k.slice(NAMESPACE_PREFIX.length) : k;
        out[key] = v;
    }
    return out;
}

// ============================================================================
// 小端 NBT 解析器（独立实现，专用于 .mcstructure）
// ============================================================================
function parseLittleEndianNbt(buffer) {
    const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let off = 0;

    function readByte() { return dv.getInt8(off++); }
    function readShort() { const v = dv.getInt16(off, true); off += 2; return v; }
    function readInt() { const v = dv.getInt32(off, true); off += 4; return v; }
    function readLong() {
        let v = 0n;
        for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(dv.getUint8(off + i));
        off += 8;
        return v;
    }
    function readFloat() { const v = dv.getFloat32(off, true); off += 4; return v; }
    function readDouble() { const v = dv.getFloat64(off, true); off += 8; return v; }
    function readString() {
        const len = readShort();
        if (len <= 0) return '';
        const s = new TextDecoder('utf-8').decode(new Uint8Array(u8.buffer, u8.byteOffset + off, len));
        off += len;
        return s;
    }
    function readPayload(type) {
        switch (type) {
            case 1: return readByte();
            case 2: return readShort();
            case 3: return readInt();
            case 4: return readLong();
            case 5: return readFloat();
            case 6: return readDouble();
            case 7: { const n = readInt(); const a = []; for (let i = 0; i < n; i++) a.push(readByte()); return a; }
            case 8: return readString();
            case 9: { const t = readByte(); const n = readInt(); const a = []; for (let i = 0; i < n; i++) a.push(readPayload(t)); return a; }
            case 10: return readCompound();
            case 11: { const n = readInt(); const a = []; for (let i = 0; i < n; i++) a.push(readInt()); return a; }
            case 12: { const n = readInt(); const a = []; for (let i = 0; i < n; i++) a.push(readLong()); return a; }
            default: throw new Error(`未知 NBT tag type ${type} @${off}`);
        }
    }
    function readCompound() {
        const obj = {};
        while (off < u8.length) {
            const t = readByte();
            if (t === 0) break; // TAG_End
            const name = readString();
            obj[name] = readPayload(t);
        }
        return obj;
    }

    // root：TAG_Compound(10)，名字通常为空串
    const rootType = readByte();
    if (rootType !== 10) {
        throw new Error(`.mcstructure 根节点不是 Compound（type=${rootType}）`);
    }
    readString(); // root 名字（mcstructure 里为空）
    return readCompound();
}

/** 从解析后的 root 提取结构核心：{ size:[x,y,z], blockPalette, blockIndices:[i0,i1] } */
function extractStructure(root) {
    const size = root.size || [0, 0, 0];
    const sx = Number(size[0]) || 0;
    const sy = Number(size[1]) || 0;
    const sz = Number(size[2]) || 0;

    const structure = root.structure || {};
    let palette = structure.palette;

    // palette 兼容两种形态：新版 Compound{default:{block_palette,...}}，旧版 List[{...}]
    let paletteEntry = null;
    if (Array.isArray(palette)) {
        paletteEntry = palette[0] || null;
    } else if (palette && typeof palette === 'object') {
        const keys = Object.keys(palette);
        paletteEntry = keys.length > 0 ? palette[keys[0]] : null;
    }

    const blockPalette = (paletteEntry && paletteEntry.block_palette) || [];
    // block_indices 可能在 palette 条目里，也可能在 structure 层直接（实测在 structure 层）
    let blockIndices = (paletteEntry && paletteEntry.block_indices) || structure.block_indices;
    if (!Array.isArray(blockIndices)) blockIndices = [];

    const i0 = blockIndices[0] && Array.isArray(blockIndices[0]) ? blockIndices[0] : [];
    const i1 = blockIndices[1] && Array.isArray(blockIndices[1]) ? blockIndices[1] : [];

    return { size: [sx, sy, sz], blockPalette, blockIndices: [i0, i1] };
}

/** ZYX 反算：index = x·SZ·SY + y·SZ + z → [x,y,z] */
function idxToPos(i, sx, sy, sz) {
    const x = Math.floor(i / (sz * sy));
    const y = Math.floor(i / sz) % sy;
    const z = i % sz;
    return [x, y, z];
}

class McstructureLoader {
    constructor(logger) {
        this.schematics = new Map();
        this._logger = logger || null;
    }

    _log(level, msg) {
        const t = this._logger || (typeof logger !== 'undefined' ? logger : null);
        if (!t || !t[level]) return;
        try { t[level](msg); } catch (e) { /* 日志失败不影响主流程 */ }
    }

    /** 读取文件（同步，兼容 BDS 的 global.fs 与测试环境 require('fs')） */
    _readFile(filePath) {
        if (fs && fs.readFileSync) return fs.readFileSync(filePath);
        // LSE File API 兜底
        if (typeof File !== 'undefined' && File.readFrom) {
            const data = File.readFrom(filePath);
            return data ? Buffer.from(data) : null;
        }
        return null;
    }

    /** 读文件 + 解压（检测 gzip）+ 小端 NBT 解析 → root object */
    _parse(filePath) {
        const fileData = this._readFile(filePath);
        if (!fileData || fileData.length === 0) {
            throw new Error(`无法读取文件: ${filePath}`);
        }

        let data = fileData;
        if (data[0] === 0x1f && data[1] === 0x8b) {
            // 部分工具会 gzip 压缩 .mcstructure，兼容处理
            if (zlib && zlib.gunzipSync) {
                data = zlib.gunzipSync(data);
            } else {
                throw new Error('zlib 不可用，无法解压 gzip 的 .mcstructure');
            }
        }

        return parseLittleEndianNbt(data);
    }

    /** 共享解析核心：返回 { size:[x,y,z], blockPalette, blockIndices, root } */
    _parseCore(filePath) {
        const root = this._parse(filePath);
        const { size, blockPalette, blockIndices } = extractStructure(root);
        return { root, size, blockPalette, blockIndices };
    }

    /**
     * 加载 .mcstructure（完整加载，与 LitematicLoader.load 契约一致）
     * @param {string} filePath
     * @returns {Promise<object>} schematic { name, author, description, dimensions, blocks,
     *          blockIndex, blockChunks, totalBlocks, version, dimension, entities, tileEntities, filePath }
     */
    async load(filePath) {
        if (this.schematics.has(filePath)) {
            return this.schematics.get(filePath);
        }

        const { size, blockPalette, blockIndices } = this._parseCore(filePath);
        const [sx, sy, sz] = size;
        const blocks = this._decodeBlocks(blockPalette, blockIndices, sx, sy, sz, true);

        const path = require('path');
        const baseName = path.basename(filePath, path.extname(filePath)) || 'Unnamed';

        const schematic = {
            version: 1,
            name: baseName,
            author: 'Unknown',
            description: '',
            timeCreated: null,
            timeModified: null,
            dimensions: { x: sx, y: sy, z: sz },
            dimension: 0,
            blocks,
            blockIndex: new Map(),
            blockChunks: new Map(),
            entities: [],
            tileEntities: [],
            totalBlocks: blocks.length,
            filePath
        };

        // 构建方块位置索引 + 空间分块索引（与 LitematicLoader 相同，CHUNK_SIZE=16）
        for (const block of blocks) {
            const key = `${block.pos[0]},${block.pos[1]},${block.pos[2]}`;
            schematic.blockIndex.set(key, block);
            const cx = Math.floor(block.pos[0] / SPATIAL_CHUNK_SIZE);
            const cy = Math.floor(block.pos[1] / SPATIAL_CHUNK_SIZE);
            const cz = Math.floor(block.pos[2] / SPATIAL_CHUNK_SIZE);
            const chunkKey = `${cx},${cy},${cz}`;
            if (!schematic.blockChunks.has(chunkKey)) {
                schematic.blockChunks.set(chunkKey, []);
            }
            schematic.blockChunks.get(chunkKey).push(block);
        }

        this._log('info', `[Mcstructure] 加载完成: ${schematic.name}, ${schematic.totalBlocks} 方块, 尺寸 ${sx}x${sy}x${sz}`);

        this.schematics.set(filePath, schematic);
        return schematic;
    }

    /**
     * 流式加载（供 Mega 分块存储；与 StreamingLitematicLoader.prepareStream 契约一致）
     * @returns {{generator: AsyncGenerator<Array>, meta: object, totalEstimate: number}}
     */
    async prepareStream(filePath) {
        const { size, blockPalette, blockIndices } = this._parseCore(filePath);
        const [sx, sy, sz] = size;

        const path = require('path');
        const baseName = path.basename(filePath, path.extname(filePath)) || 'Unnamed';

        const meta = {
            name: baseName,
            author: 'Unknown',
            description: '',
            version: 1,
            timeCreated: null,
            timeModified: null,
            dimensions: { x: sx, y: sy, z: sz }
        };
        const totalEstimate = sx * sy * sz;

        const generator = (async function* () {
            // 逐层逐行逐列 yield 非空气方块（Mega 的 BinaryChunkStorage 只存 name + state）
            // 注意：Mega 磁盘格式冻结（只存 name+state），故此处 name 用【渲染兜底名】，
            // 读回即能 resolve()；原始 BE 名/状态保留在 state 之外无法落盘（格式限制），
            // 普通模式（load()）才完整保留 name + renderName + bedrockState。
            const { _decodeBlocks } = this;
            const batchSize = 512;
            let batch = [];
            for (let y = 0; y < sy; y++) {
                for (let z = 0; z < sz; z++) {
                    for (let x = 0; x < sx; x++) {
                        const block = this._blockAt(blockPalette, blockIndices, x, y, z, sx, sy, sz, false);
                        if (!block) continue;
                        batch.push(block);
                        if (batch.length >= batchSize) {
                            yield batch;
                            batch = [];
                        }
                    }
                }
            }
            if (batch.length > 0) yield batch;
        }).call(this);

        return { generator, meta, totalEstimate };
    }

    /**
     * 解码方块（普通模式：保留原始名 + renderName 兜底 + 完整状态）
     * @param {boolean} keepOriginalName true=保留原始 BE 名（load() 用）；false=仅渲染兜底名（prepareStream 用）
     */
    _decodeBlocks(blockPalette, blockIndices, sx, sy, sz, keepOriginalName) {
        const blocks = [];
        const [i0, i1] = blockIndices;
        const total = sx * sy * sz;

        for (let i = 0; i < total; i++) {
            let idx = i0[i];
            let layer = 0;
            // 主层为空（-1 或 air）时用第二层（液体/水）
            if (idx === undefined || idx === null || idx < 0 || (blockPalette[idx] && isAirName(blockPalette[idx].name))) {
                idx = i1[i];
                layer = 1;
                if (idx === undefined || idx === null || idx < 0 || (blockPalette[idx] && isAirName(blockPalette[idx].name))) {
                    continue;
                }
            }

            const entry = blockPalette[idx];
            if (!entry || !entry.name) continue;

            const rawName = entry.name;
            const beStates = normalizeBeStates(entry.states || {});
            const renderName = normalizeBeName(rawName);

            // ZYX 坐标反算（index = x·SZ·SY + y·SZ + z）
            const [x, y, z] = idxToPos(i, sx, sy, sz);

            if (keepOriginalName) {
                // 普通模式：数据忠实保留（原始名 + 原始状态），renderName 仅渲染兜底
                const block = {
                    pos: [x, y, z],
                    name: rawName,
                    state: beStates,
                    bedrockState: beStates
                };
                if (renderName !== rawName) {
                    block.renderName = renderName;
                }
                blocks.push(block);
            } else {
                // Mega 流式：二进制只存 name+state，用渲染兜底名保证读回能 resolve
                blocks.push({
                    pos: [x, y, z],
                    name: renderName,
                    state: beStates
                });
            }
        }

        return blocks;
    }

    /** 单格解码（prepareStream 用，避免先铺全量数组再生成） */
    _blockAt(blockPalette, blockIndices, x, y, z, sx, sy, sz, keepOriginalName) {
        const i = x * (sz * sy) + y * sz + z;
        const [i0, i1] = blockIndices;
        let idx = i0[i];
        if (idx === undefined || idx === null || idx < 0 || (blockPalette[idx] && isAirName(blockPalette[idx].name))) {
            idx = i1[i];
            if (idx === undefined || idx === null || idx < 0 || (blockPalette[idx] && isAirName(blockPalette[idx].name))) {
                return null;
            }
        }
        const entry = blockPalette[idx];
        if (!entry || !entry.name) return null;

        const rawName = entry.name;
        const beStates = normalizeBeStates(entry.states || {});
        const renderName = normalizeBeName(rawName);

        if (keepOriginalName) {
            const block = { pos: [x, y, z], name: rawName, state: beStates, bedrockState: beStates };
            if (renderName !== rawName) block.renderName = renderName;
            return block;
        }
        return { pos: [x, y, z], name: renderName, state: beStates };
    }
}

module.exports = {
    McstructureLoader,
    normalizeBeName,
    normalizeBeStates,
    isAirName,
    BE_OLD_TO_JAVA,
    stripNamespace
};
