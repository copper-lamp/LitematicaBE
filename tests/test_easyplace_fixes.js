/**
 * test_easyplace_fixes.js — 轻松放置 4 个缺陷的离线回归
 *
 * 不依赖 BDS：内存假世界 + 假背包 + 真 EasyPlaceManager（真映射表 / 真状态转换）。
 *
 * 对应 4 个已修缺陷：
 *   A. 世界 → 投影相对坐标未反解旋转/镜像（PositionConverter）
 *   B. 潜影盒取料后 foundSlot 未回填（靠"恰好是选中槽"才扣得到）
 *   C. 缺料时一律 return false，吞掉非方块物品的右键（药水/食物/工具）
 *   D. 投影纠错直接 setBlock，不扣材料（免费换方块）
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');

// PlacementLogger / debug 日志都写相对路径：先挪到临时目录，别往仓库里写运行期数据
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'easyplace-fix-')));

const { EasyPlaceManager } = require(path.join(PLUGIN, 'src', 'easyplace', 'EasyPlaceManager.js'));
const { PositionConverter } = require(path.join(PLUGIN, 'src', 'easyplace', 'PositionConverter.js'));
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
    const given = [];
    return {
        xuid: o.xuid || 'P1',
        name: o.name || 'Steve',
        gameMode: o.gameMode === undefined ? 1 : o.gameMode,
        pos: { x: 0, y: 64, z: 0, dimid: 0 },
        getInventory() { return { getItem() { return null; }, setItem() {}, removeItem() { return false; } }; },
        refreshItems() {},
        giveItem(item) { given.push(item); return o.giveItemOk !== false; },
        clearItem() { return 0; },
        tell(msg) { told.push(msg); },
        told,
        given,
    };
}

/** 假背包：语义对齐 LSE（removeItem 是真接口；setItem(null) 不合法） */
function makeInv(items) {
    const slots = new Map();
    Object.keys(items || {}).forEach((k) => {
        slots.set(Number(k), { type: items[k].type, count: items[k].count });
    });
    return {
        slots,
        getItem(slot) {
            const it = slots.get(slot);
            if (!it) return { isNull: () => true, type: 'minecraft:air', count: 0 };
            return { isNull: () => false, type: it.type, count: it.count };
        },
        setItem(slot, item) {
            if (!item) return false;
            slots.set(slot, { type: item.type, count: item.count });
            return true;
        },
        removeItem(slot, count) {
            const it = slots.get(slot);
            if (!it) return false;
            if (count >= it.count) slots.delete(slot);
            else it.count -= count;
            return true;
        },
        getSize() { return 36; },
    };
}

/**
 * @param {{proj?:object, layer?:number, active?:boolean,
 *          correction?:boolean, easyPlaceEnabled?:boolean}} opts
 */
function makeHarness(opts) {
    const o = opts || {};
    W.clear();
    SETS.length = 0;

    global.configManager = {
        get(key, dflt) {
            if (key === 'easyPlace.enabled') return o.easyPlaceEnabled !== false;
            if (key.startsWith('easyPlace.printer.')) {
                const k = key.slice('easyPlace.printer.'.length);
                const printer = { radius: 5, maxPerCycle: 12, budgetMs: 5000, placeDelayMs: 0, overwriteReplaceable: true, debug: false };
                return (k in printer) ? printer[k] : dflt;
            }
            return dflt;
        },
    };

    global.ghostRenderer = {
        markSatisfied() { return true; },
    };
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
        isMega: false,
    };

    const active = (o.active === false) ? null : {
        projection,
        renderLayer: o.layer === undefined ? -1 : o.layer,
    };

    const projManager = { getActiveProjectionByPlayer() { return active; } };

    const mgr = new EasyPlaceManager(projManager, {}, null);
    mgr.attachGhostChecks({ isAirLike: (b) => global.ghostGuard.isAirLike(b) });

    mgr.placementLogger = {
        logSuccess() {},
        logFailure() {},
    };

    const player = makePlayer();
    if (o.correction !== false) {
        mgr.playerStates.set(player.xuid, { enabled: true, correctionEnabled: true, placedCount: 0 });
    }

    return { mgr, projection, player, active };
}

const beStone = (mgr) => mgr._resolveTargetBlock('minecraft:stone', {}).name;

// ══════════════════════════════════════════════════════
console.log('\n=== 轻松放置缺陷修复 ===');

