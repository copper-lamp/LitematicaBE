// McstructureWriter - 把"基岩版方块列表"写成 .mcstructure（结构方块文件）

const {
    LittleEndianNBTWriter,
    TAG_BYTE,
    TAG_INT,
    TAG_FLOAT,
    TAG_STRING,
    TAG_LIST,
    TAG_COMPOUND
} = require('./LittleEndianNBTWriter');

const AIR_NAME = 'minecraft:air';

/** 空方块实体/实体列表统一用 List<Compound> */
const LIST_OF_COMPOUND = 10;

/** 从字符串/数字/枚举里取出 NBT tag 类型号（1..12）；取不到返回 0 */
function coerceTagType(t) {
    if (typeof t === 'number' && t >= 1 && t <= 12) return t;
    if (t && typeof t === 'object') {
        // LSE 的 Enum：常见字段名 value / id / type
        for (const k of ['value', 'id', 'type', 'tagType']) {
            const v = t[k];
            if (typeof v === 'number' && v >= 1 && v <= 12) return v;
        }
    }
    return 0;
}

/** 裸值 → 推断的 NBT 类型（仅兜底，正常路径应带类型） */
function inferStateType(key, value) {
    if (typeof value === 'boolean') return TAG_BYTE;
    if (typeof value === 'string') return TAG_STRING;
    if (typeof value === 'number') {
        if (!Number.isInteger(value)) return TAG_FLOAT;
        if (/_bit$/.test(key) || value === 0 || value === 1) return TAG_BYTE;
        return TAG_INT;
    }
    if (typeof value === 'bigint') return TAG_INT;
    return TAG_INT;
}

/**
 * 状态归一化：{ k: {v,type} } 或 { k: value } → 稳定排序后的数组
 * @returns {Array<{key:string, value:any, type:number}>}
 */
function normalizeStates(states) {
    if (!states || typeof states !== 'object') return [];
    const out = [];
    for (const key of Object.keys(states)) {
        const raw = states[key];
        if (raw === undefined || raw === null) continue;
        const isBoxed = typeof raw === 'object' && !Array.isArray(raw)
            && (Object.prototype.hasOwnProperty.call(raw, 'v') || Object.prototype.hasOwnProperty.call(raw, 'type'));

        if (isBoxed) {
            const type = coerceTagType(raw.type || raw.t) || inferStateType(key, raw.v);
            out.push({ key, value: raw.v, type });
        } else {
            out.push({ key, value: raw, type: inferStateType(key, raw) });
        }
    }
    out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return out;
}

/** 调色板去重键：名字 + 排序后的状态（带类型，避免 Byte 1 与 Int 1 合并） */
function paletteKeyOf(name, states) {
    let s = name;
    for (const st of states) {
        s += `|${st.key}=${st.type}:${String(st.value)}`;
    }
    return s;
}

/** 主层线性索引：ZYX，z 最快 */
function linearIndex(x, y, z, sy, sz) {
    return x * (sy * sz) + y * sz + z;
}

/**
 * 估算 .mcstructure 裸文件字节数（未压缩，UI 提示用）
 * 主体是两层 int32 全网格；调色板与方块实体部分按实测占比粗略加一点。
 */
function estimateBytes(volume, opts = {}) {
    const layers = opts.writeLiquidLayer === false ? 1 : 2;
    const grid = volume * 4 * layers;
    const palette = 512 + (opts.paletteSize || 0) * 48;
    const entities = opts.entityCount || 0;
    return Math.max(1024, grid + palette + entities);
}

class McstructureWriter {
    /**
     * @param {object} params
     * @param {{x:number,y:number,z:number}} params.size
     * @param {Array<{pos:[number,number,number], name:string, states?:object, blockEntity?:object}>} params.blocks
     *        pos 为**结构内相对坐标**（0 起），name 为基岩版方块名（minecraft:xxx）
     * @param {{x:number,y:number,z:number}} [params.worldOrigin]
     * @param {number} [params.blockVersion] 写入 block_palette[*].version（样本实测 18168865）
     * @param {number} [params.formatVersion] 写入 root.format_version（样本为 1）
     * @param {boolean} [params.writeLiquidLayer] 是否写第二层（整层 -1 占位），默认 true
     * @returns {{buffer:Uint8Array, stats:object}}
     */
    static build(params) {
        const {
            size,
            blocks,
            worldOrigin = { x: 0, y: 0, z: 0 },
            blockVersion = 18168865,
            formatVersion = 1,
            writeLiquidLayer = true
        } = params || {};

        const sx = Number(size && size.x) || 0;
        const sy = Number(size && size.y) || 0;
        const sz = Number(size && size.z) || 0;
        if (sx <= 0 || sy <= 0 || sz <= 0) {
            throw new Error('.mcstructure 尺寸非法：' + JSON.stringify(size));
        }
        const volume = sx * sy * sz;
        const list = Array.isArray(blocks) ? blocks : [];

        // ── 1. 调色板（air 恒为 0 号）─────────────────────────────
        const paletteEntries = [{ name: AIR_NAME, states: [] }];
        const paletteIndex = new Map([[paletteKeyOf(AIR_NAME, []), 0]]);

        // ── 2. 主层索引 ───────────────────────────────────────────
        const layer0 = new Int32Array(volume);        // 默认全 0 = air
        const blockPositionData = Object.create(null);
        let blockCount = 0;
        let entityBlocks = 0;

        for (const block of list) {
            if (!block || !Array.isArray(block.pos)) continue;
            const [x, y, z] = block.pos;
            if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) continue;
            if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) continue;

