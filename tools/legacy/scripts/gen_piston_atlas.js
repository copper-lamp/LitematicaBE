#!/usr/bin/env node
/**
 * gen_piston_atlas.js — 活塞 / 黏性活塞建模（全 16x16 贴图版）
 *
 * 为什么不再用 128x32 图集：
 *   基岩版方块几何的 UV 在实机上没有按 `texture_width/height` 去解释非 16x16 的贴图
 *   （128x32 图集 + uv [64,24] 这种坐标被打成了别的内容，整根活塞糊上粘液绿）。
 *   现在每一张贴图都是 16x16，UV 全部落在 0…16，靠 material_instance 区分面。
 *
 * 贴图（全部 alpha × 0.80，与项目其它 ghost 一致）：
 *   ghost_piston_side.png        piston_side        收缩态四壁
 *   ghost_piston_top_normal.png  piston_top_normal  活塞面（普通）
 *   ghost_piston_top_sticky.png  piston_top_sticky  活塞面（黏性）
 *   ghost_piston_bottom.png      piston_bottom      底面
 *   ghost_piston_inner.png       piston_inner       伸出态内面 + 四壁
 *   ghost_piston_plate_side.png  pistonArm (0,16)   头板四壁（16x4 用块内 0,0）
 *   ghost_piston_arm1.png        pistonArm (64,16)  臂段1（块内 v8..16，6x8）
 *   ghost_piston_arm2.png        pistonArm (64,0)   臂段2（块内 v4..12，4x8）
 *
 * 结构（两段式，所有 cube 都在方块 0…16 内）：
 *   base 收缩 = 16x16x16
 *   base 伸出 = 16x12x16 + 6x4x6 短杆（12..16，臂段1 的上半）
 *   头格     = 6x4x6（0..4，臂段1 的下半）+ 4x8x4（4..12）+ 16x4x16 头板（12..16）
 *
 * 用法：node work/gen_piston_atlas.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RP = path.join(ROOT, 'resources/addon/LitematicaBE_RP');
const BP = path.join(ROOT, 'resources/addon/LitematicaBE_BP/blocks');
const INDEX = path.join(ROOT, 'resources/data/ghost_index.json');
const VANILLA = 'C:/Users/25491/Desktop/建模贴图/resource/bedrock-samples-v1.26.60.5-full/resource_pack/textures';
const png = require(path.join(ROOT, 'tools/lib/png.js'));

const GHOST_ALPHA_FACTOR = 0.80;

// ────────── 1. 贴图：全部 16x16 ──────────
function crop16(img, ox, oy) {
    const out = { width: 16, height: 16, data: Buffer.alloc(16 * 16 * 4, 0) };
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            const sx = ox + x, sy = oy + y;
            if (sx >= img.width || sy >= img.height) continue;
            const s = (sy * img.width + sx) * 4;
            const d = (y * 16 + x) * 4;
            for (let k = 0; k < 4; k++) out.data[d + k] = img.data[s + k];
        }
    }
    return out;
}

function writeGhostImage(img, name) {
    const out = png.modulateAlpha(img, GHOST_ALPHA_FACTOR);
    const dst = path.join(RP, 'textures/blocks/ghost', `${name}.png`);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, png.encode(out));
    console.log(`  > ${name}.png  ${out.width}x${out.height}  alpha均值 ${png.alphaStats(out).mean.toFixed(0)}`);
}

function buildTextures() {
    const arm = png.decode(fs.readFileSync(path.join(VANILLA, 'entity/pistonarm/pistonArm.png')));

    // 方块自身贴图（16x16，直接用原版）
    writeGhostImage(png.decode(fs.readFileSync(path.join(VANILLA, 'blocks/piston_side.png'))), 'ghost_piston_side');
    writeGhostImage(png.decode(fs.readFileSync(path.join(VANILLA, 'blocks/piston_top_normal.png'))), 'ghost_piston_top_normal');
    writeGhostImage(png.decode(fs.readFileSync(path.join(VANILLA, 'blocks/piston_top_sticky.png'))), 'ghost_piston_top_sticky');
    writeGhostImage(png.decode(fs.readFileSync(path.join(VANILLA, 'blocks/piston_bottom.png'))), 'ghost_piston_bottom');
    writeGhostImage(png.decode(fs.readFileSync(path.join(VANILLA, 'blocks/piston_inner.png'))), 'ghost_piston_inner');

    // pistonArm 图集裁成 16x16 块（UV 就落在 0…16 里了）
    writeGhostImage(crop16(arm, 0, 16), 'ghost_piston_plate_side');  // 头板四壁：块内 (0,0) 16x4
    writeGhostImage(crop16(arm, 64, 16), 'ghost_piston_arm1');       // 臂段1：块内 (0,8) 6x8
    writeGhostImage(crop16(arm, 64, 0), 'ghost_piston_arm2');        // 臂段2：块内 (0,4) 4x8
}

function registerTextures() {
    const p = path.join(RP, 'textures/terrain_texture.json');
    const tt = JSON.parse(fs.readFileSync(p, 'utf8'));
    const names = [
        'ghost_piston_side', 'ghost_piston_top_normal', 'ghost_piston_top_sticky',
        'ghost_piston_bottom', 'ghost_piston_inner', 'ghost_piston_plate_side',
        'ghost_piston_arm1', 'ghost_piston_arm2',
    ];
    let added = 0;
    for (const name of names) {
        if (!tt.texture_data[name]) {
            tt.texture_data[name] = { textures: `textures/blocks/ghost/${name}` };
            added++;
        }
    }
    fs.writeFileSync(p, JSON.stringify(tt, null, 2), 'utf8');
    console.log(`  > terrain_texture.json  +${added} 条（共 ${names.length} 张活塞贴图）`);
}

// ────────── 2. 几何：texture 16x16，UV 全在 0…16 ──────────
function face(uv, w, h, mat) {
    const f = { uv: [uv[0], uv[1]], uv_size: [w, h] };
    if (mat) f.material_instance = mat;
    return f;
}
function sides(uv, w, h, mat) {
    return {
        north: face(uv, w, h, mat), south: face(uv, w, h, mat),
        east: face(uv, w, h, mat), west: face(uv, w, h, mat),
    };
}

function geometry(identifier, cubes) {
    return {
        format_version: '1.19.0',
        'minecraft:geometry': [{
            description: {
                identifier,
                texture_width: 16,
                texture_height: 16,
                visible_bounds_width: 1,
                visible_bounds_height: 1,
                visible_bounds_offset: [0, 0, 0],
            },
            bones: [{ name: 'body', pivot: [0, 0, 0], cubes }],
        }],
    };
}

/** 收缩态：整格 16x16x16 */
function collapsedGeometry() {
    return geometry('geometry.lit_piston', [{
        origin: [-8, 0, -8],
        size: [16, 16, 16],
        uv: {
            ...sides([0, 0], 16, 16, 'side'),
            up: face([0, 0], 16, 16, 'top'),
            down: face([0, 0], 16, 16, 'bottom'),
        },
    }]);
}

