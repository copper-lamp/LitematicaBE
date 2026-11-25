// 验证 repeater 状态链路：javaToBedrock → buildStates → lit:*
const path = require('path');
const ROOT = 'D:/GitHub/LitematicaBE';

const conv = require(path.join(ROOT, 'src/mappings/BlockStateConverters.js'));
console.log('exports:', Object.keys(conv));

const javaStates = { delay: '3', facing: 'north', powered: 'false', locked: 'false' };
let be;
for (const fn of ['javaToBedrock', 'convertJavaToBedrock', 'toBedrock']) {
    if (typeof conv[fn] === 'function') {
        try {
            be = conv[fn]('minecraft:repeater', javaStates);
            console.log(`\n${fn}('minecraft:repeater', ${JSON.stringify(javaStates)}) =`, JSON.stringify(be));
        } catch (e) {
            console.log(fn, 'threw', e.message);
        }
    }
}

// buildStates
const { GhostBlockRegistry } = require(path.join(ROOT, 'src/ghost/GhostBlockRegistry.js'));
const reg = new GhostBlockRegistry(path.join(ROOT, 'resources/data/ghost_index.json'));
try { reg.load && reg.load(); } catch (e) {}
console.log('\nregistry ready:', reg.ready, 'blocks:', reg.blocks.size);
for (const name of ['minecraft:repeater', 'minecraft:powered_repeater', 'minecraft:comparator', 'minecraft:unpowered_repeater']) {
    const bs = reg.buildStates(name, be || {});
    console.log(name, '=>', JSON.stringify(bs));
}
