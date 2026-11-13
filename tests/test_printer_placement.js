/**
 * test_printer_placement.js — 投影打印机离线回归
 *
 * 不依赖 BDS：内存假世界 + 真 EasyPlaceManager（真映射表 / 真状态转换）。
 *
 * 覆盖的每一条都对应一个真实故障：
 *   1. ghost 格视为"空位可放"        —— 原来 `type !== 'minecraft:air'` → 一格都放不了
 *   2. 玩家真方块永不覆盖
 *   3. 花草/雪/水（replaceable）可顶掉，且可被配置关掉
 *   4. 世界坐标走 transformPosition   —— 投影旋转后不能错位
 *   5. 每轮写入数受 maxPerCycle 限制
 *   6. 层过滤用投影内相对 y；层号 undefined 不许把整批格吞掉
 *   7. 缺材料只提示/记账一次（不刷屏、不刷日志文件）
 *   8. 放置成功后调 ghostRenderer.markSatisfied + ghostGuard.forget 对账
 *   9. 没有投影时只提示一次
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');

// PlacementLogger / debug 日志都用相对路径（./plugins/...、./logs/...）：
// 先把 cwd 挪到临时目录，避免测试往仓库里写运行期数据。
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'printer-')));

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
        const name = (type && typeof type === 'object') ? type.name : type;
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
        tell(msg) { told.push(msg); },
        getInventory() { return { getItem() { return null; }, setItem() {} }; },
        refreshItems() {},
        giveItem() {},
        clearItem() { return 0; },
        told,
    };
}

/**
 * @param {{printer?:object, easyPlaceEnabled?:boolean, layer?:number, proj?:object, active?:boolean}} opts
 */
function makeHarness(opts) {
    const o = opts || {};
    W.clear();
    SETS.length = 0;

    const printer = Object.assign({
        radius: 5, maxPerCycle: 12, budgetMs: 5000,
        placeDelayMs: 0, overwriteReplaceable: true, debug: false,
    }, o.printer || {});

    global.configManager = {
        get(key, dflt) {
            if (key === 'easyPlace.enabled') return o.easyPlaceEnabled !== false;
            if (key.startsWith('easyPlace.printer.')) {
                const k = key.slice('easyPlace.printer.'.length);
                return (k in printer) ? printer[k] : dflt;
            }
            return dflt;
        },
    };

    const markSatisfiedCalls = [];
    const forgetCalls = [];
    global.ghostRenderer = {
        markSatisfied(xuid, d, x, y, z) { markSatisfiedCalls.push({ xuid, d, x, y, z }); return true; },
    };
    global.ghostGuard = {
        isAirLike(block) {
            const t = block && (block.type || block.name) || '';
            return !t || t === 'minecraft:air' || String(t).startsWith('lit:g_');
        },
        forget(d, x, y, z) { forgetCalls.push({ d, x, y, z }); return true; },
    };

    const projection = o.proj || {
        id: 'proj-1', name: '测试投影',
        position: { x: 0, y: 64, z: 0 },
        dimensions: { x: 8, y: 8, z: 8 },
        rotation: 0, mirrorX: false, mirrorZ: false,
        blocks: [], isMega: false,
    };

    const active = (o.active === false) ? null : {
        projection,
        renderLayer: o.layer === undefined ? -1 : o.layer,
    };

    const projManager = {
        getActiveProjectionByPlayer() { return active; },
    };

    const mgr = new EasyPlaceManager(projManager, {}, null);
    mgr.attachGhostChecks({ isAirLike: (b) => global.ghostGuard.isAirLike(b) });

    // 统计替身：真 PlacementLogger 会 appendFileSync，测"只记一次"时换成计数器
    const logs = { success: 0, failure: 0, failures: [] };
    mgr.placementLogger = {
        logSuccess() { logs.success++; },
        logFailure(p, javaName, beName, js, bs, cmd, err) {
            logs.failure++;
            logs.failures.push({ javaName, beName, err });
        },
    };

    return { mgr, projection, player: makePlayer(), logs, printer, markSatisfiedCalls, forgetCalls, active };
}

/** 造投影方块（pos 为投影内相对坐标） */
const blk = (x, y, z, name) => ({ pos: [x, y, z], name: name || 'minecraft:stone', state: {} });

/**
 * 假背包。语义对齐 LSE：
 *   - `removeItem(slot, count)`：count ≥ 堆叠数 → 整堆清除（真实接口行为）
 *   - `setItem(slot, null)` 不是合法用法（真实 LSE 只接受 Item 对象），这里也照实拒绝
 */
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
            if (!item) return false;            // 真实 LSE：只接受 Item 对象
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
        addItem() { return true; },
    };
}

