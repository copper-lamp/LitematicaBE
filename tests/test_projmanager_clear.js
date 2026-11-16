/**
 * test_projmanager_clear.js — 删除投影必须同步清掉 projManager 的"当前操作投影"
 *
 * 真机事故：删除投影后打印机仍在周期性放置/破坏方块（删投影也打断不了）。
 * 根因：ProjectionRenderer._dropTask 只清了自己的任务表，没有清 global.projManager
 *       （打印机/木剑/建造都从 projManager.getActiveProjectionByPlayer 取目标）。
 */
const assert = require('assert');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');
global.logger = { info() {}, warn() {}, error() {}, debug() {} };
global.mc = { listen() { return true; } };

const { ProjectionRenderer } = require(path.join(PLUGIN, 'src', 'render', 'ProjectionRenderer.js'));

let pass = 0;
let fail = 0;
function check(name, fn) {
    try { fn(); pass++; console.log(`  ✅ ${name}`); }
    catch (e) { fail++; console.log(`  ❌ ${name}\n     ${e && e.message ? e.message : e}`); }
}

console.log('\n=== 删除投影同步 projManager ===');

check('A1. 最后一个投影卸载时清 projManager 活动投影', () => {
    const calls = [];
    global.projManager = {
        removeActiveProjection(x) { calls.push(x); },
        getActiveProjectionByPlayer() { return null; },
    };
    const r = new ProjectionRenderer();
    r.playerProjections.set('P1', new Map([['proj1', { id: 'proj1', projection: { id: 'proj1' } }]]));
    r.activeProjections.set('P1', { id: 'proj1', projection: { id: 'proj1' } });

    r._dropTask({ xuid: 'P1' }, 'proj1');

    assert.deepStrictEqual(calls, ['P1'], '必须清掉 projManager 的 P1');
    assert.strictEqual(r.playerProjections.has('P1'), false);
    assert.strictEqual(r.activeProjections.has('P1'), false);
});

check('A2. 还有其它投影时只切主控，不清整个玩家的活动投影', () => {
    const removed = [];
    const activated = [];
    global.projManager = {
        removeActiveProjection(x) { removed.push(x); },
        activateProjection(p, proj) { activated.push(proj.id); },
    };
    const r = new ProjectionRenderer();
    const t1 = { id: 'proj1', projection: { id: 'proj1' }, layer: -1 };
    const t2 = { id: 'proj2', projection: { id: 'proj2' }, layer: -1 };
    r.playerProjections.set('P1', new Map([['proj1', t1], ['proj2', t2]]));
    r.activeProjections.set('P1', t1);

    r._dropTask({ xuid: 'P1' }, 'proj1');

    assert.deepStrictEqual(removed, [], '还有剩余投影时不能清整个玩家的活动投影');
    assert.deepStrictEqual(activated, ['proj2'], '主控应顺位到 proj2');
    assert.strictEqual(r.activeProjections.get('P1').id, 'proj2');
});

check('A3. 没有任务表时也清 projManager（重启后无会话删投影）', () => {
    const calls = [];
    global.projManager = { removeActiveProjection(x) { calls.push(x); } };
    const r = new ProjectionRenderer();

    r._dropTask({ xuid: 'P2' }, 'projX');

    assert.deepStrictEqual(calls, ['P2'], '无任务表也必须清掉残留的活动投影');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
