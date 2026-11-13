/**
 * test_double_plant.js — 二高植物（double_plant 族）放置回归
 *
 * 事故形态（2026-11-13 真机）：
 *   投影打印机 / 轻松放置放二高植物（玫瑰丛、向日葵、丁香、牡丹、大蕨、高草）时，
 *   上格（Java `half=upper`）无法放置、反复被 BDS 破坏成凋落物，形成死循环。
 *
 * 根因（两处，互为因果）：
 *   1. `BlockStateConverters.convertJavaToBedrock` 未把二高植物的 Java `half`
 *      转成基岩 `upper_block_bit`。投影里的上格被解析成 BE 状态 `{half:'upper'}`，
 *      BDS 不认 `half` 键 → 放成默认**下格**（upper_block_bit=0）→ 下方无固体支撑
 *      → BDS 立即把植物破坏成凋落物 → 打印机每轮重试 → 死循环 + 无限凋落物。
 *   2. 放置顺序：即使状态转换正确，若上格先于下格被尝试（玩家在高处 / 距离更近），
 *      上格放到未就绪位置同样被破坏。必须"上格等下格就位"。
 *
 * 覆盖（不依赖 BDS，用真映射表 / 真状态转换 / 真 EasyPlaceManager）：
 *   1. Java half=upper/lower → BE upper_block_bit=1/0（正向）
 *   2. BE upper_block_bit → Java half（反向，与 .mcstructure 读回/保存对称）
 *   3. _resolveTargetBlock 端到端：投影上格解析出 upper_block_bit=1
 *   4. 打印机：上格先被尝试时跳过（pending），不破坏；下格先放；下一轮上格再放
 *   5. 死循环回归：模拟 BDS"上格无下格支撑即破坏"，连续多轮不出现被拒绝的放置
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');

// PlacementLogger / debug 日志都用相对路径：先把 cwd 挪到临时目录，避免污染仓库。
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'double-plant-')));

const { BlockStateConverters } = require(path.join(PLUGIN, 'src', 'mappings', 'BlockStateConverters.js'));
const { EasyPlaceManager } = require(path.join(PLUGIN, 'src', 'easyplace', 'EasyPlaceManager.js'));

const DOUBLE_PLANT_BE = new Set([
    'rose_bush', 'sunflower', 'lilac', 'peony', 'large_fern', 'tall_grass',
]);

let pass = 0;
let fail = 0;
function check(name, fn) {
    try { fn(); pass++; console.log(`  ✅ ${name}`); }
    catch (e) { fail++; console.log(`  ❌ ${name}\n     ${e && e.message ? e.message : e}`); }
}

// ── 假世界 + 模拟 BDS 对二高植物的支撑检查 ──────────────────
// BDS 行为：放 double_plant 上格（upper_block_bit=1）时，若 y-1 不是同种下格，
// 立即破坏（这里用"拒绝写入 + blocked 标记"表达，等价于每轮重试的死循环）。
const W = new Map();          // "d:x,y,z" -> {type, upper_block_bit}
const SETS = [];              // setBlock 调用记录
const KEY = (x, y, z, d) => `${d}:${x},${y},${z}`;
const short = (n) => String(n).includes(':') ? String(n).split(':')[1] : String(n);

global.logger = { info() {}, warn() {}, error() {}, debug() {} };

global.mc = {
    listen() { return true; },
    getBlock(x, y, z, d) {
        const v = W.get(KEY(x, y, z, d));
        if (!v) return { type: 'minecraft:air', states: {}, pos: { x, y, z, dimid: d } };
        return { type: v.type, states: v.upper_block_bit !== undefined ? { upper_block_bit: v.upper_block_bit } : {}, pos: { x, y, z, dimid: d } };
    },
    setBlock(x, y, z, d, type) {
        const name = (type && typeof type === 'object') ? type.name : type;
        const states = (type && typeof type === 'object' && type.states) ? type.states : {};
        const sname = short(name);
        const isUpper = states.upper_block_bit === 1 || states.upper_block_bit === true;
        // 模拟 BDS 支撑检查：上格下方必须是同种下格
        if (DOUBLE_PLANT_BE.has(sname) && isUpper) {
            const below = W.get(KEY(x, y - 1, z, d));
            const belowName = below ? short(below.type) : '';
            const belowUpper = below && (below.upper_block_bit === 1);
            if (belowName !== sname || belowUpper) {
                SETS.push({ x, y, z, d, type: name, states, blocked: true });
                return false;
            }
        }
        SETS.push({ x, y, z, d, type: name, states, blocked: false });
        W.set(KEY(x, y, z, d), { type: name, upper_block_bit: isUpper ? 1 : 0 });
        return true;
    },
    getOnlinePlayers() { return []; },
    getPlayer() { return null; },
    newItem(t, c) { return { type: t, count: c }; },
};

function makePlayer(opts) {
    const o = opts || {};
    return {
        xuid: o.xuid || 'P1',
        name: o.name || 'Steve',
        gameMode: o.gameMode === undefined ? 1 : o.gameMode,
        pos: { x: o.x === undefined ? 0 : o.x, y: o.y === undefined ? 64 : o.y, z: o.z === undefined ? 0 : o.z, dimid: 0 },
        tell() {},
        getInventory() { return { getItem() { return null; }, setItem() {} }; },
        refreshItems() {},
        giveItem() {},
        clearItem() { return 0; },
    };
}

function makeHarness(playerPos) {
    W.clear();
    SETS.length = 0;
    global.configManager = {
        get(key, dflt) {
            if (key === 'easyPlace.enabled') return true;
            if (key.startsWith('easyPlace.printer.')) {
                const k = key.slice('easyPlace.printer.'.length);
                const map = { radius: 5, maxPerCycle: 12, budgetMs: 5000, placeDelayMs: 0, overwriteReplaceable: true, debug: false };
                return k in map ? map[k] : dflt;
            }
            return dflt;
        },
    };
    global.ghostRenderer = { markSatisfied() { return true; } };
    global.ghostGuard = {
        isAirLike(b) {
            const t = b && (b.type || b.name) || '';
            return !t || t === 'minecraft:air' || String(t).startsWith('lit:g_');
        },
        forget() { return true; },
    };
    const projection = {
        id: 'proj-1', name: '测试投影',
        position: { x: 0, y: 64, z: 0 },
        dimensions: { x: 8, y: 8, z: 8 },
        rotation: 0, mirrorX: false, mirrorZ: false,
        blocks: [], isMega: false,
    };
    const projManager = {
        getActiveProjectionByPlayer() { return { projection, renderLayer: -1 }; },
    };
    const mgr = new EasyPlaceManager(projManager, {}, null);
    mgr.attachGhostChecks({ isAirLike: (b) => global.ghostGuard.isAirLike(b) });
    mgr.placementLogger = { logSuccess() {}, logFailure() {} };
    return { mgr, projection, player: makePlayer(playerPos) };
}

/** 投影方块（pos 为投影内相对坐标；state 为 Java 状态） */
const blk = (x, y, z, name, state) => ({ pos: [x, y, z], name: name || 'minecraft:stone', state: state || {} });

