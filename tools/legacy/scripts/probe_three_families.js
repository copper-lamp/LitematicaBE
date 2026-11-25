#!/usr/bin/env node
/** 探测 stairs / trapdoor / door 三族的贴图可用性（只读） */
const fs = require('fs');

const MODEL_DIR = 'C:/Users/25491/Desktop/建模对应清单';
const GHOST = 'D:/GitHub/LitematicaBE/resources/addon/LitematicaBE_RP/textures/blocks/ghost';
const VAN = 'D:/GitHub/LitematicaBE/../LitematicaBE/../..' && 'C:/Users/25491/Desktop/建模贴图/resource/bedrock-samples-v1.26.60.5-full/resource_pack/textures/blocks';
const IDX = 'D:/GitHub/LitematicaBE/resources/data/ghost_index.json';

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const bsm = read(`${MODEL_DIR}/block_shape_map.json`);
const idx = read(IDX);
const ghost = new Set(fs.readdirSync(GHOST).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)));
const van = new Set(fs.readdirSync(VAN).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)));

const has = (n) => ghost.has(`ghost_${n}`) || van.has(n);
const anchor = (b) => {
    const id = idx.javaMap[`minecraft:${b}`];
    const m = id && idx.blocks[id];
    return m ? m.texture : null;
};

// 材质族 -> 可能的贴图基名
const PLURAL = { brick: 'bricks', stone_brick: 'stone_bricks', nether_brick: 'nether_bricks', end_stone_brick: 'end_stone_bricks',
    mossy_stone_brick: 'mossy_stone_bricks', red_nether_brick: 'red_nether_bricks', polished_blackstone_brick: 'polished_blackstone_bricks',
    tuff_brick: 'tuff_bricks', mud_brick: 'mud_bricks', cinnabar_brick: 'cinnabar_bricks', sulfur_brick: 'sulfur_bricks', resin_brick: 'resin_bricks' };
const SPECIAL = {
    normal_stone: 'stone', smooth_stone: 'stone', stone: 'stone', wooden: 'oak_planks', petrified_oak: 'oak_planks',
    smooth_quartz: 'quartz_block_bottom', quartz: 'quartz_block_side', sandstone: 'sandstone',
    cut_sandstone: 'cut_sandstone', smooth_sandstone: 'sandstone_smooth',
    red_sandstone: 'red_sandstone', cut_red_sandstone: 'cut_red_sandstone', smooth_red_sandstone: 'red_sandstone_smooth',
    blackstone: 'blackstone', bamboo_mosaic: 'bamboo_mosaic',
};

function stemOf(block, suffix) {
    return block.replace(new RegExp(`_${suffix}$`), '');
}

function resolveSide(block, suffix) {
    const anc = anchor(block);
    if (anc) return { tex: anc, src: 'anchor' };
    const stem = stemOf(block, suffix);
    const cands = [SPECIAL[stem], PLURAL[stem], stem, `${stem}_planks`, `${stem}_block`].filter(Boolean);
    for (const c of cands) if (has(c)) return { tex: c, src: 'stem' };
    return { tex: null, src: 'miss' };
}

for (const [suffix, label] of [['stairs', '楼梯'], ['trapdoor', '活板门'], ['door', '门']]) {
    const list = Object.entries(bsm).filter(([, s]) => s === suffix).map(([k]) => k).sort();
    let mapped = 0; const miss = [];
    for (const b of list) {
        if (idx.javaMap[`minecraft:${b}`]) mapped++;
        const r = resolveSide(b, suffix);
        if (!r.tex) miss.push(b);
    }
    console.log(`=== ${label}(${suffix}) 共 ${list.length}，已有映射 ${mapped}，贴图解析失败 ${miss.length}`);
    if (miss.length) console.log('   缺贴图: ' + miss.join(', '));
}

// door 的 upper/lower 贴图是否存在
const doorSample = ['door_oak_lower', 'door_oak_upper', 'door_iron_lower', 'door_iron_upper', 'door_copper_lower', 'door_copper_upper'];
console.log('\n=== 门上下贴图探测');
for (const n of doorSample) console.log(`  ${n}: ${ghost.has(`ghost_${n}`) ? 'ghost有' : (van.has(n) ? '原版有' : '缺')}`);

// 现有 door/trapdoor/stairs 的 index texture
console.log('\n=== 现有映射的 texture');
for (const b of ['oak_door', 'iron_door', 'copper_door', 'oak_trapdoor', 'iron_trapdoor', 'oak_stairs', 'stone_stairs', 'sandstone_stairs']) {
    const id = idx.javaMap[`minecraft:${b}`];
    console.log(`  ${b} -> ${id || '(无)'} texture=${anchor(b) || '-'}`);
}
