// BlockIdMap - Java版到基岩版的方块ID映射
// 支持数字ID+Metadata到字符串ID的转换

const BlockIdMap = {
    // Java版数字ID + Metadata -> 基岩版方块ID
    // 格式: "id:data": { name: "block_id", states: {} }
    
    // 基础方块
    "0:0": { name: "minecraft:air", states: {} },
    "1:0": { name: "minecraft:stone", states: { "stone_type": "stone" } },
    "1:1": { name: "minecraft:stone", states: { "stone_type": "granite" } },
    "1:2": { name: "minecraft:stone", states: { "stone_type": "granite_smooth" } },
    "1:3": { name: "minecraft:stone", states: { "stone_type": "diorite" } },
    "1:4": { name: "minecraft:stone", states: { "stone_type": "diorite_smooth" } },
    "1:5": { name: "minecraft:stone", states: { "stone_type": "andesite" } },
    "1:6": { name: "minecraft:stone", states: { "stone_type": "andesite_smooth" } },
    
    "2:0": { name: "minecraft:grass", states: {} },
    "3:0": { name: "minecraft:dirt", states: { "dirt_type": "normal" } },
    "3:1": { name: "minecraft:dirt", states: { "dirt_type": "coarse" } },
    "3:2": { name: "minecraft:podzol", states: {} },
    
    "4:0": { name: "minecraft:cobblestone", states: {} },
    "5:0": { name: "minecraft:planks", states: { "wood_type": "oak" } },
    "5:1": { name: "minecraft:planks", states: { "wood_type": "spruce" } },
    "5:2": { name: "minecraft:planks", states: { "wood_type": "birch" } },
    "5:3": { name: "minecraft:planks", states: { "wood_type": "jungle" } },
    "5:4": { name: "minecraft:planks", states: { "wood_type": "acacia" } },
    "5:5": { name: "minecraft:planks", states: { "wood_type": "dark_oak" } },
    
    "7:0": { name: "minecraft:bedrock", states: {} },
    
    "12:0": { name: "minecraft:sand", states: { "sand_type": "normal" } },
    "12:1": { name: "minecraft:sand", states: { "sand_type": "red" } },
    "13:0": { name: "minecraft:gravel", states: {} },
    
    "14:0": { name: "minecraft:gold_ore", states: {} },
    "15:0": { name: "minecraft:iron_ore", states: {} },
    "16:0": { name: "minecraft:coal_ore", states: {} },
    
    // 木头
    "17:0": { name: "minecraft:log", states: { "old_log_type": "oak", "pillar_axis": "y" } },
    "17:1": { name: "minecraft:log", states: { "old_log_type": "spruce", "pillar_axis": "y" } },
    "17:2": { name: "minecraft:log", states: { "old_log_type": "birch", "pillar_axis": "y" } },
    "17:3": { name: "minecraft:log", states: { "old_log_type": "jungle", "pillar_axis": "y" } },
    
    // 树叶
    "18:0": { name: "minecraft:leaves", states: { "old_leaf_type": "oak" } },
    "18:1": { name: "minecraft:leaves", states: { "old_leaf_type": "spruce" } },
    "18:2": { name: "minecraft:leaves", states: { "old_leaf_type": "birch" } },
    "18:3": { name: "minecraft:leaves", states: { "old_leaf_type": "jungle" } },
    
    "20:0": { name: "minecraft:glass", states: {} },
    
    // 羊毛 (颜色映射)
    "35:0": { name: "minecraft:wool", states: { "color": "white" } },
    "35:1": { name: "minecraft:wool", states: { "color": "orange" } },
    "35:2": { name: "minecraft:wool", states: { "color": "magenta" } },
    "35:3": { name: "minecraft:wool", states: { "color": "light_blue" } },
    "35:4": { name: "minecraft:wool", states: { "color": "yellow" } },
    "35:5": { name: "minecraft:wool", states: { "color": "lime" } },
    "35:6": { name: "minecraft:wool", states: { "color": "pink" } },
    "35:7": { name: "minecraft:wool", states: { "color": "gray" } },
    "35:8": { name: "minecraft:wool", states: { "color": "silver" } },
    "35:9": { name: "minecraft:wool", states: { "color": "cyan" } },
    "35:10": { name: "minecraft:wool", states: { "color": "purple" } },
    "35:11": { name: "minecraft:wool", states: { "color": "blue" } },
    "35:12": { name: "minecraft:wool", states: { "color": "brown" } },
    "35:13": { name: "minecraft:wool", states: { "color": "green" } },
    "35:14": { name: "minecraft:wool", states: { "color": "red" } },
    "35:15": { name: "minecraft:wool", states: { "color": "black" } },
    
    // 花朵
    "37:0": { name: "minecraft:yellow_flower", states: {} },
    "38:0": { name: "minecraft:red_flower", states: { "flower_type": "poppy" } },
    "38:1": { name: "minecraft:red_flower", states: { "flower_type": "blue_orchid" } },
    "38:2": { name: "minecraft:red_flower", states: { "flower_type": "allium" } },
    "38:3": { name: "minecraft:red_flower", states: { "flower_type": "houstonia" } },
    "38:4": { name: "minecraft:red_flower", states: { "flower_type": "tulip_red" } },
    "38:5": { name: "minecraft:red_flower", states: { "flower_type": "tulip_orange" } },
    "38:6": { name: "minecraft:red_flower", states: { "flower_type": "tulip_white" } },
    "38:7": { name: "minecraft:red_flower", states: { "flower_type": "tulip_pink" } },
    "38:8": { name: "minecraft:red_flower", states: { "flower_type": "oxeye" } },
    
    // 蘑菇
    "39:0": { name: "minecraft:brown_mushroom", states: {} },
    "40:0": { name: "minecraft:red_mushroom", states: {} },
    
    // 矿物块
    "41:0": { name: "minecraft:gold_block", states: {} },
    "42:0": { name: "minecraft:iron_block", states: {} },
    
    // 台阶
    "44:0": { name: "minecraft:stone_slab", states: { "stone_slab_type": "smooth_stone", "top_slot_bit": false } },
    "44:1": { name: "minecraft:stone_slab", states: { "stone_slab_type": "sandstone", "top_slot_bit": false } },
    "44:2": { name: "minecraft:stone_slab", states: { "stone_slab_type": "wood", "top_slot_bit": false } },
    "44:3": { name: "minecraft:stone_slab", states: { "stone_slab_type": "cobblestone", "top_slot_bit": false } },
    "44:4": { name: "minecraft:stone_slab", states: { "stone_slab_type": "brick", "top_slot_bit": false } },
    "44:5": { name: "minecraft:stone_slab", states: { "stone_slab_type": "stone_brick", "top_slot_bit": false } },
    "44:6": { name: "minecraft:stone_slab", states: { "stone_slab_type": "quartz", "top_slot_bit": false } },
    "44:7": { name: "minecraft:stone_slab", states: { "stone_slab_type": "nether_brick", "top_slot_bit": false } },
    
    // 砖块
    "45:0": { name: "minecraft:brick_block", states: {} },
    "48:0": { name: "minecraft:mossy_cobblestone", states: {} },
    "49:0": { name: "minecraft:obsidian", states: {} },
    
    // 火把
    "50:0": { name: "minecraft:torch", states: { "torch_facing_direction": "unknown" } },
    "50:1": { name: "minecraft:torch", states: { "torch_facing_direction": "west" } },
    "50:2": { name: "minecraft:torch", states: { "torch_facing_direction": "east" } },
    "50:3": { name: "minecraft:torch", states: { "torch_facing_direction": "north" } },
    "50:4": { name: "minecraft:torch", states: { "torch_facing_direction": "south" } },
    
    // 箱子
    "54:0": { name: "minecraft:chest", states: { "facing_direction": 0 } },
    "54:2": { name: "minecraft:chest", states: { "facing_direction": 2 } },
    "54:3": { name: "minecraft:chest", states: { "facing_direction": 3 } },
    "54:4": { name: "minecraft:chest", states: { "facing_direction": 4 } },
    "54:5": { name: "minecraft:chest", states: { "facing_direction": 5 } },
    
    // 钻石
    "56:0": { name: "minecraft:diamond_ore", states: {} },
    "57:0": { name: "minecraft:diamond_block", states: {} },
    
    // 工作台
    "58:0": { name: "minecraft:crafting_table", states: {} },
    
    // 熔炉
    "61:0": { name: "minecraft:furnace", states: { "facing_direction": 2 } },
    "61:2": { name: "minecraft:furnace", states: { "facing_direction": 2 } },
    "61:3": { name: "minecraft:furnace", states: { "facing_direction": 3 } },
    "61:4": { name: "minecraft:furnace", states: { "facing_direction": 4 } },
    "61:5": { name: "minecraft:furnace", states: { "facing_direction": 5 } },
    
    // 梯子
    "65:0": { name: "minecraft:ladder", states: { "facing_direction": 2 } },
    "65:2": { name: "minecraft:ladder", states: { "facing_direction": 2 } },
    "65:3": { name: "minecraft:ladder", states: { "facing_direction": 3 } },
    "65:4": { name: "minecraft:ladder", states: { "facing_direction": 4 } },
    "65:5": { name: "minecraft:ladder", states: { "facing_direction": 5 } },
    
    // 铁轨
    "66:0": { name: "minecraft:rail", states: { "rail_direction": 0 } },
    
    // 圆石楼梯
    "67:0": { name: "minecraft:normal_stone_stairs", states: { "weirdo_direction": 0, "upside_down_bit": false } },
    
    // 拉杆
    "69:0": { name: "minecraft:lever", states: { "lever_direction": "down_z", "open_bit": false } },
    
    // 石质压力板
    "70:0": { name: "minecraft:stone_pressure_plate", states: { "redstone_signal": 0 } },
    
    // 木质压力板
    "72:0": { name: "minecraft:wooden_pressure_plate", states: { "redstone_signal": 0 } },
    
    // 红石矿石
    "73:0": { name: "minecraft:redstone_ore", states: {} },
    
    // 红石火把
    "75:0": { name: "minecraft:unlit_redstone_torch", states: { "torch_facing_direction": "unknown" } },
    "76:0": { name: "minecraft:redstone_torch", states: { "torch_facing_direction": "unknown" } },
    
    // 石质按钮
    "77:0": { name: "minecraft:stone_button", states: { "button_pressed_bit": false, "facing_direction": 0 } },
    
    // 冰
    "79:0": { name: "minecraft:ice", states: {} },
    
    // 雪
    "80:0": { name: "minecraft:snow", states: {} },
    
    // 仙人掌
    "81:0": { name: "minecraft:cactus", states: { "age": 0 } },
    
    // 粘土
    "82:0": { name: "minecraft:clay", states: {} },
    
    // 甘蔗
    "83:0": { name: "minecraft:reeds", states: { "age": 0 } },
    
    // 唱片机
    "84:0": { name: "minecraft:jukebox", states: {} },
    
    // 栅栏
    "85:0": { name: "minecraft:fence", states: { "wood_type": "oak" } },
    
    // 南瓜
    "86:0": { name: "minecraft:pumpkin", states: { "direction": 0 } },
    
    // 地狱岩
    "87:0": { name: "minecraft:netherrack", states: {} },
    
    // 灵魂沙
    "88:0": { name: "minecraft:soul_sand", states: {} },
    
    // 萤石
    "89:0": { name: "minecraft:glowstone", states: {} },
    
    // 传送门
    "90:0": { name: "minecraft:portal", states: { "portal_axis": "unknown" } },
    
    // 南瓜灯
    "91:0": { name: "minecraft:lit_pumpkin", states: { "direction": 0 } },
    
    // 蛋糕
    "92:0": { name: "minecraft:cake", states: { "bite_counter": 0 } },
    
    // 红石中继器
    "93:0": { name: "minecraft:unpowered_repeater", states: { "repeater_delay": 0, "direction": 0 } },
    "94:0": { name: "minecraft:powered_repeater", states: { "repeater_delay": 0, "direction": 0 } },
    
    // 陷阱箱
    "95:0": { name: "minecraft:stained_glass", states: { "color": "white" } },
    "95:1": { name: "minecraft:stained_glass", states: { "color": "orange" } },
    "95:2": { name: "minecraft:stained_glass", states: { "color": "magenta" } },
    "95:3": { name: "minecraft:stained_glass", states: { "color": "light_blue" } },
    "95:4": { name: "minecraft:stained_glass", states: { "color": "yellow" } },
    "95:5": { name: "minecraft:stained_glass", states: { "color": "lime" } },
    "95:6": { name: "minecraft:stained_glass", states: { "color": "pink" } },
    "95:7": { name: "minecraft:stained_glass", states: { "color": "gray" } },
    "95:8": { name: "minecraft:stained_glass", states: { "color": "silver" } },
    "95:9": { name: "minecraft:stained_glass", states: { "color": "cyan" } },
    "95:10": { name: "minecraft:stained_glass", states: { "color": "purple" } },
    "95:11": { name: "minecraft:stained_glass", states: { "color": "blue" } },
    "95:12": { name: "minecraft:stained_glass", states: { "color": "brown" } },
    "95:13": { name: "minecraft:stained_glass", states: { "color": "green" } },
    "95:14": { name: "minecraft:stained_glass", states: { "color": "red" } },
    "95:15": { name: "minecraft:stained_glass", states: { "color": "black" } },
    
    // 更多方块映射可以继续添加...
};

