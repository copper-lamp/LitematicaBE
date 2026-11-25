/**
 * repro-hologramlib-batch.js — 最小复现：blockBatchSet 客户端不可见，blockFakeSet 正常
 *
 * 目的：把这个文件单独发给 HologramLib 作者，不依赖 LitematicaBE 的任何代码。
 *
 * 用法 A（作为独立 LSE 插件）：
 *   plugins/holo-repro/manifest.json
 *   { "name": "holo-repro", "type": "lse-nodejs", "entry": "repro-hologramlib-batch.js" }
 *   进服后执行：/holorepro
 *
 * 用法 B（服务端控制台 jsdebug）：
 *   const r = require('plugins/holo-repro/repro-hologramlib-batch.js');
 *   r.run('你的游戏名', new FloatPos(100, 64, 100, 0));
 *
 * 期望（正常行为）：
 *   A（单格）可见  gold_block
 *   B（批量单格）可见 gold_block
 *   C（批量 16×16 平面）可见一整面 gold_block
 *   D selfTest(256) 的 changes 应为 256，packets 应为 16（16×16 平面跨 1 个 y 子区块，XZ 各跨 1~2 个）
 *   E selfTest(2000) 的 changes 应为 2000
 *
 * 实测（BDS 1.26.60 / 协议 2225 / HologramLib 26.60.8 / LSE 1.0.0）：
 *   A 可见；B、C 不可见；D/E 的 changes 明显小于输入格数
 */

const NS = 'HologramLib';

function imp(name) {
    try {
        if (typeof ll === 'undefined' || typeof ll.import !== 'function') return null;
        const fn = ll.import(NS, name);
        return typeof fn === 'function' ? fn : null;
    } catch (e) {
        return null;
    }
}

function safe(fn) {
    try { return fn(); } catch (e) { return `THROW: ${e && e.message ? e.message : e}`; }
}

/**
 * @param {string} playerName 玩家名（必须是库能认到的名字，建议 realName）
 * @param {{x:number,y:number,z:number}} base 起始坐标（方块坐标）
 * @param {{custom?:string}} [opts] 可选：再发一个自定义方块（例如 lit:g_generic）
 * @returns {string[]} 逐行结果
 */
function run(playerName, base, opts) {
    const o = opts || {};
    const out = [];
    const log = (s) => {
        out.push(s);
        try { logger.info(`[holorepro] ${s}`); } catch (e) { /* 无 logger 环境 */ }
    };

    const setOne = imp('blockFakeSet');
    const setBatch = imp('blockBatchSet');
    const selfTest = imp('blockBatchSelfTest');
    const stats = imp('blockBatchStats');
    const resolve = imp('blockFakeResolve');
    const uidOf = imp('viewUniqueIdOf');

    const px = Math.floor(base.x), py = Math.floor(base.y), pz = Math.floor(base.z);
    log(`HologramLib 导出：blockFakeSet=${!!setOne} blockBatchSet=${!!setBatch} blockBatchSelfTest=${!!selfTest}`);
    log(`playerName=${playerName} uniqueId=${safe(() => uidOf && uidOf(playerName))} base=(${px},${py},${pz})`);
    log(`resolve(minecraft:gold_block)=${safe(() => resolve && resolve('minecraft:gold_block'))}`);

    // A：单格通道（对照组）
    log(`A  single (${px},${py + 3},${pz}) gold_block → ${safe(() => setOne && setOne(playerName, px, py + 3, pz, 'minecraft:gold_block'))}`);

    // B：批量通道，单格、同一状态串
    log(`B  batch  (${px},${py + 5},${pz}) gold_block → ${safe(() => setBatch && setBatch(playerName, `${px} ${py + 5} ${pz} minecraft:gold_block`, false))}`);

    // C：批量通道，16×16 平面（256 格，坐标唯一）
    const plane = [];
    for (let dx = 0; dx < 16; dx++) {
        for (let dz = 0; dz < 16; dz++) {
            plane.push(`${px + 4 + dx} ${py + 1} ${pz + dz} minecraft:gold_block`);
        }
    }
    log(`C  batch  plane 16x16=256 → ${safe(() => setBatch && setBatch(playerName, plane.join(';'), false))}`);

    // D：同一批输入的离线自测（只看解析/分组/编码，不发包）
    log(`D  selfTest(256 unique) → ${safe(() => selfTest && selfTest(plane.join(';')))}`);

    // E：2000 个唯一坐标（13 进制分解，保证不重复）
    const big = [];
    for (let i = 0; i < 2000; i++) {
        const x = px + 10 + (i % 13);
        const y = py + 20 + (Math.floor(i / 13) % 13);
        const z = pz + Math.floor(i / 169);
        big.push(`${x} ${y} ${z} minecraft:gold_block`);
    }
    log(`E  selfTest(2000 unique) → ${safe(() => selfTest && selfTest(big.join(';')))}`);

    // F：自定义命名空间 + 带冒号的状态键（本项目实际使用的形状）
    if (o.custom) {
        log(`F  batch  custom ${o.custom} → ${safe(() => setBatch && setBatch(playerName, `${px} ${py + 7} ${pz} ${o.custom}`, false))}`);
        log(`F  resolve(${o.custom})=${safe(() => resolve && resolve(o.custom))}`);
    }

    log(`G  stats → ${safe(() => stats && stats())}`);

    // 结果回给玩家（有玩家时）
    try {
        const pl = mc.getPlayer(playerName);
        if (pl) for (const line of out) pl.tell(`§7${line}`);
    } catch (e) { /* 控制台调用时忽略 */ }

    return out;
}

// 作为独立插件时注册 /holorepro（失败不影响 run 的导出）
try {
    const cmd = mc.newCommand('holorepro', 'HologramLib batch repro', PermType.Any, 0x80);
    cmd.setCallback((_cmd, origin) => {
        const pl = origin && origin.player;
        if (!pl) return;
        run(pl.realName || pl.name, pl.feetPos || pl.pos);
        return true;
    });
    cmd.overwrite();
} catch (e) {
    try { logger.warn(`[holorepro] 命令注册失败：${e && e.message ? e.message : e}`); } catch (err) { /* 忽略 */ }
}

module.exports = { run };
