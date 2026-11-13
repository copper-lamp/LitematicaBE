/**
 * test_mcstructure_writer.js — .mcstructure（基岩版结构文件）写出器离线验收
 *
 * 覆盖：
 *   1. LittleEndianNBTWriter 的字节序（.mcstructure 是小端，.litematic 是大端，别混）
 *   2. McstructureWriter.build 的格式骨架（对照 MCBEserver1.21.132 实测样本）
 *      · root.format_version / size / structure_world_origin
 *      · structure.block_indices 两层、layer1 整层 -1、长度 = 体积
 *      · palette 的 air 恒为 0 号；states 的 Byte/Int/String 类型保真
 *      · ZYX 索引公式 index = x·(SY·SZ) + y·SZ + z
 *      · block_position_data 的键 = 主层线性索引
 *   3. SchematicSaver 的三条出口（litematic / mcstructure / both）+ 超限在「读方块之前」截停
 *   4. 写→读往返（用项目自己的 McstructureLoader 解回来比对）
 *   5. 回归：楼梯名里含 "air" 不能被当成空气丢掉
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');
const {
    McstructureWriter,
    estimateBytes,
    normalizeStates,
    linearIndex
} = require(path.join(PLUGIN, 'src', 'core', 'McstructureWriter.js'));
const {
    LittleEndianNBTWriter,
    TAG_BYTE,
    TAG_SHORT,
    TAG_INT,
    TAG_LONG,
    TAG_STRING,
    TAG_LIST,
    TAG_COMPOUND
} = require(path.join(PLUGIN, 'src', 'core', 'LittleEndianNBTWriter.js'));
const {
    parseLittleEndianNbt,
    extractStructure,
    isAirName,
    McstructureLoader
} = require(path.join(PLUGIN, 'src', 'core', 'McstructureLoader.js'));
const { readBlockStates, nbtTagToTree } = require(path.join(PLUGIN, 'src', 'core', 'LSENbtTree.js'));

let pass = 0;
let fail = 0;
function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

// ── 带类型的测试用小端 NBT 解析器（能断言 Byte/Int/String 的区别）──────────
function parseTypedLE(input) {
    const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let off = 0;
    const rb = () => dv.getInt8(off++);
    const rs = () => { const v = dv.getInt16(off, true); off += 2; return v; };
    const ri = () => { const v = dv.getInt32(off, true); off += 4; return v; };
    const rl = () => { let v = 0n; for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(dv.getUint8(off + i)); off += 8; return v; };
    const rf = () => { const v = dv.getFloat32(off, true); off += 4; return v; };
    const rd = () => { const v = dv.getFloat64(off, true); off += 8; return v; };
    const rstr = () => {
        const n = rs();
        if (n <= 0) return '';
        const s = new TextDecoder().decode(new Uint8Array(u8.buffer, u8.byteOffset + off, n));
        off += n;
        return s;
    };
    function payload(t) {
        switch (t) {
            case 1: return { type: t, value: rb() };
            case 2: return { type: t, value: rs() };
            case 3: return { type: t, value: ri() };
            case 4: return { type: t, value: rl() };
            case 5: return { type: t, value: rf() };
            case 6: return { type: t, value: rd() };
            case 7: { const n = ri(); const a = []; for (let i = 0; i < n; i++) a.push(rb()); return { type: t, value: a }; }
            case 8: return { type: t, value: rstr() };
            case 9: {
                const et = rb();
                const n = ri();
                const a = [];
                for (let i = 0; i < n; i++) a.push(payload(et));
                return { type: t, listType: et, value: a };
            }
            case 10: return { type: t, value: compound() };
            case 11: { const n = ri(); const a = []; for (let i = 0; i < n; i++) a.push(ri()); return { type: t, value: a }; }
            case 12: { const n = ri(); const a = []; for (let i = 0; i < n; i++) a.push(rl()); return { type: t, value: a }; }
            default: throw new Error(`坏 tag ${t} @${off}`);
        }
    }
    function compound() {
        const o = {};
        while (off < u8.length) {
            const t = rb();
            if (t === 0) break;
            const name = rstr();
            o[name] = payload(t);
        }
        return o;
    }
    const rootType = rb();
    const rootName = rstr();
    assert.strictEqual(rootType, TAG_COMPOUND, 'root 必须是 Compound');
    return { rootType, rootName, body: compound(), bytes: u8.length, consumed: off };
}

/** 模拟 LSE 的 NbtCompound（只需 getKeys/getTypeOf/getTag） */
function mockCompound(entries) {
    const keys = Object.keys(entries);
    return {
        getKeys: () => keys.slice(),
        getTypeOf: (k) => (entries[k] ? entries[k].type : 0),
        getTag: (k) => {
            const e = entries[k];
            if (!e) return null;
            if (e.type === 10) return mockCompound(e.value);
            if (e.type === 9) return mockList(e.listType || 10, e.value || []);
            return { get: () => e.value, getType: () => e.type };
        }
    };
}
function mockList(elemType, items) {
    return {
        getSize: () => items.length,
        getType: () => elemType,
        getTag: (i) => {
            const it = items[i];
            if (elemType === 10) return mockCompound(it);
            return { get: () => it, getType: () => elemType };
        }
    };
}

