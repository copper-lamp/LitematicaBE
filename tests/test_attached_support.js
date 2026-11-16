/**
 * test_attached_support.js — 依附智能打印离线回归（从 easyplace 移植）
 *
 * 两部分：
 *   A. AttachedBlockSupport 纯函数：依附表逐项（红石线/压力板/中继器/火把/观察者/按钮/铁轨/拉杆/双高植物）
 *   B. EasyPlaceManager 集成：先放支撑、依附留到下一轮；支撑已就位直接放；supportCheck 开关；
 *      supportMaxDepth；旋转投影坐标；MEGA；世界 ghost 视为未就位；双高植物异种支撑不覆盖
 *
 * 不依赖 BDS：内存假世界 + 真 EasyPlaceManager（真映射表 / 真状态转换）。
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');

// PlacementLogger / debug 日志都写相对路径：先挪到临时目录，别往仓库里写运行期数据
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'attached-support-')));

const { getAttachedOffsets, DOUBLE_PLANT_BE } = require(path.join(PLUGIN, 'src', 'easyplace', 'AttachedBlockSupport.js'));
const { EasyPlaceManager } = require(path.join(PLUGIN, 'src', 'easyplace', 'EasyPlaceManager.js'));
const { transformPosition } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostRenderer.js'));

let pass = 0;
let fail = 0;

function check(name, fn) {
    try {
        fn();
        pass++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        fail++;
        console.log(`  ❌ ${name}\n     ${e && e.message ? e.message : e}`);
    }
}

// ══════════════════════════════════════════════════════
// A. 依附表纯函数
// ══════════════════════════════════════════════════════
console.log('\n=== A. 依附表 ===');

check('A1. 固定依附：红石线 / 中继器 / 比较器 / 压力板 → 下方 [0,-1,0]', () => {
    for (const name of [
        'minecraft:redstone_wire',
        'minecraft:unpowered_repeater', 'minecraft:powered_repeater',
        'minecraft:unpowered_comparator', 'minecraft:powered_comparator',
        'minecraft:oak_pressure_plate', 'minecraft:stone_pressure_plate',
        'minecraft:light_weighted_pressure_plate',
    ]) {
        const r = getAttachedOffsets(name, {});
        assert.ok(r, `${name} 应命中固定依附表`);
        assert.deepStrictEqual(r.offsets, [[0, -1, 0]], `${name} 偏移错误`);
        assert.strictEqual(r.sameAsSelf, false);
    }
});

check('A2. 火把 5 个朝向（torch_facing_direction，按 BDS"朝向"语义修正）', () => {
    const cases = {
        top: [[0, -1, 0]],
        north: [[0, 0, 1]],   // 朝北 → 贴南面
        south: [[0, 0, -1]],  // 朝南 → 贴北面
        west: [[1, 0, 0]],    // 朝西 → 贴东面
        east: [[-1, 0, 0]],   // 朝东 → 贴西面
    };
    for (const [dir, offsets] of Object.entries(cases)) {
        for (const name of ['minecraft:torch', 'minecraft:redstone_torch', 'minecraft:soul_torch']) {
            const r = getAttachedOffsets(name, { torch_facing_direction: dir });
            assert.ok(r, `${name} ${dir} 应命中`);
            assert.deepStrictEqual(r.offsets, offsets, `${name} ${dir} 偏移错误`);
        }
    }
});

check('A3. 观察者 6 方向（minecraft:facing_direction 字符串）', () => {
    const cases = {
        down: [[0, -1, 0]], up: [[0, 1, 0]],
        north: [[0, 0, -1]], south: [[0, 0, 1]],
        west: [[-1, 0, 0]], east: [[1, 0, 0]],
    };
    for (const [dir, offsets] of Object.entries(cases)) {
        const r = getAttachedOffsets('minecraft:observer', { 'minecraft:facing_direction': dir });
        assert.ok(r, `observer ${dir} 应命中`);
        assert.deepStrictEqual(r.offsets, offsets, `observer ${dir} 偏移错误`);
    }
});

check('A4. 按钮 0-5（facing_direction 数字）', () => {
    const cases = {
        0: [[0, 1, 0]], 1: [[0, -1, 0]],
        2: [[0, 0, 1]], 3: [[0, 0, -1]],
        4: [[-1, 0, 0]], 5: [[1, 0, 0]],
    };
    for (const [v, offsets] of Object.entries(cases)) {
        const r = getAttachedOffsets('minecraft:oak_button', { facing_direction: Number(v) });
        assert.ok(r, `button ${v} 应命中`);
        assert.deepStrictEqual(r.offsets, offsets, `button ${v} 偏移错误`);
    }
});

check('A5. 铁轨 0-9（上坡轨需要下方 + 坡向两个支撑）', () => {
    const flat = getAttachedOffsets('minecraft:rail', { rail_direction: 0 });
    assert.deepStrictEqual(flat.offsets, [[0, -1, 0]], '平轨只需要下方');

    const slopeEast = getAttachedOffsets('minecraft:rail', { rail_direction: 2 });
    assert.deepStrictEqual(slopeEast.offsets, [[0, -1, 0], [-1, 0, 0]], '东上坡需要下方 + 西侧');

    const slopeSouth = getAttachedOffsets('minecraft:golden_rail', { rail_direction: 5 });
    assert.deepStrictEqual(slopeSouth.offsets, [[0, -1, 0], [0, 0, 1]], '南上坡需要下方 + 南侧');
});

check('A6. 拉杆 8 状态（lever_direction，按 BDS"手柄方向"语义修正）', () => {
    assert.deepStrictEqual(getAttachedOffsets('minecraft:lever', { lever_direction: 'east' }).offsets, [[-1, 0, 0]]);
    assert.deepStrictEqual(getAttachedOffsets('minecraft:lever', { lever_direction: 'down_north_south' }).offsets, [[0, -1, 0]]);
    assert.deepStrictEqual(getAttachedOffsets('minecraft:lever', { lever_direction: 'up_east_west' }).offsets, [[0, 1, 0]]);
});

check('A7. 双高植物：上格依附下格，且要求同种（sameAsSelf）', () => {
    for (const n of DOUBLE_PLANT_BE) {
        const full = `minecraft:${n}`;
        const upper = getAttachedOffsets(full, { upper_block_bit: 1 });
        assert.ok(upper, `${full} 上格应依附`);
        assert.deepStrictEqual(upper.offsets, [[0, -1, 0]]);
        assert.strictEqual(upper.sameAsSelf, true, `${full} 必须要求同种支撑`);

        const lower = getAttachedOffsets(full, { upper_block_bit: 0 });
        assert.strictEqual(lower, null, `${full} 下格不应依附`);

        const boolUpper = getAttachedOffsets(full, { upper_block_bit: true });
        assert.ok(boolUpper, `${full} upper_block_bit=true 应归一化为 1`);
    }
});

check('A8. 未知方块 / 状态缺失 → null（不误伤普通方块）', () => {
    assert.strictEqual(getAttachedOffsets('minecraft:stone', {}), null);
    assert.strictEqual(getAttachedOffsets('minecraft:torch', {}), null, '火把缺状态不能猜方向');
    assert.strictEqual(getAttachedOffsets('minecraft:rail', {}), null, '铁轨缺状态不能猜方向');
    assert.strictEqual(getAttachedOffsets('', {}), null);
});

check('A9. Java 状态键兼容（本项目 resolve 后常保留 facing/shape/half）', () => {
    // 火把：Java wall_torch 的 facing（resolve 后可能是 {facing:'south'}），按"朝向"语义支撑在 z-1
    assert.deepStrictEqual(
        getAttachedOffsets('minecraft:torch', { facing: 'south' }).offsets, [[0, 0, -1]]);
    // 铁轨：Java shape=ascending_east → rail_direction 2 → 下方 + 西侧
    assert.deepStrictEqual(
        getAttachedOffsets('minecraft:rail', { shape: 'ascending_east' }).offsets,
        [[0, -1, 0], [-1, 0, 0]]);
    // 拉杆：Java facing=up_x → up_east_west → 上方
    assert.deepStrictEqual(
        getAttachedOffsets('minecraft:lever', { facing: 'up_x' }).offsets, [[0, 1, 0]]);
    // 双高植物：Java half=upper → upper_block_bit 1 → 依附 + sameAsSelf
    const rose = getAttachedOffsets('minecraft:rose_bush', { half: 'upper' });
    assert.ok(rose);
    assert.strictEqual(rose.sameAsSelf, true);
});

// ══════════════════════════════════════════════════════
// B. 集成：先放支撑、再放依附方块
// ══════════════════════════════════════════════════════
console.log('\n=== B. 打印机集成 ===');

// ── 假世界 ──────────────────────────────────────────────
const W = new Map();          // "d:x,y,z" -> {type}
const SETS = [];              // setBlock 调用记录
const KEY = (x, y, z, d) => `${d}:${x},${y},${z}`;

global.logger = { info() {}, warn() {}, error() {}, debug() {} };

global.mc = {
    listen() { return true; },
    getBlock(x, y, z, d) {
        const v = W.get(KEY(x, y, z, d));
        if (!v) return { type: 'minecraft:air', pos: { x, y, z, dimid: d } };
        return { type: v.type, pos: { x, y, z, dimid: d } };
    },
    setBlock(x, y, z, d, type) {
        const name = (type && typeof type === 'object') ? (type.name || type.type) : type;
        SETS.push({ x, y, z, d, type: name });
        W.set(KEY(x, y, z, d), { type: name });
        return true;
    },
    getOnlinePlayers() { return []; },
    getPlayer() { return null; },
    newItem(t, c) { return { type: t, count: c }; },
};

function makePlayer(opts) {
    const o = opts || {};
    const told = [];
    return {
        xuid: o.xuid || 'P1',
        name: o.name || 'Steve',
        gameMode: o.gameMode === undefined ? 1 : o.gameMode,
        pos: { x: o.x === undefined ? 0 : o.x, y: o.y === undefined ? 64 : o.y, z: o.z === undefined ? 0 : o.z, dimid: 0 },
        getInventory() { return { getItem() { return null; }, setItem() {} }; },
        refreshItems() {},
        giveItem() {},
        clearItem() { return 0; },
        tell(msg) { told.push(msg); },
        told,
    };
}

/**
 * @param {{printer?:object, proj?:object, layer?:number}} opts
 */
