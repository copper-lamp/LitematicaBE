// BlockNameMapper - 方块中文名称映射表
// 提供清晰的键值映射结构和完整的增删改查操作

class BlockNameMapper {
    constructor() {
        // 核心映射表: 英文ID -> 中文名称
        this.mapping = new Map();
        
        // 反向映射表: 中文名称 -> 英文ID (用于查找)
        this.reverseMapping = new Map();
        
        // 分类索引: 类别 -> Set<英文ID>
        this.categoryIndex = new Map();
        
        // 别名表: 别名 -> 英文ID
        this.aliases = new Map();
        
        // 初始化默认映射
        this.initDefaultMappings();
    }

    // ==================== 初始化默认映射 ====================
    
    initDefaultMappings() {
        // 基础方块
        this.addCategory('basic', {
            'stone': '石头',
            'granite': '花岗岩',
            'diorite': '闪长岩',
            'andesite': '安山岩',
            'grass_block': '草方块',
            'dirt': '泥土',
            'coarse_dirt': '砂土',
            'podzol': '灰化土',
            'cobblestone': '圆石',
            'bedrock': '基岩',
            'sand': '沙子',
            'red_sand': '红沙',
            'gravel': '沙砾'
        });

        // 矿石
        this.addCategory('ore', {
            'gold_ore': '金矿石',
            'iron_ore': '铁矿石',
            'coal_ore': '煤矿石',
            'diamond_ore': '钻石矿石',
            'emerald_ore': '绿宝石矿石',
            'redstone_ore': '红石矿石',
            'lapis_ore': '青金石矿石',
            'nether_gold_ore': '下界金矿石',
            'ancient_debris': '远古残骸'
        });

        // 木头类
        this.addCategory('wood', {
            'oak_log': '橡木原木',
            'spruce_log': '云杉原木',
            'birch_log': '白桦原木',
            'jungle_log': '丛林原木',
            'acacia_log': '金合欢原木',
            'dark_oak_log': '深色橡木原木',
            'stripped_oak_log': '去皮橡木原木',
            'stripped_spruce_log': '去皮云杉原木',
            'stripped_birch_log': '去皮白桦原木',
            'stripped_jungle_log': '去皮丛林原木',
            'stripped_acacia_log': '去皮金合欢原木',
            'stripped_dark_oak_log': '去皮深色橡木原木'
        });

        // 木板
        this.addCategory('planks', {
            'oak_planks': '橡木木板',
            'spruce_planks': '云杉木板',
            'birch_planks': '白桦木板',
            'jungle_planks': '丛林木板',
            'acacia_planks': '金合欢木板',
            'dark_oak_planks': '深色橡木木板',
            'crimson_planks': '绯红木板',
            'warped_planks': '诡异木板'
        });

        // 树叶
        this.addCategory('leaves', {
            'oak_leaves': '橡树树叶',
            'spruce_leaves': '云杉树叶',
            'birch_leaves': '白桦树叶',
            'jungle_leaves': '丛林树叶',
            'acacia_leaves': '金合欢树叶',
            'dark_oak_leaves': '深色橡木树叶',
            'azalea_leaves': '杜鹃树叶',
            'flowering_azalea_leaves': '盛开的杜鹃树叶'
        });

        // 羊毛 (16色)
        this.addColorVariants('wool', '羊毛', [
            'white', 'orange', 'magenta', 'light_blue', 'yellow',
            'lime', 'pink', 'gray', 'light_gray', 'cyan',
            'purple', 'blue', 'brown', 'green', 'red', 'black'
        ]);

        // 混凝土
        this.addColorVariants('concrete', '混凝土', [
            'white', 'orange', 'magenta', 'light_blue', 'yellow',
            'lime', 'pink', 'gray', 'light_gray', 'cyan',
            'purple', 'blue', 'brown', 'green', 'red', 'black'
        ]);

        // 陶瓦
        this.addColorVariants('terracotta', '陶瓦', [
            'white', 'orange', 'magenta', 'light_blue', 'yellow',
            'lime', 'pink', 'gray', 'light_gray', 'cyan',
            'purple', 'blue', 'brown', 'green', 'red', 'black'
        ]);

        // 染色玻璃
        this.addColorVariants('stained_glass', '染色玻璃', [
            'white', 'orange', 'magenta', 'light_blue', 'yellow',
            'lime', 'pink', 'gray', 'light_gray', 'cyan',
            'purple', 'blue', 'brown', 'green', 'red', 'black'
        ]);

        // 地毯
        this.addColorVariants('carpet', '地毯', [
            'white', 'orange', 'magenta', 'light_blue', 'yellow',
            'lime', 'pink', 'gray', 'light_gray', 'cyan',
            'purple', 'blue', 'brown', 'green', 'red', 'black'
        ]);

        // 矿物块
        this.addCategory('mineral', {
            'gold_block': '金块',
            'iron_block': '铁块',
            'diamond_block': '钻石块',
            'emerald_block': '绿宝石块',
            'redstone_block': '红石块',
            'lapis_block': '青金石块',
            'coal_block': '煤炭块',
            'netherite_block': '下界合金块',
            'quartz_block': '石英块',
            'smooth_quartz': '平滑石英块',
            'chiseled_quartz_block': '錾制石英块',
            'quartz_pillar': '石英柱',
            'quartz_bricks': '石英砖'
        });

        // 功能方块
        this.addCategory('functional', {
            'chest': '箱子',
            'trapped_chest': '陷阱箱',
            'ender_chest': '末影箱',
            'crafting_table': '工作台',
            'furnace': '熔炉',
            'blast_furnace': '高炉',
            'smoker': '烟熏炉',
            'brewing_stand': '酿造台',
            'enchanting_table': '附魔台',
            'anvil': '铁砧',
            'chipped_anvil': '开裂的铁砧',
            'damaged_anvil': '损坏的铁砧',
            'beacon': '信标',
            'jukebox': '唱片机',
            'note_block': '音符盒',
            'dispenser': '发射器',
            'dropper': '投掷器',
            'hopper': '漏斗',
            'observer': '侦测器',
            'piston': '活塞',
            'sticky_piston': '黏性活塞',
            'tnt': 'TNT',
            'bookshelf': '书架'
        });

        // 红石
        this.addCategory('redstone', {
            'redstone_torch': '红石火把',
            'redstone_block': '红石块',
            'redstone_wire': '红石粉',
            'repeater': '红石中继器',
            'comparator': '红石比较器',
            'lever': '拉杆',
            'stone_button': '石头按钮',
            'oak_button': '橡木按钮',
            'spruce_button': '云杉木按钮',
            'birch_button': '白桦木按钮',
            'jungle_button': '丛林木按钮',
            'acacia_button': '金合欢按钮',
            'dark_oak_button': '深色橡木按钮',
            'stone_pressure_plate': '石头压力板',
            'oak_pressure_plate': '橡木压力板',
            'light_weighted_pressure_plate': '轻质测重压力板',
            'heavy_weighted_pressure_plate': '重质测重压力板',
            'tripwire_hook': '绊线钩',
            'daylight_detector': '阳光探测器'
        });

        // 楼梯
        this.addCategory('stairs', {
            'oak_stairs': '橡木楼梯',
            'spruce_stairs': '云杉木楼梯',
            'birch_stairs': '白桦木楼梯',
            'jungle_stairs': '丛林木楼梯',
            'acacia_stairs': '金合欢木楼梯',
            'dark_oak_stairs': '深色橡木楼梯',
            'cobblestone_stairs': '圆石楼梯',
            'stone_brick_stairs': '石砖楼梯',
            'brick_stairs': '砖楼梯',
            'stone_stairs': '石头楼梯',
            'smooth_quartz_stairs': '平滑石英楼梯',
            'sandstone_stairs': '砂岩楼梯',
            'red_sandstone_stairs': '红砂岩楼梯',
            'nether_brick_stairs': '地狱砖楼梯',
            'red_nether_brick_stairs': '红色地狱砖楼梯',
            'quartz_stairs': '石英楼梯',
            'purpur_stairs': '紫珀楼梯',
            'prismarine_stairs': '海晶石楼梯',
            'prismarine_brick_stairs': '海晶石砖楼梯',
            'dark_prismarine_stairs': '暗海晶石楼梯',
            'granite_stairs': '花岗岩楼梯',
            'diorite_stairs': '闪长岩楼梯',
            'andesite_stairs': '安山岩楼梯'
        });

        // 台阶
        this.addCategory('slabs', {
            'oak_slab': '橡木台阶',
            'spruce_slab': '云杉木台阶',
            'birch_slab': '白桦木台阶',
            'jungle_slab': '丛林木台阶',
            'acacia_slab': '金合欢木台阶',
            'dark_oak_slab': '深色橡木台阶',
            'stone_slab': '石台阶',
            'cobblestone_slab': '圆石台阶',
            'stone_brick_slab': '石砖台阶',
            'brick_slab': '红砖台阶',
            'smooth_stone_slab': '平滑石头台阶',
            'smooth_quartz_slab': '平滑石英台阶',
            'sandstone_slab': '砂岩台阶',
            'red_sandstone_slab': '红砂岩台阶',
            'nether_brick_slab': '地狱砖台阶',
            'quartz_slab': '石英台阶',
            'purpur_slab': '紫珀台阶'
        });

        // 栅栏
        this.addCategory('fences', {
            'oak_fence': '橡木栅栏',
            'spruce_fence': '云杉木栅栏',
            'birch_fence': '白桦木栅栏',
            'jungle_fence': '丛林木栅栏',
            'acacia_fence': '金合欢栅栏',
            'dark_oak_fence': '深色橡木栅栏',
            'nether_brick_fence': '地狱砖栅栏',
            'iron_bars': '铁栏杆'
        });

        // 下界方块
        this.addCategory('nether', {
            'netherrack': '地狱岩',
            'soul_sand': '灵魂沙',
            'soul_soil': '灵魂土',
            'glowstone': '荧石',
            'nether_bricks': '地狱砖块',
            'red_nether_bricks': '红色地狱砖',
            'crimson_nylium': '绯红菌岩',
            'warped_nylium': '诡异菌岩',
            'crimson_stem': '绯红菌柄',
            'warped_stem': '诡异菌柄',
            'weeping_vines': '垂泪藤',
            'twisting_vines': '缠怨藤',
            'nether_wart_block': '下界疣块',
            'warped_wart_block': '诡异疣块',
            'shroomlight': '菌光体',
            'basalt': '玄武岩',
            'polished_basalt': '磨制玄武岩',
            'smooth_basalt': '平滑玄武岩',
            'blackstone': '黑石',
            'polished_blackstone': '磨制黑石',
            'gilded_blackstone': '镶金黑石',
            'crying_obsidian': '哭泣的黑曜石',
            'ancient_debris': '远古残骸',
            'netherite_block': '下界合金块',
            'respawn_anchor': '重生锚',
            'lodestone': '磁石'
        });

        // 末地方块
        this.addCategory('end', {
            'end_stone': '末地石',
            'end_stone_bricks': '末地石砖',
            'purpur_block': '紫珀块',
            'purpur_pillar': '紫珀柱',
            'purpur_stairs': '紫珀楼梯',
            'purpur_slab': '紫珀台阶',
            'end_rod': '末地烛',
            'dragon_head': '龙首',
            'chorus_plant': '紫颂植株',
            'chorus_flower': '紫颂花'
        });

        // 海洋方块
        this.addCategory('ocean', {
            'prismarine': '海晶石',
            'prismarine_bricks': '海晶石砖',
            'dark_prismarine': '暗海晶石',
            'sea_lantern': '海晶灯',
            'kelp': '海带',
            'seagrass': '海草',
            'tall_seagrass': '高海草',
            'sea_pickle': '海泡菜',
            'coral': '珊瑚',
            'coral_block': '珊瑚块',
            'coral_fan': '珊瑚扇',
            'blue_ice': '蓝冰',
            'packed_ice': '浮冰',
            'ice': '冰'
        });

        // 装饰
        this.addCategory('decoration', {
            'torch': '火把',
            'soul_torch': '灵魂火把',
            'lantern': '灯笼',
            'soul_lantern': '灵魂灯笼',
            'glass': '玻璃',
            'glass_pane': '玻璃板',
            'iron_bars': '铁栏杆',
            'chain': '锁链',
            'flower_pot': '花盆',
            'painting': '画',
            'item_frame': '物品展示框',
            'armor_stand': '盔甲架'
        });

        // 植物
        this.addCategory('plants', {
            'dandelion': '蒲公英',
            'poppy': '虞美人',
            'blue_orchid': '兰花',
            'allium': '绒球葱',
            'azure_bluet': '蓝花美耳草',
            'red_tulip': '红色郁金香',
            'orange_tulip': '橙色郁金香',
            'white_tulip': '白色郁金香',
            'pink_tulip': '粉红色郁金香',
            'oxeye_daisy': '滨菊',
            'cornflower': '矢车菊',
            'lily_of_the_valley': '铃兰',
            'wither_rose': '凋零玫瑰',
            'sunflower': '向日葵',
            'lilac': '丁香',
            'rose_bush': '玫瑰丛',
            'peony': '牡丹',
            'tall_grass': '高草丛',
            'large_fern': '大型蕨',
            'cactus': '仙人掌',
            'sugar_cane': '甘蔗',
            'vine': '藤蔓',
            'lily_pad': '睡莲',
            'brown_mushroom': '棕色蘑菇',
            'red_mushroom': '红色蘑菇',
            'mushroom_stem': '蘑菇柄',
            'brown_mushroom_block': '棕色蘑菇方块',
            'red_mushroom_block': '红色蘑菇方块'
        });

        // 农作物
        this.addCategory('crops', {
            'wheat': '小麦',
            'carrots': '胡萝卜',
            'potatoes': '马铃薯',
            'beetroots': '甜菜根',
            'melon': '西瓜',
            'melon_stem': '西瓜茎',
            'pumpkin': '南瓜',
            'pumpkin_stem': '南瓜茎',
            'carved_pumpkin': '雕刻南瓜',
            'jack_o_lantern': '南瓜灯'
        });

        // 建筑方块
        this.addCategory('building', {
            'bricks': '红砖块',
            'stone_bricks': '石砖',
            'mossy_stone_bricks': '苔石砖',
            'cracked_stone_bricks': '裂石砖',
            'chiseled_stone_bricks': '錾制石砖',
            'mossy_cobblestone': '苔石',
            'smooth_stone': '平滑石头',
            'obsidian': '黑曜石',
            'crying_obsidian': '哭泣的黑曜石',
            'sandstone': '砂岩',
            'red_sandstone': '红砂岩',
            'smooth_sandstone': '平滑砂岩',
            'smooth_red_sandstone': '平滑红砂岩',
            'chiseled_sandstone': '錾制砂岩',
            'cut_sandstone': '切制砂岩'
        });

        // 特殊
        this.addCategory('special', {
            'spawner': '刷怪笼',
            'command_block': '命令方块',
            'chain_command_block': '连锁命令方块',
            'repeating_command_block': '循环命令方块',
            'structure_block': '结构方块',
            'jigsaw': '拼图方块',
            'barrier': '屏障',
            'light': '光源方块',
            'structure_void': '结构空位'
        });

        // 未知方块
        this.add('unknown', '未知方块', 'special');
    }

