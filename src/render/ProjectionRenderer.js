// ProjectionRenderer - 投影渲染管理器 v2.0 (性能优化版)
// 优化：分帧渲染 + 粒子池 + 内存清理 + 异步重生

const { bidirectionalConverter } = require('../mappings/BidirectionalBlockConverter');

// 材质名覆盖表 —— Java方块名 → 粒子材质面名（如 furnace → furnace_front）
const TEXTURE_OVERRIDE = {
    smooth_quartz: 'quartz_block_bottom',
    quartz_block: 'quartz_block_side',
    moving_piston: 'piston_arm_collision',
    piston_head: 'piston_arm_collision',
    grass_path: 'dirt_path_top',
    grass_block: 'grass_block_top',
    dirt_path: 'dirt_path_top',
    mycelium: 'mycelium_top',
    podzol: 'podzol_top',
    ancient_debris: 'ancient_debris_top',
    lodestone: 'lodestone_top',
    respawn_anchor: 'respawn_anchor_top',
    blackstone: 'blackstone_top',
    basalt: 'basalt_top',
    polished_basalt: 'polished_basalt_top',
    honey_block: 'honey_block_top',
    bee_nest: 'bee_nest_front',
    beehive: 'beehive_front',
    sculk_catalyst: 'sculk_catalyst_top',
    sculk_sensor: 'sculk_sensor_top',
    sculk_shrieker: 'sculk_shrieker_top',
    calibrated_sculk_sensor: 'calibrated_sculk_sensor_top',
    furnace: 'furnace_front',
    smoker: 'smoker_top',
    blast_furnace: 'blast_furnace_top',
    hopper: 'hopper_top',
    dispenser: 'dispenser_front',
    dropper: 'dropper_front',
    observer: 'observer_front',
    crafting_table: 'crafting_table_top',
    jukebox: 'jukebox_top',
    enchanting_table: 'enchanting_table_top',
    composter: 'composter_top',
    lectern: 'lectern_top',
    grindstone: 'grindstone_round',
    stonecutter: 'stonecutter_top',
    cartography_table: 'cartography_table_top',
    smithing_table: 'smithing_table_top',
    fletching_table: 'fletching_table_top',
    bell: 'bell_top',
    anvil: 'anvil_top',
    chipped_anvil: 'chipped_anvil_top',
    damaged_anvil: 'damaged_anvil_top',
    end_portal_frame: 'end_portal_frame_top',
    lantern: 'lantern',
    soul_lantern: 'soul_lantern',
    barrel: 'barrel_top',
    loom: 'loom_top',
    target: 'target_top',
    daylight_detector: 'daylight_detector_top',
    bed: 'red_bed',
    banner: 'white_banner',
    skull: 'skeleton_skull',
    cauldron: 'cauldron_top',
    big_dripleaf: 'big_dripleaf_top',
    azalea: 'azalea_top',
    flowering_azalea: 'flowering_azalea_top',
    jigsaw: 'jigsaw_top',
    structure_block: 'structure_block',
    campfire: 'campfire_fire',
    soul_campfire: 'soul_campfire_fire',
    soul_fire: 'soul_fire_0',
    copper_door: 'copper_door_bottom',
    exposed_copper_door: 'exposed_copper_door_bottom',
    weathered_copper_door: 'weathered_copper_door_bottom',
    oxidized_copper_door: 'oxidized_copper_door_bottom',
    waxed_copper_door: 'waxed_copper_door_bottom',
    waxed_exposed_copper_door: 'waxed_exposed_copper_door_bottom',
    waxed_weathered_copper_door: 'waxed_weathered_copper_door_bottom',
    waxed_oxidized_copper_door: 'waxed_oxidized_copper_door_bottom',
    pale_oak_door: 'pale_oak_door_bottom',
    cherry_door: 'cherry_door_bottom',
    bamboo_door: 'bamboo_door_bottom',
    trial_spawner: 'trial_spawner_top_inactive',
    vault: 'vault_top',
    chiseled_bookshelf: 'chiseled_bookshelf_top',
    crafter: 'crafter_top',
    pitcher_crop: 'pitcher_crop_top',
    mangrove_roots: 'mangrove_roots_top',
    muddy_mangrove_roots: 'muddy_mangrove_roots_top',
    ochre_froglight: 'ochre_froglight_top',
    verdant_froglight: 'verdant_froglight_top',
    pearlescent_froglight: 'pearlescent_froglight_top',
};

