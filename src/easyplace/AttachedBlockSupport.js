'use strict';

/**
 * 依附方块分析器（从 easyplace 移植的依附表 + 判定逻辑）。
 *
 * 只做纯数据 + 纯函数：给定方块名/状态，返回"该方块需要先放哪个方向的支撑"。
 * 不碰 mc / 投影 / 世界 —— 何时放、怎么放由 EasyPlaceManager 决定。
 *
 * 来源：MCBEserver plugins/easyplace/easyplace.js
 *   BLOCK_ATTACHED_OFFSET / STATES_TO_ATTACHED_OFFSET / BLOCK_STATES_TO_ATTACHED
 *
 * 偏移语义：`[dx, dy, dz]` 是**支撑方块相对依附方块的偏移**（与原插件一致）。
 *   例：火把 top → 支撑在 [0,-1,0]（火把下方）；墙上的火把 → 支撑在墙的方向。
 *
 * 状态键兼容：
 *   本项目 `_resolveTargetBlock` 对一部分方块保留的是 **Java 状态键**（`facing` / `shape` /
 *   `half`），而不是基岩键（`torch_facing_direction` / `rail_direction` / `upper_block_bit`）。
 *   所以每个方块都登记了"BE 键 + Java 键"两组别名，按出现顺序取第一个。
 *   方向语义以 easyplace 原表为准（表本身未改）。
 *
 * 双高植物（rose_bush / sunflower / lilac / peony / large_fern / tall_grass）也并入本表：
 *   上格（upper_block_bit=1 / half=upper）依附 [0,-1,0] 且要求支撑是**同种下格**（sameAsSelf）。
 *   下格本身不依附，正常放置。
 */

// ============================================================================
// 状态值 → 依附偏移（原插件 STATES_TO_ATTACHED_OFFSET）
// ============================================================================

/**
 * 火把 `torch_facing_direction`（top/north/south/west/east）。
 *
 * ⚠️ 方向语义（2026-11-16 真机实测修正）：
 *   BDS 1.21 的 `torch_facing_direction` 是"**火把朝向**"：`south` = 火把朝南、贴在**北面**，
 *   支撑在朝向的**反方向**（z-1）。easyplace 原表按"贴附面"语义写（south → 支撑 z+1），
 *   直接搬过来会把墙放到火把背面 → BDS 立即破坏火把 → 打印机循环重放。
 *   竖直 `top` 不受影响（支撑永远在下方）。
 */
const TORCH_FACING_TO_OFFSET = {
    top:   [[0, -1, 0]],
    north: [[0, 0, 1]],   // 朝北 → 贴在南面（z+1）
    south: [[0, 0, -1]],  // 朝南 → 贴在北面（z-1）
    west:  [[1, 0, 0]],   // 朝西 → 贴在东面（x+1）
    east:  [[-1, 0, 0]],  // 朝东 → 贴在西面（x-1）
};

/**
 * 观察者 `minecraft:facing_direction`（字符串，语义 = Java facing）。
 * 与 BlockStateConverters 的 observer 分支一致：`{"minecraft:facing_direction": "west"}`。
 */
const OBSERVER_FACING_TO_OFFSET = {
    down:  [[0, -1, 0]],
    up:    [[0, 1, 0]],
    north: [[0, 0, -1]],
    south: [[0, 0, 1]],
    west:  [[-1, 0, 0]],
    east:  [[1, 0, 0]],
};

/**
 * 按钮 `facing_direction`（数字 0-5）。
 * 语义是"按钮突出的方向"：0=朝下（贴天花板）→ 支撑在上方；1=朝上（贴地面）→ 支撑在下方；
 * 2=北 / 3=南 / 4=西 / 5=东（与原插件表一致）。
 */
const BUTTON_FACING_TO_OFFSET = {
    0: [[0, 1, 0]],
    1: [[0, -1, 0]],
    2: [[0, 0, 1]],
    3: [[0, 0, -1]],
    4: [[-1, 0, 0]],
    5: [[1, 0, 0]],
};