console.log('\n=== .mcstructure 写出器 ===');

// ────────────────────────────────────────────────────────────────────
check('LittleEndianNBTWriter 写出小端字节序（int / short / long / string）', () => {
    const w = new LittleEndianNBTWriter();
    const bytes = w.write({
        type: TAG_COMPOUND,
        name: '',
        value: {
            i: { type: TAG_INT, value: 0x01020304 },
            s: { type: TAG_SHORT, value: 0x0102 },
            l: { type: TAG_LONG, value: 0x0102030405060708n },
            t: { type: TAG_STRING, value: 'AB' }
        }
    });
    const buf = Buffer.from(bytes);
    assert.strictEqual(buf[0], 0x0A, 'root 类型字节');
    // 名字长度前缀也是小端 short：'i' = 01 00 69
    assert.ok(buf.includes(Buffer.from([3, 1, 0, 0x69, 4, 3, 2, 1])), 'Int 应为小端 04 03 02 01');
    assert.ok(buf.includes(Buffer.from([2, 1, 0, 0x73, 2, 1])), 'Short 应为小端 02 01');
    assert.ok(buf.includes(Buffer.from([4, 1, 0, 0x6C, 8, 7, 6, 5, 4, 3, 2, 1])), 'Long 应为小端');
    assert.ok(buf.includes(Buffer.from([8, 1, 0, 0x74, 2, 0, 0x41, 0x42])), 'String 长度前缀小端');
});

check('ZYX 索引公式 = x·(SY·SZ) + y·SZ + z', () => {
    assert.strictEqual(linearIndex(0, 0, 0, 2, 2), 0);
    assert.strictEqual(linearIndex(0, 0, 1, 2, 2), 1);
    assert.strictEqual(linearIndex(0, 1, 0, 2, 2), 2);
    assert.strictEqual(linearIndex(1, 0, 0, 2, 2), 4);
    // 3×2×2
    assert.strictEqual(linearIndex(1, 0, 1, 2, 2), 5);
    assert.strictEqual(linearIndex(2, 1, 0, 2, 2), 10);
    // 与 loader 的 idxToPos 互为逆运算
    for (let x = 0; x < 3; x++) {
        for (let y = 0; y < 2; y++) {
            for (let z = 0; z < 2; z++) {
                const i = linearIndex(x, y, z, 2, 2);
                const rx = Math.floor(i / (2 * 2));
                const ry = Math.floor(i / 2) % 2;
                const rz = i % 2;
                assert.deepStrictEqual([rx, ry, rz], [x, y, z]);
            }
        }
    }
});

