// 临时：确认 ghost_index 是否就是 JSON.stringify(obj, null, 2) 的输出，并预览 map 改动
const fs = require('fs');
const p = 'resources/data/ghost_index.json';
const s = fs.readFileSync(p, 'utf8');
const obj = JSON.parse(s);
const out = JSON.stringify(obj, null, 2) + '\n';
console.log('orig bytes', s.length, '| stringify bytes', out.length, '| identical:', out === s);
if (out !== s) {
    // 找到第一个差异
    let i = 0;
    while (i < s.length && i < out.length && s[i] === out[i]) i++;
    console.log('first diff at', i);
    console.log('orig :', JSON.stringify(s.slice(Math.max(0, i - 60), i + 60)));
    console.log('new  :', JSON.stringify(out.slice(Math.max(0, i - 60), i + 60)));
}
