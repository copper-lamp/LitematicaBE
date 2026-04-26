const { PositionConverter } = require('./PositionConverter');

class Raycaster {
    static STEP_SIZE = 0.2;
    static MAX_DISTANCE = 7;

    constructor(projectionManager) {
        this.projectionManager = projectionManager;
        this.positionConverter = new PositionConverter();
    }

    getTargetedProjectionBlock(player, options = {}) {
        const maxDistance = options.maxDistance || Raycaster.MAX_DISTANCE;
        const collideWithWorldBlocks = options.collideWithWorldBlocks !== false;
        const filterByLayer = options.filterByLayer !== false;
        
        const startLocation = this.getPlayerHeadLocation(player);
        const direction = this.getPlayerViewDirection(player);
        
        if (!startLocation || !direction) {
            return null;
        }

        const activeProj = this.projectionManager.getActiveProjectionByPlayer(player);
        if (!activeProj || !activeProj.projection) {
            return null;
        }

        const projection = activeProj.projection;
        const currentLayer = activeProj.renderLayer;
        
        let location = { ...startLocation };
        let distance = 0;

        while (distance < maxDistance) {
            const rangeCheck = this.isInProjectionRange(location, projection);
            
            if (rangeCheck.inRange) {
                const projPos = this.positionConverter.worldToProjection(location, projection);
                
                if (filterByLayer && currentLayer !== -1) {
                    const blockLayer = Math.floor(projPos.y);
                    if (blockLayer !== currentLayer) {
                        location.x += direction.x * Raycaster.STEP_SIZE;
                        location.y += direction.y * Raycaster.STEP_SIZE;
                        location.z += direction.z * Raycaster.STEP_SIZE;
                        distance += Raycaster.STEP_SIZE;
                        continue;
                    }
                }
                
                const projBlock = this.findProjectionBlock(projection, projPos);
                
                if (projBlock && projBlock.name !== 'minecraft:air') {
                    const worldBlock = mc.getBlock(
                        Math.floor(location.x),
                        Math.floor(location.y),
                        Math.floor(location.z),
                        player.pos.dimid
                    );
                    
                    const blockType = worldBlock ? (worldBlock.type || worldBlock.name || '') : '';
                    const isPlaceable = !worldBlock || 
                        blockType === 'minecraft:air' || 
                        blockType === 'minecraft:water' ||
                        blockType === 'minecraft:lava' ||
                        blockType === 'minecraft:flowing_water' ||
                        blockType === 'minecraft:flowing_lava';
                    
                    if (isPlaceable) {
                        return {
                            location: {
                                x: Math.floor(location.x),
                                y: Math.floor(location.y),
                                z: Math.floor(location.z),
                                dimid: player.pos.dimid
                            },
                            projBlock: projBlock,
                            projection: projection
                        };
                    }
                    
                    if (collideWithWorldBlocks && !isPlaceable) {
                        break;
                    }
                }
            }

            location.x += direction.x * Raycaster.STEP_SIZE;
            location.y += direction.y * Raycaster.STEP_SIZE;
            location.z += direction.z * Raycaster.STEP_SIZE;
            distance += Raycaster.STEP_SIZE;
        }

        return null;
    }

    getPlayerHeadLocation(player) {
        try {
            const pos = player.pos;
            return {
                x: pos.x,
                y: pos.y + 1.62,
                z: pos.z
            };
        } catch (e) {
            logger.warn(`[Raycaster] Failed to get player head location: ${e.message}`);
            return null;
        }
    }

    getPlayerViewDirection(player) {
        try {
            const direction = player.direction;
            if (!direction) {
                logger.warn(`[Raycaster] player.direction is null`);
                return null;
            }
            
            const yaw = direction.yaw * Math.PI / 180;
            const pitch = direction.pitch * Math.PI / 180;
            
            return {
                x: -Math.sin(yaw) * Math.cos(pitch),
                y: Math.sin(pitch),
                z: Math.cos(yaw) * Math.cos(pitch)
            };
        } catch (e) {
            logger.warn(`[Raycaster] Failed to get player view direction: ${e.message}`);
            return null;
        }
    }

