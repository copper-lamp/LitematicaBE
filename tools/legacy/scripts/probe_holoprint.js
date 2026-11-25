const fs = require('fs');
const base = 'D:/GitHub/Holoprint/src/data/';

function loadJsonc(p) {
    let s = fs.readFileSync(p, 'utf8');
    // 去掉 // 行注释（数据文件中已确认不含字符串内 //）
    s = s.replace(/^\s*\/\/.*$/gm, '');
    s = s.replace(/(?<!:)\/\/[^\n]*$/gm, '');
    return JSON.parse(s);
}

const g = loadJsonc(base + 'blockShapeGeos.json');
console.log('count', Object.keys(g).length);
for (const k of ['repeater', 'comparator']) {
    console.log('### ' + k);
    console.log(JSON.stringify(g[k], null, 1));
}
