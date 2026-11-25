// 探测2：验证"Java 短名优先"的贴图解析规则覆盖率
const fs = require('fs');
const path = require('path');
const BASE = path.resolve('LitematicaBE-2.6.0/plugins/LitematicaBE');
const { BlockMappingRegistry } = require(path.join(BASE, 'src/mappings/BlockMappingRegistry'));

const inv = JSON.parse(fs.readFileSync('work/texture_inventory.json', 'utf8'));
const texSet = new Set(inv.map(e => e.shot));

// 从 ProjectionRenderer 抄出的 override 表（仅探测用）
const OVERRIDE = {
    smooth_quartz: 'quartz_block_bottom', quartz_block: 'quartz_block_side',
    grass_path: 'dirt_path_top', grass_block: 'grass_block_top', dirt_path: 'dirt_path_top',
    mycelium: 'mycelium_top', podzol: 'podzol_top', ancient_debris: 'ancient_debris_top',
    basalt: 'basalt_top', blackstone: 'blackstone_top', polished_basalt: 'polished_basalt_top',
    honey_block: 'honey_block_top', furnace: 'furnace_front', smoker: 'smoker_top',
    crafting_table: 'crafting_table_top', anvil: 'anvil_top', barrel: 'barrel_top',
    loom: 'loom_top', lantern: 'lantern', soul_lantern: 'soul_lantern',
};
const strip = n => (n || '').toLowerCase().split(':').pop().replace(/[^a-z0-9_]/g, '_').replace(/_+$/, '');

const reg = new BlockMappingRegistry();
const allJava = reg.getAllJavaNames();

function texOf(javaName) {
    const s = strip(javaName);
    if (texSet.has(s)) return { tex: s, via: 'java-short' };
    if (OVERRIDE[s] && texSet.has(OVERRIDE[s])) return { tex: OVERRIDE[s], via: 'override' };
    let be = null;
    try { be = reg.getBedrockName(javaName); } catch (e) {}
    if (be && texSet.has(be)) return { tex: be, via: 'bedrock-name' };
    return { tex: null, via: 'miss', be };
}

const result = allJava.map(j => ({ java: j, ...texOf(j) }));
const hit = result.filter(r => r.tex);
const miss = result.filter(r => !r.tex);

console.log(`全部 Java 映射条目: ${allJava.length}`);
console.log(`贴图命中: ${hit.length} (${(hit.length / allJava.length * 100).toFixed(1)}%)`);
console.log(`未命中: ${miss.length}`);
const byVia = {};
hit.forEach(r => byVia[r.via] = (byVia[r.via] || 0) + 1);
console.log('命中途径分布:', JSON.stringify(byVia));

const uniqueTex = new Set(hit.map(r => r.tex));
console.log(`唯一贴图数（ghost ID 上界）: ${uniqueTex.size}`);

console.log('\n=== 未命中样本（前40）===');
miss.slice(0, 40).forEach(r => console.log(`  ${r.java}  ->  be=${r.be}`));

fs.writeFileSync('work/resolve_report.json', JSON.stringify({ total: allJava.length, hit: hit.length, miss: miss.length, uniqueTex: uniqueTex.size, result }, null, 1), { encoding: 'utf8' });
console.log('\n明细已写入 work/resolve_report.json');

// 关键方块抽查
const watch = ['minecraft:stone', 'minecraft:oak_planks', 'minecraft:white_wool', 'minecraft:stone_bricks',
    'minecraft:grass_block', 'minecraft:oak_log', 'minecraft:oak_leaves', 'minecraft:glass',
    'minecraft:oak_stairs', 'minecraft:oak_slab', 'minecraft:water', 'minecraft:lava', 'minecraft:glass_pane',
    'minecraft:white_concrete', 'minecraft:sandstone', 'minecraft:quartz_block', 'minecraft:white_terracotta'];
console.log('\n=== 关键方块解析 ===');
watch.forEach(j => { const r = texOf(j); console.log(`  ${j.padEnd(34)} -> ${r.tex || '(miss)'}  [${r.via}]`); });
