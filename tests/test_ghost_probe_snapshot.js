/**
 * test_ghost_probe_snapshot.js — 联调测试：探针铺墙 → 快照落盘 → undo 还原
 *
 * 跑真代码：GhostProbe + WorldSnapshot + GhostExpectStore（内存假世界 / 假 player）。
 *
 * 覆盖：
 *   1. lay 后世界出现幽灵、快照文件里记下原方块（数量一致）
 *   2. 快照记录的是**写之前**的状态（不会把幽灵本身记成原方块）
 *   3. undo 把世界还原成原样、删掉快照文件、清掉期望集合
 *   4. 玩家已在某格放了真方块 → undo 跳过该格，不覆盖建筑
 *   5. 再次 lay 会先自动还原上一面墙（不把两次铺墙混进同一会话）
 *   6. 未注入 snapshot 时退化为内存撤销（旧路径仍可用）
 *   7. 写闸门关掉时 lay / undo 都被拦住
 *
 * 运行：node tests/test_ghost_probe_snapshot.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN = path.resolve(__dirname, '..');
const { GhostProbe } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostProbe.js'));
const { WorldSnapshot } = require(path.join(PLUGIN, 'src', 'world', 'WorldSnapshot.js'));
const { GhostExpectStore } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostExpectStore.js'));

// ── 假世界 ──────────────────────────────────────────────
const world = new Map();
let failSet = new Set();
const key = (x, y, z, d) => `${d}:${x},${y},${z}`;
const setRaw = (x, y, z, d, type, data = 0) => world.set(key(x, y, z, d), { type, tileData: data });
const getRaw = (x, y, z, d) => world.get(key(x, y, z, d)) || { type: 'minecraft:air', tileData: 0 };

global.mc = {
    getBlock(x, y, z, dimid) {
        const b = getRaw(x, y, z, dimid);
        return { type: b.type, tileData: b.tileData, isAir: b.type === 'minecraft:air', pos: { x, y, z, dimid } };
    },
    setBlock(x, y, z, dimid, type, data) {
        if (failSet.has(`${x},${y},${z}`)) return false;
        setRaw(x, y, z, dimid, type, data || 0);
        return true;
    },
};

// ── 假注册表 / 假 addonCheck ────────────────────────────
const registry = {
    ready: true,
    loadError: null,
    ids: ['lit:g_stone', 'lit:g_dirt', 'lit:g_generic'],
    genericId: 'lit:g_generic',
    isGhost: (t) => typeof t === 'string' && t.startsWith('lit:g_'),
    stats: () => ({ ready: true, addonVersion: [1, 1, 5], blockCount: 3, javaMapCount: 870 }),
};
const addonCheckOn = { isEnabled: () => true, summary: () => ({ issues: [] }), summaryText: () => 'ok' };
const addonCheckOff = {
    isEnabled: () => false,
    summary: () => ({ issues: [{ level: 'error', code: 'index-version-mismatch', message: '版本不一致' }] }),
    summaryText: () => 'error',
};

function fakePlayer() {
    const lines = [];
    return {
        xuid: '2535400000000001',
        pos: { x: 0.5, y: 64, z: 0.5, dimid: 0 },
        direction: { yaw: 180 },      // 朝北 → facing (0,-1)
        lines,
        tell(m) { lines.push(m); },
    };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'probe-snap-'));
let pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) { console.log(`  ❌ ${name}`); console.log(`     ${e.message}`); fail++; }
}

console.log('=== 探针 + 快照联调 ===');

// ── 1. 铺墙 → 快照落盘 ──
{
    const dir = tmp();
    const expect = new GhostExpectStore({ dataDir: dir }).load();
    const snap = new WorldSnapshot({ dataDir: path.join(dir, 'sessions') });
    const probe = new GhostProbe(registry, expect, addonCheckOn, snap);

    // 预置原方块：第一层放石头（要能还原）、其余空气
    const p = fakePlayer();
    // 墙中心 = 玩家前方 4 格（朝北 → z-4），沿 x 展开 7 列 → x -3..3，z = -4，y = 64..68
    setRaw(0, 64, -4, 0, 'minecraft:stone');
    setRaw(1, 64, -4, 0, 'minecraft:water', 0);

    const ok = probe.lay(p, 7, 5);
    check('lay 返回 true', () => assert.strictEqual(ok, true));

    const sess = probe.sessions.get(p.xuid);
    check('铺了 35 格并生成会话 ID', () => {
        assert.strictEqual(sess.blocks.length, 35);
        assert.ok(sess.sessionId && sess.sessionId.startsWith('probe-'));
    });
    check('快照文件已落盘', () => {
        const f = path.join(dir, 'sessions', `${sess.sessionId}.json`);
        assert.ok(fs.existsSync(f), '快照文件不存在：' + f);
        const obj = JSON.parse(fs.readFileSync(f, 'utf8'));
        assert.strictEqual(obj.blocks.length, 35);
        assert.strictEqual(obj.dimid, 0);
    });
    check('快照记的是写之前的原方块', () => {
        const rec = snap.get(sess.sessionId, 0, 64, -4);
        assert.strictEqual(rec.type, 'minecraft:stone', '原来那格是石头');
        const recWater = snap.get(sess.sessionId, 1, 64, -4);
        assert.strictEqual(recWater.type, 'minecraft:water');
        const recAir = snap.get(sess.sessionId, 2, 64, -4);
        assert.strictEqual(recAir.type, 'minecraft:air');
    });
    check('世界里现在是幽灵方块', () => {
        assert.ok(getRaw(0, 64, -4, 0).type.startsWith('lit:g_'));
        assert.ok(getRaw(1, 64, -4, 0).type.startsWith('lit:g_'));
    });
    check('期望集合登记了 35 格', () => assert.strictEqual(expect.count(), 35));

    // ── 3. undo 还原 ──
    const ok2 = probe.undo(p);
    check('undo 返回 true 并打印还原数', () => {
        assert.strictEqual(ok2, true);
        assert.ok(p.lines.some(l => l.includes('已还原')));
    });
    check('世界还原：石头回来、水回来、空气回来', () => {
        assert.strictEqual(getRaw(0, 64, -4, 0).type, 'minecraft:stone');
        assert.strictEqual(getRaw(1, 64, -4, 0).type, 'minecraft:water');
        assert.strictEqual(getRaw(2, 64, -4, 0).type, 'minecraft:air');
    });
    check('快照文件已删除', () => {
        assert.strictEqual(fs.existsSync(path.join(dir, 'sessions', `${sess.sessionId}.json`)), false);
    });
    check('期望集合已清空', () => assert.strictEqual(expect.count(), 0));
    check('会话已从内存移除', () => assert.strictEqual(probe.sessions.has(p.xuid), false));
}

// ── 4. 玩家已放真方块 → 不覆盖 ──
{
    const dir = tmp();
    const snap = new WorldSnapshot({ dataDir: path.join(dir, 'sessions') });
    const probe = new GhostProbe(registry, null, addonCheckOn, snap);
    const p = fakePlayer();
    setRaw(0, 64, -4, 0, 'minecraft:stone');

    probe.lay(p, 7, 5);
    const sess = probe.sessions.get(p.xuid);
    // 玩家把其中一格换成自己的钻石块
    setRaw(-1, 66, -4, 0, 'minecraft:diamond_block');
    probe.undo(p);
    check('玩家放的方块被保留，未被覆盖', () => {
        assert.strictEqual(getRaw(-1, 66, -4, 0).type, 'minecraft:diamond_block');
    });
    check('其余格正常还原', () => {
        assert.strictEqual(getRaw(0, 64, -4, 0).type, 'minecraft:stone');
        assert.strictEqual(getRaw(0, 65, -4, 0).type, 'minecraft:air');
    });
    check('快照里该格已被移出（kept）', () => {
        assert.strictEqual(snap.get(sess.sessionId, -1, 66, -4), null);
    });
}

// ── 5. 再次 lay 先自动还原上一面墙 ──
{
    const dir = tmp();
    const expect = new GhostExpectStore({ dataDir: dir }).load();
    const snap = new WorldSnapshot({ dataDir: path.join(dir, 'sessions') });
    const probe = new GhostProbe(registry, expect, addonCheckOn, snap);
    const p = fakePlayer();

    probe.lay(p, 3, 2);
    const first = probe.sessions.get(p.xuid).sessionId;
    const firstCount = expect.count();
    check('第一次铺墙：快照 1 个会话', () => assert.strictEqual(snap.stats().sessions, 1));

    probe.lay(p, 3, 2);
    const second = probe.sessions.get(p.xuid).sessionId;
    check('第二次铺墙生成了新会话 ID', () => assert.notStrictEqual(first, second));
    check('旧会话文件已删除（先还原再铺）', () => {
        assert.strictEqual(snap.has(first), false);
        assert.strictEqual(fs.existsSync(path.join(dir, 'sessions', `${first}.json`)), false);
    });
    check('快照里只有新会话', () => assert.strictEqual(snap.stats().sessions, 1));
    check('期望集合没翻倍（旧墙的期望已清）', () => assert.strictEqual(expect.count(), firstCount));
    probe.undo(p);
}

// ── 6. 无 snapshot → 退化路径仍可用 ──
{
    const probe = new GhostProbe(registry, null, addonCheckOn, null);
    const p = fakePlayer();
    setRaw(0, 64, -4, 0, 'minecraft:stone');
    probe.lay(p, 3, 2);
    probe.undo(p);
    check('无快照时 undo 仍能还原', () => {
        assert.strictEqual(getRaw(0, 64, -4, 0).type, 'minecraft:stone');
    });
}

// ── 7. 写闸门 ──
{
    const dir = tmp();
    const snap = new WorldSnapshot({ dataDir: path.join(dir, 'sessions') });
    const probe = new GhostProbe(registry, null, addonCheckOff, snap);
    const p = fakePlayer();
    const ok = probe.lay(p, 3, 2);
    check('关闸时 lay 被拦住且未写世界', () => {
        assert.strictEqual(ok, false);
        assert.strictEqual(getRaw(0, 64, -4, 0).type === 'lit:g_stone', false);
        assert.ok(p.lines.some(l => l.includes('ghost 写入已禁用')));
    });
    check('关闸时未产生快照', () => assert.strictEqual(snap.stats().sessions, 0));
}

// ── 8. 崩溃恢复 A：铺墙后重启，期望仍认 → 不许把墙拆掉 ──
{
    const dir = tmp();
    const expect = new GhostExpectStore({ dataDir: dir }).load();
    const snap1 = new WorldSnapshot({ dataDir: path.join(dir, 'sessions') });
    const probe1 = new GhostProbe(registry, expect, addonCheckOn, snap1);
    const p = fakePlayer();
    setRaw(0, 64, -4, 0, 'minecraft:stone');
    probe1.lay(p, 3, 2);
    const sid = probe1.sessions.get(p.xuid).sessionId;
    const ghostCount = 6;
    check('铺墙后快照 6 格', () => assert.strictEqual(snap1.size(sid), ghostCount));

    // 模拟进程重启：新实例从磁盘载入
    const snap2 = new WorldSnapshot({ dataDir: path.join(dir, 'sessions') }).load();
    const r = snap2.restoreOrphaned({
        // 期望集合仍认这些格 → 投影在正常工作，重启不该还原
        shouldRestore: (d, x, y, z) => !expect.get(d, x, y, z),
    });
    check('重启时 6 格全部 held（不还原）', () => {
        assert.strictEqual(r.sessions, 1);
        assert.strictEqual(r.restored, 0);
        assert.strictEqual(r.held, ghostCount);
    });
    check('墙还在（用户要的"重启后自动补齐"没被破坏）', () => {
        assert.ok(getRaw(0, 64, -4, 0).type.startsWith('lit:g_'));
    });
    check('快照文件保留（日后仍可撤销）', () => {
        assert.ok(fs.existsSync(path.join(dir, 'sessions', `${sid}.json`)));
    });

    // ── 9. 崩溃恢复 B：重启后玩家主动 undo，靠 sessionId 前缀找回 ──
    const probe2 = new GhostProbe(registry, expect, addonCheckOn, snap2);
    const p2 = fakePlayer();
    const ok = probe2.undo(p2);
    check('崩溃后 undo 能接管孤儿会话并还原', () => {
        assert.strictEqual(ok, true);
        assert.strictEqual(getRaw(0, 64, -4, 0).type, 'minecraft:stone');
        assert.strictEqual(getRaw(1, 65, -4, 0).type, 'minecraft:air');
    });
    check('撤销后快照文件删除、期望清空', () => {
        assert.strictEqual(fs.existsSync(path.join(dir, 'sessions', `${sid}.json`)), false);
        assert.strictEqual(expect.count(), 0);
    });
}

// ── 10. 崩溃恢复 C：撤销做了一半就崩（期望已删、快照还在）→ 启动时续做 ──
{
    const dir = tmp();
    const expect = new GhostExpectStore({ dataDir: dir }).load();
    const snap1 = new WorldSnapshot({ dataDir: path.join(dir, 'sessions') });
    const probe1 = new GhostProbe(registry, expect, addonCheckOn, snap1);
    const p = fakePlayer();
    setRaw(0, 64, -4, 0, 'minecraft:stone');
    probe1.lay(p, 3, 2);

    // 模拟"期望已删除、还原尚未完成即中断"
    const sess = probe1.sessions.get(p.xuid);
    for (const b of sess.blocks) expect.del(sess.dimid, b.x, b.y, b.z);

    const snap2 = new WorldSnapshot({ dataDir: path.join(dir, 'sessions') }).load();
    const r = snap2.restoreOrphaned({ shouldRestore: (d, x, y, z) => !expect.get(d, x, y, z) });
    check('期望已删的格被续做完（还原）', () => {
        assert.strictEqual(r.restored, 6);
        assert.strictEqual(r.held, 0);
        assert.strictEqual(getRaw(0, 64, -4, 0).type, 'minecraft:stone');
    });
    check('续做完后快照文件删除', () => assert.strictEqual(snap2.stats().sessions, 0));
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
if (fail) process.exitCode = 1;
