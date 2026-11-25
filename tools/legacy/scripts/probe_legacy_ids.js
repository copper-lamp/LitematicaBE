// 评估 BlockMappingRegistry 有多少条输出的是"1.20.50 之前"的 legacy ID
// 依据：中文 Minecraft Wiki「基岩版扁平化」页面的拆分时间表
const path = require('path');
const BASE = path.resolve('LitematicaBE-2.6.0/plugins/LitematicaBE');
const { BlockMappingRegistry } = require(path.join(BASE, 'src/mappings/BlockMappingRegistry'));

const reg = new BlockMappingRegistry();

// 已在基岩版扁平化中拆分掉的"容器型"旧 ID -> 拆分后的命名规则
const LEGACY_SPLIT = {
    planks: '1.20.50 → <wood>_planks',
    stone: '1.20.50 → stone / granite / diorite / andesite / polished_*',
    stonebrick: '需核对 → stone_bricks / mossy_* / cracked_* / chiseled_*',
    wool: '1.19.70 → <color>_wool',
    carpet: '1.20.0 → <color>_carpet',
    log: '1.20.0 → <wood>_log',
    log2: '1.20.0 → <wood>_log',
    leaves: '1.20.70 → <wood>_leaves',
    leaves2: '1.20.70 → <wood>_leaves',
    wooden_slab: '1.20.70 → <wood>_slab',
    double_wooden_slab: '1.20.70 → <wood>_double_slab',
    concrete: '1.20.10 → <color>_concrete',
    concretepowder: '1.20.30 → <color>_concrete_powder',
    concrete_powder: '1.20.30 → <color>_concrete_powder',
    fence: '1.19.80 → <wood>_fence',
    wood: '1.20.70 → <wood>_wood / stripped_<wood>_wood',
    stained_glass: '1.20.20 → <color>_stained_glass',
    stained_glass_pane: '1.20.20 → <color>_stained_glass_pane',
    stained_hardened_clay: '1.20.30 → <color>_terracotta',
    hardened_clay: '1.20.30 → terracotta',
    monster_egg: '需核对 → infested_*',
    coral: '1.20.0 → <type>_coral',
    coral_block: '1.21.0 → <type>_coral_block',
    coral_fan: '1.20.80 → <type>_coral_fan',
    sapling: '1.20.80 → <wood>_sapling',
    double_plant: '需核对',
    tallgrass: '1.21.0 → short_grass / fern',
    skull: '需核对 → <type>_skull',
};

const allJava = reg.getAllJavaNames();
const rows = [];
for (const j of allJava) {
    let be = null;
    try { be = reg.getBedrockName(j); } catch (e) {}
    rows.push({ java: j, be });
}

/**
 * 判据要和"是否真的错"对齐：容器 ID 名恰好等于该方块自己的扁平化名时（`minecraft:stone` -> `stone`），
 * 它不是 legacy 输出，只是名字相同。所以要求 be !== java 短名。
 */
const legacyRows = rows.filter(r => {
    if (!r.be || !Object.prototype.hasOwnProperty.call(LEGACY_SPLIT, r.be)) return false;
    const short = (r.java.split(':')[1] || r.java);
    return r.be !== short;
});
const byBe = {};
for (const r of legacyRows) byBe[r.be] = (byBe[r.be] || 0) + 1;

console.log(`映射表 Java 条目: ${rows.length}`);
console.log(`输出 legacy 容器 ID 的条目: ${legacyRows.length} (${(legacyRows.length / rows.length * 100).toFixed(1)}%)`);
console.log('\n=== 按 legacy ID 分布 ===');
Object.entries(byBe).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`  ${k.padEnd(22)} ${String(v).padStart(3)} 条   ${LEGACY_SPLIT[k]}`);
});

console.log('\n=== 抽样：木板 / 羊毛 / 混凝土 / 树叶 ===');
['minecraft:oak_planks', 'minecraft:spruce_planks', 'minecraft:white_wool', 'minecraft:red_wool',
 'minecraft:white_concrete', 'minecraft:oak_leaves', 'minecraft:oak_log', 'minecraft:granite',
 'minecraft:stone_bricks', 'minecraft:oak_slab', 'minecraft:white_stained_glass'].forEach(j => {
    const r = rows.find(x => x.java === j);
    console.log(`  ${j.padEnd(34)} -> ${r ? r.be : '(无映射)'}`);
});
