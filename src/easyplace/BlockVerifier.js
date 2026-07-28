const { BlockStateConverters } = require('../mappings/BlockStateConverters');
const { BlockMappingRegistry } = require('../mappings/BlockMappingRegistry');

const VerificationLevel = Object.freeze({
    UNKNOWN: 0,
    NO_MATCH: 1,
    TYPE_MATCH: 2,
    MATCH: 3,
    MISSING: 4,
    AIR: 5,
    SKIPPED: 6
});

const VerificationColors = {
    [VerificationLevel.UNKNOWN]: { r: 0.5, g: 0.5, b: 0.5, name: '未知' },
    [VerificationLevel.NO_MATCH]: { r: 1.0, g: 0.0, b: 0.0, name: '错误方块' },
    [VerificationLevel.TYPE_MATCH]: { r: 1.0, g: 1.0, b: 0.0, name: '状态错误' },
    [VerificationLevel.MATCH]: { r: 0.0, g: 1.0, b: 0.0, name: '匹配' },
    [VerificationLevel.MISSING]: { r: 0.0, g: 0.0, b: 1.0, name: '缺失' },
    [VerificationLevel.AIR]: { r: 0.0, g: 0.0, b: 0.0, name: '空气' },
    [VerificationLevel.SKIPPED]: { r: 0.5, g: 0.5, b: 0.5, name: '跳过' }
};

class BlockVerifier {
    constructor() {
        this.ignoreStates = [
            'waterlogged',
            'lit',
            'powered',
            'extended',
            'open',
            'hinge',
            'half',
            'shape',
            'facing'
        ];
        this.verifyChunkSize = 5000; // 每tick验证方块数，避免卡顿
        this.stateConverter = new BlockStateConverters();
        this.blockRegistry = new BlockMappingRegistry();
    }

    verify(worldBlock, projectionBlock) {
        if (!worldBlock && !projectionBlock) {
            return VerificationLevel.UNKNOWN;
        }

        const worldType = worldBlock ? this.normalizeBlockName(worldBlock.type || worldBlock.name || '') : '';
        const projType = projectionBlock ? this.normalizeBlockName(projectionBlock.name) : '';

        if (!projectionBlock || projType === 'minecraft:air') {
            if (!worldBlock || worldType === 'minecraft:air') {
                return VerificationLevel.AIR;
            }
            return VerificationLevel.SKIPPED;
        }

        if (!worldBlock || worldType === 'minecraft:air') {
            return VerificationLevel.MISSING;
        }

        // Convert Java block name to BE name for comparison
        const mapping = this.blockRegistry.getMapping(projType);
        const beProjType = mapping ? this.normalizeBlockName(mapping.b) : projType;

        if (worldType !== beProjType) {
            return VerificationLevel.NO_MATCH;
        }

        if (this.exactMatch(worldBlock, projectionBlock, beProjType)) {
            return VerificationLevel.MATCH;
        }

        if (this.typeMatch(worldBlock, projectionBlock)) {
            return VerificationLevel.TYPE_MATCH;
        }

        return VerificationLevel.NO_MATCH;
    }

    exactMatch(worldBlock, projectionBlock, beProjTypeHint) {
        const worldType = this.normalizeBlockName(worldBlock.type || worldBlock.name || '');
        const projType = this.normalizeBlockName(projectionBlock.name);

        // Convert Java name to BE name for comparison
        const mapping = this.blockRegistry.getMapping(projType);
        const beProjType = beProjTypeHint || (mapping ? this.normalizeBlockName(mapping.b) : projType);

        if (worldType !== beProjType) {
            return false;
        }

        const worldStates = worldBlock.blockState || worldBlock.states || {};
        const javaStates = projectionBlock.state || {};

        // Convert Java states to BE states for fair comparison
        const projStates = this.stateConverter.convertJavaToBedrock(projType, javaStates);

        const importantStates = this.getImportantStates(beProjType);

        for (const key of importantStates) {
            const worldValue = worldStates[key];
            const projValue = projStates[key];

            if (worldValue !== projValue) {
                return false;
            }
        }

        return true;
    }

    typeMatch(worldBlock, projectionBlock) {
        const worldType = this.normalizeBlockName(worldBlock.type || worldBlock.name || '');
        const projType = this.normalizeBlockName(projectionBlock.name);

        return worldType === projType;
    }

