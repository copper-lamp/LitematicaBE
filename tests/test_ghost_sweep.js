/**
 * test_ghost_sweep.js — "失去账本"的 ghost 兜底清理（/lit ghost sweep）
 *
 * 事故形态（2026-11-11 真机）：加载 MEGA 投影 → 强关服 → 会话/注入状态全丢 →
 * 重进后删投影（旧代码连世界都不碰）→ 世界里留下 6163 格 `lit:g_*`，
 * 而快照与期望都已经散失：`ghost clean` 找不到会话、`reclaimOrphans` 也认不出来。
 *
 * 唯一可行的兜底是"按坐标读世界 → 判是不是 ghost → 写回空气"，本测试钉死它的安全边界：
 *   1. 只碰 ghost，玩家真方块一格不动
 *   2. 读不到方块（区块未加载）→ 跳过，绝不盲写
 *   3. 写之前先删期望 / forget，否则 GhostGuard 会把 ghost 补回来
 *   4. dryRun 只统计不写世界
 *   5. box 模式边界精确；radius 被夹到 ≤32
 */
const assert = require('assert');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');
const { ProjectionRenderer } = require(path.join(PLUGIN, 'src', 'render', 'ProjectionRenderer.js'));

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

const W = new Map();
const wkey = (x, y, z, d) => `${d}:${x},${y},${z}`;
let UNLOADED = new Set();

global.mc = {
    listen() { return true; },
    getPlayer() { return null; },
    getBlock(x, y, z, d) {
        const k = wkey(x, y, z, d);
        if (UNLOADED.has(k)) return null;                    // 区块未加载
        const v = W.get(k);
        if (!v) return { type: 'minecraft:air', tileData: 0, pos: { x, y, z, dimid: d } };
        return { type: v, tileData: 0, pos: { x, y, z, dimid: d } };
    },
    setBlock(x, y, z, d, type) {
        W.set(wkey(x, y, z, d), type);
        return true;
    },
};
global.logger = silentLogger;

const expectCalls = { del: [], flush: 0 };
const forgetCalls = [];
global.ghostExpect = {
    del(d, x, y, z) { expectCalls.del.push(`${d}:${x},${y},${z}`); },
    flush() { expectCalls.flush++; },
};
global.ghostGuard = {
    isGhostBlock(b) { return !!b && typeof b.type === 'string' && b.type.indexOf('lit:g_') === 0; },
    forget(d, x, y, z) { forgetCalls.push(`${d}:${x},${y},${z}`); },
};
global.ghostRegistry = { isGhost: (t) => typeof t === 'string' && t.indexOf('lit:g_') === 0 };

const mkPlayer = (x, y, z, dimid = 0) => ({
    xuid: 'P1', name: 'Steve',
    pos: { x, y, z, dimid },
    _tells: [],
    tell(m) { this._tells.push(m); },
});

function reset() {
    W.clear();
    UNLOADED = new Set();
    expectCalls.del.length = 0;
    expectCalls.flush = 0;
    forgetCalls.length = 0;
}

let pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) { console.log(`  ❌ ${name}\n     ${e && e.message ? e.message : e}`); fail++; }
}

console.log('\n=== ghost 兜底清理（sweep） ===');

check('只清 ghost：玩家真方块一格不动，期望同步删除', () => {
    reset();
    const p = mkPlayer(0, 64, 0);
    W.set(wkey(0, 64, 0, 0), 'lit:g_stone');
    W.set(wkey(1, 64, 0, 0), 'lit:g_oak_stairs');
    W.set(wkey(-1, 64, 0, 0), 'minecraft:diamond_block');   // 玩家建筑
    W.set(wkey(0, 65, 0, 0), 'lit:g_torch');

    const r = new ProjectionRenderer({ logger: silentLogger });
    const out = r.sweepGhosts(p, { radius: 2 });

    assert.strictEqual(out.cleared, 3, `应清 3 个 ghost，实际 ${out.cleared}`);
    assert.strictEqual(out.failed, 0);
    assert.strictEqual(W.get(wkey(0, 64, 0, 0)), 'minecraft:air');
    assert.strictEqual(W.get(wkey(1, 64, 0, 0)), 'minecraft:air');
    assert.strictEqual(W.get(wkey(0, 65, 0, 0)), 'minecraft:air');
    assert.strictEqual(W.get(wkey(-1, 64, 0, 0)), 'minecraft:diamond_block', '真方块必须保留');
    assert.strictEqual(expectCalls.del.length, 3, '每个被清的格都要删期望');
    assert.strictEqual(expectCalls.flush, 1, '最后落盘一次');
    assert.strictEqual(forgetCalls.length, 3, 'GhostGuard 也要 forget');
});

