#!/usr/bin/env node
/**
 * fix_comparator_lamp.js — 比较模式（lit:mode=0）的输出灯**恒为熄灭**，不随 powered 点亮。
 * 原版：比较模式的前端是一盏"红石灯"，只有信号强度指示，不会像火把那样点亮；
 * 点亮态贴图只用于减法模式的前端火把。
 */
const fs = require('fs');

const FILES = [
    'resources/addon/LitematicaBE_BP/blocks/g_comparator.json',
    'resources/addon/LitematicaBE_BP/blocks/g_powered_comparator.json',
    'resources/addon/LitematicaBE_BP/blocks/g_unpowered_comparator.json',
];

for (const f of FILES) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    let changed = 0;
    for (const p of j['minecraft:block'].permutations || []) {
        const mi = p.components['minecraft:material_instances'];
        if (!mi || !mi.lamp) continue;
        const isCompare = /lit:mode'\)\s*==\s*0/.test(p.condition);
        if (isCompare && mi.lamp.texture !== 'ghost_rtorch_off') {
            mi.lamp.texture = 'ghost_rtorch_off';
            changed++;
        }
    }
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
    console.log(`${f}: 比较模式 lamp 置为熄灭 ${changed} 处`);
}
