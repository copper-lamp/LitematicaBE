#!/usr/bin/env node
/**
 * gen_stateful_ghost.js — 把「有多种形态」的方块改成 identifier 分派（与半砖同一套逻辑）
 *
 * 覆盖面：stairs（上/下）、trapdoor（关-半砖在下 / 关-半砖在上 / 开）、
 *         door（下段/上段 × 关/开）
 *
 * 为什么要改：
 *   这三族原来都把「形状」写成 permutation 切 `minecraft:geometry`。BDS 上这条路径
 *   实测不生效（活塞当初就栽在这，模型首次注册即固定），表现是：
 *     - 倒置楼梯永远正放、贴图正确但形态不变；
 *     - 活板门打开后仍是平盖（永远停在关闭几何）、下半/上半也不分；
 *     - 门打开后仍是平面板；上半门还共用下半的贴图（door_*_lower）。
 *   半砖那批已经把结论落成做法：**形状由 identifier 承载，facing 才用 permutation
 *   的 `minecraft:transformation`**（楼梯的朝向旋转一直靠它，实机可用）。
 *
 * 用法：node work/gen_stateful_ghost.js --dry   # 只看计划
 *       node work/gen_stateful_ghost.js         # 写入 resources/addon + ghost_index
 */
const fs = require('fs');
const path = require('path');
const png = require('../tools/lib/png.js');

const ROOT = path.resolve(__dirname, '..');
const MODEL_DIR = 'C:/Users/25491/Desktop/建模对应清单';
const VAN_DIR = 'C:/Users/25491/Desktop/建模贴图/resource/bedrock-samples-v1.26.60.5-full/resource_pack/textures/blocks';
const GHOST_DIR = path.join(ROOT, 'resources/addon/LitematicaBE_RP/textures/blocks/ghost');
const BP_BLOCKS = path.join(ROOT, 'resources/addon/LitematicaBE_BP/blocks');
const TERRAIN = path.join(ROOT, 'resources/addon/LitematicaBE_RP/textures/terrain_texture.json');
const IDX = path.join(ROOT, 'resources/data/ghost_index.json');

const DRY = process.argv.includes('--dry');
const GHOST_ALPHA_FACTOR = 0.80;   // 与 tools/build-release.mjs 的 blend 上限（alpha 均值 < 245）对齐

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, o) => {
    if (DRY) { console.log('  would write', path.relative(ROOT, p).replace(/\\/g, '/')); return; }
    fs.writeFileSync(p, JSON.stringify(o, null, 2));
};

// ── 旋转表：全部照抄现有 BP 里已在用的值，避免改变已工作的朝向语义 ──────────
const STAIRS_ROT = { 0: [0, 180, 0], 1: [0, 0, 0], 2: [0, 270, 0], 3: [0, 90, 0] };
const TRAPDOOR_OPEN_ROT = { 0: [0, 180, 0], 1: [0, -90, 0], 2: [0, 0, 0], 3: [0, 90, 0] };
const DOOR_CLOSE_ROT = { 0: [0, 90, 0], 1: [0, 180, 0], 2: [0, -90, 0], 3: [0, 0, 0] };
const DOOR_OPEN_ROT = {
    0: { 0: [0, 90, 0], 1: [0, -90, 0] },
    1: { 0: [0, 0, 0], 1: [0, 180, 0] },
    2: { 0: [0, -90, 0], 1: [0, 90, 0] },
    3: { 0: [0, 180, 0], 1: [0, 0, 0] },
};

const trans = (rotation, translation = [0, 0, 0]) => ({ rotation, scale: [1, 1, 1], translation });

// ── 贴图 ────────────────────────────────────────────────────────────────
const ghostPngs = () => new Set(fs.readdirSync(GHOST_DIR).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)));
const vanPngs = new Set(fs.readdirSync(VAN_DIR).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)));
const ghostSet = ghostPngs();
let terrain = readJson(TERRAIN);

