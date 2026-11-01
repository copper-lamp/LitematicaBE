/**
 * test_mega_orphan.js — MEGA 投影「强退/重启后 ghost 永久残留」的回归
 *
 * 事故：服务器带着 MEGA 投影强退，重启后世界里的 ghost 还在、期望账本还认着它们，
 *       但 MEGA 的注入状态（MegaProjectionRenderer.renderStates）只活在内存里，
 *       重启后没有任何东西能接管 → 玩家进服看不到"已加载"，也没有会话可撤销 → 永久残留。
 *
 * 修法：快照落盘时给 MEGA 会话打 meta.mega 标记；启动时先删这些格的期望记录，
 *       再让 restoreOrphaned 对它们**无条件还原**（普通投影仍保持"保留 + 补齐"语义）。
 *
 * 本测试模拟两段进程：
 *   进程 1：建 MEGA 会话 → 写世界 → persist → 直接丢弃（= 强退，不 close/revert）
 *   进程 2：从磁盘 load → 按 index.js 的启动清理流程走一遍 → 世界必须干净
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');
const { GhostRenderer } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostRenderer.js'));
const { GhostGuard } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostGuard.js'));
const { WorldSnapshot } = require(path.join(PLUGIN, 'src', 'world', 'WorldSnapshot.js'));
const { ProjectionRenderer } = require(path.join(PLUGIN, 'src', 'render', 'ProjectionRenderer.js'));
const { normalizeProjection, isMegaProjection } = require(path.join(PLUGIN, 'src', 'data', 'projectionFlags.js'));

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

// ── 假世界（跨"进程"共享：世界数据是落盘的，重启后 ghost 还在）─────────
const W = new Map();
const wkey = (x, y, z, d) => `${d}:${x},${y},${z}`;
let PLAYER = null;

global.mc = {
    listen() { return true; },
    getBlock(x, y, z, d) {
        const v = W.get(wkey(x, y, z, d));
        if (!v) return { type: 'minecraft:air', tileData: 0, pos: { x, y, z, dimid: d } };
        return { type: v.type, tileData: v.tileData, pos: { x, y, z, dimid: d } };
    },
    setBlock(x, y, z, d, type, data) {
        W.set(wkey(x, y, z, d), { type, tileData: data || 0 });
        return true;
    },
    getPlayer(xuid) { return (PLAYER && PLAYER.xuid === xuid) ? PLAYER : null; },
};
global.logger = silentLogger;

function mkPlayer(xuid = 'P1') {
    const said = [];
    return { xuid, name: 'Steve', pos: { x: 0, y: 64, z: 0, dimid: 0 }, said, tell(m) { said.push(m); } };
}

const registry = {
    ready: true,
    isGhost: (t) => typeof t === 'string' && t.startsWith('lit:g_'),
    resolve: () => 'lit:g_stone',
};

/** 内存期望账本（跨进程复用同一个 Map 对象，模拟落盘后重启仍在） */
function mkExpect(store) {
    const m = store || new Map();
    return {
        map: m,
        set(d, x, y, z, gid) { m.set(wkey(x, y, z, d), gid); },
        del(d, x, y, z) { m.delete(wkey(x, y, z, d)); },
        get(d, x, y, z) { return m.get(wkey(x, y, z, d)) || null; },
        count() { return m.size; },
        flush() { return true; },
    };
}

function mkRenderer(snapshot, expect) {
    return new GhostRenderer({
        registry,
        expectStore: expect,
        addonCheck: { isEnabled: () => true },
        snapshot,
        guard: new GhostGuard(registry),
        logger: silentLogger,
        writesPerTick: 1000,
        maxBlocks: 60000,
        retryBatch: 10000,
        overwriteReplaceable: true,
    });
}

const MEGA_PROJ = {
    id: 'proj-mega', name: '超大投影', isMega: true, schematicId: 's1',
    blocks: [], totalBlocks: 2,
    dimensions: { x: 8, y: 8, z: 8 }, position: { x: 100, y: 64, z: 100 },
    rotation: 0, mirrorX: false, mirrorZ: false,
};