    getImportantStates(blockName) {
        const baseName = blockName.replace('minecraft:', '');

        // BE state names for verification
        const stateMap = {
            'stone': [],
            'dirt': [],
            'grass_block': ['snowy'],
            'planks': [],
            'log': ['pillar_axis'],
            'leaves': ['persistent_bit', 'update_bit'],
            'stairs': ['weirdo_direction', 'upside_down_bit'],
            'slab': ['top_slot_bit'],
            'fence': [],
            'fence_gate': ['direction', 'in_wall_bit', 'open_bit'],
            'door': ['direction', 'upper_block_bit', 'door_hinge_bit', 'open_bit'],
            'trapdoor': ['direction', 'upside_down_bit', 'open_bit'],
            'button': ['facing_direction', 'button_pressed_bit'],
            'lever': ['lever_direction', 'open_bit'],
            'pressure_plate': ['redstone_signal'],
            'redstone_wire': ['redstone_signal'],
            'redstone_torch': ['torch_facing_direction'],
            'redstone_lamp': [],
            'repeater': ['direction', 'powered_bit', 'repeater_delay'],
            'comparator': ['direction', 'output_lit_bit', 'output_subtract_bit'],
            'piston': ['facing_direction', 'extended_bit'],
            'sticky_piston': ['facing_direction', 'extended_bit'],
            'observer': ['facing_direction', 'powered_bit'],
            'dispenser': ['facing_direction', 'triggered_bit'],
            'dropper': ['facing_direction', 'triggered_bit'],
            'hopper': ['facing_direction', 'toggle_bit'],
            'chest': ['facing_direction'],
            'ender_chest': ['facing_direction'],
            'furnace': ['facing_direction', 'lit'],
            'blast_furnace': ['facing_direction', 'lit'],
            'smoker': ['facing_direction', 'lit'],
            'bed': ['direction', 'head_piece_bit', 'occupied_bit'],
            'banner': ['ground_sign_direction'],
            'sign': ['ground_sign_direction'],
            'wall_sign': ['facing_direction'],
            'torch': ['torch_facing_direction'],
            'wall_torch': ['torch_facing_direction'],
            'ladder': ['facing_direction'],
            'vine': ['vine_direction_bits'],
            'crafting_table': [],
            'anvil': ['direction', 'damage'],
            'grindstone': ['direction', 'attachment'],
            'stonecutter': ['direction'],
            'loom': ['direction'],
            'barrel': ['facing_direction', 'open_bit'],
            'campfire': ['direction', 'lit', 'extinguished'],
            'soul_campfire': ['direction', 'lit', 'extinguished'],
            'lantern': ['hanging'],
            'soul_lantern': ['hanging'],
            'bell': ['direction', 'attachment', 'toggle_bit'],
            'lectern': ['direction', 'powered_bit'],
            'composter': ['composter_fill_level'],
            'cauldron': ['fill_level'],
            'water_cauldron': ['fill_level'],
            'lava_cauldron': [],
            'powder_snow_cauldron': ['fill_level'],
            'concrete': ['color'],
            'wool': ['color'],
            'carpet': ['color'],
            'terracotta': ['color'],
            'stained_glass': ['color'],
            'stained_glass_pane': ['color'],
            'shulker_box': ['color'],
            'candle': ['color', 'candles', 'lit_bit'],
            'candle_cake': ['lit_bit']
        };

        // Also check for suffix matches (e.g., oak_stairs -> stairs)
        const keys = Object.keys(stateMap);
        for (const key of keys) {
            if (baseName.endsWith('_' + key) || baseName === key) {
                return stateMap[key];
            }
        }

        return [];
    }

    normalizeBlockName(name) {
        if (!name) return '';
        let n = name.toLowerCase().trim();
        if (!n.includes(':')) n = `minecraft:${n}`;
        return n;
    }

    getVerificationColor(level) {
        return VerificationColors[level] || VerificationColors[VerificationLevel.UNKNOWN];
    }

    getVerificationName(level) {
        return VerificationColors[level]?.name || '未知';
    }