/** 生存模式 harness：背包可控，findBlockInInventory 按真实语义扫背包 */
function makeSurvivalHarness(items, opts) {
    const h = makeHarness(opts);
    h.player.gameMode = 0;
    // 背包里的物品类型必须用"映射后的 BE 名"（stone，不带 minecraft: 前缀），
    // 否则桩和实现各说各话，测出来的东西没意义。
    const beName = h.mgr._resolveTargetBlock('minecraft:stone', {}).name;
    h.beName = beName;
    const resolved = {};
    Object.keys(items || {}).forEach((k) => {
        const it = items[k];
        resolved[k] = { type: it.type === 'minecraft:stone' ? beName : it.type, count: it.count };
    });
    const inv = makeInv(resolved);
    h.inv = inv;
    h.player.getInventory = () => inv;
    h.mgr.inventoryHelper.findBlockInInventory = (inventory, name) => {
        for (const [slot, it] of inventory.slots) {
            if (it.type === name && it.count > 0) return slot;
        }
        return -1;
    };
    return h;
}

// ══════════════════════════════════════════════════════
console.log('\n=== 投影打印机 ===');

check('1. ghost 格视为空位：能放（原来全部 skippedNotAir）', () => {
    const h = makeHarness();
    h.projection.blocks = [blk(1, 0, 0)];
    W.set(KEY(1, 64, 0, 0), { type: 'lit:g_stone' });   // 投影已经铺在这儿
    h.mgr.processFastPlace(h.player);
    assert.strictEqual(SETS.length, 1, 'ghost 格必须被放下');
    assert.deepStrictEqual([SETS[0].x, SETS[0].y, SETS[0].z], [1, 64, 0]);
});

check('2. 玩家真方块：永不覆盖', () => {
    const h = makeHarness();
    h.projection.blocks = [blk(1, 0, 0)];
    W.set(KEY(1, 64, 0, 0), { type: 'minecraft:oak_planks' });
    h.mgr.processFastPlace(h.player);
    assert.strictEqual(SETS.length, 0);
});

check('3a. replaceable（草）可顶掉', () => {
    const h = makeHarness();
    h.projection.blocks = [blk(1, 0, 0)];
    W.set(KEY(1, 64, 0, 0), { type: 'minecraft:short_grass' });
    h.mgr.processFastPlace(h.player);
    assert.strictEqual(SETS.length, 1);
});

check('3b. overwriteReplaceable=false 时不动草', () => {
    const h = makeHarness({ printer: { overwriteReplaceable: false } });
    h.projection.blocks = [blk(1, 0, 0)];
    W.set(KEY(1, 64, 0, 0), { type: 'minecraft:short_grass' });
    h.mgr.processFastPlace(h.player);
    assert.strictEqual(SETS.length, 0);
});

check('4. 投影旋转 90° → 世界坐标走 transformPosition', () => {
    const proj = {
        id: 'rot', name: '旋转',
        position: { x: 100, y: 64, z: 200 },
        dimensions: { x: 8, y: 8, z: 8 },
        rotation: 90, mirrorX: false, mirrorZ: false,
        blocks: [blk(2, 0, 3)], isMega: false,
    };
    const h = makeHarness({ proj, printer: { radius: 50 }, layer: -1 });
    h.player.pos = { x: 103, y: 64, z: 205, dimid: 0 };
    h.mgr.processFastPlace(h.player);
    const expect = transformPosition([2, 0, 3], proj);
    assert.strictEqual(SETS.length, 1);
    assert.deepStrictEqual([SETS[0].x, SETS[0].y, SETS[0].z], [expect.x, expect.y, expect.z],
        `旋转后应写到 ${expect.x},${expect.y},${expect.z}`);
});

check('5. maxPerCycle 限速：6 个待放格只放 2 个', () => {
    const h = makeHarness({ printer: { maxPerCycle: 2 } });
    h.projection.blocks = [0, 1, 2, 3, 4, 5].map((i) => blk(1, 0, i));
    h.mgr.processFastPlace(h.player);
    assert.strictEqual(SETS.length, 2);
});

check('6a. 层过滤：只放第 3 层', () => {
    const h = makeHarness({ layer: 3 });
    h.projection.blocks = [blk(1, 3, 0), blk(1, 4, 0)];
    h.mgr.processFastPlace(h.player);
    assert.strictEqual(SETS.length, 1);
    assert.strictEqual(SETS[0].y, 64 + 3);
});

