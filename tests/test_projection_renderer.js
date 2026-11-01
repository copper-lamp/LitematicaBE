/**
 * test_projection_renderer.js — ProjectionRenderer 契约回归
 *
 * 改薄后这 8 个成员必须仍在、语义不变。
 * 另外验证：
 *   - activeProjections 的 value 保留 projection.id（UIManager.isProjectionLoaded 依赖）
 *   - layerRenderMode / currentRenderLayer 是可整体重赋值的普通 Map（UIManager 自愈逻辑依赖）
 *   - showBounds 走文字，**不再调用 spawnParticle**
 *   - 切层：抬头 +1 / 低头 -1 / 平视不切
 */
const assert = require('assert');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');
const { ProjectionRenderer } = require(path.join(PLUGIN, 'src', 'render', 'ProjectionRenderer.js'));

const listeners = new Map();
let particleCalls = 0;
let listenCalls = 0;
global.mc = {
    listen(name, cb) { listenCalls++; listeners.set(name, cb); return true; },
    getPlayer() { return null; },
};
// 旧实现的粒子哨兵：showBounds 一旦再调 spawnParticle 立刻可见
const mkPlayer = (xuid = 'P1') => ({
    xuid,
    name: 'Steve',
    pos: { x: 0, y: 64, z: 0, dimid: 0 },
    direction: { yaw: 0, pitch: 0 },
    _tells: [],
    tell(msg) { this._tells.push(msg); },
    spawnParticle() { particleCalls++; },
});

/** 记录式假 GhostRenderer：只验调用语义，不碰世界 */
function fakeGhost() {
    const calls = [];
    const sessions = new Map();
    return {
        calls,
        sessions,
        retryBatch: 100,
        enqueue(player, projection, opts) {
            calls.push(['enqueue', projection.id, opts && opts.layer]);
            sessions.set(player.xuid, { projectionId: projection.id, layer: (opts && opts.layer) || -1, state: 'building' });
            return { ok: true, count: 42 };
        },
        clear(player, opts) {
            calls.push(['clear', opts && opts.silent ? 'silent' : 'loud']);
            sessions.delete(player.xuid);
            return { ok: true, restored: 42 };
        },
        has(player) { return sessions.has(player && player.xuid ? player.xuid : player); },
        tick() { return { written: 1, skipped: 0, protected: 0, pending: 0, doneSessions: 0 }; },
        retryPending() { calls.push(['retryPending']); return { retried: 0, placed: 0, remaining: 0 }; },
        setLayer(player, projection, layer) {
            calls.push(['setLayer', projection.id, layer]);
            sessions.set(player.xuid, { projectionId: projection.id, layer, state: 'building' });
            return { ok: true, count: 16 };
        },
        updateBlocks(xuid, blocks) { calls.push(['updateBlocks', xuid, blocks.length]); return blocks.length; },
        getSession(xuid) { return sessions.get(xuid) || null; },
        summary() { return { sessions: sessions.size, queued: 0, written: 0, pending: 0, counters: {}, list: [] }; },
    };
}

let pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) { console.log(`  ❌ ${name}`); console.log(`     ${e && e.message ? e.message : e}`); fail++; }
}

console.log('\n=== ProjectionRenderer 契约 ===');

check('契约 8 成员齐全且类型正确', () => {
    const gr = fakeGhost();
    const r = new ProjectionRenderer({ ghostRenderer: gr });
    assert.ok(r.activeProjections instanceof Map, 'activeProjections 必须是 Map');
    assert.ok(r.layerRenderMode instanceof Map, 'layerRenderMode 必须是 Map');
    assert.ok(r.currentRenderLayer instanceof Map, 'currentRenderLayer 必须是 Map');
    for (const m of ['startRender', 'cancelRender', 'clearPlayerProjection', 'showBounds', 'updateBlocks']) {
        assert.strictEqual(typeof r[m], 'function', `${m} 必须是方法`);
    }
});

