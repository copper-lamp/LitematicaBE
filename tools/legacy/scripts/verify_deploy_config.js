// 部署后配置宽松解析校验（支持 // 注释与尾随逗号）
const fs = require('fs');
const p = process.argv[2];
let t = fs.readFileSync(p, 'utf8');
// 去掉行注释（避免误伤字符串内的 // 与 http://，用朴素状态机）
let out = '';
let inStr = false, esc = false;
for (let i = 0; i < t.length; i++) {
    const c = t[i], n = t[i + 1];
    if (inStr) {
        out += c;
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { while (i < t.length && t[i] !== '\n') i++; out += '\n'; continue; }
    out += c;
}
out = out.replace(/,(\s*[}\]])/g, '$1');
const cfg = JSON.parse(out);
const keys = Object.keys(cfg);
console.log('top-level keys:', keys.join(', '));
console.log('updateCheck:', JSON.stringify(cfg.updateCheck));
console.log('web.port:', cfg.web && cfg.web.port, '| render.mode:', cfg.render && cfg.render.mode);
console.log('megaSchematic.threshold:', cfg.megaSchematic && cfg.megaSchematic.threshold);
console.log('PARSE OK');
