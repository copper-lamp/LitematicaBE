/**
 * normalize_deploy_config.js — 规整部署侧 config.json 的换行
 *
 * 背景：补 web.engine 键时按 "\n" 定位，在 CRLF 文件里留下了一个裸 LF，
 * 某些终端会把相邻两行显示成一行（JSON 本身仍然合法）。
 * 这里把整份文件统一成原文件所用的换行符，并顺手做一次 JSON 校验。
 */
const fs = require('fs');

const p = process.argv[2];
if (!p) {
    console.error('用法: node work/normalize_deploy_config.js <config.json 绝对路径>');
    process.exit(2);
}

let s = fs.readFileSync(p, 'utf8');
const crlf = /\r\n/.test(s);
const naked = (s.match(/(?<!\r)\n/g) || []).length;
console.log('[cfg] 原文件 CRLF:', crlf, '| 裸 LF:', naked);

const norm = s.replace(/\r\n/g, '\n').replace(/\n/g, crlf ? '\r\n' : '\n');
if (norm !== s) {
    fs.writeFileSync(p, norm, 'utf8');
    console.log('[cfg] 已统一换行为', crlf ? 'CRLF' : 'LF');
} else {
    console.log('[cfg] 换行无需改动');
}

const stripped = norm.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const j = JSON.parse(stripped);
console.log('[cfg] JSON 校验通过');
console.log('[cfg] web.engine =', j.web.engine, '| web.port =', j.web.port, '| web.enabled =', j.web.enabled);
console.log('[cfg] 顶层键:', Object.keys(j).join(','));
console.log('[cfg] --- web 段 ---');
const i = norm.indexOf('"web"');
console.log(norm.slice(Math.max(0, i - 2), i + 520));