// 将Java方块名转换为粒子材质名
function _stripNamespace(blockName) {
    if (!blockName) return '';
    let name = blockName.toLowerCase();
    if (name.includes(':')) name = name.split(':')[1];
    return name.replace(/[^a-z0-9_]/g, '_').replace(/_+$/, '');
}

// 将Java方块名映射为粒子材质名，优先使用覆盖表，其次尝试转换为Bedrock方块名
function mapBlockName(javaName) {
    if (!javaName) return 'missing_tile';
    const name = _stripNamespace(javaName);
    if (name in TEXTURE_OVERRIDE) return TEXTURE_OVERRIDE[name];
    try {
        const be = bidirectionalConverter.javaToBedrock({ name: javaName, states: {} });
        const beShort = _stripNamespace(be.name);
        if (beShort && beShort !== 'missing_tile') return beShort;
    } catch (e) {}
    return name || 'missing_tile';
}

// 获取方块粒子ID，根据是否错误状态选择不同的后缀
function getBlockParticleId(fullBlockName, isError = false) {
    const suffix = isError ? 'error' : 'normal';
    if (!fullBlockName) return `litematica:block_missing_tile_${suffix}`;
    const textureName = mapBlockName(fullBlockName);
    return `litematica:block_${textureName}_${suffix}`;
}

// 常量定义
const RENDER_INTERVAL = 1;    // 每个tick渲染间隔（单位：tick）
const TOTAL_RENDER_FRAMES = 5;    // 分帧渲染总帧数
const MAX_PARTICLES_PER_TICK = 800;    // 每个tick渲染的最大粒子数
const MAX_RENDER_DISTANCE = 256;    // 玩家可见的最大渲染距离（单位：方块）
const PARTICLE_RENDER_MODE = 'particle';    // 粒子渲染模式，可选值：'particle' 或 'block'
const CHECK_INTERVAL = 500;    // 检查玩家放置方块的间隔（单位：毫秒）
const PARTICLE_LIFETIME = 40000;    // 粒子生命周期（单位：毫秒）
const RESPAWN_BATCH_SIZE = 200;    // 每次重生的粒子批量大小
const CLEANUP_INTERVAL = 60000;    // 内存清理间隔（单位：毫秒）
const MAX_PLACED_BLOCKS_AGE = 600000;    // 放置方块的最大存活时间（单位：毫秒）

// 粒子对象池类，用于复用粒子对象，减少内存分配
class ParticlePool {
    constructor(size = 2000) {
        this.pool = [];
        this.size = size;
        for (let i = 0; i < size; i++) {
            this.pool.push({ pos: [0, 0, 0], particleId: '', dim: 0, inUse: false });
        }
    }

    // 获取一个可用的粒子对象，如果池中没有可用对象，则创建一个新的
    acquire(pos, particleId, dim) {
        for (const item of this.pool) {
            if (!item.inUse) {
                item.pos[0] = pos[0];
                item.pos[1] = pos[1];
                item.pos[2] = pos[2];
                item.particleId = particleId;
                item.dim = dim;
                item.inUse = true;
                return item;
            }
        }
        const newItem = { pos: [...pos], particleId, dim, inUse: true };
        this.pool.push(newItem);
        return newItem;
    }

    // 释放粒子回池
    release(item) {
        if (item) item.inUse = false;
    }

    // 释放所有粒子，重置池状态
    releaseAll() {
        for (const item of this.pool) {
            item.inUse = false;
        }
    }
}

