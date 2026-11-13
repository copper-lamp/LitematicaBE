/**
 * SlabNames.js — 半砖（slab）在 Java / 基岩之间「双半砖独立方块名」的单一真源
 *
 * 为什么需要它：
 *   Java 的双半砖**不是**独立方块，是同一个半砖方块加 `type=double`；
 *   基岩的双半砖是**独立方块名**，而且有三种排法：
 *     quartz_slab      -> quartz_double_slab
 *     stone_slab       -> double_stone_slab        （旧式 `double_` 前缀）
 *     waxed_cut_copper_slab -> waxed_double_cut_copper_slab  （`double` 夹在中间）
 *   靠 `name + '_double_slab'` 硬拼会漏掉 10 个（石材/木头/铜系），
 *   投影打印机会把"双半砖"当成普通半砖放下去。
 *
 * 数据来源：`建模对应清单/block_shape_map.json` 里 103 个 shape=slab 的方块，
 *   本表 10 条特例 + 默认规则可 100% 还原全部 103 个双半砖名（tests/test_slab_placement.js 钉死）。
 */

/** 不遵循 `<stem>_double_slab` 默认排法的特例（值 = 基岩双半砖方块短名） */
const DOUBLE_NAME_SPECIAL = {
    stone_slab: 'double_stone_slab',
    wooden_slab: 'double_wooden_slab',
    cut_copper_slab: 'double_cut_copper_slab',
    exposed_cut_copper_slab: 'exposed_double_cut_copper_slab',
    weathered_cut_copper_slab: 'weathered_double_cut_copper_slab',
    oxidized_cut_copper_slab: 'oxidized_double_cut_copper_slab',
    waxed_cut_copper_slab: 'waxed_double_cut_copper_slab',
    waxed_exposed_cut_copper_slab: 'waxed_exposed_double_cut_copper_slab',
    waxed_weathered_cut_copper_slab: 'waxed_weathered_double_cut_copper_slab',
    waxed_oxidized_cut_copper_slab: 'waxed_oxidized_double_cut_copper_slab',
};

const stripNs = (name) => String(name || '').replace(/^minecraft:/, '').toLowerCase();

/** 是否是半砖（Java 名 / 基岩短名都认） */
function isSlabName(name) {
    return /_slab$/.test(stripNs(name));
}

/**
 * Java 半砖名 -> 基岩双半砖短名
 * @param {string} name 例 'minecraft:oak_slab'
 * @returns {string|null} 例 'oak_double_slab'；非半砖返回 null
 */
function slabDoubleName(name) {
    const short = stripNs(name);
    if (!short.endsWith('_slab')) return null;
    return DOUBLE_NAME_SPECIAL[short] || `${short.replace(/_slab$/, '')}_double_slab`;
}

/**
 * 基岩双半砖短名 -> 它对应的普通半砖短名（反向，给 .mcstructure 存档时还原 Java 名用）
 * @param {string} name 例 'double_stone_slab' / 'waxed_double_cut_copper_slab'
 * @returns {string|null}
 */
function slabNameOfDouble(name) {
    const short = stripNs(name);
    for (const [slab, dbl] of Object.entries(DOUBLE_NAME_SPECIAL)) {
        if (dbl === short) return slab;
    }
    if (short.startsWith('double_')) return short.slice('double_'.length);
    if (short.includes('_double_')) return short.replace('_double_', '_');
    if (short.endsWith('_double_slab')) return short.replace(/_double_slab$/, '_slab');
    return null;
}

/** 是否是「基岩双半砖」独立方块名 */
function isDoubleSlabName(name) {
    return slabNameOfDouble(name) !== null && /double/.test(stripNs(name));
}

module.exports = {
    DOUBLE_NAME_SPECIAL,
    isSlabName,
    slabDoubleName,
    slabNameOfDouble,
    isDoubleSlabName,
};
