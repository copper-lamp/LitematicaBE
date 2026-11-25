const fs = require('fs');
const base = 'D:/GitHub/Holoprint/src/data/';

function loadJsonc(p) {
    let s = fs.readFileSync(p, 'utf8');
    s = s.replace(/^\s*\/\/.*$/gm, '');
    s = s.replace(/(?<!:)\/\/[^\n]*$/gm, '');
    return JSON.parse(s);
}

const shapes = loadJsonc(base + 'blockShapes.json');
console.log('=== blockShapes keys ===');
console.log(JSON.stringify(shapes, null, 1).slice(0, 3000));

const bsd = loadJsonc(base + 'blockStateDefinitions.json');
console.log('\n=== blockStateDefinitions (repeater/comparator related) ===');
const s = JSON.stringify(bsd, null, 1);
console.log(s.slice(0, 4000));
