/**
 * apply_piston_calib.js — 按实机校准结果（2026-11-11）重写收缩态 6 个 geometry 的面材质。
 *
 * 校准口径（用户实机观察）：
 *   反向 = 换相反方向的贴图（right↔left、up↔down）
 *   调换 = 交换活塞头（top_carried）与底部（bottom）的贴图
 *
 * 只有 f2..f5 有改动，f0/f1 保持原样。
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'resources', 'addon', 'LitematicaBE_RP', 'models', 'blocks');

/** 实机校准后的最终分配：face -> material_instance */
const CALIB = {
    0: { north: 'side_down', south: 'side_down', east: 'side_down', west: 'side_down', up: 'bottom', down: 'top_carried' },
    1: { north: 'side_up', south: 'side_up', east: 'side_up', west: 'side_up', up: 'top_carried', down: 'bottom' },
    2: { north: 'bottom', south: 'top_carried', east: 'side_left', west: 'side_right', up: 'side_up', down: 'side_down' },
    3: { north: 'top_carried', south: 'bottom', east: 'side_right', west: 'side_left', up: 'side_down', down: 'side_up' },
    4: { north: 'side_left', south: 'side_right', east: 'top_carried', west: 'bottom', up: 'side_left', down: 'side_left' },
    5: { north: 'side_right', south: 'side_left', east: 'bottom', west: 'top_carried', up: 'side_right', down: 'side_right' },
};

const FACES = ['north', 'south', 'east', 'west', 'up', 'down'];
let changed = 0;

for (const f of Object.keys(CALIB)) {
    const file = path.join(DIR, `lit_piston_f${f}.json`);
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const cube = json['minecraft:geometry'][0].bones[0].cubes[0];
    const diff = [];
    for (const face of FACES) {
        const want = CALIB[f][face];
        const cur = cube.uv[face] && cube.uv[face].material_instance;
        if (cur !== want) {
            diff.push(`${face}: ${cur} -> ${want}`);
            cube.uv[face].material_instance = want;
            changed++;
        }
        // 校准表只调材质，UV 一律保持正立
        cube.uv[face].uv = [0, 0];
        cube.uv[face].uv_size = [16, 16];
    }
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
    console.log(`lit_piston_f${f}.json  ` + (diff.length ? diff.join(' | ') : '无改动'));
}

module.exports = { CALIB, FACES };
console.log(`\n共改 ${changed} 处面材质`);
