/** SurfaceExtractor — 外壳提取 */

/** 空气类方块名（已去命名空间，小写） */
const AIR_LIKE = new Set([
    'air', 'cave_air', 'void_air', 'structure_void', 'light',
    'bubble_column', // 气泡柱只是一个实体，不是可遮挡的方块面
]);

/**
 * 透明/非整块：默认仍算遮挡（真实渲染下相邻面被 cullface，内部本来看不见）。
 * 只有 opts.transparentOccluders = false 时才把它们排除在"遮挡"之外，
 * 用于"宁可多写、不愿少一格"的保守模式。
 */
const TRANSPARENT = new Set([
    'glass', 'tinted_glass', 'ice', 'packed_ice', 'blue_ice', 'frosted_ice',
    'water', 'lava', 'slime_block', 'honey_block',
    'oak_leaves', 'spruce_leaves', 'birch_leaves', 'jungle_leaves', 'acacia_leaves',
    'dark_oak_leaves', 'mangrove_leaves', 'cherry_leaves', 'pale_oak_leaves',
    'azalea_leaves', 'flowering_azalea_leaves',
]);

/**
 * 形状/非整块方块：完全不遮挡相邻格。
 *
 * 判据是「这个方块自己的几何是不是满格立方体」——不是满格，就挡不住邻居的任何可见面：
 *   · 红石粉（redstone_wire）是 1/16 高的薄片，贴在下方方块顶面上；下方方块的顶面
 *     在原版里照样渲染（从侧面/斜上方能看见它的边缘和相邻格），把它当成"遮挡"会让
 *     相邻格被整格剔除 → 投影上出现本该有方块的空洞；
 *   · 同理适用于火把、地毯、台阶、楼梯、栅栏、玻璃板、花草、压力板、轨道、床……
 *
 * 语义统一为「宁可多写、不漏写」：判断错了顶多多写几格 ghost（可见、可撤销），
 * 判断漏了就是投影缺一块（玩家会以为投影坏了）。
 */
const NON_OCCLUDING_SHAPE = new Set([
    // ── 红石元件 / 薄片 ──
    'redstone_wire', 'redstone_dust', 'tripwire', 'tripwire_hook',
    'repeater', 'unpowered_repeater', 'powered_repeater',
    'comparator', 'unpowered_comparator', 'powered_comparator',
    'lever', 'daylight_detector', 'daylight_detector_inverted',
    'piston_head', 'piston_arm_collision', 'sticky_piston_arm_collision', 'moving_piston',
    // ── 门/活板门/栅栏/墙/楼梯/台阶/薄板 ──
    'stairs', 'slab', 'double_slab', 'wall', 'fence', 'fence_gate',
    'door', 'trapdoor', 'button', 'torch', 'redstone_torch', 'unlit_redstone_torch',
    'soul_torch', 'soul_wall_torch', 'wall_torch', 'copper_torch', 'copper_wall_torch',
    'rail', 'golden_rail', 'activator_rail', 'detector_rail',
    'ladder', 'glass_pane', 'iron_bars', 'carpet', 'moss_carpet', 'pale_moss_carpet',
    'pressure_plate', 'wooden_pressure_plate', 'stone_pressure_plate', 'light_weighted_pressure_plate',
    'heavy_weighted_pressure_plate', 'polished_blackstone_pressure_plate',
    'sign', 'standing_sign', 'wall_sign', 'hanging_sign', 'wall_hanging_sign',
    'banner', 'standing_banner', 'wall_banner',
    // ── 家具 / 器件（几何都不满格）──
    'cake', 'candle', 'candle_cake', 'black_candle_cake', 'white_candle_cake',
    'cauldron', 'water_cauldron', 'lava_cauldron', 'powder_snow_cauldron',
    'composter', 'hopper', 'brewing_stand', 'enchanting_table', 'anvil',
    'chipped_anvil', 'damaged_anvil', 'flower_pot', 'lectern', 'stonecutter',
    'grindstone', 'conduit', 'scaffolding', 'chain', 'lantern', 'soul_lantern',
    'end_rod', 'lightning_rod', 'bell', 'campfire', 'soul_campfire',
    'bed',
    // ── 火 / 雪 / 蛛网 / 蛋 ──
    'fire', 'soul_fire', 'snow', 'snow_layer', 'powder_snow', 'cobweb', 'web',
    'turtle_egg', 'sniffer_egg', 'frogspawn',
    // ── 略低于满格（15/16、14/16）：盖不住相邻方块的面 ──
    'farmland', 'farmland_moist', 'dirt_path', 'grass_path', 'soul_sand',
    // ── 植物（全部不满格）──
    'short_grass', 'grass', 'tall_grass', 'short_dry_grass', 'tall_dry_grass',
    'fern', 'large_fern', 'dead_bush', 'bush', 'firefly_bush', 'leaf_litter',
    'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet',
    'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy',
    'cornflower', 'lily_of_the_valley', 'wither_rose', 'torchflower', 'pink_petals',
    'spore_blossom', 'sweet_berry_bush', 'cactus_flower', 'wildflowers',
    'sugar_cane', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass',
    'sea_pickle', 'lily_pad', 'vine', 'glow_lichen', 'hanging_roots',
    'sculk_vein', 'big_dripleaf', 'small_dripleaf', 'azalea', 'flowering_azalea',
    'bamboo', 'bamboo_sapling', 'cocoa', 'mushroom', 'brown_mushroom', 'red_mushroom',
    'wheat', 'carrots', 'potatoes', 'beetroots', 'nether_wart',
    'pumpkin_stem', 'melon_stem', 'torchflower_crop', 'pitcher_crop', 'pitcher_plant',
    'crimson_roots', 'warped_roots', 'nether_sprouts', 'chorus_flower', 'chorus_plant',
    'cave_vines', 'cave_vines_plant', 'twisting_vines', 'weeping_vines',
    'resin_clump',
]);

