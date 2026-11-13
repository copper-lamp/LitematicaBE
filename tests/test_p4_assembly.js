/**
 * test_p4_assembly.js — 装配级验收
 *
 * 前面的单测都是"模块内部正确"，这里验"装配后整体正确"：
 *   1. ConfigManager：默认 mode=ghost；老配置里的 particle 被强制改掉，且其它键不被吞
 *   2. MegaProjectionRenderer：enableMega 默认 false，onTick 早退，initRenderState 不建状态
 *   3. UIManager：构造期不再自己 mc.listen('onTick')
 *   4. LogCleaner：构造期不自己 setInterval
 *   5. 新模块导出接口齐全（GhostRenderer / ProjectionRenderer / RenderScheduler / SurfaceExtractor）
 *   6. EasyPlaceManager 有 tickFastPlace，且 startTickLoop 能交给调度器
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) { console.log(`  ❌ ${name}`); console.log(`     ${e && e.message ? e.message : e}`); fail++; }
}

// ── 全局 mock（LSE 运行时） ──────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p4asm-'));
process.chdir(tmp);

let tickListeners = 0;
const fileStore = new Map();
global.File = {
    exists: (p) => fileStore.has(p),
    readFrom: (p) => fileStore.get(p) || '',
    writeTo: (p, c) => { fileStore.set(p, c); return true; },
    mkdir: () => true,
};
global.mc = {
    listen(name) { if (name === 'onTick') tickListeners++; return true; },
    getPlayer() { return null; },
    getOnlinePlayers() { return []; },
    newSimpleForm() { return { setTitle() { }, setContent() { }, addButton() { }, sendForm() { } }; },
};
global.logger = { info() {}, warn() {}, error() {}, debug() {} };

console.log('\n=== 装配验收 ===');

check('ConfigManager：默认 render.mode = ghost，新键齐全', () => {
    const { ConfigManager } = require(path.join(PLUGIN, 'src', 'core', 'ConfigManager.js'));
    const cm = new ConfigManager();
    assert.strictEqual(cm.get('render.mode'), 'ghost');
    assert.strictEqual(cm.get('render.ghostWritesPerTick'), 300);
    assert.strictEqual(cm.get('render.ghostMaxBlocks'), 60000);
    assert.strictEqual(cm.get('render.ghostOverwriteReplaceable'), true);
    assert.strictEqual(cm.get('render.tickBudgetMs'), 8);
    // 2026-11-13：默认值改为 true（超大投影默认开启）。要临时关闭请改 config.json 的
    // render.enableMega=false —— 这里断言的是**默认配置**，不是用户配置。
    assert.strictEqual(cm.get('render.enableMega'), true);
});

check('ConfigManager：老配置里的 particle 被强制改成 ghost，其它键保留', () => {
    const p = './plugins/LitematicaBE/config.json';
    fileStore.set(p, JSON.stringify({
        render: { mode: 'particle', opacity: 0.55 },
        easyPlace: { enabled: false },
    }, null, 4));
    const { ConfigManager } = require(path.join(PLUGIN, 'src', 'core', 'ConfigManager.js'));
    const cm = new ConfigManager();
    assert.strictEqual(cm.get('render.mode'), 'ghost', 'particle 必须落回 ghost');
    assert.strictEqual(cm.get('render.opacity'), 0.55, '用户的其它配置不能被吞');
    assert.strictEqual(cm.get('easyPlace.enabled'), false);
});

check('MegaProjectionRenderer：enableMega=false → 不建状态、onTick 不干活', () => {
    global.configManager = { get: (k, d) => (k === 'render.enableMega' ? false : d) };
    const { MegaProjectionRenderer } = require(path.join(PLUGIN, 'src', 'render', 'MegaProjectionRenderer.js'));
    const mr = new MegaProjectionRenderer({ getBlocksNear() { return []; } });
    assert.strictEqual(mr.enabled, false);
    const player = { xuid: 'P1', name: 'A', pos: { x: 0, y: 0, z: 0 } };
    const st = mr.initRenderState(player, 's1', { name: 'big', totalBlocks: 99999 });
    assert.strictEqual(st, null, '关闭时不该建状态');
    assert.strictEqual(mr.renderStates.size, 0);
    mr.onTick();
    assert.strictEqual(mr.tickCount, 0, 'onTick 必须早退');
});

check('UIManager：构造期不注册 onTick（渲染 tick 只由调度器驱动）', () => {
    tickListeners = 0;
    const { UIManager } = require(path.join(PLUGIN, 'src', 'ui', 'UIManager.js'));
    const ui = new UIManager();
    assert.strictEqual(tickListeners, 0, `UIManager 不该 mc.listen('onTick')，实际 ${tickListeners} 次`);
    assert.strictEqual(typeof ui.updateActionBars, 'function');
    assert.strictEqual(ui._actionBarLoopStarted, false);
});

check('LogCleaner：构造期不建 setInterval（交给调度器）', () => {
    const { LogCleaner } = require(path.join(PLUGIN, 'src', 'core', 'LogCleaner.js'));
    const lc = new LogCleaner();
    assert.strictEqual(lc._timer, undefined, '构造期不该有 timer');
    assert.strictEqual(lc.isRunning, false);
});

check('LogCleaner.startAutoClean：有调度器时只 enable，不建 timer', () => {
    const { LogCleaner } = require(path.join(PLUGIN, 'src', 'core', 'LogCleaner.js'));
    const lc = new LogCleaner();
    const enabled = [];
    global.renderScheduler = {
        has: (n) => n === 'log-cleaner',
        enable: (n, on) => enabled.push([n, on]),
    };
    lc.startAutoClean();
    assert.strictEqual(lc._timer, undefined, '不该退化成 setInterval');
    assert.deepStrictEqual(enabled, [['log-cleaner', true]]);
    lc.stopAutoClean();
    delete global.renderScheduler;
});

check('EasyPlaceManager：tickFastPlace 存在；startTickLoop 交给调度器', () => {
    const { EasyPlaceManager } = require(path.join(PLUGIN, 'src', 'easyplace', 'EasyPlaceManager.js'));
    const stubProj = { getActiveProjectionByPlayer() { return null; } };
    const stubData = { getProjection() { return null; } };
    const stubMega = {};
    const ep = new EasyPlaceManager(stubProj, stubData, stubMega);
    assert.strictEqual(typeof ep.tickFastPlace, 'function');

    const enabled = [];
    global.renderScheduler = {
        has: (n) => n === 'easyplace-fast',
        enable: (n, on) => enabled.push([n, on]),
    };
    ep.startTickLoop();
    assert.strictEqual(ep.tickInterval, 'scheduler');
    assert.deepStrictEqual(enabled, [['easyplace-fast', true]]);
    ep.stopTickLoop();
    assert.deepStrictEqual(enabled[1], ['easyplace-fast', false]);
    delete global.renderScheduler;
});

check('新模块导出接口齐全', () => {
    const g = require(path.join(PLUGIN, 'src', 'ghost', 'GhostRenderer.js'));
    assert.strictEqual(typeof g.GhostRenderer, 'function');
    assert.strictEqual(typeof g.transformPosition, 'function');
    for (const m of ['enqueue', 'tick', 'retryPending', 'setLayer', 'clear', 'updateBlocks', 'summary',
        // 会话保活：这 4 个一旦被回滚，退出重进又会出现"投影消失 + UI 卡已加载"
        'suspend', 'resume', 'isSuspended', 'pruneSuspended']) {
        assert.strictEqual(typeof g.GhostRenderer.prototype[m], 'function', `GhostRenderer.${m} 缺失`);
    }

    const s = require(path.join(PLUGIN, 'src', 'ghost', 'SurfaceExtractor.js'));
    assert.strictEqual(typeof s.SurfaceExtractor.prototype.extract, 'function');

    const rs = require(path.join(PLUGIN, 'src', 'render', 'RenderScheduler.js'));
    for (const m of ['add', 'remove', 'enable', 'has', 'start', 'runTick', 'stats', 'summaryText']) {
        assert.strictEqual(typeof rs.RenderScheduler.prototype[m], 'function', `RenderScheduler.${m} 缺失`);
    }

    const pr = require(path.join(PLUGIN, 'src', 'render', 'ProjectionRenderer.js'));
    const r = new pr.ProjectionRenderer();
    for (const m of ['startRender', 'cancelRender', 'clearPlayerProjection', 'showBounds', 'updateBlocks']) {
        assert.strictEqual(typeof r[m], 'function');
    }
});

check('ProjectionRenderer 能从 global.ghostRenderer 惰性取到渲染器（不在装配期 attach）', () => {
    const { ProjectionRenderer } = require(path.join(PLUGIN, 'src', 'render', 'ProjectionRenderer.js'));
    const fake = {
        enqueue: () => ({ ok: true, count: 3 }),
        has: () => false,
        clear: () => ({ ok: true }),
    };
    global.ghostRenderer = fake;
    const r = new ProjectionRenderer();
    const p = { xuid: 'P9', name: 'X', pos: { dimid: 0 }, tell() { } };
    assert.strictEqual(r.startRender(p, {
        id: 'z', name: 'z', dimensions: { x: 1, y: 1, z: 1 }, position: { x: 0, y: 0, z: 0 }, blocks: [],
    }), true);
    assert.strictEqual(r.activeProjections.get('P9').count, 3);
    delete global.ghostRenderer;
});

check('全仓库仅保留一个 onTick 入口（RenderScheduler.start）', () => {
    // 扫描范围 = 插件交付物本身（index.js + src/），不含 tests/、work/ 与构建残留副本。
    // 否则测试脚本自身那句 mc.listen('onTick') 注释/断言文案会把用例咬死。
    const files = [path.join(PLUGIN, 'index.js')];
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
            if (e.name.endsWith('.js')) files.push(p);
        }
    };
    walk(path.join(PLUGIN, 'src'));
    const hits = [];
    for (const f of files) {
        const txt = fs.readFileSync(f, 'utf8');
        const lines = txt.split('\n');
        lines.forEach((line, i) => {
            if (/mc\.listen\(\s*['"]onTick['"]/.test(line) && !/^\s*(\*|\/\/)/.test(line)) {
                hits.push(`${path.basename(f)}:${i + 1}`);
            }
        });
    }
    // 只允许 RenderScheduler 内部那一个；UIManager/其它模块的降级分支不许被调用，但也允许存在。
    // 断言"哪个文件"而不是"哪一行"：行号会随文件里加注释/require 漂移（这里吃过一次）。
    assert.ok(hits.some(h => h.startsWith('RenderScheduler.js')), '调度器必须持有 onTick');
    const outside = hits.filter(h => !h.startsWith('RenderScheduler.js'));
    const outsideFiles = [...new Set(outside.map(h => h.split(':')[0]))].sort();
    assert.deepStrictEqual(outsideFiles, ['UIManager.js'],
        `除调度器外只允许 UIManager 的未调用降级分支，实际: ${outside.join(', ')}`);
    assert.strictEqual(outside.length, 1,
        `UIManager 只应有一处 onTick 降级分支，实际: ${outside.join(', ')}`);
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
