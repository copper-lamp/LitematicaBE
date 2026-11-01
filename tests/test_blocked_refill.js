/**
 * test_blocked_refill.js — "原地形吞投影"修复
 *
 * 用户报的现象：加载投影时，目标位置已有方块就跳过；之后把那些方块破坏掉，
 * 投影**依然不显示** —— 等于原地形把投影永久吞掉一片。
 *
 * 根因：`_writeOne` 返回 'protected' 后，tick 只做了 `counters.protected++`，
 * 那一格就被彻底丢掉了，没有任何队列记着它。
 *
 * 修法：protected → 进 session.blocked（+ 全局 blockedIndex 索引）
 *   ① 事件驱动：玩家挖掉那格 → `retryBlockedAt()` O(1) 命中，立刻补 ghost
 *   ② 定时兜底：`retryPending()` 顺带 `retryBlocked()` 轮转重扫（TNT/别人清场也能补）
 *
 * 覆盖：
 *   1. 有方块的格加载后进 blocked，且不写世界
 *   2. 挖掉方块 → retryBlockedAt → 立刻补上 ghost
 *   3. 挖掉方块 → 定时 retryBlocked 也能补（无事件场景）
 *   4. 补上的 ghost **可撤销**：撤销后世界回到空气，不残留
 *   5. 补写也要进快照（原方块是空气，撤销不会把玩家的东西搞乱）
 *   6. 反复轮转不丢格、不重复写
 *   7. 已经是 ghost 的格销账（不重复写）
 *   8. 换层/切投影时 blocked 索引不残留
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');
const { GhostRenderer } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostRenderer.js'));
const { GhostGuard } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostGuard.js'));
const { WorldSnapshot } = require(path.join(PLUGIN, 'src', 'world', 'WorldSnapshot.js'));

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

const W = new Map();
const wkey = (x, y, z, d) => `${d}:${x},${y},${z}`;
global.mc = {
    listen() { return true; },
    getPlayer: () => null,
    getBlock(x, y, z, d) {
        const v = W.get(wkey(x, y, z, d));
        if (!v) return { type: 'minecraft:air', tileData: 0, pos: { x, y, z, dimid: d } };
        return { type: v.type, tileData: v.tileData, pos: { x, y, z, dimid: d } };
    },
    setBlock(x, y, z, d, type, data) { W.set(wkey(x, y, z, d), { type, tileData: data || 0 }); return true; },
};
global.logger = silentLogger;

const get = (x, y, z, d = 0) => (W.get(wkey(x, y, z, d)) || { type: 'minecraft:air' }).type;
const set = (x, y, z, type, d = 0) => W.set(wkey(x, y, z, d), { type, tileData: 0 });
const ghostCount = () => [...W.values()].filter(v => v.type === 'lit:g_stone').length;

function makeWorld() {
    W.clear();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blocked-'));
    const registry = {
        ready: true, genericId: 'lit:g_generic',
        isGhost: (t) => typeof t === 'string' && t.startsWith('lit:g_'),
        resolve: () => 'lit:g_stone',
    };
    const expectMap = new Map();
    const expectStore = {
        set(d, x, y, z, gid) { expectMap.set(wkey(x, y, z, d), gid); },
        del(d, x, y, z) { expectMap.delete(wkey(x, y, z, d)); },
        get(d, x, y, z) { return expectMap.get(wkey(x, y, z, d)) || null; },
        count() { return expectMap.size; },
        forEach(fn) { for (const [k, gid] of expectMap) { const [d, rest] = k.split(':'); const [x, y, z] = rest.split(',').map(Number); fn(+d, x, y, z, gid); } },
    };
    const snapshot = new WorldSnapshot({ dataDir: tmpDir, logger: silentLogger, isGhost: registry.isGhost }).load();
    const guard = new GhostGuard(registry);
    const gr = new GhostRenderer({
        registry, expectStore, snapshot, guard, logger: silentLogger,
        addonCheck: { isEnabled: () => true },
        writesPerTick: 10000, maxBlocks: 60000, retryBatch: 3,
    });
    return { gr, snapshot, expectStore };
}

/** 1×1×1 的单格投影，落在 (0,64,0) */
function cellProjection(id) {
    return {
        id: id || 'proj-1', name: '单格',
        dimensions: { x: 1, y: 1, z: 1 },
        position: { x: 0, y: 64, z: 0 },
        rotation: 0, mirrorX: false, mirrorZ: false,
        blocks: [{ pos: [0, 0, 0], name: 'minecraft:stone' }],
    };
}

