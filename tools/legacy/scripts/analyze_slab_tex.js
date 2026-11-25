#!/usr/bin/env node
/** 分析 slab / daylight_detector 类方块的贴图现状与候选（只读，不改文件） */
const fs = require('fs');
const path = require('path');

const MODEL_DIR = 'C:/Users/25491/Desktop/建模对应清单';
const GHOST_TEX = 'resources/addon/LitematicaBE_RP/textures/blocks/ghost';
const VANILLA_BLOCKS = 'C:/Users/25491/Desktop/建模贴图/resource/bedrock-samples-v1.26.60.5-full/resource_pack/textures/blocks';
const IDX = 'resources/data/ghost_index.json';

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const bsm = read(`${MODEL_DIR}/block_shape_map.json`);
const idx = read(IDX);

const has = (dir, name) => fs.existsSync(path.join(dir, `${name}.png`));
const hasGhost = (n) => has(GHOST_TEX, `ghost_${n}`);
const hasVanilla = (n) => has(VANILLA_BLOCKS, n);

function baseOf(tex) {
    return tex.replace(/_(side|top|bottom)$/, '');
}

function resolveSet(tex) {
    const base = baseOf(tex);
    const side = hasGhost(tex) ? tex : (hasGhost(`${base}_side`) ? `${base}_side` : (hasVanilla(tex) ? tex : (hasVanilla(`${base}_side`) ? `${base}_side` : null)));
    const topCand = [`${base}_top`, tex, `${base}_side`];
    const botCand = [`${base}_bottom`, `${base}_top`, tex, `${base}_side`];
    const pick = (cands) => cands.find((c) => hasGhost(c) || hasVanilla(c)) || null;
    return { base, side, top: pick(topCand), bottom: pick(botCand) };
}

const targets = [];
for (const [name, shape] of Object.entries(bsm)) {
    if (shape !== 'slab' && shape !== 'daylight_detector') continue;
    const gid = idx.javaMap[`minecraft:${name}`];
    const meta = gid ? idx.blocks[gid] : null;
    targets.push({ name, shape, gid, tex: meta ? meta.texture : null });
}

let missingGid = 0;
const rows = [];
for (const t of targets) {
    if (!t.gid) { missingGid++; continue; }
    const set = resolveSet(t.tex);
    const flags = [];
    if (!set.side) flags.push('NO_SIDE');
    if (!set.top) flags.push('NO_TOP');
    if (!set.bottom) flags.push('NO_BOTTOM');
    const role = (n) => (n ? (hasGhost(n) ? 'G' : 'V') : '-');
    rows.push(`${t.name}\t${t.shape}\t${t.tex}\t${set.side}[${role(set.side)}]\t${set.top}[${role(set.top)}]\t${set.bottom}[${role(set.bottom)}]\t${flags.join(',')}`);
}

console.log(`targets=${targets.length} 无映射=${missingGid}`);
console.log('name\tshape\ttex\tside\ttop\tbottom\tflags');
console.log(rows.join('\n'));

// 汇总缺哪些原版 png
const needVanilla = new Set();
for (const t of targets) {
    if (!t.gid) continue;
    const s = resolveSet(t.tex);
    for (const n of [s.side, s.top, s.bottom]) if (n && !hasGhost(n) && hasVanilla(n)) needVanilla.add(n);
}
console.log('\n需从原版拷入 ghost 的贴图: ' + needVanilla.size);
console.log([...needVanilla].sort().join('\n'));
