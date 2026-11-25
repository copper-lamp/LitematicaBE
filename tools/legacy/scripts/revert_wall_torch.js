#!/usr/bin/env node
/**
 * revert_wall_torch.js — 取消墙挂火把的斜插改动，恢复为原来的「站立火把 + lit:dir 旋转」横插表现。
 * 保留火焰（lit_fire）的修复。
 */
const fs = require('fs');
const path = require('path');
const ROOT = 'D:/GitHub/LitematicaBE';
const BP = path.join(ROOT, 'resources/addon/LitematicaBE_BP/blocks');
const RP = path.join(ROOT, 'resources/addon/LitematicaBE_RP/models/blocks');
const INDEX = path.join(ROOT, 'resources/data/ghost_index.json');

// 1) 删除新增的三个墙挂火把方块定义
for (const f of ['g_wall_torch.json', 'g_redstone_wall_torch.json', 'g_soul_wall_torch.json']) {
    const p = path.join(BP, f);
    if (fs.existsSync(p)) { fs.unlinkSync(p); console.log('  删除 BP/' + f); }
}

// 2) 删除斜插几何
for (const f of ['lit_torch_wall.json', 'lit_redstone_torch_wall.json']) {
    const p = path.join(RP, f);
    if (fs.existsSync(p)) { fs.unlinkSync(p); console.log('  删除 RP/' + f); }
}

// 3) index：映射回原方块，删掉新增条目
const gi = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
gi.javaMap['minecraft:wall_torch'] = 'lit:g_torch';
gi.javaMap['minecraft:redstone_wall_torch'] = 'lit:g_redstone_torch';
gi.javaMap['minecraft:soul_wall_torch'] = 'lit:g_soul_torch';
for (const id of ['lit:g_wall_torch', 'lit:g_redstone_wall_torch', 'lit:g_soul_wall_torch']) {
    if (gi.blocks[id]) { delete gi.blocks[id]; console.log('  删除 index.blocks ' + id); }
}
fs.writeFileSync(INDEX, JSON.stringify(gi, null, 2) + '\n');
console.log(`  > ghost_index：blocks ${Object.keys(gi.blocks).length} / javaMap ${Object.keys(gi.javaMap).length}`);
console.log('  映射: wall_torch -> ' + gi.javaMap['minecraft:wall_torch'] +
    ' | redstone_wall_torch -> ' + gi.javaMap['minecraft:redstone_wall_torch'] +
    ' | soul_wall_torch -> ' + gi.javaMap['minecraft:soul_wall_torch']);