/** 伸出态 base：16x12x16（内面 + 四壁 = piston_inner）+ 6x4x6 短杆 */
function extendedGeometry() {
    return geometry('geometry.lit_piston_extended', [
        {
            origin: [-8, 0, -8],
            size: [16, 12, 16],
            uv: {
                ...sides([0, 4], 16, 12, 'inner'),  // piston_inner 的 v4..16
                up: face([0, 0], 16, 16, 'inner'),
                down: face([0, 0], 16, 16, 'bottom'),
            },
        },
        {
            origin: [-3, 12, -3],
            size: [6, 4, 6],
            uv: sides([0, 8], 6, 4, 'arm1'),      // 臂段1 块内 v8..12
        },
    ]);
}

/** 头格：臂段1 下半 + 臂段2 + 头板 */
function headGeometry() {
    return geometry('geometry.lit_piston_head', [
        { origin: [-3, 0, -3], size: [6, 4, 6], uv: sides([0, 12], 6, 4, 'arm1') },
        { origin: [-2, 4, -2], size: [4, 8, 4], uv: sides([0, 4], 4, 8, 'arm2') },
        {
            origin: [-8, 12, -8],
            size: [16, 4, 16],
            uv: {
                ...sides([0, 0], 16, 4, 'plateSide'),
                down: face([0, 0], 16, 16, 'inner'),
                up: face([0, 0], 16, 16, 'top'),
            },
        },
    ]);
}

