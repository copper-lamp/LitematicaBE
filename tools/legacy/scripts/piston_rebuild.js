/**
 * piston_rebuild.js — 活塞 / 黏性活塞 ghost 建模与贴图全量重建
 *
 * 删掉旧的一套（18 个假模型 + 36 个方块 + 12 张手画贴图），按
 *   bedrock-samples v1.26.60.5-full 的原版资源
 * 重新生成：
 *   · 2 张 128×32 图集贴图（pistonArm 原样 + 方块面塞进空槽）
 *   · 18 个几何（收缩 f0..f5 / 伸出底座 f0..f5 / 活塞头 f0..f5）
 *   · 36 个 BP 方块定义
 *   · terrain_texture 2 条 + ghost_index 36 条指向新图集
 *
 * 几何与 UV 全部取自原版：
 *   samples/resource_pack/blocks.json  → piston 的定点贴图（piston_side/bottom/top）
 *   shape_models.json 的 piston 形状    → 金字塔式布局（底座12 + 头块8 + 杆8 + 板4）
 *   pistonArm.png 128×32                → 头块 (64,24)/(70,18)，杆 (64,4)，板 (0,16)/(16,0)/(32,0)
 *
 * 用法：node work/piston_rebuild.js
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

const GHOST_ALPHA_FACTOR = 0.80;   // 与 build_addon 的 GHOST_ALPHA_FACTOR 保持一致
const BLOCK_FORMAT_VERSION = '1.21.70';

// ─────────────────────────── 方向表 ───────────────────────────

/**
 * f0..f5 = 基岩 facing_direction：0 down / 1 up / 2 north / 3 south / 4 west / 5 east
 * out  = 活塞推出方向那一面（原版：up 面纹理）
 * back = 与 out 相对那一面（原版：down 面纹理）
 * axis = 推出方向所在的轴
 */
const FACINGS = [
    { f: 0, name: 'down', out: 'down', back: 'up', axis: 'y', neg: true },
    { f: 1, name: 'up', out: 'up', back: 'down', axis: 'y', neg: false },
    { f: 2, name: 'north', out: 'north', back: 'south', axis: 'z', neg: true },
    { f: 3, name: 'south', out: 'south', back: 'north', axis: 'z', neg: false },
    { f: 4, name: 'west', out: 'west', back: 'east', axis: 'x', neg: true },
    { f: 5, name: 'east', out: 'east', back: 'west', axis: 'x', neg: false },
];

// 原版 pistonArm 128×32 的 UV 槽位（单位：像素）
const UV = {
    arm_stub_a: [64, 24],   // 头块 6×8 的前 4 行（底座格内 / 头格内各取一半）
    arm_stub_b: [64, 28],   // 头块 6×8 的后 4 行
    arm_end: [70, 18],      // 头块 6×6 端面
    rod: [64, 4],           // 杆 4×8
    plate_side: [0, 16],    // 板 16×4 侧面
    plate_face: [16, 0],    // 板朝外面 16×16（普通=木纹，黏性=绿黏胶）
    plate_back: [32, 0],    // 板背面 16×16
    // 方块面（16×16）塞进 pistonArm 的空白槽
    block_side: [0, 0],
    block_bottom: [48, 0],
    block_top: [80, 0],
    block_inner: [96, 0],
};

/** 头块两半的 UV：只有 down 方向是反的（贴图 v 随推出方向走） */
function stubUvs(facing) {
    return facing.f === 0
        ? { base: UV.arm_stub_b, head: UV.arm_stub_a }
        : { base: UV.arm_stub_a, head: UV.arm_stub_b };
}

