/**
 * work/piston_split_tex.js — 活塞贴图改为 16×16 分贴图（每张从原版精确裁切，不手画）
 *
 * 背景：CHANGELOG 1.1.56 记载「基岩方块几何对非 16×16 图集的 UV 解释不可靠」，
 *       128×32 图集在实机吃过亏。这里改回 16×16，但内容全部从原版 pistonArm /
 *       pistonArmSticky / blocks 贴图按 UV 区域裁切，逐像素一致。
 *
 * 产物：
 *   · 12 张 16×16 ghost 贴图（内容在左上角，其余透明）
 *   · 18 个几何（texture 16×16，UV 全 (0,0)+尺寸）
 *   · 36 个 BP 方块（材质实例指向各自分贴图）
 *   · terrain_texture + ghost_index 指向新键
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
const BLOCK_FORMAT_VERSION = '1.21.70';

const FACINGS = [
    { f: 0, name: 'down', out: 'down', back: 'up' },
    { f: 1, name: 'up', out: 'up', back: 'down' },
    { f: 2, name: 'north', out: 'north', back: 'south' },
    { f: 3, name: 'south', out: 'south', back: 'north' },
    { f: 4, name: 'west', out: 'west', back: 'east' },
    { f: 5, name: 'east', out: 'east', back: 'west' },
];

// 原版 pistonArm 128×32 的 UV 区域（与 shape_models.json 的 piston 形状一致）
const UV_REGION = {
    arm_stub_a: [64, 24, 6, 4],   // 头块 6×8 的前 4 行
    arm_stub_b: [64, 28, 6, 4],   // 后 4 行
    arm_end: [70, 18, 6, 6],      // 头块端面
    arm_rod: [64, 4, 4, 8],       // 杆
    plate_side: [0, 16, 16, 4],   // 板侧面
    plate_top: [16, 0, 16, 16],   // 板推面（普通木纹 / 黏性绿）
    plate_back: [32, 0, 16, 16],  // 板内面
};

const GEOM = {
    0: { base: { origin: [-8, 4, -8], size: [16, 12, 16] }, stub: { origin: [-3, 0, -3], size: [6, 4, 6] }, headStub: { origin: [-3, 12, -3], size: [6, 4, 6] }, rod: { origin: [-2, 4, -2], size: [4, 8, 4] }, plate: { origin: [-8, 0, -8], size: [16, 4, 16] } },
    1: { base: { origin: [-8, 0, -8], size: [16, 12, 16] }, stub: { origin: [-3, 12, -3], size: [6, 4, 6] }, headStub: { origin: [-3, 0, -3], size: [6, 4, 6] }, rod: { origin: [-2, 4, -2], size: [4, 8, 4] }, plate: { origin: [-8, 12, -8], size: [16, 4, 16] } },
    2: { base: { origin: [-8, 0, -4], size: [16, 16, 12] }, stub: { origin: [-3, 5, -8], size: [6, 6, 4] }, headStub: { origin: [-3, 5, 4], size: [6, 6, 4] }, rod: { origin: [-2, 6, -4], size: [4, 4, 8] }, plate: { origin: [-8, 0, -8], size: [16, 16, 4] } },
    3: { base: { origin: [-8, 0, -8], size: [16, 16, 12] }, stub: { origin: [-3, 5, 4], size: [6, 6, 4] }, headStub: { origin: [-3, 5, -8], size: [6, 6, 4] }, rod: { origin: [-2, 6, -4], size: [4, 4, 8] }, plate: { origin: [-8, 0, 4], size: [16, 16, 4] } },
    4: { base: { origin: [-4, 0, -8], size: [12, 16, 16] }, stub: { origin: [-8, 5, -3], size: [4, 6, 6] }, headStub: { origin: [4, 5, -3], size: [4, 6, 6] }, rod: { origin: [-4, 6, -2], size: [8, 4, 4] }, plate: { origin: [-8, 0, -8], size: [4, 16, 16] } },
    5: { base: { origin: [-8, 0, -8], size: [12, 16, 16] }, stub: { origin: [4, 5, -3], size: [4, 6, 6] }, headStub: { origin: [-8, 5, -3], size: [4, 6, 6] }, rod: { origin: [-4, 6, -2], size: [8, 4, 4] }, plate: { origin: [4, 0, -8], size: [4, 16, 16] } },
};

// ─────────── 裁切 ───────────

function readImg(p) { return png.decode(fs.readFileSync(p)); }

/** 从 src 的 (x,y,w,h) 精确裁到 16×16 画布左上角，其余透明 */
function cropTo16(src, x, y, w, h) {
    const out = { width: 16, height: 16, data: Buffer.alloc(16 * 16 * 4) };
    for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++) {
            const si = ((y + yy) * src.width + (x + xx)) * 4;
            const di = (yy * 16 + xx) * 4;
            out.data[di] = src.data[si];
            out.data[di + 1] = src.data[si + 1];
            out.data[di + 2] = src.data[si + 2];
            out.data[di + 3] = src.data[si + 3];
        }
    }
    return out;
}

