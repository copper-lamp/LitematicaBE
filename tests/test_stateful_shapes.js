/**
 * test_stateful_shapes.js — 「一形状多形态」方块的 identifier 分派回归（楼梯 / 活板门 / 门）
 *
 * 事故形态：这三族原来把形态写成 permutation 切 `minecraft:geometry`。BDS 上这条路
 * 实测不生效（活塞当初的结论：模型首次注册即固定），表现是：
 *   - 倒置楼梯永远正放；
 *   - 活板门打开后还是平盖，下半/上半也不分；
 *   - 门打开后还是平面板，上半门还共用下半的贴图。
 *
 * 现在与半砖同一套做法：**形态由 identifier 承载，只有 facing（dir/hinge）走
 * permutation 的 `minecraft:transformation`**。
 *
 * 覆盖（不依赖 BDS）：
 *   1. 每个形态都有独立 identifier，BP 的 geometry 与 index 记录一致
 *   2. permutation 里**不出现** minecraft:geometry（防回归）
 *   3. 活板门 half=top 的位移、门上下两段贴图不同
 *   4. 注册表分派：weirdo/upside、open/upside、open/upper/hinge，含 oak_* 别名
 *   5. 覆盖面：97 楼梯 / 22 活板门 / 22 门 全部有 javaMapByState
 *   6. 材质引用都在 terrain_texture 且 png 存在
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const PLUGIN = path.resolve(__dirname, '..');
const RP = path.join(PLUGIN, 'resources', 'addon', 'LitematicaBE_RP');
const BP = path.join(PLUGIN, 'resources', 'addon', 'LitematicaBE_BP');
const { GhostBlockRegistry } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostBlockRegistry.js'));

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const idx = readJson(path.join(PLUGIN, 'resources', 'data', 'ghost_index.json'));
const terrain = readJson(path.join(RP, 'textures', 'terrain_texture.json')).texture_data;
const registry = new GhostBlockRegistry(path.join(PLUGIN, 'resources', 'data', 'ghost_index.json'));

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); console.log(`  [OK] ${name}`); pass++; }
    catch (e) { console.log(`  [FAIL] ${name}\n      ${e.message}`); fail++; }
}
const bpPath = (id) => path.join(BP, 'blocks', `${id.replace(/^lit:/, '')}.json`);
const bp = (id) => readJson(bpPath(id))['minecraft:block'];
const geoName = (id) => bp(id).components['minecraft:geometry'];

/** permutation 里是否还有「切几何」——这是这条回归的红线 */
function hasGeometrySwap(id) {
    return (bp(id).permutations || []).some((p) => p.components && p.components['minecraft:geometry']);
}

// —— 1. 楼梯 ——
t('楼梯：上下两个 identifier，几何分别是 lit_stairs / lit_stairs_up', () => {
    assert.strictEqual(geoName('lit:g_oak_stairs'), 'geometry.lit_stairs');
    assert.strictEqual(geoName('lit:g_oak_stairs_up'), 'geometry.lit_stairs_up');
    assert.strictEqual(idx.blocks['lit:g_oak_stairs_up'].geometry, 'stairs_up');
});

t('楼梯：permutation 只切 transformation，不切 geometry', () => {
    for (const id of ['lit:g_oak_stairs', 'lit:g_oak_stairs_up']) {
        assert.ok(!hasGeometrySwap(id), `${id} 仍在 permutation 里切 geometry`);
        assert.strictEqual(bp(id).permutations.length, 4, `${id} 应有 4 个 dir permutation`);
    }
});

t('楼梯：全部 97 种都有形态分派（upside_down_bit → _up）', () => {
    const ids = Object.keys(idx.javaMapByState).filter((k) => k.endsWith('_stairs'));
    assert.ok(ids.length >= 97, `只有 ${ids.length} 种楼梯有分派`);
    for (const k of ids) {
        const node = idx.javaMapByState[k];
        assert.ok(node.upside_down_bit, `${k} 缺 upside_down_bit 分派`);
        assert.ok(idx.blocks[node.upside_down_bit['0']], `${k} 的下半 identifier 不存在`);
        assert.ok(idx.blocks[node.upside_down_bit['1']], `${k} 的上半 identifier 不存在`);
    }
});

// —— 2. 活板门 ——
t('活板门：三态 identifier（关-下 / 关-上 / 开），几何各自独立', () => {
    assert.strictEqual(geoName('lit:g_trapdoor'), 'geometry.lit_trapdoor');
    assert.strictEqual(geoName('lit:g_trapdoor_top'), 'geometry.lit_trapdoor');
    assert.strictEqual(geoName('lit:g_trapdoor_open'), 'geometry.lit_trapdoor_open');
    assert.ok(!hasGeometrySwap('lit:g_trapdoor_open'), '打开态仍在 permutation 里切 geometry');
});

t('活板门：half=top 用整体下移 13/16 表达（不再靠几何切换）', () => {
    const top = bp('lit:g_trapdoor_top').components['minecraft:transformation'];
    assert.deepStrictEqual(top.translation, [0, -0.8125, 0]);
    const bottom = bp('lit:g_trapdoor').components['minecraft:transformation'];
    assert.deepStrictEqual(bottom.translation, [0, 0, 0]);
});

t('活板门：打开态按 dir 旋转（4 档）', () => {
    const perms = bp('lit:g_trapdoor_open').permutations;
    assert.strictEqual(perms.length, 4);
    const rots = perms.map((p) => JSON.stringify(p.components['minecraft:transformation'].rotation));
    assert.deepStrictEqual(rots, ['[0,180,0]', '[0,-90,0]', '[0,0,0]', '[0,90,0]']);
});