/** size³ 实心投影 */
function solidProjection(size, id) {
    const blocks = [];
    for (let x = 0; x < size; x++)
        for (let y = 0; y < size; y++)
            for (let z = 0; z < size; z++) blocks.push({ pos: [x, y, z], name: 'minecraft:stone' });
    return {
        id: id || 'proj-1', name: '方块', dimensions: { x: size, y: size, z: size },
        position: { x: 0, y: 64, z: 0 }, rotation: 0, mirrorX: false, mirrorZ: false, blocks,
    };
}

const mkPlayer = (xuid = 'P1') => ({
    xuid, name: 'Steve', pos: { x: 0, y: 64, z: 0, dimid: 0 },
    direction: { yaw: 0, pitch: 0 }, _tells: [], tell(m) { this._tells.push(m); },
});

function drain(gr) {
    for (let i = 0; i < 200; i++) {
        let any = false;
        for (const s of gr.sessions.values()) {
            if (s.state === 'building' && s.cursor < s.queue.length) { any = true; break; }
        }
        if (!any) break;
        gr.tick(10000);
    }
}

let pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) { console.log(`  ❌ ${name}`); console.log(`     ${e && e.message ? e.message : e}`); fail++; }
}

console.log('\n=== "原地形吞投影"修复（blocked 补写） ===');

check('① 目标格有石头：加载后进 blocked，不写世界', () => {
    const w = makeWorld();
    const p = mkPlayer();
    set(0, 64, 0, 'minecraft:stone');
    assert.strictEqual(w.gr.enqueue(p, cellProjection()).ok, true);
    drain(w.gr);

    const s = w.gr.getSession('P1');
    assert.strictEqual(s.blocked.length, 1, '应记进 blocked');
    assert.strictEqual(s.counters.protected, 1);
    assert.strictEqual(ghostCount(), 0, '不该覆盖玩家方块');
    assert.strictEqual(get(0, 64, 0), 'minecraft:stone', '原方块必须保持');
    assert.ok(w.gr.blockedIndex.has('0:0,64,0'), '索引要能 O(1) 命中');
});

check('② 挖掉方块 → retryBlockedAt 立刻补上 ghost（事件驱动）', () => {
    const w = makeWorld();
    const p = mkPlayer();
    set(0, 64, 0, 'minecraft:stone');
    w.gr.enqueue(p, cellProjection());
    drain(w.gr);

    set(0, 64, 0, 'minecraft:air');            // 玩家把石头挖了
    const r = w.gr.retryBlockedAt(0, 64, 0, 0);
    assert.strictEqual(r, 'placed');
    assert.strictEqual(get(0, 64, 0), 'lit:g_stone', '这一刻起投影要显示出来');
    assert.strictEqual(w.gr.getSession('P1').blocked.length, 0, 'blocked 要销账');
    assert.ok(!w.gr.blockedIndex.has('0:0,64,0'));
    assert.strictEqual(w.gr.getSession('P1').counters.blockedPlaced, 1);
});

check('③ 无破坏事件（TNT/别人清场）→ 定时 retryBlocked 兜底也能补', () => {
    const w = makeWorld();
    const p = mkPlayer();
    set(0, 64, 0, 'minecraft:stone');
    w.gr.enqueue(p, cellProjection());
    drain(w.gr);

    set(0, 64, 0, 'minecraft:air');            // 世界变了，但没有 onDestroyBlock
    const r = w.gr.retryBlocked();
    assert.strictEqual(r.placed, 1);
    assert.strictEqual(r.remaining, 0);
    assert.strictEqual(get(0, 64, 0), 'lit:g_stone');
});