check('startRender：activeProjections 的 value 带 projection.id（UIManager 依赖）', () => {
    const gr = fakeGhost();
    const r = new ProjectionRenderer({ ghostRenderer: gr });
    const p = mkPlayer();
    const proj = { id: 'abc-123', name: '小屋', dimensions: { x: 4, y: 4, z: 4 }, position: { x: 0, y: 64, z: 0 }, blocks: [] };
    assert.strictEqual(r.startRender(p, proj, -1), true);
    const task = r.activeProjections.get('P1');
    assert.ok(task);
    assert.strictEqual(task.projection.id, 'abc-123');
    assert.strictEqual(r.currentRenderLayer.get('P1'), -1);
    assert.deepStrictEqual(gr.calls[0], ['enqueue', 'abc-123', -1]);
});

check('layerRenderMode 可整体重赋值（UIManager.js:1048 自愈逻辑）', () => {
    const r = new ProjectionRenderer({ ghostRenderer: fakeGhost() });
    r.layerRenderMode.set('P1', true);
    r.layerRenderMode = new Map();          // 整体重赋值
    assert.strictEqual(r.layerRenderMode.size, 0);
    assert.strictEqual(r.layerRenderMode.get('P1'), undefined);
});

check('clearPlayerProjection 会撤销世界里的 ghost，并清会话 Map', () => {
    const gr = fakeGhost();
    const r = new ProjectionRenderer({ ghostRenderer: gr });
    const p = mkPlayer();
    r.startRender(p, { id: 'x', name: 'x', dimensions: { x: 1, y: 1, z: 1 }, position: { x: 0, y: 0, z: 0 }, blocks: [] });
    r.clearPlayerProjection(p);
    assert.strictEqual(r.activeProjections.has('P1'), false);
    assert.strictEqual(r.currentRenderLayer.has('P1'), false);
    assert.deepStrictEqual(gr.calls.find(c => c[0] === 'clear'), ['clear', 'loud']);
});

check('cancelRender：无会话返回 false，有会话撤销并返回 true', () => {
    const r = new ProjectionRenderer({ ghostRenderer: fakeGhost() });
    const p = mkPlayer();
    assert.strictEqual(r.cancelRender(p), false);
    r.startRender(p, { id: 'x', name: 'x', dimensions: { x: 1, y: 1, z: 1 }, position: { x: 0, y: 0, z: 0 }, blocks: [] });
    assert.strictEqual(r.cancelRender(p), true);
});

check('showBounds 走文字四角，不调用任何粒子 API', () => {
    particleCalls = 0;
    const r = new ProjectionRenderer({ ghostRenderer: fakeGhost() });
    const p = mkPlayer();
    const proj = {
        id: 'b', name: '边界测试',
        dimensions: { x: 10, y: 5, z: 20 },
        position: { x: 100, y: 64, z: 200 },
        rotation: 0, mirrorX: false, mirrorZ: false,
    };
    r.showBounds(proj, p);
    assert.strictEqual(particleCalls, 0, 'showBounds 不许再 spawnParticle');
    const text = p._tells.join('\n').replace(/§./g, '');   // 去掉颜色码再比对
    assert.match(text, /投影边界/);
    assert.match(text, /10 × 5 × 20/);
    assert.match(text, /y 64 → 68/);
    assert.match(text, /\(100, 200\)/);   // 原点角
    assert.match(text, /\(109, 219\)/);   // 对角
});

check('updateBlocks 转给 GhostRenderer（Mega 注入路径）', () => {
    const gr = fakeGhost();
    const r = new ProjectionRenderer({ ghostRenderer: gr });
    const n = r.updateBlocks('P1', [{ pos: [0, 0, 0], name: 'minecraft:stone' }]);
    assert.strictEqual(n, 1);
    assert.deepStrictEqual(gr.calls[0], ['updateBlocks', 'P1', 1]);
});

