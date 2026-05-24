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

        if (worldType !== projType) {
            return VerificationLevel.NO_MATCH;
        }

        if (this.exactMatch(worldBlock, projectionBlock)) {
            return VerificationLevel.MATCH;
        }

        if (this.typeMatch(worldBlock, projectionBlock)) {
            return VerificationLevel.TYPE_MATCH;
        }

        return VerificationLevel.NO_MATCH;
    }

    exactMatch(worldBlock, projectionBlock) {
        const worldType = this.normalizeBlockName(worldBlock.type || worldBlock.name || '');
        const projType = this.normalizeBlockName(projectionBlock.name);

        if (worldType !== projType) {
            return false;
        }

        const worldStates = worldBlock.blockState || worldBlock.states || {};
        const projStates = projectionBlock.state || {};

        const importantStates = this.getImportantStates(projType);
        
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
        
        const stateMap = {
            'stone': [],
            'dirt': [],
            'grass_block': ['snowy'],
            'planks': [],
            'log': ['axis'],
            'leaves': ['persistent', 'distance'],
            'stairs': ['facing', 'half', 'shape'],
            'slab': ['type', 'waterlogged'],
            'fence': ['waterlogged'],
            'fence_gate': ['facing', 'in_wall', 'open'],
            'door': ['facing', 'half', 'hinge', 'open', 'powered'],
            'trapdoor': ['facing', 'half', 'open', 'powered', 'waterlogged'],
            'button': ['facing', 'face', 'powered'],
            'lever': ['facing', 'face', 'powered'],
            'pressure_plate': ['powered'],
            'redstone_wire': ['power'],
            'redstone_torch': ['lit'],
            'redstone_lamp': ['lit'],
            'repeater': ['facing', 'powered', 'delay'],
            'comparator': ['facing', 'powered', 'mode'],
            'piston': ['facing', 'extended'],
            'sticky_piston': ['facing', 'extended'],
            'observer': ['facing', 'powered'],
            'dispenser': ['facing', 'triggered'],
            'dropper': ['facing', 'triggered'],
            'hopper': ['facing', 'enabled'],
            'chest': ['facing', 'waterlogged'],
            'ender_chest': ['facing', 'waterlogged'],
            'furnace': ['facing', 'lit'],
            'blast_furnace': ['facing', 'lit'],
            'smoker': ['facing', 'lit'],
            'bed': ['facing', 'part', 'occupied'],
            'banner': ['facing', 'rotation'],
            'sign': ['facing', 'rotation', 'waterlogged'],
            'wall_sign': ['facing', 'waterlogged'],
            'torch': ['facing'],
            'wall_torch': ['facing'],
            'ladder': ['facing', 'waterlogged'],
            'vine': ['facing'],
            'crafting_table': [],
            'anvil': ['facing', 'damage'],
            'grindstone': ['facing', 'attachment'],
            'stonecutter': ['facing'],
            'loom': ['facing'],
            'barrel': ['facing', 'open'],
            'smoker': ['facing', 'lit'],
            'blast_furnace': ['facing', 'lit'],
            'campfire': ['facing', 'lit', 'signal_fire', 'waterlogged'],
            'soul_campfire': ['facing', 'lit', 'signal_fire', 'waterlogged'],
            'lantern': ['hanging', 'waterlogged'],
            'soul_lantern': ['hanging', 'waterlogged'],
            'bell': ['facing', 'attachment', 'powered'],
            'lectern': ['facing', 'has_book', 'powered'],
            'composter': ['level'],
            'cauldron': ['level'],
            'water_cauldron': ['level'],
            'lava_cauldron': [],
            'powder_snow_cauldron': ['level']
        };

        return stateMap[baseName] || [];
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

        if (!projection || !projection.blocks) {
            return results;
        }

        const pos = projection.position;
        const dim = projection.dimension;

        // 支持 Mega 投影：通过 blockChunks / blockIndex 获取方块
        let blocksToVerify = projection.blocks;
        if (projection.isMega && projection.schematicId && global.megaManager) {
            // Mega 模式下，尝试从所有分块加载方块
            blocksToVerify = this._getMegaBlocks(projection);
        }

        for (const projBlock of blocksToVerify) {
            if (projBlock.name === 'minecraft:air') {
                continue;
            }

            const worldX = pos.x + projBlock.pos[0];
            const worldY = pos.y + projBlock.pos[1];
            const worldZ = pos.z + projBlock.pos[2];

            const worldBlock = mc.getBlock(worldX, worldY, worldZ, dim);

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
}

module.exports = { BlockVerifier, VerificationLevel, VerificationColors };