// ── A. 坐标反解 ────────────────────────────────────────
check('A1. worldToProjection 与 transformPosition 严格互逆（4 旋转 × 4 镜像组合）', () => {
    const pc = new PositionConverter();
    const cases = [];
    for (const rotation of [0, 90, 180, 270]) {
        for (const mx of [false, true]) {
            for (const mz of [false, true]) {
                cases.push({ rotation, mirrorX: mx, mirrorZ: mz });
            }
        }
    }
    const dims = { x: 8, y: 8, z: 8 };
    const samples = [
        [0, 0, 0], [1, 0, 2], [7, 0, 5], [3, 4, 6], [0, 7, 0], [5, 7, 7],
    ];
    for (const c of cases) {
        const proj = { position: { x: 0, y: 64, z: 0 }, dimensions: dims, rotation: c.rotation, mirrorX: c.mirrorX, mirrorZ: c.mirrorZ };
        for (const s of samples) {
            const world = transformPosition(s, proj);
            const back = pc.worldToProjection(world, proj);
            assert.deepStrictEqual(
                [back.x, back.y, back.z], s,
                `rotation=${c.rotation} mirrorX=${c.mirrorX} mirrorZ=${c.mirrorZ} 往返 ${JSON.stringify(s)} → ${JSON.stringify(back)}`
            );
        }
    }
});

check('A2. 投影旋转 90° 后，点方块能取到正确的投影格（旧代码整段错位）', () => {
    const h = makeHarness({
        proj: {
            position: { x: 0, y: 64, z: 0 },
            dimensions: { x: 8, y: 8, z: 8 },
            rotation: 90, mirrorX: false, mirrorZ: false,
            blockIndex: new Map(),
            isMega: false,
        },
    });
    // 投影内相对 (1,1,0) 是石头。rotation=90 时它落在世界 (0,65,6)
    h.projection.blockIndex.set('1,1,0', { name: 'minecraft:stone', state: {} });
    const world = transformPosition([1, 1, 0], h.projection);
    assert.deepStrictEqual([world.x, world.y, world.z], [0, 65, 6], '测试前提：transformPosition 应把它放到 (0,65,6)');

    // 玩家点下方方块的上表面 → 目标格 (0,65,6)
    const clicked = { pos: { x: world.x, y: world.y - 1, z: world.z, dimid: 0 } };
    const ok = h.mgr.handleUseItemOn(h.player, { type: 'minecraft:dirt', count: 1, isBlock: true }, clicked, 1);
    assert.strictEqual(ok, false, '应代放并取消原事件');
    assert.strictEqual(SETS.length, 1, '应写下 1 格');
    assert.deepStrictEqual([SETS[0].x, SETS[0].y, SETS[0].z], [0, 65, 6]);
});

check('A3. 未旋转的投影行为不变（回归保护）', () => {
    const h = makeHarness();
    h.projection.blockIndex.set('2,1,3', { name: 'minecraft:stone', state: {} });
    const clicked = { pos: { x: 2, y: 64, z: 3, dimid: 0 } };
    const ok = h.mgr.handleUseItemOn(h.player, { type: 'minecraft:dirt', count: 1, isBlock: true }, clicked, 1);
    assert.strictEqual(ok, false);
    assert.deepStrictEqual([SETS[0].x, SETS[0].y, SETS[0].z], [2, 65, 3]);
});

// ── B. 潜影盒取料 ──────────────────────────────────────
check('B1. 潜影盒取料后 foundSlot 回填：放置成功且材料真的少了 1 个', () => {
    const h = makeHarness();
    h.player.gameMode = 0;
    h.projection.blockIndex.set('2,1,2', { name: 'minecraft:stone', state: {} });

    const name = beStone(h.mgr);
    const inv = makeInv({ 7: { type: name, count: 3 } });
    h.player.getInventory = () => inv;

    h.mgr.inventoryHelper.findBlockInInventory = () => -1;          // 背包里"没有"
    h.mgr.inventoryHelper.findBlockInShulkerBoxes = () => 7;        // 潜影盒取到 7 号槽
    h.mgr.inventoryHelper._expandSearchNames = () => [name];

    const ok = h.mgr.handleUseItemOn(h.player, { type: 'minecraft:dirt', count: 1, isBlock: true },
        { pos: { x: 2, y: 64, z: 2, dimid: 0 } }, 1);

    assert.strictEqual(ok, false, '应代放并取消原事件');
    assert.strictEqual(SETS.length, 1, '应写下 1 格');
    assert.strictEqual(inv.slots.get(7).count, 2, '必须从潜影盒取出的那一槽扣掉 1 个（旧代码 foundSlot 仍是 -1）');
});

