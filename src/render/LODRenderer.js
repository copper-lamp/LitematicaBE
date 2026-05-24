// LODRenderer - 细节层次渲染系统
// 根据距离自动调整渲染精度，大幅减少远距离粒子数
// 支持 NEAR/MEDIUM/FAR/OUTLINE 四级LOD

class LODRenderer {
    constructor() {
        this.lodConfig = {
            NEAR: { distance: 32, skipRate: 0, label: 'near' },
            MEDIUM: { distance: 80, skipRate: 2, label: 'medium' },
            FAR: { distance: 160, skipRate: 4, label: 'far' },
            OUTLINE: { distance: 256, outlineOnly: true, label: 'outline' }
        };

        this.hashSeed = [73856093, 19349663, 83492791];
        this.debugMode = false;
        this.stats = {
            totalProcessed: 0,
            totalFiltered: 0,
            byLevel: { NEAR: 0, MEDIUM: 0, FAR: 0, OUTLINE: 0 }
        };
    }

    /**
     * 根据距离获取LOD级别
     */
    getLevel(distance) {
        if (distance <= this.lodConfig.NEAR.distance) return 'NEAR';
        if (distance <= this.lodConfig.MEDIUM.distance) return 'MEDIUM';
        if (distance <= this.lodConfig.FAR.distance) return 'FAR';
        return 'OUTLINE';
    }

    /**
     * 判断方块是否应该在此LOD级别渲染
     */
    shouldRender(blockPos, level) {
        if (level === 'NEAR') return true;
        if (level === 'OUTLINE') return false;

        const config = this.lodConfig[level];
        if (!config || config.skipRate <= 0) return true;

        const hash = this.hashPos(blockPos[0], blockPos[1], blockPos[2]);
        return (hash % (config.skipRate + 1)) === 0;
    }

    /**
     * 过滤并分组方块
     * @param {Array} blocks 方块数组 [{pos: [x,y,z], name, state, worldPos: [wx,wy,wz], distance}]
     * @returns {object} { allFiltered: [], byLevel: { NEAR: [], MEDIUM: [], FAR: [] }, outline: [] }
     */
    filterBlocks(blocks) {
        const result = {
            allFiltered: [],
            byLevel: { NEAR: [], MEDIUM: [], FAR: [] },
            outlinePositions: new Set()
        };

        this.stats.totalProcessed += blocks.length;

        for (const block of blocks) {
            const level = this.getLevel(block.distance || 0);

            if (level === 'OUTLINE') {
                result.outlinePositions.add(
                    `${block.worldPos[0]},${block.worldPos[1]},${block.worldPos[2]}`
                );
                this.stats.byLevel.OUTLINE++;
                continue;
            }

            if (this.shouldRender(block.pos, level)) {
                block.lodLevel = level;
                result.allFiltered.push(block);
                result.byLevel[level].push(block);
                this.stats.byLevel[level]++;
            } else {
                this.stats.totalFiltered++;
            }
        }

        if (this.debugMode && blocks.length > 0) {
            const filtered = blocks.length - result.allFiltered.length;
            logger.info(`[LOD] Processed ${blocks.length} blocks → ${result.allFiltered.length} (filtered: ${filtered}, N:${result.byLevel.NEAR.length} M:${result.byLevel.MEDIUM.length} F:${result.byLevel.FAR.length} O:${result.outlinePositions.size})`);
        }

        return result;
    }

    /**
     * 为一个大区域生成轮廓方块列表
     * 在远距离只渲染边缘，用于指引玩家方向
     */
    generateOutlineBlocks(projection) {
        const blocks = [];
        const dims = projection.dimensions;
        const pos = projection.position;

        const step = Math.max(4, Math.floor(Math.max(dims.x, dims.y, dims.z) / 64));

        for (let y = 0; y < dims.y; y += step) {
            for (let x = 0; x < dims.x; x += step) {
                blocks.push({
                    worldPos: [pos.x + x, pos.y + y, pos.z],
                    isOutline: true, isCorner: false
                });
                blocks.push({
                    worldPos: [pos.x + x, pos.y + y, pos.z + dims.z - 1],
                    isOutline: true, isCorner: false
                });
            }
            for (let z = 0; z < dims.z; z += step) {
                blocks.push({
                    worldPos: [pos.x, pos.y + y, pos.z + z],
                    isOutline: true, isCorner: false
                });
                blocks.push({
                    worldPos: [pos.x + dims.x - 1, pos.y + y, pos.z + z],
                    isOutline: true, isCorner: false
                });
            }
        }

        for (let x = 0; x < dims.x; x += step) {
            for (let z = 0; z < dims.z; z += step) {
                blocks.push({
                    worldPos: [pos.x + x, pos.y, pos.z + z],
                    isOutline: true, isCorner: false
                });
                blocks.push({
                    worldPos: [pos.x + x, pos.y + dims.y - 1, pos.z + z],
                    isOutline: true, isCorner: false
                });
            }
        }

        if (this.debugMode) {
            logger.info(`[LOD] Generated ${blocks.length} outline blocks`);
        }

        return blocks;
    }

    /**
     * 稀疏化方块列表（用于已经加载的分块，在渲染前进行LOD过滤）
     * 返回需要渲染的方块子集
     */
    sparseBlocks(blocks, playerPos, maxDistance) {
        const result = [];
        const px = playerPos.x;
        const py = playerPos.y;
        const pz = playerPos.z;

        for (const block of blocks) {
            const wx = block.pos[0];
            const wy = block.pos[1];
            const wz = block.pos[2];

            const dx = wx - px;
            const dy = wy - py;
            const dz = wz - pz;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (dist > maxDistance) continue;

            const level = this.getLevel(dist);
            block.worldPos = [wx, wy, wz];
            block.distance = dist;

            if (this.shouldRender(block.pos, level)) {
                result.push(block);
            }
        }

        result.sort((a, b) => a.distance - b.distance);
        
        if (this.debugMode) {
            logger.info(`[LOD] SparseBlocks: ${blocks.length} → ${result.length}`);
        }
        
        return result;
    }

    /**
     * 位置哈希（用于确定性采样）
     */
    hashPos(x, y, z) {
        return Math.abs(
            (x * this.hashSeed[0]) ^
            (y * this.hashSeed[1]) ^
            (z * this.hashSeed[2])
        );
    }

    /**
     * 更新LOD配置
     */
    updateConfig(config) {
        if (config) {
            Object.assign(this.lodConfig, config);
            if (this.debugMode) {
                logger.info(`[LOD] Config updated: ${JSON.stringify(this.lodConfig)}`);
            }
        }
    }

    /**
     * 获取LOD统计信息
     */
    getStats() {
        return {
            levels: Object.keys(this.lodConfig),
            config: { ...this.lodConfig },
            stats: { ...this.stats }
        };
    }
    
    /**
     * 重置统计
     */
    resetStats() {
        this.stats = {
            totalProcessed: 0,
            totalFiltered: 0,
            byLevel: { NEAR: 0, MEDIUM: 0, FAR: 0, OUTLINE: 0 }
        };
    }
    
    /**
     * 设置调试模式
     */
    setDebugMode(enabled) {
        this.debugMode = enabled;
        logger.info(`[LOD] Debug mode: ${enabled}`);
    }
}

module.exports = { LODRenderer };