// 字符串名称到基岩版的直接映射 (用于新版Litematic)
const StringIdMap = {
    "minecraft:stone": { name: "minecraft:stone", states: { "stone_type": "stone" } },
    "minecraft:granite": { name: "minecraft:stone", states: { "stone_type": "granite" } },
    "minecraft:smooth_granite": { name: "minecraft:stone", states: { "stone_type": "granite_smooth" } },
    "minecraft:diorite": { name: "minecraft:stone", states: { "stone_type": "diorite" } },
    "minecraft:smooth_diorite": { name: "minecraft:stone", states: { "stone_type": "diorite_smooth" } },
    "minecraft:andesite": { name: "minecraft:stone", states: { "stone_type": "andesite" } },
    "minecraft:smooth_andesite": { name: "minecraft:stone", states: { "stone_type": "andesite_smooth" } },
    "minecraft:grass_block": { name: "minecraft:grass", states: {} },
    "minecraft:dirt": { name: "minecraft:dirt", states: { "dirt_type": "normal" } },
    "minecraft:coarse_dirt": { name: "minecraft:dirt", states: { "dirt_type": "coarse" } },
    "minecraft:cobblestone": { name: "minecraft:cobblestone", states: {} },
    "minecraft:oak_planks": { name: "minecraft:planks", states: { "wood_type": "oak" } },
    "minecraft:spruce_planks": { name: "minecraft:planks", states: { "wood_type": "spruce" } },
    "minecraft:birch_planks": { name: "minecraft:planks", states: { "wood_type": "birch" } },
    "minecraft:jungle_planks": { name: "minecraft:planks", states: { "wood_type": "jungle" } },
    "minecraft:acacia_planks": { name: "minecraft:planks", states: { "wood_type": "acacia" } },
    "minecraft:dark_oak_planks": { name: "minecraft:planks", states: { "wood_type": "dark_oak" } },
    "minecraft:bedrock": { name: "minecraft:bedrock", states: {} },
    "minecraft:sand": { name: "minecraft:sand", states: { "sand_type": "normal" } },
    "minecraft:red_sand": { name: "minecraft:sand", states: { "sand_type": "red" } },
    "minecraft:gravel": { name: "minecraft:gravel", states: {} },
    "minecraft:gold_ore": { name: "minecraft:gold_ore", states: {} },
    "minecraft:iron_ore": { name: "minecraft:iron_ore", states: {} },
    "minecraft:coal_ore": { name: "minecraft:coal_ore", states: {} },
    "minecraft:oak_log": { name: "minecraft:log", states: { "old_log_type": "oak" } },
    "minecraft:spruce_log": { name: "minecraft:log", states: { "old_log_type": "spruce" } },
    "minecraft:birch_log": { name: "minecraft:log", states: { "old_log_type": "birch" } },
    "minecraft:jungle_log": { name: "minecraft:log", states: { "old_log_type": "jungle" } },
    "minecraft:oak_leaves": { name: "minecraft:leaves", states: { "old_leaf_type": "oak" } },
    "minecraft:spruce_leaves": { name: "minecraft:leaves", states: { "old_leaf_type": "spruce" } },
    "minecraft:birch_leaves": { name: "minecraft:leaves", states: { "old_leaf_type": "birch" } },
    "minecraft:jungle_leaves": { name: "minecraft:leaves", states: { "old_leaf_type": "jungle" } },
    "minecraft:glass": { name: "minecraft:glass", states: {} },
    "minecraft:white_wool": { name: "minecraft:wool", states: { "color": "white" } },
    "minecraft:orange_wool": { name: "minecraft:wool", states: { "color": "orange" } },
    "minecraft:magenta_wool": { name: "minecraft:wool", states: { "color": "magenta" } },
    "minecraft:light_blue_wool": { name: "minecraft:wool", states: { "color": "light_blue" } },
    "minecraft:yellow_wool": { name: "minecraft:wool", states: { "color": "yellow" } },
    "minecraft:lime_wool": { name: "minecraft:wool", states: { "color": "lime" } },
    "minecraft:pink_wool": { name: "minecraft:wool", states: { "color": "pink" } },
    "minecraft:gray_wool": { name: "minecraft:wool", states: { "color": "gray" } },
    "minecraft:light_gray_wool": { name: "minecraft:wool", states: { "color": "silver" } },
    "minecraft:cyan_wool": { name: "minecraft:wool", states: { "color": "cyan" } },
    "minecraft:purple_wool": { name: "minecraft:wool", states: { "color": "purple" } },
    "minecraft:blue_wool": { name: "minecraft:wool", states: { "color": "blue" } },
    "minecraft:brown_wool": { name: "minecraft:wool", states: { "color": "brown" } },
    "minecraft:green_wool": { name: "minecraft:wool", states: { "color": "green" } },
    "minecraft:red_wool": { name: "minecraft:wool", states: { "color": "red" } },
    "minecraft:black_wool": { name: "minecraft:wool", states: { "color": "black" } },
    "minecraft:dandelion": { name: "minecraft:yellow_flower", states: {} },
    "minecraft:poppy": { name: "minecraft:red_flower", states: { "flower_type": "poppy" } },
    "minecraft:blue_orchid": { name: "minecraft:red_flower", states: { "flower_type": "blue_orchid" } },
    "minecraft:allium": { name: "minecraft:red_flower", states: { "flower_type": "allium" } },
    "minecraft:azure_bluet": { name: "minecraft:red_flower", states: { "flower_type": "houstonia" } },
    "minecraft:red_tulip": { name: "minecraft:red_flower", states: { "flower_type": "tulip_red" } },
    "minecraft:orange_tulip": { name: "minecraft:red_flower", states: { "flower_type": "tulip_orange" } },
    "minecraft:white_tulip": { name: "minecraft:red_flower", states: { "flower_type": "tulip_white" } },
    "minecraft:pink_tulip": { name: "minecraft:red_flower", states: { "flower_type": "tulip_pink" } },
    "minecraft:oxeye_daisy": { name: "minecraft:red_flower", states: { "flower_type": "oxeye" } },
    "minecraft:brown_mushroom": { name: "minecraft:brown_mushroom", states: {} },
    "minecraft:red_mushroom": { name: "minecraft:red_mushroom", states: {} },
    "minecraft:gold_block": { name: "minecraft:gold_block", states: {} },
    "minecraft:iron_block": { name: "minecraft:iron_block", states: {} },
    "minecraft:stone_slab": { name: "minecraft:stone_slab", states: { "stone_slab_type": "smooth_stone" } },
    "minecraft:sandstone_slab": { name: "minecraft:stone_slab", states: { "stone_slab_type": "sandstone" } },
    "minecraft:cobblestone_slab": { name: "minecraft:stone_slab", states: { "stone_slab_type": "cobblestone" } },
    "minecraft:brick_slab": { name: "minecraft:stone_slab", states: { "stone_slab_type": "brick" } },
    "minecraft:stone_brick_slab": { name: "minecraft:stone_slab", states: { "stone_slab_type": "stone_brick" } },
    "minecraft:nether_brick_slab": { name: "minecraft:stone_slab", states: { "stone_slab_type": "nether_brick" } },
    "minecraft:quartz_slab": { name: "minecraft:stone_slab", states: { "stone_slab_type": "quartz" } },
    "minecraft:bricks": { name: "minecraft:brick_block", states: {} },
    "minecraft:mossy_cobblestone": { name: "minecraft:mossy_cobblestone", states: {} },
    "minecraft:obsidian": { name: "minecraft:obsidian", states: {} },
    "minecraft:torch": { name: "minecraft:torch", states: {} },
    "minecraft:chest": { name: "minecraft:chest", states: {} },
    "minecraft:diamond_ore": { name: "minecraft:diamond_ore", states: {} },
    "minecraft:diamond_block": { name: "minecraft:diamond_block", states: {} },
    "minecraft:crafting_table": { name: "minecraft:crafting_table", states: {} },
    "minecraft:furnace": { name: "minecraft:furnace", states: {} },
    "minecraft:ladder": { name: "minecraft:ladder", states: {} },
    "minecraft:rail": { name: "minecraft:rail", states: {} },
    "minecraft:cobblestone_stairs": { name: "minecraft:normal_stone_stairs", states: {} },
    "minecraft:lever": { name: "minecraft:lever", states: {} },
    "minecraft:stone_pressure_plate": { name: "minecraft:stone_pressure_plate", states: {} },
    "minecraft:oak_pressure_plate": { name: "minecraft:wooden_pressure_plate", states: {} },
    "minecraft:redstone_ore": { name: "minecraft:redstone_ore", states: {} },
    "minecraft:redstone_torch": { name: "minecraft:redstone_torch", states: {} },
    "minecraft:stone_button": { name: "minecraft:stone_button", states: {} },
    "minecraft:ice": { name: "minecraft:ice", states: {} },
    "minecraft:snow_block": { name: "minecraft:snow", states: {} },
    "minecraft:cactus": { name: "minecraft:cactus", states: {} },
    "minecraft:clay": { name: "minecraft:clay", states: {} },
    "minecraft:sugar_cane": { name: "minecraft:reeds", states: {} },
    "minecraft:jukebox": { name: "minecraft:jukebox", states: {} },
    "minecraft:oak_fence": { name: "minecraft:fence", states: { "wood_type": "oak" } },
    "minecraft:carved_pumpkin": { name: "minecraft:pumpkin", states: {} },
    "minecraft:netherrack": { name: "minecraft:netherrack", states: {} },
    "minecraft:soul_sand": { name: "minecraft:soul_sand", states: {} },
    "minecraft:glowstone": { name: "minecraft:glowstone", states: {} },
    "minecraft:nether_portal": { name: "minecraft:portal", states: {} },
    "minecraft:jack_o_lantern": { name: "minecraft:lit_pumpkin", states: {} },
    "minecraft:cake": { name: "minecraft:cake", states: {} },
    "minecraft:repeater": { name: "minecraft:unpowered_repeater", states: {} },
    "minecraft:white_stained_glass": { name: "minecraft:stained_glass", states: { "color": "white" } },
    "minecraft:orange_stained_glass": { name: "minecraft:stained_glass", states: { "color": "orange" } },
    "minecraft:magenta_stained_glass": { name: "minecraft:stained_glass", states: { "color": "magenta" } },
    "minecraft:light_blue_stained_glass": { name: "minecraft:stained_glass", states: { "color": "light_blue" } },
    "minecraft:yellow_stained_glass": { name: "minecraft:stained_glass", states: { "color": "yellow" } },
    "minecraft:lime_stained_glass": { name: "minecraft:stained_glass", states: { "color": "lime" } },
    "minecraft:pink_stained_glass": { name: "minecraft:stained_glass", states: { "color": "pink" } },
    "minecraft:gray_stained_glass": { name: "minecraft:stained_glass", states: { "color": "gray" } },
    "minecraft:light_gray_stained_glass": { name: "minecraft:stained_glass", states: { "color": "silver" } },
    "minecraft:cyan_stained_glass": { name: "minecraft:stained_glass", states: { "color": "cyan" } },
    "minecraft:purple_stained_glass": { name: "minecraft:stained_glass", states: { "color": "purple" } },
    "minecraft:blue_stained_glass": { name: "minecraft:stained_glass", states: { "color": "blue" } },
    "minecraft:brown_stained_glass": { name: "minecraft:stained_glass", states: { "color": "brown" } },
    "minecraft:green_stained_glass": { name: "minecraft:stained_glass", states: { "color": "green" } },
    "minecraft:red_stained_glass": { name: "minecraft:stained_glass", states: { "color": "red" } },
    "minecraft:black_stained_glass": { name: "minecraft:stained_glass", states: { "color": "black" } },
};