/** 形状后缀：覆盖各材质变体（*_stairs / *_slab / *_fence …） */
const NON_OCCLUDING_SUFFIX = [
    '_stairs', '_slab', '_wall', '_fence', '_fence_gate', '_door', '_trapdoor',
    '_button', '_torch', '_ladder', '_sign', '_banner', '_rail', '_plate',
    '_pane', '_bars', '_carpet', '_wire', '_dust', '_sapling', '_flower',
    '_tulip', '_orchid', '_bluet', '_daisy', '_bush', '_fern', '_grass',
    '_crop', '_stem', '_vine', '_roots', '_sprouts', '_candle', '_chain',
    '_head', '_skull', '_pot', '_petals', '_blossom', '_lichen', '_vein',
    '_pickle', '_pad', '_egg', '_propagule', '_bud', '_spore', '_bed',
];

/** 形状前缀 */
const NON_OCCLUDING_PREFIX = ['potted_'];

function stripNamespace(name) {
    if (!name || typeof name !== 'string') return '';
    const lower = name.toLowerCase();
    const idx = lower.indexOf(':');
    return idx >= 0 ? lower.slice(idx + 1) : lower;
}

function isAirLikeName(name) {
    const n = stripNamespace(name);
    if (!n) return true;
    if (AIR_LIKE.has(n)) return true;
    // *_air（如 future_air）、*_glass / *_glass_pane 归透明集合处理，不当空气
    return n.endsWith('_air');
}

function isTransparentName(name) {
    const n = stripNamespace(name);
    if (TRANSPARENT.has(n)) return true;
    return n === 'glass' || n.endsWith('_glass') || n.endsWith('_glass_pane');
}

/**
 * 形状/非整块方块：不参与"遮挡"判定。
 *
 * 注意 double_slab（双半砖）与 *_slab 后缀：双半砖其实是满格，但它只在
 * `double_slab` 状态名出现，实际方块名仍是 `*_slab`——按"不遮挡"处理只会多写几格，
 * 不会挖洞，保持与历史行为一致。
 */
function isNonOccludingShape(name) {
    const n = stripNamespace(name);
    if (!n) return false;
    if (NON_OCCLUDING_SHAPE.has(n)) return true;
    for (const p of NON_OCCLUDING_PREFIX) {
        if (n.startsWith(p)) return true;
    }
    for (const s of NON_OCCLUDING_SUFFIX) {
        if (n.endsWith(s)) return true;
    }
    return false;
}

/** 兼容 pos 的两种写法：[x,y,z] 或 {x,y,z} */
function posOf(block) {
    const p = block && block.pos;
    if (!p) return null;
    if (Array.isArray(p)) {
        if (p.length < 3) return null;
        return [p[0] | 0, p[1] | 0, p[2] | 0];
    }
    if (typeof p.x === 'number' && typeof p.y === 'number' && typeof p.z === 'number') {
        return [p.x | 0, p.y | 0, p.z | 0];
    }
    return null;
}

/** 输入归一化：支持 projection / {blocks} / Block[] */
function blocksOf(source) {
    if (!source) return [];
    if (Array.isArray(source)) return source;
    if (Array.isArray(source.blocks)) return source.blocks;
    return [];
}

class SurfaceExtractor {
    /**
     * @param {{transparentOccluders?: boolean}} [opts]
     *        transparentOccluders=true（默认）：透明方块也算遮挡，最省写入
     *        transparentOccluders=false：透明方块不算遮挡，宁可多写
     */
    constructor(opts) {
        const o = opts || {};
        this.transparentOccluders = o.transparentOccluders !== false;
    }