// ── C. 非方块手持物不被吞右键 ─────────────────────────
check('C1. 缺料 + 手持非方块（药水）：放行，不取消右键', () => {
    const h = makeHarness();
    h.player.gameMode = 0;
    h.projection.blockIndex.set('2,1,2', { name: 'minecraft:stone', state: {} });
    h.mgr.inventoryHelper.findBlockInInventory = () => -1;
    h.mgr.inventoryHelper.findBlockInShulkerBoxes = () => -1;
    h.mgr.inventoryHelper.countBlock = () => 0;

    const ok = h.mgr.handleUseItemOn(h.player, { type: 'minecraft:potion', count: 1, isBlock: false },
        { pos: { x: 2, y: 64, z: 2, dimid: 0 } }, 1);
    assert.strictEqual(ok, true, '非方块物品不应被投影拦掉');
    assert.strictEqual(SETS.length, 0);
});

check('C2. 缺料 + 手持方块：仍然拦下（保持原有语义）', () => {
    const h = makeHarness();
    h.player.gameMode = 0;
    h.projection.blockIndex.set('2,1,2', { name: 'minecraft:stone', state: {} });
    h.mgr.inventoryHelper.findBlockInInventory = () => -1;
    h.mgr.inventoryHelper.findBlockInShulkerBoxes = () => -1;
    h.mgr.inventoryHelper.countBlock = () => 0;

    const ok = h.mgr.handleUseItemOn(h.player, { type: 'minecraft:dirt', count: 1, isBlock: true },
        { pos: { x: 2, y: 64, z: 2, dimid: 0 } }, 1);
    assert.strictEqual(ok, false, '方块物品缺料时要拦截');
    assert.strictEqual(SETS.length, 0);
});

// ── D. 纠错扣料 ────────────────────────────────────────
check('D1. 纠错要真扣料：玩家放泥土 → 换成石头并扣 1 个石头', () => {
    const h = makeHarness();
    h.player.gameMode = 0;
    h.projection.blockIndex.set('2,0,2', { name: 'minecraft:stone', state: {} });

    const name = beStone(h.mgr);
    const inv = makeInv({ 0: { type: name, count: 2 } });
    h.player.getInventory = () => inv;
    h.mgr.inventoryHelper.findBlockInInventory = () => 0;
    h.mgr.inventoryHelper._expandSearchNames = () => [name];

    h.mgr.correctBlockPlacement(h.player, { pos: { x: 2, y: 64, z: 2, dimid: 0 }, type: 'minecraft:dirt' });

    assert.strictEqual(SETS.length, 1, '应覆盖成投影方块');
    assert.strictEqual(inv.slots.get(0).count, 1, '必须扣掉 1 个材料（旧代码免费换）');
});

check('D2. 纠错缺料：不覆盖、只提示一次', () => {
    const h = makeHarness();
    h.player.gameMode = 0;
    h.projection.blockIndex.set('2,0,2', { name: 'minecraft:stone', state: {} });
    h.mgr.inventoryHelper.findBlockInInventory = () => -1;
    h.mgr.inventoryHelper.findBlockInShulkerBoxes = () => -1;

    const block = { pos: { x: 2, y: 64, z: 2, dimid: 0 }, type: 'minecraft:dirt' };
    h.mgr.correctBlockPlacement(h.player, block);
    h.mgr.correctBlockPlacement(h.player, block);

    assert.strictEqual(SETS.length, 0, '没材料就不纠错（保留玩家放的方块）');
    assert.strictEqual(h.player.told.length, 1, '同一方块只提示一次');
    assert.ok(/投影纠错需要材料/.test(h.player.told[0]), `提示文案不对：${h.player.told[0]}`);
});

check('D3. 创造模式纠错不扣料（保持原有行为）', () => {
    const h = makeHarness();
    h.player.gameMode = 1;
    h.projection.blockIndex.set('2,0,2', { name: 'minecraft:stone', state: {} });
    h.mgr.inventoryHelper.findBlockInInventory = () => -1;

    h.mgr.correctBlockPlacement(h.player, { pos: { x: 2, y: 64, z: 2, dimid: 0 }, type: 'minecraft:dirt' });
    assert.strictEqual(SETS.length, 1);
});

