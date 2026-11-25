/**
 * work/piston_official.js — 严格按 bedrock-samples 的 piston 形状生成 6 朝向模型
 *
 * 依据：
 *   blocks.json
 *     piston/carried : up=piston_top_normal down=piston_bottom side=piston_side
 *     piston/normal  : up=piston_top        down=piston_bottom side=piston_side
 *     sticky/carried : up=piston_top_sticky
 *     sticky/normal  : up=piston_top
 *   shape_models.json / block_models.json 的 piston：
 *     State 0/3  满块 16×16×16，up 覆盖为 carried.up，且 up 面 H+V 翻转
 *     State 1/2  16×12×16 本体（不覆盖贴图）+ 6×8×6@(5,12,5) side(64,24) up/down(70,18)
 *                + 4×8×4@(6,20,6) side(64,4) + 16×4×16@(0,28,0) side(0,16) down(32,0) up(16,0) up 翻转
 *
 * 姿势基准：未旋转时活塞朝 +Y（up），跨 2 格（0..32）。
 * 6 个朝向 = 把基准姿势整体旋转：
 *   down Rx180 / up 不变 / north Rx-90 / south Rx90 / west Rz90 / east Rz-90
 * 每个 cube 的面法线与面内 UV 轴一起旋转（UV 原点可落在右侧/下侧 → uv_size 取负表达翻转），
 * 这样贴图上的像素跟着世界位置走，等价于原版对整块几何做旋转。
 *
 * 面内 UV 轴约定（官方 schema：uv 原点是「从面外看、y 朝上时的左上角」）：
 *   up    u=+X v=+Z    down  u=+X v=-Z
 *   north u=-X v=-Y    south u=+X v=-Y
 *   west  u=+Z v=-Y    east  u=-Z v=-Y
 */
const fs = require('fs');
const path = require('path');
const png = require(path.join(__dirname, '..', 'tools', 'lib', 'png.js'));

const ROOT = path.resolve(__dirname, '..');
const SAMPLES = 'C:\\Users\\25491\\Desktop\\建模贴图\\resource\\bedrock-samples-v1.26.60.5-full\\resource_pack\\textures';
const RP = path.join(ROOT, 'resources', 'addon', 'LitematicaBE_RP');
const BP = path.join(ROOT, 'resources', 'addon', 'LitematicaBE_BP');
const INDEX_PATH = path.join(ROOT, 'resources', 'data', 'ghost_index.json');
const MODEL_DIR = path.join(RP, 'models', 'blocks');
const GHOST_TEX_DIR = path.join(RP, 'textures', 'blocks', 'ghost');
const BP_BLOCK_DIR = path.join(BP, 'blocks');
const TERRAIN = path.join(RP, 'textures', 'terrain_texture.json');

const GHOST_ALPHA_FACTOR = 0.80;
const FORMAT = '1.21.70';

