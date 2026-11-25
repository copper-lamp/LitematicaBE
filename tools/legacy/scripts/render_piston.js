/**
 * work/render_piston.js —— 纯 Node 正交渲染器，把 ghost 活塞几何 + 贴图渲染成 PNG
 *
 * 支持：
 *   - 基岩方块几何（per-face uv / uv_size / material_instance，uv_size 可为负＝翻转）
 *   - alpha 混合、z-buffer、按面法线做 MC 风格 face dimming
 *   - 一个状态可由多个方块组成（伸出态 = 底座格 + 前方活塞头格），按 facing 方向平移拼接
 */
const fs = require('fs');
const path = require('path');
const png = require(path.join(__dirname, '..', 'tools', 'lib', 'png.js'));

const RP = path.join(__dirname, '..', 'resources', 'addon', 'LitematicaBE_RP');
const OUT = path.join(__dirname, 'piston_render');

// 与生成器一致的面内 UV 轴（官方 schema：uv 原点 = 从面外看、y 朝上时的左上角）
const AXES = {
    up: { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    down: { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    north: { n: [0, 0, -1], u: [-1, 0, 0], v: [0, -1, 0] },
    south: { n: [0, 0, 1], u: [1, 0, 0], v: [0, -1, 0] },
    west: { n: [-1, 0, 0], u: [0, 0, 1], v: [0, -1, 0] },
    east: { n: [1, 0, 0], u: [0, 0, -1], v: [0, -1, 0] },
};
const FACING_VEC = { down: [0, -1, 0], up: [0, 1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] };
const FACE_N = { 0: 'down', 1: 'up', 2: 'north', 3: 'south', 4: 'west', 5: 'east' };

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ───────── 贴图 ─────────
const texCache = new Map();
const MAT_TEX = {
    side: 'ghost_piston_side', bottom: 'ghost_piston_bottom', top: 'ghost_piston_top',
    top_carried: 'ghost_piston_top_normal', top_carried_sticky: 'ghost_piston_top_sticky',
    arm_stub: 'ghost_piston_arm_stub', arm_stub2: 'ghost_piston_arm_stub2',
    arm_end: 'ghost_piston_arm_end', arm_rod: 'ghost_piston_arm_rod',
    plate_side: 'ghost_piston_plate_side', plate_top: 'ghost_piston_plate_top',
    plate_back: 'ghost_piston_plate_back',
};
function tex(name) {
    const file = MAT_TEX[name] || name;
    if (!texCache.has(file)) {
        const p = path.join(RP, 'textures', 'blocks', 'ghost', `${file}.png`);
        texCache.set(file, png.decode(fs.readFileSync(p)));
    }
    return texCache.get(file);
}
function sample(img, u, v) {
    // 双线性采样，u/v 是 0..1
    const x = Math.min(Math.max(u, 0), 1) * (img.width - 1);
    const y = Math.min(Math.max(v, 0), 1) * (img.height - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, img.width - 1), y1 = Math.min(y0 + 1, img.height - 1);
    const fx = x - x0, fy = y - y0;
    const at = (xx, yy) => { const i = (yy * img.width + xx) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]; };
    const c00 = at(x0, y0), c10 = at(x1, y0), c01 = at(x0, y1), c11 = at(x1, y1);
    const out = [];
    for (let k = 0; k < 4; k++) {
        out[k] = (c00[k] * (1 - fx) + c10[k] * fx) * (1 - fy) + (c01[k] * (1 - fx) + c11[k] * fx) * fy;
    }
    return out;
}

// ───────── 收集面 ─────────
function collectFaces(cubes, offset) {
    const faces = [];
    for (const cube of cubes) {
        const [ox, oy, oz] = cube.origin;
        const [sx, sy, sz] = cube.size;
        const sizeArr = [sx, sy, sz];
        for (const [fname, d] of Object.entries(cube.uv)) {
            const A = AXES[fname];
            const ai = A.n.map(Math.abs).indexOf(1);
            const uLen = dot(A.u.map(Math.abs), sizeArr);
            const vLen = dot(A.v.map(Math.abs), sizeArr);
            const center = [ox + sx / 2, oy + sy / 2, oz + sz / 2];
            center[ai] = A.n[ai] > 0 ? [ox, oy, oz][ai] + sizeArr[ai] : [ox, oy, oz][ai];
            const pts = [], uvs = [];
            for (const db of [0, 1]) {
                for (const da of [0, 1]) {
                    const p = [0, 1, 2].map((i) => center[i] + A.u[i] * (da - 0.5) * uLen + A.v[i] * (db - 0.5) * vLen);
                    pts.push(add(p, offset));
                    const [su, sv] = d.uv_size;
                    uvs.push([(d.uv[0] + da * su) / 16, (d.uv[1] + db * sv) / 16]);
                }
            }
            faces.push({ pts, uvs, mat: d.material_instance, normal: A.n });
        }
    }
    return faces;
}

// ───────── 相机 ─────────
function makeCamera(center, yawDeg, pitchDeg) {
    const yaw = (yawDeg * Math.PI) / 180, pitch = (pitchDeg * Math.PI) / 180;
    // 相机方向（从相机指向物体）
    const forward = norm([
        -Math.cos(pitch) * Math.sin(yaw),
        -Math.sin(pitch),
        -Math.cos(pitch) * Math.cos(yaw),
    ]);
    const right = norm(cross(forward, [0, 1, 0]));
    const up = cross(right, forward);
    return { center, forward, right, up };
}

// ───────── 渲染 ─────────
function render(states, W, H, cam, bg) {
    const buf = Buffer.alloc(W * H * 4);
    for (let i = 0; i < W * H; i++) {
        buf[i * 4] = bg[0]; buf[i * 4 + 1] = bg[1]; buf[i * 4 + 2] = bg[2]; buf[i * 4 + 3] = 255;
    }
    const depth = new Float32Array(W * H).fill(Infinity);

    // 世界 → 屏幕：正交投影
    const project = (p) => {
        const rel = sub(p, cam.center);
        return [dot(rel, cam.right), -dot(rel, cam.up), dot(rel, cam.forward)];
    };

    const faces = [];
    for (const st of states) faces.push(...st);

    // 背面剔除 + 排序（远的先画，z-buffer 兜底）
    const visible = faces.filter((f) => dot(f.normal, cam.forward) < -1e-6);
    const withDepth = visible.map((f) => ({ f, d: f.pts.reduce((s, p) => s + project(p)[2], 0) / 4 }));
    withDepth.sort((a, b) => b.d - a.d);

    const SCALE = 19; // 每单位像素
    for (const { f } of withDepth) {
        const sp = f.pts.map(project);
        const vp = sp.map(([x, y]) => [W / 2 + x * SCALE, H / 2 + y * SCALE]);
        // 面亮度：MC 风格 face dimming
        const n = f.normal;
        let light = 1.0;
        if (n[1] > 0.5) light = 1.0;
        else if (n[1] < -0.5) light = 0.55;
        else light = 0.78;

        const img = tex(f.mat.replace(/^.*:/, ''));
        // 两个三角形：(0,1,2) (0,2,3)  顶点顺序 db-major：00,10,01,11
        const tris = [[0, 1, 3], [0, 3, 2]];
        for (const tri of tris) {
            const P = tri.map((i) => vp[i]);
            const UV = tri.map((i) => f.uvs[i]);
            const D = tri.map((i) => sp[i][2]);
            const minX = Math.max(0, Math.floor(Math.min(...P.map((p) => p[0]))));
            const maxX = Math.min(W - 1, Math.ceil(Math.max(...P.map((p) => p[0]))));
            const minY = Math.max(0, Math.floor(Math.min(...P.map((p) => p[1]))));
            const maxY = Math.min(H - 1, Math.ceil(Math.max(...P.map((p) => p[1]))));
            const den = (P[1][1] - P[2][1]) * (P[0][0] - P[2][0]) + (P[2][0] - P[1][0]) * (P[0][1] - P[2][1]);
            if (Math.abs(den) < 1e-9) continue;
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    const px = x + 0.5, py = y + 0.5;
                    const w0 = ((P[1][1] - P[2][1]) * (px - P[2][0]) + (P[2][0] - P[1][0]) * (py - P[2][1])) / den;
                    const w1 = ((P[2][1] - P[0][1]) * (px - P[2][0]) + (P[0][0] - P[2][0]) * (py - P[2][1])) / den;
                    const w2 = 1 - w0 - w1;
                    if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
                    const z = w0 * D[0] + w1 * D[1] + w2 * D[2];
                    const idx = y * W + x;
                    if (z >= depth[idx] - 1e-4) continue;
                    const u = w0 * UV[0][0] + w1 * UV[1][0] + w2 * UV[2][0];
                    const v = w0 * UV[0][1] + w1 * UV[1][1] + w2 * UV[2][1];
                    const [r, g, b, a] = sample(img, u, v);
                    if (a < 4) continue;
                    depth[idx] = z;
                    const k = idx * 4;
                    const af = a / 255;
                    buf[k] = Math.round(r * light * af + buf[k] * (1 - af));
                    buf[k + 1] = Math.round(g * light * af + buf[k + 1] * (1 - af));
                    buf[k + 2] = Math.round(b * light * af + buf[k + 2] * (1 - af));
                }
            }
        }
    }
    return { width: W, height: H, data: buf };
}

