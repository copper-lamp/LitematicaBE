/**
 * merge_deploy_config.js — 把仓库 config.json 的 web 段合并进部署副本的 config.json
 *
 * 只做一件事：在部署文件根对象闭合前插入 web 段（连同上方注释），
 * 保留部署侧已有的所有配置与注释。写完立刻做「宽松解析 + 键存在性」自检。
 *
 * 用法：node work/merge_deploy_config.js <repoConfig> <deployConfig>
 */
const fs = require('fs');

const [, , repoPath, depPath] = process.argv;
if (!repoPath || !depPath) {
    console.error('用法: node work/merge_deploy_config.js <repoConfig> <deployConfig>');
    process.exit(2);
}

const repo = fs.readFileSync(repoPath, 'utf8');
const dep = fs.readFileSync(depPath, 'utf8');

if (/"web"\s*:/.test(dep)) {
    console.log('[merge] 部署 config.json 已存在 web 段，跳过（如需更新请手动合并）');
    process.exit(0);
}

// ── 从仓库配置里摘出 web 段（含上方注释），按花括号配对找结尾 ──
const anchor = repo.indexOf('  // ===== 内置 HTTP 上传站');
const keyIdx = repo.indexOf('  "web": {');
if (anchor < 0 || keyIdx < 0) {
    console.error('[merge] 仓库 config.json 里找不到 web 段');
    process.exit(1);
}
let depth = 0, end = -1;
for (let i = repo.indexOf('{', keyIdx); i < repo.length; i++) {
    if (repo[i] === '{') depth++;
    else if (repo[i] === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
    }
}
if (end < 0) {
    console.error('[merge] web 段花括号不配对');
    process.exit(1);
}
const block = repo.slice(anchor, end + 1);

// ── 插到部署文件根对象闭合处之前 ──
const close = dep.lastIndexOf('}');
if (close < 0) {
    console.error('[merge] 部署 config.json 结构异常（找不到根闭合）');
    process.exit(1);
}
const before = dep.slice(0, close).replace(/[\s,]+$/, '');
const merged = `${before},\n\n${block}\n}\n`;

// ── 自检：宽松解析（去 // 与 /* */ 注释）后必须能 JSON.parse，且旧键仍在 ──
const strip = (s) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const beforeObj = JSON.parse(strip(dep));
const afterObj = JSON.parse(strip(merged));

for (const key of Object.keys(beforeObj)) {
    if (!(key in afterObj)) throw new Error(`合并后丢了顶层键: ${key}`);
}
if (!afterObj.web || afterObj.web.port !== 8080) throw new Error('web 段没有正确写入');
if (JSON.stringify(afterObj.render) !== JSON.stringify(beforeObj.render)) throw new Error('render 段被改动');

fs.writeFileSync(depPath, merged, 'utf8');
console.log('[merge] 已合并 web 段');
console.log('[merge] 顶层键:', Object.keys(afterObj).join(', '));
console.log('[merge] web =', JSON.stringify(afterObj.web));
console.log('[merge] 文件大小:', dep.length, '→', merged.length);
