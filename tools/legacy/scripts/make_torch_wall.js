#!/usr/bin/env node
/**
 * make_torch_wall.js — 以现成的 lit_torch.json 为母本，叠加原版墙挂火把的斜插变换。
 *
 * 母本：resources/.../models/blocks/lit_torch.json（geometry.lit_torch：2×10×2 柱 + 2 片面片）
 * 参考：C:\Users\25491\Desktop\建模对应清单 里墙挂火把的 transform
 *       x' = x + 0.4·y − 8 , y' = y + 3.4
 *       → 等价为「绕火把底部倾斜 atan(0.4) ≈ 21.8°」，并把底部抬到 y = 3.4
 * 做法：整份 cubes 原样拷贝，只补 rotation / pivot 并整体 +y，不改任何 cube 的尺寸与 UV。
 */
const fs = require('fs');
const path = require('path');

const DIR = 'resources/addon/LitematicaBE_RP/models/blocks';
const SRC = path.join(DIR, 'lit_torch.json');
const OUT = path.join(DIR, 'lit_torch_wall.json');

const TILT = -21.8;   // 绕 z 轴，顶部向 +x 倾斜（朝东为基准）
const BASE_Y = 3.4;   // transform 的 y 平移

const g = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const geo = g['minecraft:geometry'][0];
geo.description.identifier = 'geometry.lit_torch_wall';

let n = 0;
for (const cube of geo.bones[0].cubes) {
    cube.origin = [cube.origin[0], round(cube.origin[1] + BASE_Y), cube.origin[2]];
    cube.rotation = [0, 0, TILT];
    cube.pivot = [0, BASE_Y, 0];
    n++;
}

fs.writeFileSync(OUT, JSON.stringify(g, null, 2) + '\n');
console.log(`  > ${OUT}（${n} 个 cube，母本 lit_torch.json + 倾斜 ${TILT}°）`);

function round(v) { return Math.round(v * 10000) / 10000; }