    // ==================== 核心CRUD操作 ====================

    /**
     * 添加映射
     * @param {string} englishId - 英文方块ID
     * @param {string} chineseName - 中文名称
     * @param {string} category - 分类(可选)
     * @returns {boolean} 是否成功
     */
    add(englishId, chineseName, category = null) {
        if (!englishId || !chineseName) {
            logger.warn('[BlockNameMapper] 添加映射失败: ID或名称为空');
            return false;
        }

        const cleanId = this.normalizeId(englishId);
        
        // 检查是否已存在
        if (this.mapping.has(cleanId)) {
            logger.warn(`[BlockNameMapper] 映射已存在: ${cleanId}`);
            return false;
        }

        // 添加到主映射表
        this.mapping.set(cleanId, chineseName);
        
        // 添加到反向映射
        this.reverseMapping.set(chineseName, cleanId);
        
        // 添加到分类索引
        if (category) {
            if (!this.categoryIndex.has(category)) {
                this.categoryIndex.set(category, new Set());
            }
            this.categoryIndex.get(category).add(cleanId);
        }

        logger.debug(`[BlockNameMapper] 添加映射: ${cleanId} -> ${chineseName}`);
        return true;
    }

    /**
     * 批量添加映射
     * @param {Object} mappings - 映射对象 {id: name, ...}
     * @param {string} category - 分类
     * @returns {number} 成功添加的数量
     */
    addBatch(mappings, category = null) {
        let count = 0;
        for (const [id, name] of Object.entries(mappings)) {
            if (this.add(id, name, category)) {
                count++;
            }
        }
        return count;
    }