check('D4. 纠错固定扣料，没有"不扣料"的配置分支（原 consume 开关已移除）', () => {
    // 底层约束：生存模式纠错必须扣 1 个材料。旧实现留了 easyPlace.correction.consume 开关，
    // 关掉就等于"放块泥土免费换投影方块"（材料复制），所以该开关已删除。
    const h = makeHarness();
    h.player.gameMode = 0;
    h.projection.blockIndex.set('2,0,2', { name: 'minecraft:stone', state: {} });
    const inv = makeInv({ 0: { type: beStone(h.mgr), count: 2 } });
    h.player.getInventory = () => inv;
    h.mgr.inventoryHelper.findBlockInInventory = () => 0;

    h.mgr.correctBlockPlacement(h.player, { pos: { x: 2, y: 64, z: 2, dimid: 0 }, type: 'minecraft:dirt' });
    assert.strictEqual(SETS.length, 1);
    assert.strictEqual(inv.slots.get(0).count, 1, '无论配置怎么改都必须扣料（开关已移除）');
});

check('D5. 纠错判定正确时必须完全不动（不写世界、不扣料）', () => {
    const h = makeHarness();
    h.player.gameMode = 0;
    h.projection.blockIndex.set('2,0,2', { name: 'minecraft:stone', state: {} });
    const inv = makeInv({ 0: { type: beStone(h.mgr), count: 2 } });
    h.player.getInventory = () => inv;
    h.mgr.inventoryHelper.findBlockInInventory = () => 0;

    h.mgr.correctBlockPlacement(h.player, { pos: { x: 2, y: 64, z: 2, dimid: 0 }, type: 'minecraft:stone' });
    assert.strictEqual(SETS.length, 0);
    assert.strictEqual(inv.slots.get(0).count, 2);
});

// ── D. 纠错返还（替换成功后退回玩家放错的那块）──────────
check('D6. 替换成功后返还错误方块：扣 1 个石头、退回 1 个泥土', () => {
    const h = makeHarness();
    h.player.gameMode = 0;
    h.projection.blockIndex.set('2,0,2', { name: 'minecraft:stone', state: {} });

    const name = beStone(h.mgr);
    const inv = makeInv({ 0: { type: name, count: 2 } });
    h.player.getInventory = () => inv;
    h.mgr.inventoryHelper.findBlockInInventory = () => 0;
    h.mgr.inventoryHelper._expandSearchNames = () => [name];

    h.mgr.correctBlockPlacement(h.player, { pos: { x: 2, y: 64, z: 2, dimid: 0 }, type: 'minecraft:dirt' });

    assert.strictEqual(SETS.length, 1, '应覆盖成投影方块');
    assert.strictEqual(inv.slots.get(0).count, 1, '必须扣掉 1 个正确材料');
    assert.strictEqual(h.player.given.length, 1, '必须退回 1 个错误方块');
    assert.strictEqual(h.player.given[0].type, 'minecraft:dirt', `退回了错误物品：${h.player.given[0].type}`);
    assert.strictEqual(h.player.given[0].count, 1);
});

check('D7. 纠错固定返还，没有"只扣不退"的配置分支（原 refund 开关已移除）', () => {
    // 底层约束：替换成功、材料已扣，就必须退回玩家放错的那块。旧实现留了
    // easyPlace.correction.refund 开关，关掉 = 玩家白亏一个方块（净损失 2），所以该开关已删除。
    const h = makeHarness();
    h.player.gameMode = 0;
    h.projection.blockIndex.set('2,0,2', { name: 'minecraft:stone', state: {} });

    const name = beStone(h.mgr);
    const inv = makeInv({ 0: { type: name, count: 2 } });
    h.player.getInventory = () => inv;
    h.mgr.inventoryHelper.findBlockInInventory = () => 0;
    h.mgr.inventoryHelper._expandSearchNames = () => [name];

    h.mgr.correctBlockPlacement(h.player, { pos: { x: 2, y: 64, z: 2, dimid: 0 }, type: 'minecraft:dirt' });

    assert.strictEqual(SETS.length, 1);
    assert.strictEqual(inv.slots.get(0).count, 1);
    assert.strictEqual(h.player.given.length, 1, '无论配置怎么改都必须返还（开关已移除）');
});

check('D8. 创造模式纠错不返还（返还会刷物品）', () => {
    const h = makeHarness();
    h.player.gameMode = 1;
    h.projection.blockIndex.set('2,0,2', { name: 'minecraft:stone', state: {} });

    h.mgr.correctBlockPlacement(h.player, { pos: { x: 2, y: 64, z: 2, dimid: 0 }, type: 'minecraft:dirt' });

    assert.strictEqual(SETS.length, 1);
    assert.strictEqual(h.player.given.length, 0, '创造模式不应返还');
});