// ─────────────────────────── 几何坐标表 ───────────────────────────
// 相对方块中心的局部坐标，y 向上；与旧实现核对过，形状本身是对的（底座12 + 头块4+4 + 杆8 + 板4）
const GEOM = {
    0: { // down
        base: { origin: [-8, 4, -8], size: [16, 12, 16] },
        stub: { origin: [-3, 0, -3], size: [6, 4, 6] },
        headStub: { origin: [-3, 12, -3], size: [6, 4, 6] },
        rod: { origin: [-2, 4, -2], size: [4, 8, 4] },
        plate: { origin: [-8, 0, -8], size: [16, 4, 16] },
    },
    1: { // up
        base: { origin: [-8, 0, -8], size: [16, 12, 16] },
        stub: { origin: [-3, 12, -3], size: [6, 4, 6] },
        headStub: { origin: [-3, 0, -3], size: [6, 4, 6] },
        rod: { origin: [-2, 4, -2], size: [4, 8, 4] },
        plate: { origin: [-8, 12, -8], size: [16, 4, 16] },
    },
    2: { // north
        base: { origin: [-8, 0, -4], size: [16, 16, 12] },
        stub: { origin: [-3, 5, -8], size: [6, 6, 4] },
        headStub: { origin: [-3, 5, 4], size: [6, 6, 4] },
        rod: { origin: [-2, 6, -4], size: [4, 4, 8] },
        plate: { origin: [-8, 0, -8], size: [16, 16, 4] },
    },
    3: { // south
        base: { origin: [-8, 0, -8], size: [16, 16, 12] },
        stub: { origin: [-3, 5, 4], size: [6, 6, 4] },
        headStub: { origin: [-3, 5, -8], size: [6, 6, 4] },
        rod: { origin: [-2, 6, -4], size: [4, 4, 8] },
        plate: { origin: [-8, 0, 4], size: [16, 16, 4] },
    },
    4: { // west
        base: { origin: [-4, 0, -8], size: [12, 16, 16] },
        stub: { origin: [-8, 5, -3], size: [4, 6, 6] },
        headStub: { origin: [4, 5, -3], size: [4, 6, 6] },
        rod: { origin: [-4, 6, -2], size: [8, 4, 4] },
        plate: { origin: [-8, 0, -8], size: [4, 16, 16] },
    },
    5: { // east
        base: { origin: [-8, 0, -8], size: [12, 16, 16] },
        stub: { origin: [4, 5, -3], size: [4, 6, 6] },
        headStub: { origin: [-8, 5, -3], size: [4, 6, 6] },
        rod: { origin: [-4, 6, -2], size: [8, 4, 4] },
        plate: { origin: [4, 0, -8], size: [4, 16, 16] },
    },
};

// ─────────────────────────── 贴图组装 ───────────────────────────

function readImg(p) {
    return png.decode(fs.readFileSync(p));
}

/** 把小图贴到大图指定槽位（保持原 alpha） */
function blit(dst, src, x, y) {
    for (let sy = 0; sy < src.height; sy++) {
        for (let sx = 0; sx < src.width; sx++) {
            const si = (sy * src.width + sx) * 4;
            const di = ((y + sy) * dst.width + (x + sx)) * 4;
            dst.data[di] = src.data[si];
            dst.data[di + 1] = src.data[si + 1];
            dst.data[di + 2] = src.data[si + 2];
            dst.data[di + 3] = src.data[si + 3];
        }
    }
}

function buildAtlas(armName) {
    const arm = readImg(path.join(SAMPLES, 'entity', 'pistonarm', `${armName}.png`));
    if (arm.width !== 128 || arm.height !== 32) {
        throw new Error(`${armName} 尺寸异常：${arm.width}x${arm.height}，期望 128x32`);
    }
    const atlas = { width: 128, height: 32, data: Buffer.from(arm.data) };

    const faces = [
        ['piston_side', UV.block_side],
        ['piston_bottom', UV.block_bottom],
        ['piston_top_normal', UV.block_top],
        ['piston_inner', UV.block_inner],
    ];
    for (const [name, [x, y]] of faces) {
        const img = readImg(path.join(SAMPLES, 'blocks', `${name}.png`));
        if (img.width !== 16 || img.height !== 16) throw new Error(`${name} 不是 16x16`);
        blit(atlas, img, x, y);
    }
    // 半透明（ghost 必须），与 build_addon 同系数
    return png.modulateAlpha(atlas, GHOST_ALPHA_FACTOR);
}

// ─────────────────────────── 几何生成 ───────────────────────────

function uvFace(uv, size, material) {
    return { uv: [uv[0], uv[1]], uv_size: [size[0], size[1]], material_instance: material };
}

/** 一个立方体的 6 面 UV；fn(faceName) -> {uv, uv_size, material_instance} 或 null（该面不画） */
function cubeUv(fn) {
    const out = {};
    for (const face of ['north', 'south', 'east', 'west', 'up', 'down']) {
        const v = fn(face);
        if (v) out[face] = v;
    }
    return out;
}