function makeHarness(opts) {
    const o = opts || {};
    W.clear();
    SETS.length = 0;

    const printer = Object.assign({
        radius: 6, maxPerCycle: 12, budgetMs: 5000,
        placeDelayMs: 0, overwriteReplaceable: true, debug: false,
        supportCheck: true, supportMaxDepth: 3,
    }, o.printer || {});

    global.configManager = {
        get(key, dflt) {
            if (key === 'easyPlace.enabled') return true;
            if (key.startsWith('easyPlace.printer.')) {
                const k = key.slice('easyPlace.printer.'.length);
                return (k in printer) ? printer[k] : dflt;
            }
            return dflt;
        },
    };

    global.ghostRenderer = { markSatisfied() { return true; } };
    global.ghostGuard = {
        isAirLike(block) {
            const t = (block && (block.type || block.name)) || '';
            return !t || t === 'minecraft:air' || String(t).startsWith('lit:g_');
        },
        forget() { return true; },
    };

    const projection = o.proj || {
        id: 'proj-1', name: '测试投影',
        position: { x: 0, y: 64, z: 0 },
        dimensions: { x: 8, y: 8, z: 8 },
        rotation: 0, mirrorX: false, mirrorZ: false,
        blockIndex: new Map(),
        blocks: [],
        isMega: false,
    };
    if (!projection.blockIndex) projection.blockIndex = new Map();

    const active = { projection, renderLayer: o.layer === undefined ? -1 : o.layer };
    const projManager = { getActiveProjectionByPlayer() { return active; } };

    const mgr = new EasyPlaceManager(projManager, {}, null);
    mgr.attachGhostChecks({ isAirLike: (b) => global.ghostGuard.isAirLike(b) });
    mgr.placementLogger = { logSuccess() {}, logFailure() {} };

    const player = makePlayer();
    return { mgr, projection, player, active };
}

