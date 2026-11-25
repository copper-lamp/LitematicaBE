/**
 * 端到端状态验证：Java 投影状态 → convertJavaToBedrock → buildStates(lit:*) → BP permutation 选中的 geometry + 材质。
 * 覆盖中继器 4 方向 × 4 档 × 2 激活，比较器 4 方向 × 2 模式 × 2 激活。
 */
const path = require('path');
const fs = require('fs');
const ROOT = 'D:/GitHub/LitematicaBE';

const { BidirectionalBlockConverter } = require(path.join(ROOT, 'src/mappings/BidirectionalBlockConverter.js'));
const { GhostBlockRegistry } = require(path.join(ROOT, 'src/ghost/GhostBlockRegistry.js'));

const conv = new BidirectionalBlockConverter();
const reg = new GhostBlockRegistry(path.join(ROOT, 'resources/data/ghost_index.json'));
try { if (reg.load) reg.load(); } catch (e) {}

const BP = path.join(ROOT, 'resources/addon/LitematicaBE_BP/blocks');
const blockFiles = {
    'lit:g_repeater': 'g_repeater.json',
    'lit:g_unpowered_repeater': 'g_unpowered_repeater.json',
    'lit:g_powered_repeater': 'g_powered_repeater.json',
    'lit:g_comparator': 'g_comparator.json',
    'lit:g_unpowered_comparator': 'g_unpowered_comparator.json',
    'lit:g_powered_comparator': 'g_powered_comparator.json',
};
const bpCache = {};
function loadBP(ghostId) {
    if (!bpCache[ghostId]) {
        bpCache[ghostId] = JSON.parse(fs.readFileSync(path.join(BP, blockFiles[ghostId]), 'utf8'))['minecraft:block'];
    }
    return bpCache[ghostId];
}

function pickPermutation(ghostId, states) {
    const blk = loadBP(ghostId);
    for (const p of blk.permutations || []) {
        const ok = Object.entries(states).every(([k, v]) => p.condition.includes(`'${k}') == ${v}`));
        if (ok) return p.components;
    }
    return null;
}

const FACINGS = ['north', 'east', 'south', 'west'];
let total = 0, bad = 0;
function check(label, cond, detail) {
    total++;
    if (!cond) { bad++; console.log(`  ✗ ${label}  ${detail || ''}`); }
}

console.log('=== 中继器 ===');
for (const facing of FACINGS) {
    for (let delay = 1; delay <= 4; delay++) {
        for (const powered of ['false', 'true']) {
            const java = { name: 'minecraft:repeater', states: { delay: String(delay), facing, powered, locked: 'false' } };
            const be = conv.javaToBedrock(java);
            const ghostId = reg.resolve('minecraft:repeater');
            const lit = reg.buildStates('minecraft:repeater', be.states);
            const comp = pickPermutation(ghostId, lit);
            const suffix = delay === 1 ? '' : `_d${delay - 1}`;
            const wantGeo = `geometry.lit_repeater${suffix}${powered === 'true' ? '_on' : ''}`;
            const wantTorch = powered === 'true' ? 'ghost_rtorch_on' : 'ghost_rtorch_off';
            const wantDir = { north: 2, east: 3, south: 0, west: 1 }[facing];
            check('lit:dir', lit['lit:dir'] === wantDir, `${facing} → ${lit['lit:dir']} (want ${wantDir})`);
            check('lit:delay', lit['lit:delay'] === delay - 1, `${delay}档 → ${lit['lit:delay']}`);
            check('geometry', comp && comp['minecraft:geometry'] === wantGeo, `${comp && comp['minecraft:geometry']} vs ${wantGeo}`);
            const mi = comp && comp['minecraft:material_instances'];
            check('torch 材质', mi && mi.torch.texture === wantTorch, mi && mi.torch.texture);
            check('top 材质', mi && mi.top.texture === (powered === 'true' ? 'ghost_repeater_on' : 'ghost_repeater_off'), mi && mi.top.texture);
            const rot = comp && comp['minecraft:transformation'] && comp['minecraft:transformation'].rotation[1];
            const wantRot = { north: 0, east: 90, south: 180, west: 270 }[facing];
            check('rotation', rot === wantRot, `${facing} → ${rot}° (want ${wantRot}°)`);
        }
    }
}

console.log('=== 比较器 ===');
for (const facing of FACINGS) {
    for (const mode of ['compare', 'subtract']) {
        for (const powered of ['false', 'true']) {
            const java = { name: 'minecraft:comparator', states: { facing, mode, powered } };
            const be = conv.javaToBedrock(java);
            const ghostId = reg.resolve('minecraft:comparator');
            const lit = reg.buildStates('minecraft:comparator', be.states);
            const comp = pickPermutation(ghostId, lit);
            const sub = mode === 'subtract';
            const wantGeo = `geometry.lit_comparator${sub ? '_sub' : ''}${powered === 'true' ? '_on' : ''}`;
            check('lit:mode', lit['lit:mode'] === (sub ? 1 : 0), `${mode} → ${lit['lit:mode']}`);
            check('geometry', comp && comp['minecraft:geometry'] === wantGeo, `${comp && comp['minecraft:geometry']} vs ${wantGeo}`);
            const mi = comp && comp['minecraft:material_instances'];
            // 比较模式灯恒熄灭；减法模式输出灯恒点亮（与激活无关）
            const wantLamp = sub ? 'ghost_rtorch_on' : 'ghost_rtorch_off';
            check('lamp 材质', mi && mi.lamp.texture === wantLamp, `${mode}/${powered} → ${mi && mi.lamp.texture} (want ${wantLamp})`);
            const wantTorch = powered === 'true' ? 'ghost_rtorch_on' : 'ghost_rtorch_off';
            check('torch 材质', mi && mi.torch.texture === wantTorch, mi && mi.torch.texture);
        }
    }
}

console.log(`\n结果: ${total - bad}/${total} 项通过${bad ? `，${bad} 项失败` : ''}`);
process.exit(bad ? 1 : 0);
