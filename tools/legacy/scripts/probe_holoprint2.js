const fs = require('fs');
const base = 'D:/GitHub/Holoprint/src/data/';

function loadJsonc(p) {
    let s = fs.readFileSync(p, 'utf8');
    s = s.replace(/^\s*\/\/.*$/gm, '');
    s = s.replace(/(?<!:)\/\/[^\n]*$/gm, '');
    return JSON.parse(s);
}

const g = loadJsonc(base + 'blockShapeGeos.json');
const names = Object.keys(g).filter((k) => /torch|template/.test(k));
console.log('template/torch shapes:', names.join(', '));
for (const k of names) {
    console.log('\n### ' + k);
    console.log(JSON.stringify(g[k]));
}
