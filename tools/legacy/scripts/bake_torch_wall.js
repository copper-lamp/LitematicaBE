#!/usr/bin/env node
/**
 * bake_torch_wall.js — 以 lit_torch.json 为母本，把原版墙挂火把的斜插「烘焙」进几何。
 *
 * 原版 transform: x' = x + 0.4·y − 8 , y' = y + 3.4
 * → 每升高 1 像素，x 偏移 0.4 像素。
 * 柱 2×10×2 切成 10 段（每段 1 高），面片 16×16 切成 16 段（每段 1 高），逐段平移；
 * 分段量 0.4 像素，肉眼基本看不出阶梯。
 */
const fs = require('fs');
const path = require('path');

const DIR = 'resources/addon/LitematicaBE_RP/models/blocks';
const TILT = 0.4;
const BASE_Y = 3.4;
const SEG = { post: 10, plane: 16 };

const src = JSON.parse(fs.readFileSync(path.join(DIR, 'lit_torch.json'), 'utf8'));
const cubes = src['minecraft:geometry'][0].bones[0].cubes;
const round = (v) => Math.round(v * 10000) / 10000;

const out = [];
for (const c of cubes) {
    const [w, h, d] = c.size;
    const isPlane = (Math.abs(w) < 1e-5 || Math.abs(d) < 1e-5);
    const segs = isPlane ? SEG.plane : SEG.post;
    const segH = h / segs;

    for (let i = 0; i < segs; i++) {
        const y0 = i * segH;
        const dx = TILT * y0;
        const origin = [
            round(c.origin[0] + dx),
            round(c.origin[1] + BASE_Y + y0),
            round(c.origin[2]),
        ];
        const size = [w, round(segH), d];

        const uv = {};
        for (const [face, f] of Object.entries(c.uv)) {
            const fu = f.uv, fs_ = f.uv_size;
            const v0 = fu[1] + (fs_[1] * i) / segs;
            const vh = fs_[1] / segs;
            uv[face] = { uv: [fu[0], round(v0)], uv_size: [fs_[0], round(vh)] };
            if (face === 'up' && i !== segs - 1) delete uv[face];
            if (face === 'down' && i !== 0) delete uv[face];
        }
        out.push({ origin, size, uv });
    }
}

src['minecraft:geometry'][0].description.identifier = 'geometry.lit_torch_wall';
src['minecraft:geometry'][0].bones[0].cubes = out;

fs.writeFileSync(path.join(DIR, 'lit_torch_wall.json'), JSON.stringify(src, null, 2) + '\n');
console.log(`  > lit_torch_wall.json：${cubes.length} 个母本 cube → ${out.length} 个分段 cube`);
