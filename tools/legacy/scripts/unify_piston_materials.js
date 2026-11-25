/**
 * unify_piston_materials.js — 以 f0/f1（上下方向）为基准，统一 6 个伸出态 + 6 个头格的面材质。
 *
 * 规则（唯一，可断言）：
 *   1) 端面 = 法向沿「推出轴」的那两个面
 *        body  → +sign 面 = inner，−sign 面 = bottom
 *        stub  → arm_end
 *        plate → +sign 面 = plate_top，−sign 面 = plate_back
 *   2) 侧面 = 其余所有面，按「该面的宽高」选 length / cross：
 *        面尺寸等于 length 贴图尺寸 → length
 *        面尺寸等于 cross  贴图尺寸 → cross
 *        正方形 / 都不匹配            → length（f0 的 4×4 端面即如此）
 *      UV 一律 [0,0] + 面尺寸（正立，不用负 uv_size）。
 *
 * 这样每个面的材质都能由「轴 + 面尺寸」推出，不再依赖手抄。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RP = path.join(ROOT, 'resources', 'addon', 'LitematicaBE_RP', 'models', 'blocks');
const { PISTON_FACING_VEC } = require(path.join(ROOT, 'src', 'mappings', 'PistonFacing.js'));

const FACES = ['north', 'south', 'east', 'west', 'up', 'down'];

/** 面的法向轴（0=x 1=y 2=z） */
const NORMAL_AXIS = { north: 2, south: 2, east: 0, west: 0, up: 1, down: 1 };
/** 面在 +sign 侧还是 −sign 侧 */
const POS_SIDE = { south: true, north: false, east: true, west: false, up: true, down: false };

/** 该面的 (宽, 高) —— 与几何的面尺寸定义一致 */
function faceSize(size, face) {
    const [sx, sy, sz] = size;
    if (face === 'north' || face === 'south') return [sx, sy];
    if (face === 'east' || face === 'west') return [sz, sy];
    return [sx, sz];
}

/** length / cross 各自的贴图尺寸 */
const TEX_SIZE = {
    stub: { length: [6, 4], cross: [4, 6] },
    rod: { length: [4, 8], cross: [8, 4] },
    plate: { length: [16, 4], cross: [4, 16] },
    body: { length: [16, 12], cross: [12, 16] },
};

const PREFIX = { stub: 'arm_stub', rod: 'arm_rod', plate: 'plate_side', body: 'side_spec' };

/** 侧面贴图：按尺寸匹配，正方形 / 不匹配时回落 length */
function sideMat(kind, w, h) {
    const t = TEX_SIZE[kind];
    if (w === t.length[0] && h === t.length[1]) return `${PREFIX[kind]}_length`;
    if (w === t.cross[0] && h === t.cross[1]) return `${PREFIX[kind]}_cross`;
    // 正方形：两向都试一次转置（长度优先）
    if (w === t.length[1] && h === t.length[0]) return `${PREFIX[kind]}_length`;
    if (w === t.cross[1] && h === t.cross[0]) return `${PREFIX[kind]}_cross`;
    return `${PREFIX[kind]}_length`;
}

/** size 排序后判断 cube 身份 */
function kindOf(size) {
    const s = size.slice().sort((a, b) => a - b).join('x');
    if (s === '12x16x16' || s === '16x16x12' || s === '16x12x16') return 'body';
    if (s === '4x6x6') return 'stub';
    if (s === '4x4x8') return 'rod';
    if (s === '4x16x16') return 'plate';
    return null;
}

let changed = 0;
for (let fd = 0; fd <= 5; fd++) {
    const vec = PISTON_FACING_VEC[fd];
    const axisIdx = vec[0] !== 0 ? 0 : (vec[1] !== 0 ? 1 : 2);
    const sign = vec[axisIdx];

    for (const geo of ['lit_piston_extended', 'lit_piston_head']) {
        const file = path.join(RP, `${geo}_f${fd}.json`);
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        const cubes = raw['minecraft:geometry'][0].bones[0].cubes;

        for (const c of cubes) {
            const kind = kindOf(c.size);
            if (!kind) continue;
            for (const face of FACES) {
                if (!c.uv[face]) continue;
                const isEnd = NORMAL_AXIS[face] === axisIdx;
                const positive = POS_SIDE[face];
                let mat;
                if (isEnd) {
                    // 推面在「推出方向」那一侧：sign>0 → +side 面，sign<0 → −side 面
                    const wantsPush = positive === (sign > 0);
                    if (kind === 'body') mat = wantsPush ? 'inner' : 'bottom';
                    else if (kind === 'stub') mat = 'arm_end';
                    else if (kind === 'plate') mat = wantsPush ? 'plate_top' : 'plate_back';
                    else mat = sideMat('rod', ...faceSize(c.size, face)); // rod 的端面无专图
                } else {
                    mat = sideMat(kind, ...faceSize(c.size, face));
                }
                const [w, h] = faceSize(c.size, face);
                const want = { uv: [0, 0], uv_size: [w, h], material_instance: mat };
                if (c.uv[face].material_instance !== mat) {
                    changed++;
                    console.log(`${geo}_f${fd} ${kind} ${face}: ${c.uv[face].material_instance} → ${mat}`);
                }
                c.uv[face].uv = want.uv;
                c.uv[face].uv_size = want.uv_size;
                c.uv[face].material_instance = want.material_instance;
            }
        }
        fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n', 'utf8');
    }
}
console.log(`\n统一完成，改动 ${changed} 个面`);
