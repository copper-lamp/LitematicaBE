/**
 * test_data_restore_index.js — 投影从 projections.json 恢复后的空间索引重建
 *
 * 真实故障（2026-11-16 真机）：
 *   projections.json 里 Map 被序列化成 `{}`，恢复后打印机每 200ms 报
 *   `projection.blockChunks.get is not a function`，等于打印机没工作；
 *   轻松放置/纠错也在 blockIndex.get 上抛错。
 *
 * 覆盖：
 *   A. DataManager 加载后 blockChunks/blockIndex 被重建成 Map，按坐标能查到方块
 *   B. SpatialIndexUtils 对非 Map 的 blockChunks（{} / null）回退 blocks 数组
 *   C. 已就绪的 Map 不重复重建
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'restore-index-')));

let pass = 0;
let fail = 0;
function check(name, fn) {
    try {
        fn();
        pass++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        fail++;
        console.log(`  ❌ ${name}\n     ${e && e.message ? e.message : e}`);
    }
}

// ── 全局桩：DataManager 构造期就用 File / logger ──
const PROJECTIONS = {
    version: '2.0.0',
    projections: [
        {
            id: 'proj-1',
            name: '测试1',
            isMega: false,
            dimensions: { x: 3, y: 5, z: 5 },
            blocks: [
                { pos: [0, 0, 0], name: 'minecraft:stone', state: {} },
                { pos: [1, 0, 0], name: 'minecraft:torch', state: { torch_facing_direction: 'south' } },
                { pos: [2, 0, 3], name: 'minecraft:oak_planks', state: {} },
            ],
            // 落盘后 Map 变 {} —— 恢复时必须是这种形态
            blockChunks: {},
            blockIndex: {},
        },
    ],
};

global.logger = { info() {}, warn() {}, error() {}, debug() {} };
global.configManager = { get() { return false; } };
global.File = {
    exists(p) { return true; },
    readFrom(p) {
        if (String(p).includes('projections.json')) return JSON.stringify(PROJECTIONS);
        return '{}';
    },
    writeTo() { return true; },
    mkdir() { return true; },
    createDir() { return true; },
};

const { DataManager } = require(path.join(PLUGIN, 'src', 'data', 'DataManager.js'));
const { SpatialIndexUtils } = require(path.join(PLUGIN, 'src', 'easyplace', 'SpatialIndexUtils.js'));

console.log('\n=== 投影恢复索引 ===');

check('A1. 加载后 blockChunks/blockIndex 重建为 Map', () => {
    const dm = new DataManager();
    const p = dm.getProjection('proj-1');
    assert.ok(p, '投影应加载');
    assert.strictEqual(typeof p.blockChunks.get, 'function', 'blockChunks 必须是 Map（打印机会调 .get）');
    assert.strictEqual(typeof p.blockIndex.get, 'function', 'blockIndex 必须是 Map（轻松放置/纠错会调 .get）');
    assert.strictEqual(p.blockChunks.size, 1, '3 个方块都在 16³ 分块 0,0,0 里');
    assert.strictEqual(p.blockIndex.size, 3);
});

check('A2. 按坐标能取回方块（torch 状态保留）', () => {
    const p = new DataManager().getProjection('proj-1');
    const torch = p.blockIndex.get('1,0,0');
    assert.ok(torch, 'blockIndex 应查到 (1,0,0)');
    assert.strictEqual(torch.name, 'minecraft:torch');
    assert.strictEqual(torch.state.torch_facing_direction, 'south');
    const fence = p.blockIndex.get('2,0,3');
    assert.ok(fence);
});

check('B1. SpatialIndexUtils 对 blockChunks={} 回退 blocks（不再抛 get is not a function）', () => {
    const proj = {
        dimensions: { x: 8, y: 8, z: 8 },
        blocks: [{ pos: [1, 0, 0], name: 'minecraft:stone' }],
        blockChunks: {},
    };
    const out = SpatialIndexUtils.getBlocksInRadius(proj, 0, 0, 0, 6);
    assert.strictEqual(out.length, 1, '应回退 blocks');
});

check('B2. SpatialIndexUtils 对 blockChunks=null 回退 blocks', () => {
    const proj = {
        dimensions: { x: 8, y: 8, z: 8 },
        blocks: [{ pos: [1, 0, 0], name: 'minecraft:stone' }],
        blockChunks: null,
    };
    assert.strictEqual(SpatialIndexUtils.getBlocksInRadius(proj, 0, 0, 0, 6).length, 1);
});

check('B3. SpatialIndexUtils 对真 Map 走分块查询（不回退）', () => {
    const b = { pos: [1, 0, 0], name: 'minecraft:stone' };
    const proj = {
        dimensions: { x: 8, y: 8, z: 8 },
        blocks: [],
        blockChunks: new Map([['0,0,0', [b]]]),
    };
    const out = SpatialIndexUtils.getBlocksInRadius(proj, 0, 0, 0, 6);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0], b);
});

check('C. 已是真 Map 的投影不重复重建（对象引用不变）', () => {
    const dm = new DataManager();
    const p = dm.getProjection('proj-1');
    const before = p.blockChunks;
    dm._rebuildSpatialIndex(p);
    assert.strictEqual(p.blockChunks, before, '已就绪的 Map 不应被替换');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
