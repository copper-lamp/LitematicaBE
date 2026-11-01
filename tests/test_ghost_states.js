/**
 * test_ghost_states.js — 自定义 ghost 方块 states（朝向）链路离线回归
 *
 * 不依赖 BDS。覆盖：
 *   1. GhostBlockRegistry.buildStates：从 weirdo_direction 归一化 lit:dir、缺键补默认、越界 clamp、严格出键
 *   2. 无 state 载体的 ghost（如 oak_planks）返回 null（走旧路径）
 *   3. SurfaceExtractor：形状方块（stairs）不遮挡相邻格，避免投影出洞
 *   4. GhostRenderer._statesEqual：一致 / 不同 / 缺键 / 冒号下划线变体
 *   5. GhostRenderer._buildGhostNbt：NbtCompound 不可用时回落普通对象（含 states）
 */
const assert = require('assert');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');
const { GhostBlockRegistry } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostBlockRegistry.js'));
const { SurfaceExtractor, isNonOccludingShape } = require(path.join(PLUGIN, 'src', 'ghost', 'SurfaceExtractor.js'));
const { GhostRenderer } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostRenderer.js'));

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) { console.log(`  ❌ ${name}`); console.log(`     ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n     ') : e}`); fail++; }
}

// 用真实索引（resources/data/ghost_index.json），与运行时同批
const registry = new GhostBlockRegistry(path.join(PLUGIN, 'resources', 'data', 'ghost_index.json'));
assert.ok(registry.ready, 'ghost_index 应就绪（资源未重建？先 npm run build 或 node tools/ghost_map_apply.js --build）');

console.log('\n=== ghost states 链路 ===');

t('registry 就绪且 oak_stairs 映射到 lit:g_oak_stairs', () => {
    assert.strictEqual(registry.resolve('minecraft:oak_stairs'), 'lit:g_oak_stairs');
});

t('buildStates：weirdo_direction=2 -> lit:dir=2（严格只出声明键）', () => {
    const st = registry.buildStates('minecraft:oak_stairs', { weirdo_direction: 2 });
    assert.deepStrictEqual(st, { 'lit:dir': 2 });
});

t('buildStates：缺 weirdo_direction -> 补默认 0', () => {
    const st = registry.buildStates('minecraft:oak_stairs', {});
    assert.deepStrictEqual(st, { 'lit:dir': 0 });
});

t('buildStates：越界 clamp（weirdo_direction=9 -> 3）', () => {
    const st = registry.buildStates('minecraft:oak_stairs', { weirdo_direction: 9 });
    assert.deepStrictEqual(st, { 'lit:dir': 3 });
});

t('buildStates：非 stairs（oak_planks 无 state 载体）-> null', () => {
    const st = registry.buildStates('minecraft:oak_planks', {});
    assert.strictEqual(st, null);
});

t('buildStates：未知方块 -> null（兜底 generic 无声明）', () => {
    const st = registry.buildStates('minecraft:not_a_real_block_xyz', {});
    assert.strictEqual(st, null);
});

t('isNonOccludingShape：oak_stairs / stone_brick_wall 为 true', () => {
    assert.ok(isNonOccludingShape('minecraft:oak_stairs'));
    assert.ok(isNonOccludingShape('minecraft:stone_brick_wall'));
});

t('isNonOccludingShape：stone / planks 为 false', () => {
    assert.ok(!isNonOccludingShape('minecraft:stone'));
    assert.ok(!isNonOccludingShape('minecraft:oak_planks'));
});

t('SurfaceExtractor：楼梯邻居不算遮挡（cull 不出洞）', () => {
    const ex = new SurfaceExtractor();
    // 两格相邻楼梯，各自都不该被对方"遮挡"掉
    const blocks = [
        { pos: [0, 0, 0], name: 'minecraft:oak_stairs', state: {} },
        { pos: [1, 0, 0], name: 'minecraft:oak_stairs', state: {} },
    ];
    const r = ex.extract({ blocks }, { cull: true });
    assert.strictEqual(r.blocks.length, 2, '相邻楼梯都不该被剔除');
});

t('_statesEqual：一致 -> true', () => {
    const r = Object.create(GhostRenderer.prototype);
    assert.ok(r._statesEqual({ 'lit:dir': 1 }, { 'lit:dir': 1 }));
});

t('_statesEqual：不同 -> false', () => {
    const r = Object.create(GhostRenderer.prototype);
    assert.ok(!r._statesEqual({ 'lit:dir': 0 }, { 'lit:dir': 1 }));
});

t('_statesEqual：缺键 -> false（需重写）', () => {
    const r = Object.create(GhostRenderer.prototype);
    assert.ok(!r._statesEqual({}, { 'lit:dir': 1 }));
});

t('_statesEqual：冒号/下划线变体命中（getBlockState 可能转 _）', () => {
    const r = Object.create(GhostRenderer.prototype);
    assert.ok(r._statesEqual({ 'lit_dir': 2 }, { 'lit:dir': 2 }));
});

t('_buildGhostNbt：NbtCompound 不可用 -> 回落普通对象（含 states）', () => {
    const r = Object.create(GhostRenderer.prototype);
    const nbt = r._buildGhostNbt('lit:g_oak_stairs', { 'lit:dir': 3 });
    assert.strictEqual(nbt.name, 'lit:g_oak_stairs');
    assert.deepStrictEqual(nbt.states, { 'lit:dir': 3 });
    assert.strictEqual(nbt.version, 17959425);
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail > 0 ? 1 : 0);
