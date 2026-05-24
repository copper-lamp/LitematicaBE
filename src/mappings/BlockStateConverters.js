/**
 * BlockStateConverters.js
 * Bidirectional state conversion between Java Edition and Bedrock Edition
 * Covers: directional, rails, stairs, doors, trapdoors, beds, redstone, buttons, levers, etc.
 */
const { BlockMappingRegistry } = require('./BlockMappingRegistry');

const registry = new BlockMappingRegistry();

// === FACING MAPS ===
const JAVA_FACING = ['down', 'up', 'north', 'south', 'west', 'east'];
// Most BE blocks: 0=down, 1=up, 2=north, 3=south, 4=west, 5=east
const BE_FACING_MAP = { down: 0, up: 1, north: 2, south: 3, west: 4, east: 5 };
const BE_FACING_REVERSE = { 0: 'down', 1: 'up', 2: 'north', 3: 'south', 4: 'west', 5: 'east' };
// Buttons use different order: 0=down, 1=up, 2=south, 3=north, 4=east, 5=west
const BE_FACING_BUTTON = { down: 0, up: 1, south: 2, north: 3, east: 4, west: 5 };

// DIRECTION (pumpkin, etc.)
const BE_DIRECTION_MAP = { south: 0, north: 1, east: 2, west: 3 };
const BE_DIRECTION_REVERSE = { 0: 'south', 1: 'north', 2: 'east', 3: 'west' };

// CARDINAL (banners, signs, etc.)
const BE_CARDINAL_MAP = { south: 0, north: 1, east: 2, west: 3 };
const BE_CARDINAL_REVERSE = { 0: 'south', 1: 'north', 2: 'east', 3: 'west' };

// === RAIL SHAPE MAPS ===
const JAVA_RAIL_SHAPE = [
    'north_south', 'east_west',
    'ascending_east', 'ascending_west', 'ascending_north', 'ascending_south',
    'south_east', 'south_west', 'north_west', 'north_east'
];
const BE_RAIL_DIRECTION = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

// === STAIR DIRECTION MAP ===
const STAIR_JAVA_TO_BE_FACING = { east: 0, west: 1, south: 2, north: 3 };

// == TRAPDOOR OPEN BIT ===
const TRAPDOOR_OPEN_BIT = { top: 0, bottom: 8 };

// === DOOR DIRECTION MAP ===
const DOOR_JAVA_TO_BE_DIR = { east: 0, south: 1, west: 2, north: 3 };

// === TORCH FACING MAP ===
const TORCH_JAVA_TO_BE = { east: 'east', west: 'west', south: 'south', north: 'north', up: 'top' };

// === PISTON/STICKY_PISTON/HOPPER/DISPENSER/DROPPER: facing -> facing_direction (int) ===
// === for observer: facing -> minecraft:facing_direction (int) ===

// === REDSTONE WIRE POWER ===
// Java: power 0-15 -> BE: redstone_signal 0-15 (same, no state rename needed usually)

// === REPEATER DELAY ===
// Java: delay 1-4 -> BE: repeater_delay 0-3 (delay - 1)

// === COMPARATOR MODE ===
// Java: mode=compare/subtract -> BE: output_subtract_bit=0/1

// === LEVER FACING ===
const LEVER_JAVA_TO_BE = { north: 'south', south: 'north', east: 'west', west: 'east', up_x: 'up_north_south', up_z: 'up_east_west', down_x: 'down_north_south', down_z: 'down_east_west' };

// === BUTTON FACING ===
const BUTTON_JAVA_FACING_TO_BE = {
    north: 3, south: 2, east: 4, west: 1, up: 0, down: 5,
    ceiling: 0, floor: 5
};

// === BED DIRECTION ===
const BED_JAVA_TO_BE = { south: 3, north: 1, east: 0, west: 2 };

// === PILLAR_AXIS / AXIS MAP ===
const AXIS_MAP = { x: 'x', y: 'y', z: 'z' };

// === END ROD FACING ===
const END_ROD_JAVA_TO_BE = { down: 0, up: 1, south: 2, north: 3, east: 4, west: 5 };

