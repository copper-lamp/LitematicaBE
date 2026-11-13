/**
 * test_purge_projection.js — 删除投影前必须把世界清干净（3.0.4 修复）
 *
 * 事故（2026-11-11 真机）：加载 MEGA「天空之城」→ 强关服（注入状态是纯内存的，世界 ghost 残留、
 * 快照保留）→ 重进 → 在菜单/命令里删投影。旧实现只在"该投影有活跃会话"时才撤世界：
 *
 *     if (renderer.isProjectionLoaded(player, id)) renderer.cancelRender(player, id);
 *     dataManager.removeProjection(id);
 *
 * 重启后没有会话 → 世界一格没动，但 projections.json 的记录被删了：
 * 玩家看到「列表里没了、投影还在世界里」，而且 MEGA 注入状态还可能继续往世界灌。
 *
 * 现在 `ProjectionRenderer.purgeProjection()` 三层兜底：
 *   1. 活跃会话 → 走快照精确还原
 *   2. 孤儿快照（重启/强退）→ 按 sessionId 哈希或包围盒认出后 revert
 *   3. 期望账本 → 包围盒内仍是 ghost 的格写回空气
 * 并且**清不干净就不许删记录**（返回 ok=false + remaining）。
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');
const { GhostRenderer, shortHash } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostRenderer.js'));
const { GhostGuard } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostGuard.js'));
const { WorldSnapshot } = require(path.join(PLUGIN, 'src', 'world', 'WorldSnapshot.js'));
const { ProjectionRenderer } = require(path.join(PLUGIN, 'src', 'render', 'ProjectionRenderer.js'));

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

const W = new Map();
const wkey = (x, y, z, d) => `${d}:${x},${y},${z}`;
let CURRENT_PLAYER = null;
let UNLOADED = new Set();

global.mc = {
    listen() { return true; },
    getPlayer(xuid) { return (CURRENT_PLAYER && CURRENT_PLAYER.xuid === xuid) ? CURRENT_PLAYER : null; },
    getBlock(x, y, z, d) {
        if (UNLOADED.has(wkey(x, y, z, d))) return null;
        const v = W.get(wkey(x, y, z, d));
        if (!v) return { type: 'minecraft:air', tileData: 0, pos: { x, y, z, dimid: d } };
        return { type: v.type, tileData: v.tileData, pos: { x, y, z, dimid: d } };
    },
    setBlock(x, y, z, d, type, data) {
        if (UNLOADED.has(wkey(x, y, z, d))) return false;
        W.set(wkey(x, y, z, d), { type, tileData: data || 0 });
        return true;
    },
};
global.logger = silentLogger;

const mkPlayer = (xuid = 'P1') => ({
    xuid, name: 'Steve',
    pos: { x: 0, y: 64, z: 0, dimid: 0 },
    direction: { yaw: 0, pitch: 0 },
    _tells: [],
    tell(m) { this._tells.push(m); },
});

function makeExpect() {
    const map = new Map();
    return {
        map,
        set(d, x, y, z, gid) { map.set(wkey(x, y, z, d), gid); },
        del(d, x, y, z) { return map.delete(wkey(x, y, z, d)); },
        get(d, x, y, z) { return map.get(wkey(x, y, z, d)) || null; },
        count() { return map.size; },
        forEach(cb, dimid) {
            for (const k of [...map.keys()]) {
                const [d, coords] = k.split(':');
                const [x, y, z] = coords.split(',').map(Number);
                if (dimid === undefined || Number(d) === dimid) cb(Number(d), x, y, z, map.get(k));
            }
        },
        flush() { return true; },
    };
}

function makeDataManager() {
    const players = new Map();
    const projections = new Map();
    return {
        players,
        projections,
        getPlayerData(x) {
            if (!players.has(x)) players.set(x, { xuid: x, loadedProjections: [] });
            return players.get(x);
        },
        updatePlayerData(x, u) { Object.assign(this.getPlayerData(x), u || {}); return this.getPlayerData(x); },
        getProjection(id) { return projections.get(id) || null; },
        addProjection(p) { projections.set(p.id, p); },
        getAllProjections() { return [...projections.values()]; },
        getPlayersLoadingProjection() { return ['P1']; },
        removeProjection(id) { return projections.delete(id); },
        removeProjectionFromAllPlayers() { return 1; },
        generateId() { return 'new_' + Date.now(); },
    };
}

function solidProjection(size, opts) {
    const o = opts || {};
    const blocks = [];
    for (let x = 0; x < size; x++)
        for (let y = 0; y < size; y++)
            for (let z = 0; z < size; z++) blocks.push({ pos: [x, y, z], name: 'minecraft:stone' });
    return {
        id: o.id || 'proj-1',
        name: o.name || '投影',
        dimensions: { x: size, y: size, z: size },
        position: o.position || { x: 0, y: 64, z: 0 },
        dimension: 0,
        rotation: 0, mirrorX: false, mirrorZ: false,
        blocks,
        totalBlocks: blocks.length,
        isMega: !!o.isMega,
        schematicId: o.schematicId || null,
    };
}

function makeWorld(opts) {
    const o = opts || {};
    if (!o.keepWorld) W.clear();
    UNLOADED = new Set();
    const tmpDir = o.tmpDir || fs.mkdtempSync(path.join(os.tmpdir(), 'purge-'));
    const registry = {
        ready: true,
        genericId: 'lit:g_generic',
        isGhost: (t) => typeof t === 'string' && t.startsWith('lit:g_'),
        resolve: () => 'lit:g_stone',
    };
    const expect = makeExpect();
    const snapshot = new WorldSnapshot({ dataDir: tmpDir, logger: silentLogger, isGhost: registry.isGhost }).load();
    const guard = new GhostGuard(registry);
    const gr = new GhostRenderer({
        registry, expectStore: expect, snapshot, guard, logger: silentLogger,
        addonCheck: { isEnabled: () => true },
        writesPerTick: 10000, maxBlocks: 60000, retryBatch: 10000,
    });
    const dm = o.dataManager || makeDataManager();
    const pr = new ProjectionRenderer({ ghostRenderer: gr, dataManager: dm, logger: silentLogger });

    global.worldSnapshot = snapshot;
    global.ghostExpect = expect;
    global.ghostGuard = guard;
    global.ghostRenderer = gr;

    return { gr, pr, dm, snapshot, expect, guard, tmpDir, registry };
}

function drain(gr, budget = 10000, maxTicks = 400) {
    for (let i = 0; i < maxTicks; i++) {
        let any = false;
        for (const s of gr.sessions.values()) {
            if (s.state === 'building' && s.cursor < s.queue.length) { any = true; break; }
        }
        if (!any) break;
        gr.tick(budget);
    }
}

const ghostCount = () => [...W.values()].filter(v => v.type === 'lit:g_stone').length;
const isGhostAt = (x, y, z, d = 0) => {
    const v = W.get(wkey(x, y, z, d));
    return !!v && v.type === 'lit:g_stone';
};

let pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) { console.log(`  ❌ ${name}\n     ${e && e.message ? e.message : e}`); fail++; }
}

console.log('\n=== 删除投影：世界必须先清干净 ===');

check('活跃会话：删除投影 → 世界还原、ok=true', () => {
    const w = makeWorld();
    const p = mkPlayer();
    CURRENT_PLAYER = p;
    const proj = solidProjection(4, { id: 'A' });
    w.dm.addProjection(proj);
    w.pr.startRender(p, proj, -1);
    drain(w.gr);
    assert.ok(ghostCount() > 0, '先要铺出 ghost');

    const r = w.pr.purgeProjection([p], proj);
    assert.strictEqual(r.ok, true, `应清干净：${JSON.stringify(r)}`);
    assert.strictEqual(ghostCount(), 0, '世界不该残留 ghost');
    assert.strictEqual(w.gr.hasProjection(p, 'A'), false, '会话应被撤销');
    assert.strictEqual(w.expect.count(), 0, '期望账本也该清空');
});

check('强退后无会话 + 新格式快照（sessionId 带 -hash）：删除时也能还原', () => {
    const w = makeWorld();
    const p = mkPlayer();
    const proj = solidProjection(4, { id: 'MEGA1', isMega: true, schematicId: 's1' });
    const sid = `proj-P1-0-1794389680586-${shortHash('MEGA1')}`;

    // 模拟重启后的现场：快照还在、世界是 ghost、内存里没有会话
    const s = w.snapshot.begin(sid, 0, { mega: true });
    for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) {
        W.set(wkey(x, 64, z, 0), { type: 'lit:g_stone', tileData: 0 });
        s.blocks.set(`${x},64,${z}`, { x, y: 64, z, type: 'minecraft:air', data: 0, nbt: null });
        w.expect.set(0, x, 64, z, 'lit:g_stone');
    }
    w.snapshot.persist(sid);

    const r = w.pr.purgeProjection([p], proj);
    assert.strictEqual(r.ok, true, `应清干净：${JSON.stringify(r)}`);
    assert.ok(r.sessions >= 1, '应认到那条快照会话');
    assert.strictEqual(ghostCount(), 0, '世界不该残留 ghost');
    assert.strictEqual(w.expect.count(), 0, '期望要一起删（否则 GhostGuard 会补回来）');
    assert.strictEqual(w.snapshot.has(sid), false, '快照文件该被收尾');
});

check('旧格式快照（sessionId 无 hash）：按包围盒认亲，且不碰别的投影', () => {
    const w = makeWorld();
    const p = mkPlayer();
    const target = solidProjection(4, { id: 'T', position: { x: 0, y: 64, z: 0 } });
    const other = solidProjection(4, { id: 'O', position: { x: 500, y: 64, z: 0 } });

    // 目标投影的旧快照（无 hash 后缀）
    const s1 = w.snapshot.begin('proj-P1-0-111', 0, null);
    W.set(wkey(1, 64, 1, 0), { type: 'lit:g_stone', tileData: 0 });
    s1.blocks.set('1,64,1', { x: 1, y: 64, z: 1, type: 'minecraft:air', data: 0, nbt: null });
    // 另一个投影的旧快照（在远处）
    const s2 = w.snapshot.begin('proj-P1-0-222', 0, null);
    W.set(wkey(501, 64, 1, 0), { type: 'lit:g_stone', tileData: 0 });
    s2.blocks.set('501,64,1', { x: 501, y: 64, z: 1, type: 'minecraft:air', data: 0, nbt: null });

    const r = w.pr.purgeProjection([p], target);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(isGhostAt(1, 64, 1), false, '目标投影的格应还原');
    assert.ok(isGhostAt(501, 64, 1), '远处另一个投影的格不能被碰');
    assert.strictEqual(w.snapshot.has('proj-P1-0-222'), true, '别的快照要保留');
    assert.ok(other, '防止 lint 掉 unused');
});

check('区块未加载：清不干净 → ok=false + remaining>0，期望保留', () => {
    const w = makeWorld();
    const p = mkPlayer();
    const proj = solidProjection(3, { id: 'U' });
    for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) {
        UNLOADED.add(wkey(x, 64, z, 0));
        w.expect.set(0, x, 64, z, 'lit:g_stone');
    }

    const r = w.pr.purgeProjection([p], proj);
    assert.strictEqual(r.ok, false, '未加载时不许谎报成功');
    assert.ok(r.remaining > 0, 'remaining 必须大于 0');
    assert.ok(w.expect.count() > 0, '未加载格的期望要保留，等玩家靠近再清');
});

check('MEGA：删除时先停注入状态（否则删完还在往世界灌）', () => {
    const w = makeWorld();
    const p = mkPlayer();
    const calls = [];
    global.megaRenderer = {
        renderStates: new Map(),
        isEnabled: () => true,
        stateIdFor(player, proj) { return proj && proj.schematicId ? `${player.xuid}_${proj.schematicId}` : null; },
        stopRender(id) { calls.push(id); },
    };
    const proj = solidProjection(4, { id: 'M2', isMega: true, schematicId: 'sky' });
    const r = w.pr.purgeProjection([p], proj);
    assert.deepStrictEqual(calls, ['P1_sky'], '必须调用 stopRender 掐掉注入');
    assert.strictEqual(r.megaStopped, 1);
    delete global.megaRenderer;
});

check('期望兜底：没有快照，包围盒内仍是 ghost 的格也要清', () => {
    const w = makeWorld();
    const p = mkPlayer();
    const proj = solidProjection(3, { id: 'E' });
    W.set(wkey(0, 64, 0, 0), { type: 'lit:g_stone', tileData: 0 });
    W.set(wkey(2, 66, 2, 0), { type: 'lit:g_stone', tileData: 0 });
    // 盒子外的一条期望：不能被误删
    W.set(wkey(900, 64, 900, 0), { type: 'lit:g_stone', tileData: 0 });
    w.expect.set(0, 0, 64, 0, 'lit:g_stone');
    w.expect.set(0, 2, 66, 2, 'lit:g_stone');
    w.expect.set(0, 900, 64, 900, 'lit:g_stone');

    const r = w.pr.purgeProjection([p], proj);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(isGhostAt(0, 64, 0), false);
    assert.strictEqual(isGhostAt(2, 66, 2), false);
    assert.strictEqual(isGhostAt(900, 64, 900), true, '盒子外的 ghost 不能被碰');
    assert.strictEqual(w.expect.get(0, 900, 64, 900), 'lit:g_stone', '盒子外的期望要保留');
    assert.strictEqual(w.expect.count(), 1);
});

check('包围盒考虑 rotation（90° 时 x/z 跨度互换）', () => {
    const w = makeWorld();
    const proj = {
        id: 'R', dimensions: { x: 10, y: 5, z: 3 }, position: { x: 100, y: 64, z: 200 },
        rotation: 90, dimension: 0,
    };
    const box = w.pr._bboxOf(proj);
    assert.deepStrictEqual(box, { minX: 100, maxX: 102, minY: 64, maxY: 68, minZ: 200, maxZ: 209 });
});

check('离线玩家（伪 {xuid} 对象）也能按快照前缀清掉残留', () => {
    const w = makeWorld();
    const proj = solidProjection(3, { id: 'OFF' });
    const sid = `proj-P2-0-1794389680000-${shortHash('OFF')}`;
    const s = w.snapshot.begin(sid, 0, null);
    W.set(wkey(0, 64, 0, 0), { type: 'lit:g_stone', tileData: 0 });
    s.blocks.set('0,64,0', { x: 0, y: 64, z: 0, type: 'minecraft:air', data: 0, nbt: null });

    const r = w.pr.purgeProjection([{ xuid: 'P2' }], proj);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(isGhostAt(0, 64, 0), false);
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