// ───────── 组装场景 ─────────
function loadGeo(name) {
    return JSON.parse(fs.readFileSync(path.join(RP, 'models', 'blocks', `${name}.json`), 'utf8'))['minecraft:geometry'][0];
}

function sceneFor(kind, facing) {
    const v = FACING_VEC[FACING[facing]];
    const out = [];
    if (kind === 'retracted') {
        out.push(...collectFaces(loadGeo(`lit_piston_f${facing}`).bones[0].cubes, [0, 0, 0]));
    } else {
        out.push(...collectFaces(loadGeo(`lit_piston_extended_f${facing}`).bones[0].cubes, [0, 0, 0]));
        // 活塞头在前方一格
        out.push(...collectFaces(loadGeo(`lit_piston_head_f${facing}`).bones[0].cubes, scl(v, 16)));
    }
    return out;
}

// 三通道 → RGB buffer 已经是 rgb
function main() {
    fs.mkdirSync(OUT, { recursive: true });
    const W = 560, H = 640;
    const bg = [30, 32, 38];
    const views = [
        { name: 'iso', yaw: 35, pitch: 32 },
        { name: 'front', yaw: 0, pitch: 0 },
    ];
    for (const kind of ['retracted', 'extended']) {
        for (const vw of views) {
            for (const facing of [1, 2]) {
                const faces = sceneFor(kind, facing);
                const center = kind === 'extended'
                    ? [FACING_VEC[FACING[facing]][0] * 8, 11, FACING_VEC[FACING[facing]][2] * 8]
                    : [0, 8, 0];
                const cam = makeCamera(center, vw.yaw, vw.pitch);
                const img = render([faces], W, H, cam, bg);
                const file = path.join(OUT, `${kind}_${vw.name}_f${facing}.png`);
                fs.writeFileSync(file, png.encode(img));
                console.log('[render]', file);
            }
        }
    }
}

const FACING = FACE_N;
main();