// === ANVIL FACING ===
const ANVIL_JAVA_TO_BE_DIR = { south: 0, north: 1, east: 2, west: 3 };

// === BELL ATTACHMENT ===
const BELL_JAVA_TO_BE_DIR = { south: 0, north: 1, east: 2, west: 3 };

class BlockStateConverters {

    /**
     * Convert Java block states to Bedrock block states (forward)
     * @param {string} javaName - full Java block name
     * @param {object} javaStates - { stateKey: stateValue }
     * @returns {object} bedrock states
     */
    convertJavaToBedrock(javaName, javaStates) {
        if (!javaStates || Object.keys(javaStates).length === 0) return {};

        const mapping = registry.getMapping(javaName);
        const stateMap = mapping ? mapping.s : null;
        const flags = mapping ? mapping.f : 0;
        const cat = mapping ? mapping.c : null;
        const be = {};

        // 1. Apply name mappings from the registry (e.g., axis -> pillar_axis)
        if (stateMap) {
            for (const [jk, bk] of Object.entries(stateMap)) {
                if (jk in javaStates) {
                    be[bk] = javaStates[jk];
                }
            }
        } else {
            Object.assign(be, javaStates);
        }

        // 2. Apply directional converters if flagged
        if (flags & 1) {
            this._convertFacing(javaName, javaStates, be, cat);
        }

        // 3. Handle special converters by name pattern
        this._applySpecialConverters(javaName, javaStates, be);

        // 4. Remove Java-only states that have been fully handled by special converters
        // (Keep them otherwise - they pass through for round-trip fidelity)

        return be;
    }

    /**
     * Convert Bedrock block states to Java block states (reverse)
     * @param {string} beBlockId - Bedrock block type (as returned by mc.getBlock().type)
     * @param {object} beStates - Bedrock block states
     * @param {string|null} javaName - optional Java name hint
     * @returns {object} Java states
     */
    convertBedrockToJava(beBlockId, beStates, javaName) {
        if (!beStates || Object.keys(beStates).length === 0) return {};

        const java = {};

        // Try to find the mapping by BE name
        let mapping = null;
        if (javaName) {
            mapping = registry.getMapping(javaName);
        }
        if (!mapping) {
            const javaNames = registry.getJavaNames(beBlockId);
            if (javaNames.length > 0) {
                mapping = registry.getMapping(javaNames[0]);
            }
        }

        const stateMap = mapping ? mapping.s : null;
        const flags = mapping ? mapping.f : 0;
        const cat = mapping ? mapping.c : null;

        if (stateMap) {
            const reverseMap = {};
            for (const [jk, bk] of Object.entries(stateMap)) {
                reverseMap[bk] = jk;
            }
            for (const [bk, jk] of Object.entries(reverseMap)) {
                if (bk in beStates) {
                    java[jk] = beStates[bk];
                }
            }
        }

        // Copy unmapped states
        for (const [k, v] of Object.entries(beStates)) {
            if (!(k in java)) java[k] = v;
        }

        // Apply reverse directional converters
        if (flags & 1 && mapping) {
            this._convertFacingReverse(mapping, beStates, java, cat);
        }

        this._applySpecialConvertersReverse(beBlockId, beStates, java, javaName);

        return java;
    }

    // ========== DIRECTIONAL CONVERTERS ==========

