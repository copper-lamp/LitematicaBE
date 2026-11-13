/**
 * BlockStateConverters.js
 * Bidirectional state conversion between Java Edition and Bedrock Edition
 * Covers: directional, rails, stairs, doors, trapdoors, beds, redstone, buttons, levers, etc.
 */
const { BlockMappingRegistry } = require('./BlockMappingRegistry');
const { isSlabName } = require('./SlabNames');
const {
    PISTON_FACING, JAVA_TO_PISTON_FACING, PISTON_FACING_TO_JAVA, isPistonName,
} = require('./PistonFacing');

const registry = new BlockMappingRegistry();

// === 二高植物（double_plant 族）===
// Java 侧这些方块有 `half: lower/upper`，基岩侧用 `upper_block_bit: 0/1` 表达上下半。
// 缺这个转换的后果（2026-11-13 真机）：投影里的上格（half=upper）被当成 BE 默认状态
// （upper_block_bit=0，即下格）放置 → 下方无固体支撑 → BDS 立即把植物破坏成凋落物 →
// 打印机每轮重试 → 死循环 + 无限凋落物。BE 侧 `tall_grass` 本身就是双格高草。
const DOUBLE_PLANT_JAVA = new Set([
    'minecraft:rose_bush', 'minecraft:sunflower', 'minecraft:lilac',
    'minecraft:peony', 'minecraft:large_fern', 'minecraft:tall_grass',
]);
const DOUBLE_PLANT_BE = new Set([
    'rose_bush', 'sunflower', 'lilac', 'peony', 'large_fern', 'tall_grass',
]);

// === 方向族方块（2026-11-13 实机结论，勿再改回全局活塞表）===
// ★ 2026-11-13 实测：把活塞表套到 dispenser 上会让水平四向整体反 180°。
//   证据链：mcstructure 里 dispenser 的 facing_direction = 2/3/4/5，直接放置到世界后
//   方向与数据一致（= 通用表 2=north 3=south 4=west 5=east）；
//   而同一批数据经 litematic（Java 的 facing）转换时走活塞表 → 全部反 180°。
//   结论：**只有活塞族**的 facing_direction 与通用枚举相反（见 mappings/PistonFacing.js），
//   其余方向族（dispenser / dropper / hopper / crafter / furnace / smoker / blast_furnace）
//   一律用 BE_FACING_MAP。observer 更特殊，见 _convertFacing 里的独立分支（带前缀 + 字符串值）。
//
// 原「DIRECTIONAL_USE_PISTON_FACING」开关已删除：它把活塞表全局应用，是上述 180° bug 的来源。

/** 这 8 个方向族方块的 Java 名（_convertFacing 用） */
const DIRECTIONAL_JAVA_NAMES = new Set([
    'minecraft:dispenser', 'minecraft:dropper', 'minecraft:hopper',
    'minecraft:observer', 'minecraft:crafter',
    'minecraft:furnace', 'minecraft:smoker', 'minecraft:blast_furnace',
]);

/** 这 8 个方向族方块的 BE 名（_convertFacingReverse 用，映射自 mapping.b） */
const DIRECTIONAL_BE_NAMES = new Set([
    'dispenser', 'dropper', 'hopper', 'observer', 'crafter',
    'furnace', 'smoker', 'blast_furnace',
]);

// === FACING MAPS ===
const JAVA_FACING = ['down', 'up', 'north', 'south', 'west', 'east'];
// Most BE blocks: 0=down, 1=up, 2=north, 3=south, 4=west, 5=east
const BE_FACING_MAP = { down: 0, up: 1, north: 2, south: 3, west: 4, east: 5 };
const BE_FACING_REVERSE = { 0: 'down', 1: 'up', 2: 'north', 3: 'south', 4: 'west', 5: 'east' };
// Buttons use different order: 0=down, 1=up, 2=south, 3=north, 4=east, 5=west
const BE_FACING_BUTTON = { down: 0, up: 1, south: 2, north: 3, east: 4, west: 5 };

// DIRECTION (pumpkin, etc.)
const BE_DIRECTION_MAP = { south: 0, west: 1, north: 2, east: 3 };
const BE_DIRECTION_REVERSE = { 0: 'south', 1: 'west', 2: 'north', 3: 'east' };

