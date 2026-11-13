// SchematicSaver - 原理图保存器

const { NBTWriter } = require('./NBTWriter');
const { McstructureWriter, estimateBytes, inferStateType } = require('./McstructureWriter');
const { readBlockStates, nbtTagToTree } = require('./LSENbtTree');
const { isAirName } = require('./McstructureLoader');

const FORMAT_LITEMATIC = 'litematic';
const FORMAT_MCSTRUCTURE = 'mcstructure';
const FORMAT_BOTH = 'both';

class SchematicSaver {
    constructor() {
        this.schematicsDir = './plugins/LitematicaBE/schematics/';
        this.ensureDirectory();
    }

    ensureDirectory() {
        if (!File.exists(this.schematicsDir)) {
            File.mkdir(this.schematicsDir);
        }
    }

    /** 实时读配置（/litematica:config reload 后立刻生效） */
    _config(key, defaultValue) {
        const cm = global.configManager;
        if (cm && typeof cm.get === 'function') {
            try {
                const v = cm.get(key, defaultValue);
                return v === undefined || v === null ? defaultValue : v;
            } catch (e) { /* 回退默认值 */ }
        }
        return defaultValue;
    }

    /** 单次 .mcstructure 导出的格数上限 */
    get mcstructureMaxVolume() {
        const v = Number(this._config('schematicSave.maxVolume', 1000000));
        return Number.isFinite(v) && v > 0 ? Math.floor(v) : 1000000;
    }

    /**
     * 选区体积检查（纯算术，**不读任何方块**）
     * @returns {{ok:boolean, volume:number, maxVolume:number, dimensions:{x,y,z}, estimatedBytes:number}}
     */
    checkMcstructureVolume(region) {
        const dims = {
            x: Math.abs(region.maxX - region.minX) + 1,
            y: Math.abs(region.maxY - region.minY) + 1,
            z: Math.abs(region.maxZ - region.minZ) + 1
        };
        const volume = dims.x * dims.y * dims.z;
        const maxVolume = this.mcstructureMaxVolume;
        return {
            ok: volume <= maxVolume,
            volume,
            maxVolume,
            dimensions: dims,
            estimatedBytes: estimateBytes(volume, {
                writeLiquidLayer: this._config('schematicSave.writeLiquidLayer', true) !== false
            })
        };
    }

