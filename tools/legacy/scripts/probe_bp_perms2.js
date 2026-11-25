const fs = require('fs');
for (const f of ['g_comparator.json', 'g_unpowered_comparator.json']) {
    const j = JSON.parse(fs.readFileSync('D:/GitHub/LitematicaBE/resources/addon/LitematicaBE_BP/blocks/' + f, 'utf8'));
    console.log('=== ' + f);
    for (const pr of j['minecraft:block'].permutations) {
        if (!/dir'\) == 0/.test(pr.condition)) continue;
        const c = pr.components;
        console.log(pr.condition.replace(/q\.block_state/g, '').replace(/\s+/g, ' '));
        console.log('   geo=' + c['minecraft:geometry']);
        const mi = c['minecraft:material_instances'];
        console.log('   mats=' + Object.entries(mi).map(([k, v]) => k + ':' + v.texture).join(' '));
    }
}
