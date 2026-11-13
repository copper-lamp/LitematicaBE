/**
 * test_slab_placement.js — 打印机 / 轻松放置放半砖时的「上下半砖 + 双半砖」状态回归
 *
 * 事故形态（1.1.83 之前）：投影里看到的是正确的半砖（上下/双），但打印机真去放的时候
 *   ① Java `type=top` 被原样写进基岩 setBlock → 基岩不认这个键（半砖要的是 `vertical_half`）
 *      → 无论投影里朝上朝下，落地全是下半砖；`waterlogged` 一起塞进去还会让 setBlock 整条失败；
 *   ② 双半砖在基岩是**独立方块名**（`double_stone_slab` / `waxed_double_cut_copper_slab`…），
 *      只按 `quartz_slab` 放 → 只放了半格；
 *   ③ 同类问题：楼梯 `half=top` 没转 `upside_down_bit`，落地永远正放。
 *
 * 覆盖（不依赖 BDS）：
 *   1. SlabNames 三种命名排法（正反双向）
 *   2. Java → 基岩：type → vertical_half、waterlogged 剥离、double 换名
 *   3. 基岩 → Java：vertical_half → type、top_slot_bit 旧存档兼容、double 名还原
 *   4. 状态过滤白名单保留 vertical_half（否则打印机在 Java→BE 之前就把它丢了）
 *   5. 校验白名单：slab 比的是 vertical_half（不是旧版 top_slot_bit）
 *   6. 楼梯 half → upside_down_bit（正反）
 */
const path = require('path');
const assert = require('assert');

const PLUGIN = path.resolve(__dirname, '..');
const { BlockStateConverters } = require(path.join(PLUGIN, 'src', 'mappings', 'BlockStateConverters.js'));
const { BidirectionalBlockConverter } = require(path.join(PLUGIN, 'src', 'mappings', 'BidirectionalBlockConverter.js'));
const SlabNames = require(path.join(PLUGIN, 'src', 'mappings', 'SlabNames.js'));
const { BlockConversions } = require(path.join(PLUGIN, 'src', 'easyplace', 'BlockConversions.js'));
const { BlockVerifier } = require(path.join(PLUGIN, 'src', 'easyplace', 'BlockVerifier.js'));

const states = new BlockStateConverters();
const conv = new BidirectionalBlockConverter();
const verifier = new BlockVerifier();

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); console.log(`  [OK] ${name}`); pass++; }
    catch (e) { console.log(`  [FAIL] ${name}\n      ${e.message}`); fail++; }
}

// —— 1. 双半砖命名 ——
t('双半砖命名：三种排法（x_double_slab / double_x_slab / waxed_double_cut_copper_slab）', () => {
    assert.strictEqual(SlabNames.slabDoubleName('minecraft:quartz_slab'), 'quartz_double_slab');
    assert.strictEqual(SlabNames.slabDoubleName('minecraft:stone_slab'), 'double_stone_slab');
    assert.strictEqual(SlabNames.slabDoubleName('minecraft:wooden_slab'), 'double_wooden_slab');
    assert.strictEqual(SlabNames.slabDoubleName('minecraft:cut_copper_slab'), 'double_cut_copper_slab');
    assert.strictEqual(SlabNames.slabDoubleName('minecraft:waxed_cut_copper_slab'), 'waxed_double_cut_copper_slab');
    assert.strictEqual(SlabNames.slabDoubleName('minecraft:exposed_cut_copper_slab'), 'exposed_double_cut_copper_slab');
    assert.strictEqual(SlabNames.slabDoubleName('minecraft:polished_blackstone_slab'), 'polished_blackstone_double_slab');
});

t('双半砖命名：反向还原（基岩名 → 半砖名）', () => {
    assert.strictEqual(SlabNames.slabNameOfDouble('double_stone_slab'), 'stone_slab');
    assert.strictEqual(SlabNames.slabNameOfDouble('quartz_double_slab'), 'quartz_slab');
    assert.strictEqual(SlabNames.slabNameOfDouble('waxed_double_cut_copper_slab'), 'waxed_cut_copper_slab');
    assert.strictEqual(SlabNames.slabNameOfDouble('oak_slab'), null, '普通半砖不该被当成双半砖');
});

t('非半砖不会被误判', () => {
    assert.strictEqual(SlabNames.isSlabName('minecraft:oak_stairs'), false);
    assert.strictEqual(SlabNames.isSlabName('minecraft:oak_slab'), true);
    assert.strictEqual(SlabNames.slabDoubleName('minecraft:oak_stairs'), null);
});

