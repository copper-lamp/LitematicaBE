// BlockStateConverter - Java版到基岩版方块状态转换
// 提供完整的方块状态映射和转换功能

class BlockStateConverter {
    constructor() {
        // 初始化方块状态映射表
        this.initializeMappings();
    }

    /**
     * 初始化所有方块状态映射
     */
    initializeMappings() {
        // 铁轨类方块映射
        this.railShapeMap = {
            'north_south': 0,
            'east_west': 1,
            'ascending_east': 2,
            'ascending_west': 3,
            'ascending_north': 4,
            'ascending_south': 5,
            'south_east': 6,
            'south_west': 7,
            'north_west': 8,
            'north_east': 9
        };

        // 动力铁轨/探测铁轨/激活铁轨形状映射
        this.poweredRailShapeMap = {
            'north_south': 0,
            'east_west': 1,
            'ascending_east': 2,
            'ascending_west': 3,
            'ascending_north': 4,
            'ascending_south': 5
        };

        // 方向映射 (Java版字符串 -> 基岩版数值)
        this.facingDirectionMap = {
            'down': 0,
            'up': 1,
            'north': 2,
            'south': 3,
            'west': 4,
            'east': 5
        };

        // 楼梯方向映射
        this.stairsFacingMap = {
            'east': 0,
            'west': 1,
            'south': 2,
            'north': 3
        };

        // 门方向映射
        this.doorFacingMap = {
            'east': 0,
            'south': 1,
            'west': 2,
            'north': 3
        };

        // 栅栏门方向映射
        this.fenceGateFacingMap = {
            'south': 0,
            'west': 1,
            'north': 2,
            'east': 3
        };

        // 红石比较器/中继器方向映射
        this.redstoneFacingMap = {
            'south': 0,
            'west': 1,
            'north': 2,
            'east': 3
        };

        // 箱子方向映射
        this.chestFacingMap = {
            'north': 2,
            'south': 3,
            'west': 4,
            'east': 5
        };

        // 床方向映射
        this.bedFacingMap = {
            'south': 0,
            'west': 1,
            'north': 2,
            'east': 3
        };
    }

    /**
     * 转换方块名称：将Java版方块名称转换为基岩版
     * @param {string} blockName - Java版方块名称
     * @param {object} javaStates - Java版方块状态
     * @returns {string} - 基岩版方块名称
     */
    convertBlockName(blockName, javaStates) {
        // 动力铁轨 - Java版叫powered_rail，基岩版叫golden_rail
        if (blockName === 'minecraft:powered_rail') {
            return 'minecraft:golden_rail';
        }
        
        // 探测铁轨
        if (blockName === 'minecraft:detector_rail') {
            return 'minecraft:detector_rail';
        }
        
        // 激活铁轨
        if (blockName === 'minecraft:activator_rail') {
            return 'minecraft:activator_rail';
        }
        
        // 红石中继器
        if (blockName === 'minecraft:repeater') {
            // 根据powered状态选择正确的方块类型
            const powered = javaStates?.powered;
            if (powered === 'true' || powered === true) {
                return 'minecraft:powered_repeater';
            }
            return 'minecraft:unpowered_repeater';
        }
        
        // 红石比较器
        if (blockName === 'minecraft:comparator') {
            const powered = javaStates?.powered;
            if (powered === 'true' || powered === true) {
                return 'minecraft:powered_comparator';
            }
            return 'minecraft:unpowered_comparator';
        }
        
        // 熔炉
        if (blockName === 'minecraft:furnace') {
            const lit = javaStates?.lit;
            if (lit === 'true' || lit === true) {
                return 'minecraft:lit_furnace';
            }
            return 'minecraft:furnace';
        }
        
        // 红石火把
        if (blockName === 'minecraft:redstone_torch') {
            return 'minecraft:unlit_redstone_torch';
        }
        
        // 红石火把（亮）
        if (blockName === 'minecraft:redstone_wall_torch') {
            return 'minecraft:redstone_torch';
        }
        
        // 默认返回原名称
        return blockName;
    }

