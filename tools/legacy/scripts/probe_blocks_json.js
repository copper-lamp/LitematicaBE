const fs = require('fs');
const p = 'C:/Users/25491/Desktop/建模贴图/resource/bedrock-samples-v1.26.60.5-full/resource_pack/blocks.json';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(/^\s*\/\/.*$/gm, '');
const j = JSON.parse(s);
console.log('keys sample:', Object.keys(j).slice(0, 30));
for (const k of Object.keys(j).filter((n) => /repeater|comparator/.test(n))) {
    console.log(k, '=>', JSON.stringify(j[k], null, 1));
}