    isInProjectionRange(pos, projection) {
        const pPos = projection.position;
        const dim = projection.dimensions;

        if (!pPos || !dim) {
            return { inRange: false, reason: 'projection data is null' };
        }

        if (projection.dimension !== undefined && pos.dimid !== projection.dimension) {
            return { inRange: false, reason: 'dimension mismatch' };
        }

        if (pos.x < pPos.x || pos.x >= pPos.x + dim.x) {
            return { inRange: false, reason: 'x out of range' };
        }

        if (pos.y < pPos.y || pos.y >= pPos.y + dim.y) {
            return { inRange: false, reason: 'y out of range' };
        }

        if (pos.z < pPos.z || pos.z >= pPos.z + dim.z) {
            return { inRange: false, reason: 'z out of range' };
        }

        return { inRange: true, reason: 'in range' };
    }

    findProjectionBlock(projection, projPos) {
        if (!projection.blocks) return null;

        const targetX = Math.floor(projPos.x);
        const targetY = Math.floor(projPos.y);
        const targetZ = Math.floor(projPos.z);

        for (const block of projection.blocks) {
            if (block.pos[0] === targetX &&
                block.pos[1] === targetY &&
                block.pos[2] === targetZ) {
                return block;
            }
        }
        return null;
    }

    getTargetedBlocks(player, options = {}) {
        const maxDistance = options.maxDistance || Raycaster.MAX_DISTANCE;
        const maxCount = options.maxCount || 10;
        
        const startLocation = this.getPlayerHeadLocation(player);
        const direction = this.getPlayerViewDirection(player);
        
        if (!startLocation || !direction) {
            return [];
        }

        const activeProj = this.projectionManager.getActiveProjectionByPlayer(player);
        if (!activeProj || !activeProj.projection) {
            return [];
        }

        const projection = activeProj.projection;
        const blocks = [];
        const visitedLocations = new Set();
        
        let location = { ...startLocation };
        let distance = 0;

        while (distance < maxDistance && blocks.length < maxCount) {
            const blockKey = `${Math.floor(location.x)},${Math.floor(location.y)},${Math.floor(location.z)}`;
            
            if (!visitedLocations.has(blockKey)) {
                visitedLocations.add(blockKey);
                
                const rangeCheck = this.isInProjectionRange(location, projection);
                
                if (rangeCheck.inRange) {
                    const projPos = this.positionConverter.worldToProjection(location, projection);
                    const projBlock = this.findProjectionBlock(projection, projPos);
                    
                    if (projBlock && projBlock.name !== 'minecraft:air') {
                        const worldBlock = mc.getBlock(
                            Math.floor(location.x),
                            Math.floor(location.y),
                            Math.floor(location.z),
                            player.pos.dimid
                        );
                        
                        const blockType = worldBlock ? (worldBlock.type || worldBlock.name || '') : '';
                        const isPlaceable = !worldBlock || 
                            blockType === 'minecraft:air' || 
                            blockType === 'minecraft:water' ||
                            blockType === 'minecraft:lava';
                        
                        if (isPlaceable) {
                            blocks.push({
                                location: {
                                    x: Math.floor(location.x),
                                    y: Math.floor(location.y),
                                    z: Math.floor(location.z),
                                    dimid: player.pos.dimid
                                },
                                projBlock: projBlock,
                                projection: projection
                            });
                        }
                    }
                }
            }

            location.x += direction.x * Raycaster.STEP_SIZE;
            location.y += direction.y * Raycaster.STEP_SIZE;
            location.z += direction.z * Raycaster.STEP_SIZE;
            distance += Raycaster.STEP_SIZE;
        }

        return blocks;
    }
}

module.exports = { Raycaster };
