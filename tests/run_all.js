/**
 * run_all.js — 一次性跑完 tests/ 下的全部离线测试与静态体检
 *
 * 用法：node tests/run_all.js   （或 npm test）
 * 退出码：0 = 全绿；1 = 有任一脚本失败或崩溃
 *
 * 设计要点：
 *   - 每个脚本起独立子进程，互不污染全局（它们都会往 global 上挂假 mc / 假世界）。
 *   - 不依赖目录枚举顺序以外的隐式约定：run_all.js 自己不算测试。
 *   - 汇总断言数：脚本自报「N 通过 / M 失败」时计入总数；自报 PASS/FAIL 的体检器只记脚本级结果。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TESTS = __dirname;
const SELF = path.basename(__filename);
const TIMEOUT_MS = 120000;

const files = fs.readdirSync(TESTS)
    .filter((name) => name.endsWith('.js') && name !== SELF)
    .sort();

if (files.length === 0) {
    console.error('[test] tests/ 下没找到任何用例');
    process.exit(1);
}

/** 从脚本输出里抽取断言计数：「结果: 31 通过 / 0 失败」「结果: PASS」 */
function parseSummary(out) {
    const m = out.match(/(\d+)\s*通过\s*\/\s*(\d+)\s*失败/);
    if (m) return { pass: Number(m[1]), fail: Number(m[2]) };
    if (/结果\s*[:：]\s*PASS/.test(out) || /全部通过/.test(out)) return { pass: null, fail: 0 };
    return null;
}

const rows = [];
let totalPass = 0;
let totalFail = 0;
let totalScripts = 0;
let failedScripts = 0;

const t0 = Date.now();

for (const name of files) {
    const file = path.join(TESTS, name);
    const r = spawnSync(process.execPath, [file], {
        cwd: path.resolve(TESTS, '..'),
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });

    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const crashed = r.error || (r.status !== 0);
    const summary = parseSummary(out);

    // 脚本自报"有失败"或进程非零退出，都判失败
    const ok = !crashed && (!summary || summary.fail === 0) && (summary !== null || r.status === 0);

    totalScripts++;
    if (summary && summary.pass !== null) totalPass += summary.pass;
    if (summary && summary.fail) totalFail += summary.fail;
    if (!ok) {
        failedScripts++;
        console.error(`\n❌ ${name}`);
        const tail = out.split(/\r?\n/).filter((l) => l.trim() !== '').slice(-25);
        for (const line of tail) console.error(`   ${line}`);
        if (r.error && r.error.code === 'ETIMEDOUT') console.error(`   （超时 ${TIMEOUT_MS} ms）`);
    }
    rows.push({
        name,
        ok: ok ? 'PASS' : 'FAIL',
        pass: summary && summary.pass !== null ? summary.pass : '-',
        fail: summary ? summary.fail : '-',
    });
}

const ms = Date.now() - t0;

// 摘要表（等宽对齐，CI 日志里也好读）
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));
console.log('\n=== 离线测试汇总 ===');
for (const row of rows) {
    console.log(`${row.ok === 'PASS' ? '✅' : '❌'} ${pad(row.name, 34)} 通过 ${pad(row.pass, 4)} 失败 ${row.fail}`);
}
console.log(`\n脚本 ${totalScripts - failedScripts}/${totalScripts} 通过　断言 ${totalPass} 通过 / ${totalFail} 失败　用时 ${(ms / 1000).toFixed(1)}s`);

if (failedScripts > 0 || totalFail > 0) {
    console.log('结果: FAIL\n');
    process.exit(1);
}
console.log('结果: PASS\n');