// 投影渲染管理器类
class ProjectionRenderer {
    constructor() {
        this.renderTasks = new Map();
        this.playerBlocks = new Map();
        this.boundsParticles = new Map();
        this.activeProjections = new Map();
        this.placedBlocks = new Map();
        this.placedBlocksTimestamps = new Map();
        this.easyPlaceMode = new Map();
        this.loadedProjections = new Map();
        this.lastNearbyPrompt = new Map();
        this.playerParticles = new Map();
        this.layerRenderMode = new Map();
        this.currentRenderLayer = new Map();
        this.lastLayerSwitch = new Map();
        this.particlePool = new ParticlePool(5000);
        this.frameIndex = 0;
        this.lastCleanupTime = Date.now();
        this.debugMode = false;
        this.startRenderLoop();
        this.startPlacementCheckLoop();
        this.startParticleRespawnLoop();
        this.startItemUseListener();
        this.startCleanupLoop();
    }

    // 内存清理循环
    startCleanupLoop() {
        setInterval(() => {
            this.cleanupMemory();
        }, CLEANUP_INTERVAL);
    }

    // 清理过期的放置方块和粒子
    cleanupMemory() {
        const now = Date.now();
        let cleanedPlaced = 0;
        let cleanedParticles = 0;

        for (const [key, timestamp] of this.placedBlocksTimestamps) {
            if (now - timestamp > MAX_PLACED_BLOCKS_AGE) {
                this.placedBlocks.delete(key);
                this.placedBlocksTimestamps.delete(key);
                cleanedPlaced++;
            }
        }

        for (const [playerXuid, particles] of this.playerParticles) {
            const task = this.activeProjections.get(playerXuid);
            if (!task) {
                this.playerParticles.delete(playerXuid);
                cleanedParticles += particles.length;
                continue;
            }
            if (particles.length > 10000) {
                const excess = particles.length - 10000;
                particles.splice(0, excess);
                cleanedParticles += excess;
            }
        }

        if (cleanedPlaced > 0 || cleanedParticles > 0) {
            logger.info(`[Cleanup] placedBlocks: -${cleanedPlaced}, particles: -${cleanedParticles}`);
        }
    }

    // 监听玩家使用物品事件，切换渲染层
    startItemUseListener() {
        mc.listen('onUseItem', (player, item) => {
            if (!item) return;
            const itemName = item.name || '';
            if (itemName === 'wooden_sword') {
                this.handleLayerSwitch(player);
            }
        });
    }

    // 处理玩家切换渲染层逻辑
    handleLayerSwitch(player) {
        const now = Date.now();
        const lastSwitch = this.lastLayerSwitch.get(player.xuid) || 0;
        const COOLDOWN = 200;
        if (now - lastSwitch < COOLDOWN) return;

        if (!this.layerRenderMode.get(player.xuid)) return;

        let task = this.activeProjections.get(player.xuid);
        if (!task) task = this.renderTasks.get(player.xuid);

        if (!task || !task.projection) {
            player.tell('§c当前没有加载的投影');
            return;
        }

        this.lastLayerSwitch.set(player.xuid, now);

        const projection = task.projection;
        const maxLayer = projection.dimensions.y - 1;
        let currentLayer = this.currentRenderLayer.get(player.xuid);

        if (currentLayer === undefined || currentLayer === null) {
            currentLayer = 0;
            this.currentRenderLayer.set(player.xuid, currentLayer);
        }

        const pitch = player.direction.pitch;

        if (pitch < -10) {
            currentLayer = Math.max(currentLayer - 1, 0);
        } else if (pitch > 10) {
            currentLayer = Math.min(currentLayer + 1, maxLayer);
        } else {
            currentLayer = Math.max(currentLayer - 1, 0);
        }

        this.currentRenderLayer.set(player.xuid, currentLayer);
        this.clearPlayerProjectionParticles(player);
        this.startRender(player, projection, currentLayer);
        player.tell(`§7已切换到第 ${currentLayer} 层 (共 ${maxLayer + 1} 层)`);
    }

