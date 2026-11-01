/**
 * test_surface_extractor.js — SurfaceExtractor 离线回归
 *
 * 覆盖：
 *   1. 32³ 实心 → 只剩外壳（32768 - 27000 = 5768）
 *   2. **过程中零世界查询**：global.mc 上的 getBlock/getWorld 计数必须为 0
 *   3. 单方块 / 空心盒 / 全空气 / 无 pos / 重复坐标
 *   4. 层过滤：整层保留（flat）与层内剔除（cull:true）两种语义
 *   5. 透明方块遮挡开关（transparentOccluders）
 *   6. 输入顺序稳定、返回原对象引用
 *   7. 3 万方块提取耗时（宽松上限，只看数量级）
 */
const assert = require('assert');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');
const {
    SurfaceExtractor, isAirLikeName, isTransparentName, stripNamespace, posOf,
} = require(path.join(PLUGIN, 'src', 'ghost', 'SurfaceExtractor.js'));

// ── 世界访问哨兵：任何一次调用都记账，测试末尾断言为 0 ──────────────
const worldCalls = { getBlock: 0, getWorld: 0, setBlock: 0, runcmd: 0, getPlayer: 0 };
global.mc = {
    getBlock() { worldCalls.getBlock++; throw new Error('SurfaceExtractor 不许查世界'); },
    getWorld() { worldCalls.getWorld++; throw new Error('SurfaceExtractor 不许查世界'); },
    setBlock() { worldCalls.setBlock++; throw new Error('SurfaceExtractor 不许写世界'); },
    runcmd() { worldCalls.runcmd++; throw new Error('SurfaceExtractor 不许执行命令'); },
    getPlayer() { worldCalls.getPlayer++; throw new Error('SurfaceExtractor 不许取玩家'); },
};
global.logger = { info() {}, warn() {}, error() {} };

let pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) { console.log(`  ❌ ${name}`); console.log(`     ${e.message}`); fail++; }
}

const block = (x, y, z, name = 'minecraft:stone') => ({ pos: [x, y, z], name, state: {} });
const keyOf = (b) => `${b.pos[0]},${b.pos[1]},${b.pos[2]}`;

console.log('\n=== SurfaceExtractor ===');

check('stripNamespace / isAirLikeName / isTransparentName 基础判定', () => {
    assert.strictEqual(stripNamespace('minecraft:oak_planks'), 'oak_planks');
    assert.strictEqual(stripNamespace('Stone'), 'stone');
    assert.strictEqual(isAirLikeName('minecraft:air'), true);
    assert.strictEqual(isAirLikeName('minecraft:cave_air'), true);
    assert.strictEqual(isAirLikeName('minecraft:stone'), false);
    assert.strictEqual(isTransparentName('minecraft:white_stained_glass'), true);
    assert.strictEqual(isTransparentName('minecraft:white_stained_glass_pane'), true);
    assert.strictEqual(isTransparentName('minecraft:glass'), true);
    assert.strictEqual(isTransparentName('minecraft:stone'), false);
});

check('posOf 兼容数组与对象', () => {
    assert.deepStrictEqual(posOf({ pos: [1, 2, 3] }), [1, 2, 3]);
    assert.deepStrictEqual(posOf({ pos: { x: 4, y: 5, z: 6 } }), [4, 5, 6]);
    assert.strictEqual(posOf({}), null);
    assert.strictEqual(posOf({ pos: [1, 2] }), null);
});

check('32³ 实心 → 只剩外壳 5768 格（32768 - 27000）', () => {
    const blocks = [];
    for (let x = 0; x < 32; x++)
        for (let y = 0; y < 32; y++)
            for (let z = 0; z < 32; z++) blocks.push(block(x, y, z));

    const ex = new SurfaceExtractor();
    const { blocks: out, stats } = ex.extract({ blocks });
    assert.strictEqual(stats.input, 32768);
    assert.strictEqual(out.length, 5768, `期望 5768，实际 ${out.length}`);
    assert.strictEqual(stats.culled, 27000);

    const set = new Set(out.map(keyOf));
    assert.ok(set.has('0,0,0'), '角块必须保留');
    assert.ok(!set.has('16,16,16'), '正中心必须剔除');
    assert.ok(set.has('16,0,16'), '底面中心必须保留');
    // 外壳定义：至少一个坐标在 0 或 31
    for (const k of set) {
        const [x, y, z] = k.split(',').map(Number);
        assert.ok(x === 0 || x === 31 || y === 0 || y === 31 || z === 0 || z === 31, `非外壳格 ${k}`);
    }
});

check('零世界查询：整个 32³ 提取期间 worldCalls 全为 0', () => {
    assert.deepStrictEqual(worldCalls, { getBlock: 0, getWorld: 0, setBlock: 0, runcmd: 0, getPlayer: 0 });
});

check('单方块 → 1 格', () => {
    const { blocks: out } = new SurfaceExtractor().extract([block(5, 5, 5)]);
    assert.strictEqual(out.length, 1);
});

check('3³ 空心盒（中心缺失）→ 全部 26 格保留', () => {
    const blocks = [];
    for (let x = 0; x < 3; x++)
        for (let y = 0; y < 3; y++)
            for (let z = 0; z < 3; z++) {
                if (x === 1 && y === 1 && z === 1) continue;
                blocks.push(block(x, y, z));
            }
    const { blocks: out } = new SurfaceExtractor().extract(blocks);
    assert.strictEqual(out.length, 26);
});

