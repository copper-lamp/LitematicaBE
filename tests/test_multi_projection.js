/**
 * test_multi_projection.js — 同一玩家同时加载多个投影（3.0.4 修复）
 *
 * 修复前：GhostRenderer.sessions 的 key 就是 xuid，ProjectionRenderer 也只存一份 task，
 * 于是"再加载一个投影"必然把上一个撤掉 —— 玩家永远只能看一份 ghost。
 *
 * 这里钉死的行为：
 *   1. 两个投影并存：两条 ghost 会话、世界两处 ghost 同时存在
 *   2. 木剑只控制一份：setPrimaryProjection 只换控制目标，不重铺、不影响另一份
 *   3. 卸载其中一个：只还原它的格，另一个完好；主控自动顺位
 *   4. 切层只作用于目标投影：另一份的层/ghost 不动
 *   5. 持久化：loadedProjections 记全部、currentProjectionId 记主控、
 *      projectionLayers 按投影记层；重启后按列表逐个恢复
 *   6. MEGA：appendBlocks 按 projectionId 落到各自会话（不会串）
 *   7. MEGA：同一份图纸放两份 → 注入状态各一份（stateIdFor 带后缀）
 *   8. DataManager 老存档迁移：只有 currentProjectionId 也算"已加载那一个"
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
const { MegaProjectionRenderer } = require(path.join(PLUGIN, 'src', 'render', 'MegaProjectionRenderer.js'));
const { DataManager } = require(path.join(PLUGIN, 'src', 'data', 'DataManager.js'));

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

// ── 假世界 ──────────────────────────────────────────────
const W = new Map();
const wkey = (x, y, z, d) => `${d}:${x},${y},${z}`;
let CURRENT_PLAYER = null;

global.mc = {
    listen() { return true; },
    getPlayer(xuid) { return (CURRENT_PLAYER && CURRENT_PLAYER.xuid === xuid) ? CURRENT_PLAYER : null; },
    getBlock(x, y, z, d) {
        const v = W.get(wkey(x, y, z, d));
        if (!v) return { type: 'minecraft:air', tileData: 0, pos: { x, y, z, dimid: d } };
        return { type: v.type, tileData: v.tileData, pos: { x, y, z, dimid: d } };
    },
    setBlock(x, y, z, d, type, data) {
        W.set(wkey(x, y, z, d), { type, tileData: data || 0 });
        return true;
    },
};
global.logger = silentLogger;

const mkPlayer = (xuid = 'P1', name = 'Steve') => ({
    xuid, name,
    pos: { x: 0, y: 64, z: 0, dimid: 0 },
    direction: { yaw: 0, pitch: 0 },
    _tells: [],
    tell(m) { this._tells.push(m); },
});

/** 假 DataManager：语义与真实一致（迁移 + 落盘字段） */
function makeDataManager() {
    const players = new Map();
    const projections = new Map();
    return {
        players,
        projections,
        getPlayerData(xuid) {
            if (!players.has(xuid)) {
                players.set(xuid, {
                    xuid,
                    currentProjectionId: null,
                    loadedProjections: [],
                    projectionLayers: {},
                    projectionLayerModes: {},
                });
            }
            const d = players.get(xuid);
            DataManager.prototype.migratePlayerData.call(this, d);
            return d;
        },
        updatePlayerData(xuid, updates) {
            const d = this.getPlayerData(xuid);
            Object.assign(d, updates || {});
            return d;
        },
        getProjection(id) { return projections.get(id) || null; },
        addProjection(p) { projections.set(p.id, p); },
        removeProjectionFromAllPlayers(id) {
            let n = 0;
            for (const d of this.players.values()) {
                DataManager.prototype.migratePlayerData.call(this, d);
                const i = d.loadedProjections.indexOf(id);
                if (i >= 0) { d.loadedProjections.splice(i, 1); n++; d.currentProjectionId = d.loadedProjections[d.loadedProjections.length - 1] || null; }
            }
            return n;
        },
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
        name: o.name || o.id || '投影',
        dimensions: { x: size, y: size, z: size },
        position: o.position || { x: 0, y: 64, z: 0 },
        rotation: 0, mirrorX: false, mirrorZ: false,
        blocks,
        totalBlocks: blocks.length,
    };
}

