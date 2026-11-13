/**
 * test_ghost_expect.js — 离线验证「ghost 期望集合 + 破坏后自动补回」的完整逻辑链
 *
 * 不依赖 BDS：用内存里的假世界 + 假 mc 接口，直接跑 GhostGuard / GhostExpectStore 的真代码。
 * 覆盖：
 *   1. 铺 ghost → 记录期望
 *   2. 玩家盖方块顶掉 ghost（replaceable 语义）→ 期望保留、世界不是 ghost
 *   3. 玩家破坏该方块 → onDestroyBlock → 自动补回 ghost
 *   4. restart：restoreAll 把空气格补回
 *   5. undo：删掉期望后，破坏不再补回
 *   6. 落盘 + 重新载入一致
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN = path.resolve(__dirname, '..');
const { GhostExpectStore } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostExpectStore.js'));
const { GhostGuard } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostGuard.js'));

// ── 假世界 ──────────────────────────────────────────────
const world = new Map();                 // "dim:x,y,z" -> {type, tileData}
const listeners = new Map();             // 事件名 -> [cb]
const key = (x, y, z, d) => `${d}:${x},${y},${z}`;
const setRaw = (x, y, z, d, type, data = 0) => world.set(key(x, y, z, d), { type, tileData: data });
const getRaw = (x, y, z, d) => world.get(key(x, y, z, d)) || { type: 'minecraft:air', tileData: 0 };

global.mc = {
    listen(name, cb) {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(cb);
    },
    getBlock(x, y, z, dimid) {
        const b = getRaw(x, y, z, dimid);
        return { type: b.type, tileData: b.tileData, isAir: b.type === 'minecraft:air', pos: { x, y, z, dimid } };
    },
    setBlock(x, y, z, dimid, type, data) {
        setRaw(x, y, z, dimid, type, data || 0);
        return true;
    },
};
const fire = (name, block) => (listeners.get(name) || []).forEach(cb => cb(null, block));

// ── 假注册表 ────────────────────────────────────────────
const registry = {
    isGhost: (t) => typeof t === 'string' && t.startsWith('lit:g_'),
    ids: ['lit:g_stone'],
    genericId: 'lit:g_generic',
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostexpect-'));
let pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) { console.log(`  ❌ ${name}`); console.log(`     ${e.message}`); fail++; }
}

(async () => {
    const store = new GhostExpectStore({ dataDir: tmpDir }).load();
    const guard = new GhostGuard(registry);
    guard.install({ expectStore: store });

    const D = 0, X = 10, Y = 64, Z = 10;

    // 1. 铺 ghost（等价于渲染器写一格 ghost 后登记期望）
    setRaw(X, Y, Z, D, 'lit:g_stone');
    store.set(D, X, Y, Z, 'lit:g_stone');
    check('铺 ghost 后期望集合有 1 条', () => assert.strictEqual(store.count(), 1));

    // 2. 玩家盖方块顶掉 ghost
    setRaw(X, Y, Z, D, 'minecraft:stone');
    fire('afterPlaceBlock', { type: 'minecraft:stone', pos: { x: X, y: Y, z: Z, dimid: D } });
    check('盖上方块后世界是真方块、期望仍在', () => {
        assert.strictEqual(getRaw(X, Y, Z, D).type, 'minecraft:stone');
        assert.strictEqual(store.count(), 1);
        assert.strictEqual(guard.stats.placeHits, 1);
    });

    // 3. 玩家破坏该方块 → 自动补回 ghost
    setRaw(X, Y, Z, D, 'minecraft:air');
    fire('onDestroyBlock', { type: 'minecraft:stone', pos: { x: X, y: Y, z: Z, dimid: D } });
    await new Promise(r => setTimeout(r, 40));
    check('破坏后 ghost 被自动补回', () => {
        assert.strictEqual(getRaw(X, Y, Z, D).type, 'lit:g_stone');
        assert.strictEqual(guard.stats.destroyHits, 1);
        assert.strictEqual(guard.stats.restored, 1);
    });

    // 3b. 不该乱盖：期望格的邻居被破坏时不动
    setRaw(X + 1, Y, Z, D, 'minecraft:air');
    fire('onDestroyBlock', { type: 'minecraft:dirt', pos: { x: X + 1, y: Y, z: Z, dimid: D } });
    await new Promise(r => setTimeout(r, 20));
    check('非期望格破坏不触发补写', () => {
        assert.strictEqual(getRaw(X + 1, Y, Z, D).type, 'minecraft:air');
        assert.strictEqual(guard.stats.destroyHits, 1);
    });

    // 4. 重启恢复：期望格是空气 → restoreAll 补回
    setRaw(X, Y, Z, D, 'minecraft:air');           // 模拟重启后世界丢了 ghost
    const r = guard.restoreAll('test');
    check('restoreAll 补回 1 格', () => {
        assert.strictEqual(r.placed, 1);
        assert.strictEqual(getRaw(X, Y, Z, D).type, 'lit:g_stone');
    });

    // 4b. 被别的真方块占据时不硬盖
    setRaw(X, Y, Z, D, 'minecraft:oak_planks');
    const r2 = guard.restoreAll('test2');
    check('已被真方块占据时跳过、不覆盖', () => {
        assert.strictEqual(r2.skipped, 1);
        assert.strictEqual(getRaw(X, Y, Z, D).type, 'minecraft:oak_planks');
    });

    // 5. undo：删掉期望后破坏不再补回
    store.del(D, X, Y, Z);
    setRaw(X, Y, Z, D, 'minecraft:air');
    fire('onDestroyBlock', { type: 'minecraft:oak_planks', pos: { x: X, y: Y, z: Z, dimid: D } });
    await new Promise(r => setTimeout(r, 20));
    check('undo 删掉期望后不再补回', () => {
        assert.strictEqual(getRaw(X, Y, Z, D).type, 'minecraft:air');
        assert.strictEqual(store.count(), 0);
    });

    // 6. 落盘 + 重新载入
    store.set(D, 1, 70, 2, 'lit:g_stone');
    store.set(1, 5, 5, 5, 'lit:g_stone');
    store.flush();
    const reloaded = new GhostExpectStore({ dataDir: tmpDir }).load();
    check('落盘后重新载入内容一致（含多维度）', () => {
        assert.strictEqual(reloaded.count(), 2);
        assert.ok(reloaded.get(D, 1, 70, 2));
        assert.ok(reloaded.get(1, 5, 5, 5));
        assert.strictEqual(reloaded.countDim(D), 1);
        assert.strictEqual(reloaded.countDim(1), 1);
    });

    // 7. 坏文件容错
    fs.writeFileSync(path.join(tmpDir, 'ghost_expect.json'), '{ this is not json', 'utf8');
    const broken = new GhostExpectStore({ dataDir: tmpDir }).load();
    check('坏文件不崩、改名 .corrupt、记录为空', () => {
        assert.strictEqual(broken.count(), 0);
        assert.ok(broken.loadError);
        assert.ok(fs.existsSync(path.join(tmpDir, 'ghost_expect.json.corrupt')));
    });

    console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
    console.log(`统计: 破坏命中 ${guard.stats.destroyHits} / 补写 ${guard.stats.restored} / 跳过 ${guard.stats.skipped} / 失败 ${guard.stats.failed}`);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(fail ? 1 : 0);
})();
