/**
 * test_slab_model.js — 半砖类方块（slab / 阳光传感器）的离线回归
 *
 * 覆盖（不依赖 BDS）：
 *   1. 几何：lit_slab（下半 16×8×16）、lit_slab_top（上半）、lit_daylight_detector（16×6×16），
 *      居中（origin 用中心坐标）且六面 UV 各自整图
 *   2. 套装：每个 slab 都有 bottom / top / double 三个 ghost 块，各自 BP 文件与几何引用齐全
 *   3. 材质：material_instances 的 *（侧）/up/down 分别指向侧面、顶面、底面贴图，
 *      贴图都在 terrain_texture 注册且 png 存在
 *   4. 分派：Java `type`、BE `vertical_half`、无状态回落、阳光传感器 inverted
 *   5. 不误伤：非半砖方块仍是 full_block
 *
 * 背景：早先所有 slab 都映射到 `minecraft:geometry.full_block` + 单张 side/top 贴图，
 * 投影里半砖会显示成整块、顶面还贴的是侧面图（石英/砂岩/石头半砖最明显）。
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

const geo = (name) => readJson(path.join(RP, 'models', 'blocks', `${name}.json`))['minecraft:geometry'][0];
const cubeOf = (name) => geo(name).bones[0].cubes[0];
const bpFile = (id) => path.join(BP, 'blocks', `${id.replace(/^lit:/, '')}.json`);
const blockDef = (id) => readJson(bpFile(id))['minecraft:block'];
const FACES = ['north', 'south', 'east', 'west', 'up', 'down'];

/** 贴图短名 -> png 是否存在（terrain_texture 里的路径要能落地） */
function texExists(short) {
    const e = terrain[short];
    if (!e || typeof e.textures !== 'string') return false;
    return fs.existsSync(path.join(RP, `${e.textures}.png`));
}

// ── 1. 几何 ─────────────────────────────────────────────────────────────
t('几何 lit_slab：下半 16×8×16，原点居中在方块角', () => {
    const c = cubeOf('lit_slab');
    assert.deepStrictEqual(c.origin, [-8, 0, -8]);
    assert.deepStrictEqual(c.size, [16, 8, 16]);
    assert.strictEqual(geo('lit_slab').description.identifier, 'geometry.lit_slab');
});

t('几何 lit_slab_top：上半 16×8×16，抬到 y=8', () => {
    const c = cubeOf('lit_slab_top');
    assert.deepStrictEqual(c.origin, [-8, 8, -8]);
    assert.deepStrictEqual(c.size, [16, 8, 16]);
    assert.strictEqual(geo('lit_slab_top').description.identifier, 'geometry.lit_slab_top');
});

t('几何 lit_daylight_detector：16×6×16（不是整块也不是 8/16）', () => {
    const c = cubeOf('lit_daylight_detector');
    assert.deepStrictEqual(c.origin, [-8, 0, -8]);
    assert.deepStrictEqual(c.size, [16, 6, 16]);
    assert.strictEqual(geo('lit_daylight_detector').description.identifier, 'geometry.lit_daylight_detector');
});

t('三个半格几何的六面 UV 都是整图 16×16（每面独立取样）', () => {
    for (const n of ['lit_slab', 'lit_slab_top', 'lit_daylight_detector']) {
        const uv = cubeOf(n).uv;
        for (const f of FACES) {
            assert.ok(uv[f], `${n} 缺 ${f} 面 uv`);
            assert.deepStrictEqual(uv[f].uv, [0, 0], `${n}.${f} uv 起点`);
            assert.deepStrictEqual(uv[f].uv_size, [16, 16], `${n}.${f} uv 尺寸`);
        }
    }
});

// ── 2. 套装完整性（bottom / top / double） ─────────────────────────────
const slabIds = Object.keys(idx.blocks).filter((id) => idx.blocks[id].geometry === 'slab');
const detectorIds = Object.keys(idx.blocks).filter((id) => idx.blocks[id].geometry === 'daylight_detector');

