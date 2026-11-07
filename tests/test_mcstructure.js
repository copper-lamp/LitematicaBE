/**
 * test_mcstructure.js — .mcstructure（Bedrock 结构文件）加载器离线验收
 *
 * 不依赖 BDS / 外部文件：测试内【手工构造】一个小端 NBT 的 .mcstructure 二进制，
 * 验证：小端解析 / ZYX 坐标反算 / 液体层（第二层 block_indices）/ states 键去命名空间 /
 *       renderName 渲染兜底 + name 保留原始状态 / 与 .litematic schematic 结构一致 / prepareStream。
 *
 * 结构（2×2×2）：
 *   palette: [0]=white_concrete, [1]=oak_stairs(minecraft:cardinal_direction=south, weirdo_direction=0),
 *             [2]=flowing_water, [3]=air
 *   block_indices[0]（主层）: [0, 1, 3, -1, 0, 3, 2, 3]
 *   block_indices[1]（次层）: [-1, -1, -1, 2, -1, -1, -1, -1]
 *
 * 期望（ZYX：index = x·SZ·SY + y·SZ + z）：
 *   i=0 → (0,0,0) white_concrete
 *   i=1 → (0,0,1) oak_stairs（states.cardinal_direction 已去前缀='south'）
 *   i=2 → (0,1,0) 主层 air + 次层 -1 → 跳过
 *   i=3 → (0,1,1) 主层 -1 + 次层 flowing_water → 水（name 保留原始名，renderName=water）
 *   i=4 → (1,0,0) white_concrete
 *   i=5 → (1,0,1) air → 跳过
 *   i=6 → (1,1,0) flowing_water（主层）
 *   i=7 → (1,1,1) air → 跳过
 *   非空气 = 5 个
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');
const {
    McstructureLoader,
    normalizeBeName,
    normalizeBeStates,
    isAirName,
    BE_OLD_TO_JAVA
} = require(path.join(PLUGIN, 'src', 'core', 'McstructureLoader.js'));

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };
global.logger = silentLogger;

// ── 小端 NBT 编码器（仅测试构造用） ──────────────────────────
function leShort(v) { const b = Buffer.alloc(2); b.writeInt16LE(v); return b; }
function leInt(v) { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; }
function str(s) { const b = Buffer.from(s, 'utf8'); return Buffer.concat([leShort(b.length), b]); }
function encString(s) { return str(s); }
function encInt(v) { return leInt(v); }
function encCompound(entries) {
    const parts = [];
    for (const e of entries) {
        parts.push(Buffer.concat([Buffer.from([e.type]), str(e.name), e.payload]));
    }
    parts.push(Buffer.from([0])); // TAG_End
    return Buffer.concat(parts);
}
function encList(elemType, items) {
    return Buffer.concat([Buffer.from([elemType]), leInt(items.length), ...items]);
}
function encIntArray(arr) {
    return Buffer.concat([leInt(arr.length), ...arr.map(leInt)]);
}
function encStates(states) {
    const entries = Object.entries(states).map(([k, v]) => {
        if (typeof v === 'string') return { type: 8, name: k, payload: encString(v) };
        if (typeof v === 'boolean') return { type: 1, name: k, payload: Buffer.from([v ? 1 : 0]) };
        return { type: 3, name: k, payload: encInt(v) };
    });
    return encCompound(entries);
}
function encBlockPalette(name, states) {
    return encCompound([
        { type: 8, name: 'name', payload: encString(name) },
        { type: 10, name: 'states', payload: encStates(states) },
    ]);
}

/** 构造一个 2×2×2 的小 .mcstructure 二进制（little-endian NBT） */
function buildTestMcstructure() {
    const sx = 2, sy = 2, sz = 2;
    const main = [0, 1, 3, -1, 0, 3, 2, 3];
    const second = [-1, -1, -1, 2, -1, -1, -1, -1];

    const blockPalette = [
        encBlockPalette('minecraft:white_concrete', {}),
        encBlockPalette('minecraft:oak_stairs', { 'minecraft:cardinal_direction': 'south', weirdo_direction: 0 }),
        encBlockPalette('minecraft:flowing_water', {}),
        encBlockPalette('minecraft:air', {}),
    ];

    const blockPaletteList = encList(10, blockPalette);
    const defaultCompound = encCompound([
        { type: 9, name: 'block_palette', payload: blockPaletteList },
        { type: 10, name: 'block_position_data', payload: encCompound([]) },
    ]);
    const paletteCompound = encCompound([
        { type: 10, name: 'default', payload: defaultCompound },
    ]);

    const structure = encCompound([
        { type: 9, name: 'block_indices', payload: encList(11, [encIntArray(main), encIntArray(second)]) },
        { type: 9, name: 'entities', payload: encList(10, []) },
        { type: 10, name: 'palette', payload: paletteCompound },
    ]);

    const root = encCompound([
        { type: 3, name: 'format_version', payload: encInt(1) },
        { type: 9, name: 'size', payload: encList(3, [encInt(sx), encInt(sy), encInt(sz)]) },
        { type: 10, name: 'structure', payload: structure },
    ]);

    return Buffer.concat([Buffer.from([10]), str(''), root]);
}

let pass = 0, fail = 0;
function ok(name, fn) {
    try { fn(); pass++; console.log(`✅ ${name}`); }
    catch (e) { fail++; console.log(`❌ ${name}: ${e.message}`); }
}