/**
 * 铁轨 `rail_direction`（0-9）：
 *   0 南北平轨 / 1 东西平轨 / 2 东上坡 / 3 西上坡 / 4 北上坡 / 5 南上坡 / 6-9 转弯。
 * 上坡轨除了下方支撑，坡向那一侧也要有方块（与原插件一致）。
 */
const RAIL_DIRECTION_TO_OFFSET = [
    [[0, -1, 0]],
    [[0, -1, 0]],
    [[0, -1, 0], [-1, 0, 0]],
    [[0, -1, 0], [1, 0, 0]],
    [[0, -1, 0], [0, 0, -1]],
    [[0, -1, 0], [0, 0, 1]],
    [[0, -1, 0]],
    [[0, -1, 0]],
    [[0, -1, 0]],
    [[0, -1, 0]],
];

/** Java 铁轨 `shape` → `rail_direction` 数字（与 BlockStateConverters.JAVA_RAIL_SHAPE 同序） */
const RAIL_SHAPE_TO_DIRECTION = {
    north_south: 0, east_west: 1,
    ascending_east: 2, ascending_west: 3, ascending_north: 4, ascending_south: 5,
    south_east: 6, south_west: 7, north_west: 8, north_east: 9,
};

/**
 * 拉杆 `lever_direction`（8 种：手柄指向）。
 * 与火把同理：这是"手柄方向"，支撑在反方向（手柄朝南 → 拉杆贴在北面，支撑 z-1）。
 * easyplace 原表按"贴附面"语义写，水平四向是反的，此处已按 BDS 1.21 修正。
 */
const LEVER_DIRECTION_TO_OFFSET = {
    down_east_west:   [[0, -1, 0]],
    east:             [[-1, 0, 0]],  // 手柄朝东 → 贴西面（x-1）
    west:             [[1, 0, 0]],   // 手柄朝西 → 贴东面（x+1）
    south:            [[0, 0, -1]],  // 手柄朝南 → 贴北面（z-1）
    north:            [[0, 0, 1]],   // 手柄朝北 → 贴南面（z+1）
    up_north_south:   [[0, 1, 0]],
    up_east_west:     [[0, 1, 0]],
    down_north_south: [[0, -1, 0]],
};

/** Java 拉杆 `facing` → BE `lever_direction`（与 BlockStateConverters.LEVER_JAVA_TO_BE 一致） */
const LEVER_JAVA_FACING_TO_BE = {
    north: 'north', south: 'south', east: 'east', west: 'west',
    up_x: 'up_east_west', up_z: 'up_north_south',
    down_x: 'down_east_west', down_z: 'down_north_south',
};

// ============================================================================
// 固定依附：与状态无关（原插件 BLOCK_ATTACHED_OFFSET）
// ============================================================================

const FIXED_ATTACHED = {
    'minecraft:unpowered_repeater': [[0, -1, 0]],
    'minecraft:powered_repeater':   [[0, -1, 0]],
    'minecraft:unpowered_comparator': [[0, -1, 0]],
    'minecraft:powered_comparator':   [[0, -1, 0]],
    'minecraft:redstone_wire': [[0, -1, 0]],

    // 压力板：全部 16 色 + 木/石/金/铁
    'minecraft:acacia_pressure_plate':      [[0, -1, 0]],
    'minecraft:bamboo_pressure_plate':      [[0, -1, 0]],
    'minecraft:birch_pressure_plate':       [[0, -1, 0]],
    'minecraft:cherry_pressure_plate':      [[0, -1, 0]],
    'minecraft:crimson_pressure_plate':     [[0, -1, 0]],
    'minecraft:dark_oak_pressure_plate':    [[0, -1, 0]],
    'minecraft:heavy_weighted_pressure_plate': [[0, -1, 0]],
    'minecraft:jungle_pressure_plate':      [[0, -1, 0]],
    'minecraft:light_weighted_pressure_plate': [[0, -1, 0]],
    'minecraft:mangrove_pressure_plate':    [[0, -1, 0]],
    'minecraft:oak_pressure_plate':         [[0, -1, 0]],
    'minecraft:pale_oak_pressure_plate':    [[0, -1, 0]],
    'minecraft:polished_blackstone_pressure_plate': [[0, -1, 0]],
    'minecraft:spruce_pressure_plate':      [[0, -1, 0]],
    'minecraft:stone_pressure_plate':       [[0, -1, 0]],
    'minecraft:warped_pressure_plate':      [[0, -1, 0]],
};