t('半砖几何组数量合理（>= 100）', () => {
    assert.ok(slabIds.length >= 100, `只有 ${slabIds.length} 组 slab 几何`);
    assert.ok(detectorIds.length >= 2, `只有 ${detectorIds.length} 个阳光传感器几何`);
});

t('每个半砖都有 top / double 兄弟块，且几何各自不同', () => {
    for (const id of slabIds) {
        const topId = `${id}_top`;
        const dblId = `${id}_double`;
        assert.ok(idx.blocks[topId], `${id} 缺 ${topId}`);
        assert.ok(idx.blocks[dblId], `${id} 缺 ${dblId}`);
        assert.strictEqual(idx.blocks[topId].geometry, 'slab_top', `${topId} geometry`);
        assert.strictEqual(idx.blocks[dblId].geometry, 'double_slab', `${dblId} geometry`);
    }
});

t('每个半砖块（含 top/double）都有 BP 定义 + replaceable（玩家能在 ghost 位上放方块）', () => {
    let n = 0;
    for (const id of slabIds) {
        for (const gid of [id, `${id}_top`, `${id}_double`]) {
            assert.ok(fs.existsSync(bpFile(gid)), `缺 BP 文件 ${gid}`);
            const comp = blockDef(gid).components;
            assert.ok(Object.prototype.hasOwnProperty.call(comp, 'minecraft:replaceable'), `${gid} 缺 replaceable`);
            n++;
        }
    }
    assert.ok(n >= 300, `只检查到 ${n} 个半砖 block 定义`);
});

t('BP 引用的几何与 index 记录一致', () => {
    const expect = { slab: 'geometry.lit_slab', slab_top: 'geometry.lit_slab_top', double_slab: 'minecraft:geometry.full_block' };
    for (const id of slabIds) {
        for (const gid of [id, `${id}_top`, `${id}_double`]) {
            const want = expect[idx.blocks[gid].geometry];
            assert.strictEqual(blockDef(gid).components['minecraft:geometry'], want, `${gid} 几何引用`);
        }
    }
    for (const id of detectorIds) {
        assert.strictEqual(blockDef(id).components['minecraft:geometry'], 'geometry.lit_daylight_detector', `${id} 几何引用`);
    }
});

// ── 3. 面材质 ──────────────────────────────────────────────────────────
t('材质实例：* 为侧面，up/down 分别为顶面/底面贴图，且全部已注册并存在 png', () => {
    for (const id of [...slabIds, ...detectorIds]) {
        const mi = blockDef(id).components['minecraft:material_instances'];
        assert.ok(mi['*'] && mi.up && mi.down, `${id} 面材质不齐（${Object.keys(mi).join(',')}）`);
        const meta = idx.blocks[id];
        // index 记录的 texture 是侧面短名（材料统计用）
        assert.strictEqual(mi['*'].texture, `ghost_${meta.texture}`, `${id} 侧面贴图与 index 不一致`);
        for (const [face, inst] of Object.entries(mi)) {
            assert.ok(texExists(inst.texture), `${id}.${face} 贴图 ${inst.texture} 未注册或 png 缺失`);
            assert.strictEqual(inst.render_method, 'alpha_test', `${id}.${face} render_method 应为 alpha_test（不透明贴图不走 blend）`);
        }
    }
});

t('石英台阶：侧/顶/底三张不同（顶面不是侧面图）', () => {
    const mi = blockDef('lit:g_quartz_slab').components['minecraft:material_instances'];
    assert.strictEqual(mi['*'].texture, 'ghost_quartz_block_side');
    assert.strictEqual(mi.up.texture, 'ghost_quartz_block_top');
    assert.strictEqual(mi.down.texture, 'ghost_quartz_block_bottom');
});

