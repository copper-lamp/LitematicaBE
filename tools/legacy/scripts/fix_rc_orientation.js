#!/usr/bin/env node
/**
 * fix_rc_orientation.js — 修正中继器/比较器的朝向映射与底座材质
 *
 * 1) 朝向：原 BP 的 permutation 用 dir0→180°、dir1→270°、dir2→0°、dir3→90°，
 *    实测整体反了 180°（调档位动错火把、比较器火把与前端灯互换位置）。
 *    改为 dir → dir*90（0/90/180/270），即 shape 基准朝向直接对应 lit:dir=0。
 * 2) 材质：底座 `*` / `top` 改 opaque。原来全是 blend，半透明队列排序会把
 *    火把 billboard 面片排到不透明底座之后，表现为"火把被底座盖住"。
 *    火把/灯保持 blend（需要双面）。
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

for (const f of FILES) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const block = j['minecraft:block'];
    let rotFixed = 0;
    let matFixed = 0;

    for (const p of block.permutations || []) {
        const dirMatch = p.condition.match(/lit:dir'\)\s*==\s*(\d)/);
        if (dirMatch) {
            const dir = Number(dirMatch[1]);
            const want = dir * 90;
            const t = p.components['minecraft:transformation'];
            if (t && t.rotation[1] !== want) {
                t.rotation = [0, want, 0];
                rotFixed++;
            }
        }
        const mi = p.components['minecraft:material_instances'];
        if (mi) {
            for (const key of ['*', 'top']) {
                if (mi[key] && mi[key].render_method !== 'opaque') {
                    mi[key].render_method = 'opaque';
                    matFixed++;
                }
            }
        }
    }
    // 默认组件同样处理
    const dmi = block.components['minecraft:material_instances'];
    if (dmi) {
        for (const key of ['*', 'top']) {
            if (dmi[key] && dmi[key].render_method !== 'opaque') {
                dmi[key].render_method = 'opaque';
                matFixed++;
            }
        }
    }

    fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
    console.log(`${f}: rotation ${rotFixed} 处, 材质 ${matFixed} 处`);
}
