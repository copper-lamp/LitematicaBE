#!/usr/bin/env node
/**
 * gen_slab_ghost.js — 半砖类方块（slab / daylight_detector）投影建模 + 贴图修复
 *
 * 问题：`block_shape_map.json` 里 shape=slab 的 103 个方块、shape=daylight_detector 的 2 个方块，
 *   在 ghost_index 里全部落到 `minecraft:geometry.full_block` + 单一 side/top 贴图 ——
 *   投影里半砖显示成整块，且顶面用的是侧面图（石英台阶顶面有纹、平滑石英三面同色都看不出来）。
 *   另有 70 个 slab 连 javaMap 都没有，直接兜底 generic。
 *
 * 修复（全部按原版几何数据 + 原版面贴图）：
 *   1. 几何：`geometry.lit_slab`（下半 16×8×16）、`geometry.lit_slab_top`（上半 16×8×16）、
 *      `geometry.lit_daylight_detector`（16×6×16）。
 *   2. 贴图：每方块解析 侧/顶/底 三张（原版与 Java 一致：石英=side/top/bottom、
 *      砂岩=side/top/bottom、石头半砖=stone_slab_side/stone_slab_top）。缺的原版 png
 *      从 bedrock-samples 拷到 ghost 目录并注册 terrain_texture。
 *   3. 每方块生成 bottom / top / double 三个 ghost 块（double 用 full_block 几何）——
 *      不靠 permutation 切 `minecraft:geometry`（BDS 实测切不动，见活塞的教训），
 *      身份由 identifier 承载，状态由 javaMapByState 分派。
 *
 * 用法：node work/gen_slab_ghost.js            # 生效（写 resources/addon + ghost_index）
 *       node work/gen_slab_ghost.js --dry      # 只打印计划
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MODEL_DIR = 'C:/Users/25491/Desktop/建模对应清单';
const VAN_DIR = 'C:/Users/25491/Desktop/建模贴图/resource/bedrock-samples-v1.26.60.5-full/resource_pack/textures/blocks';
const GHOST_DIR = path.join(ROOT, 'resources/addon/LitematicaBE_RP/textures/blocks/ghost');
const RP_MODELS = path.join(ROOT, 'resources/addon/LitematicaBE_RP/models/blocks');
const BP_BLOCKS = path.join(ROOT, 'resources/addon/LitematicaBE_BP/blocks');
const TERRAIN = path.join(ROOT, 'resources/addon/LitematicaBE_RP/textures/terrain_texture.json');
const IDX = path.join(ROOT, 'resources/data/ghost_index.json');

const DRY = process.argv.includes('--dry');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, o) => {
    if (DRY) { console.log('  would write', path.relative(ROOT, p).replace(/\\/g, '/')); return; }
    fs.writeFileSync(p, JSON.stringify(o, null, 2));
};

/** 面贴图覆盖表（值为原版/ghost 的贴图基础名） */
const TEX_OVERRIDE = {
    stone_slab: { side: 'stone_slab_side', top: 'stone_slab_top', bottom: 'stone_slab_top' },
    normal_stone_slab: { side: 'stone_slab_side', top: 'stone_slab_top', bottom: 'stone_slab_top' },
    smooth_stone_slab: { side: 'stone_slab_side', top: 'stone_slab_top', bottom: 'stone_slab_top' },
    quartz_slab: { side: 'quartz_block_side', top: 'quartz_block_top', bottom: 'quartz_block_bottom' },
    smooth_quartz_slab: { side: 'quartz_block_bottom', top: 'quartz_block_bottom', bottom: 'quartz_block_bottom' },
    sandstone_slab: { side: 'sandstone', top: 'sandstone_top', bottom: 'sandstone_bottom' },
    cut_sandstone_slab: { side: 'cut_sandstone', top: 'sandstone_top', bottom: 'sandstone_bottom' },
    smooth_sandstone_slab: { side: 'sandstone_smooth', top: 'sandstone_smooth', bottom: 'sandstone_smooth' },
    red_sandstone_slab: { side: 'red_sandstone', top: 'red_sandstone_top', bottom: 'red_sandstone_bottom' },
    cut_red_sandstone_slab: { side: 'cut_red_sandstone', top: 'red_sandstone_top', bottom: 'red_sandstone_bottom' },
    smooth_red_sandstone_slab: { side: 'red_sandstone_smooth', top: 'red_sandstone_smooth', bottom: 'red_sandstone_smooth' },
    blackstone_slab: { side: 'blackstone', top: 'blackstone_top', bottom: 'blackstone_top' },
    polished_blackstone_slab: { side: 'polished_blackstone', top: 'polished_blackstone', bottom: 'polished_blackstone' },
    wooden_slab: { side: 'oak_planks', top: 'oak_planks', bottom: 'oak_planks' },
    petrified_oak_slab: { side: 'oak_planks', top: 'oak_planks', bottom: 'oak_planks' },
    pale_oak_slab: { side: 'pale_oak_planks', top: 'pale_oak_planks', bottom: 'pale_oak_planks' },
    poplar_slab: { side: 'poplar_planks', top: 'poplar_planks', bottom: 'poplar_planks' },
    mossy_stone_brick_slab: { side: 'mossy_stone_bricks', top: 'mossy_stone_bricks', bottom: 'mossy_stone_bricks' },
    mossy_cobblestone_slab: { side: 'mossy_cobblestone', top: 'mossy_cobblestone', bottom: 'mossy_cobblestone' },
    end_stone_brick_slab: { side: 'end_stone_bricks', top: 'end_stone_bricks', bottom: 'end_stone_bricks' },
    red_nether_brick_slab: { side: 'red_nether_bricks', top: 'red_nether_bricks', bottom: 'red_nether_bricks' },
    cinnabar_brick_slab: { side: 'cinnabar_bricks', top: 'cinnabar_bricks', bottom: 'cinnabar_bricks' },
    sulfur_brick_slab: { side: 'sulfur_bricks', top: 'sulfur_bricks', bottom: 'sulfur_bricks' },
    resin_brick_slab: { side: 'resin_bricks', top: 'resin_bricks', bottom: 'resin_bricks' },
    bamboo_mosaic_slab: { side: 'bamboo_mosaic', top: 'bamboo_mosaic', bottom: 'bamboo_mosaic' },
    waxed_cut_copper_slab: { side: 'cut_copper', top: 'cut_copper', bottom: 'cut_copper' },
    waxed_exposed_cut_copper_slab: { side: 'exposed_cut_copper', top: 'exposed_cut_copper', bottom: 'exposed_cut_copper' },
    waxed_weathered_cut_copper_slab: { side: 'weathered_cut_copper', top: 'weathered_cut_copper', bottom: 'weathered_cut_copper' },
    waxed_oxidized_cut_copper_slab: { side: 'oxidized_cut_copper', top: 'oxidized_cut_copper', bottom: 'oxidized_cut_copper' },
    daylight_detector: { side: 'daylight_detector_side', top: 'daylight_detector_top', bottom: 'daylight_detector_side' },
    daylight_detector_inverted: { side: 'daylight_detector_side', top: 'daylight_detector_inverted_top', bottom: 'daylight_detector_side' },
};