/** 确保 ghost_<name>.png 存在：ghost 里没有就从原版拷入并做半透明调制（blend 要求 alpha 均值 < 245） */
function ensureGhostTex(name) {
    const key = `ghost_${name}`;
    if (!ghostSet.has(key)) {
        const src = path.join(VAN_DIR, `${name}.png`);
        if (!fs.existsSync(src)) return false;
        const dst = path.join(GHOST_DIR, `${key}.png`);
        if (!DRY) {
            const img = png.modulateAlpha(png.decode(fs.readFileSync(src)), GHOST_ALPHA_FACTOR);
            fs.writeFileSync(dst, png.encode(img));
        }
        ghostSet.add(key);
        console.log(`  + ${key}.png（由原版 ${name}.png，alpha×${GHOST_ALPHA_FACTOR}）`);
    }
    if (!terrain.texture_data[key]) {
        terrain.texture_data[key] = { textures: `textures/blocks/ghost/${key}` };
        terrainDirty = true;
    }
    return true;
}
let terrainDirty = false;

// ── 贴图解析表 ──────────────────────────────────────────────────────────
const STAIRS_TEX_SPECIAL = {
    end_brick_stairs: 'end_stone_bricks',
    waxed_cut_copper_stairs: 'cut_copper',
    waxed_exposed_cut_copper_stairs: 'exposed_cut_copper',
    waxed_weathered_cut_copper_stairs: 'weathered_cut_copper',
    waxed_oxidized_cut_copper_stairs: 'oxidized_cut_copper',
    normal_stone_stairs: 'stone',
    smooth_stone_stairs: 'stone',
    stone_stairs: 'stone',
    wooden_stairs: 'oak_planks',
    petrified_oak_stairs: 'oak_planks',
    smooth_quartz_stairs: 'quartz_block_bottom',
    quartz_stairs: 'quartz_block_side',
    sandstone_stairs: 'sandstone',
    cut_sandstone_stairs: 'cut_sandstone',
    smooth_sandstone_stairs: 'sandstone_smooth',
    red_sandstone_stairs: 'red_sandstone',
    cut_red_sandstone_stairs: 'cut_red_sandstone',
    smooth_red_sandstone_stairs: 'red_sandstone_smooth',
    blackstone_stairs: 'blackstone',
    bamboo_mosaic_stairs: 'bamboo_mosaic',
    mossy_stone_brick_stairs: 'mossy_stone_bricks',
    mossy_cobblestone_stairs: 'mossy_cobblestone',
    cinnabar_brick_stairs: 'cinnabar_bricks',
    sulfur_brick_stairs: 'sulfur_bricks',
    resin_brick_stairs: 'resin_bricks',
    red_nether_brick_stairs: 'red_nether_bricks',
    mud_brick_stairs: 'mud_bricks',
    pale_oak_stairs: 'pale_oak_planks',
    poplar_stairs: 'poplar_planks',
};

const TRAPDOOR_TEX_SPECIAL = {
    waxed_copper_trapdoor: 'copper_trapdoor',
    waxed_exposed_copper_trapdoor: 'exposed_copper_trapdoor',
    waxed_weathered_copper_trapdoor: 'weathered_copper_trapdoor',
    waxed_oxidized_copper_trapdoor: 'oxidized_copper_trapdoor',
};

/** door 的上下两段贴图（原版 BE 命名不统一：老式 door_<wood>_lower/upper、
 *  新式 <wood>_door_bottom/top、铜系 <state>_copper_door_bottom/top）。
 *  crimson/warped 在这个版本的 samples 里没有门贴图 → 用橡木门近似并标注。 */