check('normalizeStates：裸值推断 + 显式类型 + 稳定排序', () => {
    const a = normalizeStates({ powered_bit: 0, facing_direction: 3, 'minecraft:cardinal_direction': 'south' });
    assert.strictEqual(a.find((s) => s.key === 'powered_bit').type, TAG_BYTE, '*_bit 应推断成 Byte');
    assert.strictEqual(a.find((s) => s.key === 'facing_direction').type, TAG_INT, 'facing_direction 应推断成 Int');
    assert.strictEqual(a.find((s) => s.key === 'minecraft:cardinal_direction').type, TAG_STRING);

    const b = normalizeStates({ z: { v: 'x', type: TAG_STRING }, a: { v: 1, type: TAG_INT } });
    assert.deepStrictEqual(b.map((s) => s.key), ['a', 'z'], '键应排序稳定（调色板去重依赖它）');
    assert.strictEqual(b[0].type, TAG_INT, '显式类型不能被推断覆盖');
});

// ────────────────────────────────────────────────────────────────────
/** 3×2×2 标准样本 */
function sampleBuild(extra = {}) {
    return McstructureWriter.build({
        size: { x: 3, y: 2, z: 2 },
        worldOrigin: { x: 100, y: 64, z: -7 },
        blocks: [
            { pos: [0, 0, 0], name: 'minecraft:white_concrete', states: {} },
            {
                pos: [1, 0, 1], name: 'minecraft:observer',
                states: { 'minecraft:facing_direction': { v: 'west', type: TAG_STRING }, powered_bit: { v: 0, type: TAG_BYTE } }
            },
            {
                pos: [2, 1, 0], name: 'minecraft:piston',
                states: { facing_direction: { v: 3, type: TAG_INT } },
                blockEntity: {
                    type: TAG_COMPOUND,
                    value: { id: { type: TAG_STRING, value: 'PistonArm' }, Sticky: { type: TAG_BYTE, value: 1 } }
                }
            },
            // 以下都应被忽略
            { pos: [3, 0, 0], name: 'minecraft:stone', states: {} },
            { pos: [0, 0, 0], name: 'minecraft:air', states: {} }
        ],
        ...extra
    });
}

let built = null;

check('build：格式骨架与样本一致（format_version / size / world_origin / 两层 indices）', () => {
    built = sampleBuild();
    const p = parseTypedLE(built.buffer);
    assert.strictEqual(p.rootName, '', 'root 名为空串');
    assert.deepStrictEqual(
        { type: p.body.format_version.type, value: p.body.format_version.value },
        { type: TAG_INT, value: 1 }
    );
    assert.deepStrictEqual(p.body.size.value.map((n) => n.value), [3, 2, 2]);
    assert.deepStrictEqual(p.body.structure_world_origin.value.map((n) => n.value), [100, 64, -7]);

    const st = p.body.structure.value;
    assert.deepStrictEqual(st.entities.value, [], 'entities 留空');
    const idx = st.block_indices.value;
    assert.strictEqual(idx.length, 2, 'block_indices 应为两层');
    assert.strictEqual(idx[0].value.length, 12, '主层长度 = 体积');
    assert.strictEqual(idx[1].value.length, 12, '次层长度 = 体积');
    assert.ok(idx[1].value.every((n) => n.value === -1), '次层整层应为 -1');
});

check('build：air 恒为调色板 0 号，方块按 ZYX 落位', () => {
    const p = parseTypedLE(built.buffer);
    const st = p.body.structure.value;
    const palette = st.palette.value.default.value.block_palette.value;
    assert.strictEqual(palette[0].value.name.value, 'minecraft:air', '0 号必须是 air');
    assert.deepStrictEqual(st.block_indices.value[0].value.map((n) => n.value),
        [1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 3, 0]);
    assert.strictEqual(built.stats.blockCount, 3);
    assert.strictEqual(built.stats.paletteSize, 4, 'air + 3 种方块');
});

check('build：states 值类型保真（String / Byte / Int 不串味）', () => {
    const p = parseTypedLE(built.buffer);
    const palette = p.body.structure.value.palette.value.default.value.block_palette.value;
    const observer = palette.find((e) => e.value.name.value === 'minecraft:observer').value.states.value;
    assert.deepStrictEqual(observer['minecraft:facing_direction'],
        { type: TAG_STRING, value: 'west' }, 'observer 的 minecraft:facing_direction 必须是 String');
    assert.deepStrictEqual(observer.powered_bit,
        { type: TAG_BYTE, value: 0 }, 'powered_bit 必须是 Byte');

    const piston = palette.find((e) => e.value.name.value === 'minecraft:piston').value.states.value;
    assert.deepStrictEqual(piston.facing_direction,
        { type: TAG_INT, value: 3 }, 'piston 的 facing_direction 必须是 Int');

    // 每个调色板条目都带 version（样本实测 18168865）
    for (const e of palette) {
        assert.strictEqual(e.value.version.value, 18168865, 'block_palette[*].version 缺失或值不对');
    }
});