// ============================================================================
// 状态依赖依附（原插件 BLOCK_STATES_TO_ATTACHED）
//   keys: 依次尝试的状态键（BE 键在前，Java 键在后）
//   mapValue: 把 Java 状态值折算成表键（仅铁轨/拉杆/双高植物需要）
// ============================================================================

const STATE_ATTACHED = {
    'minecraft:observer': {
        keys: ['minecraft:facing_direction', 'facing'],
        table: OBSERVER_FACING_TO_OFFSET,
    },

    'minecraft:torch': {
        keys: ['torch_facing_direction', 'facing'],
        table: TORCH_FACING_TO_OFFSET,
    },
    'minecraft:redstone_torch': {
        keys: ['torch_facing_direction', 'facing'],
        table: TORCH_FACING_TO_OFFSET,
    },
    // 熄灭的红石火把（_resolveTargetBlock 把 lit=false 改成这个 BE 名）同样要依附
    'minecraft:unlit_redstone_torch': {
        keys: ['torch_facing_direction', 'facing'],
        table: TORCH_FACING_TO_OFFSET,
    },
    'minecraft:soul_torch': {
        keys: ['torch_facing_direction', 'facing'],
        table: TORCH_FACING_TO_OFFSET,
    },

    'minecraft:rail': {
        keys: ['rail_direction', 'shape'],
        table: RAIL_DIRECTION_TO_OFFSET,
        mapValue: (key, v) => {
            if (key === 'shape') {
                const idx = RAIL_SHAPE_TO_DIRECTION[v];
                return idx === undefined ? v : idx;
            }
            return v;
        },
    },
    'minecraft:golden_rail': {
        keys: ['rail_direction', 'shape'],
        table: RAIL_DIRECTION_TO_OFFSET,
        mapValue: (key, v) => {
            if (key === 'shape') {
                const idx = RAIL_SHAPE_TO_DIRECTION[v];
                return idx === undefined ? v : idx;
            }
            return v;
        },
    },
    'minecraft:detector_rail': {
        keys: ['rail_direction', 'shape'],
        table: RAIL_DIRECTION_TO_OFFSET,
        mapValue: (key, v) => {
            if (key === 'shape') {
                const idx = RAIL_SHAPE_TO_DIRECTION[v];
                return idx === undefined ? v : idx;
            }
            return v;
        },
    },
    'minecraft:activator_rail': {
        keys: ['rail_direction', 'shape'],
        table: RAIL_DIRECTION_TO_OFFSET,
        mapValue: (key, v) => {
            if (key === 'shape') {
                const idx = RAIL_SHAPE_TO_DIRECTION[v];
                return idx === undefined ? v : idx;
            }
            return v;
        },
    },

    'minecraft:oak_button':               { keys: ['facing_direction'], table: BUTTON_FACING_TO_OFFSET },
    'minecraft:spruce_button':            { keys: ['facing_direction'], table: BUTTON_FACING_TO_OFFSET },
    'minecraft:birch_button':             { keys: ['facing_direction'], table: BUTTON_FACING_TO_OFFSET },
    'minecraft:jungle_button':            { keys: ['facing_direction'], table: BUTTON_FACING_TO_OFFSET },
    'minecraft:acacia_button':            { keys: ['facing_direction'], table: BUTTON_FACING_TO_OFFSET },
    'minecraft:dark_oak_button':          { keys: ['facing_direction'], table: BUTTON_FACING_TO_OFFSET },
    'minecraft:mangrove_button':          { keys: ['facing_direction'], table: BUTTON_FACING_TO_OFFSET },
    'minecraft:cherry_button':            { keys: ['facing_direction'], table: BUTTON_FACING_TO_OFFSET },
    'minecraft:bamboo_button':            { keys: ['facing_direction'], table: BUTTON_FACING_TO_OFFSET },
    'minecraft:pale_oak_button':          { keys: ['facing_direction'], table: BUTTON_FACING_TO_OFFSET },
    'minecraft:crimson_button':           { keys: ['facing_direction'], table: BUTTON_FACING_TO_OFFSET },
    'minecraft:warped_button':            { keys: ['facing_direction'], table: BUTTON_FACING_TO_OFFSET },
    'minecraft:stone_button':             { keys: ['facing_direction'], table: BUTTON_FACING_TO_OFFSET },
    'minecraft:polished_blackstone_button': { keys: ['facing_direction'], table: BUTTON_FACING_TO_OFFSET },

    'minecraft:lever': {
        keys: ['lever_direction', 'facing'],
        table: LEVER_DIRECTION_TO_OFFSET,
        mapValue: (key, v) => {
            if (key === 'facing') {
                return LEVER_JAVA_FACING_TO_BE[v] !== undefined ? LEVER_JAVA_FACING_TO_BE[v] : v;
            }
            return v;
        },
    },
};