/**
 * 转换Java版方块ID到基岩版
 * @param {number|string} id - Java版方块ID(数字)或字符串ID
 * @param {number} data - Java版方块Metadata
 * @returns {object|null} - 基岩版方块信息
 */
function convertBlockId(id, data = 0) {
    // 如果是字符串ID，使用StringIdMap
    if (typeof id === 'string') {
        // 移除minecraft:前缀进行匹配
        const cleanId = id.replace('minecraft:', '');
        const mapped = StringIdMap[id] || StringIdMap[`minecraft:${cleanId}`];
        if (mapped) return mapped;
        
        // 如果没有找到映射，尝试直接返回
        return { name: id, states: {} };
    }
    
    // 数字ID+Metadata映射
    const key = `${id}:${data}`;
    const mapped = BlockIdMap[key];
    
    if (mapped) {
        return mapped;
    }
    
    // 尝试只匹配ID，忽略data
    const idOnly = `${id}:0`;
    const idMapped = BlockIdMap[idOnly];
    if (idMapped) {
        return idMapped;
    }
    
    // 默认返回空气
    logger.warn(`Unknown block ID: ${id}:${data}`);
    return { name: "minecraft:air", states: {} };
}

module.exports = { 
    BlockIdMap, 
    StringIdMap, 
    convertBlockId 
};