check('build：block_position_data 的键 = 主层线性索引，内容原样保留', () => {
    const p = parseTypedLE(built.buffer);
    const bpd = p.body.structure.value.palette.value.default.value.block_position_data.value;
    assert.deepStrictEqual(Object.keys(bpd), ['10'], '(2,1,0) 的线性索引应为 10');
    const be = bpd['10'].value.block_entity_data.value;
    assert.strictEqual(be.id.value, 'PistonArm');
    assert.deepStrictEqual(be.Sticky, { type: TAG_BYTE, value: 1 });
    assert.strictEqual(built.stats.entityBlocks, 1);
});

check('build：writeLiquidLayer=false 时只写一层', () => {
    const r = sampleBuild({ writeLiquidLayer: false });
    const p = parseTypedLE(r.buffer);
    assert.strictEqual(p.body.structure.value.block_indices.value.length, 1);
    assert.strictEqual(r.stats.layers, 1);
});

check('build：尺寸非法直接抛错', () => {
    assert.throws(() => McstructureWriter.build({ size: { x: 0, y: 1, z: 1 }, blocks: [] }), /尺寸非法/);
    assert.throws(() => McstructureWriter.build({ size: { x: 1, y: -2, z: 1 }, blocks: [] }), /尺寸非法/);
});

check('estimateBytes：≈ 体积 × 8 字节（两层 int32）', () => {
    const small = estimateBytes(1000);
    assert.ok(small >= 8000 && small < 9000, `1000 格应约 8 KB，实际 ${small}`);
    const big = estimateBytes(1000000);
    assert.ok(big >= 8000000 && big < 9000000, `100 万格应约 8 MB，实际 ${big}`);
    assert.ok(estimateBytes(1000, { writeLiquidLayer: false }) < small, '单层应更小');
});

// ────────────────────────────────────────────────────────────────────
check('写→读往返：McstructureLoader 能解回同样的方块与状态', () => {
    const root = parseLittleEndianNbt(Buffer.from(built.buffer));
    const { size, blockPalette, blockIndices } = extractStructure(root);
    assert.deepStrictEqual(size, [3, 2, 2]);
    assert.strictEqual(blockPalette.length, 4);

    // 复刻 McstructureLoader._decodeBlocks 的核心规则（主层 air 才看次层）
    const [i0] = blockIndices;
    const decoded = [];
    for (let i = 0; i < i0.length; i++) {
        const idx = i0[i];
        const entry = blockPalette[idx];
        if (!entry || isAirName(entry.name)) continue;
        const x = Math.floor(i / (2 * 2));
        const y = Math.floor(i / 2) % 2;
        const z = i % 2;
        decoded.push({ pos: [x, y, z], name: entry.name, states: entry.states });
    }
    assert.deepStrictEqual(decoded.map((b) => b.pos), [[0, 0, 0], [1, 0, 1], [2, 1, 0]]);
    assert.strictEqual(decoded[1].name, 'minecraft:observer');
    assert.strictEqual(decoded[1].states['minecraft:facing_direction'], 'west');
    assert.strictEqual(decoded[2].name, 'minecraft:piston');
    assert.strictEqual(decoded[2].states.facing_direction, 3);

    // loader 自身也把它当合法文件（结构层解析不抛错）
    const loader = new McstructureLoader({ info() {}, warn() {}, error() {} });
    assert.ok(loader, 'loader 应能实例化');
});