// CARDINAL (banners, signs, etc.)
const BE_CARDINAL_MAP = { south: 0, west: 1, north: 2, east: 3 };
// 中继器/比较器：Bedrock direction 与 Java facing 同义（均为输出朝向）

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
// Java lever facing: lever is on this face, handle extends outward
// BE lever_direction: handle points in this direction (opposite face attachment)
// e.g., Java facing=north (lever on north face, handle extends north) → BE lever_direction=north
const LEVER_JAVA_TO_BE = { north: 'north', south: 'south', east: 'east', west: 'west', up_x: 'up_north_south', up_z: 'up_east_west', down_x: 'down_north_south', down_z: 'down_east_west' };

// === BUTTON FACING ===
// Java: face=wall/floor/ceiling + facing=direction. BE: facing_direction numeric.
// BE_FACING_BUTTON: { down:0, up:1, south:2, north:3, east:4, west:5 }
const BUTTON_JAVA_FACING_TO_BE = {
    north: 3, south: 2, east: 4, west: 5
};

// === BED DIRECTION ===
const BED_JAVA_TO_BE = { south: 3, north: 1, east: 0, west: 2 };

// === PILLAR_AXIS / AXIS MAP ===
const AXIS_MAP = { x: 'x', y: 'y', z: 'z' };

// === END ROD FACING ===
const END_ROD_JAVA_TO_BE = { down: 0, up: 1, south: 2, north: 3, east: 4, west: 5 };

// === ANVIL FACING ===
const ANVIL_JAVA_TO_BE_DIR = { south: 0, west: 1, north: 2, east: 3 };

// === BELL ATTACHMENT ===
const BELL_JAVA_TO_BE_DIR = { south: 0, west: 1, north: 2, east: 3 };

class BlockStateConverters {

