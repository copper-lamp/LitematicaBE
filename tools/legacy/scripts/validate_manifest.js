// 校验 ghost_manifest 候选贴图并生成 tools/ghost_manifest.json
const fs = require('fs');
const path = require('path');
const R = require('path').resolve('./tools/ghost_texture_resolver.js');
const resolver = require(R);

const { has, entries } = resolver.loadTextureSet('work/texture_inventory.json');
const byName = new Map(entries.map(e => [e.shot, e]));

// ---- 候选：full_block 类（按贴图名直接指定） ----
const FULL_BLOCK_TEXTURES = [
    // 石材 / 自然
    'stone', 'cobblestone', 'mossy_cobblestone', 'dirt', 'grass_block_top', 'sand', 'gravel',
    'sandstone', 'stone_bricks', 'mossy_stone_bricks', 'chiseled_stone_bricks',
    'deepslate', 'cobbled_deepslate', 'deepslate_tiles', 'polished_deepslate',
    'blackstone_top', 'end_stone', 'obsidian', 'netherrack', 'granite', 'diorite', 'andesite',
    'bricks', 'quartz_block_side',
    // 木材
    'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', 'acacia_planks',
    'dark_oak_planks', 'cherry_planks', 'mangrove_planks', 'bamboo_planks',
    'crimson_planks', 'warped_planks',
    // 原木 / 树叶
    'oak_log', 'spruce_log', 'birch_log', 'stripped_oak_log', 'oak_leaves', 'spruce_leaves',
    // 玻璃
    'glass', 'tinted_glass',
    // 染色
    'white_concrete', 'gray_concrete', 'black_concrete', 'white_wool', 'gray_wool', 'red_wool',
    'white_terracotta', 'white_stained_glass',
    // 金属
    'iron_block', 'gold_block', 'diamond_block', 'emerald_block', 'netherite_block', 'copper_block',
];

// ---- 形状类：java 短名 -> 材质贴图 ----
const SHAPED = [
    { java: 'oak_stairs', tex: 'oak_planks', geo: 'stairs' },
    { java: 'stone_brick_stairs', tex: 'stone_bricks', geo: 'stairs' },
    { java: 'cobblestone_stairs', tex: 'cobblestone', geo: 'stairs' },
    { java: 'oak_slab', tex: 'oak_planks', geo: 'slab' },
    { java: 'stone_brick_slab', tex: 'stone_bricks', geo: 'slab' },
    { java: 'cobblestone_slab', tex: 'cobblestone', geo: 'slab' },
];

const report = { ok: [], missingTexture: [], missingShaped: [] };
const blocks = [];
const ids = new Set();

for (const tex of FULL_BLOCK_TEXTURES) {
    if (!has(tex)) { report.missingTexture.push(tex); continue; }
    const e = byName.get(tex);
    const id = resolver.ghostIdOf(tex);
    if (ids.has(id)) { console.log(`!! ID 冲突: ${id}`); continue; }
    ids.add(id);
    blocks.push({ id, texture: tex, geometry: 'full_block', size: `${e.w}x${e.h}` });
    report.ok.push(tex);
}

for (const s of SHAPED) {
    if (!has(s.tex)) { report.missingShaped.push(s.java + ' (缺素材 ' + s.tex + ')'); continue; }
    const id = `lit:g_${s.java}`;
    if (ids.has(id)) { console.log(`!! ID 冲突: ${id}`); continue; }
    ids.add(id);
    const e = byName.get(s.tex);
    blocks.push({ id, texture: s.tex, geometry: s.geo, java: `minecraft:${s.java}`, size: `${e.w}x${e.h}` });
}

// 兜底：贴图由 build_addon.js 在构建期生成（半透明纯灰 16x16），不依赖资源包里的既有文件
blocks.push({ id: resolver.DEFAULT_GENERIC, texture: 'generic', geometry: 'full_block' });

const manifest = {
    $comment: '由 work/validate_manifest.js 生成。改清单请改该脚本的候选表后重跑，不要手改本文件。',
    addonVersion: [1, 1, 1],
    geometries: {
        full_block: 'minecraft:geometry.full_block',
        stairs: 'geometry.lit_stairs',
        slab: 'geometry.lit_slab',
    },
    blocks,
};

fs.writeFileSync('tools/ghost_manifest.json', JSON.stringify(manifest, null, 2), { encoding: 'utf8' });

console.log('=== 校验结果 ===');
console.log(`full_block 计划 ${FULL_BLOCK_TEXTURES.length} 条，通过 ${report.ok.length} 条`);
if (report.missingTexture.length) console.log('缺失贴图: ' + report.missingTexture.join(', '));
console.log(`形状类计划 ${SHAPED.length} 条，通过 ${blocks.filter(b => b.geometry !== 'full_block').length} 条`);
if (report.missingShaped.length) console.log('形状类问题: ' + report.missingShaped.join('; '));
console.log(`\n最终 ghost 定义总数: ${blocks.length}（含 generic 兜底）`);
console.log(`其中 32x32 贴图: ${blocks.filter(b => b.size === '32x32').map(b => b.id).join(', ') || '（无）'}`);
console.log('\n已写入 tools/ghost_manifest.json');