    // 清理玩家的投影粒子
    clearPlayerProjectionParticles(player) {
        this.playerParticles.delete(player.xuid);
    }

    // 渲染循环，每个tick处理渲染任务
    startRenderLoop() {
        mc.listen('onTick', () => {
            this.frameIndex++;
            this.processRenderTasks();
        });
    }

    // 检查玩家放置的方块是否正确
    startPlacementCheckLoop() {
        setInterval(() => {
            this.checkPlacedBlocks();
        }, CHECK_INTERVAL);
    }

    // 粒子重生循环，每秒检查是否需要重生粒子
    startParticleRespawnLoop() {
        setInterval(() => {
            this.respawnAllParticles();
        }, 1000);
    }

    // 重生所有玩家的粒子
    respawnAllParticles() {
        const now = Date.now();
        const RESPAWN_TIME = PARTICLE_LIFETIME - 2000;

        if (this.activeProjections.size === 0) return;

        for (const [playerXuid, task] of this.activeProjections) {
            const player = mc.getPlayer(playerXuid);
            if (!player) continue;

            const lastRespawn = task.lastParticleRespawn || 0;
            const timeSinceLastRespawn = now - lastRespawn;

            if (timeSinceLastRespawn < RESPAWN_TIME) continue;

            const isLayerMode = this.layerRenderMode.get(playerXuid);
            const sourceBlocks = task.allBlocks || task.blocks;

            let blocksToRespawn = [];
            if (isLayerMode) {
                const maxLayer = task.projection.dimensions.y - 1;
                const currentLayer = this.currentRenderLayer.get(playerXuid);
                const actualLayer = (currentLayer !== undefined && currentLayer !== null) ? currentLayer : maxLayer;
                blocksToRespawn = sourceBlocks.filter(b => b.pos[1] === actualLayer);
            } else {
                blocksToRespawn = sourceBlocks;
            }

            if (blocksToRespawn.length === 0) continue;

            task.respawnQueue = blocksToRespawn.slice();
            task.respawnIndex = 0;
            task.isRespawning = true;
            task.lastParticleRespawn = now;

            logger.info(`[Respawn] Queued ${blocksToRespawn.length} blocks for player ${player.name}`);
        }
    }

    // 处理渲染任务，包括粒子渲染和重生
    processRenderTasks() {
        const now = Date.now();

        for (const [playerXuid, task] of this.activeProjections) {
            const player = mc.getPlayer(playerXuid);
            if (!player) {
                this.activeProjections.delete(playerXuid);
                continue;
            }

            if (task.isRespawning && task.respawnQueue) {
                this.processRespawnBatch(player, task);
            }

            if (now - task.lastRenderTime >= 100) {
                this.renderParticleBatch(player, task);
                task.lastRenderTime = now;
            }
        }
    }

    // 处理玩家粒子重生队列，分批渲染
    processRespawnBatch(player, task) {
        const queue = task.respawnQueue;
        if (!queue || task.respawnIndex >= queue.length) {
            task.isRespawning = false;
            task.respawnQueue = null;
            return;
        }

        const batchSize = RESPAWN_BATCH_SIZE;
        const endIndex = Math.min(task.respawnIndex + batchSize, queue.length);
        let respawned = 0;

        for (let i = task.respawnIndex; i < endIndex; i++) {
            const block = queue[i];
            try {
                const worldPos = this.transformPosition(block.pos, task.projection);
                const posKey = `${worldPos[0]},${worldPos[1]},${worldPos[2]}`;

                if (this.placedBlocks.has(posKey)) continue;

                this.spawnProjectionParticle(player, worldPos, block, false);
                respawned++;
            } catch (e) {
                // ignore
            }
        }

        task.respawnIndex = endIndex;

        if (task.respawnIndex >= queue.length) {
            task.isRespawning = false;
            task.respawnQueue = null;
            logger.info(`[Respawn] Completed ${respawned} particles for ${player.name}`);
        }
    }