const NORMAL_PROJ = {
    id: 'proj-normal', name: '普通投影', isMega: false,
    blocks: [{ pos: [1, 2, 3], name: 'minecraft:stone', state: {} }],
    totalBlocks: 1,
    dimensions: { x: 8, y: 8, z: 8 }, position: { x: 200, y: 64, z: 200 },
    rotation: 0, mirrorX: false, mirrorZ: false,
};

function ghosts() {
    const out = [];
    for (const [k, v] of W) if (v && v.type && String(v.type).startsWith('lit:g_')) out.push(k);
    return out.sort();
}

function tmpDir(tag) {
    return fs.mkdtempSync(path.join(os.tmpdir(), `megaorphan-${tag}-`));
}

/** 按 index.js onServerStarted 里的真实顺序清理（先删期望，再无条件还原 MEGA） */
function bootCleanup(snapshot, expect, guard) {
    const dropped = snapshot.forEachSessionBlock(
        (s) => WorldSnapshot.isMegaSession(s),
        (dimid, x, y, z) => { expect.del(dimid, x, y, z); if (guard) guard.forget(dimid, x, y, z); }
    );
    const sr = snapshot.restoreOrphaned({
        restoreMega: true,
        shouldRestore: (dimid, x, y, z) => !expect.get(dimid, x, y, z),
    });
    return { dropped, sr };
}

let pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) {
        console.log(`  ❌ ${name}`);
        console.log(`     ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n     ') : e}`);
        fail++;
    }
}

console.log('\n=== MEGA 强退残留清理 ===');

check('MEGA 会话的快照带 mega 标记，重启后能读回来', () => {
    W.clear();
    PLAYER = mkPlayer();
    const dir = tmpDir('meta');
    const expect = mkExpect();
    const snap1 = new WorldSnapshot({ dataDir: dir, logger: silentLogger, isGhost: registry.isGhost });
    const gr1 = mkRenderer(snap1, expect);

    const r = gr1.enqueue(PLAYER, MEGA_PROJ, { deferBlocks: true });
    assert.strictEqual(r.ok, true);
    gr1.appendBlocks('P1', [{ pos: [1, 2, 3] }, { pos: [2, 2, 3] }]);
    gr1.tick(1000);
    assert.strictEqual(ghosts().length, 2, '世界应出现 2 格 ghost');
    assert.strictEqual(expect.count(), 2, '期望账本应有 2 格');

    const sid = gr1.sessions.get('P1').sessionId;
    assert.strictEqual(snap1.persist(sid), true);
    // 强退：不 close、不 revert，直接把对象丢掉

    const snap2 = new WorldSnapshot({ dataDir: dir, logger: silentLogger, isGhost: registry.isGhost }).load();
    assert.strictEqual(snap2.sessions.size, 1, '应载入 1 个未还原会话');
    const s = snap2.sessions.get(sid);
    assert.ok(s, '会话 id 应保持不变');
    assert.strictEqual(WorldSnapshot.isMegaSession(s), true, 'meta.mega 必须落盘并读回');
    assert.strictEqual(s.blocks.size, 2);
});