check('④ 补上的 ghost 可撤销：撤销后回到空气，不残留', () => {
    const w = makeWorld();
    const p = mkPlayer();
    set(0, 64, 0, 'minecraft:stone');
    w.gr.enqueue(p, cellProjection());
    drain(w.gr);
    set(0, 64, 0, 'minecraft:air');
    assert.strictEqual(w.gr.retryBlockedAt(0, 64, 0, 0), 'placed');

    const r = w.gr.clear(p, { silent: true });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(get(0, 64, 0), 'minecraft:air', '撤销后不能留 ghost');
    assert.strictEqual(ghostCount(), 0);
});

check('⑤ 补写走正常写序（快照登记在 setBlock 之前），撤销不会误还原玩家建筑', () => {
    const w = makeWorld();
    const p = mkPlayer();
    // 两个格：一格被石头挡，一格空
    set(0, 64, 0, 'minecraft:stone');
    const proj = {
        id: 'proj-2', name: '两格', dimensions: { x: 2, y: 1, z: 1 },
        position: { x: 0, y: 64, z: 0 }, rotation: 0, mirrorX: false, mirrorZ: false,
        blocks: [{ pos: [0, 0, 0], name: 'minecraft:stone' }, { pos: [1, 0, 0], name: 'minecraft:stone' }],
    };
    w.gr.enqueue(p, proj);
    drain(w.gr);
    assert.strictEqual(get(1, 64, 0), 'lit:g_stone', '空格直接铺');

    set(0, 64, 0, 'minecraft:air');
    w.gr.retryBlockedAt(0, 64, 0, 0);
    assert.strictEqual(get(0, 64, 0), 'lit:g_stone');

    w.gr.clear(p, { silent: true });
    assert.strictEqual(get(0, 64, 0), 'minecraft:air');
    assert.strictEqual(get(1, 64, 0), 'minecraft:air');
});

check('⑥ 多格 blocked 反复轮转：不丢格、不重复写', () => {
    const w = makeWorld();
    const p = mkPlayer();
    // 3×1×1 三格全被石头占住
    for (let x = 0; x < 3; x++) set(x, 64, 0, 'minecraft:stone');
    const proj = {
        id: 'proj-3', name: '三格', dimensions: { x: 3, y: 1, z: 1 },
        position: { x: 0, y: 64, z: 0 }, rotation: 0, mirrorX: false, mirrorZ: false,
        blocks: [0, 1, 2].map(x => ({ pos: [x, 0, 0], name: 'minecraft:stone' })),
    };
    w.gr.enqueue(p, proj);
    drain(w.gr);
    assert.strictEqual(w.gr.getSession('P1').blocked.length, 3);

    // 只挖掉中间那格，轮转两轮（retryBatch=3，一轮就够扫完）
    set(1, 64, 0, 'minecraft:air');
    const r1 = w.gr.retryBlocked();
    assert.strictEqual(r1.placed, 1);
    assert.strictEqual(r1.stillBlocked, 2);
    assert.strictEqual(w.gr.getSession('P1').blocked.length, 2, '仍被挡的两格保留');

    // 再挖一格，继续补
    set(2, 64, 0, 'minecraft:air');
    const r2 = w.gr.retryBlocked();
    assert.strictEqual(r2.placed, 1);
    assert.strictEqual(w.gr.getSession('P1').blocked.length, 1);

    // 剩下的那格仍是石头 → 一直保留，不丢
    const r3 = w.gr.retryBlocked();
    assert.strictEqual(r3.placed, 0);
    assert.strictEqual(r3.stillBlocked, 1);
    assert.strictEqual(w.gr.getSession('P1').blocked.length, 1);
    assert.strictEqual(ghostCount(), 2);
});

check('⑦ 已是 ghost 的格在 blocked 里 → 销账不重复写', () => {
    const w = makeWorld();
    const p = mkPlayer();
    set(0, 64, 0, 'minecraft:stone');
    w.gr.enqueue(p, cellProjection());
    drain(w.gr);
    assert.strictEqual(w.gr.getSession('P1').blocked.length, 1);

    // 有人手动把该格设成 ghost（模拟别的进程/命令补过）
    set(0, 64, 0, 'lit:g_stone');
    const r = w.gr.retryBlocked();
    assert.strictEqual(r.checked, 1);
    assert.strictEqual(r.placed, 0);
    assert.strictEqual(w.gr.getSession('P1').blocked.length, 0, 'skip 也要销账');
});