check('6b. 层号 undefined 不能把整批格吞掉', () => {
    const h = makeHarness();
    h.active.renderLayer = undefined;
    h.projection.blocks = [blk(1, 0, 0)];
    h.mgr.processFastPlace(h.player);
    assert.strictEqual(SETS.length, 1, 'undefined 应归一化成 -1（全部层）');
});

check('7. 生存模式缺材料：提示与失败日志各只一次', () => {
    const h = makeHarness();
    h.player.gameMode = 0;
    h.projection.blocks = [blk(1, 0, 0), blk(2, 0, 0), blk(3, 0, 0)];
    h.mgr.inventoryHelper.findBlockInInventory = () => -1;
    h.mgr.processFastPlace(h.player);
    h.mgr.processFastPlace(h.player);
    assert.strictEqual(SETS.length, 0);
    assert.strictEqual(h.logs.failure, 1, '同一种方块只记一次失败');
    assert.strictEqual(h.player.told.length, 1, '只提示一次');
});

check('7b. 只剩最后 1 个：放完必须清空，不能无限复制材料', () => {
    const h = makeSurvivalHarness({ 0: { type: 'minecraft:stone', count: 1 } });
    h.projection.blocks = [blk(1, 0, 0), blk(2, 0, 0)];
    h.mgr.processFastPlace(h.player);
    assert.strictEqual(SETS.length, 1, '只有 1 个材料，只能放 1 格');
    assert.strictEqual(h.inv.slots.has(0), false, '最后一个必须被清空');
    h.mgr.processFastPlace(h.player);
    assert.strictEqual(SETS.length, 1, '材料用完就不能再放');
});

check('7c. 堆叠 3 个：只减 1，不整堆清', () => {
    const h = makeSurvivalHarness({ 0: { type: 'minecraft:stone', count: 3 } });
    h.projection.blocks = [blk(1, 0, 0)];
    h.mgr.processFastPlace(h.player);
    assert.strictEqual(SETS.length, 1);
    assert.strictEqual(h.inv.slots.get(0).count, 2);
});

check('7d. 扣物品接口失效（模拟 setItem(null) 老行为）：放一格就停，不白放', () => {
    const h = makeSurvivalHarness({ 0: { type: 'minecraft:stone', count: 1 } });
    h.inv.removeItem = () => false;          // 旧 LSE 行为：减不动
    h.player.clearItem = () => 0;            // 兜底也清不掉
    h.projection.blocks = [blk(1, 0, 0), blk(2, 0, 0)];
    h.mgr.processFastPlace(h.player);
    assert.strictEqual(SETS.length, 1, '第一格已经放进去了，之后必须停下');
    h.mgr.processFastPlace(h.player);
    h.mgr.processFastPlace(h.player);
    assert.strictEqual(SETS.length, 1, '扣不掉就不许继续放（否则就是复制材料）');
    assert.ok(h.player.told.some((m) => /扣不掉/.test(m)), '要提示玩家');
});

check('8. 放置成功后与 ghost 账本对账（markSatisfied + forget）', () => {
    const h = makeHarness();
    h.projection.blocks = [blk(1, 0, 0)];
    W.set(KEY(1, 64, 0, 0), { type: 'lit:g_stone' });
    h.mgr.processFastPlace(h.player);
    assert.strictEqual(h.markSatisfiedCalls.length, 1);
    assert.deepStrictEqual(
        [h.markSatisfiedCalls[0].d, h.markSatisfiedCalls[0].x, h.markSatisfiedCalls[0].y, h.markSatisfiedCalls[0].z],
        [0, 1, 64, 0]
    );
    assert.strictEqual(h.forgetCalls.length, 1);
});

check('9. 没有投影：只提示一次', () => {
    const h = makeHarness({ active: false });
    h.mgr.processFastPlace(h.player);
    h.mgr.processFastPlace(h.player);
    assert.strictEqual(h.player.told.length, 1);
    assert.ok(/没有正在显示的投影/.test(h.player.told[0]));
});

check('10. 开关：easyPlace.enabled=false 时拒绝开启；开启后能关', () => {
    const h = makeHarness({ easyPlaceEnabled: false });
    assert.strictEqual(h.mgr.setFastPlace(h.player, true), false);
    assert.strictEqual(h.mgr.isFastPlaceEnabled(h.player), false);

    const h2 = makeHarness();
    assert.strictEqual(h2.mgr.setFastPlace(h2.player, true), true);
    assert.strictEqual(h2.mgr.isFastPlaceEnabled(h2.player), true);
    assert.strictEqual(h2.mgr.setFastPlace(h2.player, false), false);
    assert.strictEqual(h2.mgr.isFastPlaceEnabled(h2.player), false);
});