check('启动清理：MEGA 残留被无条件还原（即使期望账本还认着）', () => {
    W.clear();
    PLAYER = mkPlayer();
    const dir = tmpDir('clean');
    const expectMap = new Map();
    const expect1 = mkExpect(expectMap);
    const guard1 = new GhostGuard(registry);
    const snap1 = new WorldSnapshot({ dataDir: dir, logger: silentLogger, isGhost: registry.isGhost });
    const gr1 = mkRenderer(snap1, expect1);

    gr1.enqueue(PLAYER, MEGA_PROJ, { deferBlocks: true });
    gr1.appendBlocks('P1', [{ pos: [1, 2, 3] }, { pos: [2, 2, 3] }]);
    gr1.tick(1000);
    snap1.persist(gr1.sessions.get('P1').sessionId);
    assert.strictEqual(ghosts().length, 2);

    // ── 重启 ──
    const expect2 = mkExpect(expectMap);          // 期望账本从磁盘读回：仍是 2 格
    assert.strictEqual(expect2.count(), 2);
    const snap2 = new WorldSnapshot({ dataDir: dir, logger: silentLogger, isGhost: registry.isGhost }).load();
    const { dropped, sr } = bootCleanup(snap2, expect2, guard1);

    assert.strictEqual(dropped, 2, '应清掉 2 格期望');
    assert.strictEqual(expect2.count(), 0, '期望账本必须清空（否则 GhostGuard 会补回来）');
    assert.strictEqual(sr.restored, 2, '世界格应被还原');
    assert.strictEqual(sr.held, 0, 'MEGA 会话不允许 held');
    assert.strictEqual(ghosts().length, 0, '世界必须干净，不能留 ghost');
    assert.strictEqual(snap2.sessions.size, 0, '会话应已销毁');
    assert.deepStrictEqual(fs.readdirSync(dir).filter(f => f.endsWith('.json')), [], '快照文件应已删除');
});

check('对照：普通投影（非 MEGA）保持旧语义 —— 期望仍认的格 held，不还原', () => {
    W.clear();
    PLAYER = mkPlayer();
    const dir = tmpDir('normal');
    const expectMap = new Map();
    const expect1 = mkExpect(expectMap);
    const guard1 = new GhostGuard(registry);
    const snap1 = new WorldSnapshot({ dataDir: dir, logger: silentLogger, isGhost: registry.isGhost });
    const gr1 = mkRenderer(snap1, expect1);

    const r = gr1.enqueue(PLAYER, NORMAL_PROJ, { layer: -1 });
    assert.strictEqual(r.ok, true, '普通投影应能铺设');
    gr1.tick(1000);
    assert.strictEqual(ghosts().length, 1);
    const sid = gr1.sessions.get('P1').sessionId;
    snap1.persist(sid);

    const snap2 = new WorldSnapshot({ dataDir: dir, logger: silentLogger, isGhost: registry.isGhost }).load();
    const s = snap2.sessions.get(sid);
    assert.strictEqual(WorldSnapshot.isMegaSession(s), false, '普通会话不能带 mega 标记');

    const expect2 = mkExpect(expectMap);
    const { dropped, sr } = bootCleanup(snap2, expect2, guard1);
    assert.strictEqual(dropped, 0, '普通会话的期望不能被动');
    assert.strictEqual(expectedHold(sr), true, '应有一格被 held（期望仍认 → 重启后要补回，不能拆墙）');
    assert.strictEqual(ghosts().length, 1, 'ghost 必须留在世界里');
});

/** held 或 remaining 任一为真即代表"没还原掉" */
function expectedHold(sr) {
    return sr.held > 0 || sr.remaining > 0;
}

check('reclaimOrphans：不依赖内存会话也能清干净（手动兜底命令走这条）', () => {
    W.clear();
    PLAYER = mkPlayer();
    const dir = tmpDir('reclaim');
    const expectMap = new Map();
    const expect1 = mkExpect(expectMap);
    const snap1 = new WorldSnapshot({ dataDir: dir, logger: silentLogger, isGhost: registry.isGhost });
    const gr1 = mkRenderer(snap1, expect1);

    // 一个 MEGA 会话：写入 → persist → 模拟"会话在内存里丢了"（重启后）
    gr1.enqueue(PLAYER, MEGA_PROJ, { deferBlocks: true });
    gr1.appendBlocks('P1', [{ pos: [1, 2, 3] }, { pos: [2, 2, 3] }]);
    gr1.tick(1000);
    snap1.persist(gr1.sessions.get('P1').sessionId);
    gr1.sessions.delete('P1');                      // 重启后内存会话没了

    const expect2 = mkExpect(expectMap);
    const snap2 = new WorldSnapshot({ dataDir: dir, logger: silentLogger, isGhost: registry.isGhost }).load();

    // 装配 global（reclaimOrphans 从 global 取快照/期望/guard）
    const pr = new ProjectionRenderer({ ghostRenderer: gr1, logger: silentLogger });
    global.worldSnapshot = snap2;
    global.ghostExpect = expect2;
    global.ghostGuard = new GhostGuard(registry);

    assert.strictEqual(ghosts().length, 2);
    const r = pr.reclaimOrphans(PLAYER);
    assert.strictEqual(r.expect, 2);
    assert.strictEqual(r.restored, 2);
    assert.strictEqual(r.remaining, 0);
    assert.strictEqual(expect2.count(), 0);
    assert.strictEqual(ghosts().length, 0, '世界必须干净');

    // 再跑一次：应该是空操作（幂等）
    const again = pr.reclaimOrphans(null);
    assert.strictEqual(again.expect, 0);
    assert.strictEqual(again.restored, 0);
});

