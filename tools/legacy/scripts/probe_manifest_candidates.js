// 一次性探测脚本：把候选 Java 方块经映射表转成 BE 短名，并核对贴图是否存在
// 用法: node work/probe_manifest_candidates.js
const fs = require('fs');
const path = require('path');

const BASE = path.resolve('LitematicaBE-2.6.0/plugins/LitematicaBE');
const { BlockMappingRegistry } = require(path.join(BASE, 'src/mappings/BlockMappingRegistry'));

const inv = JSON.parse(fs.readFileSync('work/texture_inventory.json', 'utf8'));
const textures = new Map(inv.map(e => [e.shot, e]));

const reg = new BlockMappingRegistry();
console.log('registry 方法:', Object.getOwnPropertyNames(Object.getPrototypeOf(reg)).join(', '));
if (typeof reg.getStats === 'function') console.log('registry stats:', JSON.stringify(reg.getStats()));

const CANDIDATES = [
    // 石材/泥土类
    'minecraft:stone', 'minecraft:cobblestone', 'minecraft:mossy_cobblestone', 'minecraft:dirt',
    'minecraft:coarse_dirt', 'minecraft:grass_block', 'minecraft:sand', 'minecraft:red_sand',
    'minecraft:gravel', 'minecraft:sandstone', 'minecraft:chiseled_sandstone',
    'minecraft:stone_bricks', 'minecraft:mossy_stone_bricks', 'minecraft:cracked_stone_bricks',
    'minecraft:chiseled_stone_bricks', 'minecraft:smooth_stone', 'minecraft:bricks',
    'minecraft:deepslate', 'minecraft:cobbled_deepslate', 'minecraft:deepslate_tiles',
    'minecraft:polished_deepslate', 'minecraft:blackstone', 'minecraft:basalt',
    'minecraft:nether_bricks', 'minecraft:end_stone', 'minecraft:prismarine',
    'minecraft:sea_lantern', 'minecraft:glowstone', 'minecraft:obsidian',
    // 木材
    'minecraft:oak_planks', 'minecraft:spruce_planks', 'minecraft:birch_planks',
    'minecraft:jungle_planks', 'minecraft:acacia_planks', 'minecraft:dark_oak_planks',
    'minecraft:cherry_planks', 'minecraft:mangrove_planks', 'minecraft:bamboo_planks',
    'minecraft:oak_log', 'minecraft:spruce_log', 'minecraft:birch_log',
    'minecraft:stripped_oak_log', 'minecraft:oak_leaves', 'minecraft:spruce_leaves',
    // 透明/玻璃
    'minecraft:glass', 'minecraft:glass_pane', 'minecraft:tinted_glass',
    // 染色
    'minecraft:white_concrete', 'minecraft:gray_concrete', 'minecraft:black_concrete',
    'minecraft:light_gray_concrete', 'minecraft:white_wool', 'minecraft:gray_wool',
    'minecraft:red_wool', 'minecraft:white_terracotta', 'minecraft:terracotta',
    'minecraft:white_stained_glass', 'minecraft:gray_stained_glass',
    // 金属/矿物块
    'minecraft:iron_block', 'minecraft:gold_block', 'minecraft:diamond_block',
    'minecraft:emerald_block', 'minecraft:netherite_block', 'minecraft:copper_block',
    'minecraft:quartz_block', 'minecraft:chiseled_quartz_block',
    // 楼梯 / 台阶
    'minecraft:oak_stairs', 'minecraft:oak_slab', 'minecraft:stone_brick_stairs',
    'minecraft:stone_brick_slab', 'minecraft:cobblestone_stairs', 'minecraft:cobblestone_slab',
    'minecraft:quartz_stairs', 'minecraft:quartz_slab', 'minecraft:smooth_stone_slab',
    // 液体参考（不生成 ghost，仅测试映射）
    'minecraft:water', 'minecraft:lava'
];

const rows = [];
for (const javaName of CANDIDATES) {
    const has = typeof reg.hasJava === 'function' ? reg.hasJava(javaName) : null;
    let beShort = null, err = null;
    try { beShort = reg.getBedrockName(javaName); } catch (e) { err = e.message; }
    const tex = beShort ? textures.get(beShort) : null;
    rows.push({ javaName, mapped: has, beShort: beShort || null, textureExists: !!tex, size: tex ? `${tex.w}x${tex.h}` : '', err });
}
console.table(rows);

const missing = rows.filter(r => r.mapped === false || !r.beShort || !r.textureExists);
console.log('\n=== 有问题的条目 ===');
if (!missing.length) console.log('（无）');
else missing.forEach(r => console.log(JSON.stringify(r)));