function geometry(identifier, cubes) {
    return {
        format_version: '1.19.0',
        'minecraft:geometry': [{
            description: {
                identifier,
                texture_width: 128,
                texture_height: 32,
                visible_bounds_width: 2,
                visible_bounds_height: 2,
                visible_bounds_offset: [0, 0.5, 0],
            },
            bones: [{ name: 'body', pivot: [0, 0, 0], cubes }],
        }],
    };
}

/** 收缩态：满块 16³，推出方向面 = 顶面纹理，背面 = 底面纹理，4 侧 = 侧面纹理 */
function buildRetracted(facing) {
    const cube = {
        origin: [-8, 0, -8],
        size: [16, 16, 16],
        uv: cubeUv((face) => {
            if (face === facing.out) return uvFace(UV.block_top, [16, 16], 'top');
            if (face === facing.back) return uvFace(UV.block_bottom, [16, 16], 'bottom');
            return uvFace(UV.block_side, [16, 16], 'side');
        }),
    };
    return geometry(`geometry.lit_piston_f${facing.f}`, [cube]);
}

/** 伸出态底座：12 高本体 + 4px 头段（跨越到活塞头方块的那半由 head 模型画） */
function buildExtendedBase(facing) {
    const g = GEOM[facing.f];
    const half = stubUvs(facing);
    const base = {
        origin: g.base.origin,
        size: g.base.size,
        uv: cubeUv((face) => {
            if (face === facing.out) return uvFace(UV.block_top, [16, 16], 'top');
            if (face === facing.back) return uvFace(UV.block_bottom, [16, 16], 'bottom');
            return uvFace(UV.block_side, [16, 16], 'side');
        }),
    };
    const stub = {
        origin: g.stub.origin,
        size: g.stub.size,
        uv: cubeUv((face) => {
            if (face === facing.out || face === facing.back) return uvFace(UV.arm_end, [6, 6], 'arm_end');
            return uvFace(half.base, [6, 4], 'arm_stub');
        }),
    };
    return geometry(`geometry.lit_piston_extended_f${facing.f}`, [base, stub]);
}

/** 活塞头方块：头段后半 + 杆 + 板（板在活塞头格远端，按 samples shape_models） */
function buildHead(facing) {
    const g = GEOM[facing.f];
    const half = stubUvs(facing);
    const headStub = {
        origin: g.headStub.origin,
        size: g.headStub.size,
        uv: cubeUv((face) => {
            if (face === facing.out || face === facing.back) return uvFace(UV.arm_end, [6, 6], 'arm_end');
            return uvFace(half.head, [6, 4], 'arm_stub');
        }),
    };
    const rod = {
        origin: g.rod.origin,
        size: g.rod.size,
        uv: cubeUv((face) => {
            if (face === facing.out || face === facing.back) return null;  // 两端埋头段/板里
            return uvFace(UV.rod, [4, 8], 'arm_rod');
        }),
    };
    const plate = {
        origin: g.plate.origin,
        size: g.plate.size,
        uv: cubeUv((face) => {
            if (face === facing.out) return uvFace(UV.plate_face, [16, 16], 'plate_top');
            if (face === facing.back) return uvFace(UV.plate_back, [16, 16], 'plate_back');
            return uvFace(UV.plate_side, [16, 4], 'plate_side');
        }),
    };
    return geometry(`geometry.lit_piston_head_f${facing.f}`, [headStub, rod, plate]);
}

// ─────────────────────────── BP 方块定义 ───────────────────────────

const MATS = ['side', 'top', 'bottom', 'inner', 'arm_stub', 'arm_end', 'arm_rod', 'plate_side', 'plate_top', 'plate_back'];