check('活跃会话的格全部跳过（正在显示的投影不能被扫掉）', () => {
    reset();
    const p = mkPlayer(0, 64, 0);
    W.set(wkey(0, 64, 0, 0), 'lit:g_stone');     // 活跃投影已写进世界
    W.set(wkey(1, 64, 0, 0), 'lit:g_stone');     // 同一投影
    W.set(wkey(2, 64, 0, 0), 'lit:g_stone');     // 无账本残留

    const r = new ProjectionRenderer({ logger: silentLogger });
    // 伪造一个活跃会话：written 里记着前两格
    r.ghostRenderer = {
        sessions: new Map([['P1::p', {
            dimid: 0,
            written: [{ x: 0, y: 64, z: 0 }, { x: 1, y: 64, z: 0 }],
        }]]),
    };
    const out = r.sweepGhosts(p, { radius: 3 });

    assert.strictEqual(out.kept, 2, `活跃投影的 2 格应保留，实际 ${out.kept}`);
    assert.strictEqual(out.cleared, 1, `只清无账本那 1 格，实际 ${out.cleared}`);
    assert.strictEqual(W.get(wkey(0, 64, 0, 0)), 'lit:g_stone', '活跃投影的格不能被清');
    assert.strictEqual(W.get(wkey(1, 64, 0, 0)), 'lit:g_stone');
    assert.strictEqual(W.get(wkey(2, 64, 0, 0)), 'minecraft:air');
    assert.ok(!expectCalls.del.includes('0:0,64,0'), '活跃投影的期望不能删');
});

check('dimid 不同的活跃会话不影响本次扫描', () => {
    reset();
    const p = mkPlayer(0, 64, 0);
    W.set(wkey(0, 64, 0, 0), 'lit:g_stone');

    const r = new ProjectionRenderer({ logger: silentLogger });
    r.ghostRenderer = {
        sessions: new Map([['P1::p', { dimid: 1, written: [{ x: 0, y: 64, z: 0 }] }]]),
    };
    const out = r.sweepGhosts(p, { radius: 1 });

    assert.strictEqual(out.kept, 0, '别的维度的 written 不该保护本维度的格');
    assert.strictEqual(out.cleared, 1);
});

check('读不到方块（区块未加载）→ 跳过，绝不盲写', () => {
    reset();
    const p = mkPlayer(0, 64, 0);
    // 让整个半径 1 的立方体都"未加载"
    for (let x = -1; x <= 1; x++)
        for (let y = 63; y <= 65; y++)
            for (let z = -1; z <= 1; z++) UNLOADED.add(wkey(x, y, z, 0));
    W.set(wkey(0, 64, 0, 0), 'lit:g_stone');   // 世界里有 ghost，但读不到

    const r = new ProjectionRenderer({ logger: silentLogger });
    const out = r.sweepGhosts(p, { radius: 1 });

    assert.strictEqual(out.cleared, 0, '不该清任何格');
    assert.strictEqual(out.scanned, 0, '读不到的格不计入 scanned');
    assert.strictEqual(out.skipped, 27, `半径 1 的立方体共 27 格，实际跳过 ${out.skipped}`);
    assert.strictEqual(W.get(wkey(0, 64, 0, 0)), 'lit:g_stone', '世界不能被改动');
    assert.strictEqual(expectCalls.del.length, 0);
});

check('dryRun：只统计、不写世界、不删期望', () => {
    reset();
    const p = mkPlayer(0, 64, 0);
    W.set(wkey(0, 64, 0, 0), 'lit:g_stone');
    W.set(wkey(0, 64, 1, 0), 'lit:g_stone');

    const r = new ProjectionRenderer({ logger: silentLogger });
    const out = r.sweepGhosts(p, { radius: 1, dryRun: true });

    assert.strictEqual(out.cleared, 2);
    assert.strictEqual(out.dryRun, true);
    assert.strictEqual(W.get(wkey(0, 64, 0, 0)), 'lit:g_stone', '演练模式不得写世界');
    assert.strictEqual(expectCalls.del.length, 0, '演练模式不得删期望');
});

check('chunks=5：以自身所在区块为中心的 5×5 区块（80×80，纵向 ±32）', () => {
    reset();
    const p = mkPlayer(8, 64, 8);              // 区块 (0,0) 内
    const r = new ProjectionRenderer({ logger: silentLogger });
    const out = r.sweepGhosts(p, { chunks: 5 });

    assert.strictEqual(out.chunks, 5);
    // half = 2 → 水平 -2..+2 区块 = -32..47（80 格宽）
    assert.strictEqual(out.box.minX, -32, `minX 实际 ${out.box.minX}`);
    assert.strictEqual(out.box.maxX, 47, `maxX 实际 ${out.box.maxX}`);
    assert.strictEqual(out.box.minZ, -32);
    assert.strictEqual(out.box.maxZ, 47);
    assert.strictEqual(out.box.minY, 32, `minY 实际 ${out.box.minY}`);
    assert.strictEqual(out.box.maxY, 96, `maxY 实际 ${out.box.maxY}`);
    assert.strictEqual(out.scanned, 80 * 80 * 65, `扫描格数实际 ${out.scanned}`);
});

