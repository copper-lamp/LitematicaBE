/**
 * test_ghost_renderer.js — GhostRenderer 离线回归
 *
 * 不依赖 BDS：内存假世界 + 真 WorldSnapshot（落 tmp 目录）+ 真 GhostGuard（判定层）。
 *
 * 覆盖：
 *   1. 整投影入队：32³ 实心 → 5768 格外壳（不是 32768）
 *   2. 分 tick 按预算推进，写完世界就是 ghost 方块
 *   3. 写序铁律：快照 record 在 setBlock 之前；record 失败就绝不写
 *   4. 玩家建筑永不覆盖（protected）
 *   5. 已是 ghost 不重写（skipped）
 *   6. 区块未加载 → pending，之后 retryPending 补上
 *   7. 撤销：先删期望再还原世界（顺序错了 ghost 会自己长回来）
 *   8. 按层写：切层先撤旧层再铺新层
 *   9. 写入总闸 / 单投影上限 / 空投影
 *  10. 多玩家预算均分
 *  11. transformPosition 旋转 / 镜像
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');
const { GhostRenderer, transformPosition } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostRenderer.js'));
const { GhostGuard } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostGuard.js'));
const { WorldSnapshot } = require(path.join(PLUGIN, 'src', 'world', 'WorldSnapshot.js'));

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

// ── 假世界 ──────────────────────────────────────────────
const W = new Map();               // "d:x,y,z" -> {type,tileData}
const UNLOADED = new Set();        // 模拟未加载的区块格
const wkey = (x, y, z, d) => `${d}:${x},${y},${z}`;

global.mc = {
    listen() { return true; },
    getBlock(x, y, z, d) {
        const k = wkey(x, y, z, d);
        if (UNLOADED.has(k)) return null;                 // 区块未加载
        const v = W.get(k);
        if (!v) return { type: 'minecraft:air', tileData: 0, pos: { x, y, z, dimid: d } };
        return { type: v.type, tileData: v.tileData, pos: { x, y, z, dimid: d } };
    },
    setBlock(x, y, z, d, type, data) {
        const k = wkey(x, y, z, d);
        if (UNLOADED.has(k)) return false;
        W.set(k, { type, tileData: data || 0 });
        return true;
    },
    getPlayer() { return null; },
};
global.logger = silentLogger;

let CALLS = [];

function makeHarness(opts) {
    const o = opts || {};
    W.clear(); UNLOADED.clear(); CALLS = [];

    const registry = {
        ready: true,
        genericId: 'lit:g_generic',
        isGhost: (t) => typeof t === 'string' && t.startsWith('lit:g_'),
        resolve: () => 'lit:g_stone',
    };

    const expectMap = new Map();
    const expectStore = {
        set(d, x, y, z, gid) { CALLS.push('expect.set'); expectMap.set(wkey(x, y, z, d), { ghostId: gid }); },
        del(d, x, y, z) { CALLS.push('expect.del'); expectMap.delete(wkey(x, y, z, d)); },
        get(d, x, y, z) { return expectMap.get(wkey(x, y, z, d)) || null; },
        count() { return expectMap.size; },
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostrender-'));
    const snapshot = new WorldSnapshot({
        dataDir: tmpDir,
        logger: silentLogger,
        isGhost: registry.isGhost,
    });
    const realClose = snapshot.close.bind(snapshot);
    snapshot.close = (...args) => { CALLS.push('snapshot.close'); return realClose(...args); };

    const guard = new GhostGuard(registry);
    const addonCheck = { isEnabled: () => o.gate !== false };

    const gr = new GhostRenderer({
        registry,
        expectStore,
        addonCheck,
        snapshot,
        guard,
        logger: silentLogger,
        writesPerTick: o.writesPerTick || 1000,
        maxBlocks: o.maxBlocks || 60000,
        retryBatch: 10000,
        overwriteReplaceable: o.overwriteReplaceable !== false,
    });

    return { gr, registry, expectStore, expectMap, snapshot, guard, tmpDir, W };
}

const mkPlayer = (xuid = 'P1', name = 'Steve') => ({ xuid, name, pos: { x: 0, y: 64, z: 0, dimid: 0 } });

function solidProjection(size, opts) {
    const o = opts || {};
    const blocks = [];
    for (let x = 0; x < size; x++)
        for (let y = 0; y < size; y++)
            for (let z = 0; z < size; z++) blocks.push({ pos: [x, y, z], name: o.name || 'minecraft:stone' });
    return {
        id: o.id || 'proj-1',
        name: o.name || '测试投影',
        dimensions: { x: size, y: size, z: size },
        position: o.position || { x: 0, y: 64, z: 0 },
        rotation: 0, mirrorX: false, mirrorZ: false,
        blocks,
    };
}

function drain(gr, budget = 1000, maxTicks = 5000) {
    let ticks = 0;
    while (ticks < maxTicks) {
        ticks++;
        let any = false;
        for (const s of gr.sessions.values()) {
            if (s.state === 'building' && s.cursor < s.queue.length) { any = true; break; }
        }
        if (!any) break;
        gr.tick(budget);
    }
    return ticks;
}

let pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) { console.log(`  ❌ ${name}`); console.log(`     ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n     ') : e}`); fail++; }
}

console.log('\n=== GhostRenderer ===');

check('transformPosition：原点平移 / 旋转 / 镜像', () => {
    const base = { dimensions: { x: 4, y: 8, z: 6 }, position: { x: 10, y: 64, z: 20 }, rotation: 0 };
    assert.deepStrictEqual(transformPosition([1, 2, 3], base), { x: 11, y: 66, z: 23 });

    const rot90 = { ...base, rotation: 90 };
    // nx = z = 3, nz = dims.x - x - 1 = 4 - 1 - 1 = 2
    assert.deepStrictEqual(transformPosition([1, 2, 3], rot90), { x: 13, y: 66, z: 22 });

    const mirror = { ...base, mirrorX: true };
    // x = dims.x - x - 1 = 2
    assert.deepStrictEqual(transformPosition([1, 2, 3], mirror), { x: 12, y: 66, z: 23 });
});

check('32³ 实心 → 入队 5768 格（外壳），不是 32768', () => {
    const h = makeHarness();
    const r = h.gr.enqueue(mkPlayer(), solidProjection(32));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.count, 5768);
    assert.strictEqual(h.gr.sessions.get('P1').queue.length, 5768);
    // 队列里的世界坐标已按 position 平移
    assert.ok(h.gr.sessions.get('P1').queue.every(e => e.y >= 64 && e.y < 96));
    assert.ok(h.gr.sessions.get('P1').queue.every(e => e.gid === 'lit:g_stone'));
});

check('分 tick 写完：世界 = ghost，快照 = 5768 格，期望 = 5768 格', () => {
    const h = makeHarness();
    h.gr.enqueue(mkPlayer(), solidProjection(32));
    const ticks = drain(h.gr, 1000);
    console.log(`     5768 格 / 每 tick 1000 → ${ticks} tick`);

    const ghosts = [...W.values()].filter(v => v.type === 'lit:g_stone').length;
    assert.strictEqual(ghosts, 5768);
    assert.strictEqual(h.snapshot.size(h.gr.sessions.get('P1').sessionId), 5768);
    assert.strictEqual(h.expectStore.count(), 5768);
    assert.strictEqual(h.gr.sessions.get('P1').state, 'done');
});

check('写序：每一格都是 record 先于 setBlock', () => {
    const h = makeHarness();
    // 包一层 setBlock，检查当时快照里已经有这一格
    const session = { id: null };
    const origSet = mc.setBlock;
    let checked = 0, bad = 0;
    mc.setBlock = (x, y, z, d, type, data) => {
        const s = h.gr.sessions.get('P1');
        if (s && s.sessionId && type.startsWith('lit:g_')) {
            checked++;
            if (!h.snapshot.get(s.sessionId, x, y, z)) bad++;
        }
        return origSet(x, y, z, d, type, data);
    };
    h.gr.enqueue(mkPlayer(), solidProjection(8));
    drain(h.gr, 1000);
    mc.setBlock = origSet;
    assert.ok(checked > 0, '应至少写过一格');
    assert.strictEqual(bad, 0, `有 ${bad} 格在写之前没登记快照`);
});

check('record 失败 → 这一格绝不写世界（宁可少显示，不可不可撤销）', () => {
    const h = makeHarness();
    const origRecord = h.snapshot.record.bind(h.snapshot);
    h.snapshot.record = () => { throw new Error('磁盘满了'); };
    h.gr.enqueue(mkPlayer(), solidProjection(4));
    drain(h.gr, 1000);
    h.snapshot.record = origRecord;
    assert.strictEqual([...W.values()].filter(v => v.type === 'lit:g_stone').length, 0, 'record 失败却写了世界');
    assert.ok(h.gr.sessions.get('P1').pending.length > 0, '失败的格应进 pending');
});

check('玩家建筑永不覆盖（protected）', () => {
    const h = makeHarness();
    // 投影外壳角 (0,64,0) 上放一块钻石块
    W.set(wkey(0, 64, 0, 0), { type: 'minecraft:diamond_block', tileData: 0 });
    h.gr.enqueue(mkPlayer(), solidProjection(8));
    drain(h.gr, 1000);
    assert.strictEqual(W.get(wkey(0, 64, 0, 0)).type, 'minecraft:diamond_block');
    assert.ok(h.gr.sessions.get('P1').counters.protected >= 1);
    assert.strictEqual(h.expectStore.get(0, 0, 64, 0), null, '被保护的格不该进期望集合');
});

check('花草/水这类可替换方块允许覆盖', () => {
    const h = makeHarness();
    W.set(wkey(0, 64, 0, 0), { type: 'minecraft:short_grass', tileData: 0 });
    h.gr.enqueue(mkPlayer(), solidProjection(8));
    drain(h.gr, 1000);
    assert.strictEqual(W.get(wkey(0, 64, 0, 0)).type, 'lit:g_stone');
});

check('已是 ghost 的格不重写（skipped，且不重复登记快照）', () => {
    const h = makeHarness();
    W.set(wkey(0, 64, 0, 0), { type: 'lit:g_stone', tileData: 0 });
    h.gr.enqueue(mkPlayer(), solidProjection(8));
    drain(h.gr, 1000);
    const rec = h.snapshot.get(h.gr.sessions.get('P1').sessionId, 0, 64, 0);
    assert.strictEqual(rec, null, '已有 ghost 的格不该被登记为"原方块"');
    assert.ok(h.gr.sessions.get('P1').counters.skippedGhost >= 1);
});

check('区块未加载 → pending；加载后 retryPending 补上', () => {
    const h = makeHarness();
    UNLOADED.add(wkey(0, 64, 0, 0));
    h.gr.enqueue(mkPlayer(), solidProjection(8));
    drain(h.gr, 1000);

    const s = h.gr.sessions.get('P1');
    assert.strictEqual(W.has(wkey(0, 64, 0, 0)), false, '未加载格不该被写');
    assert.strictEqual(s.pending.length, 1);

    UNLOADED.delete(wkey(0, 64, 0, 0));
    const r = h.gr.retryPending();
    assert.strictEqual(r.placed, 1);
    assert.strictEqual(W.get(wkey(0, 64, 0, 0)).type, 'lit:g_stone');
    assert.strictEqual(h.gr.sessions.get('P1').pending.length, 0);
});

check('撤销：先删期望再还原世界，世界回到空气', () => {
    const h = makeHarness();
    h.gr.enqueue(mkPlayer(), solidProjection(8));
    drain(h.gr, 1000);
    const ghostsBefore = [...W.values()].filter(v => v.type === 'lit:g_stone').length;
    assert.ok(ghostsBefore > 0);

    CALLS = [];
    const r = h.gr.clear(mkPlayer());

    assert.strictEqual(r.ok, true);
    assert.ok(r.restored > 0);
    assert.strictEqual([...W.values()].filter(v => v.type === 'lit:g_stone').length, 0, '撤销后世界不该残留 ghost');
    assert.strictEqual(h.expectStore.count(), 0);

    const firstDel = CALLS.indexOf('expect.del');
    const firstClose = CALLS.indexOf('snapshot.close');
    assert.ok(firstDel >= 0 && firstClose >= 0);
    assert.ok(firstDel < firstClose, `期望必须先删（del@${firstDel} / close@${firstClose}）`);
    assert.strictEqual(h.gr.has('P1'), false);
});

check('撤销时不碰玩家自己放的方块', () => {
    const h = makeHarness();
    h.gr.enqueue(mkPlayer(), solidProjection(8));
    drain(h.gr, 1000);
    // 玩家在 ghost 上盖了钻石块（ghost 被 replaceable 顶掉）
    W.set(wkey(0, 64, 0, 0), { type: 'minecraft:diamond_block', tileData: 0 });
    const r = h.gr.clear(mkPlayer());
    assert.strictEqual(W.get(wkey(0, 64, 0, 0)).type, 'minecraft:diamond_block');
    assert.ok(r.kept >= 1);
});

check('按层写：切层先撤旧层，世界只剩新层', () => {
    const h = makeHarness();
    const proj = solidProjection(16);
    h.gr.enqueue(mkPlayer(), proj);
    drain(h.gr, 1000);
    assert.strictEqual(h.gr.sessions.get('P1').layer, -1);

    const r = h.gr.setLayer(mkPlayer(), proj, 5);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.count, 16 * 16, '整层 256 格');
    drain(h.gr, 1000);

    const ys = new Set([...W.entries()]
        .filter(([, v]) => v.type === 'lit:g_stone')
        .map(([k]) => +k.split(':')[1].split(',')[1]));
    assert.deepStrictEqual([...ys], [69], '只剩 y=69 那一层（64+5）');
    assert.strictEqual(h.expectStore.count(), 256);
});

check('同层重复 setLayer 不做无谓写入', () => {
    const h = makeHarness();
    const proj = solidProjection(8);
    h.gr.setLayer(mkPlayer(), proj, 2);
    drain(h.gr, 1000);
    const r = h.gr.setLayer(mkPlayer(), proj, 2);
    assert.strictEqual(r.unchanged, true);
});

check('写入总闸关闭 → 拒绝入队', () => {
    const h = makeHarness({ gate: false });
    const r = h.gr.enqueue(mkPlayer(), solidProjection(8));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'writegate');
    assert.strictEqual(W.size, 0);
});

check('单投影上限：超限直接拒绝，不写一格', () => {
    const h = makeHarness({ maxBlocks: 10 });
    const r = h.gr.enqueue(mkPlayer(), solidProjection(8));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'too-many');
    assert.ok(r.count > 10);
    assert.strictEqual(W.size, 0);
});

check('空投影 → empty', () => {
    const h = makeHarness();
    const r = h.gr.enqueue(mkPlayer(), { id: 'e', name: '空', dimensions: { x: 0, y: 0, z: 0 }, position: { x: 0, y: 0, z: 0 }, blocks: [] });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'empty');
});

check('多玩家：预算均分，互不饿死', () => {
    const h = makeHarness();
    const p1 = mkPlayer('P1', 'A');
    const p2 = mkPlayer('P2', 'B');
    p2.pos.dimid = 0;
    h.gr.enqueue(p1, solidProjection(8, { id: 'a', position: { x: 0, y: 64, z: 0 } }));
    h.gr.enqueue(p2, solidProjection(8, { id: 'b', position: { x: 200, y: 64, z: 0 } }));
    const r = h.gr.tick(10);
    assert.strictEqual(h.gr.sessions.get('P1').cursor, 5);
    assert.strictEqual(h.gr.sessions.get('P2').cursor, 5);
    assert.strictEqual(r.written, 10);
});

check('重复 enqueue 同一玩家：旧会话先撤，不混进同一份快照', () => {
    const h = makeHarness();
    const p = mkPlayer();
    h.gr.enqueue(p, solidProjection(8, { id: 'first', name: '第一' }));
    drain(h.gr, 1000);
    h.gr.enqueue(p, solidProjection(6, { id: 'second', name: '第二' }));
    drain(h.gr, 1000);
    assert.strictEqual(h.gr.sessions.get('P1').projectionId, 'second');
    // 第二份快照的格数应等于第二份外壳格数（6³ - 4³ = 216 - 64 = 152）
    assert.strictEqual(h.snapshot.size(h.gr.sessions.get('P1').sessionId), 152);
});

check('markSatisfied：打印机填好某格后销掉 blocked 账，且不再被 retryBlocked 空转', () => {
    const h = makeHarness();
    const p = mkPlayer();
    // 角块 (0,0,0) 是外壳的一部分；先在那儿放玩家建筑 → 写 ghost 时判 protected
    W.set(wkey(0, 64, 0, 0), { type: 'minecraft:oak_planks', tileData: 0 });
    h.gr.enqueue(p, solidProjection(8));
    drain(h.gr, 1000);

    const s = h.gr.sessions.get('P1');
    assert.ok(s.blocked.length > 0, '被玩家建筑挡住的格应进 blocked');
    assert.ok(h.gr.blockedIndex.has('0:0,64,0'), 'blocked 索引应能 O(1) 命中');

    const ok = h.gr.markSatisfied('P1', 0, 0, 64, 0);
    assert.strictEqual(ok, true);
    assert.strictEqual(h.gr.blockedIndex.has('0:0,64,0'), false, 'blockedIndex 必须清掉');
    assert.strictEqual(s.blocked.some((e) => e.x === 0 && e.y === 64 && e.z === 0), false, 'blocked 列表必须清掉');

    // 已对账的格不应再被轮转重试
    const before = s.blocked.length;
    h.gr.retryBlocked(10000);
    assert.strictEqual(s.blocked.filter((e) => e.x === 0 && e.y === 64 && e.z === 0).length, 0);
    assert.ok(s.blocked.length <= before);
});

check('markSatisfied：也能销掉 pending（区块未加载）的账', () => {
    const h = makeHarness();
    const p = mkPlayer();
    UNLOADED.add(wkey(0, 64, 0, 0));
    h.gr.enqueue(p, solidProjection(8));
    drain(h.gr, 1000);

    const s = h.gr.sessions.get('P1');
    assert.ok(s.pending.length > 0, '未加载的格应进 pending');
    assert.strictEqual(h.gr.markSatisfied('P1', 0, 0, 64, 0), true);
    assert.strictEqual(s.pending.some((e) => e.x === 0 && e.y === 64 && e.z === 0), false);
});

check('summary() 可供命令面板读取', () => {
    const h = makeHarness();
    h.gr.enqueue(mkPlayer(), solidProjection(8));
    const s = h.gr.summary();
    assert.strictEqual(s.sessions, 1);
    assert.ok(s.queued > 0);
    assert.strictEqual(s.list[0].name, '测试投影');
    assert.strictEqual(typeof s.counters.placed, 'number');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
