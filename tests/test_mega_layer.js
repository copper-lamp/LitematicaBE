/**
 * test_mega_layer.js — MEGA 逐层显示（分层注入）离线验收
 *
 * 不依赖 BDS：内存假世界 + 真 GhostRenderer + 真 WorldSnapshot + 真 BinaryChunkStorage
 *
 * 覆盖：
 *   1. setLayerMode 只保留该层所在的分块行（cy = floor(layer / 32)）
 *   2. 分块内按 y 精确过滤：一层只注入这一层，不会带出同一分块里的其它 31 层
 *   3. 切层会重置注入游标与计数（不会接着上一轮的 cursor 跑）
 *   4. 回切 -1 恢复全量，allChunkKeys 不被层模式破坏
 *   5. 同层且未注入完 → 幂等返回 unchanged
 *   6. 真链路：ProjectionRenderer.setMegaLayer 切层 → 旧层 ghost 撤回 → 新层注入 → 世界只剩该层
 *   7. currentRenderLayer / layerRenderMode 同步，且 applyLayer 对 MEGA 分流
 *   8. 状态不存在时返回 ok=false（不静默成功）
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');
const { GhostRenderer } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostRenderer.js'));
const { GhostGuard } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostGuard.js'));
const { WorldSnapshot } = require(path.join(PLUGIN, 'src', 'world', 'WorldSnapshot.js'));
const { BinaryChunkStorage } = require(path.join(PLUGIN, 'src', 'core', 'BinaryChunkStorage.js'));
const { MegaProjectionRenderer } = require(path.join(PLUGIN, 'src', 'render', 'MegaProjectionRenderer.js'));
const { ProjectionRenderer } = require(path.join(PLUGIN, 'src', 'render', 'ProjectionRenderer.js'));

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

// ── 假世界 ──────────────────────────────────────────────
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
    return {
        xuid,
        name: 'Steve',
        pos: { x: 0, y: 64, z: 0, dimid: 0 },
        said,
        tell(msg) { said.push(msg); },
    };
}

function makeHarness() {
    W.clear();
    PLAYER = mkPlayer();

    const registry = {
        ready: true,
        genericId: 'lit:g_generic',
        isGhost: (t) => typeof t === 'string' && t.startsWith('lit:g_'),
        resolve: () => 'lit:g_stone',
    };

    const expectMap = new Map();
    const expectStore = {
        set(d, x, y, z, gid) { expectMap.set(wkey(x, y, z, d), { ghostId: gid }); },
        del(d, x, y, z) { expectMap.delete(wkey(x, y, z, d)); },
        get(d, x, y, z) { return expectMap.get(wkey(x, y, z, d)) || null; },
        count() { return expectMap.size; },
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megalayer-'));
    const snapshot = new WorldSnapshot({ dataDir: tmpDir, logger: silentLogger, isGhost: registry.isGhost });

    const gr = new GhostRenderer({
        registry,
        expectStore,
        addonCheck: { isEnabled: () => true },
        snapshot,
        guard: new GhostGuard(registry),
        logger: silentLogger,
        writesPerTick: 1000,
        maxBlocks: 60000,
        retryBatch: 10000,
        overwriteReplaceable: true,
    });

    const storage = new BinaryChunkStorage(tmpDir);
    const mgr = {
        readCalls: [],
        loadChunkIndex(id) { return storage.loadChunkIndex(id); },
        loadChunkFromDisk(id, cx, cy, cz) {
            this.readCalls.push(`${cx},${cy},${cz}`);
            return storage.readChunkRaw(id, cx, cy, cz);
        },
        getBlocksNear() { return []; },
    };

    global.ghostRenderer = gr;
    global.renderer = { appendBlocks: (xuid, blocks) => gr.appendBlocks(xuid, blocks) };
    global.configManager = { get: (k, def) => (k === 'render.enableMega' ? true : def) };

    const mega = new MegaProjectionRenderer(mgr);
    global.megaRenderer = mega;

    const pr = new ProjectionRenderer({ ghostRenderer: gr, logger: silentLogger });

    return { gr, storage, mgr, mega, snapshot, expectStore, expectMap, tmpDir, player: PLAYER, pr };
}

/**
 * 两个分块：
 *   chunk(0,0,0) —— y=0 一层 1 块 + y=2 一层 3 块（同一分块里的两层，用来验证块内过滤）
 *   chunk(0,1,0) —— y=35 一层 1 块（落到 cy=1 那一行，验证分块行筛选）
 */
