/**
 * 诊断：直接放置链路（映射表 → 严格状态 → NBT / 命令）
 * 修复后应看到：name 带 minecraft:、states 不含 Java 残留键、version = 18168865。
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { BlockConversions } = require(path.join(ROOT, 'src', 'easyplace', 'BlockConversions.js'));
const { BlockStateConverters } = require(path.join(ROOT, 'src', 'mappings', 'BlockStateConverters.js'));
const { BlockMappingRegistry } = require(path.join(ROOT, 'src', 'mappings', 'BlockMappingRegistry.js'));
const { bidirectionalConverter } = require(path.join(ROOT, 'src', 'mappings', 'BidirectionalBlockConverter.js'));
const { toStrictStates, toCommandStateParts } = require(path.join(ROOT, 'src', 'mappings', 'BedrockStateSchema.js'));

const stateConverter = new BlockStateConverters();
const registry = new BlockMappingRegistry();

const samples = [
    { tag: 'observer', name: 'minecraft:observer', state: { facing: 'west', powered: 'false' } },
    { tag: 'mcstructure/observer', name: 'minecraft:observer', state: { 'minecraft:facing_direction': 'west', powered_bit: 0 } },
    { tag: 'oak_stairs', name: 'minecraft:oak_stairs', state: { facing: 'east', half: 'bottom', shape: 'straight' } },
    { tag: 'wall_torch', name: 'minecraft:wall_torch', state: { facing: 'north' } },
    { tag: 'quartz_slab', name: 'minecraft:quartz_slab', state: { type: 'top' } },
    { tag: 'redstone_torch(灭)', name: 'minecraft:redstone_torch', state: { lit: 'false' } },
    { tag: 'dispenser', name: 'minecraft:dispenser', state: { facing: 'east' } },
];

for (const s of samples) {
    console.log(`\n===== ${s.tag} =====`);
    const mapping = registry.getMapping(s.name);
    const beName = mapping ? mapping.b : s.name;
    const raw = stateConverter.convertJavaToBedrock(s.name, s.state);
    const { states: strict, dropped } = toStrictStates(raw);
    console.log('映射表原始状态 :', JSON.stringify(raw));
    console.log('丢弃 Java 键   :', JSON.stringify(dropped));
    console.log('严格状态       :', JSON.stringify(strict));
    console.log('命令状态片段   :', JSON.stringify(toCommandStateParts(strict)));

    const nbt = bidirectionalConverter.buildBedrockBlockNbt(beName, strict);
    console.log('NBT            :', JSON.stringify({ name: nbt.name, states: nbt.states, version: nbt.version }));
}
