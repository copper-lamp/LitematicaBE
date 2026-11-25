const fs = require('fs');
const { BidirectionalBlockConverter } = require('D:/GitHub/LitematicaBE/src/mappings/BidirectionalBlockConverter.js');
const { GhostBlockRegistry } = require('D:/GitHub/LitematicaBE/src/ghost/GhostBlockRegistry.js');

const conv = new BidirectionalBlockConverter();
const reg = new GhostBlockRegistry('D:/GitHub/LitematicaBE/resources/data/ghost_index.json');
try { reg.load && reg.load(); } catch (e) {}

console.log('=== wall torch: facing -> lit:dir -> rotation ===');
const bp = JSON.parse(fs.readFileSync('D:/GitHub/LitematicaBE/resources/addon/LitematicaBE_BP/blocks/g_wall_torch.json', 'utf8'))['minecraft:block'];
for (const f of ['east', 'south', 'west', 'north']) {
    const be = conv.javaToBedrock({ name: 'minecraft:wall_torch', states: { facing: f } });
    const lit = reg.buildStates('minecraft:wall_torch', be.states);
    const cond = "'lit:dir') == " + lit['lit:dir'];
    const perm = bp.permutations.find((p) => p.condition.includes(cond));
    console.log('  ' + f + ' -> lit:dir ' + lit['lit:dir'] + ' -> rot ' + JSON.stringify(perm.components['minecraft:transformation'].rotation));
}

console.log('\n=== geometry.lit_fire ===');
const g = JSON.parse(fs.readFileSync('D:/GitHub/LitematicaBE/resources/addon/LitematicaBE_RP/models/blocks/lit_fire.json', 'utf8'));
const cubes = g['minecraft:geometry'][0].bones[0].cubes;
console.log('  cube count: ' + cubes.length);
for (const c of cubes) {
    console.log('   origin ' + JSON.stringify(c.origin) + ' size ' + JSON.stringify(c.size) +
        ' rot ' + JSON.stringify(c.rotation || null) + ' pivot ' + JSON.stringify(c.pivot || null) +
        ' faces ' + Object.keys(c.uv).join('/'));
}

console.log('\n=== index entries ===');
const gi = JSON.parse(fs.readFileSync('D:/GitHub/LitematicaBE/resources/data/ghost_index.json', 'utf8'));
for (const k of ['lit:g_wall_torch', 'lit:g_redstone_wall_torch', 'lit:g_soul_wall_torch', 'lit:g_fire_0', 'lit:g_soul_fire_0']) {
    console.log('  ' + k + ' => ' + JSON.stringify(gi.blocks[k]));
}
for (const k of ['minecraft:wall_torch', 'minecraft:redstone_wall_torch', 'minecraft:soul_wall_torch', 'minecraft:fire']) {
    console.log('  javaMap ' + k + ' => ' + gi.javaMap[k]);
}
