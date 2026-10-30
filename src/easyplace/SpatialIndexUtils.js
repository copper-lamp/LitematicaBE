class SpatialIndexUtils {
    // 内存 spatial index 的分块边长（消费端），必须与 LitematicLoader 构建 blockChunks 时的
    // CHUNK_SIZE 一致。与 BinaryChunkStorage 的 CHUNK_SIZE=32（.mcmega 磁盘格式）无关，切勿统一。
    static CHUNK_SIZE = 16;

    static getBlocksInRadius(projection, centerX, centerY, centerZ, radius) {
        if (!projection.blockChunks || projection.blockChunks.size === 0) {
            return projection.blocks || [];
        }

        const projPos = projection.position;

        const relX = centerX - projPos.x;
        const relY = centerY - projPos.y;
        const relZ = centerZ - projPos.z;

        const minChunkX = Math.floor((relX - radius) / SpatialIndexUtils.CHUNK_SIZE);
        const maxChunkX = Math.floor((relX + radius) / SpatialIndexUtils.CHUNK_SIZE);
        const minChunkY = Math.floor((relY - radius) / SpatialIndexUtils.CHUNK_SIZE);
        const maxChunkY = Math.floor((relY + radius) / SpatialIndexUtils.CHUNK_SIZE);
        const minChunkZ = Math.floor((relZ - radius) / SpatialIndexUtils.CHUNK_SIZE);
        const maxChunkZ = Math.floor((relZ + radius) / SpatialIndexUtils.CHUNK_SIZE);

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