check('reclaimOrphans：跳过内存里还活着的会话（不误伤别人的投影）', () => {
    W.clear();
    PLAYER = mkPlayer();
    const dir = tmpDir('live');
    const expect = mkExpect();
    const snap = new WorldSnapshot({ dataDir: dir, logger: silentLogger, isGhost: registry.isGhost });
    const gr = mkRenderer(snap, expect);
    gr.enqueue(PLAYER, MEGA_PROJ, { deferBlocks: true });
    gr.appendBlocks('P1', [{ pos: [1, 2, 3] }]);
    gr.tick(1000);
    snap.persist(gr.sessions.get('P1').sessionId);
    assert.strictEqual(ghosts().length, 1);

    const pr = new ProjectionRenderer({ ghostRenderer: gr, logger: silentLogger });
    global.worldSnapshot = snap;
    global.ghostExpect = expect;
    global.ghostGuard = new GhostGuard(registry);

    const r = pr.reclaimOrphans(null);
    assert.strictEqual(r.skippedSessions, 1, '活跃会话应被跳过');
    assert.strictEqual(expect.count(), 1, '活跃会话的期望不能删');
    assert.strictEqual(ghosts().length, 1, '活跃会话的 ghost 不能被还原');
});

check('clearPlayerProjection：会话已丢时"清除"也能真的清干净世界', () => {
    W.clear();
    PLAYER = mkPlayer();
    const dir = tmpDir('clear');
    const expect = mkExpect();
    const snap1 = new WorldSnapshot({ dataDir: dir, logger: silentLogger, isGhost: registry.isGhost });
    const gr1 = mkRenderer(snap1, expect);

    gr1.enqueue(PLAYER, MEGA_PROJ, { deferBlocks: true });
    gr1.appendBlocks('P1', [{ pos: [1, 2, 3] }, { pos: [2, 2, 3] }]);
    gr1.tick(1000);
    snap1.persist(gr1.sessions.get('P1').sessionId);
    gr1.sessions.delete('P1');                    // 重启后内存会话没了
    assert.strictEqual(ghosts().length, 2);

    const snap2 = new WorldSnapshot({ dataDir: dir, logger: silentLogger, isGhost: registry.isGhost }).load();
    const pr = new ProjectionRenderer({ ghostRenderer: gr1, logger: silentLogger });
    pr.activeProjections.set('P1', { projection: MEGA_PROJ, layer: -1, count: 2, stats: {}, suspended: true, isMega: true });
    global.worldSnapshot = snap2;
    global.ghostExpect = expect;
    global.ghostGuard = new GhostGuard(registry);

    pr.clearPlayerProjection(PLAYER);
    assert.strictEqual(ghosts().length, 0, '清除后世界必须干净（不能只清 Map）');
    assert.strictEqual(expect.count(), 0);
    assert.strictEqual(snap2.sessions.size, 0);
});