check('LSENbtTree：states 的 Byte/Int/String 类型从 LSE 标签里读出来', () => {
    const statesNbt = mockCompound({
        powered_bit: { type: TAG_BYTE, value: 1 },
        facing_direction: { type: TAG_INT, value: 3 },
        'minecraft:cardinal_direction': { type: TAG_STRING, value: 'south' }
    });
    const s = readBlockStates(statesNbt);
    assert.deepStrictEqual(s.powered_bit, { v: 1, type: TAG_BYTE });
    assert.deepStrictEqual(s.facing_direction, { v: 3, type: TAG_INT });
    assert.deepStrictEqual(s['minecraft:cardinal_direction'], { v: 'south', type: TAG_STRING });
});

check('LSENbtTree：方块实体 NBT 递归转树（含 List）', () => {
    const nbt = mockCompound({
        id: { type: TAG_STRING, value: 'Chest' },
        x: { type: TAG_INT, value: 120 },
        Items: {
            type: TAG_LIST, listType: TAG_COMPOUND,
            value: [{ Slot: { type: TAG_BYTE, value: 0 }, Name: { type: TAG_STRING, value: 'minecraft:stone' } }]
        }
    });
    const tree = nbtTagToTree(nbt);
    assert.strictEqual(tree.type, TAG_COMPOUND);
    assert.deepStrictEqual(tree.value.id, { type: TAG_STRING, value: 'Chest' });
    const items = tree.value.Items;
    assert.strictEqual(items.listType, TAG_COMPOUND);
    assert.strictEqual(items.value.length, 1);
    assert.strictEqual(items.value[0].value.Name.value, 'minecraft:stone');
    assert.deepStrictEqual(items.value[0].value.Slot, { type: TAG_BYTE, value: 0 });
});

check('回归：楼梯名里含 "air" 不能被当成空气', () => {
    assert.strictEqual(isAirName('minecraft:oak_stairs'), false, 'oak_stairs 曾被 name.includes("air") 误判成空气');
    assert.strictEqual(isAirName('minecraft:air'), true);
    assert.strictEqual(isAirName('minecraft:cave_air'), true);
    assert.strictEqual(isAirName('minecraft:structure_void'), true);
});

check('UIManager.resolveSaveFormatIndex：下拉回传值 → 格式下标（数字/字符串/非法值）', () => {
    const { UIManager } = require(path.join(PLUGIN, 'src', 'ui', 'UIManager.js'));
    const call = (v) => UIManager.prototype.resolveSaveFormatIndex.call({ defaultSaveFormatIndex: () => 0 }, v);
    assert.strictEqual(call(0), 0, '0 = .litematic');
    assert.strictEqual(call(1), 1, '1 = .mcstructure');
    assert.strictEqual(call(2), 2, '2 = both');
    assert.strictEqual(call('2'), 2, '字符串数字也应识别（个别 LSE 实现回传字符串）');
    assert.strictEqual(call('mcstructure'), 1, '直接回传格式名也应识别');
    assert.strictEqual(call('both'), 2, '直接回传格式名也应识别');
    assert.strictEqual(call(99), 0, '越界回退默认项');
    assert.strictEqual(call(undefined), 0, 'undefined 回退默认项');
    assert.strictEqual(call(null), 0, 'null 回退默认项');
});

// ────────────────────────────────────────────────────────────────────
// SchematicSaver 集成：mock 世界 + mock File/configManager，真写盘到临时目录
// ────────────────────────────────────────────────────────────────────
console.log('\n=== SchematicSaver 三路分派 ===');

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'litematicabe-mcstruct-'));
const world = {
    // (0,0,0) 石头；(1,0,0) 带朝向的观察者；(2,0,0) 带方块实体的箱子；(3,0,0) 楼梯
    blocks: {
        '0,0,0': { type: 'minecraft:stone', states: {}, entity: null },
        '1,0,0': {
            type: 'minecraft:observer',
            states: { 'minecraft:facing_direction': { type: TAG_STRING, v: 'north' }, powered_bit: { type: TAG_BYTE, v: 1 } },
            entity: null
        },
        '2,0,0': {
            type: 'minecraft:chest', states: { facing_direction: { type: TAG_INT, v: 3 } },
            entity: mockCompound({
                id: { type: TAG_STRING, value: 'Chest' },
                x: { type: TAG_INT, value: 2 }, y: { type: TAG_INT, value: 0 }, z: { type: TAG_INT, value: 0 },
                Items: {
                    type: TAG_LIST, listType: TAG_COMPOUND,
                    value: [{ Slot: { type: TAG_BYTE, value: 0 }, Name: { type: TAG_STRING, value: 'minecraft:diamond' } }]
                }
            })
        },
        '3,0,0': { type: 'minecraft:oak_stairs', states: { weirdo_direction: { type: TAG_INT, v: 0 } }, entity: null }
    }
};

