// 自检：ghost 方向映射（work/ 已 gitignore）
const path = require('path');
const { GhostBlockRegistry } = require('../src/ghost/GhostBlockRegistry.js');

const reg = new GhostBlockRegistry(path.join(__dirname, '..', 'resources', 'data', 'ghost_index.json'));
console.log('ready:', reg.ready, '| blocks:', reg.blocks.size);

const cases = [
    ['observer  mcstructure(west)', 'minecraft:observer', { facing_direction: 'west' }, { 'lit:facing': 5 }],
    ['observer  mcstructure(north)', 'minecraft:observer', { facing_direction: 'north' }, { 'lit:facing': 3 }],
    ['observer  mcstructure(east)', 'minecraft:observer', { facing_direction: 'east' }, { 'lit:facing': 4 }],
    ['observer  mcstructure(south)', 'minecraft:observer', { facing_direction: 'south' }, { 'lit:facing': 2 }],
    ['observer  旧 int(2=north)', 'minecraft:observer', { facing_direction: 2 }, { 'lit:facing': 3 }],
    ['dispenser mcstructure(5)', 'minecraft:dispenser', { facing_direction: 5 }, { 'lit:facing': 5 }],
    ['dispenser mcstructure(2)', 'minecraft:dispenser', { facing_direction: 2 }, { 'lit:facing': 2 }],
    ['dispenser litematic(east)', 'minecraft:dispenser', { facing: 'east' }, { 'lit:facing': 5 }],
    ['dispenser litematic(north)', 'minecraft:dispenser', { facing: 'north' }, { 'lit:facing': 2 }],
    ['dropper   mcstructure(4)', 'minecraft:dropper', { facing_direction: 4 }, { 'lit:facing': 4 }],
];

let bad = 0;
for (const [label, name, src, expect] of cases) {
    const got = reg.buildStates(name, src);
    const ok = JSON.stringify(got) === JSON.stringify(expect);
    if (!ok) bad++;
    console.log(`${ok ? '✅' : '❌'} ${label}  got=${JSON.stringify(got)}  expect=${JSON.stringify(expect)}`);
}
console.log(bad ? `\n${bad} 项不符` : '\n全部符合');
process.exit(bad ? 1 : 0);
