/**
 * test_ghost_writegate.js — 写闸门的离线测试
 *
 * 背景：addon 版本对不上时，插件不能往世界写 ghost（客户端认不出的 ID）。
 * 处置是"关写闸"，但判定层（isAirLike）、期望集合、事件记账都要照常。
 *
 * 覆盖：
 *   1. 关闸后 placeGhost 不写世界，返回 skipped
 *   2. 关闸后 restoreAll 不写、total 仍能报出真实期望数
 *   3. 关闸后 retryPending 不动队列
 *   4. 关闸时清掉重试定时器（不会残留轮询）
 *   5. 重新开闸后恢复正常写入
 *   6. 关闸不影响 isAirLike 判定（下游功能依赖该判定）
 *
 * 运行：node tests/test_ghost_writegate.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN = path.resolve(__dirname, '..');
const { GhostExpectStore } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostExpectStore.js'));
const { GhostGuard } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostGuard.js'));

const world = new Map();
const listeners = new Map();
const key = (x, y, z, d) => `${d}:${x},${y},${z}`;
const setRaw = (x, y, z, d, type, data = 0) => world.set(key(x, y, z, d), { type, tileData: data });
const getRaw = (x, y, z, d) => world.get(key(x, y, z, d)) || { type: 'minecraft:air', tileData: 0 };

let setBlockCalls = 0;
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
        setBlockCalls++;
        setRaw(x, y, z, dimid, type, data || 0);
        return true;
    },
};

const registry = {
    isGhost: (t) => typeof t === 'string' && t.startsWith('lit:g_'),
    ids: ['lit:g_stone'],
    genericId: 'lit:g_generic',
    ready: true,
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostgate-'));
let pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) { console.log(`  ❌ ${name}`); console.log(`     ${e.message}`); fail++; }
}

const store = new GhostExpectStore({ dataDir: tmpDir }).load();
const guard = new GhostGuard(registry);
guard.install({ expectStore: store });

const D = 0, X = 5, Y = 64, Z = 5;
setRaw(X, Y, Z, D, 'minecraft:air');
store.set(D, X, Y, Z, 'lit:g_stone');

console.log('=== ghost 写闸门 ===');

// 1. 关闸
check('setWritesEnabled(false) 生效', () => {
    assert.strictEqual(guard.setWritesEnabled(false, 'addon 版本不一致'), false);
    assert.strictEqual(guard.writesEnabled, false);
    assert.strictEqual(guard.disabledReason, 'addon 版本不一致');
});

// 2. 事件补写被拦
check('关闸后 placeGhost 不写世界并返回 skipped', () => {
    const before = setBlockCalls;
    const r = guard.placeGhost({ x: X, y: Y, z: Z, dimid: D }, 'lit:g_stone', 'break');
    assert.strictEqual(r, 'skipped');
    assert.strictEqual(setBlockCalls, before, 'shold not call mc.setBlock');
    assert.strictEqual(getRaw(X, Y, Z, D).type, 'minecraft:air');
});

// 3. restoreAll 被拦，但 total 仍准确
check('关闸后 restoreAll 不写、total 仍是期望数', () => {
    const before = setBlockCalls;
    const r = guard.restoreAll('test');
    assert.strictEqual(r.placed, 0);
    assert.strictEqual(r.total, store.count());
    assert.strictEqual(setBlockCalls, before);
});

// 4. retryPending 不动
check('关闸后 retryPending 不消耗队列', () => {
    guard.pending.set(`${D}:1,1,1`, { dimid: D, x: 1, y: 1, z: 1, ghostId: 'lit:g_stone', attempts: 1 });
    const r = guard.retryPending('test');
    assert.strictEqual(r.placed, 0);
    assert.strictEqual(guard.pending.size, 1);
    guard.pending.clear();
});

// 5. 关闸时清掉重试定时器
check('关闸时清掉重试定时器', () => {
    guard._retryTimer = setTimeout(() => { }, 10000);
    guard.setWritesEnabled(false, 'again');
    assert.strictEqual(guard._retryTimer, null);
});

// 6. isAirLike 不受影响
check('关闸不影响 isAirLike 判定', () => {
    assert.strictEqual(guard.isAirLike('lit:g_stone'), true);
    assert.strictEqual(guard.isAirLike('minecraft:stone'), false);
    assert.strictEqual(guard.isAirLike(null), true);
});

// 7. 重新开闸后恢复
check('重新开闸后能正常写入', () => {
    guard.setWritesEnabled(true);
    const before = setBlockCalls;
    const r = guard.restoreAll('reopen');
    assert.strictEqual(r.placed, 1);
    assert.ok(setBlockCalls > before);
    assert.strictEqual(getRaw(X, Y, Z, D).type, 'lit:g_stone');
    assert.strictEqual(guard.disabledReason, null);
});

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
if (fail) process.exitCode = 1;