    /**
     * 提取需要写的方块。
     *
     * @param {object|Array} source  投影对象（含 blocks）或方块数组
     * @param {{layerFilter?: number, cull?: boolean, includeAir?: boolean}} [options]
     *        layerFilter >= 0 → 只取该 y 层；默认不做六向剔除（整层显示）
     *        cull=false → 完全不做剔除（返回全部非空气方块）
     *        includeAir=true → 连空气也返回（默认过滤）
     * @returns {{blocks: Array, stats: object}}
     */
    extract(source, options) {
        const o = options || {};
        const layerFilter = (typeof o.layerFilter === 'number' && o.layerFilter >= 0) ? o.layerFilter : -1;
        const includeAir = o.includeAir === true;
        // 层模式默认不剔除；显式 cull:true 才在层内也做六向判定
        const doCull = o.cull === true || (layerFilter < 0 && o.cull !== false);

        const input = blocksOf(source);
        const stats = {
            input: input.length,
            kept: 0,
            culled: 0,
            skippedAir: 0,
            skippedDuplicate: 0,
            skippedLayer: 0,
            layer: layerFilter,
            mode: doCull ? 'surface' : 'flat',
        };

        // y -> Map("x,z" -> block)；按层分桶，邻居判定只查相邻三层，内存和查找都更小
        const grid = new Map();
        let maxLayer = -Infinity;
        let minLayer = Infinity;

        for (let i = 0; i < input.length; i++) {
            const block = input[i];
            const p = posOf(block);
            if (!p) continue;
            const [x, y, z] = p;
            const name = block.name || block.type || '';

            if (!includeAir && isAirLikeName(name)) { stats.skippedAir++; continue; }
            if (layerFilter >= 0 && y !== layerFilter) { stats.skippedLayer++; continue; }

            let layerMap = grid.get(y);
            if (!layerMap) {
                layerMap = new Map();
                grid.set(y, layerMap);
            }
            const k = `${x},${z}`;
            if (layerMap.has(k)) { stats.skippedDuplicate++; continue; }
            layerMap.set(k, block);

            if (y > maxLayer) maxLayer = y;
            if (y < minLayer) minLayer = y;
        }

        if (grid.size === 0) {
            return { blocks: [], stats };
        }

        // 占位：某一格是否"遮挡"（存在 + 非空气 + 按配置计透明 + 不是不满格形状）
        const occludes = (x, y, z) => {
            const layerMap = grid.get(y);
            if (!layerMap) return false;
            const nb = layerMap.get(`${x},${z}`);
            if (!nb) return false;
            const name = nb.name || nb.type || '';
            if (isAirLikeName(name)) return false;
            if (!this.transparentOccluders && isTransparentName(name)) return false;
            // 形状方块（楼梯/台阶/墙/栅栏/红石粉/地毯/花草等不满格方块）不遮挡相邻面，
            // 否则相邻形状互相剔除、投影出洞
            if (isNonOccludingShape(name)) return false;
            return true;
        };

        const out = [];
        // 按层升序遍历，保证输出顺序稳定（同一层内保持输入注册顺序）
        for (const y of [...grid.keys()].sort((a, b) => a - b)) {
            const layerMap = grid.get(y);
            for (const [k, block] of layerMap) {
                if (!doCull) {
                    out.push(block);
                    stats.kept++;
                    continue;
                }
                const comma = k.indexOf(',');
                const x = +k.slice(0, comma);
                const z = +k.slice(comma + 1);

                const surrounded =
                    occludes(x + 1, y, z) &&
                    occludes(x - 1, y, z) &&
                    occludes(x, y + 1, z) &&
                    occludes(x, y - 1, z) &&
                    occludes(x, y, z + 1) &&
                    occludes(x, y, z - 1);

                if (surrounded) {
                    stats.culled++;
                } else {
                    out.push(block);
                    stats.kept++;
                }
            }
        }

        stats.minLayer = Number.isFinite(minLayer) ? minLayer : null;
        stats.maxLayer = Number.isFinite(maxLayer) ? maxLayer : null;
        stats.layers = grid.size;
        return { blocks: out, stats };
    }

    /** 便捷：一次性提取，不做任何缓存 */
    static extract(source, options) {
        return new SurfaceExtractor(options && options.extractor).extract(source, options);
    }

    /**
     * 只统计不返回（给 UI 预览"将写入 N 格"用）。与 extract 共用同一套判定，
     * 别在这里另写一份逻辑， 两套判定迟早不一致。
     */
    count(source, options) {
        return this.extract(source, options).stats;
    }
}

module.exports = {
    SurfaceExtractor, isAirLikeName, isTransparentName, isNonOccludingShape,
    stripNamespace, posOf,
    NON_OCCLUDING_SHAPE, NON_OCCLUDING_SUFFIX, NON_OCCLUDING_PREFIX,
};