// ── 几何 ────────────────────────────────────────────────────────────────
const FACES = ['north', 'south', 'east', 'west', 'up', 'down'];
const fullUv = () => {
    const o = {};
    for (const f of FACES) o[f] = { uv: [0, 0], uv_size: [16, 16] };
    return o;
};

/** 半格几何：origin 用中心坐标（X/Z 相对方块中心），Y 从底起算 */
function halfBlockGeo(identifier, origin, size) {
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
            bones: [{ name: 'body', pivot: [0, 0, 0], cubes: [{ origin, size, uv: fullUv() }] }],
        }],
    };
}

const GEOMETRIES = [
    ['lit_slab', halfBlockGeo('geometry.lit_slab', [-8, 0, -8], [16, 8, 16])],
    ['lit_slab_top', halfBlockGeo('geometry.lit_slab_top', [-8, 8, -8], [16, 8, 16])],
    ['lit_daylight_detector', halfBlockGeo('geometry.lit_daylight_detector', [-8, 0, -8], [16, 6, 16])],
];

// ── 贴图解析 ────────────────────────────────────────────────────────────
const ghostPngs = () => new Set(fs.readdirSync(GHOST_DIR).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)));
const vanPngs = new Set(fs.readdirSync(VAN_DIR).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)));

function makeProbe(ghostSet) {
    return (name) => {
        if (!name) return null;
        if (ghostSet.has(`ghost_${name}`)) return { name, src: 'ghost' };
        if (vanPngs.has(name)) return { name, src: 'vanilla' };
        return null;
    };
}