// ───────── 面内 UV 轴 ─────────
const AXES = {
    up: { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    down: { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    north: { n: [0, 0, -1], u: [-1, 0, 0], v: [0, -1, 0] },
    south: { n: [0, 0, 1], u: [1, 0, 0], v: [0, -1, 0] },
    west: { n: [-1, 0, 0], u: [0, 0, 1], v: [0, -1, 0] },
    east: { n: [1, 0, 0], u: [0, 0, -1], v: [0, -1, 0] },
};
const FACE_OF_N = {
    '0,1,0': 'up', '0,-1,0': 'down', '0,0,-1': 'north',
    '0,0,1': 'south', '-1,0,0': 'west', '1,0,0': 'east',
};

// ───────── 旋转 ─────────
const R = {
    0: (p) => [p[0], -p[1], -p[2]],                                  // down  Rx180
    1: (p) => [p[0], p[1], p[2]],                                     // up
    2: (p) => [p[0], p[2], -p[1]],                                    // north Rx-90
    3: (p) => [p[0], -p[2], p[1]],                                    // south Rx+90
    4: (p) => [-p[1], p[0], p[2]],                                    // west  Rz+90
    5: (p) => [p[1], -p[0], p[2]],                                    // east  Rz-90
};
const C = [0, 8, 0]; // 旋转中心 = 方块几何中心
const rot = (f, p) => { const q = R[f]([p[0] - C[0], p[1] - C[1], p[2] - C[2]]); return [q[0] + C[0], q[1] + C[1], q[2] + C[2]]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * 把一个基准 cube 旋转到朝向 f。
 * spec: { origin, size, faces: { <face>: { uv:[u,v], size:[w,h], mat } } }
 */
function rotateCube(f, spec) {
    const [ox, oy, oz] = spec.origin;
    const [sx, sy, sz] = spec.size;
    const faces = {};

    for (const [fname, face] of Object.entries(spec.faces)) {
        const A = AXES[fname];
        // 面四角：沿 A.u / A.v 方向的 0/1 组合
        const corners = [];
        for (const db of [0, 1]) {
            for (const da of [0, 1]) {
                const p = [
                    ox + (A.n[0] > 0 ? sx : 0) + A.u[0] * da * 0 + 0, // 占位，下面用投影求
                    0, 0,
                ];
                corners.push({ da, db });
            }
        }
        // 面中心 + da*(u 边) + db*(v 边) 得到该面四角；面内坐标只需几何关系，不依赖法线方向
        const axisIdx = A.n.map(Math.abs).indexOf(1);
        const sizeArr = [sx, sy, sz];
        const originArr = [ox, oy, oz];
        const uLen = dot(A.u.map(Math.abs), sizeArr);
        const vLen = dot(A.v.map(Math.abs), sizeArr);
        const center = [ox + sx / 2, oy + sy / 2, oz + sz / 2];
        center[axisIdx] = A.n[axisIdx] > 0 ? originArr[axisIdx] + sizeArr[axisIdx] : originArr[axisIdx];
        const list = [];
        for (const da of [0, 1]) {
            for (const db of [0, 1]) {
                const p = [
                    center[0] + A.u[0] * (da - 0.5) * uLen + A.v[0] * (db - 0.5) * vLen,
                    center[1] + A.u[1] * (da - 0.5) * uLen + A.v[1] * (db - 0.5) * vLen,
                    center[2] + A.u[2] * (da - 0.5) * uLen + A.v[2] * (db - 0.5) * vLen,
                ];
                list.push({ da, db, p, uv: [face.uv[0] + da * face.size[0], face.uv[1] + db * face.size[1]] });
            }
        }
        // 旋转这些角，确定新面
        const rotList = list.map((c) => ({ ...c, p: rot(f, c.p) }));
        const nRot = R[f](A.n);
        const nName = FACE_OF_N[nRot.join(',')];
        const B = AXES[nName];
        const withAb = rotList.map((c) => ({ ...c, a: dot(c.p, B.u), b: dot(c.p, B.v) }));
        // 直接按「角」取值：a 最小 & b 最小 = uv 原点；a 最大 → u 终点；b 最大 → v 终点
        const near = (x, y, eps = 1e-4) => Math.abs(x - y) < eps;
        const aMin = Math.min(...withAb.map((c) => c.a)), aMax = Math.max(...withAb.map((c) => c.a));
        const bMin = Math.min(...withAb.map((c) => c.b)), bMax = Math.max(...withAb.map((c) => c.b));
        const pick = (a, b) => {
            const hit = withAb.find((c) => near(c.a, a) && near(c.b, b));
            if (!hit) throw new Error(`面角缺失 ${nName} a=${a} b=${b}`);
            return hit;
        };
        const c00 = pick(aMin, bMin), c10 = pick(aMax, bMin), c01 = pick(aMin, bMax);
        const u0 = c00.uv[0], v0 = c00.uv[1];
        // 旋转可能让 u/v 与原 a/b 轴交换：取变化量为真的那一组作为 u 与 v 的方向
        const duA = Math.abs(c10.uv[0] - u0), duB = Math.abs(c01.uv[0] - u0);
        const dvA = Math.abs(c10.uv[1] - v0), dvB = Math.abs(c01.uv[1] - v0);
        const uAlongB = duB > duA;
        const su = uAlongB ? c01.uv[0] - u0 : c10.uv[0] - u0;
        const sv = uAlongB ? c10.uv[1] - v0 : c01.uv[1] - v0;
        void dvA; void dvB;
        faces[nName] = { uv: [u0, v0], size: [su, sv], mat: face.mat };
    }

    // cube 本身旋转
    const pts = [];
    for (const dx of [0, sx]) for (const dy of [0, sy]) for (const dz of [0, sz]) {
        pts.push(rot(f, [ox + dx, oy + dy, oz + dz]));
    }
    const mn = [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i])));
    const mx = [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i])));
    return { origin: mn, size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]], faces };
}

