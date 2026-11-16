/**
 * test_ghost_torch_model.js — ghost 火把建模/贴图/朝向的离线回归
 *
 * 事故形态（真机）：
 *   `lit:g_torch` / `lit:g_soul_torch` 的 BP 定义用的是 `minecraft:geometry.full_block`，
 *   贴图铺满整个立方体 —— 投影里火把 ghost 显示成一个"方块"，而不是原版火把模型。
 *   同时 `lit_torch` 模型里还多出两片 16×16 的十字面，也不是原版火把的几何。
 *
 * 修复约定（与原版一致）：
 *   1. geometry.lit_torch 只有一个 2×10×2 的棍（无十字面），UV 取原版火把贴图：
 *      侧面 [7,6] 2×10、顶/底 [7,13] 2×2。
 *   2. `lit:g_torch` / `lit:g_soul_torch` 用 geometry.lit_torch + `lit:dir`(0-4) + 5 个
 *      transformation permutation；空索引默认竖立（dir=4）。
 *   3. ghost_index 的 lit:dir 同时接受 BE `torch_facing_direction` 和 Java `facing`
 *      （fallbackFrom），否则 .litematic 投影的墙上火把会退回竖立。
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const PLUGIN = path.resolve(__dirname, '..');
const RP = path.join(PLUGIN, 'resources', 'addon', 'LitematicaBE_RP');
const BP = path.join(PLUGIN, 'resources', 'addon', 'LitematicaBE_BP');
const png = require(path.join(PLUGIN, 'tools', 'lib', 'png.js'));
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
const bp = (id) => readJson(path.join(BP, 'blocks', `${id.replace(/^lit:/, '')}.json`))['minecraft:block'];
const geo = (name) => readJson(path.join(RP, 'models', 'blocks', `${name}.json`))['minecraft:geometry'][0];

// —— 1. 原版火把模型 ——
t('geometry.lit_torch：只有一个 2×10×2 的棍，没有 16×16 十字面', () => {
    const g = geo('lit_torch');
    assert.strictEqual(g.description.identifier, 'geometry.lit_torch');
    const cubes = g.bones[0].cubes;
    assert.strictEqual(cubes.length, 1, `应只有一根火把，实际 ${cubes.length} 个 cube`);
    const c = cubes[0];
    assert.deepStrictEqual(c.origin, [-1, 0, -1]);
    assert.deepStrictEqual(c.size, [2, 10, 2], '火把棍尺寸应为 2×10×2');
});

t('geometry.lit_torch：UV 取原版火把贴图（侧面 7,6 / 2×10；顶底 7,13 / 2×2）', () => {
    const c = geo('lit_torch').bones[0].cubes[0];
    for (const face of ['north', 'south', 'east', 'west']) {
        assert.deepStrictEqual(c.uv[face].uv, [7, 6], `${face} 侧面 UV 起点不对`);
        assert.deepStrictEqual(c.uv[face].uv_size, [2, 10], `${face} 侧面 UV 尺寸不对`);
    }
    for (const face of ['up', 'down']) {
        assert.deepStrictEqual(c.uv[face].uv, [7, 13], `${face} 顶/底 UV 起点不对（不能取火焰区域）`);
        assert.deepStrictEqual(c.uv[face].uv_size, [2, 2]);
    }
});

// —— 2. ghost 方块定义 ——
t('lit:g_torch / lit:g_soul_torch 用 geometry.lit_torch，不再是 full_block', () => {
    for (const id of ['lit:g_torch', 'lit:g_soul_torch']) {
        const def = bp(id);
        assert.strictEqual(def.components['minecraft:geometry'], 'geometry.lit_torch', `${id} 几何不对`);
        assert.notStrictEqual(def.components['minecraft:geometry'], 'minecraft:geometry.full_block');
        assert.deepStrictEqual(def.description.states['lit:dir'].values, { min: 0, max: 4 }, `${id} 缺 lit:dir 状态`);
        assert.strictEqual((def.permutations || []).length, 5, `${id} 应有 5 个朝向 permutation`);
    }
});

t('火把 ghost 的贴图已注册且 png 存在（16×16、非空）', () => {
    for (const [id, tex] of [['lit:g_torch', 'ghost_torch'], ['lit:g_soul_torch', 'ghost_soul_torch']]) {
        const inst = bp(id).components['minecraft:material_instances']['*'];
        assert.strictEqual(inst.texture, tex, `${id} 材质名不对`);
        const e = terrain[tex];
        assert.ok(e && typeof e.textures === 'string', `${tex} 未在 terrain_texture 注册`);
        const p = path.join(RP, `${e.textures}.png`);
        assert.ok(fs.existsSync(p), `${tex} 的 png 不存在: ${p}`);
        const img = png.decode(fs.readFileSync(p));
        assert.strictEqual(img.width, 16, `${tex} 应为 16px 宽`);
        assert.strictEqual(img.height, 16);
        let opaque = 0;
        for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 0) opaque++;
        assert.ok(opaque > 0, `${tex} 是全透明图`);
    }
});

t('火把 ghost 的 index 元数据与 BP 一致（geometry=torch）', () => {
    for (const id of ['lit:g_torch', 'lit:g_soul_torch', 'lit:g_redstone_torch']) {
        assert.strictEqual(idx.blocks[id].geometry, 'torch', `${id} 的 index geometry 不是 torch`);
        const spec = idx.blocks[id].states['lit:dir'];
        assert.strictEqual(spec.from, 'torch_facing_direction');
        assert.strictEqual(spec.fallbackFrom, 'facing', `${id} 缺 Java facing 回退`);
        assert.deepStrictEqual(spec.map, { north: 0, east: 1, south: 2, west: 3, top: 4 });
    }
});

// —— 3. 朝向状态 ——
t('buildStates：竖立 top→4，墙上 south→2，Java facing 也能映射', () => {
    assert.deepStrictEqual(registry.buildStates('minecraft:torch', { torch_facing_direction: 'top' }), { 'lit:dir': 4 });
    assert.deepStrictEqual(registry.buildStates('minecraft:torch', { torch_facing_direction: 'south' }), { 'lit:dir': 2 });
    assert.deepStrictEqual(registry.buildStates('minecraft:wall_torch', { facing: 'north' }), { 'lit:dir': 0 });
    assert.deepStrictEqual(registry.buildStates('minecraft:wall_torch', { facing: 'south' }), { 'lit:dir': 2 });
    assert.deepStrictEqual(registry.buildStates('minecraft:soul_wall_torch', { facing: 'east' }), { 'lit:dir': 1 });
});

t('resolve：Java torch / wall_torch / soul 都指向正确的 ghost', () => {
    assert.strictEqual(registry.resolveWithState('minecraft:torch', { torch_facing_direction: 'south' }), 'lit:g_torch');
    assert.strictEqual(registry.resolveWithState('minecraft:wall_torch', { facing: 'north' }), 'lit:g_torch');
    assert.strictEqual(registry.resolveWithState('minecraft:soul_wall_torch', { facing: 'west' }), 'lit:g_soul_torch');
    assert.strictEqual(registry.resolveWithState('minecraft:redstone_torch', { torch_facing_direction: 'east' }), 'lit:g_redstone_torch');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail > 0 ? 1 : 0);