function buildTextures() {
    const arm = readImg(path.join(SAMPLES, 'entity', 'pistonarm', 'pistonArm.png'));
    const armSticky = readImg(path.join(SAMPLES, 'entity', 'pistonarm', 'pistonArmSticky.png'));
    const blocks = (n) => readImg(path.join(SAMPLES, 'blocks', `${n}.png`));

    const flat16 = (img) => ({ width: 16, height: 16, data: Buffer.from(img.data) });

    const make = (name, img) => {
        fs.writeFileSync(path.join(GHOST_TEX_DIR, `${name}.png`), png.encode(png.modulateAlpha(img, GHOST_ALPHA_FACTOR)));
        return name;
    };

    // 方块面：原版 blocks 贴图本身就是 16×16
    make('ghost_piston_side', flat16(blocks('piston_side')));
    make('ghost_piston_bottom', flat16(blocks('piston_bottom')));
    make('ghost_piston_top', flat16(blocks('piston_top_normal')));
    make('ghost_piston_inner', flat16(blocks('piston_inner')));

    // 活塞臂 / 板：从 pistonArm 精确裁切
    for (const [key, [x, y, w, h]] of Object.entries(UV_REGION)) {
        if (key === 'plate_top') continue; // 普通/黏性分别出图
        make(`ghost_piston_${key}`, cropTo16(arm, x, y, w, h));
    }
    // 推面：普通木纹 / 黏性绿黏胶（原版 pistonArm 与 pistonArmSticky 只在 (16,0) 不同）
    make('ghost_piston_plate_top', cropTo16(arm, 16, 0, 16, 16));
    make('ghost_piston_plate_top_sticky', cropTo16(armSticky, 16, 0, 16, 16));
}

// ─────────── 几何 ───────────

function uv(face, size, mat) {
    return { uv: [0, 0], uv_size: [size[0], size[1]], material_instance: mat };
}
function cubeUv(fn) {
    const out = {};
    for (const face of ['north', 'south', 'east', 'west', 'up', 'down']) {
        const v = fn(face);
        if (v) out[face] = v;
    }
    return out;
}
function geometry(id, cubes) {
    return {
        format_version: '1.19.0',
        'minecraft:geometry': [{
            description: {
                identifier: id,
                texture_width: 16,
                texture_height: 16,
                visible_bounds_width: 2,
                visible_bounds_height: 2,
                visible_bounds_offset: [0, 0.5, 0],
            },
            bones: [{ name: 'body', pivot: [0, 0, 0], cubes }],
        }],
    };
}

/** 头块两半：只有 down 方向反序（贴图 v 随推出方向走） */
function stubMats(facing) {
    return facing.f === 0
        ? { base: 'arm_stub_b', head: 'arm_stub_a' }
        : { base: 'arm_stub_a', head: 'arm_stub_b' };
}

function buildRetracted(facing) {
    const cube = {
        origin: [-8, 0, -8],
        size: [16, 16, 16],
        uv: cubeUv((face) => {
            if (face === facing.out) return uv(face, [16, 16], 'top');
            if (face === facing.back) return uv(face, [16, 16], 'bottom');
            return uv(face, [16, 16], 'side');
        }),
    };
    return geometry(`geometry.lit_piston_f${facing.f}`, [cube]);
}

function buildExtended(facing) {
    const g = GEOM[facing.f];
    const m = stubMats(facing);
    const base = {
        origin: g.base.origin,
        size: g.base.size,
        uv: cubeUv((face) => {
            if (face === facing.out) return uv(face, [16, 16], 'top');
            if (face === facing.back) return uv(face, [16, 16], 'bottom');
            return uv(face, [16, 16], 'side');
        }),
    };
    const stub = {
        origin: g.stub.origin,
        size: g.stub.size,
        uv: cubeUv((face) => {
            if (face === facing.out || face === facing.back) return uv(face, [6, 6], 'arm_end');
            return uv(face, [6, 4], m.base);
        }),
    };
    return geometry(`geometry.lit_piston_extended_f${facing.f}`, [base, stub]);
}

function buildHead(facing) {
    const g = GEOM[facing.f];
    const m = stubMats(facing);
    const headStub = {
        origin: g.headStub.origin,
        size: g.headStub.size,
        uv: cubeUv((face) => {
            if (face === facing.out || face === facing.back) return uv(face, [6, 6], 'arm_end');
            return uv(face, [6, 4], m.head);
        }),
    };
    const rod = {
        origin: g.rod.origin,
        size: g.rod.size,
        uv: cubeUv((face) => {
            if (face === facing.out || face === facing.back) return null;
            return uv(face, [4, 8], 'arm_rod');
        }),
    };
    const plate = {
        origin: g.plate.origin,
        size: g.plate.size,
        uv: cubeUv((face) => {
            if (face === facing.out) return uv(face, [16, 16], 'plate_top');
            if (face === facing.back) return uv(face, [16, 16], 'plate_back');
            return uv(face, [16, 4], 'plate_side');
        }),
    };
    return geometry(`geometry.lit_piston_head_f${facing.f}`, [headStub, rod, plate]);
}