let getBlockCalls = 0;
let getBlockEntityCalls = 0;
let getNbtCalls = 0;

global.logger = silentLogger;
global.fs = fs;
global.File = {
    exists: () => true,
    mkdir: () => {},
    writeTo: () => {},
    readFrom: () => null
};
let cfg = {
    'schematicSave.maxVolume': 1000000,
    'schematicSave.includeBlockEntities': true,
    'schematicSave.writeLiquidLayer': true,
    'schematicSave.blockVersion': 18168865,
    'schematicSave.formatVersion': 1,
    'schematicSave.verboseScan': false
};
global.configManager = { get: (k, d) => (k in cfg ? cfg[k] : d) };
global.mc = {
    getBlock(x, y, z) {
        getBlockCalls++;
        const rec = world.blocks[`${x},${y},${z}`];
        if (!rec) {
            return {
                type: 'minecraft:air', states: {},
                getNbt: () => null,
                getBlockEntity: () => null
            };
        }
        return {
            type: rec.type,
            states: rec.states,
            getNbt() {
                getNbtCalls++;
                return {
                    getTag(name) {
                        if (name !== 'states') return null;
                        const entries = {};
                        for (const [k, v] of Object.entries(rec.states)) {
                            entries[k] = { type: v.type, value: v.v };
                        }
                        return mockCompound(entries);
                    }
                };
            },
            getBlockEntity() {
                getBlockEntityCalls++;
                return rec.entity ? { getNbt: () => rec.entity } : null;
            }
        };
    }
};

const { SchematicSaver } = require(path.join(PLUGIN, 'src', 'core', 'SchematicSaver.js'));
const region = { minX: 0, minY: 0, minZ: 0, maxX: 3, maxY: 0, maxZ: 0 };