// ══════════════════════════════════════════════════════
console.log('\n=== 二高植物状态转换 ===');

const conv = new BlockStateConverters();

check('1a. rose_bush half=upper → BE upper_block_bit=1（无 half 残留）', () => {
    const be = conv.convertJavaToBedrock('minecraft:rose_bush', { half: 'upper' });
    assert.strictEqual(be.upper_block_bit, 1);
    assert.strictEqual(be.half, undefined, 'half 不得残留进 NBT（BDS 不认这个键）');
});

check('1b. rose_bush half=lower → BE upper_block_bit=0', () => {
    const be = conv.convertJavaToBedrock('minecraft:rose_bush', { half: 'lower' });
    assert.strictEqual(be.upper_block_bit, 0);
    assert.strictEqual(be.half, undefined);
});

check('1c. 全部 double_plant 族 half 都转 upper_block_bit', () => {
    for (const n of ['rose_bush', 'sunflower', 'lilac', 'peony', 'large_fern', 'tall_grass']) {
        const up = conv.convertJavaToBedrock(`minecraft:${n}`, { half: 'upper' });
        const lo = conv.convertJavaToBedrock(`minecraft:${n}`, { half: 'lower' });
        assert.strictEqual(up.upper_block_bit, 1, `${n} upper`);
        assert.strictEqual(lo.upper_block_bit, 0, `${n} lower`);
        assert.strictEqual(up.half, undefined, `${n} 无 half 残留`);
    }
});

check('2a. BE upper_block_bit=1 → Java half=upper（反向）', () => {
    const j = conv.convertBedrockToJava('rose_bush', { upper_block_bit: 1 }, 'minecraft:rose_bush');
    assert.strictEqual(j.half, 'upper');
});

check('2b. BE upper_block_bit=0 → Java half=lower（反向）', () => {
    const j = conv.convertBedrockToJava('rose_bush', { upper_block_bit: 0 }, 'minecraft:rose_bush');
    assert.strictEqual(j.half, 'lower');
});

check('2c. 反向对完整 BE 名同样生效', () => {
    const j = conv.convertBedrockToJava('minecraft:rose_bush', { upper_block_bit: 1 }, 'minecraft:rose_bush');
    assert.strictEqual(j.half, 'upper');
});

// ══════════════════════════════════════════════════════
console.log('\n=== 打印机放置二高植物 ===');

check('3. _resolveTargetBlock：投影上格解析出 upper_block_bit=1', () => {
    const h = makeHarness();
    const t = h.mgr._resolveTargetBlock('minecraft:rose_bush', { half: 'upper' });
    assert.strictEqual(t.name, 'rose_bush');
    assert.strictEqual(t.states.upper_block_bit, 1);
    assert.strictEqual(t.states.half, undefined);
});