// ───────── 基准 cube（活塞朝 +Y） ─────────
const RGB = (u, v, w, h, mat) => ({ uv: [u, v], size: [w, h], mat });

// 收缩态：满块，up = carried.up（H+V 翻转 → 原点 (16,16)、尺寸 -16,-16）
function retractedCubes(sticky) {
    const topMat = 'top_carried';
    return [{
        origin: [-8, 0, -8], size: [16, 16, 16],
        faces: {
            up: RGB(16, 16, -16, -16, topMat),
            down: RGB(0, 0, 16, 16, 'bottom'),
            north: RGB(0, 0, 16, 16, 'side'),
            south: RGB(0, 0, 16, 16, 'side'),
            east: RGB(0, 0, 16, 16, 'side'),
            west: RGB(0, 0, 16, 16, 'side'),
        },
    }];
}

// 伸出态本体格：只有 16×12 本体，头段全部在前方那一格，底座上方是空的
function extendedBaseCubes() {
    return [
        {
            origin: [-8, 0, -8], size: [16, 12, 16],
            faces: {
                up: RGB(0, 0, 16, 16, 'top'),
                down: RGB(0, 0, 16, 16, 'bottom'),
                north: RGB(0, 0, 16, 16, 'side'),
                south: RGB(0, 0, 16, 16, 'side'),
                east: RGB(0, 0, 16, 16, 'side'),
                west: RGB(0, 0, 16, 16, 'side'),
            },
        },
    ];
}

// 活塞头格（在前一格）：头段 + 细杆 + 头板，板在远端 28..32
function headCubes() {
    return [
        {
            origin: [-3, 0, -3], size: [6, 4, 6],
            faces: {
                up: RGB(0, 0, 6, 6, 'arm_end'),
                down: RGB(0, 0, 6, 6, 'arm_end'),
                north: RGB(0, 0, 6, 4, 'arm_stub'),
                south: RGB(0, 0, 6, 4, 'arm_stub'),
                east: RGB(0, 0, 6, 4, 'arm_stub'),
                west: RGB(0, 0, 6, 4, 'arm_stub'),
            },
        },
        {
            origin: [-2, 4, -2], size: [4, 8, 4],
            faces: {
                north: RGB(0, 0, 4, 8, 'arm_rod'),
                south: RGB(0, 0, 4, 8, 'arm_rod'),
                east: RGB(0, 0, 4, 8, 'arm_rod'),
                west: RGB(0, 0, 4, 8, 'arm_rod'),
            },
        },
        {
            origin: [-8, 12, -8], size: [16, 4, 16],
            faces: {
                up: RGB(16, 16, -16, -16, 'plate_top'),   // 原版 up 面 H+V 翻转
                down: RGB(0, 0, 16, 16, 'plate_back'),
                north: RGB(0, 0, 16, 4, 'plate_side'),
                south: RGB(0, 0, 16, 4, 'plate_side'),
                east: RGB(0, 0, 16, 4, 'plate_side'),
                west: RGB(0, 0, 16, 4, 'plate_side'),
            },
        },
    ];
}

// ───────── 输出几何 ─────────
function geoJson(id, cubes) {
    return {
        format_version: '1.19.0',
        'minecraft:geometry': [{
            description: {
                identifier: id,
                texture_width: 16,
                texture_height: 16,
                visible_bounds_width: 3,
                visible_bounds_height: 3,
                visible_bounds_offset: [0, 1, 0],
            },
            bones: [{
                name: 'body',
                pivot: [0, 0, 0],
                cubes: cubes.map((c) => {
                    const uv = {};
                    for (const [fname, f] of Object.entries(c.faces)) {
                        uv[fname] = { uv: [f.uv[0], f.uv[1]], uv_size: [f.size[0], f.size[1]], material_instance: f.mat };
                    }
                    return { origin: c.origin, size: c.size, uv };
                }),
            }],
        }],
    };
}