function writeJson(p, o) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n', 'utf8');
    console.log('  >', path.relative(ROOT, p).replace(/\\/g, '/'));
}

// ────────── 3. BP 方块 ──────────
const FACING_ROT = {
    0: [180, 0, 0], 1: [0, 0, 0], 2: [90, 0, 0], 3: [-90, 0, 0], 4: [0, 0, -90], 5: [0, 0, 90],
};

function mi(texture) {
    return { texture, render_method: 'blend', face_dimming: false, ambient_occlusion: false };
}

/** base 材质表：收缩态用 side/top/bottom，伸出态用 inner/bottom/arm1 */
function baseMaterials(topTexture) {
    return {
        '*': mi('ghost_piston_side'),
        side: mi('ghost_piston_side'),
        top: mi(topTexture),
        bottom: mi('ghost_piston_bottom'),
        inner: mi('ghost_piston_inner'),
        arm1: mi('ghost_piston_arm1'),
    };
}

function headMaterials(topTexture) {
    return {
        '*': mi('ghost_piston_plate_side'),
        plateSide: mi('ghost_piston_plate_side'),
        top: mi(topTexture),
        inner: mi('ghost_piston_inner'),
        arm1: mi('ghost_piston_arm1'),
        arm2: mi('ghost_piston_arm2'),
    };
}

function blockDef(identifier, geometryId, materials, extraStates, perms) {
    return {
        format_version: '1.21.70',
        'minecraft:block': {
            description: {
                identifier,
                menu_category: { category: 'none' },
                states: extraStates,
            },
            components: {
                'minecraft:geometry': geometryId,
                'minecraft:material_instances': materials,
                'minecraft:collision_box': false,
                'minecraft:selection_box': false,
                'minecraft:destructible_by_mining': false,
                'minecraft:destructible_by_explosion': false,
                'minecraft:replaceable': {},
                'minecraft:light_dampening': 0,
                'minecraft:map_color': '#888888',
                'minecraft:transformation': { rotation: [0, 0, 0], scale: [1, 1, 1], translation: [0, 0, 0] },
            },
            permutations: perms,
        },
    };
}

function facingPerms() {
    const perms = [];
    for (let f = 0; f <= 5; f++) {
        perms.push({
            condition: `q.block_state('lit:facing') == ${f}`,
            components: {
                'minecraft:transformation': { rotation: FACING_ROT[f], scale: [1, 1, 1], translation: [0, 0, 0] },
            },
        });
    }
    return perms;
}

function baseBlock(identifier, topTexture, geometryId) {
    return blockDef(identifier, geometryId, baseMaterials(topTexture),
        { 'lit:facing': { values: { min: 0, max: 5 } } }, facingPerms());
}

/** 头方块：6 朝向 × 普通/黏性材质（组合条件，不依赖 permutation 覆盖顺序） */
function headBlock(identifier, stickyOnly) {
    const perms = [];
    const variants = stickyOnly ? [true] : [false, true];
    for (const sticky of variants) {
        const topTex = sticky ? 'ghost_piston_top_sticky' : 'ghost_piston_top_normal';
        for (let f = 0; f <= 5; f++) {
            perms.push({
                condition: stickyOnly
                    ? `q.block_state('lit:facing') == ${f}`
                    : `q.block_state('lit:sticky') == ${sticky} && q.block_state('lit:facing') == ${f}`,
                components: {
                    'minecraft:material_instances': headMaterials(topTex),
                    'minecraft:transformation': { rotation: FACING_ROT[f], scale: [1, 1, 1], translation: [0, 0, 0] },
                },
            });
        }
    }
    const states = stickyOnly
        ? { 'lit:facing': { values: { min: 0, max: 5 } } }
        : { 'lit:facing': { values: { min: 0, max: 5 } }, 'lit:sticky': { values: [false, true] } };
    return blockDef(identifier, 'geometry.lit_piston_head', headMaterials('ghost_piston_top_normal'), states, perms);
}