    /**
     * Convert Java block states to Bedrock block states (forward)
     * @param {string} javaName - full Java block name
     * @param {object} javaStates - { stateKey: stateValue }
     * @returns {object} bedrock states
     */
    convertJavaToBedrock(javaName, javaStates) {
        const be = {};
        const states = javaStates || {};

        // Always apply special converters first (for color extraction, etc.)
        // This handles cases where javaStates is empty but color info is in the block name
        this._applySpecialConverters(javaName, states, be);

        // Only process state mappings if we have actual states to convert
        if (Object.keys(states).length > 0) {
            const mapping = registry.getMapping(javaName);
            const stateMap = mapping ? mapping.s : null;
            const flags = mapping ? mapping.f : 0;
            const cat = mapping ? mapping.c : null;

            // 1. Apply name mappings from the registry (e.g., axis -> pillar_axis)
            if (stateMap) {
                for (const [jk, bk] of Object.entries(stateMap)) {
                    if (jk in states) {
                        be[bk] = states[jk];
                    }
                }
            } else {
                Object.assign(be, states);
            }

            // 2. Apply directional converters if flagged
            if (flags & 1) {
                this._convertFacing(javaName, states, be, cat);
            }
        }

        // 4. Remove Java-only states that have been fully handled by special converters
        // (Keep them otherwise - they pass through for round-trip fidelity)

        // 4.5 二高植物：Java `half` → BE `upper_block_bit`（必须在 Object.assign 之后，
        //    否则被灌回来的 `half` 会残留进 NBT；BDS 不认 `half` 键，会静默丢弃）。
        //    half 只在投影里的上/下格出现；没有 half 的（如单格 Java 矮草）不动。
        if (DOUBLE_PLANT_JAVA.has(javaName) && states.half !== undefined) {
            be.upper_block_bit = (states.half === 'upper') ? 1 : 0;
            delete be.half;
        }

        // 5. 半砖归一化 —— 必须放在最后。上面 `Object.assign(be, states)` 会把 Java 的
        //    `type` / `waterlogged` 原样灌回来（slab 的 registry 映射没有 s 表），
        //    只在特殊转换器里 delete 是删不干净的。
        //    Java `type`(bottom/top/double) → 基岩 `vertical_half`(bottom/top)；
        //    double 由方块名承载（见 mappings/SlabNames.js），状态整体清空。
        //    历史 bug：打印机放置时 `type=top` 原样写进基岩 setBlock，基岩不认这个键 →
        //    上下半砖状态丢失，永远放下半砖（且 waterlogged 会让 setBlock 整条失败）。
        if (isSlabName(javaName)) {
            const half = states.type !== undefined ? states.type : states.half;
            const slabStates = {};
            if (half === 'top' || half === 'bottom') slabStates.vertical_half = half;
            return slabStates;
        }

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

        // 半砖反向：基岩 `vertical_half` → Java `type`（旧版存档的 `top_slot_bit` 一并兼容）。
        // 不做这一步，.mcstructure 读回来的半砖会被当成"没有上下之分"。
        if (beStates.vertical_half !== undefined) {
            java.type = beStates.vertical_half;
            delete java.vertical_half;
        } else if (beStates.top_slot_bit !== undefined) {
            const top = beStates.top_slot_bit === 1 || beStates.top_slot_bit === true;
            java.type = top ? 'top' : 'bottom';
            delete java.top_slot_bit;
        }

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

        // 活塞族：facing_direction 的语义与通用枚举相反（2=south 3=north 4=east 5=west），
        // 只有竖直两档与通用表相同。唯一真源见 mappings/PistonFacing.js。
        if (javaName.includes('piston')) {
            be.facing_direction = JAVA_TO_PISTON_FACING[facing] !== undefined
                ? JAVA_TO_PISTON_FACING[facing]
                : PISTON_FACING.DOWN;
            delete be.facing;
            return;
        }

        // observer 单列：基岩状态名带命名空间、值是字符串
        // （实测 mcstructure 写的是 {"minecraft:facing_direction": "west"}，语义与 Java 的 facing 相同）。
        // 不能走下面的整型方向表：observer 的 facing_direction 不是 0-5 编号。
        if (javaName === 'minecraft:observer') {
            be['minecraft:facing_direction'] = String(facing);
            delete be.facing;
            delete be.facing_direction;
            return;
        }

        // dispenser / dropper / hopper / crafter / furnace —— 统一用通用表（见文件头 2026-11-13 结论）。
        // 曾经全局套用活塞表，导致水平四向整体反 180°。
        if (DIRECTIONAL_JAVA_NAMES.has(javaName)) {
            be.facing_direction = BE_FACING_MAP[facing] !== undefined ? BE_FACING_MAP[facing] : 0;
            delete be.facing;
            return;
        }

        // Stairs
        if (javaName.endsWith('_stairs')) {
            be.weirdo_direction = STAIR_JAVA_TO_BE_FACING[facing] !== undefined ? STAIR_JAVA_TO_BE_FACING[facing] : 0;
            delete be.facing;
            // Java half=top → 基岩 upside_down_bit=1（倒置楼梯）。不转就永远正放，
            // 而且 BlockVerifier 的白名单里要校验 upside_down_bit，会判"对不上"。
            if (js.half !== undefined) {
                be.upside_down_bit = (js.half === 'top' || js.half === 'true' || js.half === true) ? 1 : 0;
                delete be.half;
            }
            return;
        }

        // Doors (wooden_door / iron_door) - already handled in special converters
        // Trapdoors - handled in special converters
        // Beds - handled in special converters
        // Lever - handled in special converters
        // Stone button / wooden button
        if (javaName.includes('_button')) {
            be.button_pressed_bit = (js.powered === 'true' || js.powered === true || js.pressed === 'true' || js.pressed === true) ? 1 : 0;
            const face = js.face || 'wall';
            if (face === 'ceiling') {
                be.facing_direction = 0;  // button on ceiling → down
            } else if (face === 'floor') {
                be.facing_direction = 1;  // button on floor → up
            } else {
                be.facing_direction = BUTTON_JAVA_FACING_TO_BE[facing] !== undefined ? BUTTON_JAVA_FACING_TO_BE[facing] : 2;
            }
            delete be.facing;
            delete be.face;
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
            // 基岩 upside_down_bit=1 → Java half=top
            if (bs.upside_down_bit !== undefined) {
                const top = bs.upside_down_bit === 1 || bs.upside_down_bit === true;
                java.half = top ? 'top' : 'bottom';
                delete java.upside_down_bit;
            }
            return;
        }

        // Buttons
        if (mapping.b && mapping.b.includes('button') && bs.facing_direction !== undefined) {
            const dir = bs.facing_direction;
            // 0=down(ceiling), 1=up(floor), 2=south(attached north), 3=north(attached south), 4=east(attached west), 5=west(attached east)
            if (dir === 0) {
                java.face = 'ceiling';
            } else if (dir === 1) {
                java.face = 'floor';
            } else {
                java.face = 'wall';
                const reverse = { 2: 'south', 3: 'north', 4: 'east', 5: 'west' };
                java.facing = reverse[dir] || 'north';
            }
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
            // 只有活塞族的 facing_direction 与通用枚举相反（2=south 3=north 4=east 5=west），
            // 其余方向族（dispenser/dropper/hopper/crafter/furnace…）一律用通用反向表。
            // 与 _convertFacing 对称：2026-11-13 实测，全局套活塞表会让水平四向反 180°。
            const usePiston = isPistonName(mapping.b);
            java.facing = usePiston
                ? (PISTON_FACING_TO_JAVA[bs.facing_direction] || 'down')
                : (BE_FACING_REVERSE[bs.facing_direction] || 'down');
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
        // === COLOR EXTRACTION: 从Java块名中提取颜色（羊毛/陶瓦/混凝土/玻璃/地毯/旗帜等）===
        const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
                        'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
        // 需要在BE中设置color状态的方块类型
        const COLOR_BLOCK_TYPES = ['wool', 'carpet', 'terracotta', 'concrete', 'concrete_powder',
                                   'stained_glass', 'stained_glass_pane', 'banner', 'wall_banner',
                                   'bed', 'shulker_box', 'candle', 'candle_cake'];
        const coloredBlockType = COLOR_BLOCK_TYPES.find(t => javaName.endsWith('_' + t));
        if (coloredBlockType) {
            const baseName = '_' + coloredBlockType;
            const prefix = javaName.replace('minecraft:', '').replace(baseName, '');
            if (COLORS.includes(prefix)) {
                be.color = prefix;
            }
        }

        // DOORS: wooden, iron, copper, and wood-type doors
        if (javaName.endsWith('_door')) {
            const facing = js.facing || 'north';
            be.direction = DOOR_JAVA_TO_BE_DIR[facing] !== undefined ? DOOR_JAVA_TO_BE_DIR[facing] : 0;
            be.open_bit = (js.open === 'true' || js.open === true) ? 1 : 0;
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
            be.open_bit = (js.open === 'true' || js.open === true) ? 1 : 0;
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
            be.occupied_bit = (js.occupied === 'true' || js.occupied === true) ? 1 : 0;
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
            be.open_bit = (js.powered === 'true' || js.powered === true) ? 1 : 0;
            delete be.facing;
            delete be.powered;
            return;
        }

        // FENCE GATES
        if (javaName.includes('fence_gate')) {
            const facing = js.facing || 'north';
            be.direction = BE_CARDINAL_MAP[facing] !== undefined ? BE_CARDINAL_MAP[facing] : 0;
            be.open_bit = (js.open === 'true' || js.open === true) ? 1 : 0;
            be.in_wall_bit = (js.in_wall === 'true' || js.in_wall === true) ? 1 : 0;
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
                be.rail_data_bit = (js.powered === 'true' || js.powered === true) ? 1 : 0;
                delete be.powered;
            }
            delete be.shape;
            return;
        }

        // REPEATER
        if (javaName.includes('repeater') || javaName === 'minecraft:powered_repeater') {
            const _rf = js.facing || 'north';
            be.direction = BE_CARDINAL_MAP[_rf] !== undefined ? BE_CARDINAL_MAP[_rf] : 2;
            const delay = parseInt(js.delay || '1', 10);
            be.repeater_delay = Math.max(0, Math.min(3, delay - 1));
            be.powered_bit = (javaName === 'minecraft:powered_repeater' || javaName === 'powered_repeater' || (javaName === 'minecraft:repeater' && (js.powered === 'true' || js.powered === true))) ? 1 : 0;
            if (js.locked) {
                be.locked_bit = (js.locked === 'true' || js.locked === true) ? 1 : 0;
                delete be.locked;
            }
            delete be.delay;
            delete be.powered;
            return;
        }

        // COMPARATOR
        if (javaName.includes('comparator')) {
            const _cf = js.facing || 'north';
            be.direction = BE_CARDINAL_MAP[_cf] !== undefined ? BE_CARDINAL_MAP[_cf] : 2;
            be.output_subtract_bit = (js.mode === 'subtract') ? 1 : 0;
            be.output_lit_bit = (javaName === 'minecraft:powered_comparator' || javaName === 'powered_comparator' || (javaName === 'minecraft:comparator' && (js.powered === 'true' || js.powered === true))) ? 1 : 0;
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
            be.lit_bit = (js.lit === 'true' || js.lit === true) ? 1 : 0;
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

        // REDSTONE WIRE: power -> redstone_signal
        if (javaName === 'minecraft:redstone_wire') {
            const power = parseInt(js.power || '0', 10);
            be.redstone_signal = Math.min(15, Math.max(0, power));
            delete be.power;
            return;
        }

        // REDSTONE TORCH / WALL TORCH: lit handled at block-name level (tryPlaceBlock)
        // Just clean up the lit state so it doesn't pollute the BE command
        if (javaName.includes('redstone_torch')) {
            delete be.lit;
            return;
        }

        // OBSERVER: powered -> powered_bit
        if (javaName === 'minecraft:observer') {
            be.powered_bit = (js.powered === 'true' || js.powered === true) ? 1 : 0;
            delete be.powered;
            return;
        }

        // PISTON / STICKY_PISTON: extended -> extended_bit
        if (javaName === 'minecraft:piston' || javaName === 'minecraft:sticky_piston') {
            be.extended_bit = (js.extended === 'true' || js.extended === true) ? 1 : 0;
            delete be.extended;
            return;
        }

        // DISPENSER / DROPPER: triggered -> triggered_bit
        if (javaName === 'minecraft:dispenser' || javaName === 'minecraft:dropper') {
            be.triggered_bit = (js.triggered === 'true' || js.triggered === true) ? 1 : 0;
            delete be.triggered;
            return;
        }

        // HOPPER: enabled -> toggle_bit (inverted: enabled=true -> toggle_bit=0)
        if (javaName === 'minecraft:hopper') {
            be.toggle_bit = (js.enabled === 'true' || js.enabled === true) ? 0 : 1;
            delete be.enabled;
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

        // DOUBLE PLANTS: BE `upper_block_bit` → Java `half`（与正向转换对称）。
        // 缺反向的后果：.mcstructure 读回 / 投影保存时上格丢失 half 信息，
        // 二高植物上格被当"没有上下之分"，再次打印又变成下格 → 死循环复现。
        const bareBlock = String(beBlockId).includes(':')
            ? String(beBlockId).slice(String(beBlockId).indexOf(':') + 1)
            : String(beBlockId);
        if (DOUBLE_PLANT_BE.has(bareBlock) && bs.upper_block_bit !== undefined) {
            java.half = (bs.upper_block_bit === 1 || bs.upper_block_bit === true) ? 'upper' : 'lower';
            delete java.upper_block_bit;
            return;
        }

        // TRAPDOORS
        if (beBlockId.includes('trapdoor') || beBlockId === 'iron_trapdoor' || beBlockId === 'copper_trapdoor') {
            const reverseDir = { 0: 'south', 1: 'west', 2: 'north', 3: 'east' };
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
            if (bs.direction !== undefined) {
                java.facing = BE_CARDINAL_REVERSE[bs.direction] || 'north';
                delete java.direction;
            }
            java.delay = String((bs.repeater_delay || 0) + 1);
            java.powered = (bs.powered_bit === 1) ? 'true' : 'false';
            delete java.repeater_delay;
            delete java.powered_bit;
            return;
        }

        // COMPARATOR
        if (beBlockId.includes('comparator')) {
            if (bs.direction !== undefined) {
                java.facing = BE_CARDINAL_REVERSE[bs.direction] || 'north';
                delete java.direction;
            }
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
            const reverse = { 'north': 'north', 'south': 'south', 'east': 'east', 'west': 'west',
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

        // REDSTONE WIRE: redstone_signal → power
        if (beBlockId === 'redstone_wire' && bs.redstone_signal !== undefined) {
            java.power = String(bs.redstone_signal);
            delete java.redstone_signal;
            return;
        }

        // OBSERVER: powered_bit → powered
        if (beBlockId === 'observer' && bs.powered_bit !== undefined) {
            java.powered = bs.powered_bit === 1 ? 'true' : 'false';
            delete java.powered_bit;
            return;
        }

        // PISTON / STICKY_PISTON: extended_bit → extended
        if ((beBlockId === 'piston' || beBlockId === 'sticky_piston') && bs.extended_bit !== undefined) {
            java.extended = bs.extended_bit === 1 ? 'true' : 'false';
            delete java.extended_bit;
            return;
        }

        // DISPENSER / DROPPER: triggered_bit → triggered
        if ((beBlockId === 'dispenser' || beBlockId === 'dropper') && bs.triggered_bit !== undefined) {
            java.triggered = bs.triggered_bit === 1 ? 'true' : 'false';
            delete java.triggered_bit;
            return;
        }

        // HOPPER: toggle_bit → enabled (inverted: toggle_bit=0 → enabled=true)
        if (beBlockId === 'hopper' && bs.toggle_bit !== undefined) {
            java.enabled = bs.toggle_bit === 0 ? 'true' : 'false';
            delete java.toggle_bit;
            return;
        }

        // REDSTONE TORCH: unlit_redstone_torch → lit=false
        if (beBlockId === 'unlit_redstone_torch') {
            java.lit = 'false';
            return;
        }
        if (beBlockId === 'redstone_torch') {
            java.lit = 'true';
            return;
        }
    }
}

module.exports = { BlockStateConverters };