    // 检查玩家放置的方块是否正确
    checkPlacedBlocks() {
        for (const [playerXuid, task] of this.activeProjections) {
            const player = mc.getPlayer(playerXuid);
            if (!player) continue;

            const { blocks, projection } = task;
            const playerDim = player.dim ?? (player.pos && player.pos.dimid) ?? 0;

            for (const block of blocks) {
                const worldPos = this.transformPosition(block.pos, projection);
                const posKey = `${worldPos[0]},${worldPos[1]},${worldPos[2]}`;

                if (this.placedBlocks.has(posKey)) continue;

                const isCorrect = this.checkBlockPlacement(playerDim, worldPos, block);

                if (isCorrect) {
                    this.placedBlocks.set(posKey, true);
                    this.placedBlocksTimestamps.set(posKey, Date.now());
                }
            }
        }
    }

    // 检查指定位置的方块是否与预期方块匹配
    checkBlockPlacement(dimension, pos, expectedBlock) {
        try {
            const world = mc.getWorld(dimension);
            if (!world) return false;

            const block = world.getBlock(pos);
            if (!block) return false;

            const actualBlockName = block.type || block.name || '';
            const expectedBlockName = expectedBlock.name || '';

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

    // 渲染一批粒子，每次最多渲染 MAX_PARTICLES_PER_TICK 个
    renderParticleBatch(player, task) {
        if (!task.isRendering) return;

        const { visibleBlocks } = task;
        if (!visibleBlocks || visibleBlocks.length === 0) return;

        if (task.visibleBlocksIndex >= visibleBlocks.length) {
            task.isRendering = false;
            return;
        }

        const startIndex = task.visibleBlocksIndex;
        const endIndex = Math.min(startIndex + MAX_PARTICLES_PER_TICK, visibleBlocks.length);
        let renderedCount = 0;

        for (let i = startIndex; i < endIndex && renderedCount < MAX_PARTICLES_PER_TICK; i++) {
            const block = visibleBlocks[i];
            const worldPos = block.worldPos;
            const posKey = `${worldPos[0]},${worldPos[1]},${worldPos[2]}`;

            if (this.placedBlocks.has(posKey)) continue;

            this.spawnProjectionParticle(player, worldPos, block, false);
            renderedCount++;
        }

        task.visibleBlocksIndex = endIndex;

        if (task.visibleBlocksIndex >= visibleBlocks.length) {
            task.isRendering = false;
        }
    }

    // 获取所有方块的世界坐标位置
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

    // 获取玩家可见的方块列表，按距离排序
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

            if (distance <= MAX_RENDER_DISTANCE) {
                visibleBlocks.push({
                    ...block,
                    worldPos: worldPos,
                    distance: distance
                });
            }
        }

        visibleBlocks.sort((a, b) => a.distance - b.distance);

        return visibleBlocks;
    }

    // 生成投影粒子
    spawnProjectionParticle(player, pos, blockData, isError = false) {
        //logger.info(`[DEBUG1] spawnProjectionParticle called at ${pos}, block=${blockData.name}`);
        try {
            const fullBlockName = blockData.name || '';
            const particleId = this.getBlockParticleId(fullBlockName, isError);
            const adjustedPos = [pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5];
            const dimid = (player && typeof player.dim === 'number') ? player.dim : 0;

            //logger.info(`[DEBUG2] adjustedPos=${adjustedPos}, dimid=${dimid}, particleId=${particleId}`);

            // 使用 LSE 标准 API
            const success = mc.spawnParticle(
                adjustedPos[0],
                adjustedPos[1],
                adjustedPos[2],
                dimid,
                particleId
            );
            //logger.info(`[DEBUG3] mc.spawnParticle returned: ${success}`);

            // 记录粒子到池中（用于管理）
            if (player && player.xuid) {
                if (!this.playerParticles.has(player.xuid)) {
                    this.playerParticles.set(player.xuid, []);
                }
                const particles = this.playerParticles.get(player.xuid);
                const pooled = this.particlePool.acquire(adjustedPos, particleId, dimid);
                particles.push(pooled);
            }
        } catch (e) {
            //logger.error(`[ERROR] spawnProjectionParticle exception: ${e.message}\n${e.stack}`);
        }
    }