check('全空气输入 → 0 格，skippedAir 记满', () => {
    const blocks = [block(0, 0, 0, 'minecraft:air'), block(1, 0, 0, 'minecraft:cave_air')];
    const { blocks: out, stats } = new SurfaceExtractor().extract(blocks);
    assert.strictEqual(out.length, 0);
    assert.strictEqual(stats.skippedAir, 2);
});

check('includeAir=true 时空气也参与（但不遮挡）', () => {
    const blocks = [block(0, 0, 0, 'minecraft:air'), block(1, 0, 0)];
    const { blocks: out } = new SurfaceExtractor().extract(blocks, { includeAir: true });
    // 空气格邻居是空气 → 不遮挡 → 两颗都保留
    assert.strictEqual(out.length, 2);
});

check('层过滤：y=16 整层 1024 格（默认 flat，不剔除）', () => {
    const blocks = [];
    for (let x = 0; x < 32; x++)
        for (let y = 0; y < 32; y++)
            for (let z = 0; z < 32; z++) blocks.push(block(x, y, z));
    const { blocks: out, stats } = new SurfaceExtractor().extract({ blocks }, { layerFilter: 16 });
    assert.strictEqual(out.length, 1024);
    assert.strictEqual(stats.mode, 'flat');
    assert.ok(out.every(b => b.pos[1] === 16));
});

check('层过滤 + cull:true：仍是 1024 格（上下邻居不在本层集合内，绝不挖洞）', () => {
    const blocks = [];
    for (let x = 0; x < 32; x++)
        for (let y = 0; y < 32; y++)
            for (let z = 0; z < 32; z++) blocks.push(block(x, y, z));
    const { blocks: out } = new SurfaceExtractor().extract({ blocks }, { layerFilter: 16, cull: true });
    assert.strictEqual(out.length, 1024, '层内剔除会把墙面挖出洞，这里必须保持整层');
});

check('cull:false → 全部非空气方块原样返回（不剔除）', () => {
    const blocks = [];
    for (let x = 0; x < 4; x++)
        for (let y = 0; y < 4; y++)
            for (let z = 0; z < 4; z++) blocks.push(block(x, y, z));
    const { blocks: out } = new SurfaceExtractor().extract(blocks, { cull: false });
    assert.strictEqual(out.length, 64);
});

check('透明方块：默认算遮挡（5³ 玻璃 → 98 外壳）', () => {
    const blocks = [];
    for (let x = 0; x < 5; x++)
        for (let y = 0; y < 5; y++)
            for (let z = 0; z < 5; z++) blocks.push(block(x, y, z, 'minecraft:glass'));
    const { blocks: out } = new SurfaceExtractor().extract(blocks);
    assert.strictEqual(out.length, 125 - 27);
});

check('透明方块：transparentOccluders=false → 5³ 玻璃全留 125 格', () => {
    const blocks = [];
    for (let x = 0; x < 5; x++)
        for (let y = 0; y < 5; y++)
            for (let z = 0; z < 5; z++) blocks.push(block(x, y, z, 'minecraft:glass'));
    const { blocks: out } = new SurfaceExtractor({ transparentOccluders: false }).extract(blocks);
    assert.strictEqual(out.length, 125);
});

check('缺 pos 的方块被跳过，重复坐标只留第一个', () => {
    const a = block(0, 0, 0);
    const b = block(0, 0, 0, 'minecraft:oak_planks');
    const { blocks: out, stats } = new SurfaceExtractor().extract([a, b, { name: 'minecraft:stone' }]);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0], a, '保留首个注册的方块对象');
    assert.strictEqual(stats.skippedDuplicate, 1);
});

check('返回原对象引用，输入顺序在层内保持', () => {
    const a = block(0, 0, 0);
    const b = block(1, 0, 0);
    const c = block(0, 1, 0);
    const { blocks: out } = new SurfaceExtractor().extract([a, b, c]);
    assert.strictEqual(out.length, 3);
    assert.ok(out.includes(a) && out.includes(b) && out.includes(c));
    // 按 y 升序分组，同层保持输入顺序
    assert.deepStrictEqual(out.map(keyOf), ['0,0,0', '1,0,0', '0,1,0']);
});

check('层跨度统计正确（min/max/layers）', () => {
    const blocks = [block(0, 5, 0), block(0, 9, 0), block(1, 5, 0)];
    const { stats } = new SurfaceExtractor().extract(blocks);
    assert.strictEqual(stats.minLayer, 5);
    assert.strictEqual(stats.maxLayer, 9);
    assert.strictEqual(stats.layers, 2);
});

check('性能：3 万方块提取 < 2000ms', () => {
    const blocks = [];
    for (let x = 0; x < 31; x++)
        for (let y = 0; y < 31; y++)
            for (let z = 0; z < 31; z++) blocks.push(block(x, y, z));
    const t0 = Date.now();
    const { blocks: out, stats } = new SurfaceExtractor().extract({ blocks });
    const ms = Date.now() - t0;
    console.log(`     29791 输入 → ${out.length} 外壳 / ${ms}ms`);
    assert.ok(ms < 2000, `耗时 ${ms}ms 超过 2000ms`);
    assert.strictEqual(stats.input, 29791);
});

check('提取完成后仍然零世界查询', () => {
    assert.deepStrictEqual(worldCalls, { getBlock: 0, getWorld: 0, setBlock: 0, runcmd: 0, getPlayer: 0 });
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