check('11. MEGA 投影：候选集走 megaManager（相对坐标）', () => {
    const h = makeHarness();
    h.projection.isMega = true;
    h.projection.schematicId = 'mega_x';
    let asked = null;
    h.mgr.megaManager = {
        getBlocksNear(id, rx, ry, rz, r) {
            asked = { id, rx, ry, rz, r };
            return [blk(1, 0, 0)];
        },
    };
    h.projection.blocks = [];
    h.mgr.processFastPlace(h.player);
    assert.ok(asked && asked.id === 'mega_x', '必须问 megaManager');
    assert.strictEqual(SETS.length, 1);
});

check('12. 默认半径 6：6 格内可放、7 格外不碰', () => {
    // 世界坐标 (6,64,0) 距玩家 6 格 → 新默认 6 必须覆盖；旧默认 5 时漏掉
    const h6 = makeHarness({ printer: { radius: 6 } });
    h6.projection.blocks = [blk(6, 0, 0), blk(7, 0, 0)];
    h6.mgr.processFastPlace(h6.player);
    assert.deepStrictEqual(SETS.map((s) => s.x).sort((a, b) => a - b), [6],
        '只有 6 格内那一格该被放，7 格外的不许碰');

    const h5 = makeHarness({ printer: { radius: 5 } });
    h5.projection.blocks = [blk(6, 0, 0)];
    h5.mgr.processFastPlace(h5.player);
    assert.strictEqual(SETS.length, 0, '半径 5 时 6 格处不该被放（确认半径真的生效）');
});

check('13. 旋转 90° 下候选集按相对坐标定位分块（不会取错分块导致漏格）', () => {
    const h = makeHarness({
        proj: {
            id: 'proj-rot', name: '旋转投影',
            position: { x: 0, y: 64, z: 0 },
            dimensions: { x: 64, y: 64, z: 64 },
            rotation: 90, mirrorX: false, mirrorZ: false,
            blocks: [], blockChunks: new Map(), isMega: false,
        },
    });
    // 相对 (60,0,0) 旋转 90° 后落在世界 (0,64,3)：transformPosition([60,0,0]) = { x:0, z:64-60-1=3 }
    h.projection.blockChunks.set('3,0,0', [blk(60, 0, 0)]);
    h.player.pos = { x: 0, y: 64, z: 3, dimid: 0 };

    h.mgr.processFastPlace(h.player);

    assert.deepStrictEqual([SETS.length, SETS[0] && SETS[0].x, SETS[0] && SETS[0].z], [1, 0, 3],
        '必须从相对分块 3,0,0 取到方块并放到世界 (0,64,3)；手减 position 会去查分块 0,0,0 然后一格不放');
});

check('14. 玩家退出：清掉打印机状态并停掉 tick 循环', () => {
    const h = makeHarness();
    h.mgr.setFastPlace(h.player, true);
    assert.strictEqual(h.mgr.isFastPlaceEnabled(h.player), true);
    assert.ok(h.mgr.tickInterval, '开启后应有 tick 循环');

    h.mgr.onPlayerLeave(h.player);

    assert.strictEqual(h.mgr.isFastPlaceEnabled(h.player), false, '退出后不应再为离线玩家打印');
    assert.strictEqual(h.mgr.tickInterval, null, '没人用打印机时 tick 循环必须停掉');
    assert.strictEqual(h.mgr.noProjectionNotified.has(h.player.xuid), false, '提示标记必须清掉，否则重新进服看不到"没有投影"');
});

check('15. 缺料提示按玩家隔离：A 缺石头不该吃掉 B 的提示', () => {
    const h = makeSurvivalHarness({});
    h.projection.blocks = [blk(1, 0, 0)];

    const p2 = makePlayer({ xuid: 'P2', name: 'Alex', gameMode: 0 });
    const inv2 = makeInv({});
    p2.getInventory = () => inv2;

    h.mgr.processFastPlace(h.player);
    h.mgr.processFastPlace(p2);

    const miss = (p) => p.told.filter((m) => /缺少材料/.test(m)).length;
    assert.strictEqual(miss(h.player), 1, 'A 缺料要提示一次');
    assert.strictEqual(miss(p2), 1, 'B 缺同一种料也必须提示（全局去重会把它吃掉）');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