// ============================================================================
// 双高植物：并入依附表
// ============================================================================

/** 二高植物（double_plant 族）的 BE 短名（与 EasyPlaceManager 原 DOUBLE_PLANT_BE 一致） */
const DOUBLE_PLANT_BE = new Set([
    'rose_bush', 'sunflower', 'lilac', 'peony', 'large_fern', 'tall_grass',
]);

for (const n of DOUBLE_PLANT_BE) {
    // 上格（upper_block_bit=1 / half=upper）必须有同种下格支撑；下格（0/lower/缺省）不依附。
    STATE_ATTACHED[`minecraft:${n}`] = {
        keys: ['upper_block_bit', 'half'],
        table: { 1: [[0, -1, 0]] },
        mapValue: (key, v) => {
            if (key === 'half') return v === 'upper' ? 1 : 0;
            return v;
        },
    };
}

/** 要求支撑是"同种方块"的依附（双高植物上格） */
const SAME_AS_SELF = DOUBLE_PLANT_BE;

// ============================================================================
// 判定
// ============================================================================

/** 去掉命名空间并小写：`minecraft:oak_button` → `oak_button` */
function shortNameOf(name) {
    if (!name || typeof name !== 'string') return '';
    const i = name.indexOf(':');
    return (i >= 0 ? name.slice(i + 1) : name).toLowerCase();
}

/** 状态值归一化：`true`→1、`false`→0，其余原样（数字/字符串） */
function normalizeStateValue(v) {
    if (v === true) return 1;
    if (v === false) return 0;
    return v;
}

/**
 * 查询方块是否依附、依附在哪些方向。
 *
 * @param {string} beName   方块名（带不带 `minecraft:` 前缀均可；Java/BE 名都接受，按短名查表）
 * @param {object} states   方块状态（本项目 `_resolveTargetBlock(...).states` 同口径）
 * @returns {null | {offsets:number[][], sameAsSelf:boolean, stateName?:string, stateValue?:any}}
 *   null = 不依附（或状态缺失无法判定）
 */
function getAttachedOffsets(beName, states) {
    if (!beName || typeof beName !== 'string') return null;

    const full = beName.includes(':') ? beName.toLowerCase() : `minecraft:${beName.toLowerCase()}`;
    const short = shortNameOf(full);
    const st = states || {};

    // 1) 固定依附
    const fixed = FIXED_ATTACHED[full] || FIXED_ATTACHED[`minecraft:${short}`];
    if (fixed) {
        return { offsets: fixed, sameAsSelf: false };
    }

    // 2) 状态依赖依附
    const spec = STATE_ATTACHED[full] || STATE_ATTACHED[`minecraft:${short}`];
    if (!spec) return null;

    for (const key of spec.keys) {
        const rawValue = st[key];
        if (rawValue === undefined) continue;

        let value = normalizeStateValue(rawValue);
        if (typeof spec.mapValue === 'function') value = spec.mapValue(key, value);

        const offsets = spec.table[value];
        if (!offsets) return null;

        return {
            offsets,
            sameAsSelf: SAME_AS_SELF.has(short),
            stateName: key,
            stateValue: value,
        };
    }

    return null;   // 所有别名键都缺失
}

module.exports = {
    getAttachedOffsets,
    DOUBLE_PLANT_BE,
    FIXED_ATTACHED,
    STATE_ATTACHED,
};
