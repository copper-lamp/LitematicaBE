const fs = require('fs');
const base = 'D:/GitHub/Holoprint/src/data/';

function loadJsonc(p) {
    let s = fs.readFileSync(p, 'utf8');
    s = s.replace(/^\s*\/\/.*$/gm, '');
    s = s.replace(/(?<!:)\/\/[^\n]*$/gm, '');
    return JSON.parse(s);
}

const bsd = loadJsonc(base + 'blockStateDefinitions.json');
console.log('=== keys ===', Object.keys(bsd));
console.log('\n=== rotations ===');
console.log(JSON.stringify(bsd.rotations, null, 1).slice(0, 4000));