check('D9. 扣料失败时不返还（没付材料就不退方块，避免净赚）', () => {
    const h = makeHarness();
    h.player.gameMode = 0;
    h.projection.blockIndex.set('2,0,2', { name: 'minecraft:stone', state: {} });

    const name = beStone(h.mgr);
    const inv = makeInv({ 0: { type: name, count: 2 } });
    inv.removeItem = () => false;                 // 模拟背包被其它插件锁死
    h.player.getInventory = () => inv;
    h.player.clearItem = () => 0;
    h.mgr.inventoryHelper.findBlockInInventory = () => 0;
    h.mgr.inventoryHelper._expandSearchNames = () => [name];

    h.mgr.correctBlockPlacement(h.player, { pos: { x: 2, y: 64, z: 2, dimid: 0 }, type: 'minecraft:dirt' });

    assert.strictEqual(SETS.length, 1, '方块已经覆盖了');
    assert.strictEqual(inv.slots.get(0).count, 2, '扣不掉就不该扣');
    assert.strictEqual(h.player.given.length, 0, '没付材料不许返还');
    assert.ok(h.player.told.some((m) => /扣不掉/.test(m)), '要提示扣不掉');
});

check('D10. 方块名不是物品名时按 方块名→物品名 回落（water → water_bucket）', () => {
    const h = makeHarness();
    const origNewItem = global.mc.newItem;
    global.mc.newItem = (t, c) => (t === 'minecraft:water' ? null : { type: t, count: c });
    try {
        const item = h.mgr._makeRefundItem('minecraft:water', null);
        assert.ok(item, '必须回落到可放置物品');
        assert.strictEqual(item.type, 'minecraft:water_bucket', `回落到错误物品：${item && item.type}`);
    } finally {
        global.mc.newItem = origNewItem;
    }
});

check('D11. 带颜色的方块返还时把 states.color 折成 Damage（床：red → 14）', () => {
    const h = makeHarness();
    const item = h.mgr._makeRefundItem('minecraft:bed', { color: 'red' });
    assert.ok(item);
    assert.strictEqual(item.damage, 14, `颜色折算错误：${item.damage}`);
});

check('D12. 返还失败（背包满）时不打断替换，只提示一次', () => {
    const h = makeHarness();
    h.player.gameMode = 0;
    h.player.giveItem = function (it) { this.given.push(it); return false; };   // 背包满
    h.projection.blockIndex.set('2,0,2', { name: 'minecraft:stone', state: {} });

    const name = beStone(h.mgr);
    const inv = makeInv({ 0: { type: name, count: 2 } });
    h.player.getInventory = () => inv;
    h.mgr.inventoryHelper.findBlockInInventory = () => 0;
    h.mgr.inventoryHelper._expandSearchNames = () => [name];

    const block = { pos: { x: 2, y: 64, z: 2, dimid: 0 }, type: 'minecraft:dirt' };
    h.mgr.correctBlockPlacement(h.player, block);

    assert.strictEqual(SETS.length, 1, '替换本身必须完成');
    assert.strictEqual(inv.slots.get(0).count, 1, '材料照扣');
    assert.ok(h.player.told.some((m) => /背包已满/.test(m)), '要提示背包满');
    assert.strictEqual(h.player.told.filter((m) => /背包已满/.test(m)).length, 1, '只提示一次');
});

check('D13. 同一格重复触发（世界已是正确方块）不再覆盖、不再扣料', () => {
    const h = makeHarness();
    h.player.gameMode = 0;
    h.projection.blockIndex.set('2,0,2', { name: 'minecraft:stone', state: {} });

    const name = beStone(h.mgr);
    const inv = makeInv({ 0: { type: name, count: 2 } });
    h.player.getInventory = () => inv;
    h.mgr.inventoryHelper.findBlockInInventory = () => 0;
    h.mgr.inventoryHelper._expandSearchNames = () => [name];

    const block = { pos: { x: 2, y: 64, z: 2, dimid: 0 }, type: 'minecraft:dirt' };
    h.mgr.correctBlockPlacement(h.player, block);
    const afterFirst = { sets: SETS.length, count: inv.slots.get(0).count, given: h.player.given.length };

    h.mgr.correctBlockPlacement(h.player, block);   // 事件重复触发

    assert.deepStrictEqual(
        { sets: SETS.length, count: inv.slots.get(0).count, given: h.player.given.length },
        afterFirst,
        '第二次必须完全不动（世界已是石头）'
    );
    assert.strictEqual(afterFirst.sets, 1);
    assert.strictEqual(afterFirst.count, 1, '只扣一次料');
    assert.strictEqual(afterFirst.given, 1, '只退一次方块');
});

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
