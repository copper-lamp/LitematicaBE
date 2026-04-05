// ProjectionRenderer - 投影渲染管理器
// 处理投影方块的放置、清除、范围框显示等

const RENDER_INTERVAL = 1; // 渲染间隔（tick）
const TOTAL_RENDER_FRAMES = 5; // 总渲染帧数（5帧完成所有粒子）
const MAX_PARTICLES_PER_TICK = 5000; // 每tick最大粒子数（用于持续渲染）
const MAX_RENDER_DISTANCE = 256; // 最大渲染距离（方块）- 渲染所有可见范围
const PARTICLE_RENDER_MODE = 'particle'; // 'particle' 或 'setblock'
const CHECK_INTERVAL = 500; // 放置检测间隔（ms）

class ProjectionRenderer {
    constructor() {
        this.renderTasks = new Map(); // 渲染任务队列（用于粒子投影）
        this.playerBlocks = new Map(); // 玩家已放置的方块（用于setblock模式）
        this.boundsParticles = new Map(); // 范围框粒子
        this.activeProjections = new Map(); // 活跃投影（持续渲染用）
        this.placedBlocks = new Map(); // 已正确放置的方块位置
        this.easyPlaceMode = new Map(); // 玩家轻松放置模式状态
        this.loadedProjections = new Map(); // 玩家已加载的投影
        this.lastNearbyPrompt = new Map(); // 上次附近投影提示时间
        this.playerParticles = new Map(); // 玩家渲染的粒子位置（用于取消渲染）
        this.layerRenderMode = new Map(); // 逐层渲染模式
        this.currentRenderLayer = new Map(); // 当前渲染的层
        this.lastLayerSwitch = new Map(); // 上次切换层的时间（冷却用）
        this.startRenderLoop();
        this.startPlacementCheckLoop();
        this.startParticleRespawnLoop(); // 启动粒子重生循环
        this.startItemUseListener(); // 启动物品使用监听
    }

    /**
     * 启动物品使用监听（木剑切换层）
     */
    startItemUseListener() {
        mc.listen('onUseItem', (player, item) => {
            if (!item) return;

            const itemName = item.name || '';
            logger.info(`[ItemUse] 玩家: ${player.name}, 物品: ${itemName}`);
            
            // 检测木剑 (wooden_sword)
            if (itemName === 'wooden_sword') {
                logger.info(`[ItemUse] 检测到木剑，准备切换层`);
                this.handleLayerSwitch(player);
            }
        });
    }

    /**
     * 处理木剑切换层
     * 抬头向下切换（层数-1），低头向上切换（层数+1）
     */
    handleLayerSwitch(player) {
        // 检查冷却时间（0.2秒）
        const now = Date.now();
        const lastSwitch = this.lastLayerSwitch.get(player.xuid) || 0;
        const COOLDOWN = 200; // 0.2秒冷却
        if (now - lastSwitch < COOLDOWN) {
            return; // 冷却中，忽略此次输入
        }

        // 检查是否开启了逐层渲染模式
        if (!this.layerRenderMode.get(player.xuid)) {
            return;
        }

        // 获取当前加载的投影 - 先从activeProjections获取，如果不存在则从renderTasks获取
        let task = this.activeProjections.get(player.xuid);
        if (!task) {
            task = this.renderTasks.get(player.xuid);
        }
        
        // 调试日志
        logger.info(`[LayerSwitch] 玩家: ${player.name}, activeProjections: ${this.activeProjections.size}, renderTasks: ${this.renderTasks.size}`);
        logger.info(`[LayerSwitch] task: ${task ? '存在' : '不存在'}, task.projection: ${task?.projection ? '存在' : '不存在'}`);
        
        if (!task || !task.projection) {
            player.tell('§c当前没有加载的投影');
            return;
        }

        // 更新冷却时间
        this.lastLayerSwitch.set(player.xuid, now);

        const projection = task.projection;
        const maxLayer = projection.dimensions.y - 1;
        let currentLayer = this.currentRenderLayer.get(player.xuid);
        
        // 如果当前层未设置，从最后一层开始
        if (currentLayer === undefined || currentLayer === null) {
            currentLayer = maxLayer;
            this.currentRenderLayer.set(player.xuid, currentLayer);
        }

        // 获取玩家朝向（俯视/仰视）
        const pitch = player.direction.pitch;

        if (pitch < -10) {
            // 抬头看 - 向下切换（层数减少）
            currentLayer = Math.max(currentLayer - 1, 0);
        } else if (pitch > 10) {
            // 低头看 - 向上切换（层数增加）
            currentLayer = Math.min(currentLayer + 1, maxLayer);
        } else {
            // 默认向下切换
            currentLayer = Math.max(currentLayer - 1, 0);
        }

        this.currentRenderLayer.set(player.xuid, currentLayer);

        // 清除当前层的粒子
        this.clearPlayerProjectionParticles(player);

        // 重新渲染当前层
        this.startRender(player, projection, currentLayer);

        player.tell(`§7已切换到第 ${currentLayer} 层 (共 ${maxLayer + 1} 层)`);
    }