    /**
     * 单遍扫描选区。两条链路共用同一个遍历，按 wantJava / wantBedrock 决定要产出哪一份。
     * @param {Object} region - {minX,minY,minZ,maxX,maxY,maxZ}
     * @param {number} dimension - 维度ID
     * @param {Object} [opts]
     * @param {boolean} [opts.wantJava=true] 产出 Java 名+Java 状态（.litematic 用）
     * @param {boolean} [opts.wantBedrock=false] 产出基岩名+带类型状态（.mcstructure 用）
     * @param {boolean} [opts.includeBlockEntities=false] 读方块实体 NBT（必须同时 wantBedrock）
     * @param {boolean} [opts.verbose=false] 逐格日志
     * @returns {{javaBlocks:Array, bedrockBlocks:Array, scanned:number, nonAir:number,
     *            entityBlocks:number, entitySkipped:number, dimensions:{x,y,z}}}
     */
    scanRegion(region, dimension, opts = {}) {
        const {
            wantJava = true,
            wantBedrock = false,
            includeBlockEntities = false,
            verbose = false
        } = opts;

        const { minX, minY, minZ, maxX, maxY, maxZ } = region;
        const dimId = parseInt(dimension, 10) || 0;
        const dims = { x: maxX - minX + 1, y: maxY - minY + 1, z: maxZ - minZ + 1 };

        const javaBlocks = [];
        const bedrockBlocks = [];
        let scanned = 0;
        let nonAir = 0;
        let entityBlocks = 0;
        let entitySkipped = 0;

        logger.info(`[SchematicSaver] scanRegion: (${minX},${minY},${minZ})→(${maxX},${maxY},${maxZ}) ` +
            `dim=${dimId} java=${wantJava} bedrock=${wantBedrock} be=${includeBlockEntities}`);

        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                for (let z = minZ; z <= maxZ; z++) {
                    scanned++;
                    let block = null;
                    try {
                        block = mc.getBlock(x, y, z, dimId);
                    } catch (e) {
                        if (verbose) logger.warn(`[SchematicSaver] mc.getBlock(${x},${y},${z},${dimId}) 抛错: ${e.message}`);
                        continue;
                    }
                    if (!block) {
                        if (verbose) logger.warn(`[SchematicSaver] mc.getBlock(${x},${y},${z},${dimId}) 返回 null`);
                        continue;
                    }

                    const blockName = block.type || block.name || 'minecraft:air';
                    // 注意：必须走 isAirName（精确匹配 air/cave_air/void_air/structure_void/*_air），
                    // 不能用 name.includes('air') —— 那会把 "oak_stairs" 整类楼梯当空气丢掉。
                    if (isAirName(blockName)) continue;

                    nonAir++;
                    const pos = [x - minX, y - minY, z - minZ];
                    if (verbose) logger.info(`[SchematicSaver] (${x},${y},${z}) ${blockName}`);

                    if (wantJava) {
                        const states = this.getBlockStates(block);
                        const javaBlock = this.convertToJavaBlock(blockName, states);
                        javaBlocks.push({ pos, name: javaBlock.name, states: javaBlock.states });
                    }

                    if (wantBedrock) {
                        const rec = { pos, name: blockName, states: this.readBedrockStates(block) };
                        if (includeBlockEntities) {
                            const tree = this.readBlockEntityTree(block);
                            if (tree) {
                                rec.blockEntity = tree;
                                entityBlocks++;
                            } else {
                                entitySkipped++;
                            }
                        }
                        bedrockBlocks.push(rec);
                    }
                }
            }
        }

        logger.info(`[SchematicSaver] scanRegion 完成: 扫描 ${scanned} 格，非空气 ${nonAir}，` +
            `java ${javaBlocks.length}，bedrock ${bedrockBlocks.length}，方块实体 ${entityBlocks}` +
            `${entitySkipped ? `（跳过 ${entitySkipped}）` : ''}`);

        return { javaBlocks, bedrockBlocks, scanned, nonAir, entityBlocks, entitySkipped, dimensions: dims };
    }

    /**
     * 扫描选区范围内的方块（.litematic 链路，保持原返回契约）
     * @param {Object} region - {minX, minY, minZ, maxX, maxY, maxZ}
     * @param {number} dimension - 维度ID
     * @returns {Array} 方块数组 [{pos: [x,y,z], name: string, states: Object}]
     */
    scanBlocks(region, dimension) {
        const { javaBlocks } = this.scanRegion(region, dimension, {
            wantJava: true,
            wantBedrock: false,
            verbose: !!this._config('schematicSave.verboseScan', false)
        });
        return javaBlocks;
    }

    /**
     * 读取基岩版方块状态（带 NBT 类型保真）
     * .mcstructure 的 states 值类型必须与 BDS 内部一致（Byte/Int/String 混用），
     * 所以优先走 getNbt().getTag('states') + getTypeOf；拿不到才用裸值兜底推断。
     * @returns {Object<string,{v:any,type:number}>}
     */
    readBedrockStates(block) {
        try {
            if (typeof block.getNbt === 'function') {
                const nbt = block.getNbt();
                const statesNbt = nbt && typeof nbt.getTag === 'function' ? nbt.getTag('states') : null;
                if (statesNbt) {
                    const typed = readBlockStates(statesNbt);
                    if (Object.keys(typed).length > 0) return typed;
                }
            }
        } catch (e) { /* 落到兜底 */ }

        const plain = this.getBlockStates(block);
        const out = {};
        for (const [k, v] of Object.entries(plain || {})) {
            out[k] = { v, type: inferStateType(k, v) };
        }
        return out;
    }

    /**
     * 读取方块实体 NBT 并转成 { type, value } 树（箱子/漏斗物品等）
     * 失败返回 null（该格只丢实体数据，不影响结构与整体导出）。
     */
    readBlockEntityTree(block) {
        try {
            if (typeof block.getBlockEntity !== 'function') return null;
            const be = block.getBlockEntity();
            if (!be || typeof be.getNbt !== 'function') return null;
            const nbt = be.getNbt();
            if (!nbt) return null;
            const tree = nbtTagToTree(nbt);
            if (!tree || tree.type !== 10) return null;
            if (!tree.value || Object.keys(tree.value).length === 0) return null;
            return tree;
        } catch (e) {
            return null;
        }
    }

    /**
     * 获取方块的NBT状态
     */
    getBlockStates(block) {
        const states = {};
        try {
            // 尝试从block获取states
            if (block.states) {
                const stateKeys = Object.keys(block.states);
                for (const key of stateKeys) {
                    states[key] = block.states[key];
                }
            }
            // 尝试通过NBT获取
            if (block.getNbt) {
                const nbt = block.getNbt();
                if (nbt && nbt.getTag('states')) {
                    const stateNbt = nbt.getTag('states');
                    const keys = stateNbt.getKeys();
                    for (const key of keys) {
                        try {
                            states[key] = stateNbt.getTag(key).get();
                        } catch (e) {}
                    }
                }
            }
        } catch (e) {}
        return states;
    }

    /**
     * 将基岩版方块转换为Java版格式
     */
    convertToJavaBlock(bedrockName, bedrockStates) {
        // 基础名称映射: 基岩版 -> Java版
        const nameMapping = this.getJavaBlockName(bedrockName);

        // 状态转换: 基岩版状态 -> Java版状态
        const javaStates = this.convertStatesToJava(nameMapping.javaName, bedrockStates);

        return {
            name: nameMapping.javaName,
            states: javaStates
        };
    }

    /**
     * 获取Java版方块名称
     */
    getJavaBlockName(bedrockName) {
        // 移除minecraft:前缀进行匹配
        const cleanName = bedrockName.replace('minecraft:', '');

        // 基岩版 -> Java版名称映射表
        const nameMap = {
            // 动力铁轨
            'golden_rail': 'powered_rail',
            // 熔炉
            'lit_furnace': 'furnace',
            // 红石中继器
            'powered_repeater': 'repeater',
            'unpowered_repeater': 'repeater',
            // 红石比较器
            'powered_comparator': 'comparator',
            'unpowered_comparator': 'comparator',
            // 红石火把
            'redstone_torch': 'redstone_wall_torch',
            'unlit_redstone_torch': 'redstone_torch',
            // 门
            'spruce_door': 'spruce_door',
            'birch_door': 'birch_door',
            'jungle_door': 'jungle_door',
            'acacia_door': 'acacia_door',
            'dark_oak_door': 'dark_oak_door',
            'mangrove_door': 'mangrove_door',
            'cherry_door': 'cherry_door',
            'bamboo_door': 'bamboo_door',
            'copper_door': 'copper_door',
            'warped_door': 'warped_door',
            'crimson_door': 'crimson_door',
            // 木头/原木
            'log': null, // 需要特殊处理
            'wood': null,
            // 树叶
            'leaves': null,
            'leaves2': null,
            // 楼梯
            'normal_stone_stairs': 'cobblestone_stairs',
            'stone_stairs': 'cobblestone_stairs',
            // 台阶
            'stone_slab': null, // 需要特殊处理
            'double_stone_slab': null,
            // 泥土
            'grass': 'grass_block',
            'grass_path': 'dirt_path',
            // 花
            'yellow_flower': 'dandelion',
            'red_flower': null, // 需要特殊处理
            // 其他
            'reeds': 'sugar_cane',
            'tallgrass': 'short_grass',
            'double_plant': null,
            'stained_glass': null,
            'stained_hardened_clay': null,
            'hardened_clay': 'terracotta',
            'carpet': null,
            'wool': null,
            'concrete': null,
            'concrete_powder': null,
            'planks': null,
            'fence': null,
            'wooden_button': 'oak_button',
            'wooden_pressure_plate': 'oak_pressure_plate',
            'trapdoor': 'oak_trapdoor',
            'fence_gate': 'oak_fence_gate',
            'boat': 'oak_boat',
            'sapling': null,
        };

        // 如果不需要特殊处理，直接返回
        if (!nameMap.hasOwnProperty(cleanName)) {
            return { javaName: bedrockName };
        }

        const mapped = nameMap[cleanName];
        if (mapped === null) {
            // 需要基于状态进一步判断
            return this.handleSpecialBlock(cleanName, bedrockStates);
        }

        return { javaName: `minecraft:${mapped}` };
    }

    /**
     * 处理需要基于状态判断的特殊方块
     */
    handleSpecialBlock(cleanName, states) {
        switch (cleanName) {
            case 'log': {
                const woodType = states.old_log_type || states.new_log_type || 'oak';
                const axis = states.pillar_axis || 'y';
                const javaName = `minecraft:${woodType}_log`;
                const javaStates = { axis: axis };
                return { javaName, javaStates };
            }
            case 'wood': {
                const woodType2 = states.wood_type || 'oak';
                return { javaName: `minecraft:${woodType2}_wood` };
            }
            case 'leaves': {
                const leafType = states.old_leaf_type || 'oak';
                return { javaName: `minecraft:${leafType}_leaves` };
            }
            case 'leaves2': {
                const leafType2 = states.new_leaf_type || 'acacia';
                return { javaName: `minecraft:${leafType2}_leaves` };
            }
            case 'red_flower': {
                const flowerType = states.flower_type || 'poppy';
                const flowerMap = {
                    'poppy': 'poppy',
                    'blue_orchid': 'blue_orchid',
                    'allium': 'allium',
                    'houstonia': 'azure_bluet',
                    'tulip_red': 'red_tulip',
                    'tulip_orange': 'orange_tulip',
                    'tulip_white': 'white_tulip',
                    'tulip_pink': 'pink_tulip',
                    'oxeye': 'oxeye_daisy',
                    'cornflower': 'cornflower',
                    'lily_of_the_valley': 'lily_of_the_valley'
                };
                return { javaName: `minecraft:${flowerMap[flowerType] || 'poppy'}` };
            }
            case 'stone_slab': {
                const slabType = states.stone_slab_type || 'smooth_stone';
                const slabMap = {
                    'smooth_stone': 'smooth_stone_slab',
                    'sandstone': 'sandstone_slab',
                    'wood': 'petrified_oak_slab',
                    'cobblestone': 'cobblestone_slab',
                    'brick': 'brick_slab',
                    'stone_brick': 'stone_brick_slab',
                    'quartz': 'quartz_slab',
                    'nether_brick': 'nether_brick_slab'
                };
                return { javaName: `minecraft:${slabMap[slabType] || 'smooth_stone_slab'}` };
            }
            case 'double_stone_slab': {
                const dSlabType = states.stone_slab_type || 'smooth_stone';
                const dSlabMap = {
                    'smooth_stone': 'smooth_stone_slab',
                    'sandstone': 'sandstone_slab',
                    'wood': 'petrified_oak_slab',
                    'cobblestone': 'cobblestone_slab',
                    'brick': 'brick_slab',
                    'stone_brick': 'stone_brick_slab',
                    'quartz': 'quartz_slab',
                    'nether_brick': 'nether_brick_slab'
                };
                return { javaName: `minecraft:${dSlabMap[dSlabType] || 'smooth_stone_slab'}` };
            }
            case 'planks': {
                const plankType = states.wood_type || 'oak';
                return { javaName: `minecraft:${plankType}_planks` };
            }
            case 'fence': {
                const fenceType = states.wood_type || 'oak';
                return { javaName: `minecraft:${fenceType}_fence` };
            }
            case 'sapling': {
                const saplingType = states.sapling_type || 'oak';
                return { javaName: `minecraft:${saplingType}_sapling` };
            }
            case 'carpet': {
                const carpetColor = states.color || 'white';
                return { javaName: `minecraft:${carpetColor}_carpet` };
            }
            case 'wool': {
                const woolColor = states.color || 'white';
                return { javaName: `minecraft:${woolColor}_wool` };
            }
            case 'stained_glass': {
                const sgColor = states.color || 'white';
                return { javaName: `minecraft:${sgColor}_stained_glass` };
            }
            case 'stained_hardened_clay': {
                const shcColor = states.color || 'white';
                return { javaName: `minecraft:${shcColor}_terracotta` };
            }
            case 'concrete': {
                const concreteColor = states.color || 'white';
                return { javaName: `minecraft:${concreteColor}_concrete` };
            }
            case 'concrete_powder': {
                const cpColor = states.color || 'white';
                return { javaName: `minecraft:${cpColor}_concrete_powder` };
            }
            case 'double_plant': {
                const plantType = states.double_plant_type || 'sunflower';
                const plantMap = {
                    'sunflower': 'sunflower',
                    'syringa': 'lilac',
                    'grass': 'tall_grass',
                    'fern': 'large_fern',
                    'rose': 'rose_bush',
                    'paeonia': 'peony'
                };
                return { javaName: `minecraft:${plantMap[plantType] || 'sunflower'}` };
            }
            default:
                return { javaName: `minecraft:${cleanName}` };
        }
    }

    /**
     * 将基岩版状态转换为Java版状态
     */
    convertStatesToJava(javaName, bedrockStates) {
        const javaStates = {};
        const cleanName = javaName.replace('minecraft:', '');

        // 通用状态转换
        for (const [key, value] of Object.entries(bedrockStates)) {
            // 跳过基岩版特有的状态
            if (key === 'stone_slab_type' || key === 'wood_type' || key === 'old_log_type' ||
                key === 'new_log_type' || key === 'old_leaf_type' || key === 'new_leaf_type' ||
                key === 'flower_type' || key === 'color' || key === 'double_plant_type' ||
                key === 'sapling_type' || key === 'sand_type' || key === 'dirt_type' ||
                key === 'stone_type' || key === 'torch_facing_direction') {
                continue;
            }

            // 转换状态名称和值
            const converted = this.convertStateKeyValue(key, value, cleanName);
            if (converted) {
                if (converted.key === '__stairs__') {
                    // 楼梯特殊处理: 同时设置facing和half
                    javaStates['facing'] = converted.value.facing;
                    javaStates['half'] = converted.value.half;
                } else if (converted.key === '__lever__') {
                    // 拉杆特殊处理: 同时设置face和facing
                    javaStates['face'] = converted.value.face;
                    javaStates['facing'] = converted.value.facing;
                } else {
                    javaStates[converted.key] = converted.value;
                }
            }
        }

        return javaStates;
    }

    /**
     * 转换单个状态的键和值
     */
    convertStateKeyValue(key, value, blockName) {
        // 状态键可能带命名空间：实测观察者的状态定义名就是 `minecraft:facing_direction`
        // （其它方块是短键）。不去前缀会整条漏掉 —— 历史 bug：保存出的 .litematic 里
        // 观察者带着基岩键名，Java 版认不出，朝向直接丢失。
        const bareKey = key.startsWith('minecraft:') ? key.slice('minecraft:'.length) : key;

        // 方向状态转换
        if (bareKey === 'facing_direction') {
            // 观察者这类方块的基岩值本身就是字符串（west/east/north/south/up/down），
            // 与 Java 的 facing 同名同义 → 原样透传，不要再套整型表。
            if (typeof value === 'string') {
                return { key: 'facing', value };
            }
            const facingMap = { 0: 'down', 1: 'up', 2: 'north', 3: 'south', 4: 'west', 5: 'east' };
            return { key: 'facing', value: facingMap[value] || 'north' };
        }

        if (key === 'direction') {
            // 门、床等使用direction数值
            if (blockName.includes('door') || blockName.includes('bed') ||
                blockName.includes('chest') || blockName.includes('furnace') ||
                blockName.includes('comparator') || blockName.includes('repeater')) {
                const dirMap = { 0: 'south', 1: 'west', 2: 'north', 3: 'east' };
                return { key: 'facing', value: dirMap[value] || 'south' };
            }
            // 其他情况保留原值
            return { key: 'facing', value: value };
        }

        // 铁轨方向
        if (key === 'rail_direction') {
            return { key: 'shape', value: this.convertRailShape(value) };
        }

        // 楼梯方向
        if (key === 'weirdo_direction') {
            const stairDir = value & 0x3;
            const upsideDown = (value & 0x4) !== 0;
            const stairFacing = { 0: 'east', 1: 'west', 2: 'south', 3: 'north' };
            return {
                key: '__stairs__',
                value: {
                    facing: stairFacing[stairDir] || 'east',
                    half: upsideDown ? 'top' : 'bottom'
                }
            };
        }

        // 拉杆方向
        if (key === 'lever_direction') {
            return this.convertLeverDirection(value);
        }

        // 门状态
        if (key === 'open_bit') {
            return { key: 'open', value: value ? 'true' : 'false' };
        }
        if (key === 'upper_block_bit') {
            return { key: 'half', value: value ? 'upper' : 'lower' };
        }
        if (key === 'door_hinge_bit') {
            return { key: 'hinge', value: value ? 'right' : 'left' };
        }

        // 红石相关
        if (key === 'repeater_delay') {
            return { key: 'delay', value: String((value & 0x3) + 1) };
        }
        if (key === 'output_subtract_bit') {
            return { key: 'mode', value: value ? 'subtract' : 'compare' };
        }
        if (key === 'output_lit_bit') {
            return { key: 'powered', value: value ? 'true' : 'false' };
        }
        if (key === 'button_pressed_bit') {
            return { key: 'powered', value: value ? 'true' : 'false' };
        }

        // 台阶
        if (key === 'top_slot_bit') {
            return { key: 'type', value: value ? 'top' : 'bottom' };
        }

        // 通用布尔值转换
        if (typeof value === 'boolean') {
            return { key: key, value: value ? 'true' : 'false' };
        }

        // 默认直接传递
        return { key: key, value: String(value) };
    }

    /**
     * 转换铁轨形状
     */
    convertRailShape(direction) {
        const shapes = [
            'north_south', 'east_west', 'ascending_east', 'ascending_west',
            'ascending_north', 'ascending_south', 'south_east', 'south_west',
            'north_west', 'north_east'
        ];
        return shapes[direction] || 'north_south';
    }

    /**
     * 转换拉杆方向
     */
    convertLeverDirection(direction) {
        const leverMap = {
            0: { face: 'floor', facing: 'south' },
            1: { face: 'floor', facing: 'west' },
            2: { face: 'wall', facing: 'east' },
            3: { face: 'wall', facing: 'west' },
            4: { face: 'wall', facing: 'south' },
            5: { face: 'wall', facing: 'north' },
            6: { face: 'ceiling', facing: 'south' },
            7: { face: 'ceiling', facing: 'north' }
        };
        const info = leverMap[direction & 0x7] || leverMap[0];
        return {
            key: '__lever__',
            value: {
                face: info.face,
                facing: info.facing
            }
        };
    }

    /**
     * 构建Palette（去重后的方块状态列表）
     */
    buildPalette(blocks) {
        const palette = [];
        const paletteMap = new Map(); // 序列化后的状态 -> palette索引

        // 确保空气在索引0
        const airEntry = { Name: 'minecraft:air', Properties: {} };
        palette.push(airEntry);
        paletteMap.set(JSON.stringify(airEntry), 0);

        for (const block of blocks) {
            const entry = {
                Name: block.name,
                Properties: block.states || {}
            };

            const key = JSON.stringify(entry);
            if (!paletteMap.has(key)) {
                paletteMap.set(key, palette.length);
                palette.push(entry);
            }
        }

        return { palette, paletteMap };
    }

    /**
     * 编码BlockStates为long数组（位打包）
     */
    encodeBlockStates(blocks, paletteMap, sizeX, sizeY, sizeZ) {
        const totalBlocks = sizeX * sizeY * sizeZ;
        const bitsPerBlock = Math.max(2, Math.ceil(Math.log2(paletteMap.size)));
        const mask = (1n << BigInt(bitsPerBlock)) - 1n;

        // 计算long数组长度
        const totalBits = totalBlocks * bitsPerBlock;
        const longArrayLength = Math.ceil(totalBits / 64);
        const longArray = new Array(longArrayLength).fill(0n);

        // 创建位置到palette索引的映射
        const posToIndex = new Map();
        for (const block of blocks) {
            const entry = { Name: block.name, Properties: block.states || {} };
            const key = JSON.stringify(entry);
            const paletteIndex = paletteMap.get(key);
            const linearIndex = block.pos[1] * sizeX * sizeZ + block.pos[2] * sizeX + block.pos[0];
            posToIndex.set(linearIndex, paletteIndex);
        }

        // 编码每个方块
        for (let i = 0; i < totalBlocks; i++) {
            const paletteIndex = posToIndex.get(i) || 0; // 默认为空气

            const bitIndex = i * bitsPerBlock;
            const longIndex = Math.floor(bitIndex / 64);
            const bitOffset = bitIndex % 64;

            if (longIndex >= longArray.length) break;

            if (bitOffset + bitsPerBlock <= 64) {
                // 不跨long
                longArray[longIndex] = longArray[longIndex] |
                    (BigInt(paletteIndex) & mask) << BigInt(bitOffset);
            } else {
                // 跨long
                const bitsInFirst = 64 - bitOffset;
                const bitsInSecond = bitsPerBlock - bitsInFirst;

                longArray[longIndex] = longArray[longIndex] |
                    (BigInt(paletteIndex) & ((1n << BigInt(bitsInFirst)) - 1n)) << BigInt(bitOffset);

                if (longIndex + 1 < longArray.length) {
                    longArray[longIndex + 1] = longArray[longIndex + 1] |
                        (BigInt(paletteIndex) >> BigInt(bitsInFirst)) & ((1n << BigInt(bitsInSecond)) - 1n);
                }
            }
        }

        // 保持BigInt类型避免Number精度丢失（Number只有53位精度，而long需要64位）
        const signedLongArray = longArray.map(v => BigInt.asIntN(64, v));

        return { longArray: signedLongArray, bitsPerBlock };
    }

    /**
     * 保存选区为.litematic文件
     */
    async saveSchematic(region, dimension, fileName, author, description = '') {
        const { minX, minY, minZ, maxX, maxY, maxZ } = region;
        const sizeX = maxX - minX + 1;
        const sizeY = maxY - minY + 1;
        const sizeZ = maxZ - minZ + 1;

        logger.info(`[SchematicSaver] Starting save: ${fileName}, region: (${minX},${minY},${minZ}) to (${maxX},${maxY},${maxZ}), dim=${dimension}`);

        // 扫描方块
        const blocks = this.scanBlocks(region, dimension);
        logger.info(`[SchematicSaver] Scanned ${blocks.length} blocks`);
        if (blocks.length > 0 && this._config('schematicSave.verboseScan', false)) {
            logger.info(`[SchematicSaver] First block: ${JSON.stringify(blocks[0])}`);
        }

        if (blocks.length === 0) {
            throw new Error('选区内没有非空气方块');
        }

        // 构建palette
        const { palette, paletteMap } = this.buildPalette(blocks);
        logger.info(`[SchematicSaver] Palette size: ${palette.length}`);
        if (this._config('schematicSave.verboseScan', false)) {
            logger.info(`[SchematicSaver] Palette entries: ${JSON.stringify(palette.slice(0, 3))}`);
        }

        // 编码BlockStates
        const { longArray, bitsPerBlock } = this.encodeBlockStates(blocks, paletteMap, sizeX, sizeY, sizeZ);
        logger.info(`[SchematicSaver] BlockStates: ${longArray.length} longs, bitsPerBlock=${bitsPerBlock}`);

        // 构建NBT结构
        const nbtData = this.buildNBTData({
            name: fileName,
            author: author,
            description: description,
            sizeX, sizeY, sizeZ,
            palette,
            blockStates: longArray,
            totalBlocks: blocks.length,
            totalVolume: sizeX * sizeY * sizeZ
        });
        logger.info(`[SchematicSaver] NBT data built`);

        // 写入文件
        const filePath = this.schematicsDir + fileName + '.litematic';
        await this.writeLitematicFile(filePath, nbtData);
        logger.info(`[SchematicSaver] File written: ${filePath}`);

        // 验证：尝试读取并解析
        try {
            const verifyData = this.readFileBinary(filePath);
            if (verifyData) {
                logger.info(`[SchematicSaver] Verify: file size=${verifyData.length} bytes`);
                logger.info(`[SchematicSaver] Verify: first bytes=0x${verifyData[0].toString(16)},0x${verifyData[1].toString(16)}`);
            }
        } catch (e) {
            logger.warn(`[SchematicSaver] Verify read failed: ${e.message}`);
        }

        return {
            format: FORMAT_LITEMATIC,
            filePath,
            fileName: fileName + '.litematic',
            blockCount: blocks.length,
            volume: sizeX * sizeY * sizeZ,
            dimensions: { x: sizeX, y: sizeY, z: sizeZ }
        };
    }

    /**
     * 保存选区为 .mcstructure（基岩版结构方块文件）
     *
     * 与 .litematic 的关键差异：
     *   · 方块名/状态用基岩版原值（不做 Java 转换），states 的 Byte/Int/String 类型保真
     *   · 全网格 int32 编码（不是位打包），文件**不压缩** → 体积大，故有 maxVolume 上限
     *   · 可带方块实体（block_position_data）
     *
     * @param {Object} region
     * @param {number} dimension
     * @param {string} fileName 不含扩展名
     * @param {string} author 仅用于日志（.mcstructure 没有作者字段）
     * @param {string} description 仅用于日志
     * @param {Array} [preScanned] both 模式下复用同一遍扫描结果，避免重复遍历
     */
    async saveMcstructure(region, dimension, fileName, author, description = '', preScanned = null) {
        const { minX, minY, minZ, maxX, maxY, maxZ } = region;
        const sizeX = maxX - minX + 1;
        const sizeY = maxY - minY + 1;
        const sizeZ = maxZ - minZ + 1;
        const volume = sizeX * sizeY * sizeZ;

        // 二道保险：命令入口若绕过 UI，也必须在这里截停（此时尚未读方块）
        const check = this.checkMcstructureVolume(region);
        if (!check.ok) {
            throw new Error(`选区 ${sizeX}×${sizeY}×${sizeZ} = ${volume} 格，超过 .mcstructure 上限 ` +
                `${check.maxVolume} 格；请缩小选区或改选 .litematic`);
        }

        logger.info(`[SchematicSaver] mcstructure 开始: ${fileName}, ${sizeX}×${sizeY}×${sizeZ} = ${volume} 格, ` +
            `dim=${dimension}, author=${author}`);

        const includeBlockEntities = this._config('schematicSave.includeBlockEntities', true) !== false;
        const scanned = preScanned || this.scanRegion(region, dimension, {
            wantJava: false,
            wantBedrock: true,
            includeBlockEntities,
            verbose: !!this._config('schematicSave.verboseScan', false)
        });

        if (scanned.bedrockBlocks.length === 0) {
            throw new Error('选区内没有非空气方块');
        }

        const { buffer, stats } = McstructureWriter.build({
            size: { x: sizeX, y: sizeY, z: sizeZ },
            blocks: scanned.bedrockBlocks,
            worldOrigin: { x: minX, y: minY, z: minZ },
            blockVersion: Number(this._config('schematicSave.blockVersion', 18168865)) || 18168865,
            formatVersion: Number(this._config('schematicSave.formatVersion', 1)) || 1,
            writeLiquidLayer: this._config('schematicSave.writeLiquidLayer', true) !== false
        });

        const filePath = this.schematicsDir + fileName + '.mcstructure';
        this.writeBinaryFile(filePath, buffer, false);

        logger.info(`[SchematicSaver] .mcstructure 已写出: ${filePath} ` +
            `(${stats.bytes} 字节, 调色板 ${stats.paletteSize}, 方块实体 ${stats.entityBlocks})`);

        return {
            format: FORMAT_MCSTRUCTURE,
            filePath,
            fileName: fileName + '.mcstructure',
            blockCount: stats.blockCount,
            volume,
            dimensions: { x: sizeX, y: sizeY, z: sizeZ },
            paletteSize: stats.paletteSize,
            entityBlocks: stats.entityBlocks,
            bytes: stats.bytes
        };
    }

    /**
     * 统一保存入口：先定格式，再走对应链路
     * @param {string} format litematic | mcstructure | both
     * @returns {Promise<Object>} { format, results:[...], failures:[...], blockCount, dimensions, volume }
     */
    async save(region, dimension, fileName, author, description = '', format = FORMAT_LITEMATIC) {
        const mode = String(format || FORMAT_LITEMATIC).toLowerCase();
        if (mode !== FORMAT_LITEMATIC && mode !== FORMAT_MCSTRUCTURE && mode !== FORMAT_BOTH) {
            throw new Error(`未知导出格式: ${format}`);
        }

        // 先做体积判断（0 次方块读取），超限直接拒绝，不读任何数据
        if (mode !== FORMAT_LITEMATIC) {
            const check = this.checkMcstructureVolume(region);
            if (!check.ok) {
                throw new Error(`选区 ${check.dimensions.x}×${check.dimensions.y}×${check.dimensions.z} = ` +
                    `${check.volume} 格，超过 .mcstructure 上限 ${check.maxVolume} 格；` +
                    `请缩小选区或改选 .litematic`);
            }
        }

        if (mode === FORMAT_LITEMATIC) {
            const r = await this.saveSchematic(region, dimension, fileName, author, description);
            return { format: mode, results: [r], failures: [], blockCount: r.blockCount, dimensions: r.dimensions, volume: r.volume };
        }

        if (mode === FORMAT_MCSTRUCTURE) {
            const r = await this.saveMcstructure(region, dimension, fileName, author, description);
            return { format: mode, results: [r], failures: [], blockCount: r.blockCount, dimensions: r.dimensions, volume: r.volume };
        }

        // both：**单遍遍历、双累积**，不扫两遍
        const includeBlockEntities = this._config('schematicSave.includeBlockEntities', true) !== false;
        const scanned = this.scanRegion(region, dimension, {
            wantJava: true,
            wantBedrock: true,
            includeBlockEntities,
            verbose: !!this._config('schematicSave.verboseScan', false)
        });

        return this._saveBoth(region, dimension, fileName, author, description, scanned);
    }

    /** both 模式：同一遍扫描的结果分别写成两种文件；一个失败不影响另一个 */
    async _saveBoth(region, dimension, fileName, author, description, scanned) {
        const { minX, minY, minZ, maxX, maxY, maxZ } = region;
        const sizeX = maxX - minX + 1;
        const sizeY = maxY - minY + 1;
        const sizeZ = maxZ - minZ + 1;
        const volume = sizeX * sizeY * sizeZ;

        if (scanned.javaBlocks.length === 0 && scanned.bedrockBlocks.length === 0) {
            throw new Error('选区内没有非空气方块');
        }

        const results = [];
        const failures = [];

        // ── .litematic：复用 Java 侧累积结果，不再扫描 ──
        try {
            const blocks = scanned.javaBlocks;
            const { palette, paletteMap } = this.buildPalette(blocks);
            const { longArray } = this.encodeBlockStates(blocks, paletteMap, sizeX, sizeY, sizeZ);
            const nbtData = this.buildNBTData({
                name: fileName, author, description,
                sizeX, sizeY, sizeZ,
                palette,
                blockStates: longArray,
                totalBlocks: blocks.length,
                totalVolume: volume
            });
            const filePath = this.schematicsDir + fileName + '.litematic';
            await this.writeLitematicFile(filePath, nbtData);
            results.push({
                format: FORMAT_LITEMATIC, filePath, fileName: fileName + '.litematic',
                blockCount: blocks.length, volume,
                dimensions: { x: sizeX, y: sizeY, z: sizeZ }
            });
            logger.info(`[SchematicSaver] both: .litematic 已写出 ${filePath}`);
        } catch (e) {
            failures.push({ format: FORMAT_LITEMATIC, error: e.message });
            logger.error(`[SchematicSaver] both: .litematic 失败: ${e.message}`);
        }

        // ── .mcstructure：复用基岩侧累积结果 ──
        try {
            const r = await this.saveMcstructure(region, dimension, fileName, author, description, scanned);
            results.push(r);
        } catch (e) {
            failures.push({ format: FORMAT_MCSTRUCTURE, error: e.message });
            logger.error(`[SchematicSaver] both: .mcstructure 失败: ${e.message}`);
        }

        if (results.length === 0) {
            throw new Error(failures.map(f => `${f.format}: ${f.error}`).join('；'));
        }

        return {
            format: FORMAT_BOTH,
            results,
            failures,
            blockCount: scanned.bedrockBlocks.length || scanned.javaBlocks.length,
            dimensions: { x: sizeX, y: sizeY, z: sizeZ },
            volume
        };
    }

    /**
     * 构建NBT数据结构
     */
    buildNBTData(params) {
        const {
            name, author, description,
            sizeX, sizeY, sizeZ,
            palette, blockStates,
            totalBlocks, totalVolume
        } = params;

        const now = Date.now();

        return {
            // 顶层标签
            type: 10, // TAG_Compound
            name: '',
            value: {
                MinecraftDataVersion: { type: 3, value: 3953 }, // 1.21.1 数据版本
                Version: { type: 3, value: 7 },
                SubVersion: { type: 3, value: 1 },
                Metadata: {
                    type: 10,
                    value: {
                        Name: { type: 8, value: name },
                        Author: { type: 8, value: author },
                        Description: { type: 8, value: description },
                        RegionCount: { type: 3, value: 1 },
                        TotalVolume: { type: 3, value: totalVolume },
                        TotalBlocks: { type: 3, value: totalBlocks },
                        TimeCreated: { type: 4, value: now },
                        TimeModified: { type: 4, value: now },
                        EnclosingSize: {
                            type: 10,
                            value: {
                                x: { type: 3, value: sizeX },
                                y: { type: 3, value: sizeY },
                                z: { type: 3, value: sizeZ }
                            }
                        }
                    }
                },
                Regions: {
                    type: 10,
                    value: {
                        [name]: {
                            type: 10,
                            value: {
                                Position: {
                                    type: 10,
                                    value: {
                                        x: { type: 3, value: 0 },
                                        y: { type: 3, value: 0 },
                                        z: { type: 3, value: 0 }
                                    }
                                },
                                Size: {
                                    type: 10,
                                    value: {
                                        x: { type: 3, value: sizeX },
                                        y: { type: 3, value: sizeY },
                                        z: { type: 3, value: sizeZ }
                                    }
                                },
                                BlockStatePalette: {
                                    type: 9,
                                    listType: 10,
                                    value: palette.map(entry => ({
                                        type: 10,
                                        value: {
                                            Name: { type: 8, value: entry.Name },
                                            ...(Object.keys(entry.Properties || {}).length > 0 ? {
                                                Properties: {
                                                    type: 10,
                                                    value: Object.fromEntries(
                                                        Object.entries(entry.Properties).map(([k, v]) => [
                                                            k,
                                                            { type: 8, value: String(v) }
                                                        ])
                                                    )
                                                }
                                            } : {})
                                        }
                                    }))
                                },
                                BlockStates: {
                                    type: 12,
                                    value: blockStates
                                },
                                TileEntities: {
                                    type: 9,
                                    listType: 10,
                                    value: []
                                },
                                Entities: {
                                    type: 9,
                                    listType: 10,
                                    value: []
                                }
                            }
                        }
                    }
                }
            }
        };
    }

    /**
     * 写入.litematic文件（GZIP压缩的NBT）
     */
    async writeLitematicFile(filePath, nbtData) {
        const nbtWriter = new NBTWriter();
        const nbtBuffer = nbtWriter.write(nbtData);
        logger.info(`[SchematicSaver] NBT serialized: ${nbtBuffer.length} bytes`);

        const compressed = this.gzipCompress(nbtBuffer);
        logger.info(`[SchematicSaver] GZIP compressed: ${compressed.length} bytes`);

        this.writeBinaryFile(filePath, compressed, false);
    }

    /**
     * 二进制落盘（.litematic 与 .mcstructure 共用）
     * @param {string} filePath
     * @param {Uint8Array|Buffer} bytes 已经是最终字节（需要 gzip 时由调用方先压）
     * @param {boolean} [compress] 保留参数：true 时内部再 gzip 一次
     */
    writeBinaryFile(filePath, bytes, compress = false) {
        const payload = compress ? this.gzipCompress(bytes) : bytes;

        if (global.fs) {
            const fs = require('fs');
            fs.writeFileSync(filePath, Buffer.from(payload));
            logger.info(`[SchematicSaver] Written via fs.writeFile: ${filePath} (${payload.length} bytes)`);
            return;
        }

        let binaryStr = '';
        for (let i = 0; i < payload.length; i++) {
            binaryStr += String.fromCharCode(payload[i]);
        }
        const base64 = btoa(binaryStr);
        File.writeTo(filePath, base64);
        logger.info(`[SchematicSaver] Written via File.writeTo (base64): ${filePath} (${payload.length} bytes)`);
    }

    /**
     * GZIP压缩
     */
    gzipCompress(data) {
        if (global.zlib) {
            return global.zlib.gzipSync(Buffer.from(data));
        }
        try {
            const zlib = require('zlib');
            return zlib.gzipSync(Buffer.from(data));
        } catch (e) {
            logger.warn(`[SchematicSaver] zlib not available via require: ${e.message}`);
        }
        throw new Error('zlib module not available, cannot create GZIP compressed .litematic file. Please ensure zlib is accessible in the runtime environment.');
    }

    /**
     * ArrayBuffer转Base64
     */
    readFileBinary(filePath) {
        try {
            if (global.fs) {
                const fs = require('fs');
                const buffer = fs.readFileSync(filePath);
                return new Uint8Array(buffer);
            } else {
                const content = File.readFrom(filePath);
                if (content instanceof Uint8Array) {
                    return content;
                }
                if (typeof content === 'string') {
                    if (/^[A-Za-z0-9+/=\s]*$/.test(content.trim())) {
                        try {
                            const binaryStr = atob(content.trim());
                            const bytes = new Uint8Array(binaryStr.length);
                            for (let i = 0; i < binaryStr.length; i++) {
                                bytes[i] = binaryStr.charCodeAt(i) & 0xFF;
                            }
                            return bytes;
                        } catch (e) {}
                    }
                    const bytes = new Uint8Array(content.length);
                    for (let i = 0; i < content.length; i++) {
                        bytes[i] = content.charCodeAt(i) & 0xFF;
                    }
                    return bytes;
                }
            }
        } catch (e) {
            logger.error(`[SchematicSaver] readFileBinary error: ${e.message}`);
        }
        return null;
    }
}

module.exports = { SchematicSaver };