/** 投影方块（pos 为投影内相对坐标） */
const blk = (x, y, z, name, state) => ({
    pos: [x, y, z],
    name: name || 'minecraft:stone',
    state: state || {},
});

const sname = (type) => String(type || '').replace(/^minecraft:/, '');

check('B1. 火把（墙上）：墙未放 → 第一轮先放墙、火把 pending；第二轮火把落下', () => {
    const h = makeHarness();
    // 火把朝南 → 支撑在 z-1（北侧）；结构放在投影内部，玩家在火把南边（火把比墙近）
    h.player.pos = { x: 0, y: 64, z: 6, dimid: 0 };
    h.projection.blocks = [
        blk(1, 0, 5, 'minecraft:torch', { torch_facing_direction: 'south' }),
        blk(1, 0, 4, 'minecraft:stone'),
    ];

    h.mgr.processFastPlace(h.player);
    assert.deepStrictEqual(SETS.map((s) => [s.x, s.y, s.z, sname(s.type)]),
        [[1, 64, 4, 'stone']], '第一轮必须只放支撑墙');
    assert.strictEqual(h.mgr.printerStats.pendingSupport, 1, '火把应计为 pendingSupport');

    h.mgr.processFastPlace(h.player);
    assert.ok(SETS.some((s) => s.x === 1 && s.y === 64 && s.z === 5 && sname(s.type) === 'torch'),
        '第二轮支撑就位后必须放下火把');
});

