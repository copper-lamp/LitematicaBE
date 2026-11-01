/**
 * test_session_restore.js — 会话保活 / 重进恢复
 *
 * 用户报的现象：载入投影 → 退出游戏 → 重进 → 投影不显示，且木剑 UI 里
 * 必须先"卸载/删除"再"加载"才生效。
 *
 * 根因两条，这里逐条钉死：
 *   A. onLeft 原来直接 clearPlayerProjection → 世界里 ghost 全被撤销，
 *      重进时没有会话可恢复，只能靠玩家手动重载。
 *   B. clearPlayerProjection 的 Map 清理不在 finally 里 → world 侧撤销一旦抛错，
 *      activeProjections 残留 → isProjectionLoaded() 恒 true → UI 显示"[已加载]"
 *      点"加载"被"该投影已在渲染中"挡住，只能先卸载。
 *
 * 覆盖：
 *   1. 离线保活：suspend 后世界 ghost 仍在、activeProjections 仍在（UI 仍显示已加载）
 *   2. 重进恢复（内存态）：零重写、不换快照会话
 *   3. 服务器重启：按 playerData.currentProjectionId 重建，世界仍是 ghost（skip 掉）
 *   4. 主动卸载 → 记录清空 → 重进不恢复
 *   5. 投影已被删除 → 重进清记录并提示，不抛错
 *   6. clearPlayerProjection 在 world 撤销抛错时仍清 Map（UI 不再卡住）
 *   7. 离线超时 prune：30 分钟后把 ghost 还给世界
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

/** 假 DataManager：只实现本流程用到的四个方法，playerData 语义与真实一致（会落盘） */
function makeDataManager() {
    const players = new Map();
    const projections = new Map();
    return {
        players,
        projections,
        getPlayerData(xuid) {
            if (!players.has(xuid)) players.set(xuid, { xuid });
            return players.get(xuid);
        },
        updatePlayerData(xuid, updates) {
            const d = this.getPlayerData(xuid);
            Object.assign(d, updates || {});
            return d;
        },
        getProjection(id) { return projections.get(id) || null; },
        addProjection(p) { projections.set(p.id, p); },
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
        name: o.name || '小屋',
        dimensions: { x: size, y: size, z: size },
        position: o.position || { x: 0, y: 64, z: 0 },
        rotation: 0, mirrorX: false, mirrorZ: false,
        blocks,
    };
}

const mkPlayer = (xuid = 'P1', name = 'Steve') => ({
    xuid, name,
    pos: { x: 0, y: 64, z: 0, dimid: 0 },
    direction: { yaw: 0, pitch: 0 },
    _tells: [],
    tell(m) { this._tells.push(m); },
    spawnParticle() { },
});

function makeWorld(opts) {
    const o = opts || {};
    if (!o.keepWorld) W.clear();          // keepWorld=true 用来模拟"重启后世界不变"
    const tmpDir = o.tmpDir || fs.mkdtempSync(path.join(os.tmpdir(), 'session-'));
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

function drain(gr, budget = 10000, maxTicks = 500) {
    for (let i = 0; i < maxTicks; i++) {
        let any = false;
        for (const s of gr.sessions.values()) {
            if (s.state === 'building' && s.cursor < s.queue.length) { any = true; break; }
        }
        if (!any) break;
        gr.tick(budget);
    }
}

/** 与 index.js 的 onJoin 恢复逻辑同构（保持同步，改一处要改两处） */
function onJoin(w, player) {
    let restored = false;
    if (typeof w.pr.restoreForPlayer === 'function') restored = w.pr.restoreForPlayer(player);
    if (restored) return { via: 'resume' };

    const pd = w.dm.getPlayerData(player.xuid) || {};
    const pid = pd.currentProjectionId;
    if (!pid) return { via: 'none' };

    const projection = w.dm.getProjection(pid);
    if (!projection) {
        w.dm.updatePlayerData(player.xuid, { currentProjectionId: null });
        player.tell('§7上次的投影已被删除，记录已清理');
        return { via: 'gone' };
    }
    const lay = Number.isFinite(pd.currentRenderLayer) ? pd.currentRenderLayer : -1;
    if (pd.renderLayerMode) w.pr.layerRenderMode.set(player.xuid, true);
    w.pr.currentRenderLayer.set(player.xuid, lay);
    const ok = w.pr.startRender(player, projection, lay);
    return { via: ok ? 'rebuild' : 'failed' };
}

function onLeft(w, player) {
    return w.pr.suspendPlayer(player);
}

const ghostCount = () => [...W.values()].filter(v => v.type === 'lit:g_stone').length;

let pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) { console.log(`  ❌ ${name}`); console.log(`     ${e && e.message ? e.message : e}`); fail++; }
}

