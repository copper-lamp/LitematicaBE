/**
 * probe_alpha_real.js — 用真正的 PNG 解码看 ghost 贴图的 alpha（反滤波后）
 */
const fs = require('fs');
const path = require('path');
const { decode, encode, alphaStats, modulateAlpha } = require('../tools/lib/png');

const ROOT = path.resolve(__dirname, '..');
const dir = path.join(ROOT, 'work', 'mcpack_extract', 'textures', 'blocks');

const files = ['stone.png', 'cobblestone.png', 'oak_planks.png', 'white_wool.png', 'glass.png', 'grass_block_top.png'];
for (const f of files) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) { console.log(`${f}: 缺文件`); continue; }
    const img = decode(fs.readFileSync(p));
    const s = alphaStats(img);
    // 往返一致性
    const rt = decode(encode(img));
    const same = Buffer.compare(rt.data, img.data) === 0;
    const mod = modulateAlpha(img, 0.42);
    const ms = alphaStats(mod);
    console.log(`${f.padEnd(20)} ${img.width}x${img.height} alpha均值=${s.mean.toFixed(1)} 全透明=${s.clear}/${s.total} 往返一致=${same} | 调制后均值=${ms.mean.toFixed(1)}`);
}
