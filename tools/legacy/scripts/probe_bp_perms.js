const fs = require('fs');
const p = 'D:/GitHub/LitematicaBE/resources/addon/LitematicaBE_BP/blocks/g_repeater.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
const b = j['minecraft:block'];
console.log('description.states =', JSON.stringify(b.description.states));
const perms = b.permutations;
console.log('perm count', perms.length);
for (const pr of perms) {
    if (/dir'\) == 0 && q\.block_state\('lit:delay'\) == 0/.test(pr.condition)) {
        console.log('\nCOND:', pr.condition);
        console.log(JSON.stringify(pr.components, null, 1));
    }
}
// comparator
const j2 = JSON.parse(fs.readFileSync('D:/GitHub/LitematicaBE/resources/addon/LitematicaBE_BP/blocks/g_comparator.json', 'utf8'));
const perms2 = j2['minecraft:block'].permutations;
for (const pr of perms2) {
    if (/dir'\) == 0/.test(pr.condition)) {
        console.log('\nCMP COND:', pr.condition);
        console.log(JSON.stringify(pr.components, null, 1));
    }
}
