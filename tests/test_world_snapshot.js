/**
 * test_world_snapshot.js — WorldSnapshot 离线测试（内存假世界，跑真代码）
 *
 * 覆盖快照契约与三条还原安全规则：
 *   1. begin / record：同一格只记首次（最初状态才是还原目标）
 *   2. persist → 落盘；重新 load 能读回（崩溃恢复的前提）
 *   3. revert：按 y 从高到低；ghost → 写回原方块；被玩家改成真方块 → 跳过不覆盖
 *   4. 原本空气+当前空气 → 跳过（省 setBlock）
 *   5. 写失败（区块没加载）→ 留在快照里，下次再试
 *   6. limit 分批 → remaining 正确
 *   7. close：还原后删文件；有残留则保留文件
 *   8. restoreOrphaned：启动收拾上次未还原的会话
 *   9. 坏文件 → .corrupt 备份，不覆盖原内容
 *  10. 空会话不落盘（不留垃圾文件）
 *
 * 运行：node tests/test_world_snapshot.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN = path.resolve(__dirname, '..');
const { WorldSnapshot, posKey } = require(path.join(PLUGIN, 'src', 'world', 'WorldSnapshot.js'));

// ── 假世界（可控失败 + 可控未加载） ──────────────────────
const world = new Map();
const setLog = [];
let failSetAt = new Set();      // "x,y,z" 集合：这些坐标的 setBlock 返回 false
const unloaded = new Set();     // "x,y,z" 集合：模拟区块未加载 → getBlock 返回 null
const key = (x, y, z, d) => `${d}:${x},${y},${z}`;
const setRaw = (x, y, z, d, type, data = 0) => world.set(key(x, y, z, d), { type, tileData: data });
// 真实 BDS 对空气格返回空气方块对象（不是 null）；null 只代表"区块未加载"
const getRaw = (x, y, z, d) => world.get(key(x, y, z, d)) || { type: 'minecraft:air', tileData: 0 };

global.mc = {
    getBlock(x, y, z, dimid) {
        if (unloaded.has(posKey(x, y, z))) return null;
        const b = getRaw(x, y, z, dimid);
        return { type: b.type, tileData: b.tileData, isAir: b.type === 'minecraft:air', pos: { x, y, z, dimid } };
    },
    setBlock(x, y, z, dimid, type, data) {
        if (failSetAt.has(posKey(x, y, z))) return false;
        setLog.push(`${x},${y},${z}`);
        setRaw(x, y, z, dimid, type, data || 0);
        return true;
    },
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnap-'));
let pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) { console.log(`  ❌ ${name}`); console.log(`     ${e.message}`); fail++; }
}

const D = 0;
const A = [1, 64, 1], B = [2, 65, 2], C = [3, 66, 3];

console.log('=== WorldSnapshot ===');

// ── 1. 登记与去重 ──
const snap = new WorldSnapshot({ dataDir: tmpDir }).load();
snap.begin('s1', D);
snap.record('s1', A[0], A[1], A[2], { type: 'minecraft:stone', tileData: 0 });
check('第一次 record 成功', () => assert.strictEqual(snap.size('s1'), 1));
check('同一格重复 record 不覆盖（保留最初状态）', () => {
    const added = snap.record('s1', A[0], A[1], A[2], { type: 'minecraft:dirt' });
    assert.strictEqual(added, false);
    assert.strictEqual(snap.get('s1', A[0], A[1], A[2]).type, 'minecraft:stone');
});

// ── 2. 落盘与重载 ──
snap.record('s1', B[0], B[1], B[2], { type: 'minecraft:air' });
snap.record('s1', C[0], C[1], C[2], { type: 'minecraft:oak_planks', tileData: 2 });
check('persist 落盘成功', () => assert.strictEqual(snap.persist('s1'), true));
check('文件存在', () => assert.ok(fs.existsSync(path.join(tmpDir, 's1.json'))));

const reloaded = new WorldSnapshot({ dataDir: tmpDir }).load();
check('重载后会话数一致', () => assert.strictEqual(reloaded.stats().sessions, 1));
check('重载后格数与原始状态一致', () => {
    assert.strictEqual(reloaded.size('s1'), 3);
    assert.strictEqual(reloaded.get('s1', C[0], C[1], C[2]).type, 'minecraft:oak_planks');
    assert.strictEqual(reloaded.get('s1', C[0], C[1], C[2]).data, 2);
});

// ── 3. revert：ghost → 原方块；真方块 → 跳过 ──
// 摆好世界：A 是 ghost（要还原成 stone）、B 是空气（原也是空气 → 跳过）、C 被玩家换成真方块（跳过）
setRaw(A[0], A[1], A[2], D, 'lit:g_stone');
setRaw(C[0], C[1], C[2], D, 'minecraft:diamond_block');
setLog.length = 0;
const r1 = reloaded.revert('s1', { limit: 1000 });
check('还原 1 格（A）', () => assert.strictEqual(r1.restored, 1));
check('A 已变回 stone', () => assert.strictEqual(getRaw(A[0], A[1], A[2], D).type, 'minecraft:stone'));
check('C 保持玩家建筑不动', () => assert.strictEqual(getRaw(C[0], C[1], C[2], D).type, 'minecraft:diamond_block'));
check('B（原空气/现空气）计入 skipped', () => assert.strictEqual(r1.skipped, 1));
check('C 计入 kept（永久跳过并移出快照）', () => assert.strictEqual(r1.kept, 1));
check('revert 后快照清空', () => assert.strictEqual(r1.remaining, 0));

// ── 4. 还原顺序：y 从高到低 ──
{
    const s = new WorldSnapshot({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wsnap2-')) });
    s.begin('order', D);
    s.record('order', 0, 10, 0, { type: 'minecraft:stone' });
    s.record('order', 0, 12, 0, { type: 'minecraft:stone' });
    s.record('order', 0, 11, 0, { type: 'minecraft:stone' });
    setRaw(0, 10, 0, D, 'lit:g_stone');
    setRaw(0, 11, 0, D, 'lit:g_stone');
    setRaw(0, 12, 0, D, 'lit:g_stone');
    setLog.length = 0;
    s.revert('order', { limit: 1000 });
    check('写回顺序为 y 降序（12 → 11 → 10）', () => {
        const ys = setLog.map(k => Number(k.split(',')[1]));
        assert.deepStrictEqual(ys, [12, 11, 10]);
    });
}

// ── 5. 写失败留在快照里，下次再试 ──
{
    const s = new WorldSnapshot({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wsnap3-')) });
    s.begin('fail', D);
    s.record('fail', 7, 70, 7, { type: 'minecraft:stone' });
    setRaw(7, 70, 7, D, 'lit:g_stone');
    failSetAt = new Set([posKey(7, 70, 7)]);
    const r = s.revert('fail', { limit: 10 });
    check('写失败计 failed 且仍留在快照', () => {
        assert.strictEqual(r.failed, 1);
        assert.strictEqual(r.remaining, 1);
        assert.ok(s.get('fail', 7, 70, 7), '记录应保留');
    });
    failSetAt = new Set();
    const r2 = s.revert('fail', { limit: 10 });
    check('下次重试成功（区块加载后）', () => {
        assert.strictEqual(r2.restored, 1);
        assert.strictEqual(r2.remaining, 0);
        assert.strictEqual(getRaw(7, 70, 7, D).type, 'minecraft:stone');
    });
}

// ── 6. 分批 limit ──
{
    const s = new WorldSnapshot({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wsnap4-')) });
    s.begin('batch', D);
    for (let i = 0; i < 5; i++) {
        s.record('batch', 100 + i, 80, 0, { type: 'minecraft:stone' });
        setRaw(100 + i, 80, 0, D, 'lit:g_stone');
    }
    const r1b = s.revert('batch', { limit: 2 });
    check('第一批写 2 格、剩 3 格', () => {
        assert.strictEqual(r1b.restored, 2);
        assert.strictEqual(r1b.remaining, 3);
    });
    const r2b = s.revert('batch', { limit: 10 });
    check('第二批写完剩余 3 格', () => {
        assert.strictEqual(r2b.restored, 3);
        assert.strictEqual(r2b.remaining, 0);
    });
}

// ── 7. close：还原后删文件 ──
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnap5-'));
    const s = new WorldSnapshot({ dataDir: dir });
    s.begin('close1', D);
    s.record('close1', 30, 20, 30, { type: 'minecraft:stone' });
    s.persist('close1');
    setRaw(30, 20, 30, D, 'lit:g_stone');
    const r = s.close('close1');
    check('close 还原并删除文件', () => {
        assert.strictEqual(r.restored, 1);
        assert.strictEqual(r.removed, true);
        assert.strictEqual(fs.existsSync(path.join(dir, 'close1.json')), false);
    });

    // 有残留时不删文件
    s.begin('close2', D);
    s.record('close2', 31, 21, 31, { type: 'minecraft:stone' });
    setRaw(31, 21, 31, D, 'lit:g_stone');
    failSetAt = new Set([posKey(31, 21, 31)]);
    const r2 = s.close('close2');
    check('有残留 → 保留文件', () => {
        assert.strictEqual(r2.remaining, 1);
        assert.strictEqual(r2.removed, false);
        assert.ok(fs.existsSync(path.join(dir, 'close2.json')));
    });
    failSetAt = new Set();
}

// ── 8. restoreOrphaned ──
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnap6-'));
    const a = new WorldSnapshot({ dataDir: dir });
    a.begin('orphan', D);
    a.record('orphan', 40, 50, 40, { type: 'minecraft:stone' });
    a.record('orphan', 41, 50, 40, { type: 'minecraft:air' });
    a.persist('orphan');

    setRaw(40, 50, 40, D, 'lit:g_stone');   // ghost 残留
    // 41 是空气，原也是空气 → 跳过

    const b = new WorldSnapshot({ dataDir: dir }).load();
    const r = b.restoreOrphaned();
    check('restoreOrphaned 收拾 1 个会话、还原 1 格', () => {
        assert.strictEqual(r.sessions, 1);
        assert.strictEqual(r.restored, 1);
        assert.strictEqual(r.remaining, 0);
    });
    check('无主会话文件已删除', () => assert.strictEqual(fs.existsSync(path.join(dir, 'orphan.json')), false));
    check('世界已还原为 stone', () => assert.strictEqual(getRaw(40, 50, 40, D).type, 'minecraft:stone'));
}

// ── 9. 坏文件 → .corrupt ──
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnap7-'));
    fs.writeFileSync(path.join(dir, 'broken.json'), '{ this is not json', 'utf8');
    const s = new WorldSnapshot({ dataDir: dir }).load();
    check('坏文件不崩、改名 .corrupt', () => {
        assert.strictEqual(s.stats().sessions, 0);
        assert.ok(fs.existsSync(path.join(dir, 'broken.json.corrupt')));
    });
}

// ── 10. 空会话不落盘 ──
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsnap8-'));
    const s = new WorldSnapshot({ dataDir: dir });
    s.begin('empty', D);
    check('空会话 persist 返回 false 且不建文件', () => {
        assert.strictEqual(s.persist('empty'), false);
        assert.strictEqual(fs.existsSync(path.join(dir, 'empty.json')), false);
    });
}

// ── 11. 复用同名会话不覆盖（上次没还原的场景） ──
check('begin 已存在会话 → 复用不覆盖', () => {
    const s = new WorldSnapshot({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wsnap9-')) });
    s.begin('dup', D);
    s.record('dup', 1, 1, 1, { type: 'minecraft:stone' });
    const again = s.begin('dup', D);
    assert.strictEqual(again.blocks.size, 1);
});

// ── 12. 区块未加载（getBlock 返回 null）→ 不盲写、留着下次 ──
{
    const s = new WorldSnapshot({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wsnap10-')) });
    s.begin('unloaded', D);
    s.record('unloaded', 50, 60, 50, { type: 'minecraft:stone' });
    unloaded.add(posKey(50, 60, 50));
    setLog.length = 0;
    const r = s.revert('unloaded', { limit: 10 });
    check('未加载时不计还原、不写世界，记录保留', () => {
        assert.strictEqual(r.restored, 0);
        assert.strictEqual(r.failed, 1);
        assert.strictEqual(r.remaining, 1);
        assert.strictEqual(setLog.length, 0, '不该盲写');
    });
    unloaded.clear();
    setRaw(50, 60, 50, D, 'lit:g_stone');
    const r2 = s.revert('unloaded', { limit: 10 });
    check('区块加载后重试成功', () => {
        assert.strictEqual(r2.restored, 1);
        assert.strictEqual(getRaw(50, 60, 50, D).type, 'minecraft:stone');
    });
}

// ── 13. shouldRestore 过滤：期望仍认的格不还原（保住"重启后幽灵自动补回"） ──
{
    const s = new WorldSnapshot({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wsnap11-')) });
    s.begin('hold', D);
    s.record('hold', 60, 64, 60, { type: 'minecraft:stone' });   // 期望仍认 → 保留
    s.record('hold', 61, 64, 60, { type: 'minecraft:stone' });   // 期望已不认 → 还原（撤销做了一半）
    setRaw(60, 64, 60, D, 'lit:g_stone');
    setRaw(61, 64, 60, D, 'lit:g_stone');
    const held = new Set([posKey(60, 64, 60)]);
    const r = s.revert('hold', { limit: 10, shouldRestore: (d, x, y, z) => !held.has(posKey(x, y, z)) });
    check('shouldRestore=false 的格保留（held）不写', () => {
        assert.strictEqual(r.held, 1);
        assert.strictEqual(r.restored, 1);
        assert.strictEqual(r.remaining, 1);
        assert.strictEqual(getRaw(60, 64, 60, D).type, 'lit:g_stone', '期望仍认的幽灵必须留着');
        assert.strictEqual(getRaw(61, 64, 60, D).type, 'minecraft:stone');
    });
    check('保留的格仍在快照里（日后可撤销）', () => assert.ok(s.get('hold', 60, 64, 60)));
}

// ── 14. findSessions：崩溃后按前缀找回会话 ──
{
    const s = new WorldSnapshot({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'wsnap12-')) });
    s.begin('probe-253540-0-111', D).blocks.set(posKey(1, 2, 3), { x: 1, y: 2, z: 3, type: 'minecraft:stone', data: 0, nbt: null });
    s.begin('probe-999-0-222', D).blocks.set(posKey(4, 5, 6), { x: 4, y: 5, z: 6, type: 'minecraft:stone', data: 0, nbt: null });
    check('按前缀只找回自己的会话', () => {
        const mine = s.findSessions('probe-253540');
        assert.strictEqual(mine.length, 1);
        assert.strictEqual(mine[0].sessionId, 'probe-253540-0-111');
    });
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
if (fail) process.exitCode = 1;
