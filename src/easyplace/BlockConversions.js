const BlockConversions = {
    bannedBlocks: [
        'minecraft:air',
        'minecraft:bed',
        'minecraft:piston_arm_collision',
        'minecraft:sticky_piston_arm_collision',
        'minecraft:skeleton_skull',
        'minecraft:wither_skeleton_skull',
        'minecraft:zombie_head',
        'minecraft:player_head',
        'minecraft:creeper_head',
        'minecraft:dragon_head',
        'minecraft:piglin_head',
        'minecraft:standing_banner',
        'minecraft:wall_banner',
        'minecraft:wooden_door',
        'minecraft:spruce_door',
        'minecraft:birch_door',
        'minecraft:jungle_door',
        'minecraft:acacia_door',
        'minecraft:dark_oak_door',
        'minecraft:mangrove_door',
        'minecraft:cherry_door',
        'minecraft:bamboo_door',
        'minecraft:iron_door',
        'minecraft:crimson_door',
        'minecraft:warped_door',
        'minecraft:copper_door',
        'minecraft:exposed_copper_door',
        'minecraft:weathered_copper_door',
        'minecraft:oxidized_copper_door',
        'minecraft:waxed_copper_door',
        'minecraft:waxed_exposed_copper_door',
        'minecraft:waxed_weathered_copper_door',
        'minecraft:waxed_oxidized_copper_door',
        'minecraft:seagrass',
        'minecraft:kelp',
        'minecraft:dried_ghast',
        'minecraft:shulker_box',
        'minecraft:undyed_shulker_box',
        'minecraft:white_shulker_box',
        'minecraft:orange_shulker_box',
        'minecraft:magenta_shulker_box',
        'minecraft:light_blue_shulker_box',
        'minecraft:yellow_shulker_box',
        'minecraft:lime_shulker_box',
        'minecraft:pink_shulker_box',
        'minecraft:gray_shulker_box',
        'minecraft:light_gray_shulker_box',
        'minecraft:cyan_shulker_box',
        'minecraft:purple_shulker_box',
        'minecraft:blue_shulker_box',
        'minecraft:brown_shulker_box',
        'minecraft:green_shulker_box',
        'minecraft:red_shulker_box',
        'minecraft:black_shulker_box'
    ],

    bannedDimensionBlocks: {
        0: [],
        1: ['minecraft:water'],
        2: []
    },

    whitelistedBlockStates: {
        'minecraft:water': { liquid_depth: 0 },
        'minecraft:lava': { liquid_depth: 0 }
    },

    bannedToValidMap: {
        'minecraft:lit_furnace': 'minecraft:furnace',
        'minecraft:lit_smoker': 'minecraft:smoker',
        'minecraft:lit_blast_furnace': 'minecraft:blast_furnace',
        'minecraft:lit_redstone_ore': 'minecraft:redstone_ore',
        'minecraft:lit_deepslate_redstone_ore': 'minecraft:deepslate_redstone_ore',
        'minecraft:lit_redstone_lamp': 'minecraft:redstone_lamp',
        'minecraft:unlit_redstone_torch': 'minecraft:redstone_torch',
        'minecraft:powered_comparator': 'minecraft:unpowered_comparator',
        'minecraft:powered_repeater': 'minecraft:unpowered_repeater'
    },

    resetStates: {
        'growth': 0,
        'age': 0,
        'height': 0,
        'bite_counter': 0,
        'fill_level': 0,
        'redstone_signal': 0,
        'cluster_count': 0,
        'respawn_anchor_charge': 0,
        'turtle_egg_count': 0,
        'composter_fill_level': 0,
        'end_portal_eye_bit': false,
        'cracked_state': 'no_cracks',
        'hatch': 0,
        'eggs': 1,
        'flower_amount': 0
    },

    blockToItemMap: {
        'minecraft:water': 'minecraft:water_bucket',
        'minecraft:lava': 'minecraft:lava_bucket',
        'minecraft:fire': 'minecraft:fire_charge',
        'minecraft:soul_fire': 'minecraft:fire_charge'
    },

    specialItemConversions: {
        'minecraft:water_bucket': 'minecraft:bucket',
        'minecraft:lava_bucket': 'minecraft:bucket',
        'minecraft:powder_snow_bucket': 'minecraft:bucket'
    },

    isBanned(blockName, dimensionId = 0) {
        const normalized = this.normalize(blockName);
        if (this.bannedBlocks.includes(normalized)) {
            return true;
        }
        const dimBlocks = this.bannedDimensionBlocks[dimensionId] || [];
        return dimBlocks.includes(normalized);
    },

    convertToValid(blockName, blockStates = {}) {
        const normalized = this.normalize(blockName);
        if (this.bannedToValidMap[normalized]) {
            return {
                name: this.bannedToValidMap[normalized],
                states: blockStates
            };
        }
        return { name: blockName, states: blockStates };
    },

    resetToDefaultStates(blockStates) {
        const newStates = { ...blockStates };
        for (const [key, defaultValue] of Object.entries(this.resetStates)) {
            if (newStates[key] !== undefined && newStates[key] !== defaultValue) {
                newStates[key] = defaultValue;
            }
        }
        return newStates;
    },

    getPlaceableItem(blockName) {
        const normalized = this.normalize(blockName);
        return this.blockToItemMap[normalized] || null;
    },

    getSpecialConversion(itemName) {
        const normalized = this.normalize(itemName);
        return this.specialItemConversions[normalized] || null;
    },

    normalize(name) {
        if (!name) return '';
        let n = name.toLowerCase().trim();
        if (!n.includes(':')) n = `minecraft:${n}`;
        return n;
    },

    isWhitelistedState(blockName, states) {
        const normalized = this.normalize(blockName);
        const allowedStates = this.whitelistedBlockStates[normalized];
        if (!allowedStates) return true;
        
        for (const [key, expectedValue] of Object.entries(allowedStates)) {
            if (states[key] !== expectedValue) {
                return false;
            }
        }
        return true;
    }
};

module.exports = { BlockConversions };
