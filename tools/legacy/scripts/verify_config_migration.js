/**
 * verify_config_migration.js — S0.3 一次性迁移验证（本地临时脚本，不入库）
 *
 * 断言：
 *   1. 老配置 render.mode="particle" → 加载后内存里是 ghost
 *   2. 迁移后立刻写回文件（只写一次）
 *   3. 用户的其它键（render.opacity / easyPlace.enabled）不被吞
 *   4. 已迁移的配置再加载一次，不再触发写入（不再重复提示）
 *
 * 运行：node work/verify_config_migration.js
 */

const assert = require('assert');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');
const CFG = './plugins/LitematicaBE/config.json';

const store = new Map();
let writes = 0;
global.File = {
    exists: (p) => store.has(p),
    readFrom: (p) => store.get(p) || '',
    writeTo: (p, c) => { writes++; store.set(p, c); return true; },
};
global.logger = { info() { }, warn() { }, error() { }, debug() { } };

const { ConfigManager } = require(path.join(PLUGIN, 'src', 'core', 'ConfigManager.js'));
let pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

console.log('\n=== 配置一次性迁移 ===');

store.set(CFG, JSON.stringify({
    render: { mode: 'particle', opacity: 0.55, ghostWritesPerTick: 120 },
    easyPlace: { enabled: false },
    particleRespawn: { enabled: true },
}, null, 4));

const cm = new ConfigManager();

check('legacy particle → ghost', () => {
    assert.strictEqual(cm.get('render.mode'), 'ghost');
});
check('迁移后写回文件一次', () => {
    assert.strictEqual(writes, 1, `写入次数 ${writes}`);
    assert.strictEqual(JSON.parse(store.get(CFG)).render.mode, 'ghost');
});
check('用户自定值不被吞', () => {
    assert.strictEqual(cm.get('render.opacity'), 0.55);
    assert.strictEqual(cm.get('render.ghostWritesPerTick'), 120);
    assert.strictEqual(cm.get('easyPlace.enabled'), false);
});
check('旧死配置段不再出现在默认值里', () => {
    const d = cm.getDefaultConfig();
    assert.strictEqual(d.particleRespawn, undefined);
    assert.strictEqual(d.render.opacity, undefined);
    assert.strictEqual(d.render.particlesPerFrame, undefined);
    assert.strictEqual(d.performance, undefined);
    assert.strictEqual(d.gui, undefined);
    assert.strictEqual(d.megaRender.lodLevels, undefined);
});
check('重复加载不再写文件', () => {
    const before = writes;
    const cm2 = new ConfigManager();
    assert.strictEqual(cm2.get('render.mode'), 'ghost');
    assert.strictEqual(writes, before, '已迁移的配置不该再被改写');
});

console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