check('reclaimOrphans：传玩家时只清他自己的会话，别人的不动', () => {
    W.clear();
    PLAYER = mkPlayer();
    const dir = tmpDir('own');
    const expect = mkExpect();
    const snap = new WorldSnapshot({ dataDir: dir, logger: silentLogger, isGhost: registry.isGhost });

    // P1 的会话（前缀 proj-P1-）
    const s1 = snap.begin('proj-P1-0-111', 0, { mega: true });
    s1.blocks.set('1,2,3', { x: 1, y: 2, z: 3, type: 'minecraft:air', data: 0, nbt: null });
    // P2 的会话（别人的）
    const s2 = snap.begin('proj-P2-0-222', 0, { mega: true });
    s2.blocks.set('9,9,9', { x: 9, y: 9, z: 9, type: 'minecraft:stone', data: 0, nbt: null });
    W.set(wkey(1, 2, 3, 0), { type: 'lit:g_stone', tileData: 0 });
    W.set(wkey(9, 9, 9, 0), { type: 'lit:g_stone', tileData: 0 });
    expect.set(0, 1, 2, 3, 'lit:g_stone');
    expect.set(0, 9, 9, 9, 'lit:g_stone');

    const pr = new ProjectionRenderer({ ghostRenderer: mkRenderer(snap, expect), logger: silentLogger });
    global.worldSnapshot = snap;
    global.ghostExpect = expect;
    global.ghostGuard = new GhostGuard(registry);

    const r = pr.reclaimOrphans({ xuid: 'P1' });
    assert.strictEqual(r.restored, 1, '只该还原 P1 的 1 格');
    assert.strictEqual(expect.count(), 1, 'P2 的期望必须留着');
    assert.ok(!W.has(wkey(1, 2, 3, 0)) || W.get(wkey(1, 2, 3, 0)).type === 'minecraft:air', 'P1 的格已还原');
    assert.strictEqual(W.get(wkey(9, 9, 9, 0)).type, 'lit:g_stone', 'P2 的格不能被碰');
});

check('record 防呆：读到 ghost 时按空气记，绝不把 ghost 当"原方块"存下来', () => {
    W.clear();
    const dir = tmpDir('poison');
    const snap = new WorldSnapshot({ dataDir: dir, logger: silentLogger, isGhost: registry.isGhost });
    snap.begin('p1', 0);
    snap.record('p1', 1, 2, 3, { type: 'lit:g_stone', tileData: 0 });
    const rec = snap.get('p1', 1, 2, 3);
    assert.ok(rec, '应登记成功');
    assert.strictEqual(rec.type, 'minecraft:air', 'ghost 必须记成空气');
    assert.strictEqual(rec.data, 0);

    // 真方块照常记录
    snap.record('p1', 4, 5, 6, { type: 'minecraft:stone', tileData: 3 });
    assert.strictEqual(snap.get('p1', 4, 5, 6).type, 'minecraft:stone');
    assert.strictEqual(snap.get('p1', 4, 5, 6).data, 3);
});

check('startRender 前自动清掉本人的孤儿快照（否则新会话会把 ghost 记成原状）', () => {
    W.clear();
    PLAYER = mkPlayer();
    const dir = tmpDir('prestart');
    const expect = mkExpect();
    const snap = new WorldSnapshot({ dataDir: dir, logger: silentLogger, isGhost: registry.isGhost });
    const gr = mkRenderer(snap, expect);

    // 造一个孤儿：会话被持久化后内存里丢失，世界里留着 ghost
    const orphan = snap.begin('proj-P1-0-1793443424310', 0, { mega: true });
    orphan.blocks.set('1,2,3', { x: 1, y: 2, z: 3, type: 'minecraft:air', data: 0, nbt: null });
    W.set(wkey(1, 2, 3, 0), { type: 'lit:g_stone', tileData: 0 });
    expect.set(0, 1, 2, 3, 'lit:g_stone');
    snap.persist('proj-P1-0-1793443424310');

    const pr = new ProjectionRenderer({ ghostRenderer: gr, logger: silentLogger });
    global.worldSnapshot = snap;
    global.ghostExpect = expect;
    global.ghostGuard = new GhostGuard(registry);

    const ok = pr.startRender(PLAYER, NORMAL_PROJ, -1);
    assert.strictEqual(ok, true, '新投影应正常开始');
    assert.strictEqual(W.get(wkey(1, 2, 3, 0)) && W.get(wkey(1, 2, 3, 0)).type, 'minecraft:air',
        '孤儿格的 ghost 必须先被还原');
    assert.strictEqual(snap.has('proj-P1-0-1793443424310'), false, '孤儿会话应已销毁');
    assert.strictEqual(expect.count(), 0, '孤儿期望应已清空');
});