    // 获取维度名称
    getDimensionName(dimension) {
        switch (dimension) {
            case 1: return 'the_nether';
            case 2: return 'the_end';
            default: return 'overworld';
        }
    }

    // 获取方块粒子ID，根据是否错误状态选择不同的后缀
    getBlockParticleId(fullBlockName, isError = false) {
        const suffix = isError ? 'error' : 'normal';
        if (!fullBlockName) return `litematica:block_missing_tile_${suffix}`;
        const textureName = mapBlockName(fullBlockName);
        return `litematica:block_${textureName}_${suffix}`;
    }

    // 切换玩家的轻松放置模式
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

    // 开始监听玩家放置方块事件，检查是否正确放置
    startEasyPlace(player) {
        const handler = (pl, block) => {
            if (pl.xuid !== player.xuid) return;
            if (!this.easyPlaceMode.get(player.xuid)) return;

            const task = this.activeProjections.get(player.xuid);
            if (!task) return;

            const { blocks, projection } = task;
            const playerDim = player.dim ?? (player.pos && player.pos.dimid) ?? 0;

            for (const projBlock of blocks) {
                const worldPos = this.transformPosition(projBlock.pos, projection);
                const posKey = `${worldPos[0]},${worldPos[1]},${worldPos[2]}`;

                if (Math.abs(block.x - worldPos[0]) < 0.5 &&
                    Math.abs(block.y - worldPos[1]) < 0.5 &&
                    Math.abs(block.z - worldPos[2]) < 0.5) {

                    const isCorrect = this.checkBlockPlacement(playerDim, worldPos, projBlock);

                    if (isCorrect) {
                        this.placedBlocks.set(posKey, true);
                        this.placedBlocksTimestamps.set(posKey, Date.now());
                        player.tell('§a✓ 方块放置正确！');
                    } else {
                        this.spawnProjectionParticle(player, worldPos, projBlock, true);
                        player.tell('§c✗ 方块类型错误！');
                    }
                    break;
                }
            }
        };

        mc.listen('afterPlaceBlock', handler);
        this.easyPlaceHandler = handler;
    }

    // 停止监听玩家放置方块事件
    stopEasyPlace(player) {
        if (this.easyPlaceHandler) {
            this.easyPlaceHandler = null;
        }
    }

    // 重置玩家的投影放置状态
    resetPlacementStatus(player) {
        this.placedBlocks.clear();
        this.placedBlocksTimestamps.clear();
        player.tell('§a投影放置状态已重置');
    }

    // 获取方块的粒子材质名称
    getBlockTextureName(blockNameOrFull) {
        return mapBlockName(blockNameOrFull);
    }

    // 将投影中的局部坐标转换为世界坐标，考虑旋转和镜像
    transformPosition(pos, projection) {
        let [x, y, z] = pos;
        const { rotation, mirrorX, mirrorZ } = projection;
        const { dimensions } = projection;

        if (mirrorX) {
            x = dimensions.x - x - 1;
        }
        if (mirrorZ) {
            z = dimensions.z - z - 1;
        }

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

        return [
            projection.position.x + newX,
            projection.position.y + y,
            projection.position.z + newZ
        ];
    }