function makeWorld(opts) {
    const o = opts || {};
    if (!o.keepWorld) W.clear();
    const tmpDir = o.tmpDir || fs.mkdtempSync(path.join(os.tmpdir(), 'multi-'));

    const registry = {
        ready: true,
        genericId: 'lit:g_generic',
        isGhost: (t) => typeof t === 'string' && t.startsWith('lit:g_'),
        resolve: () => 'lit:g_stone',
    };
    const expectMap = new Map();
    const expectStore = {
        set(d, x, y, z, gid) { expectMap.set(wkey(x, y, z, d), gid); },
        del(d, x, y, z) { expectMap.delete(wkey(x, y, z, d)); },
        get(d, x, y, z) { return expectMap.get(wkey(x, y, z, d)) || null; },
        count() { return expectMap.size; },
    };
    const snapshot = new WorldSnapshot({ dataDir: tmpDir, logger: silentLogger, isGhost: registry.isGhost }).load();
    const guard = new GhostGuard(registry);
    const gr = new GhostRenderer({
        registry, expectStore, snapshot, guard, logger: silentLogger,
        addonCheck: { isEnabled: () => true },
        writesPerTick: 10000, maxBlocks: 60000, retryBatch: 10000,
    });
    const dm = o.dataManager || makeDataManager();
    const pr = new ProjectionRenderer({ ghostRenderer: gr, dataManager: dm, logger: silentLogger });
    return { gr, pr, dm, snapshot, expectStore, tmpDir, registry };
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

const isGhostAt = (x, y, z, d = 0) => {
    const v = W.get(wkey(x, y, z, d));
    return !!v && v.type === 'lit:g_stone';
};
const ghostCount = () => [...W.values()].filter(v => v.type === 'lit:g_stone').length;

let pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) { console.log(`  ❌ ${name}`); console.log(`     ${e && e.message ? e.message : e}`); fail++; }
}

console.log('\n=== 多投影并存 / 木剑控制目标 ===');

check('两个投影同时加载：两条会话、世界两处 ghost 共存', () => {
    const w = makeWorld();
    const p = mkPlayer();
    const A = solidProjection(4, { id: 'A', position: { x: 0, y: 64, z: 0 } });
    const B = solidProjection(4, { id: 'B', position: { x: 100, y: 64, z: 0 } });
    w.dm.addProjection(A);
    w.dm.addProjection(B);

    assert.strictEqual(w.pr.startRender(p, A, -1), true);
    assert.strictEqual(w.pr.startRender(p, B, -1), true);

    const list = w.pr.getPlayerProjections(p);
    assert.strictEqual(list.length, 2, '两个投影都该在任务表里');
    assert.strictEqual(w.gr.hasProjection(p, 'A'), true);
    assert.strictEqual(w.gr.hasProjection(p, 'B'), true);

    drain(w.gr);
    assert.ok(isGhostAt(0, 64, 0), 'A 的角格应已铺');
    assert.ok(isGhostAt(100, 64, 0), 'B 的角格应已铺');
});

