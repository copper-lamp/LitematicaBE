// 临时探针：模拟「直接放置」链路对 mcstructure 方块的处理（work/ 已 gitignore）
const fs = require('fs');
const path = require('path');
const PLUGIN = path.resolve(__dirname, '..');
const { parseLittleEndianNbt, extractStructure } = require(path.join(PLUGIN, 'src/core/McstructureLoader.js'));
const { BlockStateConverters } = require(path.join(PLUGIN, 'src/mappings/BlockStateConverters.js'));
const { BlockMappingRegistry } = require(path.join(PLUGIN, 'src/mappings/BlockMappingRegistry.js'));
const { BlockConversions } = require(path.join(PLUGIN, 'src/easyplace/BlockConversions.js'));
const { bidirectionalConverter } = require(path.join(PLUGIN, 'src/mappings/BidirectionalBlockConverter.js'));

const file = process.argv[2];
const root = parseLittleEndianNbt(fs.readFileSync(file));
const { size, blockPalette, blockIndices } = extractStructure(root);
const [sx, sy, sz] = size;
const [i0] = blockIndices;

const blocks = [];
for (let i = 0; i < i0.length; i++) {
    const entry = blockPalette[i0[i]];
    if (!entry) continue;
    const n = String(entry.name || '').replace(/^minecraft:/, '');
    if (n === 'air' || n.endsWith('_air') || n === 'void_air') continue;
    blocks.push({ name: entry.name, states: entry.states || {} });
}

const Want = new Set(['minecraft:observer', 'minecraft:dispenser']);
const stateConverter = new BlockStateConverters();
const registry = new BlockMappingRegistry();

const seen = new Map();
for (const b of blocks) {
    if (!Want.has(b.name)) continue;
    const key = `${b.name}|${JSON.stringify(b.states)}`;
    if (seen.has(key)) continue;

    // ==== 复刻 UIManager.directPlaceAllBlocks 的 processBlock ====
    const javaStates = b.states;                 // 注意：mcstructure 投影里这其实是【基岩状态】
    const mapping = registry.getMapping(b.name);
    const beName = mapping ? mapping.b : b.name;
    const beStates = stateConverter.convertJavaToBedrock(b.name, javaStates);
    const converted = BlockConversions.convertToValid(beName, beStates);
    const finalStates = BlockConversions.resetToDefaultStates(converted.states);
    const nbt = bidirectionalConverter.buildBlockNbt(converted.name, finalStates);

    seen.set(key, {
        src: b.states,
        beStates,
        finalStates,
        placed: nbt && nbt.states ? nbt.states : nbt,
        placedName: nbt && nbt.name ? nbt.name : null,
        mapping: mapping || null
    });
}

console.log(`样本 ${path.basename(file)}  ${sx}×${sy}×${sz}`);
for (const [k, v] of seen) {
    console.log('\n== 原始（基岩）状态:', k);
    console.log('   registry:', JSON.stringify(v.mapping));
    console.log('   convertJavaToBedrock →', JSON.stringify(v.beStates));
    console.log('   resetToDefaultStates →', JSON.stringify(v.finalStates));
    console.log('   buildBlockNbt 最终 →', JSON.stringify(v.placed), '| name =', v.placedName);
}
