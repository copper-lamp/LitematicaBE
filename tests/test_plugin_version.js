/**
 * test_plugin_version.js — 第 5 处版本：`ll.registerPlugin` 的数字三元组
 *
 * 事故（2026-11-11 真机定位）：
 *   index.js 里 `ll.registerPlugin("LitematicaBE", "...", [3, 0, 0], {})` 的版本是写死的。
 *   legacy-script-engine 在注册插件时会把这个三元组**回写进
 *   `plugins/LitematicaBE/manifest.json`**（文本模式写，LF→CRLF，并丢掉 `-prerelease`），
 *   于是每次启动清单都被刷成 `3.0.0`，而 PLUGIN_VERSION / package.json / tooth.json 是
 *   3.0.3-test.6 —— 排查线上问题时会被误判成"清单被改过"。
 *
 * 规则：
 *   1. `PLUGIN_VERSION` 是唯一字符串来源；
 *   2. `PLUGIN_VERSION_TUPLE` 必须由它派生（不许出现 `[3, 0, 0]` 这种字面量）；
 *   3. `ll.registerPlugin` 的第三个参数必须是 `PLUGIN_VERSION_TUPLE`；
 *   4. 部署后 manifest 被 LSE 改成 `x.y.z`（丢掉 prerelease 后缀）属**预期行为**，
 *      只要求 core 三段与 PLUGIN_VERSION 一致。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');
const INDEX_SRC = fs.readFileSync(path.join(PLUGIN, 'index.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'package.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'manifest.json'), 'utf8'));
const tooth = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'tooth.json'), 'utf8'));

let pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) { console.log(`  ❌ ${name}\n     ${e && e.message ? e.message : e}`); fail++; }
}

const m = INDEX_SRC.match(/const\s+PLUGIN_VERSION\s*=\s*['"]([^'"]+)['"]/);
const PLUGIN_VERSION = m ? m[1] : null;
// core = 去掉 `-prerelease` 的版本串（3.0.3-test.6 → 3.0.3）。
// 注意**不能**先按 '.' 切再取前三段：`3.0.3-test.6` 按 '.' 切是 ['3','0','3-test','6']，
// 前三是 '3.0.3-test'（test 会粘在第三段上）。必须先按 '-' 切。
const CORE = PLUGIN_VERSION ? PLUGIN_VERSION.split('-')[0] : null;
/** 与 index.js 里 PLUGIN_VERSION_TUPLE 的派生表达式同构 */
function deriveTuple(v) {
    return v.split('-')[0].split('.').slice(0, 3).map((n) => parseInt(n, 10) || 0);
}

console.log('\n=== 插件版本（含 ll.registerPlugin 第 5 处） ===');

check('找到 PLUGIN_VERSION 常量且与三份清单同值', () => {
    assert.ok(PLUGIN_VERSION, 'index.js 缺少 PLUGIN_VERSION');
    assert.strictEqual(pkg.version, PLUGIN_VERSION, 'package.json 版本');
    assert.strictEqual(manifest.version, PLUGIN_VERSION, 'manifest.json 版本（源文件）');
    assert.strictEqual(tooth.version, PLUGIN_VERSION, 'tooth.json 版本');
});

check('PLUGIN_VERSION_TUPLE 由 PLUGIN_VERSION 派生（不许写死）', () => {
    assert.ok(/const\s+PLUGIN_VERSION_TUPLE\s*=\s*PLUGIN_VERSION\.split\(/.test(INDEX_SRC),
        '应写成 const PLUGIN_VERSION_TUPLE = PLUGIN_VERSION.split(...)');
    assert.ok(!/const\s+PLUGIN_VERSION_TUPLE\s*=\s*\[\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\]/.test(INDEX_SRC),
        'PLUGIN_VERSION_TUPLE 不许是数字字面量');
});

check('ll.registerPlugin 的第三个参数是 PLUGIN_VERSION_TUPLE', () => {
    const call = INDEX_SRC.match(/ll\.registerPlugin\s*\(([\s\S]*?)\)\s*;/);
    assert.ok(call, '找不到 ll.registerPlugin 调用');
    const args = call[1];
    assert.ok(/PLUGIN_VERSION_TUPLE/.test(args),
        `第三个参数应为 PLUGIN_VERSION_TUPLE，实际：${args.replace(/\s+/g, ' ').slice(0, 160)}`);
    assert.ok(!/\[\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\]/.test(args),
        '参数里不许出现写死的 [x, y, z]（LSE 会把它回写成 manifest.version）');
});

check('派生出的三元组 = PLUGIN_VERSION 的 core 三段（3.0.3-test.6 → [3,0,3]）', () => {
    const tuple = deriveTuple(PLUGIN_VERSION);
    assert.deepStrictEqual(tuple, CORE.split('.').map(Number));
    assert.strictEqual(tuple.join('.'), CORE);
    assert.strictEqual(tuple.length, 3);
    // 回归样本固定为带 prerelease 的 `3.0.3-test.6`：按 '.' 直切会把 'test' 粘进
    // 第三段（→ '3.0.3-test'），必须先按 '-' 切。用固定样本而不是当前 PLUGIN_VERSION，
    // 否则发布稳定版（如 3.1.0，无 prerelease）时这条反例不成立，会误报。
    const SAMPLE = '3.0.3-test.6';
    assert.strictEqual(deriveTuple(SAMPLE).join('.'), '3.0.3');
    assert.notStrictEqual(SAMPLE.split('.').slice(0, 3).join('.'), '3.0.3',
        'prerelease 后缀必须先用 - 切掉，不能按 . 切三段');
    tuple.forEach((n) => assert.ok(Number.isInteger(n) && n >= 0, `非法版本段：${n}`));
});

check('index.js 的 PLUGIN_VERSION_CORE = 三元组 join（manifest 回写值的唯一来源）', () => {
    assert.ok(/const\s+PLUGIN_VERSION_CORE\s*=\s*PLUGIN_VERSION_TUPLE\.join\(['"]\.['"]\)/.test(INDEX_SRC),
        'index.js 应导出 PLUGIN_VERSION_CORE = PLUGIN_VERSION_TUPLE.join(".")');
    assert.strictEqual(deriveTuple(PLUGIN_VERSION).join('.'), CORE);
});

check('部署后 manifest 被 LSE 改写为 core 版本，仍与 PLUGIN_VERSION 的 core 一致', () => {
    // 模拟 LSE 的规范化：丢掉 -prerelease，写成 x.y.z
    const written = deriveTuple(PLUGIN_VERSION).join('.');
    assert.strictEqual(written, PLUGIN_VERSION.split('-')[0],
        'LSE 回写的是 core 三段，不含 prerelease 后缀');
    assert.strictEqual(written, CORE);
});

check('check-version.mjs 已接管这条规则（CI 也会拦）', () => {
    const src = fs.readFileSync(path.join(PLUGIN, 'tools', 'check-version.mjs'), 'utf8');
    assert.ok(/PLUGIN_VERSION_TUPLE/.test(src), 'check-version 应校验 PLUGIN_VERSION_TUPLE');
    assert.ok(/ll\.registerPlugin/.test(src), 'check-version 应校验 ll.registerPlugin 的版本参数');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
