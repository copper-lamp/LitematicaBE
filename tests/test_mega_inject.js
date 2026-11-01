/**
 * test_mega_inject.js — MEGA 全量注入链路离线验收
 *
 * 不依赖 BDS：内存假世界 + 真 GhostRenderer + 真 WorldSnapshot + 真 BinaryChunkStorage（落 tmp 目录）
 *
 * 覆盖：
 *   1. deferBlocks：MEGA 投影建的是"空队列会话"，不走 extractor
 *   2. 注入顺序：分块按 y 从低到高
 *   3. 每 tick 只读 1 个分块（同步 IO 限量），不一次读爆
 *   4. 真 .mcmega 写盘 → chunk_index.json → 读回 → 变换 → 入队 → 世界
 *   5. appendBlocks 去重：同批方块重复注入不重复排队
 *   6. 坐标统一走 transformPosition（旋转 90° 与普通投影一致）
 *   7. 注入完成置 done，且给玩家提示
 *   8. 会话不存在时不读盘、不丢游标
 *   9. enableMega=false：不建状态、onTick 不干活
 *  10. 撤销：整会话 clear 后世界回到空气、期望账本清空
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');
const { GhostRenderer, transformPosition } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostRenderer.js'));
const { GhostGuard } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostGuard.js'));
const { WorldSnapshot } = require(path.join(PLUGIN, 'src', 'world', 'WorldSnapshot.js'));
const { BinaryChunkStorage } = require(path.join(PLUGIN, 'src', 'core', 'BinaryChunkStorage.js'));
const { MegaProjectionRenderer } = require(path.join(PLUGIN, 'src', 'render', 'MegaProjectionRenderer.js'));

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
    const p = {
        xuid,
        name: 'Steve',
        pos: { x: 0, y: 64, z: 0, dimid: 0 },
        said,
        tell(msg) { said.push(msg); },
    };
    return p;
}

// ── 组装 harness ─────────────────────────────────────────
function makeHarness(opts) {
    const o = opts || {};
    W.clear();
    PLAYER = mkPlayer();
    const said = PLAYER.said;

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

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megainject-'));
    const snapshot = new WorldSnapshot({
        dataDir: tmpDir,
        logger: silentLogger,
        isGhost: registry.isGhost,
    });

    const gr = new GhostRenderer({
        registry,
        expectStore,
        addonCheck: { isEnabled: () => true },
        snapshot,
        guard: new GhostGuard(registry),
        logger: silentLogger,
        writesPerTick: o.writesPerTick || 1000,
        maxBlocks: o.maxBlocks || 60000,
        retryBatch: 10000,
        overwriteReplaceable: true,
    });

    // 分块存储（真磁盘，tmp 目录）
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

    // MegaProjectionRenderer 走 global.renderer / global.ghostRenderer
    global.ghostRenderer = gr;
    global.renderer = { appendBlocks: (xuid, blocks) => gr.appendBlocks(xuid, blocks) };
    global.configManager = { get: (k, def) => (k === 'render.enableMega' ? o.enableMega !== false : def) };

    const mega = new MegaProjectionRenderer(mgr);

    return { gr, storage, mgr, mega, snapshot, expectStore, expectMap, tmpDir, said, player: PLAYER };
}

/** 写两个 32³ 分块：chunk(0,0,0) 3 块 + chunk(0,1,0) 1 块 */
function seedChunks(h, schematicId) {
    h.storage.ensureSchematicDir(schematicId);
    const index = new Map();

    const c000 = [
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

function mkMegaProjection(schematicId, extra) {
    return Object.assign({
        id: 'proj-mega',
        name: '超大投影',
        isMega: true,
        schematicId,
        blocks: [],
        totalBlocks: 4,
        dimensions: { x: 32, y: 64, z: 32 },
        position: { x: 100, y: 64, z: 100 },
        rotation: 0,
        mirrorX: false,
        mirrorZ: false,
    }, extra || {});
}

function drainGhost(gr, maxTicks = 500) {
    let ticks = 0;
    while (ticks < maxTicks) {
        let any = false;
        for (const s of gr.sessions.values()) {
            if (s.state === 'building' && s.cursor < s.queue.length) { any = true; break; }
        }
        if (!any) break;
        ticks++;
        gr.tick(1000);
    }
    return ticks;
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

console.log('\n=== MEGA 全量注入 ===');

check('deferBlocks：建空队列会话，不跑 extractor', () => {
    const h = makeHarness();
    const proj = mkMegaProjection('s1');
    const r = h.gr.enqueue(h.player, proj, { deferBlocks: true });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.count, 0);
    const s = h.gr.sessions.get('P1');
    assert.strictEqual(s.queue.length, 0);
    assert.ok(s.seen instanceof Set);
});

check('injected 顺序：分块按 y 从低到高', () => {
    const h = makeHarness();
    seedChunks(h, 's1');
    const proj = mkMegaProjection('s1');
    const st = h.mega.initRenderState(h.player, 's1', proj);
    assert.ok(st);
    assert.deepStrictEqual(st.chunkKeys, ['0,0,0', '0,1,0']);
    assert.strictEqual(st.chunkTotal, 2);
});

check('每 tick 只读 1 个分块（同步 IO 限量）', () => {
    const h = makeHarness();
    seedChunks(h, 's1');
    const proj = mkMegaProjection('s1');
    h.mega.initRenderState(h.player, 's1', proj);
    h.gr.enqueue(h.player, proj, { deferBlocks: true });

    h.mega.onTick();
    assert.strictEqual(h.mgr.readCalls.length, 1);
    h.mega.onTick();
    assert.strictEqual(h.mgr.readCalls.length, 2);
});

check('写盘→索引→注入：方块数、世界坐标都正确', () => {
    const h = makeHarness();
    seedChunks(h, 's1');
    const proj = mkMegaProjection('s1');
    const st = h.mega.initRenderState(h.player, 's1', proj);
    h.gr.enqueue(h.player, proj, { deferBlocks: true });

    h.mega.onTick();
    h.mega.onTick();

    assert.strictEqual(st.done, true);
    assert.strictEqual(st.injectedChunks, 2);
    assert.strictEqual(st.injectedBlocks, 4);
    assert.strictEqual(h.gr.sessions.get('P1').queue.length, 4);

    // position(100,64,100) + rel(1,2,3) = (101,66,103)；rel(1,35,3) = (101,99,103)
    const q = h.gr.sessions.get('P1').queue;
    assert.ok(q.some(e => e.x === 101 && e.y === 66 && e.z === 103), '低层方块应在 (101,66,103)');
    assert.ok(q.some(e => e.x === 101 && e.y === 99 && e.z === 103), '高层方块应在 (101,99,103)');
    assert.ok(h.said.some(m => m.includes('分块已全部入队')));
});

check('注入后 tick 铺满世界：世界 = ghost，期望 = 4 格', () => {
    const h = makeHarness();
    seedChunks(h, 's1');
    const proj = mkMegaProjection('s1');
    h.mega.initRenderState(h.player, 's1', proj);
    h.gr.enqueue(h.player, proj, { deferBlocks: true });
    h.mega.onTick();
    h.mega.onTick();
    drainGhost(h.gr);

    const ghosts = [...W.values()].filter(v => v.type === 'lit:g_stone').length;
    assert.strictEqual(ghosts, 4);
    assert.strictEqual(h.expectStore.count(), 4);
});

check('appendBlocks 去重：同批方块重复注入不重复排队', () => {
    const h = makeHarness();
    const proj = mkMegaProjection('s1');
    h.gr.enqueue(h.player, proj, { deferBlocks: true });

    const batch = [{ pos: [0, 0, 0], name: 'minecraft:stone' }, { pos: [1, 0, 0], name: 'minecraft:stone' }];
    let r = h.gr.appendBlocks('P1', batch);
    assert.strictEqual(r.added, 2);
    r = h.gr.appendBlocks('P1', batch);
    assert.strictEqual(r.added, 0);
    assert.strictEqual(r.dup, 2);
    assert.strictEqual(h.gr.sessions.get('P1').queue.length, 2);
});

check('坐标统一走 transformPosition：rotation=90 与普通投影一致', () => {
    const h = makeHarness();
    const proj = mkMegaProjection('s1', { rotation: 90, dimensions: { x: 4, y: 8, z: 6 } });
    h.gr.enqueue(h.player, proj, { deferBlocks: true });
    h.gr.appendBlocks('P1', [{ pos: [1, 2, 3], name: 'minecraft:stone' }]);

    const q = h.gr.sessions.get('P1').queue[0];
    const want = transformPosition([1, 2, 3], proj);
    assert.deepStrictEqual({ x: q.x, y: q.y, z: q.z }, want);
});

check('会话未建立：不读盘、游标不前进', () => {
    const h = makeHarness();
    seedChunks(h, 's1');
    const proj = mkMegaProjection('s1');
    const st = h.mega.initRenderState(h.player, 's1', proj);
    // 故意不入队会话
    h.mega.onTick();
    assert.strictEqual(h.mgr.readCalls.length, 0);
    assert.strictEqual(st.cursor, 0);
});

check('enableMega=false：不建状态、onTick 不干活', () => {
    const h = makeHarness({ enableMega: false });
    seedChunks(h, 's1');
    const proj = mkMegaProjection('s1');
    const st = h.mega.initRenderState(h.player, 's1', proj);
    assert.strictEqual(st, null);
    assert.strictEqual(h.mega.renderStates.size, 0);
    h.mega.onTick();
    assert.strictEqual(h.mega.tickCount, 0);
    assert.ok(h.said.some(m => m.includes('render.enableMega')));
});

check('撤销：整会话 clear 后世界回到空气、期望清空', () => {
    const h = makeHarness();
    seedChunks(h, 's1');
    const proj = mkMegaProjection('s1');
    h.mega.initRenderState(h.player, 's1', proj);
    h.gr.enqueue(h.player, proj, { deferBlocks: true });
    h.mega.onTick();
    h.mega.onTick();
    drainGhost(h.gr);
    assert.strictEqual(h.expectStore.count(), 4);

    const r = h.gr.clear(h.player);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(h.expectStore.count(), 0);
    assert.strictEqual([...W.values()].filter(v => v.type.startsWith('lit:g_')).length, 0);
    assert.strictEqual(h.gr.sessions.size, 0);
});

check('stopRender：注入状态被清掉', () => {
    const h = makeHarness();
    seedChunks(h, 's1');
    const proj = mkMegaProjection('s1');
    const st = h.mega.initRenderState(h.player, 's1', proj);
    h.mega.stopRender(st.stateId);
    assert.strictEqual(h.mega.renderStates.size, 0);
    assert.strictEqual(h.mega.getStats(st.stateId), null);
});

check('会话重建：done 后再次 init 会重置游标（否则死投影）', () => {
    const h = makeHarness();
    seedChunks(h, 's1');
    const proj = mkMegaProjection('s1');
    const st = h.mega.initRenderState(h.player, 's1', proj);
    h.gr.enqueue(h.player, proj, { deferBlocks: true });
    h.mega.onTick();
    h.mega.onTick();
    assert.strictEqual(st.done, true);

    // 模拟切层 / 重新加载：ghost 会话被重建（队列空了），注入状态还在
    h.gr.clear(h.player);
    h.gr.enqueue(h.player, proj, { deferBlocks: true });

    const again = h.mega.initRenderState(h.player, 's1', proj);
    assert.strictEqual(again, st, '同一个 stateId 应复用同一状态对象');
    assert.strictEqual(again.done, false);
    assert.strictEqual(again.cursor, 0);

    h.mega.onTick();
    h.mega.onTick();
    assert.strictEqual(h.gr.sessions.get('P1').queue.length, 4, '重建后应重新灌满 4 格');
});

console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
