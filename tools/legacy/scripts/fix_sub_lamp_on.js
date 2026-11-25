#!/usr/bin/env node
/**
 * 减法模式（lit:mode=1）的输出灯恒为点亮态，与是否激活无关。
 * 比较模式（lit:mode=0）仍恒为熄灭态。
 */
const fs = require('fs');
const FILES = [
    'resources/addon/LitematicaBE_BP/blocks/g_comparator.json',
    'resources/addon/LitematicaBE_BP/blocks/g_powered_comparator.json',
    'resources/addon/LitematicaBE_BP/blocks/g_unpowered_comparator.json',
];
for (const f of FILES) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    let n = 0;
    for (const p of j['minecraft:block'].permutations || []) {
        const mi = p.components['minecraft:material_instances'];
        if (!mi || !mi.lamp) continue;
        const isSubtract = /lit:mode'\)\s*==\s*1/.test(p.condition);
        if (isSubtract && mi.lamp.texture !== 'ghost_rtorch_on') {
            mi.lamp.texture = 'ghost_rtorch_on';
            n++;
        }
    }
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
    console.log(`${f}: 减法模式 lamp 置为点亮 ${n} 处`);
}
