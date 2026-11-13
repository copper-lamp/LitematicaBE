/**
 * test_place_coords.js — 投影"生成位置"回归（3.0.4 修复）
 *
 * 用户报的现象：放置新投影时在面板里改坐标没用，投影永远落在玩家脚下。
 *
 * 三个根因，逐条钉死：
 *   1. 坐标输入是表单的第 9~11 个控件，靠 `labelCount` 硬编码下标取数。
 *      一旦 label 在某 LSE 实现里不占位，data[8] 取到 null → 全部回退默认坐标。
 *      → 现在 input 必须是表单前三个控件，data[0..2] 恒为 X/Y/Z。
 *   2. `parseInt(v) || default` 会把玩家输入的 `0`（以及任何 falsy）当成"没填"。
 *      → 现在统一走 `toIntOr`：只有空串/非数字才回退。
 *   3. `/lit placeat 100 64 200` 走短命令的 RawText 路径（拿不到 x/y/z 三个 Int），
 *      长命令也可能先匹配 RawText 重载 → 报"缺少坐标"，玩家只能退回按玩家位置放置。
 *      → 现在 `handlePlaceAtCommand` 从 argText 兜底解析，且支持 `~` 相对坐标。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');
const { toIntOr, clampCoord, parseXYZText, COORD_LIMIT } =
    require(path.join(PLUGIN, 'src', 'utils', 'coordText.js'));

const UI_FILE = path.join(PLUGIN, 'src', 'ui', 'UIManager.js');
const INDEX_FILE = path.join(PLUGIN, 'index.js');

let pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) { console.log(`  ❌ ${name}\n     ${e && e.message ? e.message : e}`); fail++; }
}

console.log('\n=== 投影生成位置 ===');

check('toIntOr：0 / 负数 / 小数 / 空串 / 非数字', () => {
    assert.strictEqual(toIntOr('0', 99), 0, '"0" 是合法坐标，不能被当成没填');
    assert.strictEqual(toIntOr(0, 99), 0);
    assert.strictEqual(toIntOr('-372', 99), -372);
    assert.strictEqual(toIntOr(' 64 ', 99), 64);
    assert.strictEqual(toIntOr('100.9', 99), 100, '小数取整');
    assert.strictEqual(toIntOr('', 99), 99);
    assert.strictEqual(toIntOr('   ', 99), 99);
    assert.strictEqual(toIntOr('abc', 99), 99);
    assert.strictEqual(toIntOr(undefined, 99), 99);
    assert.strictEqual(toIntOr(null, 99), 99);
    assert.strictEqual(toIntOr(NaN, 99), 99);
});

check('clampCoord：夹到世界范围内', () => {
    assert.strictEqual(clampCoord(0), 0);
    assert.strictEqual(clampCoord(-1.7), -2);
    assert.strictEqual(clampCoord(COORD_LIMIT + 5000), COORD_LIMIT);
    assert.strictEqual(clampCoord(-COORD_LIMIT - 5000), -COORD_LIMIT);
    assert.strictEqual(clampCoord(NaN), 0);
});

check('parseXYZText：空格 / 逗号 / 负坐标', () => {
    assert.deepStrictEqual(parseXYZText('100 64 200'), [100, 64, 200]);
    assert.deepStrictEqual(parseXYZText('100,64,200'), [100, 64, 200]);
    assert.deepStrictEqual(parseXYZText('  -31   87  22 '), [-31, 87, 22]);
    assert.deepStrictEqual(parseXYZText('0 0 0'), [0, 0, 0], '原点必须是合法坐标');
    assert.strictEqual(parseXYZText('100 64'), null, '不足三个分量');
    assert.strictEqual(parseXYZText('100 64 abc'), null);
    assert.strictEqual(parseXYZText(''), null);
    assert.strictEqual(parseXYZText(undefined), null);
});

check('parseXYZText：~ 相对玩家坐标', () => {
    const base = [100.7, 64, -20.2];
    assert.deepStrictEqual(parseXYZText('~ ~ ~', base), [100, 64, -21], '~ 取玩家位置并向下取整');
    assert.deepStrictEqual(parseXYZText('~ ~5 ~-3', base), [100, 69, -24]);
    assert.deepStrictEqual(parseXYZText('~10 70 ~', base), [110, 70, -21]);
    // 没有 base 时 ~ 按 0 计算，不崩
    assert.deepStrictEqual(parseXYZText('~ ~ ~'), [0, 0, 0]);
});

check('放置面板：坐标输入排在所有 label 之前（data[0..2] 恒为 X/Y/Z）', () => {
    const src = fs.readFileSync(UI_FILE, 'utf8');
    const start = src.indexOf('showPlacementPanel(player, schematic, loadedSchematic)');
    assert.ok(start > 0, '找不到 showPlacementPanel');
    const body = src.slice(start, start + 5000);
    const firstInput = body.indexOf('fm.addInput(');
    const firstLabel = body.indexOf('fm.addLabel(');
    assert.ok(firstInput > 0 && firstLabel > 0);
    assert.ok(firstInput < firstLabel, 'input 必须先于所有 label');
    assert.strictEqual(body.split('fm.addInput(').length - 1, 3, '恰好三个坐标输入框');
});

/** 假 mc + 假 UIManager 依赖：只验"面板回调把 data 变成什么 placePos" */
function runPanel(dataArray) {
    const forms = [];
    global.mc = {
        newCustomForm() {
            const fm = {
                _controls: [],
                setTitle() { return fm; },
                addLabel(t) { fm._controls.push(['label', t]); return fm; },
                addInput(title, ph, def) { fm._controls.push(['input', title, ph, def]); return fm; },
            };
            forms.push(fm);
            return fm;
        },
        newSimpleForm() {
            const fm = {
                setTitle() { return fm; }, setContent() { return fm; },
                addButton() { return fm; },
            };
            return fm;
        },
    };
    global.logger = { info() {}, warn() {}, error() {}, debug() {} };

    const { UIManager } = require(path.join(PLUGIN, 'src', 'ui', 'UIManager.js'));
    // 不跑构造函数：它会 mkdir ./plugins/LitematicaBE/schematics（污染仓库）。
    // 这里只借用面板方法，手动补齐它用到的成员。
    const ui = Object.create(UIManager.prototype);
    ui.actionBarMessages = new Map();
    ui.lastVerifyResults = new Map();
    ui.schematicsDir = path.join(require('os').tmpdir(), 'litematica-test-');
    let captured = null;
    ui.executePlaceSchematic = (player, schematic, loaded, placePos) => { captured = placePos; };
    ui.showSchematicBrowser = () => {};

    const player = {
        xuid: 'P1', name: 'Steve',
        pos: { x: 10.4, y: 65, z: -3.2, dimid: 0 },
        tell() {},
        sendForm(fm, cb) { fm._cb = cb; },
    };
    const schematic = { name: 'S', file: 's.litematic' };
    const loaded = {
        name: 'S', author: 'me', dimensions: { x: 4, y: 4, z: 4 }, totalBlocks: 64, blocks: [],
    };

    ui.showPlacementPanel(player, schematic, loaded);
    forms[0]._cb(player, dataArray);
    return { placePos: captured, controls: forms[0]._controls };
}

