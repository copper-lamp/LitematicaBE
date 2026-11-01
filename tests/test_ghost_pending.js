/**
 * test_ghost_pending.js — 验证「区块未加载导致补写失败」这条现实路径的处理逻辑
 *
 * 复现 1.1.5 实测：onServerStarted 时 35 格全部补写失败（区块没进内存）。
 * 期望行为：失败不刷屏、进待恢复队列、可重试成功、主世界用 tickingarea 强制加载。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN = path.resolve(__dirname, '..');
const { GhostExpectStore } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostExpectStore.js'));
const { GhostGuard } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostGuard.js'));

// ── 假世界：unloaded=true 时模拟"区块不在内存里"；unloadedDims 按维度模拟 ──
let unloaded = false;
const unloadedDims = new Set();
const world = new Map();
const key = (x, y, z, d) => `${d}:${x},${y},${z}`;
const cmds = [];
const logs = [];
const listeners = new Map();

const off = (dimid) => unloaded || unloadedDims.has(dimid);

global.mc = {
    listen(name, cb) {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(cb);
    },
    getBlock(x, y, z, dimid) {
        if (off(dimid)) return null;                     // 未加载
        const b = world.get(key(x, y, z, dimid));
        return b ? { type: b, isAir: b === 'minecraft:air', pos: { x, y, z, dimid } }
            : { type: 'minecraft:air', isAir: true, pos: { x, y, z, dimid } };
    },
    setBlock(x, y, z, dimid, type) {
        if (off(dimid)) return false;                    // 未加载 → 写失败
        world.set(key(x, y, z, dimid), type);
        return true;
    },
    runcmdEx(cmd) {
        cmds.push(cmd);
        return { success: true, output: '' };
    },
};
const fire = (name, ...args) => (listeners.get(name) || []).forEach(cb => cb(...args));

const logger = {
    info: (m) => logs.push(['INFO', m]),
    warn: (m) => logs.push(['WARN', m]),
    debug: () => {},
};

const registry = { isGhost: (t) => typeof t === 'string' && t.startsWith('lit:g_') };
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostpending-'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) { console.log(`  ❌ ${name}`); console.log(`     ${e.message}`); fail++; }
}

(async () => {
    const store = new GhostExpectStore({ dataDir: tmpDir }).load();
    const guard = new GhostGuard(registry);
    guard.install({ expectStore: store, logger });

    // 铺 35 格（复现实测规模）
    for (let i = 0; i < 35; i++) {
        const x = 59 + (i % 7), z = -7 + Math.floor(i / 7);
        store.set(0, x, 64, z, 'lit:g_stone');
    }

    // 1. 区块未加载时启动补齐
    unloaded = true;
    const r1 = guard.restoreAll('serverStarted');
    check('未加载时全部进待恢复队列，不硬报错', () => {
        assert.strictEqual(r1.total, 35);
        assert.strictEqual(r1.placed, 0);
        assert.strictEqual(r1.failed, 35);
        assert.strictEqual(r1.pending, 35);
        assert.strictEqual(guard.pending.size, 35);
    });

    check('日志是一行汇总 + 一行诊断，不是 35 条刷屏', () => {
        const warns = logs.filter(l => l[0] === 'WARN' && l[1].includes('[GhostGuard]'));
        assert.ok(warns.length <= 2, `WARN 条数 ${warns.length}，应 <= 2`);
        assert.ok(logs.some(l => l[1].includes('期望补齐(serverStarted)：0 补写 / 0 已有方块跳过 / 35 待重试')));
    });

    // 2. 区块加载后重试
    unloaded = false;
    const r2 = guard.retryPending('manual');
    check('区块加载后重试全部补齐', () => {
        assert.strictEqual(r2.placed, 35);
        assert.strictEqual(guard.pending.size, 0);
        assert.strictEqual(world.get(key(59, 64, -7, 0)), 'lit:g_stone');
    });

    // 3. tickingarea 强制加载路径（先用掉 dim0 的 35 格期望，留下 2 条新期望）
    store.set(0, 200, 64, 200, 'lit:g_stone');
    store.set(1, 5, 64, 5, 'lit:g_stone');      // 非主世界：不该被 tickingarea 处理
    unloadedDims.add(1);                        // 下界区块始终未加载
    unloaded = true;
    guard.restoreAll('test');
    const pendingBefore = guard.pending.size;
    cmds.length = 0;
    const primed = guard._primeChunks();
    check('pending 非空时下发 tickingarea add（只针对主世界）', () => {
        assert.strictEqual(pendingBefore, 37);   // 35 旧 + 2 新：unloaded 时全部重新入队
        assert.strictEqual(primed, true);
        const adds = cmds.filter(c => c.startsWith('tickingarea add'));
        assert.ok(adds.length >= 1, `add 条数 ${adds.length}`);
        // tickingarea 参数是区块角点：(200,200) 所在区块角点为 (192,192)
        assert.ok(adds.some(c => c.includes('192 -64 192')), adds.join(' | '));
        // 主世界两片区域（59..65 / x 200）覆盖 3 个区块，不含 dim 1
        assert.strictEqual(adds.length, 3, `区块数应为 3，实得 ${adds.length}`);
    });

    unloaded = false;
    await sleep(950);
    check('tickingarea 之后自动重试并撤掉区域', () => {
        assert.strictEqual(world.get(key(200, 64, 200, 0)), 'lit:g_stone');
        assert.ok(cmds.some(c => c.startsWith('tickingarea remove')), '缺少 remove');
        assert.strictEqual(guard.pending.size, 1, '非主世界那一格应仍在队列');
    });

    // 4. 玩家自己盖上方块 → 该格退出队列
    const k1 = '1:5,64,5';
    assert.ok(guard.pending.has(k1), `队列里应有 ${k1}`);
    world.set(key(5, 64, 5, 1), 'minecraft:stone');     // 直接写世界（绕过"未加载"模拟）
    fire('afterPlaceBlock', null, { type: 'minecraft:stone', pos: { x: 5, y: 64, z: 5, dimid: 1 } });
    check('玩家盖上真方块后该格退出待恢复队列', () => {
        assert.ok(!guard.pending.has(k1), '应已从 pending 移除');
        assert.strictEqual(guard.stats.placeHits, 1);
    });

    // 5. 清理
    if (guard._retryTimer) { clearTimeout(guard._retryTimer); guard._retryTimer = null; }
    const s = guard.summary();
    console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
    console.log(`统计: 破坏命中 ${s.destroyHits} / 补写 ${s.restored} / 跳过 ${s.skipped} / 失败尝试 ${s.failed} / 队列峰值 ${s.pendingPeak}`);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(fail ? 1 : 0);
})();
