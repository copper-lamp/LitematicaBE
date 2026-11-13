/**
 * test_directional_states.js — 方向族方块状态回归（2026-11-13 实机事故的钉子）
 *
 * 事故链（务必保留这些断言，否则同样的问题会复发）：
 *   1. `.mcstructure` 加载时状态键被去掉 `minecraft:` 前缀（给 ghost 的 spec.from 短键用），
 *      但 BDS 对部分方块只认**带命名空间**的状态名（observer 是 `minecraft:facing_direction`）。
 *      写回世界时若用短键 → 状态被丢弃 → 观察者落到默认朝向（红点面朝上）。
 *      → 修法：loader 额外保留 `rawState`（原始键），直接放置/轻松放置优先用它。
 *   2. `DIRECTIONAL_USE_PISTON_FACING` 曾把活塞专用表全局套给 8 个方向族方块，
 *      而活塞表与通用表水平四向**正好互换** → dispenser 等整体反 180°。
 *      → 修法：只有活塞族用活塞表；其余用 BE_FACING_MAP；observer 单独走字符串分支。
 *   3. 保存 `.litematic` 时 `minecraft:facing_direction` 因带前缀没被匹配，原样漏进 Java 调色板。
 *      → 修法：状态键先去前缀再匹配；字符串值直接映射 Java 的 `facing`。
 */
const assert = require('assert');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');
const { BlockStateConverters } = require(path.join(PLUGIN, 'src', 'mappings', 'BlockStateConverters.js'));
const { BlockConversions } = require(path.join(PLUGIN, 'src', 'easyplace', 'BlockConversions.js'));
const { BlockMatcher } = require(path.join(PLUGIN, 'src', 'easyplace', 'BlockMatcher.js'));
const { McstructureLoader } = require(path.join(PLUGIN, 'src', 'core', 'McstructureLoader.js'));

let pass = 0;
let fail = 0;
function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

const silent = { info() {}, warn() {}, error() {}, debug() {} };
global.logger = silent;

const states = new BlockStateConverters();

console.log('\n=== 方向族：Java → 基岩 ===');

check('observer：产出带命名空间的字符串状态（不是 0-5 编号）', () => {
    const be = states.convertJavaToBedrock('minecraft:observer', { facing: 'west', powered: 'false' });
    assert.strictEqual(be['minecraft:facing_direction'], 'west',
        'observer 的基岩状态名是 minecraft:facing_direction，且值是字符串');
    assert.strictEqual(be.facing, undefined, 'Java 的 facing 必须被消费掉');
    assert.strictEqual(be.facing_direction, undefined, '不能留下短键（BDS 不认）');
    assert.strictEqual(be.powered_bit, 0);
});

check('dispenser：通用表（east→5 / south→3 / west→4 / north→2），不是活塞表', () => {
    const map = { east: 5, south: 3, west: 4, north: 2 };
    for (const [facing, expected] of Object.entries(map)) {
        const be = states.convertJavaToBedrock('minecraft:dispenser', { facing });
        assert.strictEqual(be.facing_direction, expected, `dispenser facing=${facing}`);
    }
});

check('hopper / dropper / crafter / furnace 同样使用通用表', () => {
    for (const name of ['minecraft:hopper', 'minecraft:dropper', 'minecraft:crafter',
        'minecraft:furnace', 'minecraft:smoker', 'minecraft:blast_furnace']) {
        assert.strictEqual(states.convertJavaToBedrock(name, { facing: 'east' }).facing_direction, 5, `${name} east`);
        assert.strictEqual(states.convertJavaToBedrock(name, { facing: 'north' }).facing_direction, 2, `${name} north`);
    }
});

check('活塞族仍然使用活塞专用表（east→4 / north→3），别被上面的改动带跑', () => {
    assert.strictEqual(states.convertJavaToBedrock('minecraft:piston', { facing: 'east' }).facing_direction, 4);
    assert.strictEqual(states.convertJavaToBedrock('minecraft:piston', { facing: 'north' }).facing_direction, 3);
    assert.strictEqual(states.convertJavaToBedrock('minecraft:sticky_piston', { facing: 'south' }).facing_direction, 2);
});

check('已经是基岩状态的输入不被二次改写（无 facing 键 → 原样透传）', () => {
    const be = states.convertJavaToBedrock('minecraft:dispenser', { facing_direction: 5, triggered_bit: 0 });
    assert.strictEqual(be.facing_direction, 5);
    const obs = states.convertJavaToBedrock('minecraft:observer', { 'minecraft:facing_direction': 'west', powered_bit: 0 });
    assert.strictEqual(obs['minecraft:facing_direction'], 'west');
});

console.log('\n=== .mcstructure 原始状态键（rawState）===');

check('loader 同时保留短键 state 与原始键 rawState', () => {
    const loader = new McstructureLoader(silent);
    const palette = [{ name: 'minecraft:observer', states: { 'minecraft:facing_direction': 'west', powered_bit: 0 } }];
    const blocks = loader._decodeBlocks(palette, [[0], []], 1, 1, 1, true);
    assert.strictEqual(blocks.length, 1);
    assert.deepStrictEqual(blocks[0].state.facing_direction, 'west', 'state 仍是去前缀版（ghost 依赖）');
    assert.deepStrictEqual(blocks[0].rawState['minecraft:facing_direction'], 'west',
        'rawState 必须保留 BDS 原始键名（写回世界依赖）');
});

check('短键方块（dispenser）rawState 与 state 内容一致', () => {
    const loader = new McstructureLoader(silent);
    const palette = [{ name: 'minecraft:dispenser', states: { facing_direction: 5, triggered_bit: 0 } }];
    const blocks = loader._decodeBlocks(palette, [[0], []], 1, 1, 1, true);
    assert.strictEqual(blocks[0].rawState.facing_direction, 5);
    assert.strictEqual(blocks[0].state.facing_direction, 5);
});