// —— 2. Java → 基岩（打印机真正写进世界的东西）——
t('type=top/bottom → 基岩 vertical_half（不再是 type）', () => {
    assert.deepStrictEqual(states.convertJavaToBedrock('minecraft:quartz_slab', { type: 'top' }), { vertical_half: 'top' });
    assert.deepStrictEqual(states.convertJavaToBedrock('minecraft:oak_slab', { type: 'bottom' }), { vertical_half: 'bottom' });
});

t('waterlogged 被剥掉（基岩半砖没有这个状态，留着会让 setBlock 失败）', () => {
    const be = states.convertJavaToBedrock('minecraft:quartz_slab', { type: 'top', waterlogged: 'false' });
    assert.strictEqual(be.waterlogged, undefined);
    assert.strictEqual(be.vertical_half, 'top');
});

t('type=double → 换成基岩独立双半砖方块名，状态清空', () => {
    const be = conv.javaToBedrock({ name: 'minecraft:stone_slab', states: { type: 'double' } });
    assert.strictEqual(be.name, 'double_stone_slab');
    assert.deepStrictEqual(be.states, {});
    const be2 = conv.javaToBedrock({ name: 'minecraft:quartz_slab', states: { type: 'double' } });
    assert.strictEqual(be2.name, 'quartz_double_slab');
});

t('buildBlockNbt（打印机实际调用的入口）带出 vertical_half', () => {
    const nbt = conv.buildBlockNbt('minecraft:quartz_slab', { type: 'top' });
    assert.strictEqual(nbt.name, 'quartz_slab');
    assert.deepStrictEqual(nbt.states, { vertical_half: 'top' });
});

// —— 3. 基岩 → Java ——
t('vertical_half → type（.mcstructure 读回来不丢上下）', () => {
    const java = states.convertBedrockToJava('quartz_slab', { vertical_half: 'top' }, 'minecraft:quartz_slab');
    assert.strictEqual(java.type, 'top');
    assert.strictEqual(java.vertical_half, undefined);
});

t('旧版 top_slot_bit 存档也认', () => {
    assert.strictEqual(states.convertBedrockToJava('quartz_slab', { top_slot_bit: 1 }, 'minecraft:quartz_slab').type, 'top');
    assert.strictEqual(states.convertBedrockToJava('quartz_slab', { top_slot_bit: 0 }, 'minecraft:quartz_slab').type, 'bottom');
});

t('基岩双半砖名 → Java 半砖 + type=double', () => {
    const j = conv.bedrockToJava({ name: 'double_stone_slab', states: {} });
    assert.strictEqual(j.name, 'minecraft:stone_slab');
    assert.strictEqual(j.states.type, 'double');
});

// —— 4. easyplace 前置过滤 ——
t('filterDirectionStates 保留 vertical_half（.mcstructure 投影走这条）', () => {
    const st = BlockConversions.filterDirectionStates({ vertical_half: 'top', waterlogged: 'false', foo: 1 });
    assert.strictEqual(st.vertical_half, 'top');
    assert.strictEqual(st.foo, undefined);
});

t('端到端：投影 Java state → 过滤 → 落地方块状态', () => {
    // EasyPlaceManager.placeBlockAt 的等价路径
    const projState = { type: 'top', waterlogged: 'false' };
    const converted = BlockConversions.convertToValid('minecraft:quartz_slab', projState);
    const filtered = BlockConversions.filterDirectionStates(converted.states);
    const landed = conv.javaToBedrock({ name: converted.name, states: filtered });
    assert.strictEqual(landed.name, 'quartz_slab');
    assert.strictEqual(landed.states.vertical_half, 'top');
});

// —— 5. 校验白名单 ——
t('BlockVerifier：slab 校验的是 vertical_half（旧版写的是 top_slot_bit）', () => {
    assert.deepStrictEqual(verifier.getImportantStates('minecraft:quartz_slab'), ['vertical_half']);
    assert.deepStrictEqual(verifier.getImportantStates('double_stone_slab'), ['vertical_half']);
});

// —— 6. 楼梯同类问题 ——
t('楼梯 half=top → upside_down_bit=1（落地不再永远正放）', () => {
    const be = states.convertJavaToBedrock('minecraft:oak_stairs', { facing: 'east', half: 'top' });
    assert.strictEqual(be.upside_down_bit, 1);
    assert.strictEqual(be.half, undefined);
    const be2 = states.convertJavaToBedrock('minecraft:oak_stairs', { facing: 'east', half: 'bottom' });
    assert.strictEqual(be2.upside_down_bit, 0);
});

t('楼梯反向：upside_down_bit=1 → half=top', () => {
    const java = states.convertBedrockToJava('oak_stairs', { weirdo_direction: 0, upside_down_bit: 1 }, 'minecraft:oak_stairs');
    assert.strictEqual(java.half, 'top');
    assert.strictEqual(java.facing, 'east');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail > 0 ? 1 : 0);