// ───────── 贴图 ─────────
function readImg(p) { return png.decode(fs.readFileSync(p)); }
function crop16(src, x, y, w, h) {
    const out = { width: 16, height: 16, data: Buffer.alloc(16 * 16 * 4) };
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const si = ((y + yy) * src.width + (x + xx)) * 4, di = (yy * 16 + xx) * 4;
        out.data[di] = src.data[si]; out.data[di + 1] = src.data[si + 1];
        out.data[di + 2] = src.data[si + 2]; out.data[di + 3] = src.data[si + 3];
    }
    return out;
}

function buildTextures() {
    const arm = readImg(path.join(SAMPLES, 'entity', 'pistonarm', 'pistonArm.png'));
    const blocks = (n) => readImg(path.join(SAMPLES, 'blocks', `${n}.png`));
    const flat = (img) => ({ width: 16, height: 16, data: Buffer.from(img.data) });
    const put = (name, img) => fs.writeFileSync(path.join(GHOST_TEX_DIR, `${name}.png`),
        png.encode(png.modulateAlpha(img, GHOST_ALPHA_FACTOR)));

    put('ghost_piston_side', flat(blocks('piston_side')));
    put('ghost_piston_bottom', flat(blocks('piston_bottom')));
    // blocks.json 的 textures.up 引用 piston_top，samples 未导出该文件，用项目 RP 里那张同名贴图
    put('ghost_piston_top', flat(readImg(path.join(RP, 'textures', 'blocks', 'piston_top.png'))));
    put('ghost_piston_top_normal', flat(blocks('piston_top_normal'))); // 收缩态普通
    put('ghost_piston_top_sticky', flat(blocks('piston_top_sticky'))); // 收缩态黏性
    put('ghost_piston_arm_stub', crop16(arm, 64, 24, 6, 4));
    put('ghost_piston_arm_stub2', crop16(arm, 64, 28, 6, 4));
    put('ghost_piston_arm_end', crop16(arm, 70, 18, 6, 6));
    put('ghost_piston_arm_rod', crop16(arm, 64, 4, 4, 8));
    put('ghost_piston_plate_side', crop16(arm, 0, 16, 16, 4));
    put('ghost_piston_plate_top', crop16(arm, 16, 0, 16, 16));
    put('ghost_piston_plate_back', crop16(arm, 32, 0, 16, 16));
}

// ───────── 材质 ─────────
const TEX = {
    side: 'ghost_piston_side',
    bottom: 'ghost_piston_bottom',
    top: 'ghost_piston_top',
    top_carried: 'ghost_piston_top_normal',
    top_carried_sticky: 'ghost_piston_top_sticky',
    arm_stub: 'ghost_piston_arm_stub',
    arm_stub2: 'ghost_piston_arm_stub2',
    arm_end: 'ghost_piston_arm_end',
    arm_rod: 'ghost_piston_arm_rod',
    plate_side: 'ghost_piston_plate_side',
    plate_top: 'ghost_piston_plate_top',
    plate_back: 'ghost_piston_plate_back',
};

function blockDef(identifier, geometryId, mats, override) {
    const material = {};
    for (const m of mats) {
        material[m] = { texture: (override && override[m]) || TEX[m], render_method: 'blend', face_dimming: false, ambient_occlusion: false };
    }
    return {
        format_version: FORMAT,
        'minecraft:block': {
            description: { identifier, menu_category: { category: 'none' } },
            components: {
                'minecraft:geometry': geometryId,
                'minecraft:material_instances': material,
                'minecraft:collision_box': false,
                'minecraft:selection_box': false,
                'minecraft:destructible_by_mining': false,
                'minecraft:destructible_by_explosion': false,
                'minecraft:replaceable': {},
                'minecraft:light_dampening': 0,
                'minecraft:map_color': '#888888',
            },
        },
    };
}

const MATS_RETRACTED_N = ['side', 'bottom', 'top_carried'];
const MATS_RETRACTED_S = ['side', 'bottom', 'top_carried'];
const MATS_EXTENDED = ['side', 'bottom', 'top'];
const MATS_HEAD = ['arm_stub', 'arm_end', 'arm_rod', 'plate_side', 'plate_top', 'plate_back'];

// ───────── 主流程 ─────────
function rmGlob(dir, re) {
    if (!fs.existsSync(dir)) return 0;
    let n = 0;
    for (const f of fs.readdirSync(dir)) if (re.test(f)) { fs.rmSync(path.join(dir, f), { force: true }); n++; }
    return n;
}