    _convertFacing(javaName, js, be, cat) {
        const facing = js.facing;
        if (!facing) return;

        // Pumpkins
        if (javaName.includes('pumpkin') && !javaName.includes('_stem')) {
            be.direction = BE_DIRECTION_MAP[facing] !== undefined ? BE_DIRECTION_MAP[facing] : 0;
            delete be.facing;
            return;
        }

        // Piston / sticky_piston / dispenser / dropper / hopper / observer / crafter / furnace / dropper
        if (javaName.includes('piston') || javaName === 'minecraft:dispenser' || javaName === 'minecraft:dropper' ||
            javaName === 'minecraft:hopper' || javaName === 'minecraft:observer' || javaName === 'minecraft:crafter' ||
            javaName === 'minecraft:furnace' || javaName === 'minecraft:smoker' || javaName === 'minecraft:blast_furnace') {
            be.facing_direction = BE_FACING_MAP[facing] !== undefined ? BE_FACING_MAP[facing] : 0;
            delete be.facing;
            return;
        }

        // Stairs
        if (javaName.endsWith('_stairs')) {
            be.weirdo_direction = STAIR_JAVA_TO_BE_FACING[facing] !== undefined ? STAIR_JAVA_TO_BE_FACING[facing] : 0;
            delete be.facing;
            return;
        }

        // Doors (wooden_door / iron_door) - already handled in special converters
        // Trapdoors - handled in special converters
        // Beds - handled in special converters
        // Lever - handled in special converters
        // Stone button / wooden button
        if (javaName.includes('_button')) {
            be.button_pressed_bit = (js.powered === 'true' || js.pressed === 'true') ? 1 : 0;
            be.facing_direction = BUTTON_JAVA_FACING_TO_BE[facing] !== undefined ? BUTTON_JAVA_FACING_TO_BE[facing] : 0;
            delete be.facing;
            delete be.pressed;
            return;
        }

        // Repeater / Comparator
        if (javaName.includes('repeater') || javaName.includes('comparator')) {
            be.direction = BE_CARDINAL_MAP[facing] !== undefined ? BE_CARDINAL_MAP[facing] : 0;
            delete be.facing;
            return;
        }

        // Anvil
        if (javaName.includes('anvil')) {
            be.direction = ANVIL_JAVA_TO_BE_DIR[facing] !== undefined ? ANVIL_JAVA_TO_BE_DIR[facing] : 0;
            delete be.facing;
            return;
        }

        // Bell
        if (javaName.includes('bell')) {
            be.direction = BELL_JAVA_TO_BE_DIR[facing] !== undefined ? BELL_JAVA_TO_BE_DIR[facing] : 0;
            delete be.facing;
            return;
        }

        // Torch / wall_torch
        if (javaName.includes('torch') && !javaName.includes('redstone_torch')) {
            be.torch_facing_direction = TORCH_JAVA_TO_BE[facing] || 'top';
            delete be.facing;
            return;
        }

        // Redstone torch
        if (javaName.includes('redstone_torch')) {
            be.torch_facing_direction = TORCH_JAVA_TO_BE[facing] || 'top';
            delete be.facing;
            return;
        }

        // End rod
        if (javaName.includes('end_rod')) {
            be.facing_direction = END_ROD_JAVA_TO_BE[facing] !== undefined ? END_ROD_JAVA_TO_BE[facing] : 0;
            delete be.facing;
            return;
        }

        // Ladder / wall_sign / wall_banner / tripwire_hook / lightning_rod / grindingstone / loom /
        // lectern / stonecutter / campfire / decorated_pot / beehive / bee_nest
        const cardinal = ['north', 'south', 'west', 'east'];
        if (cardinal.includes(facing) || javaName.includes('lightning_rod') || javaName.includes('campfire') || javaName.includes('beehive') || javaName.includes('bee_nest')) {
            be.facing_direction = BE_FACING_MAP[facing] !== undefined ? BE_FACING_MAP[facing] : 3;
            delete be.facing;
            return;
        }

        // End portal frame
        if (javaName.includes('end_portal_frame')) {
            be.direction = BE_CARDINAL_MAP[facing] !== undefined ? BE_CARDINAL_MAP[facing] : 0;
            delete be.facing;
            return;
        }
    }

