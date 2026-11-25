/**
 * add_engine_key.js — 给部署侧的 config.json 补上 web.engine 键（保留注释与原有格式）
 *
 * 只做一件事：在 web 段的 "enabled" 行后面插一行 "engine": "node",
 * 若已存在则跳过。纯字符串插入，不重新序列化整个文件，避免丢注释。
 */
const fs = require('fs');

const target = process.argv[2];
if (!target) {
    console.error('用法: node work/add_engine_key.js <config.json 绝对路径>');
    process.exit(2);
}

const raw = fs.readFileSync(target, 'utf8');
if (/^\s*"engine"\s*:/m.test(raw)) {
    console.log('[engine] 已存在，跳过');
    process.exit(0);
}

// 在 web 段的 "enabled" 行后插入
const idx = raw.indexOf('"web"');
if (idx < 0) {
    console.error('[engine] 找不到 web 段，未修改');
    process.exit(1);
}
const enabledIdx = raw.indexOf('"enabled"', idx);
if (enabledIdx < 0) {
    console.error('[engine] web 段里找不到 enabled，未修改');
    process.exit(1);
}
const lineEnd = raw.indexOf('\n', enabledIdx);
if (lineEnd < 0) {
    console.error('[engine] 行尾定位失败，未修改');
    process.exit(1);
}

const insert = '\n    "engine": "node",  // node = Node 原生 http（默认）；lse = ll.network 的 HttpServer（0.17.x 回调 500，仅兼容）';
const out = raw.slice(0, lineEnd) + insert + raw.slice(lineEnd);
fs.writeFileSync(target, out, 'utf8');
console.log('[engine] 已插入 web.engine = "node"');
console.log('[engine] 文件大小:', raw.length, '→', out.length);

// 简易校验：去掉注释后能 JSON.parse
const stripped = out.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const parsed = JSON.parse(stripped);
console.log('[engine] JSON 校验通过，web.engine =', parsed.web.engine);