console.log('\n=== 会话保活 / 重进恢复 ===');

check('载入投影 → 离线：世界 ghost 保留（不再被撤掉）', () => {
    const w = makeWorld();
    const p = mkPlayer();
    const proj = solidProjection(8);
    w.dm.addProjection(proj);
    assert.strictEqual(w.pr.startRender(p, proj, -1), true);
    drain(w.gr);
    const before = ghostCount();
    assert.ok(before > 0, '应该已经铺好');

    const kept = onLeft(w, p);
    assert.strictEqual(kept, true);
    assert.strictEqual(ghostCount(), before, '离线上不该动世界');
    assert.strictEqual(w.gr.sessions.get('P1').state, 'suspended');
    assert.ok(w.pr.activeProjections.has('P1'), 'UI 判定源还在 → 仍显示[已加载]，正确');
});

check('离线期间 tick 不写世界（暂停生效）', () => {
    const w = makeWorld();
    const p = mkPlayer();
    const proj = solidProjection(16);
    w.dm.addProjection(proj);
    w.pr.startRender(p, proj, -1);
    w.gr.tick(50);                       // 只铺一部分
    const partial = ghostCount();
    onLeft(w, p);
    w.gr.tick(10000);
    assert.strictEqual(ghostCount(), partial, '暂停后不该继续铺');
});

check('重进（内存保活）：零重写、快照会话不换', () => {
    const w = makeWorld();
    const p = mkPlayer();
    const proj = solidProjection(8);
    w.dm.addProjection(proj);
    w.pr.startRender(p, proj, -1);
    drain(w.gr);
    const sid = w.gr.sessions.get('P1').sessionId;
    const placed = w.gr.sessions.get('P1').counters.placed;

    onLeft(w, p);
    const r = onJoin(w, p);
    assert.strictEqual(r.via, 'resume');
    assert.strictEqual(w.gr.sessions.get('P1').state, 'done');
    assert.strictEqual(w.gr.sessions.get('P1').sessionId, sid, '不该换快照会话');
    assert.strictEqual(w.gr.sessions.get('P1').counters.placed, placed, '不该重写任何一格');
    assert.ok(ghostCount() > 0);
});

check('服务器重启后重进：按 playerData 重建，世界 ghost 被 skip 而不是重写', () => {
    const w1 = makeWorld();
    const p = mkPlayer();
    const proj = solidProjection(8);
    w1.dm.addProjection(proj);
    w1.pr.startRender(p, proj, -1);
    drain(w1.gr);
    const before = ghostCount();
    assert.ok(before > 0);

    // 模拟重启：世界（W）与 playerData（dm）保留，GhostRenderer / ProjectionRenderer 全新
    const w2 = makeWorld({ dataManager: w1.dm, tmpDir: w1.tmpDir, keepWorld: true });
    const r = onJoin(w2, p);
    assert.strictEqual(r.via, 'rebuild');
    drain(w2.gr);
    assert.strictEqual(ghostCount(), before, '世界不该多出/少掉格子');
    assert.ok(w2.gr.sessions.get('P1').counters.skippedGhost > 0, '已存在 ghost 应当被跳过');
});

check('主动卸载 → 记录清空 → 重进不再自动恢复', () => {
    const w = makeWorld();
    const p = mkPlayer();
    const proj = solidProjection(8);
    w.dm.addProjection(proj);
    w.pr.startRender(p, proj, -1);
    drain(w.gr);
    assert.strictEqual(w.dm.getPlayerData('P1').currentProjectionId, 'proj-1');

    assert.strictEqual(w.pr.cancelRender(p), true);
    assert.strictEqual(ghostCount(), 0, '卸载要还原世界');
    assert.strictEqual(w.dm.getPlayerData('P1').currentProjectionId, null, '记录必须清掉');

    const r = onJoin(w, p);
    assert.strictEqual(r.via, 'none');
    assert.strictEqual(ghostCount(), 0);
});

check('投影已被删除：重进清记录 + 提示，不抛错', () => {
    const w = makeWorld();
    const p = mkPlayer();
    const proj = solidProjection(8);
    w.dm.addProjection(proj);
    w.pr.startRender(p, proj, -1);
    drain(w.gr);
    w.dm.projections.delete('proj-1');       // 玩家把投影删了

    const w2 = makeWorld({ dataManager: w.dm, tmpDir: w.tmpDir });
    const r = onJoin(w2, p);
    assert.strictEqual(r.via, 'gone');
    assert.strictEqual(w.dm.getPlayerData('P1').currentProjectionId, null);
    assert.ok(p._tells.some(t => /已被删除/.test(t)));
});