function seedChunks(h, schematicId) {
    h.storage.ensureSchematicDir(schematicId);
    const index = new Map();

    const c000 = [
        { pos: [0, 0, 0], name: 'minecraft:stone', state: {} },
        { pos: [1, 2, 3], name: 'minecraft:stone', state: {} },
        { pos: [2, 2, 3], name: 'minecraft:stone', state: {} },
        { pos: [3, 2, 3], name: 'minecraft:stone', state: {} },
    ];
    h.storage.writeChunk(schematicId, 0, 0, 0, c000, c000.length);
    index.set('0,0,0', c000.length);

    const c010 = [{ pos: [1, 35, 3], name: 'minecraft:stone', state: {} }];
    h.storage.writeChunk(schematicId, 0, 1, 0, c010, c010.length);
    index.set('0,1,0', c010.length);

    h.storage.saveChunkIndex(schematicId, index);
    return index;
}

function mkMegaProjection(schematicId) {
    return {
        id: 'proj-mega',
        name: '超大投影',
        isMega: true,
        schematicId,
        blocks: [],
        totalBlocks: 5,
        dimensions: { x: 32, y: 64, z: 32 },
        position: { x: 100, y: 64, z: 100 },
        rotation: 0,
        mirrorX: false,
        mirrorZ: false,
    };
}

/** 把 mega 注入推进到底 + 把 ghost 队列铺完 */
function flush(h, max = 200) {
    for (let i = 0; i < max; i++) {
        h.mega.onTick();
        h.gr.tick(1000);
    }
}

/** 世界里所有 ghost 坐标（排序后，便于逐格断言） */
function ghosts() {
    const out = [];
    for (const [k, v] of W) {
        if (v.type && v.type.startsWith('lit:g_')) out.push(k);
    }
    return out.sort();
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

console.log('\n=== MEGA 逐层显示 ===');

check('setLayerMode：只留该层所在的分块行（cy = floor(layer/32)）', () => {
    const h = makeHarness();
    seedChunks(h, 's1');
    const st = h.mega.initRenderState(h.player, 's1', mkMegaProjection('s1'));
    assert.deepStrictEqual(st.chunkKeys, ['0,0,0', '0,1,0']);

    const r = h.mega.setLayerMode('P1_s1', 2);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.chunks, 1);
    assert.deepStrictEqual(st.chunkKeys, ['0,0,0']);
    assert.strictEqual(st.isLayerMode, true);
    assert.strictEqual(st.currentLayer, 2);
});

check('分块内按 y 精确过滤：第 2 层只出 y=2，不带出同块 y=0', () => {
    const h = makeHarness();
    seedChunks(h, 's1');
    const proj = mkMegaProjection('s1');
    h.mega.initRenderState(h.player, 's1', proj);
    h.gr.enqueue(h.player, proj, { deferBlocks: true });

    h.mega.setLayerMode('P1_s1', 2);
    flush(h);

    assert.deepStrictEqual(ghosts(), ['0:101,66,103', '0:102,66,103', '0:103,66,103']);
});

check('第 35 层 → 走 cy=1 那一行分块，世界只剩 1 格', () => {
    const h = makeHarness();
    seedChunks(h, 's1');
    const proj = mkMegaProjection('s1');
    const st = h.mega.initRenderState(h.player, 's1', proj);
    h.gr.enqueue(h.player, proj, { deferBlocks: true });

    h.mega.setLayerMode('P1_s1', 35);
    assert.deepStrictEqual(st.chunkKeys, ['0,1,0']);
    flush(h);
    assert.deepStrictEqual(ghosts(), ['0:101,99,103']);
});

check('切层重置游标与计数（不接着上一轮 cursor 跑）', () => {
    const h = makeHarness();
    seedChunks(h, 's1');
    const proj = mkMegaProjection('s1');
    const st = h.mega.initRenderState(h.player, 's1', proj);
    h.gr.enqueue(h.player, proj, { deferBlocks: true });
    flush(h);
    assert.strictEqual(st.done, true);
    assert.strictEqual(st.cursor, 2);

    h.mega.setLayerMode('P1_s1', 2);
    assert.strictEqual(st.cursor, 0);
    assert.strictEqual(st.done, false);
    assert.strictEqual(st.injectedBlocks, 0);
});

