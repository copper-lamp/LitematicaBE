/**
 * test_ghost_selfcheck.js — 自检命令的离线测试
 *
 * 覆盖 11 步正常路径 + 六类失败路径（每条都必须"失败但不留残留"）：
 *   1. 正常：11 步全过，世界回到空气，sessions 目录不残留
 *   2. 注册表未就绪 → 第 1 步失败即停
 *   3. 版本闸门关闭 → 第 2 步失败即停，且不写世界
 *   4. 未注入快照 → 第 3 步失败即停
 *   5. 找不到空气点（全实心）→ 选点失败
 *   6. setBlock 返回 false → 写入失败，快照清理干净
 *   7. setBlock "假成功"（模拟客户端没装 addon，写不进世界）→ 读回失败，兜底还原
 *   8. 建筑顶上不选点：下面不是空气就继续往上找
 *
 * 运行：node tests/test_ghost_selfcheck.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN = path.resolve(__dirname, '..');
const { GhostSelfCheck } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostSelfCheck.js'));
const { WorldSnapshot } = require(path.join(PLUGIN, 'src', 'world', 'WorldSnapshot.js'));

// ── 假世界 ──────────────────────────────────────────────
const world = new Map();
let failSet = false;         // setBlock 返回 false（区块未加载）
let phantomSet = false;      // setBlock 返回 true 但世界不变（模拟 addon 没装）
let solidCheck = null;       // (x,y,z) => true 表示该格是实心，覆盖默认空气

const key = (x, y, z, d) => `${d}:${x},${y},${z}`;
const setRaw = (x, y, z, d, type, data = 0) => world.set(key(x, y, z, d), { type, tileData: data });
const getRaw = (x, y, z, d) => {
    const k = key(x, y, z, d);
    if (world.has(k)) return world.get(k);
    if (solidCheck && solidCheck(x, y, z)) return { type: 'minecraft:stone', tileData: 0 };
    return { type: 'minecraft:air', tileData: 0 };
};

global.mc = {
    getBlock(x, y, z, dimid) {
        const b = getRaw(x, y, z, dimid);
        return { type: b.type, tileData: b.tileData, isAir: b.type === 'minecraft:air', pos: { x, y, z, dimid } };
    },
    setBlock(x, y, z, dimid, type, data) {
        if (failSet) return false;
        if (!phantomSet) setRaw(x, y, z, dimid, type, data || 0);
        return true;
    },
};

function fakePlayer(xuid = '2535400000000001') {
    const lines = [];
    return {
        xuid,
        pos: { x: 0.5, y: 64, z: 0.5, dimid: 0 },
        lines,
        tell(m) { lines.push(m); },
    };
}

const registryOk = {
    ready: true,
    ids: ['lit:g_stone', 'lit:g_dirt', 'lit:g_generic'],
    genericId: 'lit:g_generic',
    stats: () => ({ ready: true, addonVersion: [1, 1, 5], blockCount: 3, javaMapCount: 870 }),
};
const registryNotReady = { ready: false, ids: [], genericId: 'lit:g_generic', stats: () => ({ ready: false, loadError: 'ghost_index.json 不存在' }) };
const checkOn = { isEnabled: () => true, summary: () => ({ issues: [] }) };
const checkOff = { isEnabled: () => false, summary: () => ({ issues: [{ level: 'error', code: 'index-version-mismatch', message: '索引版本不一致' }] }) };

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'selfcheck-'));
let pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) { console.log(`  ❌ ${name}`); console.log(`     ${e.message}`); fail++; }
}
function reset() {
    failSet = false; phantomSet = false; solidCheck = null;
    world.clear();      // 否则上个用例遗留的空气/方块会盖住 solidCheck
}

console.log('=== /litematica selfcheck ===');

// ── 1. 正常路径 ──
{
    reset();
    const dir = tmp();
    const snap = new WorldSnapshot({ dataDir: path.join(dir, 'sessions') });
    const sc = new GhostSelfCheck({ registry: registryOk, addonCheck: checkOn, snapshot: snap });
    const p = fakePlayer();
    const r = sc.run(p);

    check('11 步全部通过', () => {
        assert.strictEqual(r.ok, true, '失败的步骤：' + JSON.stringify(r.steps.filter(s => !s.ok)));
        assert.strictEqual(r.passed, 11);
        assert.strictEqual(r.failed, 0);
    });
    check('测试点在玩家上方（y = 68）', () => assert.strictEqual(r.spot.y, 68));
    check('世界已还原成空气', () => {
        assert.strictEqual(getRaw(r.spot.x, r.spot.y, r.spot.z, 0).type, 'minecraft:air');
    });
    check('sessions 目录无残留', () => {
        assert.strictEqual(snap.stats().sessions, 0);
        const left = fs.readdirSync(path.join(dir, 'sessions')).filter(f => f.endsWith('.json'));
        assert.deepStrictEqual(left, []);
    });
    check('输出里有自检汇总行', () => {
        assert.ok(p.lines.some(l => l.includes('selfcheck 全部通过')), p.lines.join(' | '));
    });
}

// ── 2. 注册表未就绪 ──
{
    reset();
    const snap = new WorldSnapshot({ dataDir: path.join(tmp(), 'sessions') });
    const r = new GhostSelfCheck({ registry: registryNotReady, addonCheck: checkOn, snapshot: snap }).run(fakePlayer());
    check('注册表未就绪 → 停在第 1 步', () => {
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.steps.length, 1);
        assert.strictEqual(r.steps[0].name, '注册表就绪');
        assert.ok(r.steps[0].detail.includes('ghost_index'));
    });
}

// ── 3. 版本闸门关闭 ──
{
    reset();
    const snap = new WorldSnapshot({ dataDir: path.join(tmp(), 'sessions') });
    const p = fakePlayer();
    const r = new GhostSelfCheck({ registry: registryOk, addonCheck: checkOff, snapshot: snap }).run(p);
    check('版本不一致 → 停在第 2 步且不写世界', () => {
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.steps.length, 2);
        assert.strictEqual(r.steps[1].name, 'addon 版本校验');
        assert.strictEqual(getRaw(0, 68, 0, 0).type, 'minecraft:air');
        assert.ok(p.lines.some(l => l.includes('修复')));
    });
}

// ── 4. 未注入快照 ──
{
    reset();
    const r = new GhostSelfCheck({ registry: registryOk, addonCheck: checkOn, snapshot: null }).run(fakePlayer());
    check('无快照 → 停在第 3 步', () => {
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.steps.length, 3);
        assert.strictEqual(r.steps[2].name, '快照可用');
    });
}

// ── 5. 找不到空气点 ──
{
    reset();
    solidCheck = () => true;      // 全是实心
    const snap = new WorldSnapshot({ dataDir: path.join(tmp(), 'sessions') });
    const r = new GhostSelfCheck({ registry: registryOk, addonCheck: checkOn, snapshot: snap }).run(fakePlayer());
    check('全实心 → 选点失败', () => {
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.steps[r.steps.length - 1].name, '选取测试点');
    });
}

// ── 6. setBlock 返回 false ──
{
    reset();
    failSet = true;
    const dir = tmp();
    const snap = new WorldSnapshot({ dataDir: path.join(dir, 'sessions') });
    const r = new GhostSelfCheck({ registry: registryOk, addonCheck: checkOn, snapshot: snap }).run(fakePlayer());
    check('写失败 → 停在"写入幽灵方块"', () => {
        assert.strictEqual(r.ok, false);
        assert.ok(r.steps.some(s => s.name === '写入幽灵方块' && !s.ok));
    });
    check('写失败后快照被清理干净', () => {
        assert.strictEqual(snap.stats().sessions, 0);
        const left = fs.readdirSync(path.join(dir, 'sessions')).filter(f => f.endsWith('.json'));
        assert.deepStrictEqual(left, []);
    });
}

// ── 7. setBlock 假成功（客户端没装 addon） ──
{
    reset();
    phantomSet = true;
    const dir = tmp();
    const snap = new WorldSnapshot({ dataDir: path.join(dir, 'sessions') });
    const r = new GhostSelfCheck({ registry: registryOk, addonCheck: checkOn, snapshot: snap }).run(fakePlayer());
    check('读回不一致 → 停在"读回验证"', () => {
        assert.strictEqual(r.ok, false);
        assert.ok(r.steps.some(s => s.name === '读回验证' && !s.ok));
        const st = r.steps.find(s => s.name === '读回验证');
        assert.ok(st.detail.includes('addon'), '应提示 addon 是否安装：' + st.detail);
    });
    check('兜底清理把快照删掉了', () => {
        assert.strictEqual(snap.stats().sessions, 0);
    });
}

// ── 8. 建筑顶上不选点 ──
{
    reset();
    solidCheck = (x, y, z) => y === 68;   // 头顶 68 是实心，69 空气但下面实心
    const snap = new WorldSnapshot({ dataDir: path.join(tmp(), 'sessions') });
    const r = new GhostSelfCheck({ registry: registryOk, addonCheck: checkOn, snapshot: snap }).run(fakePlayer());
    check('跳过"悬在建筑顶上"的位置，选 y=70', () => {
        assert.strictEqual(r.ok, true, JSON.stringify(r.steps.filter(s => !s.ok)));
        assert.strictEqual(r.spot.y, 70);
    });
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
if (fail) process.exitCode = 1;
