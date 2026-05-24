/**
 * BlockMappingRegistry.js
 * Java <> Bedrock Edition block name mapping table - complete (~880 entries)
 * Supports bidirectional lookup with category, version, and state metadata
 */
const CAT = {
    NATURAL: "natural",
    BUILDING: "building",
    REDSTONE: "redstone",
    DECORATIVE: "decorative",
    FUNCTIONAL: "functional",
    FLUID: "fluid",
    PLANT: "plant",
    UNKNOWN: "unknown"
};
const VER = {
    CLASSIC: "classic",
    BETA: "beta",
    BE:"1.8",
    V1_0:"1.0",V1_2:"1.2",V1_3:"1.3",V1_4:"1.4",V1_5:"1.5",V1_6:"1.6",V1_7:"1.7",V1_8:"1.8",V1_9:"1.9",
    V1_10:"1.10",V1_11:"1.11",V1_12:"1.12",V1_13:"1.13",V1_14:"1.14",V1_15:"1.15",V1_16:"1.16",
    V1_17:"1.17",V1_18:"1.18",V1_19:"1.19",V1_20:"1.20",V1_21:"1.21"
};
/* Map entry: { b: bedrockId, c: category, v: version, s: stateMapping, f: flags }
   s = { javaStateKey: bedrockStateKey } for simple renames; null if identical
   f = bitmask: 1=directional, 2=multiPart, 4=tileEntity, 8=needsColor, 16=needsWoodType */