    _convertFacingReverse(mapping, bs, java, cat) {
        // Stairs
        if (mapping.b && mapping.b.endsWith('_stairs') && bs.weirdo_direction !== undefined) {
            const reverse = { 0: 'east', 1: 'west', 2: 'south', 3: 'north' };
            java.facing = reverse[bs.weirdo_direction] || 'north';
            delete java.weirdo_direction;
            return;
        }

        // Buttons
        if (mapping.b && mapping.b.includes('button') && bs.facing_direction !== undefined) {
            const reverse = { 0: 'up', 1: 'west', 2: 'south', 3: 'north', 4: 'east', 5: 'down' };
            java.facing = reverse[bs.facing_direction] || 'up';
            delete java.facing_direction;
            return;
        }

        // Beds
        if (mapping.b === 'bed' && bs.direction !== undefined) {
            const reverse = { 0: 'east', 1: 'north', 2: 'west', 3: 'south' };
            java.facing = reverse[bs.direction] || 'north';
            delete java.direction;
            return;
        }

        // General facing_direction -> facing
        if (bs.facing_direction !== undefined) {
            java.facing = BE_FACING_REVERSE[bs.facing_direction] || 'down';
            delete java.facing_direction;
            return;
        }

        // direction (cardinal) -> facing
        if (bs.direction !== undefined) {
            java.facing = BE_CARDINAL_REVERSE[bs.direction] || 'south';
            delete java.direction;
            return;
        }
    }

    // ========== SPECIAL CONVERTERS ==========