    /**
     * 主转换函数：将Java版方块状态转换为基岩版
     * @param {string} blockName - 方块名称
     * @param {object} javaStates - Java版方块状态
     * @returns {object} - 基岩版方块状态
     */
    convert(blockName, javaStates) {
        if (!javaStates || Object.keys(javaStates).length === 0) {
            return {};
        }

        // 根据方块类型选择转换器
        if (blockName === 'minecraft:rail') {
            return this.convertRail(javaStates);
        }
        
        if (blockName.includes('powered_rail') || 
            blockName.includes('detector_rail') || 
            blockName.includes('activator_rail')) {
            return this.convertPoweredRail(javaStates);
        }
        
        if (blockName.includes('stairs')) {
            return this.convertStairs(javaStates);
        }
        
        if (blockName.includes('door') && !blockName.includes('trapdoor')) {
            return this.convertDoor(javaStates);
        }
        
        if (blockName.includes('fence_gate')) {
            return this.convertFenceGate(javaStates);
        }
        
        if (blockName.includes('chest') || blockName.includes('trapped_chest')) {
            return this.convertChest(javaStates);
        }
        
        if (blockName.includes('hopper')) {
            return this.convertHopper(javaStates);
        }
        
        if (blockName.includes('dispenser') || blockName.includes('dropper')) {
            return this.convertDispenser(javaStates);
        }
        
        if (blockName.includes('piston')) {
            return this.convertPiston(javaStates);
        }
        
        if (blockName.includes('comparator')) {
            return this.convertComparator(javaStates);
        }
        
        if (blockName.includes('repeater')) {
            return this.convertRepeater(javaStates);
        }
        
        if (blockName.includes('lever')) {
            return this.convertLever(javaStates);
        }
        
        if (blockName.includes('button')) {
            return this.convertButton(javaStates);
        }
        
        if (blockName.includes('bed')) {
            return this.convertBed(javaStates);
        }
        
        if (blockName.includes('torch') && !blockName.includes('redstone')) {
            return this.convertTorch(javaStates);
        }
        
        if (blockName.includes('redstone_torch')) {
            return this.convertRedstoneTorch(javaStates);
        }
        
        if (blockName.includes('furnace')) {
            return this.convertFurnace(javaStates);
        }
        
        if (blockName.includes('ladder')) {
            return this.convertLadder(javaStates);
        }

        // 默认：直接返回原始状态（过滤waterlogged）
        return this.filterStates(javaStates);
    }

    /**
     * 转换铁轨状态
     */
    convertRail(states) {
        const result = {};
        if (states.shape) {
            result.rail_direction = this.railShapeMap[states.shape] || 0;
        }
        return result;
    }

    /**
     * 转换动力/探测/激活铁轨状态
     */
    convertPoweredRail(states) {
        const result = {};
        let direction = 0;
        
        if (states.shape) {
            direction = this.poweredRailShapeMap[states.shape] || 0;
        }
        
        // powered状态使用第4位 (0x8)
        if (states.powered === 'true' || states.powered === true) {
            direction |= 0x8;
        }
        
        result.rail_direction = direction;
        return result;
    }

    /**
     * 转换楼梯状态
     */
    convertStairs(states) {
        const result = {};
        let direction = 0;
        
        if (states.facing) {
            direction = this.stairsFacingMap[states.facing] || 0;
        }
        
        // 上半部分使用第3位 (0x4)
        if (states.half === 'top') {
            direction |= 0x4;
        }
        
        result.weirdo_direction = direction;
        return result;
    }

    /**
     * 转换门状态
     */
    convertDoor(states) {
        const result = {};
        
        if (states.half === 'upper') {
            // 上门扇
            let value = 0x8;
            if (states.hinge === 'right') {
                value |= 0x1;
            }
            if (states.powered === 'true' || states.powered === true) {
                value |= 0x2;
            }
            result.upper_block_bit = true;
            result.direction = value & 0x3;
        } else {
            // 下门扇
            let value = 0;
            if (states.facing) {
                value = this.doorFacingMap[states.facing] || 0;
            }
            if (states.open === 'true' || states.open === true) {
                value |= 0x4;
            }
            result.direction = value & 0x3;
            result.open_bit = (value & 0x4) !== 0;
        }
        
        return result;
    }

