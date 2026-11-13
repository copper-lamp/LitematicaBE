/**
 * test_grass_model.js — 草类建模与着色的离线回归
 *
 * 事故形态：
 *   1. 66 个 `cross_texture` 方块（草、蕨、花、树苗、蘑菇、珊瑚…）在 ghost_index 里全是
 *      `minecraft:geometry.full_block` —— 投影里显示成整块立方体，而不是原版的两片 45° 交叉板；
 *   2. 草类贴图在 BE 资源包里是**灰白的**（客户端按生物群系 tint 染色），投影不染色就是灰白；
 *      草方块六面还都贴着草顶那张灰图。
 *
 * 覆盖（不依赖 BDS）：
 *   1. geometry.lit_cross：两片 ±45° 交叉板，中心在方块中心、离地 0..16
 *   2. 草类改用染色贴图（绿分量最大、明显不是灰白）
 *   3. 草方块按面材质：顶=染色草顶、侧=grass_block_side（带土色）、底=泥土
 *   4. 双格植物上下半分派（Java half / BE upper_block_bit）
 *   5. 其它 cross 方块也都挂到 cross 几何上；材质注册、png 存在、replaceable
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

/** 贴图平均色（只统计不透明像素） */
function avgRgb(short) {
    const e = terrain[short];
    assert.ok(e && typeof e.textures === 'string', `贴图 ${short} 未注册`);
    const p = path.join(RP, `${e.textures}.png`);
    assert.ok(fs.existsSync(p), `${short} 的 png 不存在`);
    const img = png.decode(fs.readFileSync(p));
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i + 3] < 16) continue;
        r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
    }
    return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null;
}

// —— 1. 交叉板几何 ——
t('geometry.lit_cross：两片 ±45° 交叉板，16×16×0、离地 0', () => {
    const g = geo('lit_cross');
    assert.strictEqual(g.description.identifier, 'geometry.lit_cross');
    const cubes = g.bones[0].cubes;
    assert.strictEqual(cubes.length, 2, '应是两片交叉板');
    assert.deepStrictEqual(cubes.map((c) => c.rotation[1]).sort(), [-45, 45]);
    for (const c of cubes) {
        assert.deepStrictEqual(c.size, [16, 16, 0]);
        assert.deepStrictEqual(c.pivot, [0, 8, 0], '要绕方块中心竖轴旋转，否则两片会错开');
    }
});

// —— 2. 草类是染色贴图 ——
t('草/蕨/高草/大蕨/灌木都用染色贴图，且明显偏绿（不是灰白）', () => {
    const cases = [
        ['lit:g_short_grass', 'short_grass'],
        ['lit:g_fern', 'fern'],
        ['lit:g_tall_grass_top', 'tall_grass_top'],
        ['lit:g_tall_grass_bottom', 'tall_grass_bottom'],
        ['lit:g_large_fern_top', 'large_fern_top'],
        ['lit:g_large_fern_bottom', 'large_fern_bottom'],
        ['lit:g_bush', 'bush'],
    ];
    for (const [id, name] of cases) {
        const inst = bp(id).components['minecraft:material_instances']['*'];
        assert.ok(/_tint$/.test(inst.texture), `${id} 用的不是染色图：${inst.texture}`);
        const [r, g, b] = avgRgb(inst.texture);
        assert.ok(g > r + 15 && g > b + 30, `${name} 染色后不够绿（avg ${r},${g},${b}）`);
    }
});

t('枯木/干草保留自身颜色（不该被染绿）', () => {
    for (const id of ['lit:g_deadbush', 'lit:g_short_dry_grass', 'lit:g_tall_dry_grass']) {
        const inst = bp(id).components['minecraft:material_instances']['*'];
        assert.ok(!/_tint$/.test(inst.texture), `${id} 不该用染色图：${inst.texture}`);
        const [r, g, b] = avgRgb(inst.texture);
        assert.ok(r > b, `${id} 应是暖色（avg ${r},${g},${b}）`);
    }
});

// —— 3. 草方块面材质 ——
t('草方块：顶=染色草顶、侧=grass_block_side、底=泥土', () => {
    const mi = bp('lit:g_grass_block').components['minecraft:material_instances'];
    assert.strictEqual(bp('lit:g_grass_block').components['minecraft:geometry'], 'minecraft:geometry.full_block');
    assert.strictEqual(mi.up.texture, 'ghost_grass_block_top_tint');
    assert.strictEqual(mi['*'].texture, 'ghost_grass_block_side');
    assert.strictEqual(mi.down.texture, 'ghost_dirt');
    const [r, g, b] = avgRgb(mi.up.texture);
    assert.ok(g > r + 20 && g > b + 40, `草顶没染绿（avg ${r},${g},${b}）`);
    assert.strictEqual(mi['*'].render_method, 'alpha_test', '不透明侧面不该走 blend');
});

// —— 4. 双格植物上下半分派 ——
t('双格植物：Java half / BE upper_block_bit 都分到上下两个 identifier', () => {
    assert.strictEqual(registry.resolveWithState('minecraft:tall_grass', { half: 'lower' }), 'lit:g_tall_grass_bottom');
    assert.strictEqual(registry.resolveWithState('minecraft:tall_grass', { half: 'upper' }), 'lit:g_tall_grass_top');
    assert.strictEqual(registry.resolveWithState('minecraft:tall_grass', { upper_block_bit: 1 }), 'lit:g_tall_grass_top');
    assert.strictEqual(registry.resolveWithState('minecraft:large_fern', { upper_block_bit: 0 }), 'lit:g_large_fern_bottom');
    assert.strictEqual(registry.resolveWithState('minecraft:large_fern', { half: 'upper' }), 'lit:g_large_fern_top');
});

t('Java 的草植物叫 grass，与基岩名 short_grass 指向同一个 ghost', () => {
    assert.strictEqual(registry.resolve('minecraft:grass'), 'lit:g_short_grass');
    assert.strictEqual(registry.resolve('minecraft:short_grass'), 'lit:g_short_grass');
});

// —— 5. 其它 cross 方块 ——
t('cross_texture 类方块统一挂到 geometry.lit_cross（不再整块）', () => {
    const crossIds = Object.entries(idx.blocks).filter(([, m]) => m.geometry === 'cross').map(([id]) => id);
    assert.ok(crossIds.length >= 66, `只有 ${crossIds.length} 个 cross 方块（清单里 cross_texture 共 66 个须全部接上）`);
    for (const id of crossIds) {
        const def = bp(id);
        assert.strictEqual(def.components['minecraft:geometry'], 'geometry.lit_cross', `${id} 几何不对`);
        const inst = def.components['minecraft:material_instances']['*'];
        assert.ok(terrain[inst.texture], `${id} 材质 ${inst.texture} 未注册`);
        assert.ok(Object.prototype.hasOwnProperty.call(def.components, 'minecraft:replaceable'), `${id} 缺 replaceable`);
    }
});

t('花/树苗这类不再有整块 full_block 残留', () => {
    for (const name of ['minecraft:poppy', 'minecraft:oak_sapling', 'minecraft:dandelion', 'minecraft:cornflower']) {
        const id = registry.resolve(name);
        assert.strictEqual(idx.blocks[id].geometry, 'cross', `${name} 仍是 ${idx.blocks[id].geometry}`);
    }
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail > 0 ? 1 : 0);