function blockDef(identifier, geometryId, atlasTexture) {
    const material = {};
    for (const m of MATS) {
        material[m] = {
            texture: atlasTexture,
            render_method: 'blend',
            face_dimming: false,
            ambient_occlusion: false,
        };
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

// ─────────────────────────── 主流程 ───────────────────────────

function rmGlob(dir, re) {
    if (!fs.existsSync(dir)) return 0;
    let n = 0;
    for (const f of fs.readdirSync(dir)) {
        if (re.test(f)) { fs.rmSync(path.join(dir, f), { force: true }); n++; }
    }
    return n;
}

function main() {
    // 1) 删除旧的活塞资产
    const delModels = rmGlob(MODEL_DIR, /^lit_piston.*\.json$/);
    const delBp = rmGlob(BP_BLOCK_DIR, /^(g_piston|g_sticky_piston).*\.json$/);
    const delTex = rmGlob(GHOST_TEX_DIR, /^ghost_piston.*\.png$/);
    console.log(`[del] 模型 ${delModels} / BP 方块 ${delBp} / ghost 贴图 ${delTex}`);

    // 2) 图集贴图
    const atlasNormal = buildAtlas('pistonArm');
    const atlasSticky = buildAtlas('pistonArmSticky');
    fs.writeFileSync(path.join(GHOST_TEX_DIR, 'ghost_piston_atlas.png'), png.encode(atlasNormal));
    fs.writeFileSync(path.join(GHOST_TEX_DIR, 'ghost_piston_atlas_sticky.png'), png.encode(atlasSticky));
    console.log(`[tex] ghost_piston_atlas.png / ghost_piston_atlas_sticky.png 128x32 alpha均值 ${
        png.alphaStats(atlasNormal).mean.toFixed(1)}`);

    // 3) 18 个几何
    let nModel = 0;
    for (const facing of FACINGS) {
        const writes = [
            [`lit_piston_f${facing.f}.json`, buildRetracted(facing)],
            [`lit_piston_extended_f${facing.f}.json`, buildExtendedBase(facing)],
            [`lit_piston_head_f${facing.f}.json`, buildHead(facing)],
        ];
        for (const [name, json] of writes) {
            fs.writeFileSync(path.join(MODEL_DIR, name), JSON.stringify(json, null, 2) + '\n');
            nModel++;
        }
    }
    console.log(`[model] ${nModel} 个几何`);

    // 4) 36 个 BP 方块
    const defs = [];
    for (const facing of FACINGS) {
        const f = facing.f;
        defs.push([`g_piston_side_f${f}`, `geometry.lit_piston_f${f}`, 'ghost_piston_atlas']);
        defs.push([`g_sticky_piston_f${f}`, `geometry.lit_piston_f${f}`, 'ghost_piston_atlas_sticky']);
        defs.push([`g_piston_side_extended_f${f}`, `geometry.lit_piston_extended_f${f}`, 'ghost_piston_atlas']);
        defs.push([`g_sticky_piston_extended_f${f}`, `geometry.lit_piston_extended_f${f}`, 'ghost_piston_atlas_sticky']);
        defs.push([`g_piston_head_f${f}`, `geometry.lit_piston_head_f${f}`, 'ghost_piston_atlas']);
        defs.push([`g_sticky_piston_head_f${f}`, `geometry.lit_piston_head_f${f}`, 'ghost_piston_atlas_sticky']);
    }
    for (const [short, geom, tex] of defs) {
        const json = blockDef(`lit:${short}`, geom, tex);
        fs.writeFileSync(path.join(BP_BLOCK_DIR, `${short}.json`), JSON.stringify(json, null, 2) + '\n');
    }
    console.log(`[bp] ${defs.length} 个方块定义`);

    // 5) terrain_texture：删掉旧 piston 键，写入 2 条图集
    const tt = JSON.parse(fs.readFileSync(TERRAIN, 'utf8'));
    for (const k of Object.keys(tt.texture_data || {})) {
        if (/^ghost_piston/.test(k)) delete tt.texture_data[k];
    }
    tt.texture_data['ghost_piston_atlas'] = { textures: 'textures/blocks/ghost/ghost_piston_atlas' };
    tt.texture_data['ghost_piston_atlas_sticky'] = { textures: 'textures/blocks/ghost/ghost_piston_atlas_sticky' };
    fs.writeFileSync(TERRAIN, JSON.stringify(tt, null, 2) + '\n');
    console.log(`[texmap] ghost_piston_atlas + ghost_piston_atlas_sticky，旧 ghost_piston_* 键已清`);

    // 6) ghost_index：36 条 blocks 的 texture 指向图集（javaMap / javaMapByState 是手写的，保持结构）
    const idx = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    let nIdx = 0;
    for (const id of Object.keys(idx.blocks || {})) {
        if (!/^lit:g_(sticky_piston|piston_)/.test(id)) continue;
        const sticky = id.startsWith('lit:g_sticky_piston');
        idx.blocks[id].texture = sticky ? 'piston_atlas_sticky' : 'piston_atlas';
        nIdx++;
    }
    fs.writeFileSync(INDEX_PATH, JSON.stringify(idx, null, 2) + '\n');
    console.log(`[index] ${nIdx} 条 blocks 指向新图集`);
}

main();
