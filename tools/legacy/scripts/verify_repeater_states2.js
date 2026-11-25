// 验证 repeater 状态链路：convertJavaToBedrock → buildStates → lit:*
const path = require('path');
const ROOT = 'D:/GitHub/LitematicaBE';

const { BlockStateConverters } = require(path.join(ROOT, 'src/mappings/BlockStateConverters.js'));
const { GhostBlockRegistry } = require(path.join(ROOT, 'src/ghost/GhostBlockRegistry.js'));
const conv = new BlockStateConverters();
const reg = new GhostBlockRegistry(path.join(ROOT, 'resources/data/ghost_index.json'));
try { if (reg.load) reg.load(); } catch (e) {}

const cases = [
    ['minecraft:repeater', { delay: '1', facing: 'north', powered: 'false', locked: 'false' }],
    ['minecraft:repeater', { delay: '2', facing: 'east', powered: 'true', locked: 'false' }],
    ['minecraft:repeater', { delay: '4', facing: 'south', powered: 'false', locked: 'false' }],
    ['minecraft:powered_repeater', { repeater_delay: 2, direction: 1, powered_bit: 1 }],
    ['minecraft:comparator', { mode: 'subtract', facing: 'west', powered: 'true' }],
];

for (const [name, st] of cases) {
    const be = conv.convertJavaToBedrock(name, st);
    const ghost = reg.buildStates(name, be);
    console.log(`${name} ${JSON.stringify(st)}`);
    console.log(`   -> be = ${JSON.stringify(be)}`);
    console.log(`   -> lit = ${JSON.stringify(ghost)}`);
}