check('chunks 以玩家**所在区块**为中心（换区块后整框跟着平移）', () => {
    reset();
    const r = new ProjectionRenderer({ logger: silentLogger });

    // 玩家在区块 (10, -5) 内：x 160..175, z -80..-65
    const a = r.sweepGhosts(mkPlayer(163, 70, -72), { chunks: 1 });
    assert.strictEqual(a.box.minX, 160);
    assert.strictEqual(a.box.maxX, 175);
    assert.strictEqual(a.box.minZ, -80);
    assert.strictEqual(a.box.maxZ, -65);

    // 3×3 时向两侧各扩一个区块
    const b = r.sweepGhosts(mkPlayer(163, 70, -72), { chunks: 3 });
    assert.strictEqual(b.box.minX, 144, `3×3 minX 实际 ${b.box.minX}`);
    assert.strictEqual(b.box.maxX, 191, `3×3 maxX 实际 ${b.box.maxX}`);
    assert.strictEqual(b.box.minZ, -96);
    assert.strictEqual(b.box.maxZ, -49);
});

check('chunks 被夹到 1..9（避免一条命令扫爆主线程）', () => {
    reset();
    const r = new ProjectionRenderer({ logger: silentLogger });

    const big = r.sweepGhosts(mkPlayer(0, 64, 0), { chunks: 99 });
    assert.strictEqual(big.chunks, 9, `应夹到 9，实际 ${big.chunks}`);
    assert.strictEqual(big.box.minX, -64);     // half = 4
    assert.strictEqual(big.box.maxX, 79);

    const small = r.sweepGhosts(mkPlayer(0, 64, 0), { chunks: 0.2 });
    assert.strictEqual(small.chunks, 1, `应夹到 1，实际 ${small.chunks}`);
});

check('box 模式：只扫指定立方体，边界精确', () => {
    reset();
    const p = mkPlayer(500, 64, 500);            // 玩家离得远，验证 box 不依赖玩家位置
    W.set(wkey(10, 70, 10, 0), 'lit:g_stone');   // 盒内
    W.set(wkey(12, 72, 12, 0), 'lit:g_stone');   // 盒角
    W.set(wkey(13, 70, 10, 0), 'lit:g_stone');   // 盒外（x 超 1 格）
    W.set(wkey(10, 73, 10, 0), 'lit:g_stone');   // 盒外（y 超 1 格）

    const r = new ProjectionRenderer({ logger: silentLogger });
    const out = r.sweepGhosts(p, {
        box: { minX: 10, minY: 70, minZ: 10, maxX: 12, maxY: 72, maxZ: 12 },
    });

    assert.strictEqual(out.cleared, 2, `盒内应清 2 个，实际 ${out.cleared}`);
    assert.strictEqual(W.get(wkey(13, 70, 10, 0)), 'lit:g_stone', '盒外不能碰');
    assert.strictEqual(W.get(wkey(10, 73, 10, 0)), 'lit:g_stone', '盒外不能碰');
});

check('radius 被夹到 ≤32（避免一条命令扫爆主线程）', () => {
    reset();
    const p = mkPlayer(0, 64, 0);
    const r = new ProjectionRenderer({ logger: silentLogger });
    const out = r.sweepGhosts(p, { radius: 9999 });
    // 65³ = 274625，全是空气也算 scanned
    assert.strictEqual(out.scanned, 65 * 65 * 65, `实际扫描 ${out.scanned}`);
});

check('没有坐标/玩家 → 返回 error，不抛错', () => {
    reset();
    const r = new ProjectionRenderer({ logger: silentLogger });
    assert.strictEqual(r.sweepGhosts(null, {}).error, 'no-player');
    assert.strictEqual(r.sweepGhosts({}, {}).error, 'no-player');
});

check('维度隔离：只扫目标 dimid', () => {
    reset();
    const p = mkPlayer(0, 64, 0, 1);
    W.set(wkey(0, 64, 0, 0), 'lit:g_stone');   // 主世界
    W.set(wkey(0, 64, 0, 1), 'lit:g_stone');   // 地狱（玩家所在）

    const r = new ProjectionRenderer({ logger: silentLogger });
    const out = r.sweepGhosts(p, { radius: 1 });

    assert.strictEqual(out.cleared, 1);
    assert.strictEqual(W.get(wkey(0, 64, 0, 0)), 'lit:g_stone', '别的维度不能碰');
    assert.strictEqual(W.get(wkey(0, 64, 0, 1)), 'minecraft:air');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
