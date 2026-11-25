#!/usr/bin/env node
/**
 * gen_cross_ghost.js — 补齐 `cross_texture` 类方块的建模（交叉板）与贴图
 *
 * 背景：`建模对应清单/block_shape_map.json` 里 shape=cross_texture 的方块共 66 个，
 * 上一批只接了 50 个；剩下 16 个（仙人掌花、洞穴藤蔓带浆果、眼眸花、诡异/绯红菌与根、
 * 金蒲公英、地狱芽、苍白垂苔、苍白/杨树苗、甘蔗、蛛网）仍在兜底灰块。
 * 另外 3 个名字走的是基岩名（`web` / `reeds` / `cave_vines_plant`），它们的 Java 名
 * （cobweb / sugar_cane）在 javaMap 里还指向旧的 full_block 几何 —— 一并纠正。
 *
 * 几何统一用 `geometry.lit_cross`（与清单 `shape_models.cross_texture` 一致：两片
 * 16×16×0 板、rot ±45、pivot 在方块中心）。
 *
 * 用法：node work/gen_cross_ghost.js --dry | node work/gen_cross_ghost.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MODEL_DIR = 'C:/Users/25491/Desktop/建模对应清单';
const VAN_DIR = 'C:/Users/25491/Desktop/建模贴图/resource/bedrock-samples-v1.26.60.5-full/resource_pack/textures/blocks';
const GHOST_DIR = path.join(ROOT, 'resources/addon/LitematicaBE_RP/textures/blocks/ghost');
const BP_BLOCKS = path.join(ROOT, 'resources/addon/LitematicaBE_BP/blocks');
const TERRAIN = path.join(ROOT, 'resources/addon/LitematicaBE_RP/textures/terrain_texture.json');
const IDX = path.join(ROOT, 'resources/data/ghost_index.json');

const DRY = process.argv.includes('--dry');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, o) => {
    if (DRY) { console.log('  would write', path.relative(ROOT, p).replace(/\\/g, '/')); return; }
    fs.writeFileSync(p, JSON.stringify(o, null, 2));
};

const ghostPngs = new Set(fs.readdirSync(GHOST_DIR).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)));
const vanPngs = new Set(fs.readdirSync(VAN_DIR).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)));
let terrain = readJson(TERRAIN);
let terrainDirty = false;

/** 补拷原版贴图（保守：不做 alpha 调制，植物用 alpha_test，硬边就是原样） */
function ensureTex(name) {
    if (!name) return false;
    const key = `ghost_${name}`;
    if (!ghostPngs.has(key)) {
        const src = path.join(VAN_DIR, `${name}.png`);
        if (!fs.existsSync(src)) return false;
        if (!DRY) fs.copyFileSync(src, path.join(GHOST_DIR, `${key}.png`));
        ghostPngs.add(key);
        console.log(`  + ${key}.png（由原版 ${name}.png）`);
    }
    if (!terrain.texture_data[key]) {
        terrain.texture_data[key] = { textures: `textures/blocks/ghost/${key}` };
        terrainDirty = true;
    }
    return true;
}

/** 16 个此前没接的 cross 方块 → 贴图（原版样本里没有完全对应的，用最接近的那张） */
const TEX_MAP = {
    cactus_flower: 'cactus_flower',
    cave_vines_body_with_berries: 'cave_vines_body',
    cave_vines_head_with_berries: 'cave_vines_head',
    closed_eyeblossom: 'eyeblossom_dormant',        // 闭合态
    open_eyeblossom: 'eyeblossom_blooming',         // 绽放态
    crimson_fungus: 'crimson_fungus',
    crimson_roots: 'crimson_roots',
    golden_dandelion: 'golden_dandelion',
    nether_sprouts: 'nether_sprouts',
    pale_hanging_moss: 'pale_hanging_moss_middle',  // 垂挂主体（tip 是末端小片）
    pale_oak_sapling: 'pale_oak_sapling',
    poplar_sapling: 'poplar_sapling',
    reeds: 'sugar_cane',
    warped_fungus: 'warped_fungus',
    warped_roots: 'warped_roots',
    web: 'web',
};

/** 基岩名 ↔ Java 名（同一贴图，两个查找键都要能命中） */
const JAVA_ALIAS = {
    web: ['cobweb'],
    reeds: ['sugar_cane'],
};