    /**
     * 转换栅栏门状态
     */
    convertFenceGate(states) {
        const result = {};
        let value = 0;
        
        if (states.facing) {
            value = this.fenceGateFacingMap[states.facing] || 0;
        }
        
        if (states.open === 'true' || states.open === true) {
            value |= 0x4;
        }
        
        if (states.powered === 'true' || states.powered === true) {
            value |= 0x8;
        }
        
        result.direction = value & 0x3;
        result.open_bit = (value & 0x4) !== 0;
        return result;
    }

    /**
     * 转换箱子状态
     */
    convertChest(states) {
        const result = {};
        if (states.facing) {
            result.facing_direction = this.chestFacingMap[states.facing] || 2;
        }
        return result;
    }

    /**
     * 转换漏斗状态
     */
    convertHopper(states) {
        const result = {};
        let value = 0;
        
        if (states.facing) {
            value = this.facingDirectionMap[states.facing] || 0;
        }
        
        // 未激活状态使用第4位
        if (states.enabled === 'false' || states.enabled === false) {
            value |= 0x8;
        }
        
        result.facing_direction = value;
        return result;
    }

    /**
     * 转换发射器/投掷器状态
     */
    convertDispenser(states) {
        const result = {};
        if (states.facing) {
            result.facing_direction = this.facingDirectionMap[states.facing] || 0;
        }
        return result;
    }

    /**
     * 转换活塞状态
     */
    convertPiston(states) {
        const result = {};
        let value = 0;
        
        if (states.facing) {
            value = this.facingDirectionMap[states.facing] || 0;
        }
        
        if (states.extended === 'true' || states.extended === true) {
            value |= 0x8;
        }
        
        result.facing_direction = value;
        return result;
    }

    /**
     * 转换红石比较器状态
     */
    convertComparator(states) {
        const result = {};
        let value = 0;
        
        if (states.facing) {
            value = this.redstoneFacingMap[states.facing] || 0;
        }
        
        if (states.mode === 'subtract') {
            value |= 0x4;
        }
        
        if (states.powered === 'true' || states.powered === true) {
            value |= 0x8;
        }
        
        result.direction = value & 0x3;
        result.output_subtract_bit = (value & 0x4) !== 0;
        result.output_lit_bit = (value & 0x8) !== 0;
        return result;
    }

    /**
     * 转换红石中继器状态
     */
    convertRepeater(states) {
        const result = {};
        let value = 0;
        
        if (states.facing) {
            value = this.redstoneFacingMap[states.facing] || 0;
        }
        
        // delay: 1-4 对应位 2-3
        const delay = parseInt(states.delay) || 1;
        value |= ((delay - 1) & 0x3) << 2;
        
        result.direction = value & 0x3;
        result.repeater_delay = (value >> 2) & 0x3;
        return result;
    }

    /**
     * 转换拉杆状态
     */
    convertLever(states) {
        const result = {};
        let value = 0;
        
        // 根据face和facing计算方向值
        // 基岩版使用 lever_direction 数值 (0-7)
        if (states.face === 'floor') {
            if (states.facing === 'south') value = 0; // down_north_south
            else if (states.facing === 'north') value = 0;
            else if (states.facing === 'west') value = 1; // down_east_west  
            else if (states.facing === 'east') value = 1;
        } else if (states.face === 'wall') {
            // 挂在墙上的拉杆
            if (states.facing === 'north') value = 5; // north (attached to north wall, faces south)
            else if (states.facing === 'south') value = 4; // south
            else if (states.facing === 'west') value = 3; // west
            else if (states.facing === 'east') value = 2; // east
        } else if (states.face === 'ceiling') {
            value = 0;
        }
        
        if (states.powered === 'true' || states.powered === true) {
            value |= 0x8;
        }
        
        // 基岩版使用 lever_direction 数值
        result.lever_direction = value & 0x7;
        result.open_bit = (value & 0x8) !== 0;
        
        return result;
    }
        
