/**
 * fix_piston_axis.js — 按活塞族新映射把伸出态/头格的 cube 轴向区间钉死，消除越界。
 *
 * 规则（轴 = facing 轴，sign = 推出方向符号；x/z 格界 −8..8，y 用底部系 0..16）：
 *   extended 本体(12) : sign>0 → [min, max-4]   sign<0 → [min+4, max]
 *   extended 臂  (4)  : sign>0 → [max-4, max]   sign<0 → [min, min+4]
 *   head 推板(4)      : sign>0 → [max-4, max]   sign<0 → [min, min+4]
 *   head 杆  (8)      : [min+4, max-4]
 *   head 臂  (4)      : sign>0 → [min, min+4]   sign<0 → [max-4, max]
 *
 * 只改 origin 的轴向分量，size 与 UV / material_instance 原样保留。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RP = path.join(ROOT, 'resources', 'addon', 'LitematicaBE_RP', 'models', 'blocks');
const { PISTON_FACING_VEC } = require(path.join(ROOT, 'src', 'mappings', 'PistonFacing.js'));

const AXIS = { 0: 'x', 1: 'y', 2: 'z' };
const LIMIT = { x: [-8, 8], y: [0, 16], z: [-8, 8] };

/** sign 决定的区间 */
function span(kind, sign, lo, hi) {
    switch (kind) {
        case 'body': return sign > 0 ? [lo, hi - 4] : [lo + 4, hi];
        case 'armEnd': return sign > 0 ? [hi - 4, hi] : [lo, lo + 4];
        case 'plate': return sign > 0 ? [hi - 4, hi] : [lo, lo + 4];
        case 'rod': return [lo + 4, hi - 4];
        case 'headArm': return sign > 0 ? [lo, lo + 4] : [hi - 4, hi];
        default: throw new Error('kind ' + kind);
    }
}

/** 按 size 排序特征判断 cube 身份 */
function kindOf(size) {
    const s = size.slice().sort((a, b) => a - b).join('x');
    if (s === '12x16x16') return 'body';
    if (s === '4x6x6') return null;      // 臂：extended 用 armEnd / head 用 headArm，由调用方指定
    if (s === '4x4x8') return 'rod';
    if (s === '4x16x16') return 'plate';
    return null;
}

let changed = 0;
for (let fd = 0; fd <= 5; fd++) {
    const vec = PISTON_FACING_VEC[fd];
    const axisIdx = vec[0] !== 0 ? 0 : (vec[1] !== 0 ? 1 : 2);
    const sign = vec[axisIdx];
    const axis = AXIS[axisIdx];
    const [lo, hi] = LIMIT[axis];

    for (const [geo, armKind] of [['lit_piston_extended', 'armEnd'], ['lit_piston_head', 'headArm']]) {
        const file = path.join(RP, `${geo}_f${fd}.json`);
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        const cubes = raw['minecraft:geometry'][0].bones[0].cubes;
        for (const c of cubes) {
            const s = c.size.slice().sort((a, b) => a - b).join('x');
            const kind = s === '4x6x6' ? armKind : kindOf(c.size);
            if (!kind) continue;
            const [from, to] = span(kind, sign, lo, hi);
            const before = c.origin[axisIdx];
            c.origin[axisIdx] = from;
            // size 的轴分量必须与区间等长（4/8/12 与规则一致；不一致说明资产本身错，直接按规则改写）
            c.size[axisIdx] = to - from;
            // 非轴向两轴必须**居中**：活塞臂/杆是轴向对称的，贴在格子底部会与本体中线错位
            for (let k = 0; k < 3; k++) {
                if (k === axisIdx) continue;
                const [klo, khi] = LIMIT[AXIS[k]];
                c.origin[k] = (klo + khi - c.size[k]) / 2;
            }
            if (before !== from) {
                changed++;
                console.log(`${geo}_f${fd} (${axis} ${sign > 0 ? '+' : '-'}) ${kind}: ${axis} ${before}..${before + (to - from)} → ${from}..${to}`);
            }
        }
        fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n', 'utf8');
    }
}
console.log(`\n修正 ${changed} 个 cube 轴向区间（非轴向已居中）`);