function main() {
    rmGlob(MODEL_DIR, /^lit_piston.*\.json$/);
    rmGlob(BP_BLOCK_DIR, /^(g_piston|g_sticky_piston).*\.json$/);
    rmGlob(GHOST_TEX_DIR, /^ghost_piston.*\.png$/);
    buildTextures();
    console.log('[tex] 12 张 16×16 分贴图');

    let nm = 0;
    for (let f = 0; f <= 5; f++) {
        const retrN = retractedCubes(false).map((c) => rotateCube(f, c));
        const retrS = retractedCubes(true).map((c) => rotateCube(f, c));
        const ext = extendedBaseCubes().map((c) => rotateCube(f, c));
        const head = headCubes().map((c) => rotateCube(f, c));
        // 收缩态普通/黏性几何完全相同，只有贴图不同 → 共用一个几何
        fs.writeFileSync(path.join(MODEL_DIR, `lit_piston_f${f}.json`), JSON.stringify(geoJson(`geometry.lit_piston_f${f}`, retrN), null, 2) + '\n');
        fs.writeFileSync(path.join(MODEL_DIR, `lit_piston_extended_f${f}.json`), JSON.stringify(geoJson(`geometry.lit_piston_extended_f${f}`, ext), null, 2) + '\n');
        fs.writeFileSync(path.join(MODEL_DIR, `lit_piston_head_f${f}.json`), JSON.stringify(geoJson(`geometry.lit_piston_head_f${f}`, head), null, 2) + '\n');
        nm += 3;
    }
    console.log(`[model] ${nm} 个几何`);

    let nb = 0;
    for (let f = 0; f <= 5; f++) {
        const w = (n, j) => fs.writeFileSync(path.join(BP_BLOCK_DIR, `${n}.json`), JSON.stringify(j, null, 2) + '\n');
        w(`g_piston_side_f${f}`, blockDef(`lit:g_piston_side_f${f}`, `geometry.lit_piston_f${f}`, MATS_RETRACTED_N));
        w(`g_sticky_piston_f${f}`, blockDef(`lit:g_sticky_piston_f${f}`, `geometry.lit_piston_f${f}`, MATS_RETRACTED_S, { top_carried: 'ghost_piston_top_sticky' }));
        w(`g_piston_side_extended_f${f}`, blockDef(`lit:g_piston_side_extended_f${f}`, `geometry.lit_piston_extended_f${f}`, MATS_EXTENDED));
        w(`g_sticky_piston_extended_f${f}`, blockDef(`lit:g_sticky_piston_extended_f${f}`, `geometry.lit_piston_extended_f${f}`, MATS_EXTENDED));
        w(`g_piston_head_f${f}`, blockDef(`lit:g_piston_head_f${f}`, `geometry.lit_piston_head_f${f}`, MATS_HEAD));
        w(`g_sticky_piston_head_f${f}`, blockDef(`lit:g_sticky_piston_head_f${f}`, `geometry.lit_piston_head_f${f}`, MATS_HEAD));
        nb += 6;
    }
    console.log(`[bp] ${nb} 个方块`);

    const tt = JSON.parse(fs.readFileSync(TERRAIN, 'utf8'));
    for (const k of Object.keys(tt.texture_data || {})) if (/^ghost_piston/.test(k)) delete tt.texture_data[k];
    for (const k of Object.keys(TEX)) {
        tt.texture_data[TEX[k]] = { textures: `textures/blocks/ghost/${TEX[k]}` };
    }
    fs.writeFileSync(TERRAIN, JSON.stringify(tt, null, 2) + '\n');
    console.log(`[terrain] ${Object.keys(TEX).length} 条`);

    const idx = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    let n = 0;
    for (const id of Object.keys(idx.blocks || {})) {
        if (!/^lit:g_(sticky_piston|piston_)/.test(id)) continue;
        idx.blocks[id].texture = id.startsWith('lit:g_sticky_piston') ? 'piston_sticky' : 'piston_normal';
        n++;
    }
    fs.writeFileSync(INDEX_PATH, JSON.stringify(idx, null, 2) + '\n');
    console.log(`[index] ${n} 条`);
}

main();