t('砂岩/石头半砖：顶面用顶图、底面用底图', () => {
    const sand = blockDef('lit:g_sandstone_slab').components['minecraft:material_instances'];
    assert.strictEqual(sand['*'].texture, 'ghost_sandstone');
    assert.strictEqual(sand.up.texture, 'ghost_sandstone_top');
    assert.strictEqual(sand.down.texture, 'ghost_sandstone_bottom');
    const stone = blockDef('lit:g_stone_slab').components['minecraft:material_instances'];
    assert.strictEqual(stone['*'].texture, 'ghost_stone_slab_side');
    assert.strictEqual(stone.up.texture, 'ghost_stone_slab_top');
});

t('阳光传感器：顶面为硅板图、侧面为木框图（两种都有）', () => {
    const a = blockDef('lit:g_daylight_detector').components['minecraft:material_instances'];
    const b = blockDef('lit:g_daylight_detector_inverted').components['minecraft:material_instances'];
    assert.strictEqual(a.up.texture, 'ghost_daylight_detector_top');
    assert.strictEqual(a['*'].texture, 'ghost_daylight_detector_side');
    assert.strictEqual(b.up.texture, 'ghost_daylight_detector_inverted_top');
    assert.strictEqual(b['*'].texture, 'ghost_daylight_detector_side');
});

// ── 4. 状态分派 ────────────────────────────────────────────────────────
t('Java type=bottom/top/double → 三段几何各就其位', () => {
    assert.strictEqual(registry.resolveWithState('minecraft:quartz_slab', { type: 'bottom' }), 'lit:g_quartz_slab');
    assert.strictEqual(registry.resolveWithState('minecraft:quartz_slab', { type: 'top' }), 'lit:g_quartz_slab_top');
    assert.strictEqual(registry.resolveWithState('minecraft:quartz_slab', { type: 'double' }), 'lit:g_quartz_slab_double');
});

t('BE vertical_half=bottom/top 同样命中（.mcstructure 来源）', () => {
    assert.strictEqual(registry.resolveWithState('minecraft:oak_slab', { vertical_half: 'top' }), 'lit:g_oak_slab_top');
    assert.strictEqual(registry.resolveWithState('minecraft:oak_slab', { vertical_half: 'bottom' }), 'lit:g_oak_slab');
});

t('状态全丢（MEGA 分块重载）回落为下半砖，而不是整块/兜底块', () => {
    assert.strictEqual(registry.resolveWithState('minecraft:oak_slab', {}), 'lit:g_oak_slab');
    assert.strictEqual(registry.resolve('minecraft:oak_slab'), 'lit:g_oak_slab');
});

t('BE 双半砖独立方块名 → double 几何（三种命名排法都认）', () => {
    assert.strictEqual(registry.resolve('minecraft:double_stone_slab'), 'lit:g_stone_slab_double');
    assert.strictEqual(registry.resolve('minecraft:oak_double_slab'), 'lit:g_oak_slab_double');
    assert.strictEqual(registry.resolve('minecraft:waxed_double_cut_copper_slab'), 'lit:g_waxed_cut_copper_slab_double');
});

t('阳光传感器 inverted=true → 反相贴图块', () => {
    assert.strictEqual(registry.resolveWithState('minecraft:daylight_detector', { inverted: false }), 'lit:g_daylight_detector');
    assert.strictEqual(registry.resolveWithState('minecraft:daylight_detector', { inverted: true }), 'lit:g_daylight_detector_inverted');
});

t('半砖 ghost 无 state 声明（形状由 identifier 承载，不靠 permutation 切几何）', () => {
    assert.strictEqual(registry.buildStates('minecraft:quartz_slab', { type: 'top' }), null);
});

// ── 5. 不误伤 ──────────────────────────────────────────────────────────
t('非半砖方块仍是 full_block（木板的映射没被顶掉）', () => {
    assert.strictEqual(registry.resolve('minecraft:oak_planks'), 'lit:g_oak_planks');
    assert.strictEqual(idx.blocks['lit:g_oak_planks'].geometry, 'full_block');
    const mi = blockDef('lit:g_oak_planks').components['minecraft:material_instances'];
    assert.strictEqual(mi['*'].texture, 'ghost_oak_planks');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail > 0 ? 1 : 0);
