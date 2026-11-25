// work/fix_form_guards.js —— 一次性：给所有 sendForm 回调加"玩家取消表单"的防御
//
// 背景：BDS 报 `Uncaught TypeError: Cannot read properties of undefined (reading '9')`
//       In API: CustomFormClass::sendForm
// 原因：玩家关闭/取消表单时，LSE 的 CustomForm 回调可能给 `undefined` 而不是 `null`，
//       而回调只写了 `if (data === null)` → 继续 `data[9]` → TypeError。
// 修法：CustomForm 用 `!Array.isArray(data)`，SimpleForm 用 `typeof data !== 'number'`。
const fs = require('fs');
const path = require('path');

const P = path.join(__dirname, '..', 'src', 'ui', 'UIManager.js');
const src = fs.readFileSync(P, 'utf8');
const eol = src.includes('\r\n') ? '\r\n' : '\n';
const lines = src.split(/\r?\n/);

const sites = [];
lines.forEach((l, i) => { if (l.includes('sendForm(')) sites.push(i); });

let replaced = 0;
let inserted = 0;
const report = [];

for (const i of sites.slice().reverse()) {
    let kind = 'SimpleForm';
    for (let j = i; j >= 0; j--) {
        if (lines[j].includes('newCustomForm()')) { kind = 'CustomForm'; break; }
        if (lines[j].includes('newSimpleForm()')) { kind = 'SimpleForm'; break; }
    }
    const guard = kind === 'CustomForm'
        ? 'if (!Array.isArray(data))'
        : "if (typeof data !== 'number')";

    let gi = -1;
    for (let j = i + 1; j < Math.min(i + 7, lines.length); j++) {
        if (/if\s*\(\s*data\s*===?\s*(null|undefined)/.test(lines[j])
            || /if\s*\(\s*data\s*===?\s*undefined\s*\|\|/.test(lines[j])
            || /if\s*\(\s*!data\s*\)/.test(lines[j])) { gi = j; break; }
    }

    if (gi >= 0) {
        const before = lines[gi];
        lines[gi] = before.replace(
            /if\s*\(\s*(?:data\s*===?\s*null\s*\|\|\s*data\s*===?\s*undefined|data\s*===?\s*undefined\s*\|\|\s*data\s*===?\s*null|data\s*===?\s*null|data\s*===?\s*undefined|!data)\s*\)/,
            guard
        );
        if (lines[gi] !== before) {
            replaced++;
            report.push(`  替换 L${gi + 1}  ${kind.padEnd(10)} ${before.trim()}  →  ${guard}`);
        } else {
            report.push(`  !! 未匹配 L${gi + 1}  ${before.trim()}`);
        }
    } else {
        const indent = (lines[i].match(/^[ \t]*/) || [''])[0] + '    ';
        lines.splice(i + 1, 0, `${indent}${guard} return;   // 取消表单：LSE 可能回 null 也可能回 undefined`);
        inserted++;
        report.push(`  新增 L${i + 2}  ${kind.padEnd(10)} ${guard}`);
    }
}

fs.writeFileSync(P, lines.join(eol), 'utf8');

// 第二轮：`data === null || data === 1` 这种"取消或第 N 个按钮"的组合判定
let s2 = fs.readFileSync(P, 'utf8');
const before2 = s2;
s2 = s2.split('if (data === null || data === 1) {')
    .join("if (typeof data !== 'number' || data === 1) {");
if (s2 !== before2) fs.writeFileSync(P, s2, 'utf8');

console.log(`判定替换 ${replaced} 处，新增 ${inserted} 处（共 ${sites.length} 个 sendForm）`);
for (const r of report.reverse()) console.log(r);
console.log(`残余 data === null：${(s2.match(/data === null/g) || []).length}`);
console.log(`残余 data === undefined：${(s2.match(/data === undefined/g) || []).length}`);