    // 开始渲染投影，支持按层渲染
    startRender(player, projection, layer = -1) {
        const allBlocks = projection.blocks;

        let blocks = allBlocks;
        if (layer >= 0) {
            blocks = blocks.filter(b => b.pos[1] === layer);
        }

        this.clearPlayerProjection(player);
        this.placedBlocks.clear();
        this.placedBlocksTimestamps.clear();

        const playerPos = player.pos;
        const renderStartTime = Date.now();

        const visibleBlocks = this.getAllBlocksWorldPos(blocks, projection);

        const task = {
            projection,
            blocks,
            allBlocks,
            visibleBlocks,
            visibleBlocksIndex: 0,
            currentIndex: 0,
            paused: false,
            lastRenderTime: Date.now(),
            lastVisibleUpdate: Date.now(),
            isInitialRender: true,
            initialRenderCount: 0,
            isRendering: true,
            renderStartTime: renderStartTime,
            currentLayer: layer,
            lastParticleRespawn: Date.now(),
            respawnQueue: null,
            respawnIndex: 0,
            isRespawning: false
        };

        this.renderTasks.set(player.xuid, task);

        if (PARTICLE_RENDER_MODE === 'particle') {
            this.activeProjections.set(player.xuid, task);
        }

        const isEmptyInit = visibleBlocks.length === 0;
        this.uniformRender(player, task, () => {
            task.isRendering = false;
            const renderTime = ((Date.now() - renderStartTime) / 1000).toFixed(2);
            const renderTimeMs = (Date.now() - renderStartTime) / 1000;
            task.renderTime = renderTimeMs;
            task.lastParticleRespawn = Date.now();

            if (!isEmptyInit) {
                const layerInfo = layer >= 0 ? ` | 第 ${layer} 层` : '';
                // 静默模式 - 只在控制台输出渲染信息
                logger.info(`[ProjectionRenderer] 投影 "${projection.name}" 渲染完成 | 方块数: ${visibleBlocks.length} | 耗时: ${renderTime}秒${layerInfo} | 位置: (${projection.position.x}, ${projection.position.y}, ${projection.position.z})`);
            }
        });
    }

    // 更新玩家的投影方块列表，重新计算可见方块
    updateBlocks(playerXuid, newBlocks) {
        const task = this.activeProjections.get(playerXuid);
        if (!task) return;

        const newVisible = this.getAllBlocksWorldPos(newBlocks, task.projection);

        task.allBlocks = newBlocks;
        task.blocks = newBlocks;
        task.visibleBlocks = newVisible;
        task.lastParticleRespawn = Date.now();

        if (task.visibleBlocksIndex >= newVisible.length) {
            task.visibleBlocksIndex = 0;
        }

        task.isRendering = task.visibleBlocksIndex < newVisible.length;
    }

    // 统一渲染函数，分批渲染可见方块
    uniformRender(player, task, onComplete = null) {
        const { visibleBlocks } = task;

        if (!visibleBlocks || visibleBlocks.length === 0) {
            task.isInitialRender = false;
            task.isRendering = false;
            if (onComplete) onComplete();
            return;
        }

        const totalBlocks = visibleBlocks.length;
        const batchSize = MAX_PARTICLES_PER_TICK;
        let rendered = 0;

        const renderBatch = () => {
            const startIdx = task.visibleBlocksIndex;
            const endIdx = Math.min(startIdx + batchSize, totalBlocks);

            for (let i = startIdx; i < endIdx; i++) {
                const block = visibleBlocks[i];
                const posKey = `${block.worldPos[0]},${block.worldPos[1]},${block.worldPos[2]}`;

                if (!this.placedBlocks.has(posKey)) {
                    try {
                        this.spawnProjectionParticle(player, block.worldPos, block, false);
                        rendered++;
                    } catch (e) {
                        // ignore
                    }
                }
            }

            task.visibleBlocksIndex = endIdx;

            if (task.visibleBlocksIndex < totalBlocks) {
                setImmediate(renderBatch);
            } else {
                task.isInitialRender = false;
                task.isRendering = false;
                if (onComplete) onComplete();
            }
        };

        renderBatch();
    }

