#!/usr/bin/env node
/**
 * gen_rc_ghost.js — 按「建模对应清单」原版几何，完整复制红石中继器 / 红石比较器的 ghost 模型
 *
 * 数据源（原版 shape 数据，勿手改）：
 *   C:\Users\25491\Desktop\建模对应清单\shape_models.json
 * 生成：
 *   resources/addon/LitematicaBE_RP/models/blocks/lit_repeater*.json
 *   resources/addon/LitematicaBE_RP/models/blocks/lit_comparator*.json
 *
 * 转换规则严格对齐原版渲染（Holoprint BlockGeoMaker 的语义）：
 *   1. 几何原点 = pos - [8,0,8] + translate（X/Z 转方块中心坐标，Y 不变）
 *   2. 面的 UV 缺省时用「投影法」：把 cube 投影到整面后裁出该块
 *        north [x, 16-y-h] / south [16-x-w, 16-y-h] / west [z, 16-y-h] / east [16-z-d, 16-y-h]
 *        up [16-x-w, z] / down [16-x-w, 16-z-d]
 *      显式 uv / uvSizes 覆盖投影值。UV 起点一律用 translate 合并前的 pos。
 *   3. 零厚度 cube 只保留一个面（原版双面渲染）：w=0→west、h=0→down、d=0→north
 *   4. UV 越出贴图（v<0，火把 billboard 伸出方块顶部）时按像素等价裁剪几何与 UV
 *   5. 材质：底座 up→top，其余面→*；火把→torch；比较器输出端→lamp
 */
const fs = require('fs');
const path = require('path');

const SRC = 'C:/Users/25491/Desktop/建模对应清单/shape_models.json';
const OUT = 'resources/addon/LitematicaBE_RP/models/blocks';

const FACES = ['west', 'east', 'down', 'up', 'north', 'south'];
const EPS = 1e-5;

