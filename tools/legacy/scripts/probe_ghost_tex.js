/**
 * probe_ghost_tex.js — 抽查构建产物里的 ghost 贴图：alpha 与像素是否合理
 */
const fs = require('fs');
const path = require('path');
const png = require('../tools/lib/png');

const ROOT = path.resolve(__dirname, '..');
const dir = path.join(ROOT, 'addon', 'RP', 'textures', 'blocks', 'ghost');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.png'));
console.log(`ghost 贴图总数: ${files.length}`);

let worst = null;
for (const f of files) {
    const img = png.decode(fs.readFileSync(path.join(dir, f)));
    const s = png.alphaStats(img);
    if (!worst || s.mean > worst.mean) worst = { f, mean: s.mean };
}
console.log(`alpha 均值最高的: ${worst.f} = ${worst.mean.toFixed(1)}（阈值 < 245；系数 0.42→107，0.80→204）`);

for (const f of ['ghost_stone.png', 'ghost_glass.png', 'ghost_generic.png', 'ghost_oak_planks.png']) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) { console.log(`${f}: 缺`); continue; }
    const img = png.decode(fs.readFileSync(p));
    const s = png.alphaStats(img);
    const px = [0, 1, 2].map(i => {
        const o = i * 4;
        return `rgba(${img.data[o]},${img.data[o + 1]},${img.data[o + 2]},${img.data[o + 3]})`;
    });
    console.log(`${f.padEnd(24)} ${img.width}x${img.height} alpha均值=${s.mean.toFixed(1)} 全透明=${s.clear}/${s.total} 前3像素=${px.join(' ')}`);
}
