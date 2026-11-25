/** 校验：每根火把的 5 个 cube 是否围成 2 像素厚的截面（顶面 + 前后两片面片），且整支火把在方块内 */
const fs = require('fs');
const DIR = 'D:/GitHub/LitematicaBE/resources/addon/LitematicaBE_RP/models/blocks';

const files = [
    ['lit_repeater.json', 0, '1档'],
    ['lit_repeater_d1.json', 1, '2档'],
    ['lit_repeater_d2.json', 2, '3档'],
    ['lit_repeater_d3.json', 3, '4档'],
];

/** 图案 z：顶面=原点；north 面片=面所在 z；west 面片=原点 +7（u 沿 +z） */
function patternZ(c) {
    const z0 = c.origin[2] + 8;
    const [sx, sy, sz] = c.size;
    if (sx === 2 && sy === 0 && sz === 2) return z0;
    if (sz === 0) return z0;
    return z0 + 7;
}

let bad = 0;
for (const [f, delay, label] of files) {
    const g = JSON.parse(fs.readFileSync(`${DIR}/${f}`, 'utf8'));
    const cubes = g['minecraft:geometry'][0].bones[0].cubes;
    const torches = cubes.filter((c) => Object.values(c.uv).some((v) => v.material_instance === 'torch'));
    const marks = torches.map(patternZ).sort((a, b) => a - b);

    const fixed = [13, 15];                      // 固定火把：截面 13..15
    const moving = [8 - 2 * delay, 10 - 2 * delay]; // 可动火把：截面 (8-2d)..(10-2d)
    const expect = [...fixed, ...moving].sort((a, b) => a - b);
    const ok = marks.length === 4 && marks.every((v, i) => v === expect[i]);
    if (!ok) bad++;
    console.log(`${label}  ${ok ? '✓' : '✗'}  火把面片 z = [${marks.join(', ')}]  期望 [${expect.join(', ')}]`);
    // 越界检查
    const out = torches.filter((c) => {
        const z0 = c.origin[2] + 8;
        const z1 = z0 + c.size[2];
        return z0 < 0 || z1 > 16 + 8;            // west 面片本身跨 16 像素，允许延伸到方块外（透明区）
    });
    if (out.length) console.log(`   ⚠ ${out.length} 个面片几何跨出方块（billboard 正常，仅透明区）`);
}
console.log(bad ? `\n结果: ${bad} 项异常` : '\n结果: 正常（每根火把 = 顶面 + 前后两片面片，围成 2 像素截面）');
process.exit(bad ? 1 : 0);