check('归一化：isMega 被写成 schematicId 字符串时修成布尔（重启后自愈的前提）', () => {
    const old = { id: 'p1', schematicId: 'mega_1_ab', isMega: 'mega_1_ab' };
    normalizeProjection(old);
    assert.strictEqual(old.isMega, true, '字符串必须修成 true');
    assert.strictEqual(old.schematicId, 'mega_1_ab', 'schematicId 保留');

    // 只有字符串、没有 schematicId：值本身就是 id
    const onlyStr = { id: 'p2', isMega: 'mega_2_cd' };
    normalizeProjection(onlyStr);
    assert.strictEqual(onlyStr.isMega, true);
    assert.strictEqual(onlyStr.schematicId, 'mega_2_cd');

    // 真但无 schematicId：降级，否则每次进服都会失败一次
    const broken = { id: 'p3', isMega: true };
    normalizeProjection(broken);
    assert.strictEqual(broken.isMega, false);

    // 普通投影不动
    const normal = { id: 'p4', isMega: false };
    normalizeProjection(normal);
    assert.strictEqual(normal.isMega, false);

    assert.strictEqual(isMegaProjection({ isMega: 'mega_x' }), true, '统一判定接受字符串形态');
    assert.strictEqual(isMegaProjection({ isMega: false }), false);
    assert.strictEqual(isMegaProjection(null), false);
});

check('重启恢复：projection.isMega 是字符串时 _ensureMegaState 仍能重建注入状态', () => {
    W.clear();
    PLAYER = mkPlayer();
    const dir = tmpDir('stringmega');
    const expect = mkExpect();
    const snap = new WorldSnapshot({ dataDir: dir, logger: silentLogger, isGhost: registry.isGhost });
    const gr = mkRenderer(snap, expect);

    // 模拟真实 projections.json 里的旧数据形态
    const proj = { id: 'proj_x', name: '天空之城', schematicId: 'mega_9_zz', isMega: 'mega_9_zz', totalBlocks: 100, blocks: [] };
    let initCalls = 0;
    global.megaRenderer = {
        renderStates: new Map(),
        isEnabled: () => true,
        initRenderState(player, schematicId) {
            initCalls++;
            const st = { stateId: `${player.xuid}_${schematicId}`, schematicId, isActive: true, done: false };
            this.renderStates.set(st.stateId, st);
            return st;
        },
        setLayerMode() { return true; },
    };

    const pr = new ProjectionRenderer({ ghostRenderer: gr, logger: silentLogger });
    global.worldSnapshot = snap;
    global.ghostExpect = expect;
    global.ghostGuard = new GhostGuard(registry);

    assert.strictEqual(pr._ensureMegaState(PLAYER, proj), true, '字符串 isMega 也必须能自愈');
    assert.strictEqual(initCalls, 1);
    assert.strictEqual(proj.isMega, true, '自愈时顺手把字段修成布尔');

    // 真实入口：startRender 不该再走“未就绪”分支、更不该删恢复记录
    pr.activeProjections.clear();
    const ok = pr.startRender(PLAYER, { ...proj, isMega: 'mega_9_zz' }, -1);
    assert.strictEqual(ok, true, 'MEGA 投影应能正常开始（不再报未就绪）');
    assert.ok(pr.activeProjections.get(PLAYER.xuid), 'activeProjections 应已建立');
});

console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