check('B2. 支撑已就位：第一轮直接放依附方块（不再 pending）', () => {
    const h = makeHarness();
    h.player.pos = { x: 0, y: 64, z: 6, dimid: 0 };
    h.projection.blocks = [
        blk(1, 0, 5, 'minecraft:torch', { torch_facing_direction: 'south' }),
        blk(1, 0, 4, 'minecraft:stone'),
    ];
    W.set(KEY(1, 64, 4, 0), { type: 'minecraft:stone' });   // 墙已经在世界

    h.mgr.processFastPlace(h.player);
    assert.ok(SETS.some((s) => s.x === 1 && s.z === 5 && sname(s.type) === 'torch'),
        '支撑已就位时火把应第一轮就放下');
});

check('B3. supportCheck=false：退化为旧行为（不检查支撑，直接放）', () => {
    const h = makeHarness({ printer: { supportCheck: false } });
    h.player.pos = { x: 0, y: 64, z: 6, dimid: 0 };
    h.projection.blocks = [
        blk(1, 0, 5, 'minecraft:torch', { torch_facing_direction: 'south' }),
        blk(1, 0, 4, 'minecraft:stone'),
    ];

    h.mgr.processFastPlace(h.player);
    assert.ok(SETS.some((s) => s.x === 1 && s.z === 5 && sname(s.type) === 'torch'),
        '关闭依附检查后应直接放火把');
    assert.strictEqual(h.mgr.printerStats.pendingSupport, 0);
});

check('B4. 红石线在投影底层（支撑越界）：直接放，不卡 pending', () => {
    const h = makeHarness();
    // 红石线在 y=0，下方支撑在投影外（真实世界的地面）→ 没有投影内支撑定义，直接放
    h.projection.blocks = [
        blk(1, 0, 0, 'minecraft:redstone_wire'),
    ];

    h.mgr.processFastPlace(h.player);
    assert.ok(SETS.some((s) => s.x === 1 && s.y === 64 && s.z === 0 && sname(s.type) === 'redstone_wire'),
        '投影内没有支撑定义时应直接放');
    assert.strictEqual(h.mgr.printerStats.pendingSupport, 0);
});

check('B4b. 红石线（投影内 y=1，玩家在上方）：第一轮先放下方石头', () => {
    const h = makeHarness();
    h.player.pos = { x: 0, y: 66, z: 0, dimid: 0 };   // 玩家站在红石线上方 → 红石线比支撑近
    h.projection.blocks = [
        blk(1, 1, 0, 'minecraft:redstone_wire'),
        blk(1, 0, 0, 'minecraft:stone'),
    ];

    h.mgr.processFastPlace(h.player);
    assert.deepStrictEqual(SETS.map((s) => [s.x, s.y, s.z, sname(s.type)]),
        [[1, 64, 0, 'stone']], '第一轮先放下方支撑石头');
    assert.strictEqual(h.mgr.printerStats.pendingSupport, 1);

    h.mgr.processFastPlace(h.player);
    assert.ok(SETS.some((s) => s.x === 1 && s.y === 65 && s.z === 0 && sname(s.type) === 'redstone_wire'),
        '第二轮放红石线');
});

check('B5. 双高植物：上格等下格同种支撑（同一轮内按距离下格先放，上格随后）', () => {
    const h = makeHarness();
    h.projection.blocks = [
        blk(1, 0, 0, 'minecraft:rose_bush', { half: 'lower' }),
        blk(1, 1, 0, 'minecraft:rose_bush', { half: 'upper' }),
    ];

    h.mgr.processFastPlace(h.player);
    const at = (x, y, z) => SETS.find((s) => s.x === x && s.y === y && s.z === z);
    assert.ok(at(1, 64, 0), '下格必须先放');
    assert.ok(at(1, 65, 0), '下格就位后上格应同轮放下');
    assert.strictEqual(sname(at(1, 65, 0).type), 'rose_bush');
});