check('world 撤销抛错时，会话 Map 仍被清干净（UI 不再卡"已加载"）', () => {
    const w = makeWorld();
    const p = mkPlayer();
    const proj = solidProjection(8);
    w.dm.addProjection(proj);
    w.pr.startRender(p, proj, -1);
    drain(w.gr);

    // 让 GhostRenderer.clear 抛错（模拟玩家已离线 / 区块异常）
    const orig = w.gr.clear;
    w.gr.clear = () => { throw new Error('模拟撤销异常'); };

    assert.doesNotThrow(() => w.pr.clearPlayerProjection(p));
    assert.strictEqual(w.pr.activeProjections.has('P1'), false, 'Map 必须清掉');
    assert.strictEqual(w.pr.currentRenderLayer.has('P1'), false);
    // 清掉之后 UI 认为未加载 → 玩家可以直接再点"加载投影"
    const uiSaysLoaded = (() => {
        const task = w.pr.activeProjections.get('P1');
        return !!(task && task.projection && task.projection.id === 'proj-1');
    })();
    assert.strictEqual(uiSaysLoaded, false);
    w.gr.clear = orig;
});

check('离线超时 prune：默认 30 分钟后把 ghost 还给世界', () => {
    const w = makeWorld();
    const p = mkPlayer();
    const proj = solidProjection(8);
    w.dm.addProjection(proj);
    w.pr.startRender(p, proj, -1);
    drain(w.gr);
    onLeft(w, p);
    assert.ok(ghostCount() > 0);

    // 没到时间：不动
    w.gr._lastPrune = 0;
    let r = w.gr.pruneSuspended(30 * 60 * 1000, Date.now() + 10 * 60 * 1000);
    assert.strictEqual(r.pruned, 0);
    assert.ok(ghostCount() > 0);

    // 到时间：撤销
    w.gr._lastPrune = 0;
    r = w.gr.pruneSuspended(30 * 60 * 1000, Date.now() + 31 * 60 * 1000);
    assert.strictEqual(r.pruned, 1);
    assert.strictEqual(ghostCount(), 0, '超时保活要还原世界');
    assert.strictEqual(w.gr.has('P1'), false);
});

check('同一投影重复 startRender（重复点"加载"）：不重写、不换会话', () => {
    const w = makeWorld();
    const p = mkPlayer();
    const proj = solidProjection(8);
    w.dm.addProjection(proj);
    w.pr.startRender(p, proj, -1);
    drain(w.gr);
    const sid = w.gr.sessions.get('P1').sessionId;
    const placed = w.gr.sessions.get('P1').counters.placed;

    assert.strictEqual(w.pr.startRender(p, proj, -1), true);
    drain(w.gr);
    assert.strictEqual(w.gr.sessions.get('P1').sessionId, sid);
    assert.strictEqual(w.gr.sessions.get('P1').counters.placed, placed);
    assert.ok(ghostCount() > 0);
});

check('换层不再走"整投影重铺"：只保留该层', () => {
    const w = makeWorld();
    const p = mkPlayer();
    const proj = solidProjection(16);
    w.dm.addProjection(proj);
    w.pr.startRender(p, proj, -1);
    drain(w.gr);

    w.pr.layerRenderMode.set('P1', true);
    w.pr.currentRenderLayer.set('P1', 4);
    const proj2 = { ...proj };
    const r = w.gr.setLayer(p, proj2, 5);
    assert.strictEqual(r.ok, true);
    drain(w.gr);

    const ys = new Set([...W.entries()]
        .filter(([, v]) => v.type === 'lit:g_stone')
        .map(([k]) => +k.split(':')[1].split(',')[1]));
    assert.deepStrictEqual([...ys], [69], '只剩 64+5 那一层');
});

check('summary() 暴露 suspended 计数，便于现场诊断', () => {
    const w = makeWorld();
    const p = mkPlayer();
    const proj = solidProjection(8);
    w.dm.addProjection(proj);
    w.pr.startRender(p, proj, -1);
    drain(w.gr);
    onLeft(w, p);
    const s = w.gr.summary();
    assert.strictEqual(s.suspended, 1);
    assert.strictEqual(s.list[0].state, 'suspended');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
