#!/usr/bin/env node
/** 探测未映射 slab 的贴图基名（只读） */
const fs = require('fs');
const path = require('path');

const MODEL_DIR = 'C:/Users/25491/Desktop/建模对应清单';
const GHOST_TEX = 'resources/addon/LitematicaBE_RP/textures/blocks/ghost';
const VAN = 'C:/Users/25491/Desktop/建模贴图/resource/bedrock-samples-v1.26.60.5-full/resource_pack/textures/blocks';
const IDX = 'resources/data/ghost_index.json';

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const bsm = read(`${MODEL_DIR}/block_shape_map.json`);
const idx = read(IDX);

const ghostSet = new Set(fs.readdirSync(GHOST_TEX).map((f) => f.replace(/\.png$/, '')));
const vanSet = new Set(fs.readdirSync(VAN).filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/, '')));

const exists = (n) => ghostSet.has(`ghost_${n}`) || vanSet.has(n);

const name = (process.argv[2] || '').trim();

const targets = Object.entries(bsm).filter(([, s]) => s === 'slab' || s === 'daylight_detector');
const out = [];
for (const [blk] of targets) {
    const gid = idx.javaMap[`minecraft:${blk}`];
    if (gid) continue; // 只看无映射的
    const stem = blk.replace(/_slab$/, '');
    const cands = [
        stem,
        `${stem}s`,
        `${stem}_planks`,
        `${stem}_block`,
        `${stem}_bricks`,
        stem.replace(/_brick$/, '_bricks'),
        `${stem.replace(/_brick$/, '_bricks')}`,
        `${stem}_side`,
    ];
    const hit = cands.filter((c) => c !== blk && exists(c));
    out.push(`${blk}\tstem=${stem}\thit=${[...new Set(hit)].join('|') || '—'}\tvan_has_stem=${vanSet.has(stem) ? 'Y' : 'N'}`);
}
console.log(out.join('\n'));
console.log('\n未映射数量: ' + out.length);