            const name = String(block.name || AIR_NAME);
            const states = normalizeStates(block.states);
            if (name === AIR_NAME && states.length === 0) continue;   // 空气不占条目

            let idx = paletteIndex.get(paletteKeyOf(name, states));
            if (idx === undefined) {
                idx = paletteEntries.length;
                paletteEntries.push({ name, states });
                paletteIndex.set(paletteKeyOf(name, states), idx);
            }

            const at = linearIndex(x, y, z, sy, sz);
            layer0[at] = idx;
            blockCount++;

            if (block.blockEntity && typeof block.blockEntity === 'object'
                && Object.prototype.hasOwnProperty.call(block.blockEntity, 'type')) {
                blockPositionData[String(at)] = { block_entity_data: block.blockEntity };
                entityBlocks++;
            }
        }

        // ── 3. 第二层（无内容时整层 -1）───────────────────────────
        const layer1 = new Int32Array(volume);
        layer1.fill(-1);

        // ── 4. 组装 NBT 树 ────────────────────────────────────────
        const paletteList = paletteEntries.map((entry) => ({
            type: TAG_COMPOUND,
            value: {
                name: { type: TAG_STRING, value: entry.name },
                states: { type: TAG_COMPOUND, value: buildStatesCompound(entry.states) },
                version: { type: TAG_INT, value: Number(blockVersion) | 0 }
            }
        }));

        const blockIndices = [
            { listType: TAG_INT, value: layer0 }
        ];
        if (writeLiquidLayer) {
            blockIndices.push({ listType: TAG_INT, value: layer1 });
        }

        const root = {
            type: TAG_COMPOUND,
            name: '',
            value: {
                format_version: { type: TAG_INT, value: Number(formatVersion) | 0 },
                size: {
                    type: TAG_LIST,
                    listType: TAG_INT,
                    value: [sx, sy, sz]
                },
                structure: {
                    type: TAG_COMPOUND,
                    value: {
                        block_indices: {
                            type: TAG_LIST,
                            listType: TAG_LIST,
                            value: blockIndices
                        },
                        entities: {
                            type: TAG_LIST,
                            listType: LIST_OF_COMPOUND,
                            value: []
                        },
                        palette: {
                            type: TAG_COMPOUND,
                            value: {
                                default: {
                                    type: TAG_COMPOUND,
                                    value: {
                                        block_palette: {
                                            type: TAG_LIST,
                                            listType: TAG_COMPOUND,
                                            value: paletteList
                                        },
                                        block_position_data: {
                                            type: TAG_COMPOUND,
                                            value: blockPositionData
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                structure_world_origin: {
                    type: TAG_LIST,
                    listType: TAG_INT,
                    value: [Number(worldOrigin.x) | 0, Number(worldOrigin.y) | 0, Number(worldOrigin.z) | 0]
                }
            }
        };

        const writer = new LittleEndianNBTWriter();
        const buffer = writer.write(root);

        return {
            buffer,
            stats: {
                size: { x: sx, y: sy, z: sz },
                volume,
                blockCount,
                paletteSize: paletteEntries.length,
                entityBlocks,
                layers: writeLiquidLayer ? 2 : 1,
                bytes: buffer.length
            }
        };
    }

    static normalizeStates(states) { return normalizeStates(states); }
    static paletteKeyOf(name, states) { return paletteKeyOf(name, states || []); }
    static linearIndex(x, y, z, sy, sz) { return linearIndex(x, y, z, sy, sz); }
    static estimateBytes(volume, opts) { return estimateBytes(volume, opts); }
}

/** states 数组 → NBT Compound 的值对象（键名与值类型都保真） */
function buildStatesCompound(states) {
    const out = Object.create(null);
    for (const st of states) {
        out[st.key] = { type: st.type, value: st.value };
    }
    return out;
}

module.exports = {
    McstructureWriter,
    AIR_NAME,
    normalizeStates,
    paletteKeyOf,
    linearIndex,
    estimateBytes,
    inferStateType,
    coerceTagType
};