    /**
     * 清除玩家当前投影的粒子（不删除渲染任务）
     */
    clearPlayerProjectionParticles(player) {
        // 清除粒子位置记录
        this.playerParticles.delete(player.xuid);
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
     * 启动放置检测循环
     */
    startPlacementCheckLoop() {
        setInterval(() => {
            this.checkPlacedBlocks();
        }, CHECK_INTERVAL);
    }

    /**
     * 启动粒子重生循环
     */
    startParticleRespawnLoop() {
        // 每1秒检查一次，在38秒时重生（40秒生命周期 - 2秒缓冲）
        setInterval(() => {
            this.respawnAllParticles();
        }, 1000);
    }

    /**
     * 重新生成所有活跃投影的粒子
     */
    respawnAllParticles() {
        const now = Date.now();
        const PARTICLE_LIFETIME = 40000; // 40秒粒子生命周期
        const RESPAWN_BUFFER = 2000; // 2秒缓冲
        const RESPAWN_TIME = PARTICLE_LIFETIME - RESPAWN_BUFFER; // 38秒时重生

        // 调试：检查活跃投影数量
        if (this.activeProjections.size === 0) {
            return; // 没有活跃投影
        }

        for (const [playerXuid, task] of this.activeProjections) {
            const player = mc.getPlayer(playerXuid);
            if (!player) continue;

            // 检查是否需要重生粒子（在38秒时重生）
            const lastRespawn = task.lastParticleRespawn || 0;
            const timeSinceLastRespawn = now - lastRespawn;
            
            // 调试日志：每10秒输出一次状态
            if (timeSinceLastRespawn > 0 && timeSinceLastRespawn < RESPAWN_TIME && timeSinceLastRespawn % 10000 < 1000) {
                logger.info(`[ParticleRespawn] 等待中... 已等待 ${(timeSinceLastRespawn / 1000).toFixed(1)}s / ${RESPAWN_TIME / 1000}s`);
            }
            
            if (timeSinceLastRespawn < RESPAWN_TIME) {
                continue; // 还没到重生时间
            }
            
            logger.info(`[ParticleRespawn] 开始重生！已等待 ${(timeSinceLastRespawn / 1000).toFixed(1)}s`);

            // 根据是否开启逐层模式决定重生范围
            const isLayerMode = this.layerRenderMode.get(playerXuid);
            let blocksToRespawn = [];

            // 使用 allBlocks（完整方块列表）进行重生
            const sourceBlocks = task.allBlocks || task.blocks;

            if (isLayerMode) {
                // 逐层模式：只重生当前层的粒子
                const maxLayer = task.projection.dimensions.y - 1;
                const currentLayer = this.currentRenderLayer.get(playerXuid) || maxLayer;
                blocksToRespawn = sourceBlocks.filter(b => b.pos[1] === currentLayer);
                
                // 调试日志
                logger.info(`[ParticleRespawn] 逐层模式 - 当前层: ${currentLayer}, 源方块数: ${sourceBlocks.length}, 过滤后: ${blocksToRespawn.length}`);
            } else {
                // 非逐层模式：重生所有粒子
                blocksToRespawn = sourceBlocks;
                logger.info(`[ParticleRespawn] 完整模式 - 重生所有 ${blocksToRespawn.length} 个方块`);
            }

            if (blocksToRespawn.length === 0) {
                logger.warn(`[ParticleRespawn] 没有需要重生的方块`);
                continue;
            }

            // 重新生成粒子
            let respawnedCount = 0;
            for (const block of blocksToRespawn) {
                try {
                    const worldPos = this.transformPosition(block.pos, task.projection);
                    const posKey = `${worldPos[0]},${worldPos[1]},${worldPos[2]}`;
                    
                    // 检查是否已正确放置
                    if (this.placedBlocks.has(posKey)) continue;

                    this.spawnProjectionParticle(player, worldPos, block, false);
                    respawnedCount++;
                } catch (e) {
                    // 忽略错误
                }
            }

            logger.info(`[ParticleRespawn] 玩家 ${player.name} 重生了 ${respawnedCount} 个粒子`);

            // 更新重生时间
            task.lastParticleRespawn = now;
        }
    }

    /**
     * 处理渲染任务队列
     */
    processRenderTasks() {
        const now = Date.now();
        
        // 处理活跃的粒子投影（持续渲染）
        for (const [playerXuid, task] of this.activeProjections) {
            const player = mc.getPlayer(playerXuid);
            if (!player) {
                this.activeProjections.delete(playerXuid);
                continue;
            }

            // 每100ms重新渲染一批粒子
            if (now - task.lastRenderTime >= 100) {
                this.renderParticleBatch(player, task);
                task.lastRenderTime = now;
            }
        }
    }

    /**
     * 检查玩家放置的方块
     */
    checkPlacedBlocks() {
        for (const [playerXuid, task] of this.activeProjections) {
            const player = mc.getPlayer(playerXuid);
            if (!player) continue;

            const { blocks, projection } = task;
            const playerDim = player.dim ?? (player.pos && player.pos.dimid) ?? 0;

            // 检查每个投影方块
            for (const block of blocks) {
                const worldPos = this.transformPosition(block.pos, projection);
                const posKey = `${worldPos[0]},${worldPos[1]},${worldPos[2]}`;
                
                // 如果已经标记为正确放置，跳过
                if (this.placedBlocks.has(posKey)) continue;

                // 检查该位置是否放置了正确的方块
                const isCorrect = this.checkBlockPlacement(playerDim, worldPos, block);
                
                if (isCorrect) {
                    // 标记为已正确放置
                    this.placedBlocks.set(posKey, true);
                }
            }
        }
    }

    /**
     * 检查指定位置是否放置了正确的方块
     */
    checkBlockPlacement(dimension, pos, expectedBlock) {
        try {
            const world = mc.getWorld(dimension);
            if (!world) return false;

            const block = world.getBlock(pos);
            if (!block) return false;

            // 获取实际方块名称
            const actualBlockName = block.type || block.name || '';
            const expectedBlockName = expectedBlock.name || '';

            // 比较方块名称（忽略命名空间）
            const actualBase = actualBlockName.includes(':') 
                ? actualBlockName.split(':')[1] 
                : actualBlockName;
            const expectedBase = expectedBlockName.includes(':') 
                ? expectedBlockName.split(':')[1] 
                : expectedBlockName;

            return actualBase === expectedBase;
        } catch (e) {
            return false;
        }
    }

    /**
     * 渲染一批粒子（用于持续投影）
     * 优化：视距裁剪 + 分批渲染
     */
    renderParticleBatch(player, task) {
        // 如果不在渲染中，直接返回
        if (!task.isRendering) return;

        const { blocks, projection } = task;

        // 获取玩家位置和维度
        const playerDim = player.dim ?? (player.pos && player.pos.dimid) ?? 0;
        const playerPos = player.pos;
        if (!playerPos) return;

        const visibleBlocks = task.visibleBlocks;
        if (!visibleBlocks || visibleBlocks.length === 0) return;

        // 如果已经渲染完所有方块，停止渲染
        if (task.visibleBlocksIndex >= visibleBlocks.length) {
            task.isRendering = false;
            return;
        }

        // 每批渲染一定数量的粒子
        const startIndex = task.visibleBlocksIndex;
        const endIndex = Math.min(startIndex + MAX_PARTICLES_PER_TICK, visibleBlocks.length);
        let renderedCount = 0;

        for (let i = startIndex; i < endIndex && renderedCount < MAX_PARTICLES_PER_TICK; i++) {
            const block = visibleBlocks[i];
            const worldPos = block.worldPos;
            const posKey = `${worldPos[0]},${worldPos[1]},${worldPos[2]}`;

            // 检查是否已正确放置
            if (this.placedBlocks.has(posKey)) continue;

            // 未放置，显示正常粒子
            this.spawnProjectionParticle(player, worldPos, block, false);
            renderedCount++;
        }

        // 更新索引
        task.visibleBlocksIndex = endIndex;

        // 检查是否完成
        if (task.visibleBlocksIndex >= visibleBlocks.length) {
            task.isRendering = false;
        }
    }

    /**
     * 获取所有方块的世界坐标（不进行距离裁剪）
     */
    getAllBlocksWorldPos(blocks, projection) {
        const worldBlocks = [];

        for (const block of blocks) {
            const worldPos = this.transformPosition(block.pos, projection);
            worldBlocks.push({
                ...block,
                worldPos: worldPos
            });
        }

        return worldBlocks;
    }

    /**
     * 获取玩家视野范围内的方块（用于持续渲染）
     */
    getVisibleBlocks(blocks, projection, playerPos) {
        const visibleBlocks = [];
        const px = playerPos.x;
        const py = playerPos.y;
        const pz = playerPos.z;

        for (const block of blocks) {
            const worldPos = this.transformPosition(block.pos, projection);
            const dx = worldPos[0] - px;
            const dy = worldPos[1] - py;
            const dz = worldPos[2] - pz;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

            // 只保留在渲染距离内的方块
            if (distance <= MAX_RENDER_DISTANCE) {
                visibleBlocks.push({
                    ...block,
                    worldPos: worldPos,
                    distance: distance
                });
            }
        }

        // 按距离排序（优先渲染近的）
        visibleBlocks.sort((a, b) => a.distance - b.distance);

        return visibleBlocks;
    }

    /**
     * 生成投影粒子
     * @param dimension 维度
     * @param pos 位置 [x, y, z]
     * @param blockData 方块数据
     * @param isError 是否为错误状态
     */
    spawnProjectionParticle(player, pos, blockData, isError = false) {
        try {
            const fullBlockName = blockData.name || '';
            const particleId = this.getBlockParticleId(fullBlockName, isError);
            // 方块中心坐标（三个轴都加 0.5）
            const adjustedPos = [pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5];

            // 存储粒子位置用于取消渲染
            if (player && player.xuid) {
                if (!this.playerParticles.has(player.xuid)) {
                    this.playerParticles.set(player.xuid, []);
                }
                this.playerParticles.get(player.xuid).push({
                    pos: adjustedPos,
                    particleId: particleId,
                    dim: player.dim || 0
                });
            }

            // 调试：记录前10个方块的粒子ID
            if (!this.debugParticleCount) this.debugParticleCount = 0;
            if (this.debugParticleCount < 10) {
                logger.info(`[DEBUG] Spawning particle: ${particleId} for block: ${fullBlockName}`);
                this.debugParticleCount++;
            }

            // 使用玩家对象的 spawnParticle 方法，不会输出到日志
            if (player && player.spawnParticle) {
                player.spawnParticle(
                    particleId,
                    { x: adjustedPos[0], y: adjustedPos[1], z: adjustedPos[2] }
                );
            } else {
                // 降级到 mc.runcmd
                const dimName = this.getDimensionName(player?.dim || 0);
                mc.runcmd(`execute in ${dimName} positioned ${adjustedPos[0].toFixed(2)} ${adjustedPos[1].toFixed(2)} ${adjustedPos[2].toFixed(2)} run particle "${particleId}" ~ ~ ~`);
            }
        } catch (e) {
            // 静默忽略粒子生成错误
            if (!this.debugErrorCount) this.debugErrorCount = 0;
            if (this.debugErrorCount < 5) {
                logger.error(`[DEBUG] spawnProjectionParticle error: ${e.message}`);
                this.debugErrorCount++;
            }
        }
    }

    /**
     * 获取维度名称
     */
    getDimensionName(dimension) {
        switch (dimension) {
            case 1: return 'the_nether';
            case 2: return 'the_end';
            default: return 'overworld';
        }
    }

    /**
     * 获取方块对应的粒子ID
     * @param fullBlockName 完整方块名称
     * @param isError 是否为错误状态
     * @returns 粒子ID字符串
     */
    getBlockParticleId(fullBlockName, isError = false) {
        let baseName = fullBlockName.toLowerCase();

        if (baseName.includes(':')) {
            const parts = baseName.split(':');
            baseName = parts[1] || parts[0];
        }

        const textureName = this.getBlockTextureName(baseName);
        const suffix = isError ? 'error' : 'normal';
        return `litematica:block_${textureName}_${suffix}`;
    }

    /**
     * 切换轻松放置模式
     */
    toggleEasyPlace(player) {
        const current = this.easyPlaceMode.get(player.xuid) || false;
        this.easyPlaceMode.set(player.xuid, !current);
        
        if (!current) {
            player.tell('§a轻松放置模式已开启');
            this.startEasyPlace(player);
        } else {
            player.tell('§c轻松放置模式已关闭');
            this.stopEasyPlace(player);
        }
    }

    /**
     * 启动轻松放置功能
     */
    startEasyPlace(player) {
        // 监听玩家放置方块事件
        const handler = (pl, block) => {
            if (pl.xuid !== player.xuid) return;
            if (!this.easyPlaceMode.get(player.xuid)) return;

            // 检查是否放置了正确的方块
            const task = this.activeProjections.get(player.xuid);
            if (!task) return;

            const { blocks, projection } = task;
            const playerDim = player.dim ?? (player.pos && player.pos.dimid) ?? 0;

            // 找到玩家点击的投影方块
            for (const projBlock of blocks) {
                const worldPos = this.transformPosition(projBlock.pos, projection);
                const posKey = `${worldPos[0]},${worldPos[1]},${worldPos[2]}`;
                
                // 检查位置是否匹配
                if (Math.abs(block.x - worldPos[0]) < 0.5 &&
                    Math.abs(block.y - worldPos[1]) < 0.5 &&
                    Math.abs(block.z - worldPos[2]) < 0.5) {
                    
                    // 检查方块类型是否匹配
                    const isCorrect = this.checkBlockPlacement(playerDim, worldPos, projBlock);
                    
                    if (isCorrect) {
                        // 正确放置，标记并发送提示
                        this.placedBlocks.set(posKey, true);
                        player.tell('§a✓ 方块放置正确！');
                    } else {
                        // 错误放置，显示错误粒子
                        this.spawnProjectionParticle(player, worldPos, projBlock, true);
                        player.tell('§c✗ 方块类型错误！');
                    }
                    break;
                }
            }
        };

        // 注册事件监听
        mc.listen('onBlockPlaced', handler);
        this.easyPlaceHandler = handler;
    }

    /**
     * 停止轻松放置功能
     */
    stopEasyPlace(player) {
        // 移除事件监听
        if (this.easyPlaceHandler) {
            // 注意：LeviLamina 可能不支持直接移除监听，这里简化处理
            this.easyPlaceHandler = null;
        }
    }

    /**
     * 重置投影放置状态
     */
    resetPlacementStatus(player) {
        this.placedBlocks.clear();
        player.tell('§a投影放置状态已重置');
    }

    /**
     * 从方块名称获取贴图名称
     * 直接使用方块名称，因为资源包包含了所有方块的粒子
     */
    getBlockTextureName(blockNameOrFull) {
        let name = blockNameOrFull.toLowerCase();

        // 移除命名空间前缀
        if (name.includes(':')) {
            const parts = name.split(':');
            name = parts[1] || parts[0];
        }

        // 替换特殊字符为下划线
        name = name.replace(/[^a-z0-9_]/g, '_');

        // 移除末尾的下划线
        name = name.replace(/_+$/, '');

        // 石英类方块特殊映射
        if (name === 'smooth_quartz') {
            name = 'quartz_block_bottom';
        } else if (name === 'quartz_block') {
            name = 'quartz_block_side';
        } else if (name === 'chiseled_quartz_block') {
            name = 'chiseled_quartz_block';
        } else if (name === 'quartz_pillar') {
            name = 'quartz_pillar';
        } else if (name === 'quartz_bricks') {
            name = 'quartz_bricks';
        }

        // 调试：记录前5个方块名称转换
        if (!this.debugTextureCount) this.debugTextureCount = 0;
        if (this.debugTextureCount < 5) {
            logger.info(`[DEBUG] Texture mapping: ${blockNameOrFull} -> ${name}`);
            this.debugTextureCount++;
        }

        return name || 'missing_tile';
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
     * 开始渲染投影
     */
    startRender(player, projection, layer = -1) {
        // 保存完整的方块列表用于粒子重生
        const allBlocks = projection.blocks;
        
        // 过滤方块（如果指定了层）
        let blocks = allBlocks;
        if (layer >= 0) {
            blocks = blocks.filter(b => b.pos[1] === layer);
        }

        // 清除旧的投影和放置状态
        this.clearPlayerProjection(player);
        this.placedBlocks.clear();

        // 获取玩家位置
        const playerPos = player.pos;
        const playerDim = player.dim ?? (player.pos && player.pos.dimid) ?? 0;

        // 记录渲染开始时间
        const renderStartTime = Date.now();

        // 转换所有方块为世界坐标
        const visibleBlocks = this.getAllBlocksWorldPos(blocks, projection);

        // 创建渲染任务
        const task = {
            projection,
            blocks,              // 当前渲染的方块（可能已过滤）
            allBlocks,           // 完整的方块列表（用于粒子重生）
            visibleBlocks,
            visibleBlocksIndex: 0,
            currentIndex: 0,
            paused: false,
            lastRenderTime: Date.now(),
            lastVisibleUpdate: Date.now(),
            isInitialRender: true,
            initialRenderCount: 0,
            isRendering: true, // 标记正在渲染
            renderStartTime: renderStartTime,
            currentLayer: layer, // 记录当前渲染的层
            lastParticleRespawn: Date.now() // 初始化粒子重生时间
        };
        
        logger.info(`[StartRender] 创建任务 - 层: ${layer}, 总方块: ${allBlocks.length}, 当前层方块: ${blocks.length}`);

        this.renderTasks.set(player.xuid, task);

        // 对于粒子模式，将投影添加到活跃列表以便持续渲染
        if (PARTICLE_RENDER_MODE === 'particle') {
            this.activeProjections.set(player.xuid, task);
        }

        // 执行渲染并传递回调函数
        this.uniformRender(player, task, () => {
            // 渲染完成回调
            task.isRendering = false;
            const renderTime = ((Date.now() - renderStartTime) / 1000).toFixed(2);
            const renderTimeMs = (Date.now() - renderStartTime) / 1000; // 保存为秒数
            task.renderTime = renderTimeMs; // 保存渲染耗时用于粒子重生计算
            task.lastParticleRespawn = Date.now(); // 初始化粒子重生时间
            const layerInfo = layer >= 0 ? ` | 第 ${layer} 层` : '';
            player.tell(`§a投影 "${projection.name}" 渲染完成！`);
            player.tell(`§7方块数: ${visibleBlocks.length} | 耗时: ${renderTime}秒${layerInfo}`);
            player.tell(`§7位置: (${projection.position.x}, ${projection.position.y}, ${projection.position.z})`);
            player.tell(`§7粒子将在 ${(renderTimeMs + 2).toFixed(0)} 秒后自动重生`);
        });
    }

    /**
     * 立即渲染 - 一次性渲染所有粒子
     */
    uniformRender(player, task, onComplete = null) {
        const { visibleBlocks } = task;
        
        if (!visibleBlocks || visibleBlocks.length === 0) {
            task.isInitialRender = false;
            task.isRendering = false;
            if (onComplete) onComplete();
            return;
        }

        const totalBlocks = visibleBlocks.length;
        let rendered = 0;
        let errorCount = 0;
        
        // 一次性渲染所有方块
        for (let i = 0; i < totalBlocks; i++) {
            const block = visibleBlocks[i];
            const posKey = `${block.worldPos[0]},${block.worldPos[1]},${block.worldPos[2]}`;

            if (!this.placedBlocks.has(posKey)) {
                try {
                    this.spawnProjectionParticle(player, block.worldPos, block, false);
                    rendered++;
                } catch (e) {
                    errorCount++;
                }
            }
        }

        task.visibleBlocksIndex = totalBlocks;
        task.isInitialRender = false;
        task.isRendering = false;

        // 调用完成回调
        if (onComplete) onComplete();
    }

    /**
     * 清除玩家的投影
     */
    clearPlayerProjection(player) {
        // 停止渲染任务
        this.renderTasks.delete(player.xuid);
        this.activeProjections.delete(player.xuid);

        // 使用空粒子覆盖清除投影粒子
        const particles = this.playerParticles.get(player.xuid);
        if (particles && player && player.spawnParticle) {
            for (const particle of particles) {
                try {
                    // 生成一个透明的基础粒子覆盖原粒子
                    player.spawnParticle(
                        'minecraft:basic_particle',
                        { x: particle.pos[0], y: particle.pos[1], z: particle.pos[2] }
                    );
                } catch (e) {
                    // 忽略错误
                }
            }
        }

        // 清除粒子位置记录
        this.playerParticles.delete(player.xuid);

        // 清除已放置的方块
        const placedBlocks = this.playerBlocks.get(player.xuid);
        if (placedBlocks) {
            this.playerBlocks.delete(player.xuid);
        }
    }

    /**
     * 取消渲染（删除已渲染的粒子）
     */
    cancelRender(player) {
        // 从 activeProjections 获取任务
        const task = this.activeProjections.get(player.xuid);
        if (!task) {
            player.tell('§c当前没有正在渲染的投影');
            return false;
        }

        // 清除投影
        this.clearPlayerProjection(player);

        player.tell('§a投影渲染已取消');
        return true;
    }

    /**
     * 加载已放置的投影
     */
    loadProjection(player, projectionId) {
        // 检查投影是否存在
        const dataManager = global.dataManager;
        if (!dataManager) {
            player.tell('§c数据管理器未初始化');
            return false;
        }

        const projection = dataManager.getProjection(projectionId);
        if (!projection) {
            player.tell('§c投影不存在');
            return false;
        }

        // 标记为已加载
        this.loadedProjections.set(player.xuid, projectionId);

        // 开始渲染
        this.startRender(player, projection, -1, true);

        player.tell(`§a已加载投影: ${projection.name}`);
        return true;
    }

    /**
     * 获取玩家的当前投影
     */
    getPlayerProjection(player) {
        const task = this.renderTasks.get(player.xuid);
        return task ? task.projection : null;
    }

    /**
     * 检查玩家是否已加载指定投影
     */
    isProjectionLoaded(player, projectionId) {
        const loadedId = this.loadedProjections.get(player.xuid);
        return loadedId === projectionId;
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