console.log('\n=== 保存 .litematic：状态键前缀 ===');

check('convertStateKeyValue 识别 minecraft:facing_direction 并映射 Java facing', () => {
    const { SchematicSaver } = require(path.join(PLUGIN, 'src', 'core', 'SchematicSaver.js'));
    // 只借原型方法，不实例化（构造要 File API）
    const conv = (k, v) => SchematicSaver.prototype.convertStateKeyValue.call({}, k, v, 'minecraft:observer');
    assert.deepStrictEqual(conv('minecraft:facing_direction', 'west'), { key: 'facing', value: 'west' },
        '字符串值直接透传成 Java facing');
    assert.deepStrictEqual(conv('facing_direction', 5), { key: 'facing', value: 'east' },
        '数字值仍走通用表');
    assert.deepStrictEqual(conv('facing_direction', 3), { key: 'facing', value: 'south' });
});

console.log('\n=== 轻松放置/纠错的状态过滤与比较 ===');

check('filterDirectionStates 保留带前缀方向键的原键名', () => {
    const out = BlockConversions.filterDirectionStates({ 'minecraft:facing_direction': 'west', age: 7 });
    assert.strictEqual(out['minecraft:facing_direction'], 'west', '方向键保留原始键名');
    assert.strictEqual(out.age, undefined, '非方向类噪声键应被过滤');
});

check('BlockMatcher 对两种键写法都能取到值（避免误判不一致）', () => {
    const m = new BlockMatcher();
    assert.strictEqual(m.getStateValue({ 'minecraft:facing_direction': 'west' }, 'facing_direction'), 'west');
    assert.strictEqual(m.getStateValue({ facing_direction: 5 }, 'minecraft:facing_direction'), 5);
});

console.log('\n=== ghost 索引：方向族 lit:facing ===');

const { GhostBlockRegistry } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostBlockRegistry.js'));
const registry = new GhostBlockRegistry(path.join(PLUGIN, 'resources', 'data', 'ghost_index.json'));

check('observer：观察面字符串 → lit:facing 直映（ghost front 是侦测面/脸，不是红点面）', () => {
    assert.ok(registry.ready, 'ghost_index 应就绪');
    // 语义：facing_direction = 侦测面（脸）朝向；ghost 模型 front 面贴的正是 ghost_observer_front.png（脸）
    // → 水平四向同向直映。红点在 back 面（ghost_observer_back.png），与 facing 相反，但那不是 front。
    // lit:facing 的实际朝向：2=北 3=南 4=东 5=西（由 BP permutations 反推，dispenser 实测一致）
    assert.deepStrictEqual(registry.buildStates('minecraft:observer', { facing_direction: 'west' }), { 'lit:facing': 5 });
    assert.deepStrictEqual(registry.buildStates('minecraft:observer', { facing_direction: 'north' }), { 'lit:facing': 2 });
    assert.deepStrictEqual(registry.buildStates('minecraft:observer', { facing_direction: 'east' }), { 'lit:facing': 4 });
    assert.deepStrictEqual(registry.buildStates('minecraft:observer', { facing_direction: 'south' }), { 'lit:facing': 3 });
    // 上下与 dispenser **相反**（2026-11-13 真机校准：X 轴旋转不抵消默认面差异）
    assert.deepStrictEqual(registry.buildStates('minecraft:observer', { facing_direction: 'up' }), { 'lit:facing': 0 });
    assert.deepStrictEqual(registry.buildStates('minecraft:observer', { facing_direction: 'down' }), { 'lit:facing': 1 });
    // 旧 int 格式同为观察面语义 → 只换 0/1
    assert.deepStrictEqual(registry.buildStates('minecraft:observer', { facing_direction: 2 }), { 'lit:facing': 2 });
    assert.deepStrictEqual(registry.buildStates('minecraft:observer', { facing_direction: 0 }), { 'lit:facing': 1 });
});

check('dispenser/dropper：mcstructure 的 int 交换东西，litematic 的 Java facing 走 fallback+map', () => {
    // 数据 facing_direction：2=北 3=南 4=西 5=东；lit:facing：2=北 3=南 4=东 5=西 → 4/5 交换
    assert.deepStrictEqual(registry.buildStates('minecraft:dispenser', { facing_direction: 5 }), { 'lit:facing': 4 });
    assert.deepStrictEqual(registry.buildStates('minecraft:dispenser', { facing_direction: 4 }), { 'lit:facing': 5 });
    assert.deepStrictEqual(registry.buildStates('minecraft:dispenser', { facing_direction: 2 }), { 'lit:facing': 2 });
    assert.deepStrictEqual(registry.buildStates('minecraft:dispenser', { facing_direction: 3 }), { 'lit:facing': 3 });
    // 上下：dispenser 按实测颠倒互换 0/1
    assert.deepStrictEqual(registry.buildStates('minecraft:dispenser', { facing_direction: 1 }), { 'lit:facing': 0 });
    assert.deepStrictEqual(registry.buildStates('minecraft:dispenser', { facing_direction: 0 }), { 'lit:facing': 1 });
    // .litematic 数据只有 Java 的 facing（字符串）→ fallbackFrom + 同一套 map
    assert.deepStrictEqual(registry.buildStates('minecraft:dispenser', { facing: 'east' }), { 'lit:facing': 4 });
    assert.deepStrictEqual(registry.buildStates('minecraft:dropper', { facing: 'north' }), { 'lit:facing': 2 });
});

console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