check('切层：抬头 +1 / 低头 -1 / 平视不动', () => {
    const gr = fakeGhost();
    const r = new ProjectionRenderer({ ghostRenderer: gr });
    const p = mkPlayer();
    const proj = { id: 'L', name: 'L', dimensions: { x: 4, y: 8, z: 4 }, position: { x: 0, y: 64, z: 0 }, blocks: [] };
    r.layerRenderMode.set('P1', true);
    r.startRender(p, proj, 3);

    p.direction.pitch = -45;                // 抬头
    r.handleLayerSwitch(p);
    assert.strictEqual(r.currentRenderLayer.get('P1'), 4);

    r.lastLayerSwitch.set('P1', 0);         // 跳过冷却
    p.direction.pitch = 45;                 // 低头
    r.handleLayerSwitch(p);
    assert.strictEqual(r.currentRenderLayer.get('P1'), 3);

    r.lastLayerSwitch.set('P1', 0);
    p.direction.pitch = 0;                  // 平视
    const before = gr.calls.filter(c => c[0] === 'setLayer').length;
    r.handleLayerSwitch(p);
    assert.strictEqual(gr.calls.filter(c => c[0] === 'setLayer').length, before, '平视不该触发重铺');
});

check('未开逐层显示时，木剑切层不动作', () => {
    const gr = fakeGhost();
    const r = new ProjectionRenderer({ ghostRenderer: gr });
    const p = mkPlayer();
    r.startRender(p, { id: 'L', name: 'L', dimensions: { x: 4, y: 8, z: 4 }, position: { x: 0, y: 0, z: 0 }, blocks: [] });
    r.layerRenderMode.set('P1', false);
    p.direction.pitch = -45;
    r.handleLayerSwitch(p);
    assert.strictEqual(gr.calls.filter(c => c[0] === 'setLayer').length, 0);
});

check('GhostRenderer 未装配时 startRender 返回 false 且不抛错', () => {
    const r = new ProjectionRenderer();
    const p = mkPlayer();
    assert.strictEqual(r.startRender(p, { id: 'x', name: 'x', dimensions: { x: 1, y: 1, z: 1 }, position: { x: 0, y: 0, z: 0 }, blocks: [] }), false);
    assert.strictEqual(r.tick().written, 0);
});

check('MEGA 投影缺少注入状态时给出提示，不建立会话', () => {
    const gr = fakeGhost();
    const r = new ProjectionRenderer({ ghostRenderer: gr });
    const p = mkPlayer();
    delete global.megaRenderer;
    const ok = r.startRender(p, {
        id: 'mega', name: '巨型', isMega: true, schematicId: 's1',
        dimensions: { x: 100, y: 100, z: 100 }, position: { x: 0, y: 0, z: 0 }, blocks: [],
    });
    assert.strictEqual(ok, false);
    assert.strictEqual(gr.calls.length, 0);
    assert.match(p._tells.join('\n'), /enableMega/);
});

check('MEGA 投影就绪时建空队列会话，count 用 totalBlocks', () => {
    const gr = fakeGhost();
    const r = new ProjectionRenderer({ ghostRenderer: gr });
    const p = mkPlayer();
    const fakeMega = {
        isEnabled: () => true,
        renderStates: new Map(),
        initRenderState(player, schematicId) {
            const key = `${player.xuid}_${schematicId}`;
            this.renderStates.set(key, { stateId: key });
            return { stateId: key };
        },
    };
    global.megaRenderer = fakeMega;
    const ok = r.startRender(p, {
        id: 'mega', name: '巨型', isMega: true, schematicId: 's1', totalBlocks: 80000,
        dimensions: { x: 100, y: 100, z: 100 }, position: { x: 0, y: 0, z: 0 }, blocks: [],
    });
    assert.strictEqual(ok, true);
    assert.strictEqual(gr.calls[0][0], 'enqueue');
    const task = r.activeProjections.get('P1');
    assert.strictEqual(task.isMega, true);
    assert.strictEqual(task.count, 80000);
    assert.strictEqual(fakeMega.renderStates.size, 1);
    delete global.megaRenderer;
});

check('只绑定了木剑监听，没有 onTick / 定时器', () => {
    listenCalls = 0;
    const r = new ProjectionRenderer({ ghostRenderer: fakeGhost() });
    assert.strictEqual(listenCalls, 1, '只该有 onUseItem 一个监听');
    assert.ok(listeners.has('onUseItem'));
    assert.strictEqual(listeners.has('onTick'), false, '渲染 tick 必须交给统一调度器');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