check('后加载的自动成为木剑控制；切换主控不重铺、不影响另一份', () => {
    const w = makeWorld();
    const p = mkPlayer();
    const A = solidProjection(4, { id: 'A', position: { x: 0, y: 64, z: 0 } });
    const B = solidProjection(4, { id: 'B', position: { x: 100, y: 64, z: 0 } });
    w.pr.startRender(p, A, -1);
    w.pr.startRender(p, B, -1);
    drain(w.gr);

    assert.strictEqual(w.pr.activeProjections.get('P1').id, 'B', '最后加载的是主控');
    const before = ghostCount();

    assert.strictEqual(w.pr.setPrimaryProjection(p, 'A', { notify: true }), true);
    assert.strictEqual(w.pr.activeProjections.get('P1').id, 'A');
    assert.ok(w.pr.layerRenderMode.get('P1') === false, 'A 是全层模式 → 逐层视图为 false');

    assert.strictEqual(ghostCount(), before, '切主控不该动世界');
    assert.strictEqual(w.gr.hasProjection(p, 'B'), true, 'B 的会话必须还在');
    assert.ok(p._tells.some(t => /木剑当前控制/.test(t)));
});

check('卸载其中一个：只还原它的格，另一个完好，主控自动顺位', () => {
    const w = makeWorld();
    const p = mkPlayer();
    const A = solidProjection(4, { id: 'A', position: { x: 0, y: 64, z: 0 } });
    const B = solidProjection(4, { id: 'B', position: { x: 100, y: 64, z: 0 } });
    w.pr.startRender(p, A, -1);
    w.pr.startRender(p, B, -1);
    drain(w.gr);
    assert.ok(isGhostAt(0, 64, 0) && isGhostAt(100, 64, 0));

    assert.strictEqual(w.pr.cancelRender(p, 'B'), true);
    assert.strictEqual(isGhostAt(100, 64, 0), false, 'B 的格必须被还原');
    assert.ok(isGhostAt(0, 64, 0), 'A 的格不能被动');
    assert.strictEqual(w.gr.hasProjection(p, 'B'), false);
    assert.strictEqual(w.gr.hasProjection(p, 'A'), true);
    assert.strictEqual(w.pr.activeProjections.get('P1').id, 'A', '主控顺位到剩下的那个');

    const pd = w.dm.getPlayerData('P1');
    assert.deepStrictEqual(pd.loadedProjections, ['A']);
    assert.strictEqual(pd.currentProjectionId, 'A');
});

check('切层只作用于目标投影：另一份的层与 ghost 不动', () => {
    const w = makeWorld();
    const p = mkPlayer();
    const A = solidProjection(6, { id: 'A', position: { x: 0, y: 64, z: 0 } });
    const B = solidProjection(6, { id: 'B', position: { x: 100, y: 64, z: 0 } });
    w.pr.startRender(p, A, -1);
    w.pr.startRender(p, B, -1);
    drain(w.gr);
    const bGhosts = [...W.keys()].filter(k => {
        const [, coords] = k.split(':');
        const [x] = coords.split(',');
        return Number(x) >= 100 && W.get(k).type === 'lit:g_stone';
    }).length;
    assert.ok(bGhosts > 0);

    const r = w.pr.applyLayer(p, A, 2);
    assert.strictEqual(r.ok, true);
    drain(w.gr);

    // A 只剩 y=66 那一层
    const aYs = new Set([...W.entries()]
        .filter(([k, v]) => v.type === 'lit:g_stone' && +k.split(':')[1].split(',')[0] < 100)
        .map(([k]) => +k.split(':')[1].split(',')[1]));
    assert.deepStrictEqual([...aYs], [66], 'A 应只剩第 2 层');

    // B 仍是全层
    const bCount = [...W.keys()].filter(k => +k.split(':')[1].split(',')[0] >= 100 && W.get(k).type === 'lit:g_stone').length;
    assert.strictEqual(bCount, bGhosts, 'B 的 ghost 不能被切层带走');
    assert.strictEqual(w.pr.getPlayerProjections(p).find(t => t.id === 'B').layer, -1);
    assert.strictEqual(w.pr.getPlayerProjections(p).find(t => t.id === 'A').layer, 2);
});