// ────────── 4. ghost_index ──────────
function updateIndex() {
    const idx = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
    const facingFrom = () => ({ type: 'int', min: 0, max: 5, default: 1, from: 'facing_direction' });
    const facingDecl = () => ({
        type: 'int', min: 0, max: 5, default: 1,
        from: 'facing', fallbackFrom: 'facing_direction',
        map: { down: 0, up: 1, north: 2, south: 3, west: 4, east: 5 },
    });

    idx.blocks['lit:g_piston_side'] = { texture: 'piston_side', geometry: 'piston', states: { 'lit:facing': facingFrom() } };
    idx.blocks['lit:g_piston_side_extended'] = { texture: 'piston_inner', geometry: 'piston_extended', states: { 'lit:facing': facingFrom() } };
    idx.blocks['lit:g_sticky_piston'] = { texture: 'piston_top_sticky', geometry: 'piston', states: { 'lit:facing': facingFrom() } };
    idx.blocks['lit:g_sticky_piston_extended'] = { texture: 'piston_inner', geometry: 'piston_extended', states: { 'lit:facing': facingFrom() } };
    idx.blocks['lit:g_piston_head'] = {
        texture: 'piston_top_normal', geometry: 'piston_head',
        states: {
            'lit:facing': facingDecl(),
            'lit:sticky': { type: 'bool', default: false, from: 'type', map: { normal: false, sticky: true, true: true, false: false } },
        },
    };
    idx.blocks['lit:g_sticky_piston_head'] = {
        texture: 'piston_top_sticky', geometry: 'piston_head',
        states: { 'lit:facing': facingDecl() },
    };

    idx.javaMap['minecraft:piston'] = 'lit:g_piston_side';
    idx.javaMap['minecraft:sticky_piston'] = 'lit:g_sticky_piston';
    idx.javaMap['minecraft:piston_head'] = 'lit:g_piston_head';
    idx.javaMap['minecraft:piston_arm_collision'] = 'lit:g_piston_head';
    idx.javaMap['minecraft:sticky_piston_arm_collision'] = 'lit:g_sticky_piston_head';
    idx.javaMap['minecraft:moving_piston'] = 'lit:g_piston_head';
    idx.javaMapByState = {
        'minecraft:piston': { extended_bit: { '0': 'lit:g_piston_side', '1': 'lit:g_piston_side_extended' } },
        'minecraft:sticky_piston': { extended_bit: { '0': 'lit:g_sticky_piston', '1': 'lit:g_sticky_piston_extended' } },
    };

    const total = Object.keys(idx.javaMap).length;
    const generic = Object.values(idx.javaMap).filter(v => v === idx.genericId).length;
    idx.javaMapStats = { total, mapped: total - generic, generic };
    fs.writeFileSync(INDEX, JSON.stringify(idx, null, 2) + '\n', 'utf8');
    console.log(`  > ghost_index.json（${total} 条映射，含 javaMapByState 分派）`);
}

// ────────── main ──────────
console.log('=== 活塞建模（全 16x16 贴图）===');
buildTextures();
registerTextures();

writeJson(path.join(RP, 'models/blocks/lit_piston.json'), collapsedGeometry());
writeJson(path.join(RP, 'models/blocks/lit_piston_extended.json'), extendedGeometry());
writeJson(path.join(RP, 'models/blocks/lit_piston_head.json'), headGeometry());

writeJson(path.join(BP, 'g_piston_side.json'), baseBlock('lit:g_piston_side', 'ghost_piston_top_normal', 'geometry.lit_piston'));
writeJson(path.join(BP, 'g_piston_side_extended.json'), baseBlock('lit:g_piston_side_extended', 'ghost_piston_top_normal', 'geometry.lit_piston_extended'));
writeJson(path.join(BP, 'g_sticky_piston.json'), baseBlock('lit:g_sticky_piston', 'ghost_piston_top_sticky', 'geometry.lit_piston'));
writeJson(path.join(BP, 'g_sticky_piston_extended.json'), baseBlock('lit:g_sticky_piston_extended', 'ghost_piston_top_sticky', 'geometry.lit_piston_extended'));
writeJson(path.join(BP, 'g_piston_head.json'), headBlock('lit:g_piston_head', false));
writeJson(path.join(BP, 'g_sticky_piston_head.json'), headBlock('lit:g_sticky_piston_head', true));

updateIndex();
console.log('完成。');