// ─────────── BP ───────────

const BASE_MATS = {
    side: 'ghost_piston_side',
    top: 'ghost_piston_top',
    bottom: 'ghost_piston_bottom',
    inner: 'ghost_piston_inner',
};
const ARM_MATS = {
    arm_stub_a: 'ghost_piston_arm_stub_a',
    arm_stub_b: 'ghost_piston_arm_stub_b',
    arm_end: 'ghost_piston_arm_end',
    arm_rod: 'ghost_piston_arm_rod',
    plate_side: 'ghost_piston_plate_side',
    plate_top: 'ghost_piston_plate_top',
    plate_back: 'ghost_piston_plate_back',
};

function blockDef(identifier, geometryId, mats) {
    const material = {};
    for (const [slot, tex] of Object.entries(mats)) {
        material[slot] = { texture: tex, render_method: 'blend', face_dimming: false, ambient_occlusion: false };
    }
    return {
        format_version: BLOCK_FORMAT_VERSION,
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

// ─────────── 主流程 ───────────

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
    console.log('[tex] 12 张 16×16 分贴图（全部从原版精确裁切）');

    for (const facing of FACINGS) {
        fs.writeFileSync(path.join(MODEL_DIR, `lit_piston_f${facing.f}.json`), JSON.stringify(buildRetracted(facing), null, 2) + '\n');
        fs.writeFileSync(path.join(MODEL_DIR, `lit_piston_extended_f${facing.f}.json`), JSON.stringify(buildExtended(facing), null, 2) + '\n');
        fs.writeFileSync(path.join(MODEL_DIR, `lit_piston_head_f${facing.f}.json`), JSON.stringify(buildHead(facing), null, 2) + '\n');
    }
    console.log('[model] 18 个几何（texture 16×16）');

    const stickyHeadMats = { ...BASE_MATS, ...ARM_MATS, plate_top: 'ghost_piston_plate_top_sticky' };
    const defs = [];
    for (const facing of FACINGS) {
        const f = facing.f;
        defs.push([`g_piston_side_f${f}`, `geometry.lit_piston_f${f}`, BASE_MATS]);
        defs.push([`g_sticky_piston_f${f}`, `geometry.lit_piston_f${f}`, BASE_MATS]);
        defs.push([`g_piston_side_extended_f${f}`, `geometry.lit_piston_extended_f${f}`, { ...BASE_MATS, ...ARM_MATS }]);
        defs.push([`g_sticky_piston_extended_f${f}`, `geometry.lit_piston_extended_f${f}`, { ...BASE_MATS, ...ARM_MATS }]);
        defs.push([`g_piston_head_f${f}`, `geometry.lit_piston_head_f${f}`, { ...BASE_MATS, ...ARM_MATS }]);
        defs.push([`g_sticky_piston_head_f${f}`, `geometry.lit_piston_head_f${f}`, stickyHeadMats]);
    }
    for (const [short, geo, mats] of defs) {
        fs.writeFileSync(path.join(BP_BLOCK_DIR, `${short}.json`), JSON.stringify(blockDef(`lit:${short}`, geo, mats), null, 2) + '\n');
    }
    console.log('[bp] 36 个方块定义');

    const tt = JSON.parse(fs.readFileSync(TERRAIN, 'utf8'));
    for (const k of Object.keys(tt.texture_data || {})) if (/^ghost_piston/.test(k)) delete tt.texture_data[k];
    const texKeys = ['side', 'bottom', 'top', 'inner', 'arm_stub_a', 'arm_stub_b', 'arm_end', 'arm_rod',
        'plate_side', 'plate_top', 'plate_top_sticky', 'plate_back'];
    for (const k of texKeys) {
        tt.texture_data[`ghost_piston_${k}`] = { textures: `textures/blocks/ghost/ghost_piston_${k}` };
    }
    fs.writeFileSync(TERRAIN, JSON.stringify(tt, null, 2) + '\n');
    console.log(`[terrain] ${texKeys.length} 条分贴图键`);

    const idx = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    let n = 0;
    for (const id of Object.keys(idx.blocks || {})) {
        if (!/^lit:g_(sticky_piston|piston_)/.test(id)) continue;
        idx.blocks[id].texture = id.startsWith('lit:g_sticky_piston') ? 'piston_split_sticky' : 'piston_split';
        n++;
    }
    fs.writeFileSync(INDEX_PATH, JSON.stringify(idx, null, 2) + '\n');
    console.log(`[index] ${n} 条 blocks 更新`);
}

main();