function blockDef(identifier, texture) {
    return {
        format_version: '1.21.70',
        'minecraft:block': {
            description: { identifier, menu_category: { category: 'none' } },
            components: {
                'minecraft:geometry': 'geometry.lit_cross',
                'minecraft:material_instances': {
                    '*': { texture, render_method: 'alpha_test', face_dimming: false, ambient_occlusion: false },
                },
                'minecraft:collision_box': false,
                'minecraft:selection_box': false,
                'minecraft:destructible_by_mining': false,
                'minecraft:destructible_by_explosion': false,
                'minecraft:replaceable': {},
                'minecraft:light_dampening': 0,
                'minecraft:map_color': '#888888',
            },
            permutations: [],
        },
    };
}

function main() {
    const bsm = readJson(path.join(MODEL_DIR, 'block_shape_map.json'));
    const idx = readJson(IDX);

    const cross = Object.entries(bsm).filter(([, s]) => s === 'cross_texture').map(([k]) => k).sort();
    const report = { total: cross.length, added: 0, missing: [], skipped: [] };

    for (const block of cross) {
        const gid = `lit:g_${block}`;
        const prev = idx.javaMap[`minecraft:${block}`];
        // 已接且几何就是 cross → 跳过（幂等）
        if (prev && idx.blocks[prev] && idx.blocks[prev].geometry === 'cross') { report.skipped.push(block); continue; }

        const texName = TEX_MAP[block] || (prev && idx.blocks[prev] ? idx.blocks[prev].texture : null) || block;
        if (!ensureTex(texName)) { report.missing.push(`${block} -> ${texName}`); continue; }

        writeJson(path.join(BP_BLOCKS, `${gid.replace(/^lit:/, '')}.json`), blockDef(gid, `ghost_${texName}`));
        idx.blocks[gid] = { texture: texName, geometry: 'cross' };
        idx.javaMap[`minecraft:${block}`] = gid;
        for (const alias of (JAVA_ALIAS[block] || [])) {
            idx.javaMap[`minecraft:${alias}`] = gid;
        }
        report.added++;
    }

    // 旧映射指向 full_block 的（cobweb / sugar_cane / cave_vines_plant）由上面的别名改写；
    // 这里再兜一次：凡是 javaMap 指向 full_block 的 cross 类方块，全部纠正到交叉板
    for (const block of cross) {
        const id = idx.javaMap[`minecraft:${block}`];
        if (id && idx.blocks[id] && idx.blocks[id].geometry !== 'cross') {
            idx.blocks[id] = { ...idx.blocks[id], geometry: 'cross' };
        }
    }

    // cave_vines 系列：Java 的 cave_vines / cave_vines_plant 与 BE 的 cave_vines /
    // cave_vines_body_with_berries / cave_vines_head_with_berries 不是一一对应（浆果是状态不是方块），
    // 所以不做别名覆盖，只保证两边都挂在交叉板上、各自保留自己的贴图。
    for (const [javaName, gid] of [['minecraft:cave_vines', 'lit:g_cave_vines'], ['minecraft:cave_vines_plant', 'lit:g_cave_vines_plant']]) {
        if (!idx.blocks[gid]) continue;
        const meta = idx.blocks[gid];
        const texKey = `ghost_${meta.texture}`;
        if (!terrain.texture_data[texKey]) {
            terrain.texture_data[texKey] = { textures: `textures/blocks/ghost/${texKey}` };
            terrainDirty = true;
        }
        // 必须重写 BP：旧文件里 geometry 还是 full_block（只改 index 会让 BP 与索引不一致）
        writeJson(path.join(BP_BLOCKS, `${gid.replace(/^lit:/, '')}.json`), blockDef(gid, texKey));
        idx.blocks[gid] = { ...meta, geometry: 'cross' };
        idx.javaMap[javaName] = gid;
    }

    if (terrainDirty) writeJson(TERRAIN, terrain);
    writeJson(IDX, idx);

    console.log(`\ncross 方块共 ${report.total}；本次新接 ${report.added}；已就绪 ${report.skipped.length}`);
    console.log(`ghost_index：blocks ${Object.keys(idx.blocks).length}，javaMap ${Object.keys(idx.javaMap).length}`);
    if (report.missing.length) {
        console.error('贴图缺失（保留原状）：\n  ' + report.missing.join('\n  '));
        process.exitCode = 1;
    }
    if (DRY) console.log('（--dry：未写任何文件）');
}

main();
