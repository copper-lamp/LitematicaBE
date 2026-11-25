#!/usr/bin/env node
/** 整体朝向再翻 180°：dir → (dir*90 + 180) % 360（实机确认整体反了） */
const fs = require('fs');
const FILES = [
    'resources/addon/LitematicaBE_BP/blocks/g_repeater.json',
    'resources/addon/LitematicaBE_BP/blocks/g_powered_repeater.json',
    'resources/addon/LitematicaBE_BP/blocks/g_unpowered_repeater.json',
    'resources/addon/LitematicaBE_BP/blocks/g_comparator.json',
    'resources/addon/LitematicaBE_BP/blocks/g_powered_comparator.json',
    'resources/addon/LitematicaBE_BP/blocks/g_unpowered_comparator.json',
];
for (const f of FILES) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    let n = 0;
    for (const p of j['minecraft:block'].permutations || []) {
        const m = p.condition.match(/lit:dir'\)\s*==\s*(\d)/);
        if (!m) continue;
        const dir = Number(m[1]);
        const want = (dir * 90 + 180) % 360;
        const t = p.components['minecraft:transformation'];
        if (t && t.rotation[1] !== want) { t.rotation = [0, want, 0]; n++; }
    }
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
    console.log(`${f}: rotation 更新 ${n} 处`);
}
