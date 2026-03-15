// ProjectionRenderer - 投影渲染管理器
// 处理投影方块的放置、清除、范围框显示等

const RENDER_INTERVAL = 5; // 渲染间隔（tick）
const MAX_BLOCKS_PER_BATCH = 50; // 每批次最大方块数

class ProjectionRenderer {
    constructor() {
        this.renderTasks = new Map(); // 渲染任务队列
        this.playerBlocks = new Map(); // 玩家已放置的方块
        this.boundsParticles = new Map(); // 范围框粒子
        this.startRenderLoop();
    }

    /**
     * 启动渲染循环
     */
    startRenderLoop() {
        mc.listen('onTick', () => {
            this.processRenderTasks();
        });
    }

    /**
     * 处理渲染任务队列
     */
    processRenderTasks() {
        for (const [playerXuid, task] of this.renderTasks) {
            if (task.paused) continue;

            const player = mc.getPlayer(playerXuid);
            if (!player) {
                this.renderTasks.delete(playerXuid);
                continue;
            }

            this.renderBatch(player, task);

            // 检查是否完成
            if (task.currentIndex >= task.blocks.length) {
                this.renderTasks.delete(playerXuid);
                logger.info(`Projection render completed for ${player.name}`);
            }
        }
    }

    /**
     * 渲染一批方块
     */
    renderBatch(player, task) {
        const { blocks, projection, currentIndex } = task;
        const endIndex = Math.min(currentIndex + MAX_BLOCKS_PER_BATCH, blocks.length);

        for (let i = currentIndex; i < endIndex; i++) {
            const block = blocks[i];
            const worldPos = this.transformPosition(block.pos, projection);

            // 放置方块 - 使用玩家当前维度
            this.placeBlockByPos(player.dim, worldPos, block, projection.opacity);

            // 记录已放置的方块
            if (!this.playerBlocks.has(player.xuid)) {
                this.playerBlocks.set(player.xuid, []);
            }
            this.playerBlocks.get(player.xuid).push({
                pos: worldPos,
                dimension: projection.dimension
            });
        }

        task.currentIndex = endIndex;
    }

    /**
     * 坐标变换（考虑旋转和镜像）
     */
    transformPosition(pos, projection) {
        let [x, y, z] = pos;
        const { rotation, mirrorX, mirrorZ } = projection;
        const { dimensions } = projection;

        // 应用镜像
        if (mirrorX) {
            x = dimensions.x - x - 1;
        }
        if (mirrorZ) {
            z = dimensions.z - z - 1;
        }

        // 应用旋转
        let newX = x, newZ = z;
        switch (rotation) {
            case 90:
                newX = z;
                newZ = dimensions.x - x - 1;
                break;
            case 180:
                newX = dimensions.x - x - 1;
                newZ = dimensions.z - z - 1;
                break;
            case 270:
                newX = dimensions.z - z - 1;
                newZ = x;
                break;
        }

        // 加上投影位置偏移
        return [
            projection.position.x + newX,
            projection.position.y + y,
            projection.position.z + newZ
        ];
    }

    /**
     * 放置单个方块（使用位置坐标）
     */
    placeBlockByPos(dimension, pos, blockData, opacity) {
        try {
            // 使用世界对象的 getBlock 方法
            const block = mc.getWorld(dimension).getBlock(pos);
            if (!block) {
                logger.debug(`Cannot get block at ${pos.join(',')}`);
                return;
            }

            // 获取方块ID
            const blockId = this.getBlockNumericId(blockData.name);
            if (blockId === null) {
                logger.debug(`Unknown block: ${blockData.name}`);
                return;
            }

            // 设置方块
            block.set(blockId, 0);

        } catch (e) {
            logger.debug(`Failed to place block at ${pos.join(',')}: ${e.message}`);
        }
    }

    /**
     * 放置单个方块
     */
    placeBlock(dim, pos, blockData, opacity) {
        try {
            const block = mc.getWorld(dim).getBlock(pos);
            if (!block) return;

            // 获取方块ID
            const blockId = this.getBlockNumericId(blockData.name);
            if (blockId === null) return;

            // 设置方块
            block.set(blockId, 0);

        } catch (e) {
            logger.debug(`Failed to place block at ${pos.join(',')}: ${e.message}`);
        }
    }