check('B6. 双高植物：世界下格是异种方块 → 上格 pending，且不覆盖玩家方块', () => {
    const h = makeHarness();
    h.projection.blocks = [
        blk(1, 0, 0, 'minecraft:rose_bush', { half: 'lower' }),
        blk(1, 1, 0, 'minecraft:rose_bush', { half: 'upper' }),
    ];
    W.set(KEY(1, 64, 0, 0), { type: 'minecraft:stone' });   // 玩家放了个石头当"下格"

    h.mgr.processFastPlace(h.player);
    assert.strictEqual(SETS.length, 0, '异种支撑：上格不能放，也不能覆盖石头');
    assert.strictEqual(h.mgr.printerStats.pendingSupport, 1);
});

check('B7. 世界支撑是 ghost：视为未就位，先放支撑', () => {
    const h = makeHarness();
    h.player.pos = { x: 0, y: 64, z: 6, dimid: 0 };
    h.projection.blocks = [
        blk(1, 0, 5, 'minecraft:torch', { torch_facing_direction: 'south' }),
        blk(1, 0, 4, 'minecraft:stone'),
    ];
    W.set(KEY(1, 64, 4, 0), { type: 'lit:g_stone' });   // 支撑位只有 ghost

    h.mgr.processFastPlace(h.player);
    assert.ok(SETS.some((s) => s.x === 1 && s.z === 4 && sname(s.type) === 'stone'),
        'ghost 不算真实支撑，必须先放墙');
});

check('B8. 旋转 90°：支撑的世界坐标走 transformPosition（不是 cand.w + offset）', () => {
    const proj = {
        id: 'rot', name: '旋转投影',
        position: { x: 100, y: 64, z: 200 },
        dimensions: { x: 8, y: 8, z: 8 },
        rotation: 90, mirrorX: false, mirrorZ: false,
        blockIndex: new Map(), blocks: [], isMega: false,
    };
    const h = makeHarness({ proj });
    h.projection.blocks = [
        blk(1, 0, 5, 'minecraft:torch', { torch_facing_direction: 'south' }),
        blk(1, 0, 4, 'minecraft:stone'),
    ];
    h.player.pos = { x: 100, y: 64, z: 206, dimid: 0 };

    h.mgr.processFastPlace(h.player);
    const expectWall = transformPosition([1, 0, 4], proj);
    assert.ok(SETS.some((s) => s.x === expectWall.x && s.y === expectWall.y && s.z === expectWall.z),
        `支撑应放在 transformPosition([1,0,4]) = (${expectWall.x},${expectWall.y},${expectWall.z})`);
});

check('B9. MEGA 投影：支撑格查询走 megaManager.getBlockAt', () => {
    const h = makeHarness();
    h.player.pos = { x: 0, y: 64, z: 6, dimid: 0 };
    h.projection.isMega = true;
    h.projection.schematicId = 'mega_x';
    h.projection.blocks = [blk(1, 0, 5, 'minecraft:torch', { torch_facing_direction: 'south' })];

    const asked = [];
    h.mgr.megaManager = {
        getBlocksNear() {
            return [blk(1, 0, 5, 'minecraft:torch', { torch_facing_direction: 'south' })];
        },
        getBlockAt(id, x, y, z) {
            asked.push([x, y, z]);
            if (x === 1 && y === 0 && z === 4) return blk(1, 0, 4, 'minecraft:stone');
            return null;
        },
    };

    h.mgr.processFastPlace(h.player);
    assert.ok(asked.some(([x, y, z]) => x === 1 && y === 0 && z === 4), '必须向 megaManager 查支撑格');
    assert.ok(SETS.some((s) => s.x === 1 && s.z === 4 && sname(s.type) === 'stone'),
        'MEGA 下也要先放支撑');
});

check('B10. supportMaxDepth：深度到顶时只 pending、不继续展开', () => {
    const h = makeHarness();
    h.player.pos = { x: 0, y: 64, z: 6, dimid: 0 };
    const cand = {
        block: blk(1, 0, 5, 'minecraft:torch', { torch_facing_direction: 'south' }),
        w: { x: 1, y: 64, z: 5 },
        rel: { x: 1, y: 0, z: 5 },
        key: '1,64,5',
        distSquared: 1,
    };
    h.projection.blocks = [
        blk(1, 0, 5, 'minecraft:torch', { torch_facing_direction: 'south' }),
        blk(1, 0, 4, 'minecraft:stone'),
    ];

    // 直接调网关：supportMaxDepth=0 表示当前深度已到顶
    const r = h.mgr._handleAttachment(
        h.player, cand, h.projection, 0,
        { supportCheck: true, supportMaxDepth: 0 }, true, 0
    );
    assert.deepStrictEqual(r, { placed: false }, '到顶后本轮只标记 pending');
    assert.strictEqual(SETS.length, 0, '不能放支撑');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