    _applySpecialConverters(javaName, js, be) {
        // DOORS: wooden, iron, copper, and wood-type doors
        if (javaName.endsWith('_door')) {
            const facing = js.facing || 'north';
            be.direction = DOOR_JAVA_TO_BE_DIR[facing] !== undefined ? DOOR_JAVA_TO_BE_DIR[facing] : 0;
            be.open_bit = (js.open === 'true') ? 1 : 0;
            if (js.half === 'upper') {
                be.upper_block_bit = 1;
            } else {
                be.upper_block_bit = 0;
            }
            if (js.hinge === 'right') {
                be.door_hinge_bit = 1;
            } else {
                be.door_hinge_bit = 0;
            }
            delete be.facing;
            delete be.open;
            delete be.half;
            delete be.hinge;
            delete be.powered;
            return;
        }

        // TRAPDOORS
        if (javaName.endsWith('_trapdoor') || javaName === 'minecraft:iron_trapdoor' || javaName === 'minecraft:copper_trapdoor') {
            const facing = js.facing || 'north';
            be.direction = BE_CARDINAL_MAP[facing] !== undefined ? BE_CARDINAL_MAP[facing] : 0;
            be.open_bit = (js.open === 'true') ? 1 : 0;
            be.upside_down_bit = (js.half === 'top') ? 1 : 0;
            delete be.facing;
            delete be.open;
            delete be.half;
            delete be.powered;
            delete be.waterlogged;
            return;
        }

        // BEDS
        if (javaName.includes('_bed') || javaName === 'minecraft:bed') {
            const facing = js.facing || 'north';
            be.direction = BED_JAVA_TO_BE[facing] || 3;
            be.head_piece_bit = (js.part === 'head') ? 1 : 0;
            be.occupied_bit = (js.occupied === 'true') ? 1 : 0;
            delete be.facing;
            delete be.part;
            delete be.occupied;
            return;
        }

        // LEVER
        if (javaName === 'minecraft:lever') {
            const facing = js.facing || 'north';
            const face = js.face || 'wall';
            let leverDir;
            if (face === 'wall') {
                leverDir = LEVER_JAVA_TO_BE[facing] || 'south';
            } else if (face === 'ceiling') {
                if (facing === 'north' || facing === 'south') leverDir = 'up_north_south';
                else leverDir = 'up_east_west';
            } else {
                if (facing === 'north' || facing === 'south') leverDir = 'down_north_south';
                else leverDir = 'down_east_west';
            }
            be.lever_direction = leverDir;
            be.open_bit = (js.powered === 'true') ? 1 : 0;
            delete be.facing;
            delete be.powered;
            return;
        }

        // FENCE GATES
        if (javaName.includes('fence_gate')) {
            const facing = js.facing || 'north';
            be.direction = BE_CARDINAL_MAP[facing] !== undefined ? BE_CARDINAL_MAP[facing] : 0;
            be.open_bit = (js.open === 'true') ? 1 : 0;
            be.in_wall_bit = (js.in_wall === 'true') ? 1 : 0;
            delete be.facing;
            delete be.open;
            delete be.in_wall;
            delete be.powered;
            return;
        }

        // RAILS
        if (javaName === 'minecraft:rail') {
            const shape = js.shape || 'north_south';
            const idx = JAVA_RAIL_SHAPE.indexOf(shape);
            be.rail_direction = idx >= 0 ? BE_RAIL_DIRECTION[idx] : 0;
            delete be.shape;
            return;
        }

        // POWERED / DETECTOR / ACTIVATOR RAIL
        if (javaName.includes('_rail') && javaName !== 'minecraft:rail') {
            const shape = js.shape || 'north_south';
            const idx = JAVA_RAIL_SHAPE.indexOf(shape);
            be.rail_direction = idx >= 0 ? BE_RAIL_DIRECTION[idx] : 0;
            if (js.powered !== undefined) {
                be.rail_data_bit = (js.powered === 'true') ? 1 : 0;
                delete be.powered;
            }
            delete be.shape;
            return;
        }

        // REPEATER
        if (javaName.includes('repeater') || javaName === 'minecraft:powered_repeater') {
            const delay = parseInt(js.delay || '1', 10);
            be.repeater_delay = Math.max(0, Math.min(3, delay - 1));
            be.powered_bit = javaName.includes('powered') ? 1 : (js.powered === 'true' ? 1 : 0);
            if (js.locked) {
                be.locked_bit = (js.locked === 'true') ? 1 : 0;
                delete be.locked;
            }
            delete be.delay;
            delete be.powered;
            return;
        }

        // COMPARATOR
        if (javaName.includes('comparator')) {
            be.output_subtract_bit = (js.mode === 'subtract') ? 1 : 0;
            be.output_lit_bit = javaName.includes('powered') ? 1 : (js.powered === 'true' ? 1 : 0);
            delete be.mode;
            delete be.powered;
            return;
        }

        // CAKE
        if (javaName === 'minecraft:cake') {
            const bites = parseInt(js.bites || '0', 10);
            be.bite_counter = Math.min(6, bites);
            delete be.bites;
            return;
        }

        // COMPOSTER
        if (javaName === 'minecraft:composter') {
            const level = parseInt(js.level || '0', 10);
            be.composter_fill_level = Math.min(8, level);
            delete be.level;
            return;
        }

        // SNOW LAYER
        if (javaName === 'minecraft:snow') {
            const layers = parseInt(js.layers || '1', 10);
            be.height = Math.min(8, Math.max(1, layers)) - 1;
            delete be.layers;
            return;
        }

        // CHORUS FLOWER
        if (javaName === 'minecraft:chorus_flower') {
            be.age = parseInt(js.age || '0', 10);
            return;
        }

        // CANNON (candle)
        if (javaName.includes('candle')) {
            const candles = parseInt(js.candles || '1', 10);
            be.candles = Math.min(4, Math.max(1, candles));
            be.lit_bit = (js.lit === 'true') ? 1 : 0;
            delete be.lit;
            delete be.waterlogged;
            return;
        }

        // SEA PICKLE
        if (javaName === 'minecraft:sea_pickle') {
            const pickles = parseInt(js.pickles || '1', 10);
            be.cluster_count = Math.min(4, Math.max(1, pickles));
            delete be.pickles;
            delete be.waterlogged;
            return;
        }

        // TURTLE_EGG
        if (javaName === 'minecraft:turtle_egg') {
            const eggs = parseInt(js.eggs || '1', 10);
            be.egg_count = Math.min(4, Math.max(1, eggs));
            delete be.eggs;
            return;
        }

        // SWEET BERRY BUSH
        if (javaName === 'minecraft:sweet_berry_bush') {
            const age = parseInt(js.age || '0', 10);
            be.growth = Math.min(3, age);
        }

        // CROPS: wheat, carrots, potatoes, beetroots, nether_wart
        const cropAgeMap = {
            'minecraft:wheat': 'growth',
            'minecraft:carrots': 'growth',
            'minecraft:potatoes': 'growth',
            'minecraft:beetroots': 'growth',
            'minecraft:nether_wart': 'growth',
            'minecraft:torchflower_crop': 'growth',
            'minecraft:pitcher_crop': 'growth'
        };
        if (cropAgeMap[javaName] && js.age !== undefined) {
            be[cropAgeMap[javaName]] = parseInt(js.age, 10);
            delete be.age;
            return;
        }

        // BAMBOO
        if (javaName === 'minecraft:bamboo') {
            if (js.leaves) be.bamboo_leaf_size = js.leaves;
            delete be.leaves;
            return;
        }

        // BIG DRIPLEAF
        if (javaName === 'minecraft:big_dripleaf') {
            if (js.tilt) be.big_dripleaf_tilt = js.tilt;
            delete be.tilt;
            return;
        }

        // PINK PETALS
        if (javaName === 'minecraft:pink_petals') {
            const growth = parseInt(js.growth || '1', 10);
            be.growth = Math.min(4, Math.max(1, growth));
            return;
        }
    }

