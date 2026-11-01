/**
 * test_form_guards.js —— 表单回调必须能扛住"玩家取消"
 *
 * 事故（2026-10-31 真实日志）：
 *   ERROR [legacy-script-engine-nodejs] Uncaught TypeError:
 *   Cannot read properties of undefined (reading '9')
 *   In API: CustomFormClass::sendForm
 *
 * 原因：玩家关闭表单时，LSE 的 CustomForm 回调可能给 `undefined` 而不是 `null`，
 *      而回调只写了 `if (data === null)` → 继续 `data[9]` → TypeError。
 * 约定：
 *   CustomForm  回调用 `if (!Array.isArray(data))`
 *   SimpleForm  回调用 `if (typeof data !== 'number')`
 * 这个测试静态扫描所有 `sendForm(`，缺防御就失败 —— 新增表单时不会漏。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');
const FILES = [
    path.join(PLUGIN, 'src', 'ui', 'UIManager.js'),
    path.join(PLUGIN, 'index.js'),
];

let pass = 0;
let fail = 0;
function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

/** 收集某个文件里所有 sendForm 站点：{ line, kind, guard } */
function scan(file) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const out = [];
    lines.forEach((l, i) => {
        if (!l.includes('sendForm(')) return;
        let kind = 'SimpleForm';
        for (let j = i; j >= 0; j--) {
            if (lines[j].includes('newCustomForm()')) { kind = 'CustomForm'; break; }
            if (lines[j].includes('newSimpleForm()')) { kind = 'SimpleForm'; break; }
        }
        // 回调头 8 行内找防御
        const head = lines.slice(i, Math.min(i + 9, lines.length)).join('\n');
        let guard = null;
        if (/!Array\.isArray\(\s*data\s*\)/.test(head)) guard = 'array';
        else if (/typeof\s+data\s*!==\s*['"]number['"]/.test(head)) guard = 'number';
        out.push({ line: i + 1, kind, guard, text: l.trim() });
    });
    return out;
}

console.log('\n=== 表单回调取消防御 ===');

check('UIManager 的 sendForm 都能识别"取消"（无 data === null 残留）', () => {
    const src = fs.readFileSync(FILES[0], 'utf8');
    assert.ok(!/data\s*===?\s*null/.test(src), '仍有 `data === null` 判定：取消时可能是 undefined，会漏');
    assert.ok(!/data\s*===?\s*undefined\s*\)/.test(src), '不应只判 undefined（null 会漏）');
});

check('每个 sendForm 回调都有类型防御', () => {
    const bad = [];
    for (const f of FILES) {
        if (!fs.existsSync(f)) continue;
        for (const s of scan(f)) {
            if (!s.guard) bad.push(`${path.basename(f)}:${s.line} 无防御 — ${s.text}`);
        }
    }
    assert.strictEqual(bad.length, 0, `以下回调缺防御:\n     ${bad.join('\n     ')}`);
});

check('防御类型与表单类型匹配（CustomForm 用 Array.isArray，SimpleForm 用 typeof）', () => {
    const bad = [];
    for (const f of FILES) {
        if (!fs.existsSync(f)) continue;
        for (const s of scan(f)) {
            const want = s.kind === 'CustomForm' ? 'array' : 'number';
            if (s.guard && s.guard !== want) {
                bad.push(`${path.basename(f)}:${s.line} 是 ${s.kind} 却用 ${s.guard} 判定`);
            }
        }
    }
    assert.strictEqual(bad.length, 0, bad.join('\n     '));
});

check('放置面板的坐标索引有越界保护（label 数量变了不会取错控件）', () => {
    const src = fs.readFileSync(FILES[0], 'utf8');
    assert.ok(/const labelCount = isMega \? 9 : 8;/.test(src), 'labelCount 常量应仍在');
    assert.ok(/data\.length >= labelCount \+ 3/.test(src), '缺少 data.length 校验：加 label 忘改 labelCount 会静默错位');
});

console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