check('持久化：loadedProjections 记全部、currentProjectionId 记主控、按投影记层', () => {
    const w = makeWorld();
    const p = mkPlayer();
    const A = solidProjection(4, { id: 'A', position: { x: 0, y: 64, z: 0 } });
    const B = solidProjection(4, { id: 'B', position: { x: 100, y: 64, z: 0 } });
    w.pr.startRender(p, A, -1);
    w.pr.startRender(p, B, 2);

    const pd = w.dm.getPlayerData('P1');
    assert.deepStrictEqual(pd.loadedProjections, ['A', 'B']);
    assert.strictEqual(pd.currentProjectionId, 'B');
    assert.strictEqual(pd.projectionLayers.A, -1);
    assert.strictEqual(pd.projectionLayers.B, 2);
    assert.strictEqual(pd.projectionLayerModes.B, true);
});

check('重启后按 playerData.loadedProjections 逐个恢复（含主控与层）', () => {
    const w1 = makeWorld();
    const p = mkPlayer();
    const A = solidProjection(4, { id: 'A', position: { x: 0, y: 64, z: 0 } });
    const B = solidProjection(4, { id: 'B', position: { x: 100, y: 64, z: 0 } });
    w1.dm.addProjection(A);
    w1.dm.addProjection(B);
    w1.pr.startRender(p, A, -1);
    w1.pr.startRender(p, B, 2);
    drain(w1.gr);
    const before = ghostCount();

    // 模拟重启：世界与 playerData 保留，内存会话全丢
    const w2 = makeWorld({ dataManager: w1.dm, tmpDir: w1.tmpDir, keepWorld: true });

    // 与 index.js 的 onJoin 同构：逐个 startRender（primary:false），最后选主控
    const pd = w2.dm.getPlayerData('P1');
    const ids = pd.loadedProjections.slice();
    for (const id of ids) {
        const proj = w2.dm.getProjection(id);
        const lay = Number.isFinite(pd.projectionLayers[id]) ? pd.projectionLayers[id] : -1;
        assert.strictEqual(w2.pr.startRender(p, proj, lay, { primary: false, persist: false }), true, `${id} 应能重建`);
    }
    assert.strictEqual(w2.pr.setPrimaryProjection(p, pd.currentProjectionId, { persist: true }), true);

    drain(w2.gr);
    const list = w2.pr.getPlayerProjections(p);
    assert.strictEqual(list.length, 2);
    assert.strictEqual(w2.pr.activeProjections.get('P1').id, 'B', '主控按 currentProjectionId 恢复');
    assert.strictEqual(ghostCount(), before, '世界格数不该变（已是 ghost 的会被跳过）');
});

check('MEGA：appendBlocks 按 projectionId 落到各自会话，不串', () => {
    const w = makeWorld();
    const p = mkPlayer();
    CURRENT_PLAYER = p;

    const fakeMega = {
        isEnabled: () => true,
        renderStates: new Map(),
        stateIdFor(player, proj) {
            return proj && proj.schematicId ? `${player.xuid}_${proj.schematicId}` : null;
        },
        initRenderState(player, schematicId, projection) {
            const key = `${player.xuid}_${schematicId}`;
            this.renderStates.set(key, { stateId: key, projectionId: projection && projection.id });
            return this.renderStates.get(key);
        },
    };
    global.megaRenderer = fakeMega;

    const MA = {
        id: 'MA', name: 'MEGA-A', isMega: true, schematicId: 'sA', blocks: [],
        dimensions: { x: 64, y: 64, z: 64 }, position: { x: 0, y: 64, z: 0 }, totalBlocks: 100,
    };
    const MB = {
        id: 'MB', name: 'MEGA-B', isMega: true, schematicId: 'sB', blocks: [],
        dimensions: { x: 64, y: 64, z: 64 }, position: { x: 500, y: 64, z: 0 }, totalBlocks: 100,
    };

    assert.strictEqual(w.pr.startRender(p, MA, -1), true);
    assert.strictEqual(w.pr.startRender(p, MB, -1), true);
    assert.strictEqual(fakeMega.renderStates.size, 2, '两个 MEGA 各有注入状态');

    w.pr.appendBlocks('P1', [{ pos: [0, 0, 0], name: 'minecraft:stone' }], 'MA');
    assert.strictEqual(w.gr.getSessionOf(p, 'MA').queue.length, 1);
    assert.strictEqual(w.gr.getSessionOf(p, 'MB').queue.length, 0, '不能串进另一个投影');

    w.pr.appendBlocks('P1', [{ pos: [1, 1, 1], name: 'minecraft:stone' }], 'MB');
    assert.strictEqual(w.gr.getSessionOf(p, 'MB').queue.length, 1);
    assert.strictEqual(w.gr.getSessionOf(p, 'MA').queue.length, 1);

    delete global.megaRenderer;
});