    /**
     * 添加带颜色变体的方块
     * @param {string} baseId - 基础ID
     * @param {string} baseName - 基础中文名
     * @param {string[]} colors - 颜色数组
     * @param {string} category - 分类
     */
    addColorVariants(baseId, baseName, colors, category = null) {
        const colorNames = {
            'white': '白色', 'orange': '橙色', 'magenta': '品红色',
            'light_blue': '淡蓝色', 'yellow': '黄色', 'lime': '黄绿色',
            'pink': '粉红色', 'gray': '灰色', 'light_gray': '淡灰色',
            'cyan': '青色', 'purple': '紫色', 'blue': '蓝色',
            'brown': '棕色', 'green': '绿色', 'red': '红色', 'black': '黑色'
        };

        for (const color of colors) {
            const id = `${color}_${baseId}`;
            const name = `${colorNames[color] || color}${baseName}`;
            this.add(id, name, category || baseId);
        }
    }

    /**
     * 添加分类映射
     * @param {string} category - 分类名称
     * @param {Object} mappings - 映射对象
     * @returns {number} 成功添加的数量
     */
    addCategory(category, mappings) {
        if (!this.categoryIndex.has(category)) {
            this.categoryIndex.set(category, new Set());
        }
        return this.addBatch(mappings, category);
    }

