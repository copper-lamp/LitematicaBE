#!/usr/bin/env node
/** 对用户提供的活塞贴图应用 GHOST_ALPHA_FACTOR=0.80 调制（alpha×0.80，保留 alpha=0），写入 ghost 目录。 */
const fs = require('fs');
const path = require('path');
const png = require(path.resolve(__dirname, '..', 'tools/lib/png.js'));

const SRC = 'C:/Users/25491/Desktop/新建文件夹';
const DST = path.resolve(__dirname, '..', 'resources/addon/LitematicaBE_RP/textures/blocks/ghost');
const FACTOR = 0.80;

const MAP = {
  'piston_side.png': 'ghost_piston_side.png',
  'piston_side_spec.png': 'ghost_piston_side_spec.png',
  'piston_inner.png': 'ghost_piston_inner.png',
  'piston_bottom.png': 'ghost_piston_bottom.png',
  'piston_top_normal.png': 'ghost_piston_top_normal.png',
  'piston_top_side.png': 'ghost_piston_top_side.png',
  'piston_top_sticky.png': 'ghost_piston_top_sticky.png',
};

for (const [src, dst] of Object.entries(MAP)) {
  const img = png.decode(fs.readFileSync(path.join(SRC, src)));
  const out = png.modulateAlpha(img, FACTOR);
  fs.writeFileSync(path.join(DST, dst), png.encode(out));
  console.log(`  ${src} -> ${dst}  alpha均值 ${png.alphaStats(out).mean.toFixed(0)}`);
}
console.log('完成');
