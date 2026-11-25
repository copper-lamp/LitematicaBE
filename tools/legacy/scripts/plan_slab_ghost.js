#!/usr/bin/env node
/**
 * plan_slab_ghost.js — 生成「半砖类方块投影修复」的完整计划表（只读，不写项目文件）
 *
 * 目标：为 block_shape_map.json 中 shape ∈ {slab, daylight_detector} 的方块
 *   bottom / top / double 三态各准备：几何 + 按面贴图 + ghost 块 id + 状态分派，
 *   把当前「整块 full_block + 单张贴图」的错误表现换成真正的半格几何 + 正确的面贴图。
 *
 * 输出：work/slab_plan.json（计划）+ 控制台摘要
 */
const fs = require('fs');
const path = require('path');

const ROOT = 'D:/GitHub/LitematicaBE';
const MODEL_DIR = 'C:/Users/25491/Desktop/建模对应清单';
const VAN_DIR = 'C:/Users/25491/Desktop/建模贴图/resource/bedrock-samples-v1.26.60.5-full/resource_pack/textures/blocks';
const GHOST_DIR = path.join(ROOT, 'resources/addon/LitematicaBE_RP/textures/blocks/ghost');
const IDX = path.join(ROOT, 'resources/data/ghost_index.json');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const bsm = readJson(`${MODEL_DIR}/block_shape_map.json`);
const idx = readJson(IDX);

const ghostPngs = new Set(fs.readdirSync(GHOST_DIR).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)));
const vanPngs = new Set(fs.readdirSync(VAN_DIR).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)));

/** 显式贴图覆盖：方块名 -> { side, top, bottom }（值为原版/ghost 的贴图基础名，不含 ghost_ 前缀） */
const TEX_OVERRIDE = {
    // 石头系列：BE 原版半砖用的是专用 stone_slab_* 贴图
    stone_slab: { side: 'stone_slab_side', top: 'stone_slab_top', bottom: 'stone_slab_top' },
    normal_stone_slab: { side: 'stone_slab_side', top: 'stone_slab_top', bottom: 'stone_slab_top' },
    smooth_stone_slab: { side: 'stone_slab_side', top: 'stone_slab_top', bottom: 'stone_slab_top' },
    // 石英：侧面/顶/底三张不同；平滑石英三面同用光滑面
    quartz_slab: { side: 'quartz_block_side', top: 'quartz_block_top', bottom: 'quartz_block_bottom' },
    smooth_quartz_slab: { side: 'quartz_block_bottom', top: 'quartz_block_bottom', bottom: 'quartz_block_bottom' },
    // 砂岩：BE 贴图名与 Java 不同
    sandstone_slab: { side: 'sandstone', top: 'sandstone_top', bottom: 'sandstone_bottom' },
    cut_sandstone_slab: { side: 'cut_sandstone', top: 'sandstone_top', bottom: 'sandstone_bottom' },
    smooth_sandstone_slab: { side: 'sandstone_smooth', top: 'sandstone_smooth', bottom: 'sandstone_smooth' },
    red_sandstone_slab: { side: 'red_sandstone', top: 'red_sandstone_top', bottom: 'red_sandstone_bottom' },
    cut_red_sandstone_slab: { side: 'cut_red_sandstone', top: 'red_sandstone_top', bottom: 'red_sandstone_bottom' },
    smooth_red_sandstone_slab: { side: 'red_sandstone_smooth', top: 'red_sandstone_smooth', bottom: 'red_sandstone_smooth' },
    // 黑石：顶面专用
    blackstone_slab: { side: 'blackstone', top: 'blackstone_top', bottom: 'blackstone_top' },
    polished_blackstone_slab: { side: 'polished_blackstone', top: 'polished_blackstone', bottom: 'polished_blackstone' },
    // 映射缺失/贴图名不同的个案
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
    // 打蜡铜与其未打蜡同款共用贴图
    waxed_cut_copper_slab: { side: 'cut_copper', top: 'cut_copper', bottom: 'cut_copper' },
    waxed_exposed_cut_copper_slab: { side: 'exposed_cut_copper', top: 'exposed_cut_copper', bottom: 'exposed_cut_copper' },
    waxed_weathered_cut_copper_slab: { side: 'weathered_cut_copper', top: 'weathered_cut_copper', bottom: 'weathered_cut_copper' },
    waxed_oxidized_cut_copper_slab: { side: 'oxidized_cut_copper', top: 'oxidized_cut_copper', bottom: 'oxidized_cut_copper' },
    // 阳光传感器（对比：顶面为硅板、侧面为木框）
    daylight_detector: { side: 'daylight_detector_side', top: 'daylight_detector_top', bottom: 'daylight_detector_side' },
    daylight_detector_inverted: { side: 'daylight_detector_side', top: 'daylight_detector_inverted_top', bottom: 'daylight_detector_side' },
};