t('活板门：分派 open/upside 两维（含 oak_trapdoor 别名）', () => {
    assert.strictEqual(registry.resolveWithState('minecraft:oak_trapdoor', { open_bit: 0, upside_down_bit: 0 }), 'lit:g_trapdoor');
    assert.strictEqual(registry.resolveWithState('minecraft:oak_trapdoor', { open_bit: 0, upside_down_bit: 1 }), 'lit:g_trapdoor_top');
    assert.strictEqual(registry.resolveWithState('minecraft:oak_trapdoor', { open_bit: 1, upside_down_bit: 1 }), 'lit:g_trapdoor_open');
    // 基岩原生名同样可用
    assert.strictEqual(registry.resolveWithState('minecraft:trapdoor', { open_bit: 1 }), 'lit:g_trapdoor_open');
});

t('活板门：22 种全覆盖', () => {
    const list = Object.keys(idx.javaMapByState).filter((k) => k.endsWith('_trapdoor') || k === 'minecraft:trapdoor' || k === 'minecraft:oak_trapdoor');
    assert.ok(list.length >= 22, `只有 ${list.length} 种活板门有分派`);
});

// —— 3. 门 ——
t('门：四态 identifier（下/上 × 关/开），开合几何不同', () => {
    assert.strictEqual(geoName('lit:g_wooden_door'), 'geometry.lit_door');
    assert.strictEqual(geoName('lit:g_wooden_door_upper'), 'geometry.lit_door');
    assert.strictEqual(geoName('lit:g_wooden_door_open'), 'geometry.lit_door_open');
    assert.strictEqual(geoName('lit:g_wooden_door_open_upper'), 'geometry.lit_door_open');
    assert.ok(!hasGeometrySwap('lit:g_wooden_door_open'), '打开态仍在 permutation 里切 geometry');
});

t('门：上半门用 door_*_upper 贴图，不再共用下半', () => {
    const lower = bp('lit:g_wooden_door').components['minecraft:material_instances']['*'].texture;
    const upper = bp('lit:g_wooden_door_upper').components['minecraft:material_instances']['*'].texture;
    assert.strictEqual(lower, 'ghost_door_oak_lower');
    assert.strictEqual(upper, 'ghost_door_oak_upper');
    assert.notStrictEqual(lower, upper);
});

t('门：打开态按 dir + hinge 旋转（8 档）', () => {
    const perms = bp('lit:g_wooden_door_open').permutations;
    assert.strictEqual(perms.length, 8);
    assert.ok(bp('lit:g_wooden_door_open').description.states['lit:hinge'], '打开态应声明 lit:hinge');
});

t('门：分派 open/upper 两维（含 oak_door 别名）', () => {
    assert.strictEqual(registry.resolveWithState('minecraft:oak_door', { open_bit: 0, upper_block_bit: 0 }), 'lit:g_wooden_door');
    assert.strictEqual(registry.resolveWithState('minecraft:oak_door', { open_bit: 0, upper_block_bit: 1 }), 'lit:g_wooden_door_upper');
    assert.strictEqual(registry.resolveWithState('minecraft:oak_door', { open_bit: 1, upper_block_bit: 0 }), 'lit:g_wooden_door_open');
    assert.strictEqual(registry.resolveWithState('minecraft:oak_door', { open_bit: 1, upper_block_bit: 1 }), 'lit:g_wooden_door_open_upper');
});

t('门：22 种全覆盖', () => {
    const list = Object.keys(idx.javaMapByState).filter((k) => k.endsWith('_door') || k === 'minecraft:oak_door');
    assert.ok(list.length >= 22, `只有 ${list.length} 种门有分派`);
});

// —— 4. 通用健康度 ——
t('所有形态变体的 BP：geometry 与 index 一致、replaceable、材质已注册且 png 存在', () => {
    const geoOf = { stairs: 'geometry.lit_stairs', stairs_up: 'geometry.lit_stairs_up', trapdoor: 'geometry.lit_trapdoor', trapdoor_top: 'geometry.lit_trapdoor', trapdoor_open: 'geometry.lit_trapdoor_open', door: 'geometry.lit_door', door_upper: 'geometry.lit_door', door_open: 'geometry.lit_door_open', door_open_upper: 'geometry.lit_door_open' };
    let n = 0;
    for (const [id, meta] of Object.entries(idx.blocks)) {
        if (!(meta.geometry in geoOf)) continue;
        assert.ok(fs.existsSync(bpPath(id)), `缺 BP 文件 ${id}`);
        assert.strictEqual(geoName(id), geoOf[meta.geometry], `${id} 几何引用`);
        const comp = bp(id).components;
        assert.ok(Object.prototype.hasOwnProperty.call(comp, 'minecraft:replaceable'), `${id} 缺 replaceable`);
        const inst = comp['minecraft:material_instances']['*'];
        const e = terrain[inst.texture];
        assert.ok(e && typeof e.textures === 'string', `${id} 材质 ${inst.texture} 未注册`);
        assert.ok(fs.existsSync(path.join(RP, `${e.textures}.png`)), `${id} 贴图 ${e.textures}.png 不存在`);
        n++;
    }
    assert.ok(n >= 340, `只检查到 ${n} 个形态变体`);
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail > 0 ? 1 : 0);