check('面板回调：输入 100/70/-50 → 就用这组坐标（不再回退玩家位置）', () => {
    const { placePos, controls } = runPanel([100, 70, -50, null, null, null, null, null]);
    assert.deepStrictEqual(placePos, { x: 100, y: 70, z: -50 });
    assert.deepStrictEqual(controls.slice(0, 3).map(c => c[0]), ['input', 'input', 'input'],
        '前三个控件必须是输入框');
    assert.deepStrictEqual(controls.slice(0, 3).map(c => c[3]), ['10', '64', '-4'],
        '默认值应是玩家脚下坐标');
});

check('面板回调：label 占位与不占位两种 data 都能正确取到坐标', () => {
    // 不占位（紧凑数组）
    const compact = runPanel(['100', '70', '-50']);
    assert.deepStrictEqual(compact.placePos, { x: 100, y: 70, z: -50 }, '紧凑数组');
    // 占位（label 为 null，data 更长）：输入框在最前面，所以 data[0..2] 仍是坐标
    const padded = runPanel(['100', '70', '-50', ...Array(9).fill(null)]);
    assert.deepStrictEqual(padded.placePos, { x: 100, y: 70, z: -50 }, 'label 占位');
});

check('面板回调：输入 0 与负数不被当成"没填"', () => {
    assert.deepStrictEqual(runPanel(['0', '0', '0']).placePos, { x: 0, y: 0, z: 0 });
    assert.deepStrictEqual(runPanel(['-372', '-64', '-1000']).placePos, { x: -372, y: -64, z: -1000 });
});

check('面板回调：空串 / 非法值回退玩家脚下', () => {
    assert.deepStrictEqual(runPanel(['', 'abc', '  ']).placePos, { x: 10, y: 64, z: -4 });
    assert.deepStrictEqual(runPanel([]).placePos, { x: 10, y: 64, z: -4 });
});

check('面板回调：取消（非数组）不放置、不抛错', () => {
    const { placePos } = runPanel(undefined);
    assert.strictEqual(placePos, null, '取消时不应调用 executePlaceSchematic');
});

check('/lit placeat：dispatch 把 argText 传给 handlePlaceAtCommand', () => {
    const src = fs.readFileSync(INDEX_FILE, 'utf8');
    assert.ok(/handlePlaceAtCommand\(player, results\.x, results\.y, results\.z, output, argText\)/.test(src),
        'dispatchMainAction 的 placeat 必须传 argText（短命令只有 RawText）');
    const fnStart = src.indexOf('function handlePlaceAtCommand(');
    assert.ok(fnStart > 0);
    const body = src.slice(fnStart, fnStart + 2500);
    assert.ok(/parseXYZText\(argText, base\)/.test(body), '必须从 argText 兜底解析坐标');
    assert.ok(/toIntOr\(x, NaN\)/.test(body), 'Int 参数缺失时不能被当成 0');
    assert.ok(/clampCoord\(px\)/.test(body), '坐标应夹紧');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
