// 逐行 diff：对比目标与工作区的 index.js / WorldSnapshot.js（UTF-8 正确输出）
const fs = require('fs');
const path = require('path');

function readLines(p) {
    return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
}

function diff(label, pa, pb) {
    const a = readLines(pa), b = readLines(pb);
    // LCS 简化：用最长公共子序列做逐行对齐
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) { i++; j++; continue; }
        if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(`- [A:${i + 1}] ${a[i]}`); i++; }
        else { out.push(`+ [B:${j + 1}] ${b[j]}`); j++; }
    }
    while (i < n) out.push(`- [A:${i + 1}] ${a[i++]}`);
    while (j < m) out.push(`+ [B:${j + 1}] ${b[j++]}`);
    console.log(`\n=== ${label} === A=${pa}\n  B=${pb}\n  差异行数: ${out.length}`);
    out.slice(0, 60).forEach((l) => console.log('  ' + l));
}

diff('index.js', process.argv[2], process.argv[3]);
diff('WorldSnapshot.js', process.argv[4], process.argv[5]);