check('4. 上格先被尝试（玩家在高处）→ 跳过不放，等下一轮下格就位', () => {
    // 投影：下格 rel(1,0,0)=w(1,64,0) half=lower；上格 rel(1,1,0)=w(1,65,0) half=upper
    // 玩家 y=65 → 上格 dy=0 先被处理，下格 dy=1 后处理
    const h = makeHarness({ x: 1, y: 65, z: 0 });
    h.projection.blocks = [
        blk(1, 0, 0, 'minecraft:rose_bush', { half: 'lower' }),
        blk(1, 1, 0, 'minecraft:rose_bush', { half: 'upper' }),
    ];
    W.set(KEY(1, 63, 0, 0), { type: 'minecraft:stone' });   // 地面

    h.mgr.processFastPlace(h.player);

    // 第一轮只能放下格（y=64）；上格必须被跳过，绝不能先放到未就绪位置
    assert.strictEqual(SETS.length, 1, '第一轮只该放下格');
    assert.deepStrictEqual([SETS[0].x, SETS[0].y, SETS[0].z], [1, 64, 0]);
    assert.strictEqual(SETS[0].type, 'rose_bush');
    assert.strictEqual(SETS[0].blocked, false, '下格不应被 BDS 拒绝');
    assert.strictEqual(W.get(KEY(1, 65, 0, 0)), undefined, '上格位置不得有方块（上格还没放）');

    // 第二轮：下格已就位 → 上格放
    h.mgr.processFastPlace(h.player);
    assert.strictEqual(SETS.length, 2, '第二轮该补放上格');
    assert.deepStrictEqual([SETS[1].x, SETS[1].y, SETS[1].z], [1, 65, 0]);
    assert.strictEqual(SETS[1].blocked, false, '上格不应被拒绝');
    assert.strictEqual(SETS[1].states.upper_block_bit, 1, '上格必须带 upper_block_bit=1');
});

check('5. 死循环回归：连续 6 轮不出现被 BDS 破坏的放置（上格不被重复尝试）', () => {
    const h = makeHarness({ x: 1, y: 65, z: 0 });
    h.projection.blocks = [
        blk(1, 0, 0, 'minecraft:rose_bush', { half: 'lower' }),
        blk(1, 1, 0, 'minecraft:rose_bush', { half: 'upper' }),
    ];
    W.set(KEY(1, 63, 0, 0), { type: 'minecraft:stone' });

    for (let i = 0; i < 6; i++) h.mgr.processFastPlace(h.player);

    // 没有任何"上格被破坏/拒绝"的放置记录 → 死循环被根治
    const blocked = SETS.filter((s) => s.blocked);
    assert.strictEqual(blocked.length, 0, `不应出现被 BDS 拒绝的放置：${JSON.stringify(blocked)}`);
    // 上格只被放一次（不重复放、不重复破坏）
    const upperPlacements = SETS.filter((s) => s.y === 65);
    assert.strictEqual(upperPlacements.length, 1, '上格只该放一次');
    assert.strictEqual(W.get(KEY(1, 65, 0, 0)).type, 'rose_bush', '上格最终成型');
    assert.strictEqual(W.get(KEY(1, 65, 0, 0)).upper_block_bit, 1);
});

check('6. 玩家在地面：一轮内下格先放、上格后放（顺序正确且都不被破坏）', () => {
    const h = makeHarness({ x: 1, y: 64, z: 0 });
    h.projection.blocks = [
        blk(1, 0, 0, 'minecraft:rose_bush', { half: 'lower' }),
        blk(1, 1, 0, 'minecraft:rose_bush', { half: 'upper' }),
    ];
    W.set(KEY(1, 63, 0, 0), { type: 'minecraft:stone' });

    h.mgr.processFastPlace(h.player);

    assert.strictEqual(SETS.length, 2, '地面玩家一轮能放下下两格');
    assert.deepStrictEqual([SETS[0].y, SETS[1].y], [64, 65], '下格必须先于上格');
    assert.strictEqual(SETS[0].states.upper_block_bit, 0);
    assert.strictEqual(SETS[1].states.upper_block_bit, 1);
    assert.strictEqual(SETS.filter((s) => s.blocked).length, 0);
});

check('7. 投影缺下格（只有上格）→ 永远 pending，不破坏、不刷屏', () => {
    const h = makeHarness({ x: 1, y: 65, z: 0 });
    h.projection.blocks = [
        blk(1, 1, 0, 'minecraft:rose_bush', { half: 'upper' }),   // 只有上格
    ];
    W.set(KEY(1, 63, 0, 0), { type: 'minecraft:stone' });

    for (let i = 0; i < 3; i++) h.mgr.processFastPlace(h.player);

    assert.strictEqual(SETS.length, 0, '上格没有下格支撑就不该放置');
    assert.strictEqual(SETS.filter((s) => s.blocked).length, 0, '也不该有被破坏的记录');
});

check('8. 轻松放置（handleUseItemOn）走同一转换：投影上格解析正确', () => {
    const h = makeHarness();
    // 模拟投影块：上格
    const t = h.mgr._resolveTargetBlock('minecraft:sunflower', { half: 'upper' });
    assert.strictEqual(t.name, 'sunflower');
    assert.strictEqual(t.states.upper_block_bit, 1);
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
