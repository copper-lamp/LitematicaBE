/**
 * apply_piston_matrix.js — 把 PISTON_SIDE_FACES（活塞收缩态真源表）写进 6 个 geometry，
 * 并补齐 12 个收缩态 BP 方块（g_piston_side_f* / g_sticky_piston_f*）的材质键。
 *
 * 单一真源：src/mappings/PistonFacing.js
 * 用法：node work/apply_piston_matrix.js [--dry]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RP = path.join(ROOT, 'resources', 'addon', 'LitematicaBE_RP');
const BP = path.join(ROOT, 'resources', 'addon', 'LitematicaBE_BP');
const { PISTON_SIDE_FACES, PISTON_FACING_NAME, SIDE_MATERIALS } = require(path.join(ROOT, 'src', 'mappings', 'PistonFacing.js'));

const FACES = ['north', 'south', 'east', 'west', 'up', 'down'];
const DRY = process.argv.includes('--dry');

const TEXTURE = {
    side_up: 'ghost_piston_side_up',
    side_down: 'ghost_piston_side_down',
    side_left: 'ghost_piston_side_left',
    side_right: 'ghost_piston_side_right',
    bottom: 'ghost_piston_bottom',
    top_carried: null,   // 普通 / 黏性各用自己的推面贴图
};

let geoChanged = 0;
let bpChanged = 0;

// ─── 1. geometry：六个收缩态 ───
for (let fd = 0; fd <= 5; fd++) {
    const file = path.join(RP, 'models', 'blocks', `lit_piston_f${fd}.json`);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const geo = raw['minecraft:geometry'][0];
    const cube = geo.bones[0].cubes[0];
    const table = PISTON_SIDE_FACES[fd];

    // 形状钉死：单 cube 满格、UV 全正立（方向一律由贴图承载，不用负 uv_size）
    cube.origin = [-8, 0, -8];
    cube.size = [16, 16, 16];
    for (const face of FACES) {
        cube.uv[face].uv = [0, 0];
        cube.uv[face].uv_size = [16, 16];
        cube.uv[face].material_instance = table[face];
    }

    const text = JSON.stringify(raw, null, 2) + '\n';
    const before = fs.readFileSync(file, 'utf8');
    if (text !== before) {
        if (!DRY) fs.writeFileSync(file, text, 'utf8');
        geoChanged++;
        console.log(`[geo] lit_piston_f${fd} (${PISTON_FACING_NAME[fd]})  ` +
            FACES.map((f) => `${f}=${table[f]}`).join(' '));
    }
}

// ─── 2. BP：补齐材质键（普通 + 黏性） ───
const blocks = [];
for (let fd = 0; fd <= 5; fd++) blocks.push([`g_piston_side_f${fd}`, 'ghost_piston_top_normal']);
for (let fd = 0; fd <= 5; fd++) blocks.push([`g_sticky_piston_f${fd}`, 'ghost_piston_top_sticky']);

for (const [name, topTex] of blocks) {
    const file = path.join(BP, 'blocks', `${name}.json`);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const comps = raw['minecraft:block'].components;
    const mi = comps['minecraft:material_instances'];

    const want = {};
    for (const key of ['bottom', 'top_carried', ...SIDE_MATERIALS]) {
        want[key] = {
            texture: key === 'top_carried' ? topTex : TEXTURE[key],
            render_method: 'blend',
            face_dimming: false,
            ambient_occlusion: false,
        };
    }
    // 保持既有键序：bottom / top_carried / side_* 顺序写回，删掉不再引用的旧键
    const rebuilt = {};
    for (const key of ['bottom', 'top_carried', 'side_down', 'side_up', 'side_left', 'side_right']) {
        if (want[key]) rebuilt[key] = want[key];
    }
    for (const key of Object.keys(mi)) {
        if (!rebuilt[key]) { /* 旧键丢弃 */ }
    }
    comps['minecraft:material_instances'] = rebuilt;

    const text = JSON.stringify(raw, null, 2) + '\n';
    const before = fs.readFileSync(file, 'utf8');
    if (text !== before) {
        if (!DRY) fs.writeFileSync(file, text, 'utf8');
        bpChanged++;
    }
}

console.log(`\n完成${DRY ? '（dry-run，未写入）' : ''}：geometry ${geoChanged} 个 / BP ${bpChanged} 个`);