    /**
     * 转换按钮状态
     */
    convertButton(states) {
        const result = {};
        let value = 0;
        
        if (states.facing) {
            value = this.facingDirectionMap[states.facing] || 0;
        }
        
        if (states.powered === 'true' || states.powered === true) {
            value |= 0x8;
        }
        
        result.facing_direction = value & 0x7;
        result.button_pressed_bit = (value & 0x8) !== 0;
        return result;
    }

    /**
     * 转换床状态
     */
    convertBed(states) {
        const result = {};
        let value = 0;
        
        if (states.facing) {
            value = this.bedFacingMap[states.facing] || 0;
        }
        
        if (states.occupied === 'true' || states.occupied === true) {
            value |= 0x4;
        }
        
        if (states.part === 'head') {
            value |= 0x8;
        }
        
        result.direction = value & 0x3;
        result.occupied_bit = (value & 0x4) !== 0;
        result.head_piece_bit = (value & 0x8) !== 0;
        return result;
    }

    /**
     * 转换火把状态
     */
    convertTorch(states) {
        const result = {};
        if (states.facing) {
            const facingMap = {
                'up': 'unknown',
                'north': 'north',
                'south': 'south',
                'west': 'west',
                'east': 'east'
            };
            result.torch_facing_direction = facingMap[states.facing] || 'unknown';
        }
        return result;
    }

    /**
     * 转换红石火把状态
     */
    convertRedstoneTorch(states) {
        const result = {};
        if (states.facing) {
            const facingMap = {
                'up': 'unknown',
                'north': 'north',
                'south': 'south',
                'west': 'west',
                'east': 'east'
            };
            result.torch_facing_direction = facingMap[states.facing] || 'unknown';
        }
        // 红石火把总是亮的
        result.lit = true;
        return result;
    }

    /**
     * 转换熔炉状态
     */
    convertFurnace(states) {
        const result = {};
        if (states.facing) {
            result.facing_direction = this.facingDirectionMap[states.facing] || 2;
        }
        if (states.lit === 'true' || states.lit === true) {
            // 熔炉的lit状态通常通过方块类型区分（furnace vs lit_furnace）
            // 这里只设置方向
        }
        return result;
    }

    /**
     * 转换梯子状态
     */
    convertLadder(states) {
        const result = {};
        if (states.facing) {
            result.facing_direction = this.facingDirectionMap[states.facing] || 2;
        }
        return result;
    }

    /**
     * 过滤状态（移除waterlogged等不需要的状态）
     */
    filterStates(states) {
        const result = {};
        for (const [key, value] of Object.entries(states)) {
            if (key !== 'waterlogged') {
                result[key] = value;
            }
        }
        return result;
    }

    /**
     * 构建方块NBT对象用于mc.setBlock
     */
    buildBlockNbt(blockName, states) {
        // 转换方块名称为基岩版
        const bedrockBlockName = this.convertBlockName(blockName, states);
        
        // 转换方块状态
        const convertedStates = this.convert(blockName, states);
        
        // 创建states NBT对象
        const statesNbt = new NbtCompound();
        for (const [key, value] of Object.entries(convertedStates)) {
            if (typeof value === 'boolean') {
                statesNbt.setByte(key, value ? 1 : 0);
            } else if (typeof value === 'number') {
                statesNbt.setInt(key, value);
            } else {
                statesNbt.setString(key, String(value));
            }
        }
        
        // 创建方块NBT对象 - 使用正确的方式
        const blockNbt = new NbtCompound();
        blockNbt.setString("name", bedrockBlockName);
        blockNbt.setTag("states", statesNbt);
        blockNbt.setInt("version", 17959425);
        
        return blockNbt;
    }

    /**
     * 计算tileData（用于旧版API）
     */
    calculateTileData(blockName, states) {
        // 这里可以添加tileData计算逻辑，如果需要的话
        // 但推荐使用NBT方式
        return 0;
    }
}

// 创建单例实例
const converter = new BlockStateConverter();

module.exports = {
    BlockStateConverter,
    converter
};