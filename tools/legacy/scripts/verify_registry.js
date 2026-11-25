const path = require('path');
const ROOT = 'D:/GitHub/LitematicaBE';
const { BidirectionalBlockConverter } = require(path.join(ROOT, 'src/mappings/BidirectionalBlockConverter.js'));
const c = new BidirectionalBlockConverter();

const names = [
    'minecraft:repeater', 'minecraft:comparator', 'minecraft:repeater',
    'minecraft:oak_stairs', 'minecraft:hopper', 'minecraft:observer',
];
for (const n of names) {
    console.log(n, 'hasJava =', c.registry.hasJava(n), '-> bedrock:', c.registry.getBedrockName && c.registry.getBedrockName(n));
}

console.log('\n=== javaToBedrock 实际链路 ===');
const cases = [
    { name: 'minecraft:repeater', states: { delay: '3', facing: 'north', locked: 'false', powered: 'false' } },
    { name: 'minecraft:comparator', states: { facing: 'west', mode: 'subtract', powered: 'true' } },
];
for (const b of cases) {
    const r = c.javaToBedrock(b);
    console.log(b.name, '=>', JSON.stringify(r).slice(0, 300));
}