    /**
     * 获取方块的数字ID（基岩版）
     * 这是一个简化实现，实际需要完整的方块ID映射
     */
    getBlockNumericId(blockName) {
        // 简化的方块ID映射
        const blockMap = {
            'minecraft:air': 0,
            'minecraft:stone': 1,
            'minecraft:grass': 2,
            'minecraft:dirt': 3,
            'minecraft:cobblestone': 4,
            'minecraft:planks': 5,
            'minecraft:bedrock': 7,
            'minecraft:sand': 12,
            'minecraft:gravel': 13,
            'minecraft:gold_ore': 14,
            'minecraft:iron_ore': 15,
            'minecraft:coal_ore': 16,
            'minecraft:log': 17,
            'minecraft:leaves': 18,
            'minecraft:glass': 20,
            'minecraft:wool': 35,
            'minecraft:yellow_flower': 37,
            'minecraft:red_flower': 38,
            'minecraft:brown_mushroom': 39,
            'minecraft:red_mushroom': 40,
            'minecraft:gold_block': 41,
            'minecraft:iron_block': 42,
            'minecraft:stone_slab': 44,
            'minecraft:brick_block': 45,
            'minecraft:mossy_cobblestone': 48,
            'minecraft:obsidian': 49,
            'minecraft:torch': 50,
            'minecraft:chest': 54,
            'minecraft:diamond_ore': 56,
            'minecraft:diamond_block': 57,
            'minecraft:crafting_table': 58,
            'minecraft:furnace': 61,
            'minecraft:ladder': 65,
            'minecraft:rail': 66,
            'minecraft:lever': 69,
            'minecraft:stone_pressure_plate': 70,
            'minecraft:wooden_pressure_plate': 72,
            'minecraft:redstone_ore': 73,
            'minecraft:redstone_torch': 76,
            'minecraft:stone_button': 77,
            'minecraft:ice': 79,
            'minecraft:snow': 80,
            'minecraft:cactus': 81,
            'minecraft:clay': 82,
            'minecraft:reeds': 83,
            'minecraft:jukebox': 84,
            'minecraft:fence': 85,
            'minecraft:pumpkin': 86,
            'minecraft:netherrack': 87,
            'minecraft:soul_sand': 88,
            'minecraft:glowstone': 89,
            'minecraft:portal': 90,
            'minecraft:lit_pumpkin': 91,
            'minecraft:cake': 92,
            'minecraft:unpowered_repeater': 93,
            'minecraft:stained_glass': 95,
        };

        return blockMap[blockName] || null;
    }

    /**
     * 开始渲染投影
     */
    startRender(player, projection, layer = -1) {
        // 过滤方块（如果指定了层）
        let blocks = projection.blocks;
        if (layer >= 0) {
            blocks = blocks.filter(b => b.pos[1] === layer);
        }

        // 创建渲染任务
        const task = {
            projection,
            blocks,
            currentIndex: 0,
            paused: false
        };

        this.renderTasks.set(player.xuid, task);
        logger.info(`Started rendering projection for ${player.name}, ${blocks.length} blocks`);
    }

    /**
     * 清除玩家的投影
     */
    clearPlayerProjection(player) {
        // 停止渲染任务
        this.renderTasks.delete(player.xuid);

        // 清除已放置的方块
        const placedBlocks = this.playerBlocks.get(player.xuid);
        if (placedBlocks) {
            for (const blockInfo of placedBlocks) {
                // 简化处理：跳过清除，因为基岩版API限制
            }
            this.playerBlocks.delete(player.xuid);
        }
    }

    /**
     * 显示投影范围框
     */
    showBounds(projection, player) {
        const boundsId = `${player.xuid}_${projection.id}`;
        
        // 清除旧的范围框
        this.hideBounds(boundsId);

        const { x, y, z } = projection.position;
        const { x: sx, y: sy, z: sz } = projection.dimensions;

        // 生成范围框粒子
        const particles = [];
        const color = this.hexToRGB(projection.boundsColor || '#00FF00');

        // 底部边框
        for (let i = 0; i <= sx; i++) {
            particles.push([x + i, y, z]);
            particles.push([x + i, y, z + sz]);
        }
        for (let i = 0; i <= sz; i++) {
            particles.push([x, y, z + i]);
            particles.push([x + sx, y, z + i]);
        }

        // 垂直边框
        for (let i = 0; i <= sy; i++) {
            particles.push([x, y + i, z]);
            particles.push([x + sx, y + i, z]);
            particles.push([x, y + i, z + sz]);
            particles.push([x + sx, y + i, z + sz]);
        }

        // 顶部边框
        for (let i = 0; i <= sx; i++) {
            particles.push([x + i, y + sy, z]);
            particles.push([x + i, y + sy, z + sz]);
        }
        for (let i = 0; i <= sz; i++) {
            particles.push([x, y + sy, z + i]);
            particles.push([x + sx, y + sy, z + i]);
        }

        // 存储粒子位置
        this.boundsParticles.set(boundsId, {
            positions: particles,
            dimension: projection.dimension,
            color
        });

        // 显示粒子
        this.spawnBoundsParticles(boundsId, player);
    }

    /**
     * 生成范围框粒子
     */
    spawnBoundsParticles(boundsId, player) {
        const bounds = this.boundsParticles.get(boundsId);
        if (!bounds) return;

        // 简化实现：在ActionBar显示范围信息
        const start = bounds.positions[0];
        const end = bounds.positions[bounds.positions.length - 1];
        if (start && end) {
            player.tell(`§a投影范围: (${start.join(',')}) - (${end.join(',')})`);
        }
    }

    /**
     * 隐藏范围框
     */
    hideBounds(boundsId) {
        this.boundsParticles.delete(boundsId);
    }

    /**
     * 颜色转换
     */
    hexToRGB(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16) / 255,
            g: parseInt(result[2], 16) / 255,
            b: parseInt(result[3], 16) / 255
        } : { r: 0, g: 1, b: 0 };
    }

    /**
     * 旋转投影
     */
    rotateProjection(projection, degrees) {
        const newRotation = (projection.rotation + degrees) % 360;
        return { ...projection, rotation: newRotation };
    }

    /**
     * 获取玩家在看的层（用于建造模式）
     */
    getPlayerLookingLayer(player, projection) {
        const pitch = player.direction.pitch;
        
        // 抬头看上层，低头看下层
        if (pitch < -30) {
            return Math.min(projection.buildLayer + 1, projection.dimensions.y - 1);
        } else if (pitch > 30) {
            return Math.max(projection.buildLayer - 1, 0);
        }
        
        return projection.buildLayer;
    }
}

module.exports = { ProjectionRenderer };
