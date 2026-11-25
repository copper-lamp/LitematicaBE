/**
 * check_piston_seam.js — 伸出态「本体格 + 头格」的轴向剖面检查
 *
 * 把两个格子的 cube 按 1px 粒度铺成 32 段，检查：
 *   1. 是否有空隙（.）或重叠（同段被两个 cube 占用）
 *   2. 推板是否落在推方向的最远端
 *   3. 本体 12 + 臂 4、头格 4+8+4 是否连续铺满
 *   4. 材质是否落对：推面 = inner / plate_top，背面 = bottom / plate_back
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RP = path.join(ROOT, 'resources', 'addon', 'LitematicaBE_RP', 'models', 'blocks');
const { PISTON_FACING_VEC, PISTON_FACING_NAME } = require(path.join(ROOT, 'src', 'mappings', 'PistonFacing.js'));

const AX = ['x', 'y', 'z'];
const LIMIT = { x: [-8, 8], y: [0, 16], z: [-8, 8] };
const load = (geo) => JSON.parse(fs.readFileSync(path.join(RP, geo + '.json'), 'utf8'))['minecraft:geometry'][0].bones[0].cubes;

let problems = 0;

for (let fd = 0; fd <= 5; fd++) {
    const v = PISTON_FACING_VEC[fd];
    const ai = v[0] !== 0 ? 0 : (v[1] !== 0 ? 1 : 2);
    const sign = v[ai];
    const [lo, hi] = LIMIT[AX[ai]];
    const n = hi - lo;                       // 一格 16px

    const E = load(`lit_piston_extended_f${fd}`);
    const H = load(`lit_piston_head_f${fd}`);

    // 世界刻度：本体格 [0,16)，头格 [16,32)（沿推方向递增）
    const toSlot = (a, b, cell) => {
        const a0 = Math.min(a, b) + cell * n;
        const b0 = Math.max(a, b) + cell * n;
        return [a0 - lo, b0 - lo];
    };
    const band = new Array(32).fill('.');

    const cubes = [
        ...E.map((c) => ({ c, cell: 0, tag: 'E', geo: 'extended' })),
        ...H.map((c) => ({ c, cell: 1, tag: 'H', geo: 'head' })),
    ];
    for (const { c, cell, tag } of cubes) {
        const [a, b] = toSlot(c.origin[ai], c.origin[ai] + c.size[ai], cell);
        for (let t = a; t < b; t++) {
            const i = sign > 0 ? t : 31 - t;   // sign<0 时推方向是低端，翻转显示使「右=推方向」
            if (i < 0 || i > 31) { problems++; console.log(`  ✗ fd=${fd} 超界`); continue; }
            if (band[i] !== '.') problems++;
            band[i] = band[i] === '.' ? tag : 'X';
        }
    }

    const line = band.join('');
    const gap = (line.match(/\./g) || []).length;
    const overlap = (line.match(/X/g) || []).length;

    // 推面材质检查
    const facingFace = PISTON_FACING_NAME[fd];
    const innerFaces = Object.entries(E[0].uv).filter(([, d]) => d.material_instance === 'inner').map(([f]) => f);
    const bottomFaces = Object.entries(E[0].uv).filter(([, d]) => d.material_instance === 'bottom').map(([f]) => f);
    const plate = H.find((c) => c.size.slice().sort((a, b) => a - b).join('x') === '4x16x16');
    const ptFaces = Object.entries(plate.uv).filter(([, d]) => d.material_instance === 'plate_top').map(([f]) => f);

    const okInner = innerFaces.length === 1 && innerFaces[0] === facingFace;
    const okBottom = bottomFaces.length === 1;
    const okPlate = ptFaces.length === 1 && ptFaces[0] === facingFace;
    if (!okInner || !okBottom || !okPlate) problems++;

    console.log(`fd=${fd} (${PISTON_FACING_NAME[fd].padEnd(5)}) 轴 ${AX[ai]} ${sign > 0 ? '+' : '-'}  ` +
        `|${line.slice(0, 16)}|${line.slice(16)}|  ` +
        `空隙=${gap} 重叠=${overlap}  内腔=${innerFaces[0] || '-'} 推板=${ptFaces[0] || '-'}` +
        (gap || overlap || !okInner || !okPlate ? '  ✗' : '  ✔'));
}

console.log(problems ? `\n发现 ${problems} 处问题` : '\n全部朝向连续无重叠，推面/内腔/推板方向一致');
