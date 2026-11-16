class SpatialIndexUtils {
    // 内存 spatial index 的分块边长（消费端），必须与 LitematicLoader 构建 blockChunks 时的
    // CHUNK_SIZE 一致。与 BinaryChunkStorage 的 CHUNK_SIZE=32（.mcmega 磁盘格式）无关，切勿统一。
    static CHUNK_SIZE = 16;

    /**
     * 取半径覆盖的分块里的方块。
     *
     * **入参是投影内相对坐标**（不是世界坐标）：镜像/旋转/原点换算由调用方用
     * `PositionConverter.worldToProjection` 完成。历史实现在这里手减 `projection.position`，
     * 投影旋转 90°/镜像后会把中心落到另一条轴上 → 取到错误的分块 → 打印机整片一格不放。
     *
     * @param {object} projection      投影（需要 blockChunks / blocks）
     * @param {number} relCenterX      玩家在投影内的相对 x
     * @param {number} relCenterY      玩家在投影内的相对 y
     * @param {number} relCenterZ      玩家在投影内的相对 z
     * @param {number} radius          搜索半径（格）
     */
    static getBlocksInRadius(projection, relCenterX, relCenterY, relCenterZ, radius) {
        const chunks = projection.blockChunks;
        // `blockChunks` 必须是 Map（Loader 构建）。但投影从 projections.json 恢复时，
        // Map 会被 JSON 序列化成 `{}`，此时 `.get` 不存在 —— 直接调用会抛
        // `projection.blockChunks.get is not a function`，打印机每 200ms 失败返回（等于没工作）。
        // 非 Map 一律回退到 blocks 数组（普通投影恢复后 blocks 是完整的）。
        const isMap = chunks && typeof chunks.get === 'function' && typeof chunks.size === 'number';
        if (!isMap || chunks.size === 0) {
            return projection.blocks || [];
        }

        const minChunkX = Math.floor((relCenterX - radius) / SpatialIndexUtils.CHUNK_SIZE);
        const maxChunkX = Math.floor((relCenterX + radius) / SpatialIndexUtils.CHUNK_SIZE);
        const minChunkY = Math.floor((relCenterY - radius) / SpatialIndexUtils.CHUNK_SIZE);
        const maxChunkY = Math.floor((relCenterY + radius) / SpatialIndexUtils.CHUNK_SIZE);
        const minChunkZ = Math.floor((relCenterZ - radius) / SpatialIndexUtils.CHUNK_SIZE);
        const maxChunkZ = Math.floor((relCenterZ + radius) / SpatialIndexUtils.CHUNK_SIZE);

        const blocks = [];

        for (let cx = minChunkX; cx <= maxChunkX; cx++) {
            for (let cy = minChunkY; cy <= maxChunkY; cy++) {
                for (let cz = minChunkZ; cz <= maxChunkZ; cz++) {
                    const chunkKey = `${cx},${cy},${cz}`;
                    const chunkBlocks = projection.blockChunks.get(chunkKey);
                    if (chunkBlocks) {
                        for (const block of chunkBlocks) {
                            blocks.push(block);
                        }
                    }
                }
            }
        }

        return blocks;
    }
}

module.exports = { SpatialIndexUtils };