    /**
     * 查询中文名称
     * @param {string} englishId - 英文ID
     * @returns {string|null} 中文名称，未找到返回null
     */
    get(englishId) {
        const cleanId = this.normalizeId(englishId);
        
        // 直接查询
        if (this.mapping.has(cleanId)) {
            return this.mapping.get(cleanId);
        }

        // 尝试去除minecraft:前缀
        if (cleanId.startsWith('minecraft:')) {
            const shortId = cleanId.substring(10);
            if (this.mapping.has(shortId)) {
                return this.mapping.get(shortId);
            }
        }

        // 尝试添加minecraft:前缀
        if (!cleanId.includes(':')) {
            const fullId = `minecraft:${cleanId}`;
            if (this.mapping.has(fullId)) {
                return this.mapping.get(fullId);
            }
        }

        // 查询别名
        if (this.aliases.has(cleanId)) {
            const targetId = this.aliases.get(cleanId);
            return this.mapping.get(targetId);
        }

        return null;
    }

    /**
     * 智能查询（支持前缀匹配）
     * @param {string} englishId - 英文ID
     * @returns {string} 中文名称，未找到返回原ID
     */
    resolve(englishId) {
        if (!englishId) return '未知方块';
        
        const result = this.get(englishId);
        if (result) return result;

        // 尝试解析带前缀的方块名
        const cleanId = this.normalizeId(englishId);
        
        // 处理颜色前缀
        const colorMatch = this.matchColorPrefix(cleanId);
        if (colorMatch) {
            const baseName = this.get(colorMatch.baseId);
            if (baseName) {
                return colorMatch.colorName + baseName;
            }
        }

        // 处理木头类型前缀
        const woodMatch = this.matchWoodPrefix(cleanId);
        if (woodMatch) {
            const baseName = this.get(woodMatch.baseId);
            if (baseName) {
                return woodMatch.woodName + baseName;
            }
        }

        // 返回清理后的原ID
        return cleanId.replace('minecraft:', '');
    }

