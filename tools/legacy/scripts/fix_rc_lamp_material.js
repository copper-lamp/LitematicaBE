#!/usr/bin/env node
/**
 * fix_rc_lamp_material.js — 比较器输出端「灯/火把」的贴图按 powered 切换（对齐原版 powered_bit 变体）
 *
 * 原版 blocks.json：comparator 的 up=comparator_up、side/down=comparator_stone_slab、
 * 火把/灯=comparator_torch=[redstone_torch_off, redstone_torch_on]，变体索引是 powered_bit。
 * 现有 BP 里 lamp 固定按 mode 取贴图（mode1 永亮），与原版不一致；此脚本改成随 lit:powered。
 */
const fs = require('fs');

const FILES = [
    'resources/addon/LitematicaBE_BP/blocks/g_comparator.json',
    'resources/addon/LitematicaBE_BP/blocks/g_powered_comparator.json',
    'resources/addon/LitematicaBE_BP/blocks/g_unpowered_comparator.json',
    'resources/addon/LitematicaBE_BP/blocks/g_repeater.json',
    'resources/addon/LitematicaBE_BP/blocks/g_powered_repeater.json',
    'resources/addon/LitematicaBE_BP/blocks/g_unpowered_repeater.json',
];

for (const f of FILES) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    let changed = 0;
    for (const p of j['minecraft:block'].permutations || []) {
        const mi = p.components['minecraft:material_instances'];
        if (!mi || !mi.lamp) continue;
        const powered = /lit:powered'\)\s*==\s*1/.test(p.condition);
        const want = powered ? 'ghost_rtorch_on' : 'ghost_rtorch_off';
        if (mi.lamp.texture !== want) {
            mi.lamp.texture = want;
            changed++;
        }
    }
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
    console.log(`${f}: lamp 材质更新 ${changed} 处`);
}
