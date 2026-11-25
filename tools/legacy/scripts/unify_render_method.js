#!/usr/bin/env node
/**
 * unify_render_method.js — 同一方块内所有 material_instances 必须使用同一种 render_method。
 * 原状态：底座 opaque + 火把 blend 混用，BDS 报
 *   "MaterialInstances can't mix and match opaque and transparent materials."
 * 统一为 alpha_test：支持透明裁切（火把贴图有 alpha）、无 blend 的排序问题、默认双面。
 */
const fs = require('fs');
const FILES = [
    'resources/addon/LitematicaBE_BP/blocks/g_repeater.json',
    'resources/addon/LitematicaBE_BP/blocks/g_powered_repeater.json',
    'resources/addon/LitematicaBE_BP/blocks/g_unpowered_repeater.json',
    'resources/addon/LitematicaBE_BP/blocks/g_comparator.json',
    'resources/addon/LitematicaBE_BP/blocks/g_powered_comparator.json',
    'resources/addon/LitematicaBE_BP/blocks/g_unpowered_comparator.json',
];
const TARGET = 'alpha_test';

for (const f of FILES) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const blk = j['minecraft:block'];
    let n = 0;
    const unify = (mi) => {
        if (!mi) return;
        for (const v of Object.values(mi)) {
            if (v.render_method !== TARGET) { v.render_method = TARGET; n++; }
        }
    };
    unify(blk.components['minecraft:material_instances']);
    for (const p of blk.permutations || []) unify(p.components['minecraft:material_instances']);
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
    console.log(`${f}: ${n} 个材质 -> ${TARGET}`);
}