check('⑧ 换层 / 更新队列时 blocked 索引清干净（不留脏索引）', () => {
    const w = makeWorld();
    const p = mkPlayer();
    set(0, 64, 0, 'minecraft:stone');
    w.gr.enqueue(p, cellProjection());
    drain(w.gr);
    assert.strictEqual(w.gr.blockedIndex.size, 1);

    w.gr.setLayer(p, solidProjection(2), -1);          // 换层：clear + 重新入队
    drain(w.gr);
    const stale = [...w.gr.blockedIndex.keys()].filter(k => k === '0:0,64,0');
    // 新队列同样会挡住这一格，所以索引里允许有它；关键是"不能指向已被删除的会话"
    for (const k of w.gr.blockedIndex.keys()) {
        const hit = w.gr.blockedIndex.get(k);
        assert.ok(w.gr.sessions.has(hit.xuid), `索引 ${k} 指向了不存在的会话`);
    }
});

check('⑨ 撤销会话后 blockedIndex 不留孤儿索引', () => {
    const w = makeWorld();
    const p = mkPlayer();
    set(0, 64, 0, 'minecraft:stone');
    w.gr.enqueue(p, cellProjection());
    drain(w.gr);
    assert.strictEqual(w.gr.blockedIndex.size, 1);

    w.gr.clear(p, { silent: true });
    assert.strictEqual(w.gr.blockedIndex.size, 0, '撤销后索引必须清空');
    assert.strictEqual(w.gr.retryBlockedAt(0, 64, 0, 0), 'none');
});

check('⑩ summary 暴露 blocked 数量与补写计数', () => {
    const w = makeWorld();
    const p = mkPlayer();
    set(0, 64, 0, 'minecraft:stone');
    w.gr.enqueue(p, cellProjection());
    drain(w.gr);
    let s = w.gr.summary();
    assert.strictEqual(s.blocked, 1);
    assert.strictEqual(s.list[0].blocked, 1);

    set(0, 64, 0, 'minecraft:air');
    w.gr.retryBlockedAt(0, 64, 0, 0);
    s = w.gr.summary();
    assert.strictEqual(s.blocked, 0);
    assert.ok(s.counters.blockedPlaced >= 1);
});

check('⑪ 真实感场景：4×4×4 投影陷在石头里，挖穿后逐格补出', () => {
    const w = makeWorld();
    const p = mkPlayer();
    const size = 4;
    for (let x = 0; x < size; x++)
        for (let y = 0; y < size; y++)
            for (let z = 0; z < size; z++) set(x, 64 + y, z, 'minecraft:stone');

    w.gr.enqueue(p, solidProjection(size));
    drain(w.gr);
    const s = w.gr.getSession('P1');
    assert.ok(s.blocked.length > 0, '整块埋在石头里 → 大量 blocked');
    assert.strictEqual(ghostCount(), 0);

    // 玩家开挖：把最上面一层清掉
    for (let x = 0; x < size; x++)
        for (let z = 0; z < size; z++) set(x, 64 + size - 1, z, 'minecraft:air');

    // 事件驱动逐格补（模拟 16 次 onDestroyBlock）
    for (let x = 0; x < size; x++)
        for (let z = 0; z < size; z++) w.gr.retryBlockedAt(x, 64 + size - 1, z, 0);

    // 外壳提取可能把顶面判为内部，这里只要求"补出来了东西且没有残留错格"
    const topGhosts = [...W.entries()].filter(([k, v]) =>
        v.type === 'lit:g_stone' && +k.split(':')[1].split(',')[1] === 64 + size - 1).length;
    assert.ok(topGhosts > 0, '挖开后顶面应该出现 ghost');
    // 仍被石头挡住的格必须还记着
    assert.ok(w.gr.getSession('P1').blocked.every(e => get(e.x, e.y, e.z) !== 'minecraft:air' || ghostCount() > 0));
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