    _applySpecialConvertersReverse(beBlockId, bs, java, javaName) {
        // DOORS
        if (beBlockId.includes('_door') || beBlockId === 'iron_door' || beBlockId === 'copper_door') {
            const reverseDir = { 0: 'east', 1: 'south', 2: 'west', 3: 'north' };
            java.facing = reverseDir[bs.direction] || 'east';
            java.open = bs.open_bit === 1 ? 'true' : 'false';
            java.half = bs.upper_block_bit === 1 ? 'upper' : 'lower';
            java.hinge = bs.door_hinge_bit === 1 ? 'right' : 'left';
            delete java.direction;
            delete java.open_bit;
            delete java.upper_block_bit;
            delete java.door_hinge_bit;
            return;
        }

        // TRAPDOORS
        if (beBlockId.includes('trapdoor') || beBlockId === 'iron_trapdoor' || beBlockId === 'copper_trapdoor') {
            const reverseDir = { 0: 'south', 1: 'north', 2: 'east', 3: 'west' };
            java.facing = reverseDir[bs.direction] || 'south';
            java.open = bs.open_bit === 1 ? 'true' : 'false';
            java.half = bs.upside_down_bit === 1 ? 'top' : 'bottom';
            delete java.direction;
            delete java.open_bit;
            delete java.upside_down_bit;
            return;
        }

        // BEDS (reverse)
        if ((beBlockId === 'bed' || beBlockId.includes('_bed')) && bs.direction !== undefined) {
            const reverseDir = { 0: 'east', 1: 'north', 2: 'west', 3: 'south' };
            java.facing = reverseDir[bs.direction] || 'north';
            java.part = bs.head_piece_bit === 1 ? 'head' : 'foot';
            java.occupied = bs.occupied_bit === 1 ? 'true' : 'false';
            delete java.direction;
            delete java.head_piece_bit;
            delete java.occupied_bit;
            return;
        }

        // REPEATER
        if (beBlockId.includes('repeater')) {
            java.delay = String((bs.repeater_delay || 0) + 1);
            java.powered = (bs.powered_bit === 1) ? 'true' : 'false';
            delete java.repeater_delay;
            delete java.powered_bit;
            return;
        }

        // COMPARATOR
        if (beBlockId.includes('comparator')) {
            java.mode = (bs.output_subtract_bit === 1) ? 'subtract' : 'compare';
            java.powered = (bs.output_lit_bit === 1) ? 'true' : 'false';
            delete java.output_subtract_bit;
            delete java.output_lit_bit;
            return;
        }

        // CAKE
        if (beBlockId === 'cake' && bs.bite_counter !== undefined) {
            java.bites = String(bs.bite_counter || 0);
            delete java.bite_counter;
            return;
        }

        // SNOW LAYER
        if (beBlockId === 'snow_layer' && bs.height !== undefined) {
            java.layers = String((bs.height || 0) + 1);
            delete java.height;
            return;
        }

        // COMPOSTER
        if (beBlockId === 'composter' && bs.composter_fill_level !== undefined) {
            java.level = String(bs.composter_fill_level || 0);
            delete java.composter_fill_level;
            return;
        }

        // CANDLE
        if (beBlockId.includes('candle') && bs.lit_bit !== undefined) {
            java.lit = bs.lit_bit === 1 ? 'true' : 'false';
            if (bs.candles) java.candles = String(bs.candles);
            delete java.lit_bit;
            return;
        }

        // SEA PICKLE
        if (beBlockId === 'sea_pickle' && bs.cluster_count !== undefined) {
            java.pickles = String(bs.cluster_count);
            delete java.cluster_count;
            return;
        }

        // LEVER
        if (beBlockId === 'lever' && bs.lever_direction) {
            const reverse = { 'south': 'north', 'north': 'south', 'east': 'west', 'west': 'east',
                'up_north_south': 'north', 'up_east_west': 'east',
                'down_north_south': 'north', 'down_east_west': 'east' };
            java.facing = reverse[bs.lever_direction] || 'north';
            java.powered = bs.open_bit === 1 ? 'true' : 'false';
            delete java.lever_direction;
            delete java.open_bit;
            return;
        }

        // FENCE GATE
        if (beBlockId.includes('fence_gate')) {
            java.facing = BE_CARDINAL_REVERSE[bs.direction] || 'south';
            java.open = bs.open_bit === 1 ? 'true' : 'false';
            java.in_wall = bs.in_wall_bit === 1 ? 'true' : 'false';
            delete java.direction;
            delete java.open_bit;
            delete java.in_wall_bit;
            return;
        }

        // RAILS
        if (beBlockId.includes('rail') && bs.rail_direction !== undefined) {
            const shapeIdx = BE_RAIL_DIRECTION.indexOf(bs.rail_direction);
            java.shape = shapeIdx >= 0 ? JAVA_RAIL_SHAPE[shapeIdx] : 'north_south';
            if (bs.rail_data_bit !== undefined && beBlockId !== 'rail') {
                java.powered = bs.rail_data_bit === 1 ? 'true' : 'false';
                delete java.rail_data_bit;
            }
            delete java.rail_direction;
            return;
        }

        // CROPS: wheat, carrots, potatoes, beetroots, nether_wart (growth → age)
        const cropReverseMap = {
            'wheat': 'minecraft:wheat',
            'carrots': 'minecraft:carrots',
            'potatoes': 'minecraft:potatoes',
            'beetroot': 'minecraft:beetroots',
            'nether_wart': 'minecraft:nether_wart'
        };
        for (const [beKey, jaName] of Object.entries(cropReverseMap)) {
            if ((beBlockId === beKey || javaName === jaName) && bs.growth !== undefined) {
                java.age = String(bs.growth);
                delete java.growth;
                return;
            }
        }

        // TURTLE EGG (egg_count → eggs)
        if (beBlockId === 'turtle_egg' && bs.egg_count !== undefined) {
            java.eggs = String(bs.egg_count);
            delete java.egg_count;
            return;
        }

        // BIG DRIPLEAF (big_dripleaf_tilt → tilt)
        if (beBlockId === 'big_dripleaf' && bs.big_dripleaf_tilt !== undefined) {
            java.tilt = bs.big_dripleaf_tilt;
            delete java.big_dripleaf_tilt;
            return;
        }

        // BAMBOO (bamboo_leaf_size → leaves)
        if (beBlockId === 'bamboo' && bs.bamboo_leaf_size !== undefined) {
            java.leaves = bs.bamboo_leaf_size;
            delete java.bamboo_leaf_size;
            return;
        }

        // EGG (candle cake light)
        if (beBlockId.includes('candle') && bs.lit_bit !== undefined) {
            java.lit = bs.lit_bit === 1 ? 'true' : 'false';
            if (bs.candles) java.candles = String(bs.candles);
            delete java.lit_bit;
            return;
        }

        // COPPER BULB (lit_bit → lit)
        if (beBlockId === 'copper_bulb' && bs.lit_bit !== undefined) {
            java.lit = bs.lit_bit === 1 ? 'true' : 'false';
            delete java.lit_bit;
            return;
        }
    }
}

module.exports = { BlockStateConverters };