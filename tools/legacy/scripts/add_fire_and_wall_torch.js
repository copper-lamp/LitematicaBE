#!/usr/bin/env node
/**
 * add_fire_and_wall_torch.js
 * 1) 火焰几何 geometry.lit_fire：按 shape_models['fire'] 的 8 片倾斜平面（原版火焰十字）
 * 2) g_fire_0 / g_soul_fire_0 改用新几何 + alpha_test
 * 3) 新增墙挂火把 3 个 ghost 方块（斜插几何 lit_torch_wall），lit:dir 映射 facing
 * 4) 更新 ghost_index
 */
const fs = require('fs');
const path = require('path');

const ROOT = 'D:/GitHub/LitematicaBE';
const RP = path.join(ROOT, 'resources/addon/LitematicaBE_RP');
const BP = path.join(ROOT, 'resources/addon/LitematicaBE_BP');
const SRC = 'C:/Users/25491/Desktop/建模对应清单/shape_models.json';
const INDEX = path.join(ROOT, 'resources/data/ghost_index.json');

const sm = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const round = (v) => Math.round(v * 10000) / 10000;
const roundVec = (a) => a.map(round);

// ---------- 1. 火焰几何 ----------
const fireCubes = sm['fire'];
if (!fireCubes) throw new Error('shape_models 缺 fire');

function fireCube(c) {
    const [w, h, d] = c.size;
    const o = [c.pos[0] - 8, c.pos[1], c.pos[2] - 8];
    const faces = [];
    if (Math.abs(d) < 1e-5) faces.push('north', 'south');
    if (Math.abs(w) < 1e-5) faces.push('west', 'east');
    if (Math.abs(h) < 1e-5) faces.push('down', 'up');
    const uv = {};
    for (const f of faces) {
        const isSide = ['north', 'south', 'west', 'east'].includes(f);
        const uvSize = (f === 'north' || f === 'south') ? [w, h] : (f === 'west' || f === 'east') ? [d, h] : [w, d];
        uv[f] = { uv: [0, 0], uv_size: roundVec(uvSize), material_instance: '*' };
    }
    const out = { origin: roundVec(o), size: roundVec(c.size), uv };
    if (c.rot) {
        out.rotation = c.rot;
        out.pivot = roundVec([c.pivot[0] - 8, c.pivot[1], c.pivot[2] - 8]);
    }
    return out;
}

const fireGeo = {
    format_version: '1.19.0',
    'minecraft:geometry': [{
        description: {
            identifier: 'geometry.lit_fire',
            texture_width: 16, texture_height: 16,
            visible_bounds_width: 1, visible_bounds_height: 1, visible_bounds_offset: [0, 0, 0],
        },
        bones: [{ name: 'body', pivot: [0, 0, 0], cubes: fireCubes.map(fireCube) }],
    }],
};
fs.writeFileSync(path.join(RP, 'models/blocks/lit_fire.json'), JSON.stringify(fireGeo, null, 2) + '\n');
console.log(`  > lit_fire.json（${fireCubes.length} 片倾斜平面）`);

// ---------- 2. 火焰 BP ----------
function setFireBlock(file, geoId, tex) {
    const p = path.join(BP, 'blocks', file);
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j['minecraft:block'].components['minecraft:geometry'] = geoId;
    const mi = j['minecraft:block'].components['minecraft:material_instances'];
    mi['*'].texture = tex;
    mi['*'].render_method = 'alpha_test';
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
    console.log(`  > ${file}: geometry=${geoId}, texture=${tex}, alpha_test`);
}
setFireBlock('g_fire_0.json', 'geometry.lit_fire', 'ghost_fire_0');
setFireBlock('g_soul_fire_0.json', 'geometry.lit_fire', 'ghost_soul_fire_0');

// ---------- 3. 墙挂火把 BP ----------
const DIR_MAP = { east: 0, south: 1, west: 2, north: 3 };
const ROT = [0, 90, 180, 270];

function wallTorchBlock(id, tex) {
    return {
        format_version: '1.21.70',
        'minecraft:block': {
            description: {
                identifier: id,
                menu_category: { category: 'none' },
                states: { 'lit:dir': { values: { min: 0, max: 3 } } },
            },
            components: {
                'minecraft:geometry': 'geometry.lit_torch_wall',
                'minecraft:material_instances': {
                    '*': { texture: tex, render_method: 'alpha_test', face_dimming: false, ambient_occlusion: false },
                },
                'minecraft:collision_box': false,
                'minecraft:selection_box': false,
                'minecraft:destructible_by_mining': false,
                'minecraft:destructible_by_explosion': false,
                'minecraft:replaceable': {},
                'minecraft:light_dampening': 0,
                'minecraft:map_color': '#888888',
                'minecraft:transformation': { rotation: [0, 0, 0], scale: [1, 1, 1], translation: [0, 0, 0] },
            },
            permutations: ROT.map((deg, i) => ({
                condition: `q.block_state('lit:dir') == ${i}`,
                components: {
                    'minecraft:transformation': { rotation: [0, deg, 0], scale: [1, 1, 1], translation: [0, 0, 0] },
                },
            })),
        },
    };
}

const wallDefs = [
    ['g_wall_torch.json', 'lit:g_wall_torch', 'ghost_torch'],
    ['g_redstone_wall_torch.json', 'lit:g_redstone_wall_torch', 'ghost_redstone_torch'],
    ['g_soul_wall_torch.json', 'lit:g_soul_wall_torch', 'ghost_soul_torch'],
];
for (const [file, id, tex] of wallDefs) {
    fs.writeFileSync(path.join(BP, 'blocks', file), JSON.stringify(wallTorchBlock(id, tex), null, 2) + '\n');
    console.log(`  > ${file}（${id}, ${tex}）`);
}

// ---------- 4. ghost_index ----------
const gi = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const dirState = { type: 'int', min: 0, max: 3, default: 0, from: 'facing', map: DIR_MAP };

gi.blocks['lit:g_fire_0'] = { ...gi.blocks['lit:g_fire_0'], geometry: 'fire' };
gi.blocks['lit:g_soul_fire_0'] = { ...gi.blocks['lit:g_soul_fire_0'], geometry: 'fire' };

gi.blocks['lit:g_wall_torch'] = { texture: 'torch', geometry: 'torch_wall', states: { 'lit:dir': dirState } };
gi.blocks['lit:g_redstone_wall_torch'] = { texture: 'redstone_torch', geometry: 'torch_wall', states: { 'lit:dir': dirState } };
gi.blocks['lit:g_soul_wall_torch'] = { texture: 'soul_torch', geometry: 'torch_wall', states: { 'lit:dir': dirState } };

gi.javaMap['minecraft:wall_torch'] = 'lit:g_wall_torch';
gi.javaMap['minecraft:redstone_wall_torch'] = 'lit:g_redstone_wall_torch';
gi.javaMap['minecraft:soul_wall_torch'] = 'lit:g_soul_wall_torch';

fs.writeFileSync(INDEX, JSON.stringify(gi, null, 2) + '\n');
console.log(`  > ghost_index.json（blocks ${Object.keys(gi.blocks).length} / javaMap ${Object.keys(gi.javaMap).length}）`);
