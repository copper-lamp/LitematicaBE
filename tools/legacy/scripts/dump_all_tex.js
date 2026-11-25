/** 逐张贴图打印字符图，判断哪些图案其实是「活塞头板」 */
const fs = require('fs');
const path = require('path');
const png = require(path.join(__dirname, '..', 'tools', 'lib', 'png.js'));
const SYM = '.#@%&*+=-~^:;<>abcde';
const RP = path.join(__dirname, '..', 'resources', 'addon', 'LitematicaBE_RP');

function grid(img, label, x0 = 0, y0 = 0, w = 16, h = 16) {
    const colors = new Map();
    const rows = [];
    for (let y = 0; y < h; y++) {
        let row = '';
        for (let x = 0; x < w; x++) {
            const i = ((y0 + y) * img.width + (x0 + x)) * 4;
            if (img.data[i + 3] === 0) { row += ' '; continue; }
            const key = `${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`;
            if (!colors.has(key)) colors.set(key, SYM[colors.size % SYM.length]);
            row += colors.get(key);
        }
        rows.push(row);
    }
    console.log(`\n=== ${label} (${w}×${h}) ===`);
    rows.forEach((r, i) => console.log(String(i).padStart(2, '0') + '|' + r + '|'));
}

const g = (n) => png.decode(fs.readFileSync(path.join(RP, 'textures', 'blocks', 'ghost', `${n}.png`)));
for (const n of ['ghost_piston_side', 'ghost_piston_bottom', 'ghost_piston_top', 'ghost_piston_top_normal',
    'ghost_piston_top_sticky', 'ghost_piston_arm_stub', 'ghost_piston_arm_stub2', 'ghost_piston_arm_end',
    'ghost_piston_arm_rod', 'ghost_piston_plate_side', 'ghost_piston_plate_top', 'ghost_piston_plate_back']) {
    const img = g(n);
    const w = n.includes('arm_stub') ? 6 : n.includes('arm_end') ? 6 : n.includes('arm_rod') ? 4 : 16;
    const h = n.includes('arm_stub') ? 4 : n.includes('arm_end') ? 6 : n.includes('arm_rod') ? 8
        : n.includes('plate_side') ? 4 : 16;
    grid(img, n, 0, 0, w, h);
}