async function checkA(name, fn) {
    try { await fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

(async () => {
    await checkA('checkMcstructureVolume：纯算术，不读方块', async () => {
        const saver = new SchematicSaver();
        saver.schematicsDir = tmpDir + path.sep;
        const before = getBlockCalls;
        const info = saver.checkMcstructureVolume(region);
        assert.strictEqual(getBlockCalls, before, '体积检查不得读取方块');
        assert.deepStrictEqual(info.dimensions, { x: 4, y: 1, z: 1 });
        assert.strictEqual(info.volume, 4);
        assert.strictEqual(info.ok, true);
    });

    await checkA('save(mcstructure)：写出文件、带方块实体、楼梯不再被丢弃', async () => {
        const saver = new SchematicSaver();
        saver.schematicsDir = tmpDir + path.sep;
        const r = await saver.save(region, 0, 'demo_mc', 'tester', '', 'mcstructure');
        assert.strictEqual(r.format, 'mcstructure');
        assert.strictEqual(r.blockCount, 4, '4 个非空气方块（含楼梯）');
        assert.strictEqual(r.results[0].entityBlocks, 1, '箱子应写入 block_position_data');
        const file = path.join(tmpDir, 'demo_mc.mcstructure');
        assert.ok(fs.existsSync(file), '文件应存在');
        assert.ok(fs.statSync(file).size > 0);

        const raw = fs.readFileSync(file);
        assert.notStrictEqual(raw[0], 0x1f, '.mcstructure 不压缩（不能是 gzip magic）');
        assert.strictEqual(raw[0], 0x0A, 'root 应为 TAG_Compound');

        const root = parseLittleEndianNbt(raw);
        const { blockPalette } = extractStructure(root);
        const names = blockPalette.map((e) => e.name);
        assert.ok(names.includes('minecraft:oak_stairs'), '楼梯必须被导出（回归：曾经被 includes("air") 吞掉）');
        assert.ok(names.includes('minecraft:chest'));
    });

    await checkA('save(litematic)：走原链路，仍能产出可解析的 gzip 文件', async () => {
        const saver = new SchematicSaver();
        saver.schematicsDir = tmpDir + path.sep;
        const r = await saver.save(region, 0, 'demo_li', 'tester', '', 'litematic');
        assert.strictEqual(r.format, 'litematic');
        assert.strictEqual(r.results[0].fileName, 'demo_li.litematic');
        const file = path.join(tmpDir, 'demo_li.litematic');
        const raw = fs.readFileSync(file);
        assert.strictEqual(raw[0], 0x1f, '.litematic 应为 gzip');
        assert.strictEqual(raw[1], 0x8b);
    });

    await checkA('save(both)：两个文件都产出，同一遍扫描', async () => {
        const saver = new SchematicSaver();
        saver.schematicsDir = tmpDir + path.sep;
        getBlockCalls = 0;
        const r = await saver.save(region, 0, 'demo_both', 'tester', '', 'both');
        assert.strictEqual(r.format, 'both');
        assert.strictEqual(r.results.length, 2);
        assert.strictEqual(r.failures.length, 0);
        assert.ok(fs.existsSync(path.join(tmpDir, 'demo_both.litematic')));
        assert.ok(fs.existsSync(path.join(tmpDir, 'demo_both.mcstructure')));
        // 选区 4×1×1 = 4 格，单遍遍历只能读 4 次
        assert.strictEqual(getBlockCalls, 4, `both 应只扫描一遍，实际 getBlock ${getBlockCalls} 次`);
    });

    await checkA('超限：在读任何方块之前就拒绝（0 次 getBlock）', async () => {
        const saver = new SchematicSaver();
        saver.schematicsDir = tmpDir + path.sep;
        cfg['schematicSave.maxVolume'] = 3;      // 4 格选区超限
        getBlockCalls = 0;
        let err = null;
        try {
            await saver.save(region, 0, 'demo_over', 'tester', '', 'mcstructure');
        } catch (e) { err = e; }
        cfg['schematicSave.maxVolume'] = 1000000;
        assert.ok(err, '超限必须抛错');
        assert.ok(/超过 .mcstructure 上限/.test(err.message), `错误信息应可读: ${err && err.message}`);
        assert.strictEqual(getBlockCalls, 0, '超限截停必须发生在读取方块之前');
    });

    await checkA('超限：litematic 不受 maxVolume 影响', async () => {
        const saver = new SchematicSaver();
        saver.schematicsDir = tmpDir + path.sep;
        cfg['schematicSave.maxVolume'] = 1;
        const r = await saver.save(region, 0, 'demo_li_big', 'tester', '', 'litematic');
        cfg['schematicSave.maxVolume'] = 1000000;
        assert.strictEqual(r.format, 'litematic');
    });

    await checkA('includeBlockEntities=false 时完全不调 getBlockEntity', async () => {
        const saver = new SchematicSaver();
        saver.schematicsDir = tmpDir + path.sep;
        cfg['schematicSave.includeBlockEntities'] = false;
        getBlockEntityCalls = 0;
        const r = await saver.save(region, 0, 'demo_noent', 'tester', '', 'mcstructure');
        cfg['schematicSave.includeBlockEntities'] = true;
        assert.strictEqual(getBlockEntityCalls, 0, '关掉开关后不应读方块实体');
        assert.strictEqual(r.results[0].entityBlocks, 0);
    });

    await checkA('未知格式直接拒绝', async () => {
        const saver = new SchematicSaver();
        saver.schematicsDir = tmpDir + path.sep;
        let err = null;
        try { await saver.save(region, 0, 'x', 't', '', 'nbt'); } catch (e) { err = e; }
        assert.ok(err && /未知导出格式/.test(err.message));
    });

    // 清理
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }

    console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
    process.exit(fail ? 1 : 0);
})();