/** 从现有 javaMap 的 ghost 块取当前 texture 短名（作为锚点） */
function anchorTexture(block) {
    const gid = idx.javaMap[`minecraft:${block}`];
    const meta = gid && idx.blocks[gid];
    return meta && meta.texture ? meta.texture : null;
}

/** 探测贴图是否存在：返回 {name, src} 或 null */
function probe(name) {
    if (!name) return null;
    if (ghostPngs.has(`ghost_${name}`)) return { name, src: 'ghost' };
    if (vanPngs.has(name)) return { name, src: 'vanilla' };
    return null;
}

const stripSuffix = (t) => t.replace(/_(side|top|bottom|normal|smooth)$/, '');

function resolveTex(block, shape) {
    const ov = TEX_OVERRIDE[block];
    if (ov) {
        return { side: probe(ov.side), top: probe(ov.top), bottom: probe(ov.bottom), from: 'override' };
    }
    const anc = anchorTexture(block);
    const stemSource = anc || block.replace(/_slab$/, '');
    const stem = stripSuffix(stemSource);
    const sideCand = anc ? [anc] : [`${stem}_side`, stem];
    const topCand = [`${stem}_top`, ...sideCand];
    const botCand = [`${stem}_bottom`, `${stem}_top`, ...sideCand];
    const pick = (list) => { for (const c of list) { const p = probe(c); if (p) return p; } return null; };
    return { side: pick(sideCand), top: pick(topCand), bottom: pick(botCand), from: anc ? 'anchor' : 'stem' };
}

const targets = [];
const problems = [];
for (const [block, shape] of Object.entries(bsm)) {
    if (shape !== 'slab' && shape !== 'daylight_detector') continue;
    const t = resolveTex(block, shape);
    if (!t.side || !t.top || !t.bottom) {
        problems.push(`${block}: 贴图缺失 side=${t.side && t.side.name} top=${t.top && t.top.name} bottom=${t.bottom && t.bottom.name}`);
    }
    const ids = shape === 'daylight_detector'
        ? (block.endsWith('_inverted')
            ? { main: `lit:g_${block}` }
            : { main: `lit:g_${block}` })
        : { bottom: `lit:g_${block}`, top: `lit:g_${block}_top`, double: `lit:g_${block}_double` };
    targets.push({
        block,
        shape,
        prev: idx.javaMap[`minecraft:${block}`] || null,
        tex: { side: t.side && t.side.name, top: t.top && t.top.name, bottom: t.bottom && t.bottom.name },
        src: { side: t.side && t.side.src, top: t.top && t.top.src, bottom: t.bottom && t.bottom.src },
        from: t.from,
        ids,
    });
}

// id 冲突检查
const existingIds = new Set(Object.keys(idx.blocks));
const conflict = [];
for (const t of targets) {
    for (const id of Object.values(t.ids)) {
        if (existingIds.has(id)) conflict.push(`${id}（已被现有 ghost 占用）`);
    }
}

fs.writeFileSync(path.join(ROOT, 'work/slab_plan.json'), JSON.stringify({ targets, problems, conflict }, null, 2));

// —— 控制台摘要 ——
console.log(`目标方块 ${targets.length} 个（slab ${targets.filter((t) => t.shape === 'slab').length} / detector ${targets.filter((t) => t.shape === 'daylight_detector').length}）`);
const srcCount = {};
for (const t of targets) for (const k of ['side', 'top', 'bottom']) srcCount[t.src[k]] = (srcCount[t.src[k]] || 0) + 1;
console.log('贴图来源统计:', JSON.stringify(srcCount));
const needCopy = [...new Set(targets.flatMap((t) => [t.tex.side, t.tex.top, t.tex.bottom]
    .filter((n) => n && !ghostPngs.has(`ghost_${n}`))))].sort();
console.log('\n需从原版拷入的贴图:', needCopy.join(', ') || '（无）');
console.log('\n贴图缺失:', problems.length ? '\n  ' + problems.join('\n  ') : '无');
console.log('\nid 冲突:', conflict.length ? '\n  ' + conflict.join('\n  ') : '无');
console.log('\n面贴图不同的方块（顶≠侧 或 底≠侧）:');
for (const t of targets) {
    if (t.tex.top !== t.tex.side || t.tex.bottom !== t.tex.side) {
        console.log(`  ${t.block}: side=${t.tex.side} top=${t.tex.top} bottom=${t.tex.bottom}`);
    }
}