const javaToBedrock = {
    // === AIR ===
    "minecraft:air":{b:"air",c:CAT.NATURAL,v:VER.CLASSIC},
    "minecraft:cave_air":{b:"air",c:CAT.NATURAL,v:VER.V1_13},
    "minecraft:void_air":{b:"air",c:CAT.NATURAL,v:VER.V1_13},
    "minecraft:structure_void":{b:"structure_void",c:CAT.FUNCTIONAL,v:VER.V1_10},

    // === STONE GROUP ===
    "minecraft:stone":{b:"stone",c:CAT.NATURAL,v:VER.CLASSIC,s:{stone_type:"stone_type"}},
    "minecraft:granite":{b:"stone",c:CAT.NATURAL,v:VER.BE},
    "minecraft:polished_granite":{b:"stone",c:CAT.BUILDING,v:VER.BE},
    "minecraft:diorite":{b:"stone",c:CAT.NATURAL,v:VER.BE},
    "minecraft:polished_diorite":{b:"stone",c:CAT.BUILDING,v:VER.BE},
    "minecraft:andesite":{b:"stone",c:CAT.NATURAL,v:VER.BE},
    "minecraft:polished_andesite":{b:"stone",c:CAT.BUILDING,v:VER.BE},
    "minecraft:cobblestone":{b:"cobblestone",c:CAT.BUILDING,v:VER.CLASSIC},
    "minecraft:mossy_cobblestone":{b:"mossy_cobblestone",c:CAT.BUILDING,v:VER.CLASSIC},
    "minecraft:bedrock":{b:"bedrock",c:CAT.NATURAL,v:VER.CLASSIC},
    "minecraft:obsidian":{b:"obsidian",c:CAT.NATURAL,v:VER.CLASSIC},
    "minecraft:crying_obsidian":{b:"crying_obsidian",c:CAT.NATURAL,v:VER.V1_16},

    // === DIRT GROUP ===
    "minecraft:grass_block":{b:"grass",c:CAT.NATURAL,v:VER.CLASSIC},
    "minecraft:dirt":{b:"dirt",c:CAT.NATURAL,v:VER.CLASSIC,s:{dirt_type:"dirt_type"}},
    "minecraft:coarse_dirt":{b:"dirt",c:CAT.NATURAL,v:VER.V1_7},
    "minecraft:podzol":{b:"podzol",c:CAT.NATURAL,v:VER.V1_7},
    "minecraft:mycelium":{b:"mycelium",c:CAT.NATURAL,v:VER.V1_0},
    "minecraft:dirt_path":{b:"dirt_path",c:CAT.NATURAL,v:VER.V1_17},
    "minecraft:farmland":{b:"farmland",c:CAT.NATURAL,v:VER.CLASSIC},
    "minecraft:clay":{b:"clay",c:CAT.NATURAL,v:VER.CLASSIC},
    "minecraft:mud":{b:"mud",c:CAT.NATURAL,v:VER.V1_19},
    "minecraft:packed_mud":{b:"packed_mud",c:CAT.NATURAL,v:VER.V1_19},
    "minecraft:mud_bricks":{b:"mud_bricks",c:CAT.BUILDING,v:VER.V1_19},
    "minecraft:mud_brick_stairs":{b:"mud_brick_stairs",c:CAT.BUILDING,v:VER.V1_19,f:1},
    "minecraft:mud_brick_slab":{b:"mud_brick_slab",c:CAT.BUILDING,v:VER.V1_19},
    "minecraft:mud_brick_wall":{b:"mud_brick_wall",c:CAT.BUILDING,v:VER.V1_19},
    "minecraft:muddy_mangrove_roots":{b:"muddy_mangrove_roots",c:CAT.NATURAL,v:VER.V1_19},

    // === SAND GROUP ===
    "minecraft:sand":{b:"sand",c:CAT.NATURAL,v:VER.CLASSIC,s:{sand_type:"sand_type"}},
    "minecraft:red_sand":{b:"sand",c:CAT.NATURAL,v:VER.V1_7},
    "minecraft:sandstone":{b:"sandstone",c:CAT.BUILDING,v:VER.BETA,s:{sand_stone_type:"sand_stone_type"}},
    "minecraft:chiseled_sandstone":{b:"sandstone",c:CAT.BUILDING,v:VER.V1_2},
    "minecraft:cut_sandstone":{b:"sandstone",c:CAT.BUILDING,v:VER.V1_2},
    "minecraft:smooth_sandstone":{b:"sandstone",c:CAT.BUILDING,v:VER.V1_2},
    "minecraft:red_sandstone":{b:"red_sandstone",c:CAT.BUILDING,v:VER.BE,s:{sand_stone_type:"sand_stone_type"}},
    "minecraft:chiseled_red_sandstone":{b:"red_sandstone",c:CAT.BUILDING,v:VER.BE},
    "minecraft:cut_red_sandstone":{b:"red_sandstone",c:CAT.BUILDING,v:VER.BE},
    "minecraft:smooth_red_sandstone":{b:"red_sandstone",c:CAT.BUILDING,v:VER.BE},
    "minecraft:sandstone_stairs":{b:"sandstone_stairs",c:CAT.BUILDING,v:VER.BETA,f:1},
    "minecraft:red_sandstone_stairs":{b:"red_sandstone_stairs",c:CAT.BUILDING,v:VER.BE,f:1},
    "minecraft:sandstone_slab":{b:"sandstone_slab",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:red_sandstone_slab":{b:"red_sandstone_slab",c:CAT.BUILDING,v:VER.BE},
    "minecraft:sandstone_wall":{b:"sandstone_wall",c:CAT.BUILDING,v:VER.V1_14},

    // === GRAVEL ===
    "minecraft:gravel":{b:"gravel",c:CAT.NATURAL,v:VER.CLASSIC},
    "minecraft:suspicious_gravel":{b:"suspicious_gravel",c:CAT.NATURAL,v:VER.V1_20},
    "minecraft:suspicious_sand":{b:"suspicious_sand",c:CAT.NATURAL,v:VER.V1_20},

    // === ORES ===
    "minecraft:coal_ore":{b:"coal_ore",c:CAT.NATURAL,v:VER.CLASSIC},
    "minecraft:deepslate_coal_ore":{b:"deepslate_coal_ore",c:CAT.NATURAL,v:VER.V1_17},
    "minecraft:iron_ore":{b:"iron_ore",c:CAT.NATURAL,v:VER.CLASSIC},
    "minecraft:deepslate_iron_ore":{b:"deepslate_iron_ore",c:CAT.NATURAL,v:VER.V1_17},
    "minecraft:copper_ore":{b:"copper_ore",c:CAT.NATURAL,v:VER.V1_17},
    "minecraft:deepslate_copper_ore":{b:"deepslate_copper_ore",c:CAT.NATURAL,v:VER.V1_17},
    "minecraft:gold_ore":{b:"gold_ore",c:CAT.NATURAL,v:VER.CLASSIC},
    "minecraft:deepslate_gold_ore":{b:"deepslate_gold_ore",c:CAT.NATURAL,v:VER.V1_17},
    "minecraft:nether_gold_ore":{b:"nether_gold_ore",c:CAT.NATURAL,v:VER.V1_16},
    "minecraft:redstone_ore":{b:"redstone_ore",c:CAT.NATURAL,v:VER.BETA},
    "minecraft:deepslate_redstone_ore":{b:"deepslate_redstone_ore",c:CAT.NATURAL,v:VER.V1_17},
    "minecraft:emerald_ore":{b:"emerald_ore",c:CAT.NATURAL,v:VER.V1_3},
    "minecraft:deepslate_emerald_ore":{b:"deepslate_emerald_ore",c:CAT.NATURAL,v:VER.V1_17},
    "minecraft:lapis_ore":{b:"lapis_ore",c:CAT.NATURAL,v:VER.BETA},
    "minecraft:deepslate_lapis_ore":{b:"deepslate_lapis_ore",c:CAT.NATURAL,v:VER.V1_17},
    "minecraft:diamond_ore":{b:"diamond_ore",c:CAT.NATURAL,v:VER.CLASSIC},
    "minecraft:deepslate_diamond_ore":{b:"deepslate_diamond_ore",c:CAT.NATURAL,v:VER.V1_17},
    "minecraft:nether_quartz_ore":{b:"quartz_ore",c:CAT.NATURAL,v:VER.V1_5},
    "minecraft:ancient_debris":{b:"ancient_debris",c:CAT.NATURAL,v:VER.V1_16},

    // === MINERAL BLOCKS ===
    "minecraft:coal_block":{b:"coal_block",c:CAT.BUILDING,v:VER.V1_6},
    "minecraft:iron_block":{b:"iron_block",c:CAT.BUILDING,v:VER.CLASSIC},
    "minecraft:gold_block":{b:"gold_block",c:CAT.BUILDING,v:VER.CLASSIC},
    "minecraft:diamond_block":{b:"diamond_block",c:CAT.BUILDING,v:VER.CLASSIC},
    "minecraft:netherite_block":{b:"netherite_block",c:CAT.BUILDING,v:VER.V1_16},
    "minecraft:emerald_block":{b:"emerald_block",c:CAT.BUILDING,v:VER.V1_3},
    "minecraft:lapis_block":{b:"lapis_block",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:redstone_block":{b:"redstone_block",c:CAT.REDSTONE,v:VER.V1_5},
    "minecraft:copper_block":{b:"copper_block",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:exposed_copper":{b:"exposed_copper",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:weathered_copper":{b:"weathered_copper",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:oxidized_copper":{b:"oxidized_copper",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:cut_copper":{b:"cut_copper",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:exposed_cut_copper":{b:"exposed_cut_copper",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:weathered_cut_copper":{b:"weathered_cut_copper",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:oxidized_cut_copper":{b:"oxidized_cut_copper",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:waxed_copper_block":{b:"waxed_copper",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:waxed_exposed_copper":{b:"waxed_exposed_copper",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:waxed_weathered_copper":{b:"waxed_weathered_copper",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:waxed_oxidized_copper":{b:"waxed_oxidized_copper",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:waxed_cut_copper":{b:"waxed_cut_copper",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:waxed_exposed_cut_copper":{b:"waxed_exposed_cut_copper",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:waxed_weathered_cut_copper":{b:"waxed_weathered_cut_copper",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:waxed_oxidized_cut_copper":{b:"waxed_oxidized_cut_copper",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:copper_grate":{b:"copper_grate",c:CAT.BUILDING,v:VER.V1_21},
    "minecraft:exposed_copper_grate":{b:"exposed_copper_grate",c:CAT.BUILDING,v:VER.V1_21},
    "minecraft:weathered_copper_grate":{b:"weathered_copper_grate",c:CAT.BUILDING,v:VER.V1_21},
    "minecraft:oxidized_copper_grate":{b:"oxidized_copper_grate",c:CAT.BUILDING,v:VER.V1_21},
    "minecraft:waxed_copper_grate":{b:"waxed_copper_grate",c:CAT.BUILDING,v:VER.V1_21},
    "minecraft:waxed_exposed_copper_grate":{b:"waxed_exposed_copper_grate",c:CAT.BUILDING,v:VER.V1_21},
    "minecraft:waxed_weathered_copper_grate":{b:"waxed_weathered_copper_grate",c:CAT.BUILDING,v:VER.V1_21},
    "minecraft:waxed_oxidized_copper_grate":{b:"waxed_oxidized_copper_grate",c:CAT.BUILDING,v:VER.V1_21},
    "minecraft:copper_door":{b:"copper_door",c:CAT.FUNCTIONAL,v:VER.V1_21},
    "minecraft:copper_trapdoor":{b:"copper_trapdoor",c:CAT.FUNCTIONAL,v:VER.V1_21},
    "minecraft:copper_bulb":{b:"copper_bulb",c:CAT.REDSTONE,v:VER.V1_21},
    "minecraft:exposed_copper_bulb":{b:"exposed_copper_bulb",c:CAT.REDSTONE,v:VER.V1_21},
    "minecraft:weathered_copper_bulb":{b:"weathered_copper_bulb",c:CAT.REDSTONE,v:VER.V1_21},
    "minecraft:oxidized_copper_bulb":{b:"oxidized_copper_bulb",c:CAT.REDSTONE,v:VER.V1_21},
    "minecraft:waxed_copper_bulb":{b:"waxed_copper_bulb",c:CAT.REDSTONE,v:VER.V1_21},
    "minecraft:waxed_exposed_copper_bulb":{b:"waxed_exposed_copper_bulb",c:CAT.REDSTONE,v:VER.V1_21},
    "minecraft:waxed_weathered_copper_bulb":{b:"waxed_weathered_copper_bulb",c:CAT.REDSTONE,v:VER.V1_21},
    "minecraft:waxed_oxidized_copper_bulb":{b:"waxed_oxidized_copper_bulb",c:CAT.REDSTONE,v:VER.V1_21},

    // === TERRACOTTA ===
    "minecraft:terracotta":{b:"hardened_clay",c:CAT.BUILDING,v:VER.V1_6},
    "minecraft:white_terracotta":{b:"stained_hardened_clay",c:CAT.BUILDING,v:VER.V1_6},
    "minecraft:orange_terracotta":{b:"stained_hardened_clay",c:CAT.BUILDING,v:VER.V1_6},
    "minecraft:magenta_terracotta":{b:"stained_hardened_clay",c:CAT.BUILDING,v:VER.V1_6},
    "minecraft:light_blue_terracotta":{b:"stained_hardened_clay",c:CAT.BUILDING,v:VER.V1_6},
    "minecraft:yellow_terracotta":{b:"stained_hardened_clay",c:CAT.BUILDING,v:VER.V1_6},
    "minecraft:lime_terracotta":{b:"stained_hardened_clay",c:CAT.BUILDING,v:VER.V1_6},
    "minecraft:pink_terracotta":{b:"stained_hardened_clay",c:CAT.BUILDING,v:VER.V1_6},
    "minecraft:gray_terracotta":{b:"stained_hardened_clay",c:CAT.BUILDING,v:VER.V1_6},
    "minecraft:light_gray_terracotta":{b:"stained_hardened_clay",c:CAT.BUILDING,v:VER.V1_6},
    "minecraft:cyan_terracotta":{b:"stained_hardened_clay",c:CAT.BUILDING,v:VER.V1_6},
    "minecraft:purple_terracotta":{b:"stained_hardened_clay",c:CAT.BUILDING,v:VER.V1_6},
    "minecraft:blue_terracotta":{b:"stained_hardened_clay",c:CAT.BUILDING,v:VER.V1_6},
    "minecraft:brown_terracotta":{b:"stained_hardened_clay",c:CAT.BUILDING,v:VER.V1_6},
    "minecraft:green_terracotta":{b:"stained_hardened_clay",c:CAT.BUILDING,v:VER.V1_6},
    "minecraft:red_terracotta":{b:"stained_hardened_clay",c:CAT.BUILDING,v:VER.V1_6},
    "minecraft:black_terracotta":{b:"stained_hardened_clay",c:CAT.BUILDING,v:VER.V1_6},

    // === GLAZED TERRACOTTA ===
    "minecraft:white_glazed_terracotta":{b:"white_glazed_terracotta",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:orange_glazed_terracotta":{b:"orange_glazed_terracotta",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:magenta_glazed_terracotta":{b:"magenta_glazed_terracotta",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:light_blue_glazed_terracotta":{b:"light_blue_glazed_terracotta",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:yellow_glazed_terracotta":{b:"yellow_glazed_terracotta",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:lime_glazed_terracotta":{b:"lime_glazed_terracotta",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:pink_glazed_terracotta":{b:"pink_glazed_terracotta",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:gray_glazed_terracotta":{b:"gray_glazed_terracotta",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:light_gray_glazed_terracotta":{b:"silver_glazed_terracotta",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:cyan_glazed_terracotta":{b:"cyan_glazed_terracotta",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:purple_glazed_terracotta":{b:"purple_glazed_terracotta",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:blue_glazed_terracotta":{b:"blue_glazed_terracotta",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:brown_glazed_terracotta":{b:"brown_glazed_terracotta",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:green_glazed_terracotta":{b:"green_glazed_terracotta",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:red_glazed_terracotta":{b:"red_glazed_terracotta",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:black_glazed_terracotta":{b:"black_glazed_terracotta",c:CAT.BUILDING,v:VER.V1_12},

    // === CONCRETE ===
    "minecraft:white_concrete":{b:"concrete",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:orange_concrete":{b:"concrete",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:magenta_concrete":{b:"concrete",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:light_blue_concrete":{b:"concrete",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:yellow_concrete":{b:"concrete",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:lime_concrete":{b:"concrete",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:pink_concrete":{b:"concrete",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:gray_concrete":{b:"concrete",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:light_gray_concrete":{b:"concrete",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:cyan_concrete":{b:"concrete",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:purple_concrete":{b:"concrete",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:blue_concrete":{b:"concrete",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:brown_concrete":{b:"concrete",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:green_concrete":{b:"concrete",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:red_concrete":{b:"concrete",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:black_concrete":{b:"concrete",c:CAT.BUILDING,v:VER.V1_12},

    // === CONCRETE POWDER ===
    "minecraft:white_concrete_powder":{b:"concretepowder",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:orange_concrete_powder":{b:"concretepowder",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:magenta_concrete_powder":{b:"concretepowder",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:light_blue_concrete_powder":{b:"concretepowder",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:yellow_concrete_powder":{b:"concretepowder",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:lime_concrete_powder":{b:"concretepowder",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:pink_concrete_powder":{b:"concretepowder",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:gray_concrete_powder":{b:"concretepowder",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:light_gray_concrete_powder":{b:"concretepowder",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:cyan_concrete_powder":{b:"concretepowder",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:purple_concrete_powder":{b:"concretepowder",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:blue_concrete_powder":{b:"concretepowder",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:brown_concrete_powder":{b:"concretepowder",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:green_concrete_powder":{b:"concretepowder",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:red_concrete_powder":{b:"concretepowder",c:CAT.BUILDING,v:VER.V1_12},
    "minecraft:black_concrete_powder":{b:"concretepowder",c:CAT.BUILDING,v:VER.V1_12},

    // === STONE BRICKS ===
    "minecraft:stone_bricks":{b:"stonebrick",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:mossy_stone_bricks":{b:"stonebrick",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:cracked_stone_bricks":{b:"stonebrick",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:chiseled_stone_bricks":{b:"stonebrick",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:stone_brick_stairs":{b:"stone_brick_stairs",c:CAT.BUILDING,v:VER.BETA,f:1},
    "minecraft:stone_stairs":{b:"stone_stairs",c:CAT.BUILDING,v:VER.V1_14,f:1},
    "minecraft:stone_brick_slab":{b:"stone_brick_slab",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:stone_brick_wall":{b:"stone_brick_wall",c:CAT.BUILDING,v:VER.V1_14},

    // === BRICKS ===
    "minecraft:bricks":{b:"brick_block",c:CAT.BUILDING,v:VER.CLASSIC},
    "minecraft:brick_stairs":{b:"brick_stairs",c:CAT.BUILDING,v:VER.BETA,f:1},
    "minecraft:brick_slab":{b:"brick_slab",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:brick_wall":{b:"brick_wall",c:CAT.BUILDING,v:VER.V1_14},

    // === NETHER BRICKS ===
    "minecraft:nether_bricks":{b:"nether_brick",c:CAT.BUILDING,v:VER.V1_0},
    "minecraft:red_nether_bricks":{b:"red_nether_brick",c:CAT.BUILDING,v:VER.V1_10},
    "minecraft:cracked_nether_bricks":{b:"cracked_nether_bricks",c:CAT.BUILDING,v:VER.V1_16},
    "minecraft:chiseled_nether_bricks":{b:"chiseled_nether_bricks",c:CAT.BUILDING,v:VER.V1_16},
    "minecraft:nether_brick_stairs":{b:"nether_brick_stairs",c:CAT.BUILDING,v:VER.V1_0,f:1},
    "minecraft:nether_brick_slab":{b:"nether_brick_slab",c:CAT.BUILDING,v:VER.V1_0},
    "minecraft:nether_brick_fence":{b:"nether_brick_fence",c:CAT.BUILDING,v:VER.V1_0},
    "minecraft:nether_brick_wall":{b:"nether_brick_wall",c:CAT.BUILDING,v:VER.V1_14},

    // === PRISMARINE ===
    "minecraft:prismarine":{b:"prismarine",c:CAT.BUILDING,v:VER.BE,s:{prismarine_block_type:"prismarine_block_type"}},
    "minecraft:prismarine_bricks":{b:"prismarine",c:CAT.BUILDING,v:VER.BE},
    "minecraft:dark_prismarine":{b:"prismarine",c:CAT.BUILDING,v:VER.BE},
    "minecraft:prismarine_stairs":{b:"prismarine_stairs",c:CAT.BUILDING,v:VER.BE,f:1},
    "minecraft:prismarine_brick_stairs":{b:"prismarine_brick_stairs",c:CAT.BUILDING,v:VER.BE,f:1},
    "minecraft:dark_prismarine_stairs":{b:"dark_prismarine_stairs",c:CAT.BUILDING,v:VER.BE,f:1},
    "minecraft:prismarine_slab":{b:"prismarine_slab",c:CAT.BUILDING,v:VER.BE},
    "minecraft:prismarine_brick_slab":{b:"prismarine_brick_slab",c:CAT.BUILDING,v:VER.BE},
    "minecraft:dark_prismarine_slab":{b:"dark_prismarine_slab",c:CAT.BUILDING,v:VER.BE},
    "minecraft:prismarine_wall":{b:"prismarine_wall",c:CAT.BUILDING,v:VER.V1_14},
    "minecraft:sea_lantern":{b:"sea_lantern",c:CAT.DECORATIVE,v:VER.BE},

    // === QUARTZ ===
    "minecraft:quartz_block":{b:"quartz_block",c:CAT.BUILDING,v:VER.V1_5,s:{chisel_type:"chisel_type",pillar_axis:"pillar_axis"}},
    "minecraft:chiseled_quartz_block":{b:"quartz_block",c:CAT.BUILDING,v:VER.V1_5},
    "minecraft:quartz_pillar":{b:"quartz_block",c:CAT.BUILDING,v:VER.V1_5},
    "minecraft:smooth_quartz":{b:"quartz_block",c:CAT.BUILDING,v:VER.V1_5},
    "minecraft:quartz_bricks":{b:"quartz_bricks",c:CAT.BUILDING,v:VER.V1_16},
    "minecraft:quartz_stairs":{b:"quartz_stairs",c:CAT.BUILDING,v:VER.V1_5,f:1},
    "minecraft:quartz_slab":{b:"quartz_slab",c:CAT.BUILDING,v:VER.V1_5},
    "minecraft:smooth_quartz_stairs":{b:"smooth_quartz_stairs",c:CAT.BUILDING,v:VER.V1_14,f:1},
    "minecraft:smooth_quartz_slab":{b:"smooth_quartz_slab",c:CAT.BUILDING,v:VER.V1_14},

    // === PURPUR ===
    "minecraft:purpur_block":{b:"purpur_block",c:CAT.BUILDING,v:VER.V1_9,s:{chisel_type:"chisel_type",pillar_axis:"pillar_axis"}},
    "minecraft:purpur_pillar":{b:"purpur_block",c:CAT.BUILDING,v:VER.V1_9},
    "minecraft:purpur_stairs":{b:"purpur_stairs",c:CAT.BUILDING,v:VER.V1_9,f:1},
    "minecraft:purpur_slab":{b:"purpur_slab",c:CAT.BUILDING,v:VER.V1_9},

    // === END BLOCKS ===
    "minecraft:end_stone":{b:"end_stone",c:CAT.NATURAL,v:VER.V1_0},
    "minecraft:end_stone_bricks":{b:"end_bricks",c:CAT.BUILDING,v:VER.V1_9},
    "minecraft:end_stone_brick_stairs":{b:"end_brick_stairs",c:CAT.BUILDING,v:VER.V1_9,f:1},
    "minecraft:end_stone_brick_slab":{b:"end_brick_slab",c:CAT.BUILDING,v:VER.V1_9},
    "minecraft:end_stone_brick_wall":{b:"end_brick_wall",c:CAT.BUILDING,v:VER.V1_14},

    // === BLACKSTONE ===
    "minecraft:blackstone":{b:"blackstone",c:CAT.NATURAL,v:VER.V1_16},
    "minecraft:blackstone_stairs":{b:"blackstone_stairs",c:CAT.BUILDING,v:VER.V1_16,f:1},
    "minecraft:blackstone_slab":{b:"blackstone_slab",c:CAT.BUILDING,v:VER.V1_16},
    "minecraft:blackstone_wall":{b:"blackstone_wall",c:CAT.BUILDING,v:VER.V1_16},
    "minecraft:polished_blackstone":{b:"polished_blackstone",c:CAT.BUILDING,v:VER.V1_16},
    "minecraft:polished_blackstone_stairs":{b:"polished_blackstone_stairs",c:CAT.BUILDING,v:VER.V1_16,f:1},
    "minecraft:polished_blackstone_slab":{b:"polished_blackstone_slab",c:CAT.BUILDING,v:VER.V1_16},
    "minecraft:polished_blackstone_wall":{b:"polished_blackstone_wall",c:CAT.BUILDING,v:VER.V1_16},
    "minecraft:polished_blackstone_bricks":{b:"polished_blackstone_bricks",c:CAT.BUILDING,v:VER.V1_16},
    "minecraft:polished_blackstone_brick_stairs":{b:"polished_blackstone_brick_stairs",c:CAT.BUILDING,v:VER.V1_16,f:1},
    "minecraft:polished_blackstone_brick_slab":{b:"polished_blackstone_brick_slab",c:CAT.BUILDING,v:VER.V1_16},
    "minecraft:polished_blackstone_brick_wall":{b:"polished_blackstone_brick_wall",c:CAT.BUILDING,v:VER.V1_16},
    "minecraft:chiseled_polished_blackstone":{b:"chiseled_polished_blackstone",c:CAT.BUILDING,v:VER.V1_16},
    "minecraft:cracked_polished_blackstone_bricks":{b:"cracked_polished_blackstone_bricks",c:CAT.BUILDING,v:VER.V1_16},
    "minecraft:gilded_blackstone":{b:"gilded_blackstone",c:CAT.NATURAL,v:VER.V1_16},

    // === DEEPSLATE ===
    "minecraft:deepslate":{b:"deepslate",c:CAT.NATURAL,v:VER.V1_17},
    "minecraft:cobbled_deepslate":{b:"cobbled_deepslate",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:cobbled_deepslate_stairs":{b:"cobbled_deepslate_stairs",c:CAT.BUILDING,v:VER.V1_17,f:1},
    "minecraft:cobbled_deepslate_slab":{b:"cobbled_deepslate_slab",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:cobbled_deepslate_wall":{b:"cobbled_deepslate_wall",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:polished_deepslate":{b:"polished_deepslate",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:polished_deepslate_stairs":{b:"polished_deepslate_stairs",c:CAT.BUILDING,v:VER.V1_17,f:1},
    "minecraft:polished_deepslate_slab":{b:"polished_deepslate_slab",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:polished_deepslate_wall":{b:"polished_deepslate_wall",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:deepslate_bricks":{b:"deepslate_bricks",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:cracked_deepslate_bricks":{b:"cracked_deepslate_bricks",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:deepslate_brick_stairs":{b:"deepslate_brick_stairs",c:CAT.BUILDING,v:VER.V1_17,f:1},
    "minecraft:deepslate_brick_slab":{b:"deepslate_brick_slab",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:deepslate_brick_wall":{b:"deepslate_brick_wall",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:deepslate_tiles":{b:"deepslate_tiles",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:cracked_deepslate_tiles":{b:"cracked_deepslate_tiles",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:deepslate_tile_stairs":{b:"deepslate_tile_stairs",c:CAT.BUILDING,v:VER.V1_17,f:1},
    "minecraft:deepslate_tile_slab":{b:"deepslate_tile_slab",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:deepslate_tile_wall":{b:"deepslate_tile_wall",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:chiseled_deepslate":{b:"chiseled_deepslate",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:reinforced_deepslate":{b:"reinforced_deepslate",c:CAT.BUILDING,v:VER.V1_19},

    // === TUFF ===
    "minecraft:tuff":{b:"tuff",c:CAT.NATURAL,v:VER.V1_17},
    "minecraft:tuff_stairs":{b:"tuff_stairs",c:CAT.BUILDING,v:VER.V1_21,f:1},
    "minecraft:tuff_slab":{b:"tuff_slab",c:CAT.BUILDING,v:VER.V1_21},
    "minecraft:tuff_wall":{b:"tuff_wall",c:CAT.BUILDING,v:VER.V1_21},
    "minecraft:polished_tuff":{b:"polished_tuff",c:CAT.BUILDING,v:VER.V1_21},
    "minecraft:polished_tuff_stairs":{b:"polished_tuff_stairs",c:CAT.BUILDING,v:VER.V1_21,f:1},
    "minecraft:polished_tuff_slab":{b:"polished_tuff_slab",c:CAT.BUILDING,v:VER.V1_21},
    "minecraft:polished_tuff_wall":{b:"polished_tuff_wall",c:CAT.BUILDING,v:VER.V1_21},
    "minecraft:tuff_bricks":{b:"tuff_bricks",c:CAT.BUILDING,v:VER.V1_21},
    "minecraft:tuff_brick_stairs":{b:"tuff_brick_stairs",c:CAT.BUILDING,v:VER.V1_21,f:1},
    "minecraft:tuff_brick_slab":{b:"tuff_brick_slab",c:CAT.BUILDING,v:VER.V1_21},
    "minecraft:tuff_brick_wall":{b:"tuff_brick_wall",c:CAT.BUILDING,v:VER.V1_21},
    "minecraft:chiseled_tuff":{b:"chiseled_tuff",c:CAT.BUILDING,v:VER.V1_21},
    "minecraft:chiseled_tuff_bricks":{b:"chiseled_tuff_bricks",c:CAT.BUILDING,v:VER.V1_21},

    // === CALCITE & DRIPSTONE ===
    "minecraft:calcite":{b:"calcite",c:CAT.NATURAL,v:VER.V1_17},
    "minecraft:dripstone_block":{b:"dripstone_block",c:CAT.NATURAL,v:VER.V1_17},
    "minecraft:pointed_dripstone":{b:"pointed_dripstone",c:CAT.NATURAL,v:VER.V1_17},

    // === AMETHYST ===
    "minecraft:amethyst_block":{b:"amethyst_block",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:budding_amethyst":{b:"budding_amethyst",c:CAT.NATURAL,v:VER.V1_17},
    "minecraft:small_amethyst_bud":{b:"small_amethyst_bud",c:CAT.DECORATIVE,v:VER.V1_17},
    "minecraft:medium_amethyst_bud":{b:"medium_amethyst_bud",c:CAT.DECORATIVE,v:VER.V1_17},
    "minecraft:large_amethyst_bud":{b:"large_amethyst_bud",c:CAT.DECORATIVE,v:VER.V1_17},
    "minecraft:amethyst_cluster":{b:"amethyst_cluster",c:CAT.DECORATIVE,v:VER.V1_17},

    // === LOGS ===
    "minecraft:oak_log":{b:"log",c:CAT.NATURAL,v:VER.CLASSIC,s:{axis:"pillar_axis"},f:16},
    "minecraft:spruce_log":{b:"log",c:CAT.NATURAL,v:VER.BETA},
    "minecraft:birch_log":{b:"log",c:CAT.NATURAL,v:VER.BETA},
    "minecraft:jungle_log":{b:"log",c:CAT.NATURAL,v:VER.V1_2},
    "minecraft:acacia_log":{b:"log2",c:CAT.NATURAL,v:VER.V1_7},
    "minecraft:dark_oak_log":{b:"log2",c:CAT.NATURAL,v:VER.V1_7},
    "minecraft:mangrove_log":{b:"mangrove_log",c:CAT.NATURAL,v:VER.V1_19},
    "minecraft:cherry_log":{b:"cherry_log",c:CAT.NATURAL,v:VER.V1_20},
    "minecraft:pale_oak_log":{b:"pale_oak_log",c:CAT.NATURAL,v:VER.V1_21},
    "minecraft:bamboo_block":{b:"bamboo_block",c:CAT.BUILDING,v:VER.V1_20},
    "minecraft:stripped_oak_log":{b:"stripped_oak_log",c:CAT.NATURAL,v:VER.V1_13},
    "minecraft:stripped_spruce_log":{b:"stripped_spruce_log",c:CAT.NATURAL,v:VER.V1_13},
    "minecraft:stripped_birch_log":{b:"stripped_birch_log",c:CAT.NATURAL,v:VER.V1_13},
    "minecraft:stripped_jungle_log":{b:"stripped_jungle_log",c:CAT.NATURAL,v:VER.V1_13},
    "minecraft:stripped_acacia_log":{b:"stripped_acacia_log",c:CAT.NATURAL,v:VER.V1_13},
    "minecraft:stripped_dark_oak_log":{b:"stripped_dark_oak_log",c:CAT.NATURAL,v:VER.V1_13},
    "minecraft:stripped_mangrove_log":{b:"stripped_mangrove_log",c:CAT.NATURAL,v:VER.V1_19},
    "minecraft:stripped_cherry_log":{b:"stripped_cherry_log",c:CAT.NATURAL,v:VER.V1_20},
    "minecraft:stripped_bamboo_block":{b:"stripped_bamboo_block",c:CAT.BUILDING,v:VER.V1_20},

    // === WOOD ===
    "minecraft:oak_wood":{b:"wood",c:CAT.NATURAL,v:VER.V1_13,s:{axis:"pillar_axis"},f:16},
    "minecraft:spruce_wood":{b:"wood",c:CAT.NATURAL,v:VER.V1_13},
    "minecraft:birch_wood":{b:"wood",c:CAT.NATURAL,v:VER.V1_13},
    "minecraft:jungle_wood":{b:"wood",c:CAT.NATURAL,v:VER.V1_13},
    "minecraft:acacia_wood":{b:"wood",c:CAT.NATURAL,v:VER.V1_13},
    "minecraft:dark_oak_wood":{b:"wood",c:CAT.NATURAL,v:VER.V1_13},
    "minecraft:mangrove_wood":{b:"mangrove_wood",c:CAT.NATURAL,v:VER.V1_19},
    "minecraft:cherry_wood":{b:"cherry_wood",c:CAT.NATURAL,v:VER.V1_20},
    "minecraft:stripped_oak_wood":{b:"wood",c:CAT.NATURAL,v:VER.V1_13,f:16},
    "minecraft:stripped_spruce_wood":{b:"wood",c:CAT.NATURAL,v:VER.V1_13},
    "minecraft:stripped_birch_wood":{b:"wood",c:CAT.NATURAL,v:VER.V1_13},
    "minecraft:stripped_jungle_wood":{b:"wood",c:CAT.NATURAL,v:VER.V1_13},
    "minecraft:stripped_acacia_wood":{b:"wood",c:CAT.NATURAL,v:VER.V1_13},
    "minecraft:stripped_dark_oak_wood":{b:"wood",c:CAT.NATURAL,v:VER.V1_13},
    "minecraft:stripped_mangrove_wood":{b:"stripped_mangrove_wood",c:CAT.NATURAL,v:VER.V1_19},
    "minecraft:stripped_cherry_wood":{b:"stripped_cherry_wood",c:CAT.NATURAL,v:VER.V1_20},

    // === PLANKS ===
    "minecraft:oak_planks":{b:"planks",c:CAT.BUILDING,v:VER.CLASSIC,f:16},
    "minecraft:spruce_planks":{b:"planks",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:birch_planks":{b:"planks",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:jungle_planks":{b:"planks",c:CAT.BUILDING,v:VER.V1_2},
    "minecraft:acacia_planks":{b:"planks",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:dark_oak_planks":{b:"planks",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:crimson_planks":{b:"crimson_planks",c:CAT.BUILDING,v:VER.V1_16},
    "minecraft:warped_planks":{b:"warped_planks",c:CAT.BUILDING,v:VER.V1_16},
    "minecraft:mangrove_planks":{b:"mangrove_planks",c:CAT.BUILDING,v:VER.V1_19},
    "minecraft:cherry_planks":{b:"cherry_planks",c:CAT.BUILDING,v:VER.V1_20},
    "minecraft:bamboo_planks":{b:"bamboo_planks",c:CAT.BUILDING,v:VER.V1_20},

    // === WOOD STAIRS ===
    "minecraft:oak_stairs":{b:"oak_stairs",c:CAT.BUILDING,v:VER.BETA,f:1},
    "minecraft:spruce_stairs":{b:"spruce_stairs",c:CAT.BUILDING,v:VER.V1_3,f:1},
    "minecraft:birch_stairs":{b:"birch_stairs",c:CAT.BUILDING,v:VER.V1_3,f:1},
    "minecraft:jungle_stairs":{b:"jungle_stairs",c:CAT.BUILDING,v:VER.V1_3,f:1},
    "minecraft:acacia_stairs":{b:"acacia_stairs",c:CAT.BUILDING,v:VER.V1_7,f:1},
    "minecraft:dark_oak_stairs":{b:"dark_oak_stairs",c:CAT.BUILDING,v:VER.V1_7,f:1},
    "minecraft:crimson_stairs":{b:"crimson_stairs",c:CAT.BUILDING,v:VER.V1_16,f:1},
    "minecraft:warped_stairs":{b:"warped_stairs",c:CAT.BUILDING,v:VER.V1_16,f:1},
    "minecraft:mangrove_stairs":{b:"mangrove_stairs",c:CAT.BUILDING,v:VER.V1_19,f:1},
    "minecraft:cherry_stairs":{b:"cherry_stairs",c:CAT.BUILDING,v:VER.V1_20,f:1},
    "minecraft:bamboo_stairs":{b:"bamboo_stairs",c:CAT.BUILDING,v:VER.V1_20,f:1},

    // === WOOD SLABS ===
    "minecraft:oak_slab":{b:"wooden_slab",c:CAT.BUILDING,v:VER.BETA,f:16},
    "minecraft:spruce_slab":{b:"wooden_slab",c:CAT.BUILDING,v:VER.V1_3},
    "minecraft:birch_slab":{b:"wooden_slab",c:CAT.BUILDING,v:VER.V1_3},
    "minecraft:jungle_slab":{b:"wooden_slab",c:CAT.BUILDING,v:VER.V1_3},
    "minecraft:acacia_slab":{b:"wooden_slab",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:dark_oak_slab":{b:"wooden_slab",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:crimson_slab":{b:"crimson_slab",c:CAT.BUILDING,v:VER.V1_16},
    "minecraft:warped_slab":{b:"warped_slab",c:CAT.BUILDING,v:VER.V1_16},
    "minecraft:mangrove_slab":{b:"mangrove_slab",c:CAT.BUILDING,v:VER.V1_19},
    "minecraft:cherry_slab":{b:"cherry_slab",c:CAT.BUILDING,v:VER.V1_20},
    "minecraft:bamboo_slab":{b:"bamboo_slab",c:CAT.BUILDING,v:VER.V1_20},

    // === WOOD FENCES ===
    "minecraft:oak_fence":{b:"fence",c:CAT.BUILDING,v:VER.BETA,f:16},
    "minecraft:spruce_fence":{b:"fence",c:CAT.BUILDING,v:VER.BE},
    "minecraft:birch_fence":{b:"fence",c:CAT.BUILDING,v:VER.BE},
    "minecraft:jungle_fence":{b:"fence",c:CAT.BUILDING,v:VER.BE},
    "minecraft:acacia_fence":{b:"fence",c:CAT.BUILDING,v:VER.BE},
    "minecraft:dark_oak_fence":{b:"fence",c:CAT.BUILDING,v:VER.BE},
    "minecraft:crimson_fence":{b:"crimson_fence",c:CAT.BUILDING,v:VER.V1_16},
    "minecraft:warped_fence":{b:"warped_fence",c:CAT.BUILDING,v:VER.V1_16},
    "minecraft:mangrove_fence":{b:"mangrove_fence",c:CAT.BUILDING,v:VER.V1_19},
    "minecraft:cherry_fence":{b:"cherry_fence",c:CAT.BUILDING,v:VER.V1_20},
    "minecraft:bamboo_fence":{b:"bamboo_fence",c:CAT.BUILDING,v:VER.V1_20},

    // === WOOD FENCE GATES ===
    "minecraft:oak_fence_gate":{b:"fence_gate",c:CAT.BUILDING,v:VER.BETA,f:17},
    "minecraft:spruce_fence_gate":{b:"spruce_fence_gate",c:CAT.BUILDING,v:VER.BE},
    "minecraft:birch_fence_gate":{b:"birch_fence_gate",c:CAT.BUILDING,v:VER.BE},
    "minecraft:jungle_fence_gate":{b:"jungle_fence_gate",c:CAT.BUILDING,v:VER.BE},
    "minecraft:acacia_fence_gate":{b:"acacia_fence_gate",c:CAT.BUILDING,v:VER.BE},
    "minecraft:dark_oak_fence_gate":{b:"dark_oak_fence_gate",c:CAT.BUILDING,v:VER.BE},
    "minecraft:crimson_fence_gate":{b:"crimson_fence_gate",c:CAT.BUILDING,v:VER.V1_16},
    "minecraft:warped_fence_gate":{b:"warped_fence_gate",c:CAT.BUILDING,v:VER.V1_16},
    "minecraft:mangrove_fence_gate":{b:"mangrove_fence_gate",c:CAT.BUILDING,v:VER.V1_19},
    "minecraft:cherry_fence_gate":{b:"cherry_fence_gate",c:CAT.BUILDING,v:VER.V1_20},
    "minecraft:bamboo_fence_gate":{b:"bamboo_fence_gate",c:CAT.BUILDING,v:VER.V1_20},

    // === WOOD DOORS ===
    "minecraft:oak_door":{b:"wooden_door",c:CAT.FUNCTIONAL,v:VER.BETA,f:1},
    "minecraft:spruce_door":{b:"spruce_door",c:CAT.FUNCTIONAL,v:VER.V1_8},
    "minecraft:birch_door":{b:"birch_door",c:CAT.FUNCTIONAL,v:VER.V1_8},
    "minecraft:jungle_door":{b:"jungle_door",c:CAT.FUNCTIONAL,v:VER.V1_8},
    "minecraft:acacia_door":{b:"acacia_door",c:CAT.FUNCTIONAL,v:VER.V1_8},
    "minecraft:dark_oak_door":{b:"dark_oak_door",c:CAT.FUNCTIONAL,v:VER.V1_8},
    "minecraft:crimson_door":{b:"crimson_door",c:CAT.FUNCTIONAL,v:VER.V1_16},
    "minecraft:warped_door":{b:"warped_door",c:CAT.FUNCTIONAL,v:VER.V1_16},
    "minecraft:mangrove_door":{b:"mangrove_door",c:CAT.FUNCTIONAL,v:VER.V1_19},
    "minecraft:cherry_door":{b:"cherry_door",c:CAT.FUNCTIONAL,v:VER.V1_20},
    "minecraft:bamboo_door":{b:"bamboo_door",c:CAT.FUNCTIONAL,v:VER.V1_20},
    "minecraft:iron_door":{b:"iron_door",c:CAT.FUNCTIONAL,v:VER.BETA,f:1},

    // === WOOD TRAPDOORS ===
    "minecraft:oak_trapdoor":{b:"trapdoor",c:CAT.FUNCTIONAL,v:VER.BETA,f:17},
    "minecraft:spruce_trapdoor":{b:"spruce_trapdoor",c:CAT.FUNCTIONAL,v:VER.V1_13},
    "minecraft:birch_trapdoor":{b:"birch_trapdoor",c:CAT.FUNCTIONAL,v:VER.V1_13},
    "minecraft:jungle_trapdoor":{b:"jungle_trapdoor",c:CAT.FUNCTIONAL,v:VER.V1_13},
    "minecraft:acacia_trapdoor":{b:"acacia_trapdoor",c:CAT.FUNCTIONAL,v:VER.V1_13},
    "minecraft:dark_oak_trapdoor":{b:"dark_oak_trapdoor",c:CAT.FUNCTIONAL,v:VER.V1_13},
    "minecraft:crimson_trapdoor":{b:"crimson_trapdoor",c:CAT.FUNCTIONAL,v:VER.V1_16},
    "minecraft:warped_trapdoor":{b:"warped_trapdoor",c:CAT.FUNCTIONAL,v:VER.V1_16},
    "minecraft:mangrove_trapdoor":{b:"mangrove_trapdoor",c:CAT.FUNCTIONAL,v:VER.V1_19},
    "minecraft:cherry_trapdoor":{b:"cherry_trapdoor",c:CAT.FUNCTIONAL,v:VER.V1_20},
    "minecraft:bamboo_trapdoor":{b:"bamboo_trapdoor",c:CAT.FUNCTIONAL,v:VER.V1_20},
    "minecraft:iron_trapdoor":{b:"iron_trapdoor",c:CAT.FUNCTIONAL,v:VER.BE,f:1},

    // === WOOD BUTTONS ===
    "minecraft:oak_button":{b:"wooden_button",c:CAT.REDSTONE,v:VER.BETA,f:17},
    "minecraft:spruce_button":{b:"wooden_button",c:CAT.REDSTONE,v:VER.V1_13,f:17},
    "minecraft:birch_button":{b:"wooden_button",c:CAT.REDSTONE,v:VER.V1_13,f:17},
    "minecraft:jungle_button":{b:"wooden_button",c:CAT.REDSTONE,v:VER.V1_13,f:17},
    "minecraft:acacia_button":{b:"wooden_button",c:CAT.REDSTONE,v:VER.V1_13,f:17},
    "minecraft:dark_oak_button":{b:"wooden_button",c:CAT.REDSTONE,v:VER.V1_13,f:17},
    "minecraft:crimson_button":{b:"crimson_button",c:CAT.REDSTONE,v:VER.V1_16,f:1},
    "minecraft:warped_button":{b:"warped_button",c:CAT.REDSTONE,v:VER.V1_16,f:1},
    "minecraft:mangrove_button":{b:"mangrove_button",c:CAT.REDSTONE,v:VER.V1_19,f:1},
    "minecraft:cherry_button":{b:"cherry_button",c:CAT.REDSTONE,v:VER.V1_20,f:1},
    "minecraft:bamboo_button":{b:"bamboo_button",c:CAT.REDSTONE,v:VER.V1_20,f:1},

    // === WOOD PRESSURE PLATES ===
    "minecraft:oak_pressure_plate":{b:"wooden_pressure_plate",c:CAT.REDSTONE,v:VER.BETA,f:16},
    "minecraft:spruce_pressure_plate":{b:"spruce_pressure_plate",c:CAT.REDSTONE,v:VER.V1_13},
    "minecraft:birch_pressure_plate":{b:"birch_pressure_plate",c:CAT.REDSTONE,v:VER.V1_13},
    "minecraft:jungle_pressure_plate":{b:"jungle_pressure_plate",c:CAT.REDSTONE,v:VER.V1_13},
    "minecraft:acacia_pressure_plate":{b:"acacia_pressure_plate",c:CAT.REDSTONE,v:VER.V1_13},
    "minecraft:dark_oak_pressure_plate":{b:"dark_oak_pressure_plate",c:CAT.REDSTONE,v:VER.V1_13},
    "minecraft:crimson_pressure_plate":{b:"crimson_pressure_plate",c:CAT.REDSTONE,v:VER.V1_16},
    "minecraft:warped_pressure_plate":{b:"warped_pressure_plate",c:CAT.REDSTONE,v:VER.V1_16},
    "minecraft:mangrove_pressure_plate":{b:"mangrove_pressure_plate",c:CAT.REDSTONE,v:VER.V1_19},
    "minecraft:cherry_pressure_plate":{b:"cherry_pressure_plate",c:CAT.REDSTONE,v:VER.V1_20},
    "minecraft:bamboo_pressure_plate":{b:"bamboo_pressure_plate",c:CAT.REDSTONE,v:VER.V1_20},

    // === LEAVES ===
    "minecraft:oak_leaves":{b:"leaves",c:CAT.PLANT,v:VER.CLASSIC,f:16},
    "minecraft:spruce_leaves":{b:"leaves",c:CAT.PLANT,v:VER.CLASSIC},
    "minecraft:birch_leaves":{b:"leaves",c:CAT.PLANT,v:VER.CLASSIC},
    "minecraft:jungle_leaves":{b:"leaves",c:CAT.PLANT,v:VER.CLASSIC},
    "minecraft:acacia_leaves":{b:"leaves2",c:CAT.PLANT,v:VER.V1_7},
    "minecraft:dark_oak_leaves":{b:"leaves2",c:CAT.PLANT,v:VER.V1_7},
    "minecraft:mangrove_leaves":{b:"mangrove_leaves",c:CAT.PLANT,v:VER.V1_19},
    "minecraft:cherry_leaves":{b:"cherry_leaves",c:CAT.PLANT,v:VER.V1_20},
    "minecraft:azalea_leaves":{b:"azalea_leaves",c:CAT.PLANT,v:VER.V1_17},
    "minecraft:flowering_azalea_leaves":{b:"azalea_leaves_flowered",c:CAT.PLANT,v:VER.V1_17},

    // === SAPLINGS ===
    "minecraft:oak_sapling":{b:"sapling",c:CAT.PLANT,v:VER.CLASSIC,f:16},
    "minecraft:spruce_sapling":{b:"sapling",c:CAT.PLANT,v:VER.CLASSIC},
    "minecraft:birch_sapling":{b:"sapling",c:CAT.PLANT,v:VER.CLASSIC},
    "minecraft:jungle_sapling":{b:"sapling",c:CAT.PLANT,v:VER.CLASSIC},
    "minecraft:acacia_sapling":{b:"sapling",c:CAT.PLANT,v:VER.V1_7},
    "minecraft:dark_oak_sapling":{b:"sapling",c:CAT.PLANT,v:VER.V1_7},
    "minecraft:mangrove_propagule":{b:"mangrove_propagule",c:CAT.PLANT,v:VER.V1_19},
    "minecraft:cherry_sapling":{b:"cherry_sapling",c:CAT.PLANT,v:VER.V1_20},

    // === NETHER STEMS ===
    "minecraft:crimson_stem":{b:"crimson_stem",c:CAT.NATURAL,v:VER.V1_16,s:{axis:"pillar_axis"}},
    "minecraft:warped_stem":{b:"warped_stem",c:CAT.NATURAL,v:VER.V1_16},
    "minecraft:stripped_crimson_stem":{b:"stripped_crimson_stem",c:CAT.NATURAL,v:VER.V1_16},
    "minecraft:stripped_warped_stem":{b:"stripped_warped_stem",c:CAT.NATURAL,v:VER.V1_16},
    "minecraft:crimson_hyphae":{b:"crimson_hyphae",c:CAT.NATURAL,v:VER.V1_16},
    "minecraft:warped_hyphae":{b:"warped_hyphae",c:CAT.NATURAL,v:VER.V1_16},
    "minecraft:stripped_crimson_hyphae":{b:"stripped_crimson_hyphae",c:CAT.NATURAL,v:VER.V1_16},
    "minecraft:stripped_warped_hyphae":{b:"stripped_warped_hyphae",c:CAT.NATURAL,v:VER.V1_16},

    // === NETHER BLOCKS ===
    "minecraft:netherrack":{b:"netherrack",c:CAT.NATURAL,v:VER.BETA},
    "minecraft:soul_sand":{b:"soul_sand",c:CAT.NATURAL,v:VER.BETA},
    "minecraft:soul_soil":{b:"soul_soil",c:CAT.NATURAL,v:VER.V1_16},
    "minecraft:glowstone":{b:"glowstone",c:CAT.NATURAL,v:VER.BETA},
    "minecraft:magma_block":{b:"magma",c:CAT.NATURAL,v:VER.V1_10},
    "minecraft:basalt":{b:"basalt",c:CAT.NATURAL,v:VER.V1_16,s:{axis:"pillar_axis"}},
    "minecraft:polished_basalt":{b:"polished_basalt",c:CAT.BUILDING,v:VER.V1_16,s:{axis:"pillar_axis"}},
    "minecraft:smooth_basalt":{b:"smooth_basalt",c:CAT.NATURAL,v:VER.V1_17},
    "minecraft:bone_block":{b:"bone_block",c:CAT.DECORATIVE,v:VER.V1_10,s:{axis:"pillar_axis"}},
    "minecraft:nether_wart_block":{b:"nether_wart_block",c:CAT.PLANT,v:VER.V1_10},
    "minecraft:warped_wart_block":{b:"warped_wart_block",c:CAT.PLANT,v:VER.V1_16},
    "minecraft:crimson_nylium":{b:"crimson_nylium",c:CAT.NATURAL,v:VER.V1_16},
    "minecraft:warped_nylium":{b:"warped_nylium",c:CAT.NATURAL,v:VER.V1_16},
    "minecraft:shroomlight":{b:"shroomlight",c:CAT.PLANT,v:VER.V1_16},

    // === GLASS ===
    "minecraft:glass":{b:"glass",c:CAT.BUILDING,v:VER.CLASSIC},
    "minecraft:tinted_glass":{b:"tinted_glass",c:CAT.BUILDING,v:VER.V1_17},
    "minecraft:glass_pane":{b:"glass_pane",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:white_stained_glass":{b:"stained_glass",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:orange_stained_glass":{b:"stained_glass",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:magenta_stained_glass":{b:"stained_glass",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:light_blue_stained_glass":{b:"stained_glass",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:yellow_stained_glass":{b:"stained_glass",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:lime_stained_glass":{b:"stained_glass",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:pink_stained_glass":{b:"stained_glass",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:gray_stained_glass":{b:"stained_glass",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:light_gray_stained_glass":{b:"stained_glass",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:cyan_stained_glass":{b:"stained_glass",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:purple_stained_glass":{b:"stained_glass",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:blue_stained_glass":{b:"stained_glass",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:brown_stained_glass":{b:"stained_glass",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:green_stained_glass":{b:"stained_glass",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:red_stained_glass":{b:"stained_glass",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:black_stained_glass":{b:"stained_glass",c:CAT.BUILDING,v:VER.V1_7},

    // === STAINED GLASS PANES ===
    "minecraft:white_stained_glass_pane":{b:"stained_glass_pane",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:orange_stained_glass_pane":{b:"stained_glass_pane",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:magenta_stained_glass_pane":{b:"stained_glass_pane",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:light_blue_stained_glass_pane":{b:"stained_glass_pane",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:yellow_stained_glass_pane":{b:"stained_glass_pane",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:lime_stained_glass_pane":{b:"stained_glass_pane",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:pink_stained_glass_pane":{b:"stained_glass_pane",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:gray_stained_glass_pane":{b:"stained_glass_pane",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:light_gray_stained_glass_pane":{b:"stained_glass_pane",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:cyan_stained_glass_pane":{b:"stained_glass_pane",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:purple_stained_glass_pane":{b:"stained_glass_pane",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:blue_stained_glass_pane":{b:"stained_glass_pane",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:brown_stained_glass_pane":{b:"stained_glass_pane",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:green_stained_glass_pane":{b:"stained_glass_pane",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:red_stained_glass_pane":{b:"stained_glass_pane",c:CAT.BUILDING,v:VER.V1_7},
    "minecraft:black_stained_glass_pane":{b:"stained_glass_pane",c:CAT.BUILDING,v:VER.V1_7},

    // === WOOL & CARPET ===
    "minecraft:white_wool":{b:"wool",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:orange_wool":{b:"wool",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:magenta_wool":{b:"wool",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:light_blue_wool":{b:"wool",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:yellow_wool":{b:"wool",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:lime_wool":{b:"wool",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:pink_wool":{b:"wool",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:gray_wool":{b:"wool",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:light_gray_wool":{b:"wool",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:cyan_wool":{b:"wool",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:purple_wool":{b:"wool",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:blue_wool":{b:"wool",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:brown_wool":{b:"wool",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:green_wool":{b:"wool",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:red_wool":{b:"wool",c:CAT.BUILDING,v:VER.BETA},
    "minecraft:black_wool":{b:"wool",c:CAT.BUILDING,v:VER.BETA},

    "minecraft:white_carpet":{b:"carpet",c:CAT.DECORATIVE,v:VER.V1_6},
    "minecraft:orange_carpet":{b:"carpet",c:CAT.DECORATIVE,v:VER.V1_6},
    "minecraft:magenta_carpet":{b:"carpet",c:CAT.DECORATIVE,v:VER.V1_6},
    "minecraft:light_blue_carpet":{b:"carpet",c:CAT.DECORATIVE,v:VER.V1_6},
    "minecraft:yellow_carpet":{b:"carpet",c:CAT.DECORATIVE,v:VER.V1_6},
    "minecraft:lime_carpet":{b:"carpet",c:CAT.DECORATIVE,v:VER.V1_6},
    "minecraft:pink_carpet":{b:"carpet",c:CAT.DECORATIVE,v:VER.V1_6},
    "minecraft:gray_carpet":{b:"carpet",c:CAT.DECORATIVE,v:VER.V1_6},
    "minecraft:light_gray_carpet":{b:"carpet",c:CAT.DECORATIVE,v:VER.V1_6},
    "minecraft:cyan_carpet":{b:"carpet",c:CAT.DECORATIVE,v:VER.V1_6},
    "minecraft:purple_carpet":{b:"carpet",c:CAT.DECORATIVE,v:VER.V1_6},
    "minecraft:blue_carpet":{b:"carpet",c:CAT.DECORATIVE,v:VER.V1_6},
    "minecraft:brown_carpet":{b:"carpet",c:CAT.DECORATIVE,v:VER.V1_6},
    "minecraft:green_carpet":{b:"carpet",c:CAT.DECORATIVE,v:VER.V1_6},
    "minecraft:red_carpet":{b:"carpet",c:CAT.DECORATIVE,v:VER.V1_6},
    "minecraft:black_carpet":{b:"carpet",c:CAT.DECORATIVE,v:VER.V1_6},

    // === REDSTONE ===
    "minecraft:redstone_wire":{b:"redstone_wire",c:CAT.REDSTONE,v:VER.BETA},
    "minecraft:redstone_torch":{b:"redstone_torch",c:CAT.REDSTONE,v:VER.BETA},
    "minecraft:redstone_wall_torch":{b:"redstone_torch",c:CAT.REDSTONE,v:VER.BETA},
    "minecraft:repeater":{b:"unpowered_repeater",c:CAT.REDSTONE,v:VER.BETA,f:1},
    "minecraft:comparator":{b:"unpowered_comparator",c:CAT.REDSTONE,v:VER.V1_5,f:1},
    "minecraft:observer":{b:"observer",c:CAT.REDSTONE,v:VER.V1_11,f:1},
    "minecraft:hopper":{b:"hopper",c:CAT.REDSTONE,v:VER.V1_5,f:1},
    "minecraft:dropper":{b:"dropper",c:CAT.REDSTONE,v:VER.V1_5,f:1},
    "minecraft:dispenser":{b:"dispenser",c:CAT.REDSTONE,v:VER.BETA,f:1},
    "minecraft:piston":{b:"piston",c:CAT.REDSTONE,v:VER.BETA,f:1},
    "minecraft:sticky_piston":{b:"sticky_piston",c:CAT.REDSTONE,v:VER.BETA,f:1},
    "minecraft:lever":{b:"lever",c:CAT.REDSTONE,v:VER.BETA,f:1},
    "minecraft:stone_button":{b:"stone_button",c:CAT.REDSTONE,v:VER.BETA,f:1},
    "minecraft:stone_pressure_plate":{b:"stone_pressure_plate",c:CAT.REDSTONE,v:VER.BETA},
    "minecraft:light_weighted_pressure_plate":{b:"light_weighted_pressure_plate",c:CAT.REDSTONE,v:VER.V1_5},
    "minecraft:heavy_weighted_pressure_plate":{b:"heavy_weighted_pressure_plate",c:CAT.REDSTONE,v:VER.V1_5},
    "minecraft:daylight_detector":{b:"daylight_detector",c:CAT.REDSTONE,v:VER.V1_5},
    "minecraft:redstone_lamp":{b:"redstone_lamp",c:CAT.REDSTONE,v:VER.V1_2},
    "minecraft:note_block":{b:"noteblock",c:CAT.FUNCTIONAL,v:VER.BETA},
    "minecraft:tripwire_hook":{b:"tripwire_hook",c:CAT.REDSTONE,v:VER.V1_3,f:1},
    "minecraft:tripwire":{b:"tripwire",c:CAT.REDSTONE,v:VER.V1_3},
    "minecraft:target":{b:"target",c:CAT.REDSTONE,v:VER.V1_16},
    "minecraft:sculk_sensor":{b:"sculk_sensor",c:CAT.REDSTONE,v:VER.V1_19},
    "minecraft:calibrated_sculk_sensor":{b:"calibrated_sculk_sensor",c:CAT.REDSTONE,v:VER.V1_20},
    "minecraft:crafter":{b:"crafter",c:CAT.REDSTONE,v:VER.V1_21,f:1},

    // === RAILS ===
    "minecraft:rail":{b:"rail",c:CAT.REDSTONE,v:VER.BETA},
    "minecraft:powered_rail":{b:"golden_rail",c:CAT.REDSTONE,v:VER.BETA},
    "minecraft:detector_rail":{b:"detector_rail",c:CAT.REDSTONE,v:VER.BETA},
    "minecraft:activator_rail":{b:"activator_rail",c:CAT.REDSTONE,v:VER.V1_5},

    // === PLANTS ===
    "minecraft:grass":{b:"tallgrass",c:CAT.PLANT,v:VER.CLASSIC,s:{type:"tall_grass_type"}},
    "minecraft:fern":{b:"tallgrass",c:CAT.PLANT,v:VER.CLASSIC},
    "minecraft:tall_grass":{b:"double_plant",c:CAT.PLANT,v:VER.BETA},
    "minecraft:large_fern":{b:"double_plant",c:CAT.PLANT,v:VER.V1_7},
    "minecraft:dead_bush":{b:"deadbush",c:CAT.PLANT,v:VER.BETA},
    "minecraft:dandelion":{b:"yellow_flower",c:CAT.PLANT,v:VER.CLASSIC},
    "minecraft:poppy":{b:"red_flower",c:CAT.PLANT,v:VER.CLASSIC},
    "minecraft:blue_orchid":{b:"red_flower",c:CAT.PLANT,v:VER.V1_7},
    "minecraft:allium":{b:"red_flower",c:CAT.PLANT,v:VER.V1_7},
    "minecraft:azure_bluet":{b:"red_flower",c:CAT.PLANT,v:VER.V1_7},
    "minecraft:red_tulip":{b:"red_flower",c:CAT.PLANT,v:VER.V1_7},
    "minecraft:orange_tulip":{b:"red_flower",c:CAT.PLANT,v:VER.V1_7},
    "minecraft:white_tulip":{b:"red_flower",c:CAT.PLANT,v:VER.V1_7},
    "minecraft:pink_tulip":{b:"red_flower",c:CAT.PLANT,v:VER.V1_7},
    "minecraft:oxeye_daisy":{b:"red_flower",c:CAT.PLANT,v:VER.V1_7},
    "minecraft:cornflower":{b:"red_flower",c:CAT.PLANT,v:VER.V1_14},
    "minecraft:lily_of_the_valley":{b:"red_flower",c:CAT.PLANT,v:VER.V1_14},
    "minecraft:wither_rose":{b:"wither_rose",c:CAT.PLANT,v:VER.V1_14},
    "minecraft:torchflower":{b:"torchflower",c:CAT.PLANT,v:VER.V1_20},
    "minecraft:pitcher_plant":{b:"pitcher_plant",c:CAT.PLANT,v:VER.V1_20},
    "minecraft:pink_petals":{b:"pink_petals",c:CAT.PLANT,v:VER.V1_20},
    "minecraft:spore_blossom":{b:"spore_blossom",c:CAT.PLANT,v:VER.V1_17},
    "minecraft:sunflower":{b:"double_plant",c:CAT.PLANT,v:VER.V1_7},
    "minecraft:lilac":{b:"double_plant",c:CAT.PLANT,v:VER.V1_7},
    "minecraft:rose_bush":{b:"double_plant",c:CAT.PLANT,v:VER.V1_7},
    "minecraft:peony":{b:"double_plant",c:CAT.PLANT,v:VER.V1_7},

    // === CROPS ===
    "minecraft:wheat":{b:"wheat",c:CAT.PLANT,v:VER.CLASSIC},
    "minecraft:carrots":{b:"carrots",c:CAT.PLANT,v:VER.V1_4},
    "minecraft:potatoes":{b:"potatoes",c:CAT.PLANT,v:VER.V1_4},
    "minecraft:beetroots":{b:"beetroot",c:CAT.PLANT,v:VER.V1_9},
    "minecraft:nether_wart":{b:"nether_wart",c:CAT.PLANT,v:VER.V1_0},
    "minecraft:torchflower_crop":{b:"torchflower_crop",c:CAT.PLANT,v:VER.V1_20},
    "minecraft:pitcher_crop":{b:"pitcher_crop",c:CAT.PLANT,v:VER.V1_20},

    // === VINES & GROWABLES ===
    "minecraft:vine":{b:"vine",c:CAT.PLANT,v:VER.BETA},
    "minecraft:sugar_cane":{b:"reeds",c:CAT.PLANT,v:VER.CLASSIC},
    "minecraft:cactus":{b:"cactus",c:CAT.PLANT,v:VER.CLASSIC},
    "minecraft:bamboo":{b:"bamboo",c:CAT.PLANT,v:VER.V1_14},
    "minecraft:bamboo_sapling":{b:"bamboo_sapling",c:CAT.PLANT,v:VER.V1_14},
    "minecraft:kelp":{b:"kelp",c:CAT.PLANT,v:VER.V1_13},
    "minecraft:weeping_vines":{b:"weeping_vines",c:CAT.PLANT,v:VER.V1_16},
    "minecraft:twisting_vines":{b:"twisting_vines",c:CAT.PLANT,v:VER.V1_16},
    "minecraft:glow_lichen":{b:"glow_lichen",c:CAT.PLANT,v:VER.V1_17},
    "minecraft:hanging_roots":{b:"hanging_roots",c:CAT.PLANT,v:VER.V1_17},
    "minecraft:cave_vines":{b:"cave_vines",c:CAT.PLANT,v:VER.V1_17},
    "minecraft:cave_vines_plant":{b:"cave_vines_body_with_berries",c:CAT.PLANT,v:VER.V1_17},
    "minecraft:sweet_berry_bush":{b:"sweet_berry_bush",c:CAT.PLANT,v:VER.V1_14},

    // === MUSHROOMS ===
    "minecraft:brown_mushroom":{b:"brown_mushroom",c:CAT.PLANT,v:VER.CLASSIC},
    "minecraft:red_mushroom":{b:"red_mushroom",c:CAT.PLANT,v:VER.CLASSIC},
    "minecraft:brown_mushroom_block":{b:"brown_mushroom_block",c:CAT.PLANT,v:VER.BETA},
    "minecraft:red_mushroom_block":{b:"red_mushroom_block",c:CAT.PLANT,v:VER.BETA},
    "minecraft:mushroom_stem":{b:"brown_mushroom_block",c:CAT.PLANT,v:VER.BETA},

    // === PUMPKIN & MELON ===
    "minecraft:pumpkin":{b:"pumpkin",c:CAT.PLANT,v:VER.BETA,s:{facing:"direction"}},
    "minecraft:carved_pumpkin":{b:"carved_pumpkin",c:CAT.PLANT,v:VER.V1_13},
    "minecraft:jack_o_lantern":{b:"lit_pumpkin",c:CAT.PLANT,v:VER.BETA},
    "minecraft:pumpkin_stem":{b:"pumpkin_stem",c:CAT.PLANT,v:VER.BETA},
    "minecraft:melon":{b:"melon_block",c:CAT.PLANT,v:VER.BETA},
    "minecraft:melon_stem":{b:"melon_stem",c:CAT.PLANT,v:VER.BETA},

    // === ICE ===
    "minecraft:ice":{b:"ice",c:CAT.NATURAL,v:VER.CLASSIC},
    "minecraft:packed_ice":{b:"packed_ice",c:CAT.NATURAL,v:VER.V1_7},
    "minecraft:blue_ice":{b:"blue_ice",c:CAT.NATURAL,v:VER.V1_13},
    "minecraft:frosted_ice":{b:"frosted_ice",c:CAT.NATURAL,v:VER.V1_9},
    "minecraft:snow":{b:"snow_layer",c:CAT.NATURAL,v:VER.CLASSIC},
    "minecraft:snow_block":{b:"snow",c:CAT.NATURAL,v:VER.BETA},
    "minecraft:powder_snow":{b:"powder_snow",c:CAT.NATURAL,v:VER.V1_17},

    // === SIGNS ===
    "minecraft:oak_sign":{b:"standing_sign",c:CAT.DECORATIVE,v:VER.BETA},
    "minecraft:oak_wall_sign":{b:"wall_sign",c:CAT.DECORATIVE,v:VER.BETA},
    "minecraft:spruce_sign":{b:"spruce_standing_sign",c:CAT.DECORATIVE,v:VER.V1_14},
    "minecraft:spruce_wall_sign":{b:"spruce_wall_sign",c:CAT.DECORATIVE,v:VER.V1_14},
    "minecraft:birch_sign":{b:"birch_standing_sign",c:CAT.DECORATIVE,v:VER.V1_14},
    "minecraft:birch_wall_sign":{b:"birch_wall_sign",c:CAT.DECORATIVE,v:VER.V1_14},
    "minecraft:jungle_sign":{b:"jungle_standing_sign",c:CAT.DECORATIVE,v:VER.V1_14},
    "minecraft:jungle_wall_sign":{b:"jungle_wall_sign",c:CAT.DECORATIVE,v:VER.V1_14},
    "minecraft:acacia_sign":{b:"acacia_standing_sign",c:CAT.DECORATIVE,v:VER.V1_14},
    "minecraft:acacia_wall_sign":{b:"acacia_wall_sign",c:CAT.DECORATIVE,v:VER.V1_14},
    "minecraft:dark_oak_sign":{b:"darkoak_standing_sign",c:CAT.DECORATIVE,v:VER.V1_14},
    "minecraft:dark_oak_wall_sign":{b:"darkoak_wall_sign",c:CAT.DECORATIVE,v:VER.V1_14},
    "minecraft:crimson_sign":{b:"crimson_standing_sign",c:CAT.DECORATIVE,v:VER.V1_16},
    "minecraft:crimson_wall_sign":{b:"crimson_wall_sign",c:CAT.DECORATIVE,v:VER.V1_16},
    "minecraft:warped_sign":{b:"warped_standing_sign",c:CAT.DECORATIVE,v:VER.V1_16},
    "minecraft:warped_wall_sign":{b:"warped_wall_sign",c:CAT.DECORATIVE,v:VER.V1_16},
    "minecraft:mangrove_sign":{b:"mangrove_standing_sign",c:CAT.DECORATIVE,v:VER.V1_19},
    "minecraft:mangrove_wall_sign":{b:"mangrove_wall_sign",c:CAT.DECORATIVE,v:VER.V1_19},
    "minecraft:cherry_sign":{b:"cherry_standing_sign",c:CAT.DECORATIVE,v:VER.V1_20},
    "minecraft:cherry_wall_sign":{b:"cherry_wall_sign",c:CAT.DECORATIVE,v:VER.V1_20},
    "minecraft:bamboo_sign":{b:"bamboo_standing_sign",c:CAT.DECORATIVE,v:VER.V1_20},
    "minecraft:bamboo_wall_sign":{b:"bamboo_wall_sign",c:CAT.DECORATIVE,v:VER.V1_20},

    // === HANGING SIGNS ===
    "minecraft:oak_hanging_sign":{b:"oak_hanging_sign",c:CAT.DECORATIVE,v:VER.V1_20},
    "minecraft:spruce_hanging_sign":{b:"spruce_hanging_sign",c:CAT.DECORATIVE,v:VER.V1_20},
    "minecraft:birch_hanging_sign":{b:"birch_hanging_sign",c:CAT.DECORATIVE,v:VER.V1_20},
    "minecraft:jungle_hanging_sign":{b:"jungle_hanging_sign",c:CAT.DECORATIVE,v:VER.V1_20},
    "minecraft:acacia_hanging_sign":{b:"acacia_hanging_sign",c:CAT.DECORATIVE,v:VER.V1_20},
    "minecraft:dark_oak_hanging_sign":{b:"dark_oak_hanging_sign",c:CAT.DECORATIVE,v:VER.V1_20},
    "minecraft:crimson_hanging_sign":{b:"crimson_hanging_sign",c:CAT.DECORATIVE,v:VER.V1_20},
    "minecraft:warped_hanging_sign":{b:"warped_hanging_sign",c:CAT.DECORATIVE,v:VER.V1_20},
    "minecraft:mangrove_hanging_sign":{b:"mangrove_hanging_sign",c:CAT.DECORATIVE,v:VER.V1_20},
    "minecraft:cherry_hanging_sign":{b:"cherry_hanging_sign",c:CAT.DECORATIVE,v:VER.V1_20},
    "minecraft:bamboo_hanging_sign":{b:"bamboo_hanging_sign",c:CAT.DECORATIVE,v:VER.V1_20},

    // === BANNERS ===
    "minecraft:white_banner":{b:"standing_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:orange_banner":{b:"standing_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:magenta_banner":{b:"standing_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:light_blue_banner":{b:"standing_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:yellow_banner":{b:"standing_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:lime_banner":{b:"standing_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:pink_banner":{b:"standing_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:gray_banner":{b:"standing_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:light_gray_banner":{b:"standing_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:cyan_banner":{b:"standing_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:purple_banner":{b:"standing_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:blue_banner":{b:"standing_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:brown_banner":{b:"standing_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:green_banner":{b:"standing_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:red_banner":{b:"standing_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:black_banner":{b:"standing_banner",c:CAT.DECORATIVE,v:VER.BE},

    // === WALL BANNERS ===
    "minecraft:white_wall_banner":{b:"wall_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:orange_wall_banner":{b:"wall_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:magenta_wall_banner":{b:"wall_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:light_blue_wall_banner":{b:"wall_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:yellow_wall_banner":{b:"wall_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:lime_wall_banner":{b:"wall_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:pink_wall_banner":{b:"wall_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:gray_wall_banner":{b:"wall_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:light_gray_wall_banner":{b:"wall_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:cyan_wall_banner":{b:"wall_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:purple_wall_banner":{b:"wall_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:blue_wall_banner":{b:"wall_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:brown_wall_banner":{b:"wall_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:green_wall_banner":{b:"wall_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:red_wall_banner":{b:"wall_banner",c:CAT.DECORATIVE,v:VER.BE},
    "minecraft:black_wall_banner":{b:"wall_banner",c:CAT.DECORATIVE,v:VER.BE},

    // === FUNCTIONAL BLOCKS ===
    "minecraft:furnace":{b:"furnace",c:CAT.FUNCTIONAL,v:VER.CLASSIC,f:5},
    "minecraft:smoker":{b:"smoker",c:CAT.FUNCTIONAL,v:VER.V1_14,f:5},
    "minecraft:blast_furnace":{b:"blast_furnace",c:CAT.FUNCTIONAL,v:VER.V1_14,f:5},
    "minecraft:brick_block":{b:"brick_block",c:CAT.BUILDING,v:VER.CLASSIC},
    "minecraft:chest":{b:"chest",c:CAT.FUNCTIONAL,v:VER.CLASSIC,f:5},
    "minecraft:trapped_chest":{b:"trapped_chest",c:CAT.REDSTONE,v:VER.V1_5,f:5},
    "minecraft:ender_chest":{b:"ender_chest",c:CAT.FUNCTIONAL,v:VER.V1_3,f:5},
    "minecraft:crafting_table":{b:"crafting_table",c:CAT.FUNCTIONAL,v:VER.CLASSIC},
    "minecraft:enchanting_table":{b:"enchanting_table",c:CAT.FUNCTIONAL,v:VER.V1_0},
    "minecraft:anvil":{b:"anvil",c:CAT.FUNCTIONAL,v:VER.V1_4,f:1},
    "minecraft:chipped_anvil":{b:"anvil",c:CAT.FUNCTIONAL,v:VER.V1_4},
    "minecraft:damaged_anvil":{b:"anvil",c:CAT.FUNCTIONAL,v:VER.V1_4},
    "minecraft:brewing_stand":{b:"brewing_stand",c:CAT.FUNCTIONAL,v:VER.V1_0},
    "minecraft:cauldron":{b:"cauldron",c:CAT.FUNCTIONAL,v:VER.V1_0},
    "minecraft:water_cauldron":{b:"cauldron",c:CAT.FUNCTIONAL,v:VER.V1_17},
    "minecraft:lava_cauldron":{b:"lava_cauldron",c:CAT.FUNCTIONAL,v:VER.V1_17},
    "minecraft:powder_snow_cauldron":{b:"powder_snow_cauldron",c:CAT.FUNCTIONAL,v:VER.V1_17},
    "minecraft:beacon":{b:"beacon",c:CAT.FUNCTIONAL,v:VER.V1_4},
    "minecraft:jukebox":{b:"jukebox",c:CAT.FUNCTIONAL,v:VER.BETA},
    "minecraft:spawner":{b:"mob_spawner",c:CAT.FUNCTIONAL,v:VER.CLASSIC},
    "minecraft:trial_spawner":{b:"trial_spawner",c:CAT.FUNCTIONAL,v:VER.V1_21},
    "minecraft:vault":{b:"vault",c:CAT.FUNCTIONAL,v:VER.V1_21},
    "minecraft:tnt":{b:"tnt",c:CAT.FUNCTIONAL,v:VER.CLASSIC},
    "minecraft:slime_block":{b:"slime",c:CAT.FUNCTIONAL,v:VER.BE},
    "minecraft:honey_block":{b:"honey_block",c:CAT.FUNCTIONAL,v:VER.V1_15},
    "minecraft:lodestone":{b:"lodestone",c:CAT.FUNCTIONAL,v:VER.V1_16},
    "minecraft:respawn_anchor":{b:"respawn_anchor",c:CAT.FUNCTIONAL,v:VER.V1_16},
    "minecraft:conduit":{b:"conduit",c:CAT.FUNCTIONAL,v:VER.V1_13},
    "minecraft:bookshelf":{b:"bookshelf",c:CAT.FUNCTIONAL,v:VER.CLASSIC},
    "minecraft:chiseled_bookshelf":{b:"chiseled_bookshelf",c:CAT.FUNCTIONAL,v:VER.V1_20},

    // === SHULKER BOXES ===
    "minecraft:white_shulker_box":{b:"shulker_box",c:CAT.FUNCTIONAL,v:VER.V1_11,f:13},
    "minecraft:orange_shulker_box":{b:"shulker_box",c:CAT.FUNCTIONAL,v:VER.V1_11},
    "minecraft:magenta_shulker_box":{b:"shulker_box",c:CAT.FUNCTIONAL,v:VER.V1_11},
    "minecraft:light_blue_shulker_box":{b:"shulker_box",c:CAT.FUNCTIONAL,v:VER.V1_11},
    "minecraft:yellow_shulker_box":{b:"shulker_box",c:CAT.FUNCTIONAL,v:VER.V1_11},
    "minecraft:lime_shulker_box":{b:"shulker_box",c:CAT.FUNCTIONAL,v:VER.V1_11},
    "minecraft:pink_shulker_box":{b:"shulker_box",c:CAT.FUNCTIONAL,v:VER.V1_11},
    "minecraft:gray_shulker_box":{b:"shulker_box",c:CAT.FUNCTIONAL,v:VER.V1_11},
    "minecraft:light_gray_shulker_box":{b:"shulker_box",c:CAT.FUNCTIONAL,v:VER.V1_11},
    "minecraft:cyan_shulker_box":{b:"shulker_box",c:CAT.FUNCTIONAL,v:VER.V1_11},
    "minecraft:purple_shulker_box":{b:"shulker_box",c:CAT.FUNCTIONAL,v:VER.V1_11},
    "minecraft:blue_shulker_box":{b:"shulker_box",c:CAT.FUNCTIONAL,v:VER.V1_11},
    "minecraft:brown_shulker_box":{b:"shulker_box",c:CAT.FUNCTIONAL,v:VER.V1_11},
    "minecraft:green_shulker_box":{b:"shulker_box",c:CAT.FUNCTIONAL,v:VER.V1_11},
    "minecraft:red_shulker_box":{b:"shulker_box",c:CAT.FUNCTIONAL,v:VER.V1_11},
    "minecraft:black_shulker_box":{b:"shulker_box",c:CAT.FUNCTIONAL,v:VER.V1_11},

    // === DECORATIVE ===
    "minecraft:torch":{b:"torch",c:CAT.DECORATIVE,v:VER.CLASSIC},
    "minecraft:soul_torch":{b:"soul_torch",c:CAT.DECORATIVE,v:VER.V1_16},
    "minecraft:wall_torch":{b:"torch",c:CAT.DECORATIVE,v:VER.CLASSIC},
    "minecraft:soul_wall_torch":{b:"soul_torch",c:CAT.DECORATIVE,v:VER.V1_16},
    "minecraft:lantern":{b:"lantern",c:CAT.DECORATIVE,v:VER.V1_14},
    "minecraft:soul_lantern":{b:"soul_lantern",c:CAT.DECORATIVE,v:VER.V1_16},
    "minecraft:end_rod":{b:"end_rod",c:CAT.DECORATIVE,v:VER.V1_9,f:1},
    "minecraft:campfire":{b:"campfire",c:CAT.FUNCTIONAL,v:VER.V1_14,f:1},
    "minecraft:soul_campfire":{b:"soul_campfire",c:CAT.FUNCTIONAL,v:VER.V1_16},
    "minecraft:candle":{b:"candle",c:CAT.DECORATIVE,v:VER.V1_17},
    "minecraft:white_candle":{b:"white_candle",c:CAT.DECORATIVE,v:VER.V1_17},
    "minecraft:orange_candle":{b:"orange_candle",c:CAT.DECORATIVE,v:VER.V1_17},
    "minecraft:magenta_candle":{b:"magenta_candle",c:CAT.DECORATIVE,v:VER.V1_17},
    "minecraft:light_blue_candle":{b:"light_blue_candle",c:CAT.DECORATIVE,v:VER.V1_17},
    "minecraft:yellow_candle":{b:"yellow_candle",c:CAT.DECORATIVE,v:VER.V1_17},
    "minecraft:lime_candle":{b:"lime_candle",c:CAT.DECORATIVE,v:VER.V1_17},
    "minecraft:pink_candle":{b:"pink_candle",c:CAT.DECORATIVE,v:VER.V1_17},
    "minecraft:gray_candle":{b:"gray_candle",c:CAT.DECORATIVE,v:VER.V1_17},
    "minecraft:light_gray_candle":{b:"light_gray_candle",c:CAT.DECORATIVE,v:VER.V1_17},
    "minecraft:cyan_candle":{b:"cyan_candle",c:CAT.DECORATIVE,v:VER.V1_17},
    "minecraft:purple_candle":{b:"purple_candle",c:CAT.DECORATIVE,v:VER.V1_17},
    "minecraft:blue_candle":{b:"blue_candle",c:CAT.DECORATIVE,v:VER.V1_17},
    "minecraft:brown_candle":{b:"brown_candle",c:CAT.DECORATIVE,v:VER.V1_17},
    "minecraft:green_candle":{b:"green_candle",c:CAT.DECORATIVE,v:VER.V1_17},
    "minecraft:red_candle":{b:"red_candle",c:CAT.DECORATIVE,v:VER.V1_17},
    "minecraft:black_candle":{b:"black_candle",c:CAT.DECORATIVE,v:VER.V1_17},

    // === FLOWER POTS ===
    "minecraft:flower_pot":{b:"flower_pot",c:CAT.DECORATIVE,v:VER.V1_4,f:4},

    // === WORKSTATIONS ===
    "minecraft:loom":{b:"loom",c:CAT.FUNCTIONAL,v:VER.V1_14,f:1},
    "minecraft:barrel":{b:"barrel",c:CAT.FUNCTIONAL,v:VER.V1_14,f:5},
    "minecraft:cartography_table":{b:"cartography_table",c:CAT.FUNCTIONAL,v:VER.V1_14},
    "minecraft:fletching_table":{b:"fletching_table",c:CAT.FUNCTIONAL,v:VER.V1_14},
    "minecraft:grindstone":{b:"grindstone",c:CAT.FUNCTIONAL,v:VER.V1_14,f:1},
    "minecraft:lectern":{b:"lectern",c:CAT.FUNCTIONAL,v:VER.V1_14,f:1},
    "minecraft:smithing_table":{b:"smithing_table",c:CAT.FUNCTIONAL,v:VER.V1_14},
    "minecraft:stonecutter":{b:"stonecutter_block",c:CAT.FUNCTIONAL,v:VER.V1_14,f:1},
    "minecraft:composter":{b:"composter",c:CAT.FUNCTIONAL,v:VER.V1_14},

    // === BELL ===
    "minecraft:bell":{b:"bell",c:CAT.FUNCTIONAL,v:VER.V1_14,f:1},

    // === BEDS ===
    "minecraft:white_bed":{b:"bed",c:CAT.FUNCTIONAL,v:VER.BETA,f:1},
    "minecraft:orange_bed":{b:"bed",c:CAT.FUNCTIONAL,v:VER.V1_12},
    "minecraft:magenta_bed":{b:"bed",c:CAT.FUNCTIONAL,v:VER.V1_12},
    "minecraft:light_blue_bed":{b:"bed",c:CAT.FUNCTIONAL,v:VER.V1_12},
    "minecraft:yellow_bed":{b:"bed",c:CAT.FUNCTIONAL,v:VER.V1_12},
    "minecraft:lime_bed":{b:"bed",c:CAT.FUNCTIONAL,v:VER.V1_12},
    "minecraft:pink_bed":{b:"bed",c:CAT.FUNCTIONAL,v:VER.V1_12},
    "minecraft:gray_bed":{b:"bed",c:CAT.FUNCTIONAL,v:VER.V1_12},
    "minecraft:light_gray_bed":{b:"bed",c:CAT.FUNCTIONAL,v:VER.V1_12},
    "minecraft:cyan_bed":{b:"bed",c:CAT.FUNCTIONAL,v:VER.V1_12},
    "minecraft:purple_bed":{b:"bed",c:CAT.FUNCTIONAL,v:VER.V1_12},
    "minecraft:blue_bed":{b:"bed",c:CAT.FUNCTIONAL,v:VER.V1_12},
    "minecraft:brown_bed":{b:"bed",c:CAT.FUNCTIONAL,v:VER.V1_12},
    "minecraft:green_bed":{b:"bed",c:CAT.FUNCTIONAL,v:VER.V1_12},
    "minecraft:red_bed":{b:"bed",c:CAT.FUNCTIONAL,v:VER.V1_12},
    "minecraft:black_bed":{b:"bed",c:CAT.FUNCTIONAL,v:VER.V1_12},

    // === COBWEB ===
    "minecraft:cobweb":{b:"web",c:CAT.DECORATIVE,v:VER.BETA},

    // === LADDER ===
    "minecraft:ladder":{b:"ladder",c:CAT.FUNCTIONAL,v:VER.CLASSIC,f:1},

    // === IRON BARS ===
    "minecraft:iron_bars":{b:"iron_bars",c:CAT.BUILDING,v:VER.BETA},

    // === INFESTED ===
    "minecraft:infested_stone":{b:"monster_egg",c:CAT.NATURAL,v:VER.BETA},
    "minecraft:infested_cobblestone":{b:"monster_egg",c:CAT.NATURAL,v:VER.BETA},
    "minecraft:infested_stone_bricks":{b:"monster_egg",c:CAT.NATURAL,v:VER.BETA},
    "minecraft:infested_mossy_stone_bricks":{b:"monster_egg",c:CAT.NATURAL,v:VER.BETA},
    "minecraft:infested_cracked_stone_bricks":{b:"monster_egg",c:CAT.NATURAL,v:VER.BETA},
    "minecraft:infested_chiseled_stone_bricks":{b:"monster_egg",c:CAT.NATURAL,v:VER.BETA},

    // === HAY BALE ===
    "minecraft:hay_block":{b:"hay_block",c:CAT.BUILDING,v:VER.V1_6,s:{axis:"pillar_axis"}},

    // === SPONGE ===
    "minecraft:sponge":{b:"sponge",c:CAT.NATURAL,v:VER.CLASSIC,s:{sponge_type:"sponge_type"}},
    "minecraft:wet_sponge":{b:"sponge",c:CAT.NATURAL,v:VER.BE},

    // === CAKE ===
    "minecraft:cake":{b:"cake",c:CAT.FUNCTIONAL,v:VER.BETA},
    "minecraft:candle_cake":{b:"cake",c:CAT.FUNCTIONAL,v:VER.V1_17},

    // === COMPOSTER ===
    // === BEE ===
    "minecraft:bee_nest":{b:"bee_nest",c:CAT.FUNCTIONAL,v:VER.V1_15,f:1},
    "minecraft:beehive":{b:"beehive",c:CAT.FUNCTIONAL,v:VER.V1_15,f:1},
    "minecraft:honeycomb_block":{b:"honeycomb_block",c:CAT.DECORATIVE,v:VER.V1_15},

    // === END ===
    "minecraft:end_portal":{b:"end_portal",c:CAT.FUNCTIONAL,v:VER.V1_0},
    "minecraft:end_portal_frame":{b:"end_portal_frame",c:CAT.FUNCTIONAL,v:VER.V1_0,f:1},
    "minecraft:end_gateway":{b:"end_gateway",c:CAT.FUNCTIONAL,v:VER.V1_9},
    "minecraft:dragon_egg":{b:"dragon_egg",c:CAT.DECORATIVE,v:VER.V1_0},

    // === PORTAL ===
    "minecraft:nether_portal":{b:"portal",c:CAT.FUNCTIONAL,v:VER.BETA},

    // === COMMAND BLOCKS ===
    "minecraft:command_block":{b:"command_block",c:CAT.FUNCTIONAL,v:VER.V1_4,f:5},
    "minecraft:chain_command_block":{b:"chain_command_block",c:CAT.FUNCTIONAL,v:VER.V1_9},
    "minecraft:repeating_command_block":{b:"repeating_command_block",c:CAT.FUNCTIONAL,v:VER.V1_9},

    // === CHORUS ===
    "minecraft:chorus_plant":{b:"chorus_plant",c:CAT.PLANT,v:VER.V1_9},
    "minecraft:chorus_flower":{b:"chorus_flower",c:CAT.PLANT,v:VER.V1_9},

    // === CORAL ===
    "minecraft:tube_coral_block":{b:"coral_block",c:CAT.BUILDING,v:VER.V1_13},
    "minecraft:brain_coral_block":{b:"coral_block",c:CAT.BUILDING,v:VER.V1_13},
    "minecraft:bubble_coral_block":{b:"coral_block",c:CAT.BUILDING,v:VER.V1_13},
    "minecraft:fire_coral_block":{b:"coral_block",c:CAT.BUILDING,v:VER.V1_13},
    "minecraft:horn_coral_block":{b:"coral_block",c:CAT.BUILDING,v:VER.V1_13},
    "minecraft:dead_tube_coral_block":{b:"coral_block",c:CAT.BUILDING,v:VER.V1_13},
    "minecraft:dead_brain_coral_block":{b:"coral_block",c:CAT.BUILDING,v:VER.V1_13},
    "minecraft:dead_bubble_coral_block":{b:"coral_block",c:CAT.BUILDING,v:VER.V1_13},
    "minecraft:dead_fire_coral_block":{b:"coral_block",c:CAT.BUILDING,v:VER.V1_13},
    "minecraft:dead_horn_coral_block":{b:"coral_block",c:CAT.BUILDING,v:VER.V1_13},
    "minecraft:tube_coral":{b:"coral",c:CAT.PLANT,v:VER.V1_13},
    "minecraft:brain_coral":{b:"coral",c:CAT.PLANT,v:VER.V1_13},
    "minecraft:bubble_coral":{b:"coral",c:CAT.PLANT,v:VER.V1_13},
    "minecraft:fire_coral":{b:"coral",c:CAT.PLANT,v:VER.V1_13},
    "minecraft:horn_coral":{b:"coral",c:CAT.PLANT,v:VER.V1_13},
    "minecraft:dead_tube_coral":{b:"coral",c:CAT.PLANT,v:VER.V1_13},
    "minecraft:dead_brain_coral":{b:"coral",c:CAT.PLANT,v:VER.V1_13},
    "minecraft:dead_bubble_coral":{b:"coral",c:CAT.PLANT,v:VER.V1_13},
    "minecraft:dead_fire_coral":{b:"coral",c:CAT.PLANT,v:VER.V1_13},
    "minecraft:dead_horn_coral":{b:"coral",c:CAT.PLANT,v:VER.V1_13},
    "minecraft:tube_coral_fan":{b:"coral_fan",c:CAT.PLANT,v:VER.V1_13},
    "minecraft:brain_coral_fan":{b:"coral_fan",c:CAT.PLANT,v:VER.V1_13},
    "minecraft:bubble_coral_fan":{b:"coral_fan",c:CAT.PLANT,v:VER.V1_13},
    "minecraft:fire_coral_fan":{b:"coral_fan",c:CAT.PLANT,v:VER.V1_13},
    "minecraft:horn_coral_fan":{b:"coral_fan",c:CAT.PLANT,v:VER.V1_13},
    "minecraft:dead_tube_coral_fan":{b:"coral_fan",c:CAT.PLANT,v:VER.V1_13},
    "minecraft:dead_brain_coral_fan":{b:"coral_fan",c:CAT.PLANT,v:VER.V1_13},
    "minecraft:dead_bubble_coral_fan":{b:"coral_fan",c:CAT.PLANT,v:VER.V1_13},
    "minecraft:dead_fire_coral_fan":{b:"coral_fan",c:CAT.PLANT,v:VER.V1_13},
    "minecraft:dead_horn_coral_fan":{b:"coral_fan",c:CAT.PLANT,v:VER.V1_13},

    // === FIRE ===
    "minecraft:fire":{b:"fire",c:CAT.DECORATIVE,v:VER.CLASSIC},
    "minecraft:soul_fire":{b:"soul_fire",c:CAT.DECORATIVE,v:VER.V1_16},

    // === LILY PAD ===
    "minecraft:lily_pad":{b:"waterlily",c:CAT.PLANT,v:VER.BETA},

    // === SCULK ===
    "minecraft:sculk":{b:"sculk",c:CAT.NATURAL,v:VER.V1_19},
    "minecraft:sculk_catalyst":{b:"sculk_catalyst",c:CAT.FUNCTIONAL,v:VER.V1_19},
    "minecraft:sculk_shrieker":{b:"sculk_shrieker",c:CAT.FUNCTIONAL,v:VER.V1_19},
    "minecraft:sculk_vein":{b:"sculk_vein",c:CAT.DECORATIVE,v:VER.V1_19},

    // === AZALEA ===
    "minecraft:azalea":{b:"azalea",c:CAT.PLANT,v:VER.V1_17},
    "minecraft:flowering_azalea":{b:"flowering_azalea",c:CAT.PLANT,v:VER.V1_17},

    // === MOSS ===
    "minecraft:moss_block":{b:"moss_block",c:CAT.NATURAL,v:VER.V1_17},
    "minecraft:moss_carpet":{b:"moss_carpet",c:CAT.DECORATIVE,v:VER.V1_17},

    // === ROOTS ===
    "minecraft:mangrove_roots":{b:"mangrove_roots",c:CAT.NATURAL,v:VER.V1_19},

    // === BIG DRIPLEAF ===
    "minecraft:big_dripleaf":{b:"big_dripleaf",c:CAT.PLANT,v:VER.V1_17},
    "minecraft:small_dripleaf":{b:"small_dripleaf",c:CAT.PLANT,v:VER.V1_17},

    // === SEA PICKLE & TURTLE EGG ===
    "minecraft:sea_pickle":{b:"sea_pickle",c:CAT.PLANT,v:VER.V1_13},
    "minecraft:turtle_egg":{b:"turtle_egg",c:CAT.FUNCTIONAL,v:VER.V1_13},

    // === DRIED KELP ===
    "minecraft:dried_kelp_block":{b:"dried_kelp_block",c:CAT.BUILDING,v:VER.V1_13},

    // === FROGLIGHT ===
    "minecraft:ochre_froglight":{b:"ochre_froglight",c:CAT.DECORATIVE,v:VER.V1_19},
    "minecraft:verdant_froglight":{b:"verdant_froglight",c:CAT.DECORATIVE,v:VER.V1_19},
    "minecraft:pearlescent_froglight":{b:"pearlescent_froglight",c:CAT.DECORATIVE,v:VER.V1_19},

    // === DECORATED POT ===
    "minecraft:decorated_pot":{b:"decorated_pot",c:CAT.DECORATIVE,v:VER.V1_20,f:1},

    // === BRUSHABLE ===
    // === SNIFFER EGG ===
    "minecraft:sniffer_egg":{b:"sniffer_egg",c:CAT.FUNCTIONAL,v:VER.V1_20},

    // === JIGSAW & STRUCTURE ===
    "minecraft:jigsaw":{b:"jigsaw",c:CAT.FUNCTIONAL,v:VER.V1_16},
    "minecraft:structure_block":{b:"structure_block",c:CAT.FUNCTIONAL,v:VER.V1_10},
    "minecraft:lightning_rod":{b:"lightning_rod",c:CAT.FUNCTIONAL,v:VER.V1_17,f:1},
    "minecraft:light":{b:"light_block",c:CAT.FUNCTIONAL,v:VER.V1_17},

    // === FLUIDS ===
    "minecraft:water":{b:"water",c:CAT.FLUID,v:VER.CLASSIC},
    "minecraft:lava":{b:"lava",c:CAT.FLUID,v:VER.CLASSIC},
    "minecraft:bubble_column":{b:"bubble_column",c:CAT.FLUID,v:VER.V1_13},
};

// Build reverse index: bedrock name -> java name[]
const bedrockToJava = {};
const ALL_JAVA = Object.keys(javaToBedrock);
const UNIQUE_BE = new Set();
for (const j of ALL_JAVA) {
    const m = javaToBedrock[j];
    const be = m.b;
    if (!bedrockToJava[be]) bedrockToJava[be] = [];
    bedrockToJava[be].push(j);
    UNIQUE_BE.add(be);
}

class BlockMappingRegistry {
    constructor() {
        this.javaToBedrock = javaToBedrock;
        this.bedrockToJava = bedrockToJava;
    }

    /** Lookup BE name for a Java block */
    getBedrockName(javaName) {
        const m = javaToBedrock[javaName];
        return m ? m.b : null;
    }

    /** Lookup full mapping entry for a Java block */
    getMapping(javaName) {
        return javaToBedrock[javaName] || null;
    }

    /** Lookup Java names for a BE block */
    getJavaNames(beName) {
        return bedrockToJava[beName] || [];
    }

    /** Check if a Java name is known */
    hasJava(javaName) {
        return javaName in javaToBedrock;
    }

    /** Check if a BE name is known */
    hasBedrock(beName) {
        return beName in bedrockToJava;
    }

    /** Get block category */
    getCategory(javaName) {
        const m = javaToBedrock[javaName];
        return m ? m.c : CAT.UNKNOWN;
    }

    /** Get version info */
    getVersion(javaName) {
        const m = javaToBedrock[javaName];
        return m ? m.v : null;
    }

    /** Get all known Java block IDs */
    getAllJavaNames() {
        return ALL_JAVA;
    }

    /** Get all known BE block IDs */
    getAllBedrockNames() {
        return [...UNIQUE_BE];
    }

    /** Get stats */
    getStats() {
        const byCategory = {};
        const byVersion = {};
        for (const j of ALL_JAVA) {
            const entry = javaToBedrock[j] || {};
            const cat = entry.c || CAT.UNKNOWN;
            byCategory[cat] = (byCategory[cat] || 0) + 1;
            const ver = entry.v;
            if (ver) byVersion[ver] = (byVersion[ver] || 0) + 1;
        }
        return {
            javaEntries: ALL_JAVA.length,
            uniqueBedrock: UNIQUE_BE.size,
            byCategory,
            byVersion
        };
    }

    /** State mapping: s = null means identical, s = {javaKey: beKey} for renames */
    getStateMapping(javaName) {
        const m = javaToBedrock[javaName];
        return m ? m.s || null : null;
    }

    /** Get flags bitmask */
    getFlags(javaName) {
        const m = javaToBedrock[javaName];
        return m ? (m.f || 0) : 0;
    }

    /** Check if block is directional */
    isDirectional(javaName) {
        return (this.getFlags(javaName) & 1) !== 0;
    }

    /** Check if block needs tile entity NBT */
    needsTileEntity(javaName) {
        return (this.getFlags(javaName) & 4) !== 0;
    }

    /** Check if block has color variants (needs auxiliary value) */
    needsColor(javaName) {
        return (this.getFlags(javaName) & 8) !== 0;
    }

    /** Check if block has wood type variants */
    needsWoodType(javaName) {
        return (this.getFlags(javaName) & 16) !== 0;
    }
}

module.exports = { BlockMappingRegistry, BlockCategories: CAT, BlockVersions: VER, javaToBedrock, bedrockToJava };
