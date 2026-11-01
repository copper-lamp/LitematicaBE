// src/data/projectionFlags.js
//
// 投影标志位的**唯一判定源**。
//
// 为什么单独抽出来：`isMega` 历史上被写成过字符串。
// 旧代码是 `const isMega = schematic.isMega && schematic.schematicId;`，
// 短路求值返回的是 schematicId，于是 projections.json 里出现
// `"isMega": "mega_1793441452644_2ca1qq904"`。
// 这种数据一旦遇到 `isMega !== true` 的严格判定，MEGA 投影就被当成普通投影：
// 服务器重启后 `_ensureMegaState` 直接返回 false → 玩家进服看到
// 「渲染未就绪（render.enableMega 未开，或分块数据已缺失）」、切层报「分块注入状态缺失」。
//
// 约定：**内存与磁盘里的 isMega 一律是布尔**，读到旧数据就地修好。

/**
 * 就地把一条投影记录修正到当前约定，返回同一个对象。
 *
 * - `isMega` 是字符串 → 视为旧数据，值即 schematicId，修成 `true`
 * - `isMega` 为真但缺 `schematicId` → 没有分块可读，降级为普通投影（否则每次进服都失败一次）
 *
 * @param {object} proj
 * @returns {object} 同一个对象
 */
function normalizeProjection(proj) {
    if (!proj || typeof proj !== 'object') return proj;

    if (typeof proj.isMega === 'string') {
        if (!proj.schematicId) proj.schematicId = proj.isMega;
        proj.isMega = true;
    } else {
        proj.isMega = !!proj.isMega;
    }

    if (proj.isMega && !proj.schematicId) proj.isMega = false;

    return proj;
}

/**
 * 是不是 MEGA 投影。任何一种真值形态都算，避免调用方各自写判定。
 * @param {object} proj
 * @returns {boolean}
 */
function isMegaProjection(proj) {
    return !!(proj && proj.isMega);
}

module.exports = { normalizeProjection, isMegaProjection };
