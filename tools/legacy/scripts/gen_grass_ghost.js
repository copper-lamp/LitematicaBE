#!/usr/bin/env node
/**
 * gen_grass_ghost.js — 草类建模修复 + 着色（cross 几何 + 染色贴图）
 *
 * 问题：
 *   1. `block_shape_map.json` 里 66 个 `cross_texture` 方块（草、蕨、花、树苗、蘑菇、珊瑚、紫水晶芽…）
 *      在 ghost_index 里**全是 `minecraft:geometry.full_block`** —— 投影里显示成整块立方体，
 *      而不是原版的两片 45° 交叉薄板。
 *   2. 草类贴图在 BE 资源包里是**灰白的**（客户端按生物群系 tint 染色），投影不染色就是灰白/发白。
 *      草方块（grass_block）六面还都用草顶那张灰图。
 *
 * 做法：
 *   - 新几何 `geometry.lit_cross`：两片 45°/-45° 交叉板（照 `shape_models.cross_texture`）。
 *   - 草类用染色贴图（`work/gen_grass_tex.py` 生成，`_tint` 后缀，乘法染色保留明暗）。
 *   - 草方块改按面材质：顶=染色草顶、侧=grass_block_side（已带土色）、底=泥土。
 *   - 双格植物（tall_grass / large_fern）按 `half` / `upper_block_bit` 分派上/下半 identifier。
 *
 * 用法：node work/gen_grass_ghost.js [--dry]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MODEL_DIR = 'C:/Users/25491/Desktop/建模对应清单';
const RP_MODELS = path.join(ROOT, 'resources/addon/LitematicaBE_RP/models/blocks');
const BP_BLOCKS = path.join(ROOT, 'resources/addon/LitematicaBE_BP/blocks');
const GHOST_DIR = path.join(ROOT, 'resources/addon/LitematicaBE_RP/textures/blocks/ghost');
const TERRAIN = path.join(ROOT, 'resources/addon/LitematicaBE_RP/textures/terrain_texture.json');
const IDX = path.join(ROOT, 'resources/data/ghost_index.json');

const DRY = process.argv.includes('--dry');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, o) => {
    if (DRY) { console.log('  would write', path.relative(ROOT, p).replace(/\\/g, '/')); return; }
    fs.writeFileSync(p, JSON.stringify(o, null, 2));
};

const ghostSet = () => new Set(fs.readdirSync(GHOST_DIR).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)));
let terrain = readJson(TERRAIN);
let terrainDirty = false;

function registerTex(short) {
    if (!terrain.texture_data[short]) {
        terrain.texture_data[short] = { textures: `textures/blocks/ghost/${short}` };
        terrainDirty = true;
    }
}

// ── 交叉板几何（照 shape_models.cross_texture：pos[0,0,8] size[16,16,0] rot ±45） ──
const FACES = ['north', 'south', 'east', 'west', 'up', 'down'];
const uv16 = () => {
    const o = {};
    for (const f of FACES) o[f] = { uv: [0, 0], uv_size: [16, 16] };
    return o;
};
const crossCube = (rot) => ({ origin: [-8, 0, 0], size: [16, 16, 0], uv: uv16(), rotation: [0, rot, 0], pivot: [0, 8, 0] });

function buildCrossGeo() {
    return {
        format_version: '1.19.0',
        'minecraft:geometry': [{
            description: {
                identifier: 'geometry.lit_cross',
                texture_width: 16,
                texture_height: 16,
                visible_bounds_width: 1,
                visible_bounds_height: 1,
                visible_bounds_offset: [0, 0, 0],
            },
            bones: [{ name: 'body', pivot: [0, 0, 0], cubes: [crossCube(45), crossCube(-45)] }],
        }],
    };
}

// ── BP ─────────────────────────────────────────────────────────────────
function crossBlock(identifier, texture, renderMethod = 'blend') {
    return {
        format_version: '1.21.70',
        'minecraft:block': {
            description: { identifier, menu_category: { category: 'none' } },
            components: {
                'minecraft:geometry': 'geometry.lit_cross',
                'minecraft:material_instances': {
                    '*': { texture, render_method: renderMethod, face_dimming: false, ambient_occlusion: false },
                },
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

/** 草方块：顶面染色的草顶、侧面"已带土色的侧面图"、底面泥土 —— 不再是六面同一张灰图 */
function grassBlockDef(identifier, topTex, sideTex, bottomTex) {
    const inst = (t) => ({ texture: t, render_method: 'alpha_test', face_dimming: false, ambient_occlusion: false });
    return {
        format_version: '1.21.70',
        'minecraft:block': {
            description: { identifier, menu_category: { category: 'none' } },
            components: {
                'minecraft:geometry': 'minecraft:geometry.full_block',
                'minecraft:material_instances': {
                    '*': inst(sideTex),
                    up: inst(topTex),
                    down: inst(bottomTex),
                },
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

/** 显式贴图覆盖：草类用染色图；干草/荧光灌木/枯木本身带色，直接用原图 */
const CROSS_TEX_OVERRIDE = {
    short_grass: 'ghost_short_grass_tint',
    fern: 'ghost_fern_tint',
    bush: 'ghost_bush_tint',
    deadbush: 'ghost_dead_bush',
    firefly_bush: 'ghost_firefly_bush',
    short_dry_grass: 'ghost_short_dry_grass',
    tall_dry_grass: 'ghost_tall_dry_grass',
};

/** 单格草/植物（贴图短名 → ghost id 后缀同方块名） */
const SINGLE_PLANTS = ['short_grass', 'fern', 'deadbush', 'bush', 'firefly_bush', 'short_dry_grass', 'tall_dry_grass'];

/** 双格植物：上下半各一个 identifier */
const DOUBLE_PLANTS = {
    tall_grass: { bottom: 'ghost_tall_grass_bottom_tint', top: 'ghost_tall_grass_top_tint' },
    large_fern: { bottom: 'ghost_large_fern_bottom_tint', top: 'ghost_large_fern_top_tint' },
};

/** Java 名与建模清单名的差异（清单用基岩名） */
const JAVA_ALIAS = {
    short_grass: ['grass'],       // Java 的草植物叫 grass
    bush: [],
};

function main() {
    const bsm = readJson(path.join(MODEL_DIR, 'block_shape_map.json'));
    const idx = readJson(IDX);
    const ghosts = ghostSet();

    writeJson(path.join(RP_MODELS, 'lit_cross.json'), buildCrossGeo());

    let n = 0;
    const missing = [];

    /** 把方块接到 cross 几何上（贴图沿用 index 现有短名，草类走覆盖表） */
    const applyCross = (blockName, forcedTex) => {
        const javaIds = [blockName, ...(JAVA_ALIAS[blockName] || [])];
        const oldId = idx.javaMap[`minecraft:${blockName}`];
        const oldMeta = oldId && idx.blocks[oldId];
        const short = forcedTex ? forcedTex.replace(/^ghost_/, '') : (oldMeta && oldMeta.texture);
        if (!short) return null;
        const texKey = `ghost_${short}`;
        if (!ghosts.has(texKey)) { missing.push(`${blockName}: ${texKey}.png 不存在`); return null; }
        registerTex(texKey);
        const id = oldId && oldId.startsWith('lit:g_') ? oldId : `lit:g_${blockName}`;
        writeJson(path.join(BP_BLOCKS, `${id.replace(/^lit:/, '')}.json`), crossBlock(id, texKey));
        idx.blocks[id] = { texture: short, geometry: 'cross' };
        for (const j of javaIds) idx.javaMap[`minecraft:${j}`] = id;
        n++;
        return id;
    };

    // ── 单格草/植物 ──
    for (const b of SINGLE_PLANTS) {
        applyCross(b, CROSS_TEX_OVERRIDE[b]);
    }

    // ── 双格植物：上下半 ──
    for (const [b, tex] of Object.entries(DOUBLE_PLANTS)) {
        const bottomId = `lit:g_${b}_bottom`;
        const topId = `lit:g_${b}_top`;
        const bShort = tex.bottom.replace(/^ghost_/, '');
        const tShort = tex.top.replace(/^ghost_/, '');
        for (const [id, short] of [[bottomId, bShort], [topId, tShort]]) {
            if (!ghosts.has(`ghost_${short}`)) { missing.push(`${b}: ghost_${short}.png 不存在`); continue; }
            registerTex(`ghost_${short}`);
            writeJson(path.join(BP_BLOCKS, `${id.replace(/^lit:/, '')}.json`), crossBlock(id, `ghost_${short}`));
            idx.blocks[id] = { texture: short, geometry: 'cross' };
        }
        idx.javaMap[`minecraft:${b}`] = bottomId;
        idx.javaMapByState[`minecraft:${b}`] = {
            // Java: half=lower/upper；BE 的 .mcstructure: upper_block_bit
            half: { lower: bottomId, upper: topId },
            upper_block_bit: { '0': bottomId, '1': topId },
        };
        n += 2;
    }

    // ── 草方块：顶/侧/底三张图 ──
    {
        const id = 'lit:g_grass_block';
        const topShort = 'grass_block_top_tint';
        const sideShort = 'grass_block_side';
        const botShort = 'dirt';
        for (const s of [topShort, sideShort, botShort]) {
            if (!ghosts.has(`ghost_${s}`)) missing.push(`grass_block: ghost_${s}.png 不存在`);
            registerTex(`ghost_${s}`);
        }
        writeJson(path.join(BP_BLOCKS, 'g_grass_block.json'),
            grassBlockDef(id, `ghost_${topShort}`, `ghost_${sideShort}`, `ghost_${botShort}`));
        idx.blocks[id] = { texture: topShort, geometry: 'full_block' };
        idx.javaMap['minecraft:grass_block'] = id;
        n++;
    }

    // ── 其余 cross_texture 方块：几何统一换成交叉板（贴图沿用） ──
    const handled = new Set([
        ...SINGLE_PLANTS, ...Object.keys(DOUBLE_PLANTS), 'grass_block',
    ]);
    let others = 0;
    for (const [b, shape] of Object.entries(bsm)) {
        if (shape !== 'cross_texture' || handled.has(b)) continue;
        // 只改已有映射的（没映射的先把贴图补上再说，不属于本轮）
        if (!idx.javaMap[`minecraft:${b}`]) continue;
        if (applyCross(b)) others++;
    }

    if (terrainDirty) writeJson(TERRAIN, terrain);
    writeJson(IDX, idx);

    console.log(`\n草/植物 ${SINGLE_PLANTS.length} 个单格 + ${Object.keys(DOUBLE_PLANTS).length} 个双格 + 草方块 1 个；其它 cross 方块 ${others} 个`);
    console.log(`写入 BP ${n + others} 个；ghost_index：blocks ${Object.keys(idx.blocks).length}，javaMap ${Object.keys(idx.javaMap).length}`);
    if (missing.length) {
        console.error('缺失：\n  ' + missing.join('\n  '));
        process.exitCode = 1;
    }
    if (DRY) console.log('（--dry：未写文件）');
}

main();