    // 清除玩家的投影
    clearPlayerProjection(player) {
        this.renderTasks.delete(player.xuid);
        this.activeProjections.delete(player.xuid);

        const particles = this.playerParticles.get(player.xuid);
        if (particles) {
            // 释放粒子池中的对象（可选）
            for (const particle of particles) {
                this.particlePool.release(particle);
            }
        }
        this.playerParticles.delete(player.xuid);

        const placedBlocks = this.playerBlocks.get(player.xuid);
        if (placedBlocks) {
            this.playerBlocks.delete(player.xuid);
        }
    }

    // 显示投影的边界框，使用粒子渲染
    showBounds(projection, player) {
        try {
            if (!projection || !player || !player.spawnParticle) return;
            const dims = projection.dimensions;
            if (!dims) return;
            const pos = projection.position;
            if (!pos) return;

            const corners = [
                [0, 0, 0], [dims.x, 0, 0], [dims.x, 0, dims.z], [0, 0, dims.z],
                [0, dims.y, 0], [dims.x, dims.y, 0], [dims.x, dims.y, dims.z], [0, dims.y, dims.z]
            ];

            const edges = [
                [0, 1], [1, 2], [2, 3], [3, 0],
                [4, 5], [5, 6], [6, 7], [7, 4],
                [0, 4], [1, 5], [2, 6], [3, 7]
            ];

            for (const [a, b] of edges) {
                const from = corners[a];
                const to = corners[b];
                const steps = Math.max(1, Math.ceil(Math.max(
                    Math.abs(to[0] - from[0]),
                    Math.abs(to[1] - from[1]),
                    Math.abs(to[2] - from[2])
                )));

                for (let i = 0; i <= steps; i++) {
                    const t = steps === 0 ? 0 : i / steps;
                    const px = pos.x + from[0] + (to[0] - from[0]) * t;
                    const py = pos.y + from[1] + (to[1] - from[1]) * t;
                    const pz = pos.z + from[2] + (to[2] - from[2]) * t;

                    mc.spawnParticle(px, py, pz, player.dim || 0, 'minecraft:basic_particle');
                }
            }
        } catch (e) {
            // ignore
        }
    }

    // 取消渲染玩家的投影
    cancelRender(player) {
        const task = this.activeProjections.get(player.xuid);
        if (!task) {
            player.tell('§c当前没有正在渲染的投影');
            return false;
        }

        this.clearPlayerProjection(player);
        player.tell('§a投影渲染已取消');
        return true;
    }

    // 加载投影数据并开始渲染
    loadProjection(player, projectionId) {
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

        this.loadedProjections.set(player.xuid, projectionId);
        this.startRender(player, projection, -1, true);
        player.tell(`§a已加载投影: ${projection.name}`);
        return true;
    }

    // 获取玩家当前的投影任务
    getPlayerProjection(player) {
        const task = this.renderTasks.get(player.xuid);
        return task ? task.projection : null;
    }

    // 检查玩家是否已加载指定的投影
    isProjectionLoaded(player, projectionId) {
        const loadedId = this.loadedProjections.get(player.xuid);
        return loadedId === projectionId;
    }

    // 将十六进制颜色值转换为RGB
    hexToRGB(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16) / 255,
            g: parseInt(result[2], 16) / 255,
            b: parseInt(result[3], 16) / 255
        } : { r: 0, g: 1, b: 0 };
    }

    // 旋转投影
    rotateProjection(projection, degrees) {
        const newRotation = (projection.rotation + degrees) % 360;
        return { ...projection, rotation: newRotation };
    }

    // 镜像投影
    getPlayerLookingLayer(player, projection) {
        const pitch = player.direction.pitch;

        if (pitch < -30) {
            return Math.min(projection.buildLayer + 1, projection.dimensions.y - 1);
        } else if (pitch > 30) {
            return Math.max(projection.buildLayer - 1, 0);
        }

        return projection.buildLayer;
    }
}

module.exports = { ProjectionRenderer };