    /**
     * 反向查询：根据中文名查找英文ID
     * @param {string} chineseName - 中文名称
     * @returns {string|null} 英文ID
     */
    reverseGet(chineseName) {
        return this.reverseMapping.get(chineseName) || null;
    }

    /**
     * 更新映射
     * @param {string} englishId - 英文ID
     * @param {string} newChineseName - 新的中文名称
     * @returns {boolean} 是否成功
     */
    update(englishId, newChineseName) {
        const cleanId = this.normalizeId(englishId);
        
        if (!this.mapping.has(cleanId)) {
            logger.warn(`[BlockNameMapper] 更新失败: 映射不存在 ${cleanId}`);
            return false;
        }

        const oldName = this.mapping.get(cleanId);
        
        // 更新主映射
        this.mapping.set(cleanId, newChineseName);
        
        // 更新反向映射
        this.reverseMapping.delete(oldName);
        this.reverseMapping.set(newChineseName, cleanId);

        logger.debug(`[BlockNameMapper] 更新映射: ${cleanId} ${oldName} -> ${newChineseName}`);
        return true;
    }

    /**
     * 删除映射
     * @param {string} englishId - 英文ID
     * @returns {boolean} 是否成功
     */
    remove(englishId) {
        const cleanId = this.normalizeId(englishId);
        
        if (!this.mapping.has(cleanId)) {
            return false;
        }

        const chineseName = this.mapping.get(cleanId);
        
        // 从主映射删除
        this.mapping.delete(cleanId);
        
        // 从反向映射删除
        this.reverseMapping.delete(chineseName);
        
        // 从分类索引删除
        for (const [category, idSet] of this.categoryIndex) {
            if (idSet.has(cleanId)) {
                idSet.delete(cleanId);
                // 如果分类为空，删除分类
                if (idSet.size === 0) {
                    this.categoryIndex.delete(category);
                }
            }
        }

        logger.debug(`[BlockNameMapper] 删除映射: ${cleanId}`);
        return true;
    }