// ── BP 块 ──────────────────────────────────────────────────────────────
function blockDef(identifier, geometry, tex, renderMethod = 'alpha_test') {
    const inst = (t) => ({ texture: `ghost_${t}`, render_method: renderMethod, face_dimming: false, ambient_occlusion: false });
    return {
        format_version: '1.21.70',
        'minecraft:block': {
            description: { identifier, menu_category: { category: 'none' } },
            components: {
                'minecraft:geometry': geometry,
                'minecraft:material_instances': {
                    '*': inst(tex.side),
                    up: inst(tex.top),
                    down: inst(tex.bottom),
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

function main() {
    const bsm = readJson(path.join(MODEL_DIR, 'block_shape_map.json'));
    const idx = readJson(IDX);
    const ghostSet = ghostPngs();
    const probe = makeProbe(ghostSet);

    /** 双半砖方块名 → 它对应的半砖名（供 javaMap 反查）
     *  oak_double_slab → oak_slab；double_stone_slab → stone_slab；
     *  waxed_double_cut_copper_slab → waxed_cut_copper_slab */
    function slabNameOfDouble(d) {
        if (d.startsWith('double_')) return d.slice('double_'.length);
        if (d.includes('_double_')) return d.replace('_double_', '_');
        return d.replace(/_double_slab$/, '_slab');
    }
    const doubleToSlab = new Map();
    for (const [n, shape] of Object.entries(bsm)) {
        if (shape !== 'double_slab') continue;
        doubleToSlab.set(slabNameOfDouble(n), n);
    }

    const anchor = (block) => {
        const gid = idx.javaMap[`minecraft:${block}`];
        const meta = gid && idx.blocks[gid];
        return meta && meta.texture ? meta.texture : null;
    };
    const stripSuffix = (t) => t.replace(/_(side|top|bottom|normal|smooth)$/, '');

    function resolveTex(block) {
        const ov = TEX_OVERRIDE[block];
        if (ov) {
            return { side: probe(ov.side), top: probe(ov.top), bottom: probe(ov.bottom) };
        }
        const anc = anchor(block);
        const stem = stripSuffix(anc || block.replace(/_slab$/, ''));
        const sideCand = anc ? [anc] : [`${stem}_side`, stem];
        const topCand = [`${stem}_top`, ...sideCand];
        const botCand = [`${stem}_bottom`, `${stem}_top`, ...sideCand];
        const pick = (list) => { for (const c of list) { const p = probe(c); if (p) return p; } return null; };
        return { side: pick(sideCand), top: pick(topCand), bottom: pick(botCand) };
    }

    // 1) 补拷缺失的原版贴图 + 注册
    const needCopy = new Set();
    const texSetOf = {};
    const plan = [];
    for (const [block, shape] of Object.entries(bsm)) {
        if (shape !== 'slab' && shape !== 'daylight_detector') continue;
        const t = resolveTex(block);
        texSetOf[block] = {
            side: t.side ? t.side.name : null,
            top: t.top ? t.top.name : null,
            bottom: t.bottom ? t.bottom.name : null,
        };
        for (const p of [t.side, t.top, t.bottom]) {
            if (p && p.src === 'vanilla') needCopy.add(p.name);
        }
        plan.push({ block, shape, tex: texSetOf[block] });
    }

    console.log(`目标 ${plan.length} 个方块；需补拷原版贴图 ${needCopy.size} 张`);
    for (const n of [...needCopy].sort()) {
        const dst = path.join(GHOST_DIR, `ghost_${n}.png`);
        console.log(`  + ghost_${n}.png  (由原版 ${n}.png)`);
        if (!DRY) fs.copyFileSync(path.join(VAN_DIR, `${n}.png`), dst);
        ghostSet.add(`ghost_${n}`);
    }

    // terrain_texture 注册
    const tt = readJson(TERRAIN);
    let regNew = 0;
    for (const n of ghostSet) {
        // 只为本次用到的贴图注册（其余早已注册）
        if (!Object.keys(texSetOf).some((b) => Object.values(texSetOf[b]).includes(n.slice('ghost_'.length)))) continue;
        const short = n;
        if (tt.texture_data[short]) continue;
        tt.texture_data[short] = { textures: `textures/blocks/ghost/${short}` };
        regNew++;
    }
    if (regNew) {
        console.log(`  terrain_texture 新增 ${regNew} 项`);
        writeJson(TERRAIN, tt);
    }

    // 2) 几何
    for (const [name, geo] of GEOMETRIES) {
        writeJson(path.join(RP_MODELS, `${name}.json`), geo);
    }

    // 3) BP 块 + 索引
    const newBlocks = {};
    let bpCount = 0, idxCount = 0, stateCount = 0;
    const missing = [];
    for (const { block, shape, tex } of plan) {
        if (!tex.side || !tex.top || !tex.bottom) {
            missing.push(`${block}: ${JSON.stringify(tex)}`);
            continue;
        }
        const t = { side: tex.side, top: tex.top, bottom: tex.bottom };
        const baseId = `lit:g_${block}`;
        if (shape === 'daylight_detector') {
            const geo = 'geometry.lit_daylight_detector';
            writeJson(path.join(BP_BLOCKS, `g_${block}.json`), blockDef(baseId, geo, t));
            newBlocks[baseId] = { texture: t.side, geometry: 'daylight_detector' };
            idx.javaMap[`minecraft:${block}`] = baseId;
            // Java 侧反相探测器是同一方块 + inverted 状态；BE 侧是独立方块名 daylight_detector_inverted
            if (block === 'daylight_detector') {
                idx.javaMapByState['minecraft:daylight_detector'] = {
                    inverted: { '0': 'lit:g_daylight_detector', '1': 'lit:g_daylight_detector_inverted' },
                };
            }
            bpCount++; idxCount++;
            continue;
        }

        const idTop = `${baseId}_top`;
        const idDouble = `${baseId}_double`;
        writeJson(path.join(BP_BLOCKS, `g_${block}.json`), blockDef(baseId, 'geometry.lit_slab', t));
        writeJson(path.join(BP_BLOCKS, `g_${block}_top.json`), blockDef(idTop, 'geometry.lit_slab_top', t));
        writeJson(path.join(BP_BLOCKS, `g_${block}_double.json`), blockDef(idDouble, 'minecraft:geometry.full_block', t));
        newBlocks[baseId] = { texture: t.side, geometry: 'slab' };
        newBlocks[idTop] = { texture: t.side, geometry: 'slab_top' };
        newBlocks[idDouble] = { texture: t.side, geometry: 'double_slab' };

        // 状态分派：Java 侧 type=bottom/top/double；BE 侧 vertical_half=bottom/top
        // 注意：层内不写 _default —— 否则先遍历到的层会用默认值短路，另一套状态键永远不生效
        idx.javaMapByState[`minecraft:${block}`] = {
            type: { bottom: baseId, top: idTop, double: idDouble },
            vertical_half: { bottom: baseId, top: idTop },
        };
        // 万一状态全丢（MEGA 分块重载），兜底给下半砖
        idx.javaMap[`minecraft:${block}`] = baseId;

        // BE 双半砖是独立方块名：x_double_slab / double_x_slab / waxed_double_cut_copper_slab 三种排法
        const dblBlock = doubleToSlab.get(block);
        if (dblBlock) idx.javaMap[`minecraft:${dblBlock}`] = idDouble;

        bpCount += 3; idxCount += 3; stateCount++;
    }

    console.log(`生成 BP ${bpCount} 个 / 索引 blocks +${idxCount} / 状态分派 ${stateCount} 个`);
    if (missing.length) {
        console.error('贴图缺失，未处理:\n  ' + missing.join('\n  '));
        process.exitCode = 1;
    }

    Object.assign(idx.blocks, newBlocks);
    // javaMapStats 同步
    const vals = Object.values(idx.javaMap);
    const genericId = idx.genericId || 'lit:g_generic';
    const generic = vals.filter((v) => v === genericId).length;
    idx.javaMapStats = { total: vals.length, mapped: vals.length - generic, generic };
    writeJson(IDX, idx);

    console.log(`ghost_index: blocks ${Object.keys(idx.blocks).length}，javaMap ${vals.length}，javaMapByState ${Object.keys(idx.javaMapByState).length}`);
    if (DRY) console.log('（--dry：未写任何文件）');
}

main();