function readJson(p) {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function roundVec(a) {
    return a.map((v) => Math.round(v * 10000) / 10000);
}

/** 原版缺省 UV（投影法，用 translate 合并前的 pos）
 *  按 Bedrock/Java 方块模型的每面 UV 约定（与 Holoprint 内部坐标系不同，勿照抄）：
 *    north u 沿 -x / south u 沿 +x / west u 沿 +z / east u 沿 -z / up·down v 沿 -z
 */
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

/** 取某面的 uv / uv_size：显式 uv（面名 > side > *）覆盖缺省 */
function faceUv(cube, face) {
    const isSide = ['west', 'east', 'north', 'south'].includes(face);
    const base = defaultUv(cube.pos, cube.size)[face];
    const pick = (table) => table?.[face] ?? (isSide ? table?.side : undefined) ?? table?.['*'];
    const uv = pick(cube.uv) ?? base.uv;
    const uvSize = pick(cube.uvSizes) ?? base.uv_size;
    return { uv: [uv[0], uv[1]], uv_size: [uvSize[0], uvSize[1]] };
}

/** 零厚度 cube 需要成对保留正反两面（Bedrock 的 blend 材质会剔除背面，
 *  只留一面时从另一侧看火把会消失，表现为"只有两个侧边贴图"）。
 *  原版靠 DisableCulling 双面渲染，JSON 模型没有该开关，只能正反各画一片。 */
function visibleFaces(size) {
    const [w, h, d] = size;
    if (Math.abs(w) < EPS) return ['west', 'east'];
    if (Math.abs(h) < EPS) return ['down', 'up'];
    if (Math.abs(d) < EPS) return ['north', 'south'];
    return FACES.slice();
}

/**
 * 生成一个 JSON 几何 cube。
 * @param {object} c 原版 cube（pos/size/translate/uv/uvSizes/terrainTexture/if）
 * @param {string} kind 'repeater' | 'comparator'
 */
function toGeoCube(c, kind) {
    const t = c.translate || [0, 0, 0];
    const o = [c.pos[0] - 8 + t[0], c.pos[1] + t[1], c.pos[2] - 8 + t[2]];
    const s = [c.size[0], c.size[1], c.size[2]];

    const isBase = !c.terrainTexture;
    const material = isBase ? null : (kind === 'comparator' && !!c.if ? 'lamp' : 'torch');

    const uv = {};
    const faces = visibleFaces(s);

    // 统一裁剪：billboard 面片的 UV 起点 v 可能为负（伸出方块顶部）。
    // 裁剪量对所有面相同（north/south 与 west/east 的 v 起点都是 16-y-h），
    // 必须在这里一次性缩短几何高度，否则 16 像素高的面片配 11 像素 UV → 火把被拉长。
    let cutY = 0;
    if (faces.length && faces[0] !== 'up' && faces[0] !== 'down') {
        const f0 = faceUv(c, faces[0]);
        if (f0.uv[1] < 0 && f0.uv_size[1] > 0) cutY = Math.min(-f0.uv[1], s[1]);
    }
    if (cutY > 0) s[1] -= cutY;

    for (const face of faces) {
        let { uv: uv0, uv_size: uvSize } = faceUv(c, face);

        if (cutY > 0) {
            uv0 = [uv0[0], uv0[1] + cutY];
            uvSize = [uvSize[0], uvSize[1] - cutY];
        }

        // 2×2×2 的火把灯块：数据里只给了 "*":[7,6]（火焰），六面同 UV 会让侧面也是红色、
        // 看起来没有木柄。按原版火把的取样改成分面：顶面火焰、侧面木柄、底面木柄底。
        const isTorchLamp = s[0] === 2 && s[1] === 2 && s[2] === 2 && !isBase && c.uv && c.uv['*'];
        if (isTorchLamp) {
            const map = { up: [7, 6], down: [7, 14], north: [7, 8], south: [7, 8], east: [7, 8], west: [7, 8] };
            uv0 = map[face];
            uvSize = [2, 2];
        }

        if (uv0[0] < 0 || uv0[0] + uvSize[0] > 16 || uv0[1] + uvSize[1] > 16) {
            console.warn(`  ! u/v 越界未裁剪: ${kind} pos=${JSON.stringify(c.pos)} size=${JSON.stringify(c.size)} face=${face} uv=${JSON.stringify(uv0)} uv_size=${JSON.stringify(uvSize)}`);
        }

        const inst = material || (face === 'up' ? 'top' : '*');
        uv[face] = { uv: roundVec(uv0), uv_size: roundVec(uvSize), material_instance: inst };
    }

    return { origin: roundVec(o), size: roundVec(s), uv };
}

function buildGeometry(identifier, cubes, kind) {
    return {
        format_version: '1.19.0',
        'minecraft:geometry': [
            {
                description: {
                    identifier,
                    texture_width: 16,
                    texture_height: 16,
                    visible_bounds_width: 1,
                    visible_bounds_height: 1,
                    visible_bounds_offset: [0, 0, 0],
                },
                bones: [
                    {
                        name: 'body',
                        pivot: [0, 0, 0],
                        cubes: cubes.map((c) => toGeoCube(c, kind)),
                    },
                ],
            },
        ],
    };
}

/**
 * 比较器：把「输出端（红石灯 / 减法模式输出火把）」与「两根输入火把」的位置镜像对调。
 *
 * 原数据：输出端占 z 2–4，两枚输入火把占 z 11–13；镜像后输出端在 z 12–14、输入火把在 z 3–5。
 * 与中继器相同的位移规则：
 *   实体块（灯 2×2×2）与火把顶面（2×0×2）  → 直接落到 targetZ
 *   billboard 面片（16×16×0 / 0×16×16）    → translate.z = targetZ − 7
 * 判定输出/输入按 cube 的原 z（<8 为输出端）。
 */
function remapComparator(cubes) {
    return cubes.map((c) => {
        if (!c.terrainTexture) return c;                       // 底座
        const [sx, sy, sz] = c.size;
        const isBillboard = (sz === 0 || sx === 0) && sy > 0;
        const isWestEast = sx === 0 && sy > 0;                 // west/east 面片：图案在起点 +7
        const tz0 = c.translate ? c.translate[2] : 0;
        // 用「图案当前 z」判断属于输出端还是输入端（不能用 cube 原 translate，
        // 输入火把的面片 translate.z 只有 4，会被误判成输出端）
        const curPatternZ = c.pos[2] + tz0 + (isWestEast ? 7 : 0);
        const targetZ = curPatternZ < 8 ? 12 : 3;
        const z = isBillboard ? targetZ - 7 : targetZ;
        const out = { ...c };
        if (c.translate) {
            out.translate = c.translate.slice();
            out.translate[2] = z;
        } else {
            out.pos = c.pos.slice();
            out.pos[2] = z;
        }
        return out;
    });
}

/**
 * 中继器两根火把的前后位置（按实机确认的坐标，z 为方块南向坐标 0..16）：
 *   - 输出端火把：**固定不动**，截面占 z 13–14
 *   - 输入端火把：随档位移动，1–4 档依次占 z 8-9 / 6-7 / 4-5 / 2-3
 *
 * translate 是相对位移，且模板里三类 cube 的基准不同：
 *   顶面   size[2,0,2]  pos.z=0  → 几何起点 = 图案位置            ⇒ translate.z = targetZ
 *   面片   size[16,16,0] pos.z=7 / size[0,16,16] pos.z=0
 *          north 面片的 z 就是面所在位置；west 面片 u 沿 +z，图案在
 *          「几何起点 + 7」处（uv 起点由 pos.z 推出）              ⇒ translate.z = targetZ - 7
 * 用错其中任一分支，都会让火把散架或整支飞出方块。
 */
function remapRepeaterTorches(cubes, delay) {
    return cubes.map((c) => {
        if (!c.translate || !c.terrainTexture) return c;          // 底座
        const targetZ = c.if ? 8 - 2 * delay : 13;
        const isTopFace = c.size[0] === 2 && c.size[1] === 0 && c.size[2] === 2;
        const t = c.translate.slice();
        t[2] = isTopFace ? targetZ : targetZ - 7;
        return { ...c, translate: t };
    });
}

function main() {
    const sm = readJson(SRC);
    const rep = sm['repeater'];
    const cmp = sm['comparator'];
    if (!rep || !cmp) throw new Error('shape_models 缺 repeater/comparator');

    const pickRep = (delay) => remapRepeaterTorches(
        rep.filter((c) => !c.if || c.if === `repeater_delay == ${delay}`),
        delay,
    );
    const pickCmp = (mode) => remapComparator(
        cmp.filter((c) => !c.if || c.if === `output_subtract_bit == ${mode}`),
    );

    const outputs = [];
    for (let d = 0; d < 4; d++) {
        const cubes = pickRep(d);
        const suffix = d === 0 ? '' : `_d${d}`;
        outputs.push([`lit_repeater${suffix}.json`, `geometry.lit_repeater${suffix}`, cubes, 'repeater']);
        outputs.push([`lit_repeater${suffix}_on.json`, `geometry.lit_repeater${suffix}_on`, cubes, 'repeater']);
    }
    outputs.push(['lit_comparator.json', 'geometry.lit_comparator', pickCmp(0), 'comparator']);
    outputs.push(['lit_comparator_on.json', 'geometry.lit_comparator_on', pickCmp(0), 'comparator']);
    outputs.push(['lit_comparator_sub.json', 'geometry.lit_comparator_sub', pickCmp(1), 'comparator']);
    outputs.push(['lit_comparator_sub_on.json', 'geometry.lit_comparator_sub_on', pickCmp(1), 'comparator']);

    for (const [file, ident, cubes, kind] of outputs) {
        const geo = buildGeometry(ident, cubes, kind);
        fs.writeFileSync(path.join(OUT, file), JSON.stringify(geo, null, 2) + '\n');
        const n = geo['minecraft:geometry'][0].bones[0].cubes.length;
        console.log(`  > ${file}  (${ident}, ${n} cubes)`);
    }
    console.log(`完成：${outputs.length} 个几何`);
}

main();