    /**
     * 批量删除
     * @param {string[]} englishIds - 英文ID数组
     * @returns {number} 成功删除的数量
     */
    removeBatch(englishIds) {
        let count = 0;
        for (const id of englishIds) {
            if (this.remove(id)) count++;
        }
        return count;
    }

    // ==================== 别名管理 ====================

    /**
     * 添加别名
     * @param {string} alias - 别名
     * @param {string} targetId - 目标ID
     * @returns {boolean} 是否成功
     */
    addAlias(alias, targetId) {
        const cleanAlias = this.normalizeId(alias);
        const cleanTarget = this.normalizeId(targetId);
        
        if (!this.mapping.has(cleanTarget)) {
            logger.warn(`[BlockNameMapper] 别名目标不存在: ${cleanTarget}`);
            return false;
        }

        this.aliases.set(cleanAlias, cleanTarget);
        return true;
    }

    /**
     * 删除别名
     * @param {string} alias - 别名
     * @returns {boolean} 是否成功
     */
    removeAlias(alias) {
        return this.aliases.delete(this.normalizeId(alias));
    }

    // ==================== 分类查询 ====================

    /**
     * 获取分类中的所有方块
     * @param {string} category - 分类名称
     * @returns {Array} [{id, name}, ...]
     */
    getByCategory(category) {
        const idSet = this.categoryIndex.get(category);
        if (!idSet) return [];

        const result = [];
        for (const id of idSet) {
            result.push({
                id: id,
                name: this.mapping.get(id)
            });
        }
        return result;
    }

    /**
     * 获取所有分类
     * @returns {string[]}
     */
    getCategories() {
        return Array.from(this.categoryIndex.keys());
    }

    /**
     * 获取方块的分类
     * @param {string} englishId - 英文ID
     * @returns {string|null}
     */
    getCategory(englishId) {
        const cleanId = this.normalizeId(englishId);
        for (const [category, idSet] of this.categoryIndex) {
            if (idSet.has(cleanId)) {
                return category;
            }
        }
        return null;
    }

    // ==================== 搜索功能 ====================

