/**
 * test_render_scheduler.js — RenderScheduler 离线回归
 *
 * 覆盖：
 *   1. 只有一次 onTick 绑定（重复 start 无效）
 *   2. everyTicks / everyMs 节流
 *   3. priority 升序执行（ghost 写世界必须排在日志/清理前面）
 *   4. budgetMs 封顶：超预算的任务顺延下一 tick，并计入 skipped
 *   5. 单个任务抛错不带走整个 tick
 *   6. enable/remove/stats 语义
 */
const assert = require('assert');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');
const { RenderScheduler } = require(path.join(PLUGIN, 'src', 'render', 'RenderScheduler.js'));

let listenCount = 0;
global.mc = {
    listen(name) { if (name === 'onTick') listenCount++; return true; },
};
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

let pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) { console.log(`  ❌ ${name}`); console.log(`     ${e.message}`); fail++; }
}
const busyWait = (ms) => { const t = Date.now(); while (Date.now() - t < ms) { /* spin */ } };

console.log('\n=== RenderScheduler ===');

check('start 只绑定一次 onTick（热重载不叠监听）', () => {
    listenCount = 0;
    const s = new RenderScheduler({ logger: silentLogger });
    assert.strictEqual(s.start(), true);
    assert.strictEqual(s.start(), false);
    assert.strictEqual(s.started, true);
    assert.strictEqual(listenCount, 1);
});

check('everyTicks 节流：每 3 tick 才跑一次', () => {
    const s = new RenderScheduler({ logger: silentLogger });
    let n = 0;
    s.add('t3', () => n++, { everyTicks: 3 });
    for (let i = 0; i < 9; i++) s.runTick();
    assert.strictEqual(n, 3, `期望 3 次，实际 ${n}`);
});

check('everyMs 换算：50ms/tick 下 200ms = 4 tick', () => {
    const s = new RenderScheduler({ logger: silentLogger, tickMs: 50 });
    let n = 0;
    s.add('t200', () => n++, { everyMs: 200 });
    assert.strictEqual(s.tasks.get('t200').everyTicks, 4);
    for (let i = 0; i < 8; i++) s.runTick();
    assert.strictEqual(n, 2);
});

check('priority 升序：ghost(10) 先于 retry(20) 先于 log(90)', () => {
    const s = new RenderScheduler({ logger: silentLogger });
    const order = [];
    s.add('log', () => order.push('log'), { everyTicks: 1, priority: 90 });
    s.add('ghost', () => order.push('ghost'), { everyTicks: 1, priority: 10 });
    s.add('retry', () => order.push('retry'), { everyTicks: 1, priority: 20 });
    s.runTick();
    assert.deepStrictEqual(order, ['ghost', 'retry', 'log']);
});

check('budgetMs 封顶：第二个任务被顺延并计入 skipped', () => {
    const s = new RenderScheduler({ logger: silentLogger, budgetMs: 3 });
    let heavy = 0, light = 0;
    s.add('heavy', () => { busyWait(6); heavy++; }, { everyTicks: 1, priority: 1 });
    s.add('light', () => light++, { everyTicks: 1, priority: 2 });

    const r1 = s.runTick();
    assert.strictEqual(heavy, 1);
    assert.strictEqual(light, 0, '预算已耗尽，light 应被顺延');
    assert.strictEqual(r1.skipped, 1);
    assert.strictEqual(s.stats().tasks.find(t => t.name === 'light').skipped, 1);

    // 下一 tick heavy 先跑还是超预算，但 light 的 everyTicks=1 仍会尝试；这里只验证不丢任务
    const r2 = s.runTick();
    assert.ok(r2.ran + r2.skipped >= 1);
});

check('单任务抛错不影响其它任务，错误被记账', () => {
    const s = new RenderScheduler({ logger: silentLogger });
    let ok = 0;
    s.add('boom', () => { throw new Error('炸了'); }, { everyTicks: 1, priority: 1 });
    s.add('fine', () => ok++, { everyTicks: 1, priority: 2 });
    const r = s.runTick();
    assert.strictEqual(ok, 1);
    assert.strictEqual(r.ran, 1);
    const boom = s.stats().tasks.find(t => t.name === 'boom');
    assert.strictEqual(boom.errors, 1);
    assert.match(boom.lastError, /炸了/);
});

check('enable(false) 后任务不跑', () => {
    const s = new RenderScheduler({ logger: silentLogger });
    let n = 0;
    s.add('x', () => n++, { everyTicks: 1 });
    s.enable('x', false);
    s.runTick();
    assert.strictEqual(n, 0);
    s.enable('x', true);
    s.runTick();
    assert.strictEqual(n, 1);
});

check('remove / has 语义', () => {
    const s = new RenderScheduler({ logger: silentLogger });
    s.add('y', () => { }, { everyTicks: 1 });
    assert.strictEqual(s.has('y'), true);
    assert.strictEqual(s.remove('y'), true);
    assert.strictEqual(s.has('y'), false);
    assert.strictEqual(s.remove('y'), false);
});

check('同名重复注册覆盖而不是叠加', () => {
    const s = new RenderScheduler({ logger: silentLogger });
    let a = 0, b = 0;
    s.add('dup', () => a++, { everyTicks: 1 });
    s.add('dup', () => b++, { everyTicks: 1 });
    s.runTick();
    assert.strictEqual(a, 0);
    assert.strictEqual(b, 1);
    assert.strictEqual(s.tasks.size, 1);
});

check('非法注册参数直接报错（早失败好过静默不跑）', () => {
    const s = new RenderScheduler({ logger: silentLogger });
    assert.throws(() => s.add('', () => { }), /任务名/);
    assert.throws(() => s.add('ok', null), /必须是函数/);
});

check('stats / summaryText 结构', () => {
    const s = new RenderScheduler({ logger: silentLogger, budgetMs: 5 });
    s.add('a', () => { }, { everyTicks: 1, priority: 10 });
    s.runTick();
    const st = s.stats();
    assert.strictEqual(st.taskCount, 1);
    assert.strictEqual(st.budgetMs, 5);
    assert.strictEqual(typeof st.tickCount, 'number');
    assert.match(s.summaryText(), /tick 1/);
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