check('MEGA：同一份图纸放两份 → 注入状态各一份（stateIdFor 带后缀）', () => {
    const fakeMgr = {
        loadChunkIndex() { return new Map([['0,0,0', 1]]); },
        loadChunkFromDisk() { return []; },
        getBlocksNear() { return []; },
    };
    global.configManager = { get: (k, def) => (k === 'render.enableMega' ? true : def) };
    const mega = new MegaProjectionRenderer(fakeMgr);
    const p = mkPlayer();

    const p1 = { id: 'inst1', schematicId: 'same', isMega: true, position: { x: 0, y: 0, z: 0 } };
    const p2 = { id: 'inst2', schematicId: 'same', isMega: true, position: { x: 100, y: 0, z: 0 } };

    const k1 = mega.stateIdFor(p, p1);
    assert.strictEqual(k1, 'P1_same');
    assert.ok(mega.initRenderState(p, 'same', p1));

    const k2 = mega.stateIdFor(p, p2);
    assert.notStrictEqual(k2, k1, '第二份实例必须有自己的状态键');
    assert.ok(k2.indexOf('P1_same#') === 0);
    assert.ok(mega.initRenderState(p, 'same', p2));
    assert.strictEqual(mega.renderStates.size, 2);

    // 回到第一份仍然是原键（不会每次调用都换）
    assert.strictEqual(mega.stateIdFor(p, p1), k1);

    delete global.configManager;
    delete global.megaRenderer;
});

check('DataManager 老存档迁移：只有 currentProjectionId 也视为已加载那一个', () => {
    const legacy = {
        xuid: 'X',
        currentProjectionId: 'p1',
        currentRenderLayer: 3,
        renderLayerMode: true,
        loadedProjections: undefined,
        projectionLayers: undefined,
        projectionLayerModes: undefined,
    };
    DataManager.prototype.migratePlayerData.call({}, legacy);
    assert.deepStrictEqual(legacy.loadedProjections, ['p1']);
    assert.strictEqual(legacy.projectionLayers.p1, 3);
    assert.strictEqual(legacy.projectionLayerModes.p1, true);

    // 空数据不炸、字段齐全
    const empty = { xuid: 'Y' };
    DataManager.prototype.migratePlayerData.call({}, empty);
    assert.deepStrictEqual(empty.loadedProjections, []);
    assert.strictEqual(empty.currentProjectionId, null);
    assert.deepStrictEqual(empty.projectionLayers, {});
});

check('删除投影：从所有玩家的已加载列表里摘掉（离线玩家不留死记录）', () => {
    const dm = makeDataManager();
    dm.getPlayerData('P1').loadedProjections = ['A', 'B'];
    dm.getPlayerData('P1').currentProjectionId = 'B';
    dm.getPlayerData('P2').loadedProjections = ['B'];

    const n = dm.removeProjectionFromAllPlayers('B');
    assert.strictEqual(n, 2);
    assert.deepStrictEqual(dm.getPlayerData('P1').loadedProjections, ['A']);
    assert.strictEqual(dm.getPlayerData('P1').currentProjectionId, 'A', '主控顺位到剩下的');
    assert.deepStrictEqual(dm.getPlayerData('P2').loadedProjections, []);
    assert.strictEqual(dm.getPlayerData('P2').currentProjectionId, null);
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