    /**
     * 搜索方块（支持模糊匹配）
     * @param {string} keyword - 关键词
     * @param {boolean} searchChinese - 是否搜索中文名
     * @returns {Array} 匹配结果 [{id, name}, ...]
     */
    search(keyword, searchChinese = true) {
        const results = [];
        const lowerKeyword = keyword.toLowerCase();

        // 搜索英文ID
        for (const [id, name] of this.mapping) {
            if (id.toLowerCase().includes(lowerKeyword)) {
                results.push({ id, name, match: 'id' });
            }
        }

        // 搜索中文名
        if (searchChinese) {
            for (const [id, name] of this.mapping) {
                if (name.includes(keyword) && !results.find(r => r.id === id)) {
                    results.push({ id, name, match: 'name' });
                }
            }
        }

        return results;
    }

    // ==================== 工具方法 ====================

    /**
     * 标准化ID
     * @param {string} id - 原始ID
     * @returns {string} 标准化后的ID
     */
    normalizeId(id) {
        if (!id) return '';
        return id.toLowerCase().trim();
    }

    /**
     * 匹配颜色前缀
     * @param {string} id - 方块ID
     * @returns {Object|null} {colorName, baseId}
     */
    matchColorPrefix(id) {
        const colors = {
            'white': '白色', 'orange': '橙色', 'magenta': '品红色',
            'light_blue': '淡蓝色', 'yellow': '黄色', 'lime': '黄绿色',
            'pink': '粉红色', 'gray': '灰色', 'light_gray': '淡灰色',
            'cyan': '青色', 'purple': '紫色', 'blue': '蓝色',
            'brown': '棕色', 'green': '绿色', 'red': '红色', 'black': '黑色'
        };

        for (const [color, colorName] of Object.entries(colors)) {
            const prefix = `${color}_`;
            if (id.startsWith(prefix)) {
                return {
                    colorName: colorName,
                    baseId: id.substring(prefix.length)
                };
            }
        }
        return null;
    }

    /**
     * 匹配木头类型前缀
     * @param {string} id - 方块ID
     * @returns {Object|null} {woodName, baseId}
     */
    matchWoodPrefix(id) {
        const woods = {
            'oak': '橡木', 'spruce': '云杉木', 'birch': '白桦木',
            'jungle': '丛林木', 'acacia': '金合欢木', 'dark_oak': '深色橡木',
            'crimson': '绯红', 'warped': '诡异'
        };

        for (const [wood, woodName] of Object.entries(woods)) {
            const prefix = `${wood}_`;
            if (id.startsWith(prefix)) {
                return {
                    woodName: woodName,
                    baseId: id.substring(prefix.length)
                };
            }
        }
        return null;
    }

    // ==================== 统计信息 ====================

    /**
     * 获取统计信息
     * @returns {Object}
     */
    getStats() {
        return {
            totalMappings: this.mapping.size,
            totalCategories: this.categoryIndex.size,
            totalAliases: this.aliases.size,
            categories: this.getCategories().map(cat => ({
                name: cat,
                count: this.categoryIndex.get(cat).size
            }))
        };
    }

    /**
     * 导出所有映射
     * @returns {Object} {id: name, ...}
     */
    export() {
        const result = {};
        for (const [id, name] of this.mapping) {
            result[id] = name;
        }
        return result;
    }

    /**
     * 导入映射
     * @param {Object} mappings - 映射对象
     * @param {boolean} clearExisting - 是否清空现有映射
     * @returns {number} 成功导入的数量
     */
    import(mappings, clearExisting = false) {
        if (clearExisting) {
            this.mapping.clear();
            this.reverseMapping.clear();
            this.categoryIndex.clear();
            this.aliases.clear();
        }

        return this.addBatch(mappings);
    }

    /**
     * 清空所有映射
     */
    clear() {
        this.mapping.clear();
        this.reverseMapping.clear();
        this.categoryIndex.clear();
        this.aliases.clear();
        logger.info('[BlockNameMapper] 所有映射已清空');
    }
}

// 创建单例实例
const blockNameMapper = new BlockNameMapper();

module.exports = { BlockNameMapper, blockNameMapper };
