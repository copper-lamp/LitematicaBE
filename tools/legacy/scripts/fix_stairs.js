#!/usr/bin/env node
/**
 * fix_stairs.js — 修复楼梯系的建模映射
 *
 * 问题：javaMap 里 35 个 *_stairs 只有 oak_stairs 用了 geometry.lit_stairs，
 *       其余全指向「同材质整块方块」，渲染成整块；且没有 upside_down_bit 支持。
 * 修复：
 *   1) 生成倒置几何 geometry.lit_stairs_up（台阶在下半）
 *   2) 为每个楼梯材质生成专用 ghost 方块 lit:g_<name>：
 *        states: lit:dir(from weirdo_direction 0..3) + lit:upside(from upside_down_bit 0..1)
 *        permutations: 4 朝向 × 2 正倒，几何按 upside 切换
 *   3) javaMap 指向新方块
 *
 * 旋转沿用原版 weirdo_direction 映射：0→180°, 1→0°, 2→270°, 3→90°
 */
const fs = require('fs');
const path = require('path');
const ROOT = 'D:/GitHub/LitematicaBE';
const RP = path.join(ROOT, 'resources/addon/LitematicaBE_RP/models/blocks');
const BP = path.join(ROOT, 'resources/addon/LitematicaBE_BP/blocks');
const INDEX = path.join(ROOT, 'resources/data/ghost_index.json');

// ---------- 1. 倒置几何 ----------
const src = JSON.parse(fs.readFileSync(path.join(RP, 'lit_stairs.json'), 'utf8'));
const up = JSON.parse(JSON.stringify(src));
up['minecraft:geometry'][0].description.identifier = 'geometry.lit_stairs_up';
const cubes = up['minecraft:geometry'][0].bones[0].cubes;
// 正置：底 [-8,0,-8] 16×8×16 ；台阶 [0,8,-8] 8×8×16
// 倒置：底 [-8,8,-8] ；台阶 [0,0,-8]
cubes[0].origin = [-8, 8, -8];
cubes[1].origin = [0, 0, -8];
fs.writeFileSync(path.join(RP, 'lit_stairs_up.json'), JSON.stringify(up, null, 2) + '\n');
console.log('  > lit_stairs_up.json（geometry.lit_stairs_up，倒置楼梯）');

// ---------- 2. 楼梯方块 ----------
const ROT = { 0: 180, 1: 0, 2: 270, 3: 90 };
const gi = JSON.parse(fs.readFileSync(INDEX, 'utf8'));

function stairsBlock(id, tex) {
    const perms = [];
    for (const upside of [0, 1]) {
        for (const dir of [0, 1, 2, 3]) {
            perms.push({
                condition: `q.block_state('lit:upside') == ${upside} && q.block_state('lit:dir') == ${dir}`,
                components: {
                    'minecraft:geometry': upside === 0 ? 'geometry.lit_stairs' : 'geometry.lit_stairs_up',
                    'minecraft:transformation': { rotation: [0, ROT[dir], 0], scale: [1, 1, 1], translation: [0, 0, 0] },
                },
            });
        }
    }
    return {
        format_version: '1.21.70',
        'minecraft:block': {
            description: {
                identifier: id,
                menu_category: { category: 'none' },
                states: {
                    'lit:dir': { values: { min: 0, max: 3 } },
                    'lit:upside': { values: { min: 0, max: 1 } },
                },
            },
            components: {
                'minecraft:geometry': 'geometry.lit_stairs',
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
                'minecraft:transformation': { rotation: [0, 180, 0], scale: [1, 1, 1], translation: [0, 0, 0] },
            },
            permutations: perms,
        },
    };
}

let made = 0;
for (const [javaName, ghostId] of Object.entries(gi.javaMap)) {
    if (!/_stairs$/.test(javaName)) continue;
    const meta = gi.blocks[ghostId];
    const tex = meta && meta.texture;
    if (!tex) { console.log(`  ! ${javaName}: 原目标 ${ghostId} 无 texture，跳过`); continue; }
    const short = javaName.replace('minecraft:', '');
    const newId = `lit:g_${short}`;
    fs.writeFileSync(path.join(BP, `g_${short}.json`), JSON.stringify(stairsBlock(newId, tex.startsWith('ghost_') ? tex : `ghost_${tex}`), null, 2) + '\n');
    gi.blocks[newId] = {
        texture: tex,
        geometry: 'stairs',
        states: {
            'lit:dir': { type: 'int', min: 0, max: 3, default: 0, from: 'weirdo_direction' },
            'lit:upside': { type: 'int', min: 0, max: 1, default: 0, from: 'upside_down_bit' },
        },
    };
    gi.javaMap[javaName] = newId;
    made++;
}
fs.writeFileSync(INDEX, JSON.stringify(gi, null, 2) + '\n');
console.log(`  > 生成 ${made} 个楼梯 ghost 方块，javaMap 已指向 lit:g_<name>`);