const DOOR_TEX = {
    acacia_door: ['door_acacia_lower', 'door_acacia_upper'],
    bamboo_door: ['bamboo_door_bottom', 'bamboo_door_upper'],
    birch_door: ['door_birch_lower', 'door_birch_upper'],
    cherry_door: ['cherry_door_bottom', 'cherry_door_upper'],
    copper_door: ['copper_door_bottom', 'copper_door_upper'],
    crimson_door: ['door_wood_lower', 'door_wood_upper'],
    dark_oak_door: ['door_dark_oak_lower', 'door_dark_oak_upper'],
    exposed_copper_door: ['exposed_copper_door_bottom', 'exposed_copper_door_top'],
    iron_door: ['door_iron_lower', 'door_iron_upper'],
    jungle_door: ['door_jungle_lower', 'door_jungle_upper'],
    mangrove_door: ['mangrove_door_bottom', 'mangrove_door_top'],
    oxidized_copper_door: ['oxidized_copper_door_bottom', 'oxidized_copper_door_top'],
    pale_oak_door: ['pale_oak_door_bottom', 'pale_oak_door_top'],
    poplar_door: ['poplar_door_bottom', 'poplar_door_top'],
    spruce_door: ['door_spruce_lower', 'door_spruce_upper'],
    warped_door: ['door_wood_lower', 'door_wood_upper'],
    waxed_copper_door: ['copper_door_bottom', 'copper_door_upper'],
    waxed_exposed_copper_door: ['exposed_copper_door_bottom', 'exposed_copper_door_top'],
    waxed_oxidized_copper_door: ['oxidized_copper_door_bottom', 'oxidized_copper_door_top'],
    waxed_weathered_copper_door: ['weathered_copper_door_bottom', 'weathered_copper_door_top'],
    weathered_copper_door: ['weathered_copper_door_bottom', 'weathered_copper_door_top'],
    wooden_door: ['door_oak_lower', 'door_oak_upper'],
};

