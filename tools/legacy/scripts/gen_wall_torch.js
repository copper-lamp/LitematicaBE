#!/usr/bin/env node
/**
 * gen_wall_torch.js — 生成墙挂火把的「斜插」几何（原版 transform: x' = x + 0.4y - 8, y' = y + 3.4）。
 * JSON 几何无法表达剪切，改用等价的绕底部旋转：θ = atan(0.4) ≈ 21.8°，pivot 放在火把底部中心。
 * 只生成模型文件，不动 BP / 不部署。
 */
const fs = require('fs');
const path = require('path');

const SRC = 'C:/Users/25491/Desktop/建模对应清单/shape_models.json';
const OUT = 'resources/addon/LitematicaBE_RP/models/blocks';

const TILT = -21.8;      // 绕 z 轴，顶部向 +x 倾斜
const BASE_Y = 3.4;      // transform 的 y 平移

const sm = JSON.parse(fs.readFileSync(SRC, 'utf8'));

function roundVec(a) { return a.map((v) => Math.round(v * 10000) / 10000); }

function visibleFaces(size) {
    const [w, h, d] = size;
    if (Math.abs(w) < 1e-5) return ['west', 'east'];
    if (Math.abs(h) < 1e-5) return ['down', 'up'];
    if (Math.abs(d) < 1e-5) return ['north', 'south'];
    return ['west', 'east', 'down', 'up', 'north', 'south'];
}

function defaultUv(pos, size) {
    const [x, y, z] = pos;
    const [w, h, d] = size;
    return {
        west: { uv: [z, 16 - y - h], uv_size: [d, h] },
        east: { uv: [16 - z - d, 16 - y - h], uv_size: [d, h] },
        down: { uv: [x, 16 - z - d], uv_size: [w, d] },
        up: { uv: [x, 16 - z - d], uv_size: [w, d] },
        north: { uv: [16 - x - w, 16 - y - h], uv_size: [w, h] },
        south: { uv: [x, 16 - y - h], uv_size: [w, h] },
    };
}

function faceUv(c, face) {
    const isSide = ['west', 'east', 'north', 'south'].includes(face);
    const base = defaultUv(c.pos, c.size)[face];
    const pick = (t) => t?.[face] ?? (isSide ? t?.side : undefined) ?? t?.['*'];
    const uv = pick(c.uv) ?? base.uv;
    const uvSize = pick(c.uvSizes) ?? base.uv_size;
    return { uv: [uv[0], uv[1]], uv_size: [uvSize[0], uvSize[1]] };
}

function toGeoCube(c, material) {
    const t = c.translate || [0, 0, 0];
    const o = [c.pos[0] - 8 + t[0], c.pos[1] + t[1] + BASE_Y, c.pos[2] - 8 + t[2]];
    const s = [c.size[0], c.size[1], c.size[2]];
    const faces = visibleFaces(s);

    let cutY = 0;
    if (faces.length && faces[0] !== 'up' && faces[0] !== 'down') {
        const f0 = faceUv(c, faces[0]);
        if (f0.uv[1] < 0 && f0.uv_size[1] > 0) cutY = Math.min(-f0.uv[1], s[1]);
    }
    if (cutY > 0) s[1] -= cutY;

    const uv = {};
    for (const face of faces) {
        let { uv: uv0, uv_size: uvSize } = faceUv(c, face);
        if (cutY > 0) { uv0 = [uv0[0], uv0[1] + cutY]; uvSize = [uvSize[0], uvSize[1] - cutY]; }
        const isTorchLamp = s[0] === 2 && s[1] === 2 && s[2] === 2 && c.uv && c.uv['*'];
        if (isTorchLamp) {
            const map = { up: [7, 6], down: [7, 14], north: [7, 8], south: [7, 8], east: [7, 8], west: [7, 8] };
            uv0 = map[face]; uvSize = [2, 2];
        }
        uv[face] = { uv: roundVec(uv0), uv_size: roundVec(uvSize), material_instance: material(face) };
    }
    return {
        origin: roundVec(o),
        size: roundVec(s),
        rotation: [0, 0, TILT],
        pivot: [0, BASE_Y, 0],
        uv,
    };
}

function build(identifier, cubes, material) {
    return {
        format_version: '1.19.0',
        'minecraft:geometry': [{
            description: {
                identifier,
                texture_width: 16, texture_height: 16,
                visible_bounds_width: 1, visible_bounds_height: 1,
                visible_bounds_offset: [0, 0, 0],
            },
            bones: [{ name: 'body', pivot: [0, 0, 0], cubes: cubes.map((c) => toGeoCube(c, material)) }],
        }],
    };
}

// 普通火把：单柱
const torchCubes = sm['template_torch'].map((c) => ({ ...c }));
fs.writeFileSync(path.join(OUT, 'lit_torch_wall.json'),
    JSON.stringify(build('geometry.lit_torch_wall', torchCubes, () => '*'), null, 2) + '\n');
console.log('  > lit_torch_wall.json（普通火把墙挂斜插）');

// 红石火把：柱 + 4 面片
const rtCubes = sm['template_redstone_torch'].map((c) => ({ ...c }));
fs.writeFileSync(path.join(OUT, 'lit_redstone_torch_wall.json'),
    JSON.stringify(build('geometry.lit_redstone_torch_wall', rtCubes, () => '*'), null, 2) + '\n');
console.log('  > lit_redstone_torch_wall.json（红石火把墙挂斜插）');