    verifyProjection(projection, startOffset = { x: 0, y: 0, z: 0 }) {
        const results = {
            total: 0,
            match: 0,
            typeMatch: 0,
            noMatch: 0,
            missing: 0,
            air: 0,
            blocks: []
        };

        if (!projection) {
            return results;
        }

        // Mega 投影可能没有 blocks 属性，但可以通过分块加载
        const isMega = projection.isMega && projection.schematicId && global.megaManager;
        if (!projection.blocks && !isMega) {
            return results;
        }

        const pos = projection.position;
        if (!pos) {
            return results;
        }
        // 确保 dimid 是有效数字，否则 mc.getBlock 会抛 "Wrong type of argument"
        const dim = (typeof projection.dimension === 'number') ? projection.dimension : (parseInt(projection.dimension) || 0);

        // 支持 Mega 投影：通过 blockChunks / blockIndex 获取方块
        let blocksToVerify = projection.blocks;
        if (isMega) {
            // Mega 模式下，尝试从所有分块加载方块
            blocksToVerify = this._getMegaBlocks(projection);
        }

        if (!blocksToVerify || blocksToVerify.length === 0) {
            return results;
        }

        for (let i = 0; i < blocksToVerify.length; i++) {
            const projBlock = blocksToVerify[i];
            if (projBlock.name === 'minecraft:air') {
                continue;
            }

            const worldX = pos.x + projBlock.pos[0];
            const worldY = pos.y + projBlock.pos[1];
            const worldZ = pos.z + projBlock.pos[2];

            let worldBlock = null;
            try {
                worldBlock = mc.getBlock(worldX, worldY, worldZ, dim);
            } catch (e) {
                // 区块未加载或坐标无效，跳过
            }

            const level = this.verify(worldBlock, projBlock);

            results.total++;

            switch (level) {
                case VerificationLevel.MATCH:
                    results.match++;
                    break;
                case VerificationLevel.TYPE_MATCH:
                    results.typeMatch++;
                    break;
                case VerificationLevel.NO_MATCH:
                    results.noMatch++;
                    break;
                case VerificationLevel.MISSING:
                    results.missing++;
                    break;
                case VerificationLevel.AIR:
                    results.air++;
                    break;
            }

            if (level !== VerificationLevel.MATCH && level !== VerificationLevel.AIR) {
                results.blocks.push({
                    position: { x: worldX, y: worldY, z: worldZ },
                    projectionBlock: projBlock,
                    worldBlock: worldBlock ? { type: worldBlock.type, states: worldBlock.blockState } : null,
                    level: level,
                    levelName: this.getVerificationName(level)
                });
            }
        }

        return results;
    }

    /**
     * 从 Mega 投影加载所有方块（用于验证）
     * @private
     */
    _getMegaBlocks(projection) {
        const blocks = [];
        try {
            const chunkFiles = global.megaManager.storage.listChunkFiles(projection.schematicId);
            for (const { cx, cy, cz } of chunkFiles) {
                const chunkBlocks = global.megaManager.loadChunkFromDisk(projection.schematicId, cx, cy, cz);
                if (chunkBlocks) {
                    for (const b of chunkBlocks) {
                        blocks.push({
                            pos: [b.pos[0], b.pos[1], b.pos[2]],
                            name: b.name,
                            state: b.state || {}
                        });
                    }
                }
            }
        } catch (e) {
            logger.error(`[BlockVerifier] Mega blocks load failed: ${e.message}`);
        }
        return blocks;
    }

    /**
     * 检测多余方块 — 世界中存在但投影中没有的方块
     * @param {Object} projection 投影对象
     * @param {number} maxScan 最大扫描数量（默认50000，防止过大投影卡死）
     * @returns {Object} { blocks: [...] }
     */
    detectExtraBlocks(projection, maxScan = 50000) {
        const result = { totalScanned: 0, extraCount: 0, extraBlocks: [] };
        if (!projection || !projection.position || !projection.dimensions) {
            return result;
        }

        const pos = projection.position;
        const dims = projection.dimensions;
        const dimid = (typeof projection.dimension === 'number') ? projection.dimension : (parseInt(projection.dimension) || 0);

        // 构建投影方块位置集合（O(1)查找）
        const projPosSet = new Set();
        let blocksToIndex = projection.blocks;
        if (projection.isMega && projection.schematicId && global.megaManager) {
            blocksToIndex = this._getMegaBlocks(projection);
        }

        for (const block of blocksToIndex) {
            if (block.name && block.name !== 'minecraft:air') {
                const wx = pos.x + (block.pos ? block.pos[0] : 0);
                const wy = pos.y + (block.pos ? block.pos[1] : 0);
                const wz = pos.z + (block.pos ? block.pos[2] : 0);
                projPosSet.add(`${wx},${wy},${wz}`);
            }
        }

        // 扫描投影区域的世界方块
        let scanned = 0;
        for (let dx = 0; dx < dims.x && scanned < maxScan; dx++) {
            for (let dz = 0; dz < dims.z && scanned < maxScan; dz++) {
                for (let dy = 0; dy < dims.y && scanned < maxScan; dy++) {
                    scanned++;
                    const wx = pos.x + dx;
                    const wy = pos.y + dy;
                    const wz = pos.z + dz;
                    const key = `${wx},${wy},${wz}`;

                    if (projPosSet.has(key)) continue; // 投影中有此方块，跳过

                    try {
                        const worldBlock = mc.getBlock(wx, wy, wz, dimid);
                        if (worldBlock && worldBlock.type && worldBlock.type !== 'minecraft:air') {
                            result.extraBlocks.push({
                                position: { x: wx, y: wy, z: wz },
                                type: worldBlock.type,
                                states: worldBlock.blockState || {}
                            });
                            result.extraCount++;
                        }
                    } catch (e) {
                        // 区块未加载，忽略
                    }
                }
            }
        }

        result.totalScanned = scanned;
        return result;
    }