// ── BP 构造 ─────────────────────────────────────────────────────────────
function blockDef(identifier, geometry, texture, renderMethod, states, permutations, baseTrans) {
    const block = {
        description: { identifier, menu_category: { category: 'none' }, ...(states ? { states } : {}) },
        components: {
            'minecraft:geometry': geometry,
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
        permutations: permutations || [],
    };
    if (baseTrans) block.components['minecraft:transformation'] = baseTrans;
    return { format_version: '1.21.70', 'minecraft:block': block };
}

const DIR_STATES = { 'lit:dir': { values: { min: 0, max: 3 } } };
const DIR_HINGE_STATES = { 'lit:dir': { values: { min: 0, max: 3 } }, 'lit:hinge': { values: [false, true] } };
const dirPerms = (rotTable) => [0, 1, 2, 3].map((d) => ({
    condition: `q.block_state('lit:dir') == ${d}`,
    components: { 'minecraft:transformation': trans(rotTable[d]) },
}));

/** 建模清单用的是基岩方块名，Java 侧另有叫法：橡木活板门/橡木门必须补别名，
 *  否则投影里最常见的 oak_trapdoor / oak_door 会落到兜底灰块。 */
const JAVA_ALIAS = {
    trapdoor: ['oak_trapdoor'],
    wooden_door: ['oak_door'],
};

// ── 主流程 ──────────────────────────────────────────────────────────────
function main() {
    const bsm = readJson(path.join(MODEL_DIR, 'block_shape_map.json'));
    const idx = readJson(IDX);
    const anchorTex = (b) => {
        const id = idx.javaMap[`minecraft:${b}`];
        const m = id && idx.blocks[id];
        return m ? m.texture : null;
    };
    /** 解析石头/木头类的侧面贴图：锚点 > 特例表 > 名字规则 */
    const resolveSide = (block, suffix, special) => {
        const short = block;
        if (special[short]) {
            // 特例也要走 ensureGhostTex：waxed_* 铜类是"借用"未打蜡那套贴图，
            // 不在这里拷入/注册就会引用到不存在的 terrain key（build 自检才报）。
            return ensureGhostTex(special[short]) ? special[short] : null;
        }
        // 旧映射的贴图不一定对（历史上有活板门记成木板图的），活板门只认 *_trapdoor 锚点
        const anc = anchorTex(block);
        const ancOk = anc && !(suffix === 'trapdoor' && !/_trapdoor$/.test(anc)) && ensureGhostTex(anc);
        if (ancOk) return anc;
        const stem = short.replace(new RegExp(`_${suffix}$`), '');
        // 活板门用 <wood>_trapdoor 这套贴图，不能落到木板上（会把不透明的木板图贴到
        // 半透明 blend 材质上，build 的 alpha 自检直接拦）
        const cands = suffix === 'trapdoor'
            ? [`${stem}_trapdoor`, stem, `${stem}_planks`]
            : [stem, `${stem}_planks`, `${stem}_block`, `${stem}s`];
        for (const c of cands) {
            if (ensureGhostTex(c)) return c;
        }
        return null;
    };

    const report = { stairs: 0, trapdoor: 0, door: 0, miss: [] };

    // ── 楼梯：上/下两个 identifier，dir 用 transformation ──
    for (const [block, shape] of Object.entries(bsm)) {
        if (shape !== 'stairs') continue;
        const tex = resolveSide(block, 'stairs', STAIRS_TEX_SPECIAL);
        if (!tex) { report.miss.push(`stairs:${block}`); continue; }
        const base = `lit:g_${block}`;
        const upId = `${base}_up`;
        const mt = `ghost_${tex}`;
        writeJson(path.join(BP_BLOCKS, `${base.replace(/^lit:/, '')}.json`),
            blockDef(base, 'geometry.lit_stairs', mt, 'alpha_test', DIR_STATES, dirPerms(STAIRS_ROT), trans(STAIRS_ROT[0])));
        writeJson(path.join(BP_BLOCKS, `${upId.replace(/^lit:/, '')}.json`),
            blockDef(upId, 'geometry.lit_stairs_up', mt, 'alpha_test', DIR_STATES, dirPerms(STAIRS_ROT), trans(STAIRS_ROT[0])));

        const st = { 'lit:dir': { type: 'int', min: 0, max: 3, default: 0, from: 'weirdo_direction' } };
        idx.blocks[base] = { texture: tex, geometry: 'stairs', states: st };
        idx.blocks[upId] = { texture: tex, geometry: 'stairs_up', states: st };
        idx.javaMap[`minecraft:${block}`] = base;
        idx.javaMapByState[`minecraft:${block}`] = {
            upside_down_bit: { '0': base, '1': upId },
        };
        report.stairs++;
    }

    // ── 活板门：关-下半 / 关-上半 / 开（三态 identifier）──
    for (const [block, shape] of Object.entries(bsm)) {
        if (shape !== 'trapdoor') continue;
        const tex = resolveSide(block, 'trapdoor', TRAPDOOR_TEX_SPECIAL);
        if (!tex) { report.miss.push(`trapdoor:${block}`); continue; }
        const base = `lit:g_${block}`;
        const topId = `${base}_top`;
        const openId = `${base}_open`;
        const mt = `ghost_${tex}`;
        // half=bottom：板在方块顶部（几何 lit_trapdoor 本身在 y13）
        writeJson(path.join(BP_BLOCKS, `${base.replace(/^lit:/, '')}.json`),
            blockDef(base, 'geometry.lit_trapdoor', mt, 'blend', null, [], trans([0, 0, 0])));
        // half=top：板在底部，整体下移 13/16
        writeJson(path.join(BP_BLOCKS, `${topId.replace(/^lit:/, '')}.json`),
            blockDef(topId, 'geometry.lit_trapdoor', mt, 'blend', null, [], trans([0, 0, 0], [0, -0.8125, 0])));
        // 打开：竖直板，按 dir 旋转
        writeJson(path.join(BP_BLOCKS, `${openId.replace(/^lit:/, '')}.json`),
            blockDef(openId, 'geometry.lit_trapdoor_open', mt, 'blend', DIR_STATES,
                dirPerms(TRAPDOOR_OPEN_ROT), trans(TRAPDOOR_OPEN_ROT[0])));

        idx.blocks[base] = { texture: tex, geometry: 'trapdoor' };
        idx.blocks[topId] = { texture: tex, geometry: 'trapdoor_top' };
        idx.blocks[openId] = {
            texture: tex,
            geometry: 'trapdoor_open',
            states: { 'lit:dir': { type: 'int', min: 0, max: 3, default: 0, from: 'direction' } },
        };
        idx.javaMap[`minecraft:${block}`] = base;
        idx.javaMapByState[`minecraft:${block}`] = {
            open_bit: {
                // 关闭：再按 upside_down_bit 分上/下
                '0': { upside_down_bit: { '0': base, '1': topId } },
                // 打开：上下半只影响铰链，几何/朝向由 dir 承载
                '1': openId,
            },
        };
        for (const alias of (JAVA_ALIAS[block] || [])) {
            idx.javaMap[`minecraft:${alias}`] = base;
            idx.javaMapByState[`minecraft:${alias}`] = idx.javaMapByState[`minecraft:${block}`];
        }
        report.trapdoor++;
    }

    // ── 门：下段/上段（贴图不同）× 关/开（几何不同）──
    for (const [block, shape] of Object.entries(bsm)) {
        if (shape !== 'door') continue;
        const pair = DOOR_TEX[block];
        if (!pair) { report.miss.push(`door:${block}`); continue; }
        const [lo, up] = pair;
        if (!ensureGhostTex(lo) || !ensureGhostTex(up)) { report.miss.push(`door-tex:${block}`); continue; }
        const base = `lit:g_${block}`;
        const upperClose = `${base}_upper`;
        const lowerOpen = `${base}_open`;
        const upperOpen = `${base}_open_upper`;

        writeJson(path.join(BP_BLOCKS, `${base.replace(/^lit:/, '')}.json`),
            blockDef(base, 'geometry.lit_door', `ghost_${lo}`, 'blend', DIR_STATES, dirPerms(DOOR_CLOSE_ROT), trans(DOOR_CLOSE_ROT[0])));
        writeJson(path.join(BP_BLOCKS, `${upperClose.replace(/^lit:/, '')}.json`),
            blockDef(upperClose, 'geometry.lit_door', `ghost_${up}`, 'blend', DIR_STATES, dirPerms(DOOR_CLOSE_ROT), trans(DOOR_CLOSE_ROT[0])));

        const openPerms = [];
        for (const d of [0, 1, 2, 3]) {
            for (const h of [0, 1]) {
                openPerms.push({
                    condition: `q.block_state('lit:dir') == ${d} && q.block_state('lit:hinge') == ${h === 1}`,
                    components: { 'minecraft:transformation': trans(DOOR_OPEN_ROT[d][h]) },
                });
            }
        }
        writeJson(path.join(BP_BLOCKS, `${lowerOpen.replace(/^lit:/, '')}.json`),
            blockDef(lowerOpen, 'geometry.lit_door_open', `ghost_${lo}`, 'blend', DIR_HINGE_STATES, openPerms, trans(DOOR_OPEN_ROT[0][0])));
        writeJson(path.join(BP_BLOCKS, `${upperOpen.replace(/^lit:/, '')}.json`),
            blockDef(upperOpen, 'geometry.lit_door_open', `ghost_${up}`, 'blend', DIR_HINGE_STATES, openPerms, trans(DOOR_OPEN_ROT[0][0])));

        const closeStates = { 'lit:dir': { type: 'int', min: 0, max: 3, default: 0, from: 'direction' } };
        const openStates = {
            'lit:dir': { type: 'int', min: 0, max: 3, default: 0, from: 'direction' },
            'lit:hinge': { type: 'bool', default: false, from: 'door_hinge_bit' },
        };
        idx.blocks[base] = { texture: lo, geometry: 'door', states: closeStates };
        idx.blocks[upperClose] = { texture: up, geometry: 'door_upper', states: closeStates };
        idx.blocks[lowerOpen] = { texture: lo, geometry: 'door_open', states: openStates };
        idx.blocks[upperOpen] = { texture: up, geometry: 'door_open_upper', states: openStates };
        idx.javaMap[`minecraft:${block}`] = base;
        idx.javaMapByState[`minecraft:${block}`] = {
            open_bit: {
                '0': { upper_block_bit: { '0': base, '1': upperClose } },
                '1': { upper_block_bit: { '0': lowerOpen, '1': upperOpen } },
            },
        };
        for (const alias of (JAVA_ALIAS[block] || [])) {
            idx.javaMap[`minecraft:${alias}`] = base;
            idx.javaMapByState[`minecraft:${alias}`] = idx.javaMapByState[`minecraft:${block}`];
        }
        report.door++;
    }

    if (terrainDirty) writeJson(TERRAIN, terrain);
    writeJson(IDX, idx);

    console.log(`\n楼梯 ${report.stairs} / 活板门 ${report.trapdoor} / 门 ${report.door}；生成 BP ${report.stairs * 2 + report.trapdoor * 3 + report.door * 4} 个`);
    console.log(`ghost_index：blocks ${Object.keys(idx.blocks).length}，javaMap ${Object.keys(idx.javaMap).length}，javaMapByState ${Object.keys(idx.javaMapByState).length}`);
    if (report.miss.length) {
        console.error('贴图/数据缺失：\n  ' + report.miss.join('\n  '));
        process.exitCode = 1;
    }
    if (DRY) console.log('（--dry：未写任何文件）');
}

main();