check('回切 -1 恢复全量：allChunkKeys 不被层模式破坏', () => {
    const h = makeHarness();
    seedChunks(h, 's1');
    const proj = mkMegaProjection('s1');
    const st = h.mega.initRenderState(h.player, 's1', proj);
    h.gr.enqueue(h.player, proj, { deferBlocks: true });

    h.mega.setLayerMode('P1_s1', 2);
    assert.strictEqual(st.chunkKeys.length, 1);
    const r = h.mega.setLayerMode('P1_s1', -1);
    assert.strictEqual(r.chunks, 2);
    assert.deepStrictEqual(st.chunkKeys, ['0,0,0', '0,1,0']);
    assert.strictEqual(st.isLayerMode, false);
    flush(h);
    assert.strictEqual(ghosts().length, 5, '全量应为 5 格');
});

check('同层且未注入完 → 幂等返回 unchanged', () => {
    const h = makeHarness();
    seedChunks(h, 's1');
    h.mega.initRenderState(h.player, 's1', mkMegaProjection('s1'));
    const a = h.mega.setLayerMode('P1_s1', 2);
    const b = h.mega.setLayerMode('P1_s1', 2);
    assert.strictEqual(a.ok, true);
    assert.strictEqual(b.unchanged, true);
});

check('状态不存在 → ok=false（不静默成功）', () => {
    const h = makeHarness();
    const r = h.mega.setLayerMode('nope', 3);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no-state');
});

check('真链路：setMegaLayer 第 2 层 → 世界只剩 3 格，且开关/层号同步', () => {
    const h = makeHarness();
    seedChunks(h, 's1');
    const proj = mkMegaProjection('s1');

    // startRender 自愈建立注入状态 + 空会话
    assert.strictEqual(h.pr.startRender(h.player, proj, -1), true);
    flush(h);
    assert.strictEqual(ghosts().length, 5);

    const r = h.pr.setMegaLayer(h.player, proj, 2);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.chunks, 1);
    flush(h);

    assert.deepStrictEqual(ghosts(), ['0:101,66,103', '0:102,66,103', '0:103,66,103']);
    assert.strictEqual(h.pr.currentRenderLayer.get('P1'), 2);
    assert.strictEqual(h.pr.layerRenderMode.get('P1'), true);
    assert.strictEqual(h.expectStore.count(), 3, '期望账本只应留该层 3 格');
});

check('真链路：切到第 35 层 → 旧层 ghost 撤回（世界不再有 y=66）', () => {
    const h = makeHarness();
    seedChunks(h, 's1');
    const proj = mkMegaProjection('s1');
    h.pr.startRender(h.player, proj, -1);
    flush(h);
    h.pr.setMegaLayer(h.player, proj, 2);
    flush(h);

    h.pr.setMegaLayer(h.player, proj, 35);
    flush(h);
    assert.deepStrictEqual(ghosts(), ['0:101,99,103']);
    assert.strictEqual(h.expectStore.count(), 1);
});

check('真链路：切回全部层 → 5 格重建', () => {
    const h = makeHarness();
    seedChunks(h, 's1');
    const proj = mkMegaProjection('s1');
    h.pr.startRender(h.player, proj, -1);
    flush(h);
    h.pr.setMegaLayer(h.player, proj, 2);
    flush(h);

    const r = h.pr.setMegaLayer(h.player, proj, -1);
    assert.strictEqual(r.ok, true);
    flush(h);
    assert.strictEqual(ghosts().length, 5);
    assert.strictEqual(h.pr.layerRenderMode.get('P1'), false);
    assert.strictEqual(h.pr.currentRenderLayer.get('P1'), -1);
});

check('applyLayer 对 MEGA 分流到 setMegaLayer', () => {
    const h = makeHarness();
    seedChunks(h, 's1');
    const proj = mkMegaProjection('s1');
    h.pr.startRender(h.player, proj, -1);
    flush(h);

    const r = h.pr.applyLayer(h.player, proj, 2);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.chunks, 1);
    flush(h);
    assert.strictEqual(ghosts().length, 3);
});

console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