    /**
     * 标记问题方块 — 在世界中生成彩色粒子标记
     * @param {Object} player 玩家对象
     * @param {Array} problemBlocks 问题方块列表 [{ position: {x,y,z}, level: 1|2|4 }]
     * @param {number} duration 标记持续时间（毫秒），默认 30000
     */
    markProblemBlocks(player, problemBlocks, duration = 30000) {
        if (!problemBlocks || problemBlocks.length === 0) return 0;

        const dimid = (typeof player.pos?.dimid === 'number') ? player.pos.dimid : (parseInt(player.pos?.dimid) || 0);
        let count = 0;
        const maxMark = 200; // 最多标记200个，防止卡服

        // 根据问题级别选择不同的粒子类型（使用基岩版有效粒子名）
        const particleMap = {
            [VerificationLevel.NO_MATCH]: 'minecraft:basic_flame_particle',    // 错误方块 → 火焰
            [VerificationLevel.TYPE_MATCH]: 'minecraft:villager_angry',       // 状态错误 → 愤怒
            [VerificationLevel.MISSING]: 'minecraft:blue_flame_particle',     // 缺失 → 蓝色火焰
            extra: 'minecraft:wax_particle'                                   // 多余 → 蜡
        };

        // 筛选出可标记的位置（区块已加载）
        const validPositions = [];
        for (const block of problemBlocks) {
            if (validPositions.length >= maxMark) break;

            const pos = block.position;
            if (!pos || typeof pos.x !== 'number') continue;

            // 检查区块是否已加载
            try {
                const testBlock = mc.getBlock(pos.x, pos.y, pos.z, dimid);
                // 即使返回 null（空气），只要不抛异常就说明区块已加载
                validPositions.push(block);
            } catch (e) {
                // 区块未加载，跳过此位置
            }
        }

        if (validPositions.length === 0) {
            return 0;
        }

        // 使用 setInterval 持续生成粒子，直到持续时间结束
        const intervalMs = 500; // 每 500ms 重新生成一次粒子
        const maxRounds = Math.floor(duration / intervalMs);
        let currentRound = 0;

        const spawnRound = () => {
            currentRound++;
            for (const block of validPositions) {
                const pos = block.position;
                const particleType = particleMap[block.level] || particleMap.extra;
                try {
                    if (player.spawnParticle) {
                        // 使用 player.spawnParticle (客户端粒子，只有该玩家可见)
                        player.spawnParticle(particleType, {
                            x: pos.x + 0.5,
                            y: pos.y + 0.5,
                            z: pos.z + 0.5
                        });
                    } else {
                        // 回退到命令方式
                        const dimName = dimid === 1 ? 'the_nether' : (dimid === 2 ? 'the_end' : 'overworld');
                        mc.runcmd(`execute in ${dimName} positioned ${pos.x + 0.5} ${pos.y + 0.5} ${pos.z + 0.5} run particle "${particleType}" ~ ~ ~`);
                    }
                } catch (e) {
                    // 粒子生成失败，静默跳过
                }
            }

            if (currentRound < maxRounds) {
                markTimer = setTimeout(spawnRound, intervalMs);
            } else {
                try { player.tell('§7问题方块标记已清除'); } catch (e) {}
            }
        };

        let markTimer = setTimeout(spawnRound, 0);
        count = validPositions.length;

        player.tell(`§a已标记 ${count} 个问题方块（§c火焰=错误 §e愤怒=状态错误 §b蓝焰=缺失 §6蜡粒=多余），持续 ${Math.floor(duration / 1000)} 秒`);

        return count;
    }
}

module.exports = { BlockVerifier, VerificationLevel, VerificationColors };
