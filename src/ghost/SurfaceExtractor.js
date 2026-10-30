/** SurfaceExtractor — 外壳提取 */

/** 空气类方块名（已去命名空间，小写） */
const AIR_LIKE = new Set([
    'air', 'cave_air', 'void_air', 'structure_void', 'light',
    'bubble_column', // 气泡柱只是一个实体，不是可遮挡的方块面
]);

/**
 * 透明/非整块：默认**仍算遮挡**（真实渲染下相邻面被 cullface，内部本来看不见）。
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

        // 占位：某一格是否"遮挡"（存在 + 非空气 + 按配置计透明）
        const occludes = (x, y, z) => {
            const layerMap = grid.get(y);
            if (!layerMap) return false;
            const nb = layerMap.get(`${x},${z}`);
            if (!nb) return false;
            const name = nb.name || nb.type || '';
            if (isAirLikeName(name)) return false;
            if (!this.transparentOccluders && isTransparentName(name)) return false;
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

module.exports = { SurfaceExtractor, isAirLikeName, isTransparentName, stripNamespace, posOf };