// ── 单元：归一化函数 ──────────────────────────────────────
ok('normalizeBeName: flowing_water → water（渲染兜底）', () => {
    assert.strictEqual(normalizeBeName('minecraft:flowing_water'), 'minecraft:water');
    assert.strictEqual(normalizeBeName('minecraft:wooden_door'), 'minecraft:oak_door');
    assert.strictEqual(normalizeBeName('minecraft:stone_slab'), 'minecraft:stone');
});
ok('normalizeBeName: 现代名保留原名', () => {
    assert.strictEqual(normalizeBeName('minecraft:stone'), 'minecraft:stone');
    assert.strictEqual(normalizeBeName('minecraft:oak_stairs'), 'minecraft:oak_stairs');
    assert.strictEqual(normalizeBeName('minecraft:unpowered_repeater'), 'minecraft:unpowered_repeater');
});
ok('normalizeBeStates: 键去命名空间', () => {
    const s = normalizeBeStates({ 'minecraft:cardinal_direction': 'south', weirdo_direction: 0 });
    assert.strictEqual(s.cardinal_direction, 'south');
    assert.strictEqual(s.weirdo_direction, 0);
    assert.strictEqual(s['minecraft:cardinal_direction'], undefined);
});
ok('isAirName: air 类判定', () => {
    assert.strictEqual(isAirName('minecraft:air'), true);
    assert.strictEqual(isAirName('minecraft:cave_air'), true);
    assert.strictEqual(isAirName('minecraft:structure_void'), true);
    assert.strictEqual(isAirName('minecraft:white_concrete'), false);
    assert.strictEqual(isAirName('minecraft:flowing_water'), false);
});

// ── 集成：load() ─────────────────────────────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcstruct-'));
const mcFile = path.join(tmpDir, 'test_structure.mcstructure');
fs.writeFileSync(mcFile, buildTestMcstructure());

const loader = new McstructureLoader(silentLogger);

(async () => {
    const schematic = await loader.load(mcFile);

    ok('load(): dimensions = {x:2,y:2,z:2}', () => {
        assert.deepStrictEqual(schematic.dimensions, { x: 2, y: 2, z: 2 });
    });
    ok('load(): totalBlocks = 5（非空气）', () => {
        assert.strictEqual(schematic.totalBlocks, 5);
        assert.strictEqual(schematic.blocks.length, 5);
    });
    ok('load(): ZYX 坐标反算正确', () => {
        const byPos = new Map(schematic.blocks.map(b => [b.pos.join(','), b]));
        assert.strictEqual(byPos.get('0,0,0').name, 'minecraft:white_concrete');
        assert.strictEqual(byPos.get('0,0,1').name, 'minecraft:oak_stairs');
        assert.strictEqual(byPos.get('1,0,0').name, 'minecraft:white_concrete');
        assert.strictEqual(byPos.get('1,1,0').name, 'minecraft:flowing_water');
    });
    ok('load(): states 键去命名空间（oak_stairs）', () => {
        const byPos = new Map(schematic.blocks.map(b => [b.pos.join(','), b]));
        const stairs = byPos.get('0,0,1');
        assert.strictEqual(stairs.state.cardinal_direction, 'south');
        assert.strictEqual(stairs.state.weirdo_direction, 0);
        assert.strictEqual(stairs.state['minecraft:cardinal_direction'], undefined);
    });
    ok('load(): 状态保留 —— flowing_water 保留原始名 + renderName 兜底', () => {
        const byPos = new Map(schematic.blocks.map(b => [b.pos.join(','), b]));
        const water = byPos.get('1,1,0');
        assert.strictEqual(water.name, 'minecraft:flowing_water'); // 原始名保留
        assert.strictEqual(water.renderName, 'minecraft:water');   // 渲染兜底
        assert.strictEqual(water.bedrockState, water.state);       // 状态完整保留
    });
    ok('load(): 液体层 —— (0,1,1) 来自第二层，flowing_water', () => {
        const byPos = new Map(schematic.blocks.map(b => [b.pos.join(','), b]));
        const water = byPos.get('0,1,1');
        assert.strictEqual(water.name, 'minecraft:flowing_water');
        assert.strictEqual(water.renderName, 'minecraft:water');
    });
    ok('load(): 普通方块无 renderName（white_concrete）', () => {
        const byPos = new Map(schematic.blocks.map(b => [b.pos.join(','), b]));
        assert.strictEqual(byPos.get('0,0,0').renderName, undefined);
    });
    ok('load(): blockIndex / blockChunks 已构建', () => {
        assert.strictEqual(schematic.blockIndex.get('0,0,0').name, 'minecraft:white_concrete');
        assert.ok(schematic.blockChunks.size >= 1);
    });

    // ── 集成：prepareStream（Mega 流式） ─────────────────
    const stream = await loader.prepareStream(mcFile);
    ok('prepareStream: totalEstimate = 体积 8', () => {
        assert.strictEqual(stream.totalEstimate, 8);
    });
    ok('prepareStream: meta.dimensions = 2×2×2', () => {
        assert.deepStrictEqual(stream.meta.dimensions, { x: 2, y: 2, z: 2 });
    });
    ok('prepareStream: generator 产出非空气（Mega 用渲染名）', async () => {
        let count = 0;
        const names = [];
        for await (const batch of stream.generator) {
            count += batch.length;
            for (const b of batch) names.push(b.name);
        }
        assert.strictEqual(count, 5);
        // Mega 二进制只存 name，此处应为渲染兜底名（flowing_water → water）
        assert.ok(names.includes('minecraft:water'));
        assert.ok(!names.includes('minecraft:flowing_water'));
        assert.ok(names.includes('minecraft:white_concrete'));
    });

    console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
    process.exit(fail ? 1 : 0);
})().catch((e) => {
    console.error('测试执行异常:', e);
    console.log(`\n结果: ${pass} 通过 / ${fail + 1} 失败\n`);
    process.exit(1);
});
