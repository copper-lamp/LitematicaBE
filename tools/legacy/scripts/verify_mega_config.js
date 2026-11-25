// work/verify_mega_config.js — 验证 config.json 宽松解析后 mega 相关键的实际取值
const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '..', 'config.json');
let s = fs.readFileSync(file, 'utf8');
s = s.replace(/^\s*\/\/.*$/gm, '').replace(/\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1');
const j = JSON.parse(s);

console.log('render.enableMega      =', j.render.enableMega);
console.log('render.ghostWritesPerTick =', j.render.ghostWritesPerTick);
console.log('render.ghostMaxBlocks  =', j.render.ghostMaxBlocks);
console.log('render.tickBudgetMs    =', j.render.tickBudgetMs);
console.log('megaSchematic          =', JSON.stringify(j.megaSchematic));
console.log('megaRender             =', JSON.stringify(j.megaRender));
