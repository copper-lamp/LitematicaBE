/**
 * test_piston_model.js — 活塞 / 黏性活塞的离线回归
 *
 * 覆盖（不依赖 BDS）：
 *   1. 映射：facing_direction 数值 ⇄ 方向、Java facing 字符串、identifier 分派
 *   2. 状态判定：.litematic 的 extended、.mcstructure 缺 extended_bit 时按前方活塞头推断
 *   3. 几何剖面：本体 / 臂 / 头格 的尺寸、轴向连续、非轴居中、不越格
 *   4. 材质：收缩态六面与 PISTON_SIDE_FACES 一致；伸出态推面/背面、臂与杆、头板
 *   5. 贴图：四向侧图的木条位置、注册与文件存在
 *   6. 遮挡：不满格方块不参与外壳剔除
 *
 * 单一真源：src/mappings/PistonFacing.js（映射 + 收缩态面材质表）
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const PLUGIN = path.resolve(__dirname, '..');
const RP = path.join(PLUGIN, 'resources', 'addon', 'LitematicaBE_RP');
const BP = path.join(PLUGIN, 'resources', 'addon', 'LitematicaBE_BP');
const PNG = require(path.join(PLUGIN, 'tools', 'lib', 'png.js'));
const { GhostBlockRegistry } = require(path.join(PLUGIN, 'src', 'ghost', 'GhostBlockRegistry.js'));
const { BidirectionalBlockConverter } = require(path.join(PLUGIN, 'src', 'mappings', 'BidirectionalBlockConverter.js'));
const { inferPistonExtendedStates, frontDelta } = require(path.join(PLUGIN, 'src', 'ghost', 'PistonStateInfer.js'));
const { SurfaceExtractor, isNonOccludingShape } = require(path.join(PLUGIN, 'src', 'ghost', 'SurfaceExtractor.js'));
const {
    PISTON_FACING, PISTON_FACING_NAME, PISTON_FACING_VEC, PISTON_SIDE_FACES,
    JAVA_TO_PISTON_FACING, PISTON_FACING_TO_JAVA,
} = require(path.join(PLUGIN, 'src', 'mappings', 'PistonFacing.js'));

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); console.log(`  [OK] ${name}`); pass++; }
    catch (e) { console.log(`  [FAIL] ${name}\n      ${e.message}`); fail++; }
}
const geoOf = (name, f) => readJson(path.join(RP, 'models', 'blocks', `${name}_f${f}.json`))['minecraft:geometry'][0];
const blockOf = (prefix, f) => readJson(path.join(BP, 'blocks', `${prefix}_f${f}.json`))['minecraft:block'];
const terrain = readJson(path.join(RP, 'textures', 'terrain_texture.json')).texture_data;
const registry = new GhostBlockRegistry(path.join(PLUGIN, 'resources', 'data', 'ghost_index.json'));
const conv = new BidirectionalBlockConverter();
const FACES = ['north', 'south', 'east', 'west', 'up', 'down'];
const LIMIT = { x: [-8, 8], y: [0, 16], z: [-8, 8] };

/**
 * 几何坐标里的推出方向（≠ 世界方向）。
 * 实机判据（2026-11-11，1.1.80 实测）：朝东（fd=4）的伸出活塞，本体格内腔面出现在西侧、
 * 头格推板出现在靠近本体一端 —— 两处同时差 180°，且只有 x 轴两组如此（南北正常），
 * 故 geometry 的 x 轴与世界 x 相反。几何里 x 轴向的推出方向取世界的相反向量。
 */
const GEO_FACE = { 0: 'down', 1: 'up', 2: 'south', 3: 'north', 4: 'west', 5: 'east' };
const GEO_VEC = { 0: [0, -1, 0], 1: [0, 1, 0], 2: [0, 0, 1], 3: [0, 0, -1], 4: [-1, 0, 0], 5: [1, 0, 0] };
// 世界语义（用于材质落面）；几何坐标侧在 f4/f5 上与之相反，见 GEO_VEC
const FACING = {
    0: { name: 'down' }, 1: { name: 'up' },
    2: { name: 'south' }, 3: { name: 'north' },
    4: { name: 'east' }, 5: { name: 'west' },
};
const OPPOSITE = { down: 'up', up: 'down', north: 'south', south: 'north', west: 'east', east: 'west' };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const center = (c) => [c.origin[0] + c.size[0] / 2, c.origin[1] + c.size[1] / 2, c.origin[2] + c.size[2] / 2];
const axisOf = (fd) => { const v = GEO_VEC[fd]; return v[0] !== 0 ? 0 : (v[1] !== 0 ? 1 : 2); };
const sizeKey = (c) => c.size.slice().sort((a, b) => a - b).join('x');

console.log('\n=== 0. 环境 ===');
t('ghost_index 就绪', () => assert.ok(registry.ready, 'ghost_index 未就绪：' + registry.loadError));

console.log('\n=== 1. 映射（PistonFacing 单一真源）===');

t('六朝向的数值/方向名/向量三者自洽', () => {
    const NAME_TO_VEC = { down: [0, -1, 0], up: [0, 1, 0], south: [0, 0, 1], north: [0, 0, -1], east: [1, 0, 0], west: [-1, 0, 0] };
    for (let fd = 0; fd <= 5; fd++) {
        assert.strictEqual(JSON.stringify(PISTON_FACING_VEC[fd]), JSON.stringify(NAME_TO_VEC[PISTON_FACING_NAME[fd]]), `fd=${fd}`);
        assert.strictEqual(PISTON_FACING_TO_JAVA[fd], PISTON_FACING_NAME[fd], `fd=${fd} 反查`);
        assert.strictEqual(JAVA_TO_PISTON_FACING[PISTON_FACING_NAME[fd]], fd, `fd=${fd} 正查`);
    }
});

t('实测语义：2=south 3=north 4=east 5=west（与通用枚举相反）', () => {
    assert.strictEqual(PISTON_FACING.SOUTH, 2);
    assert.strictEqual(PISTON_FACING.NORTH, 3);
    assert.strictEqual(PISTON_FACING.EAST, 4);
    assert.strictEqual(PISTON_FACING.WEST, 5);
});

t('六朝向 × 伸/缩 都落到对应 identifier', () => {
    for (let fd = 0; fd <= 5; fd++) {
        assert.strictEqual(registry.resolveWithState('minecraft:piston', { extended_bit: 1, facing_direction: fd }),
            `lit:g_piston_side_extended_f${fd}`, `fd=${fd} 伸出`);
        assert.strictEqual(registry.resolveWithState('minecraft:piston', { extended_bit: 0, facing_direction: fd }),
            `lit:g_piston_side_f${fd}`, `fd=${fd} 收缩`);
        assert.strictEqual(registry.resolveWithState('minecraft:sticky_piston', { extended_bit: 1, facing_direction: fd }),
            `lit:g_sticky_piston_extended_f${fd}`, `fd=${fd} 黏性伸出`);
    }
});

t('Java facing 字符串按活塞语义还原（north→f3、south→f2、east→f4、west→f5）', () => {
    const map = { down: 0, up: 1, south: 2, north: 3, east: 4, west: 5 };
    for (const [java, fd] of Object.entries(map)) {
        assert.strictEqual(registry.resolveWithState('minecraft:piston', { facing: java, extended: 'true' }),
            `lit:g_piston_side_extended_f${fd}`, `facing=${java}`);
    }
});

t('.litematic 转换（facing+extended → facing_direction+extended_bit）走活塞表', () => {
    const st = conv.javaToBedrock({ name: 'minecraft:piston', states: { facing: 'north', extended: 'true' } }).states;
    assert.strictEqual(st.facing_direction, 3, 'north → 3');
    assert.strictEqual(st.extended_bit, 1);
});

t('缺朝向/越界朝向回落而不崩', () => {
    assert.strictEqual(registry.resolveWithState('minecraft:piston', { extended_bit: 1 }), 'lit:g_piston_side_extended_f1');
    assert.strictEqual(registry.resolveWithState('minecraft:piston', { facing_direction: 9, extended_bit: 0 }), 'lit:g_piston_side_f1');
});

t('活塞头按 type + facing 分派（east→f4）', () => {
    const normal = conv.javaToBedrock({ name: 'minecraft:piston_head', states: { facing: 'up', type: 'normal' } }).states;
    const sticky = conv.javaToBedrock({ name: 'minecraft:piston_head', states: { facing: 'east', type: 'sticky' } }).states;
    assert.strictEqual(registry.resolveWithState('minecraft:piston_head', normal), 'lit:g_piston_head_f1');
    assert.strictEqual(registry.resolveWithState('minecraft:piston_head', sticky), 'lit:g_sticky_piston_head_f4');
});

t('BE 活塞臂/移动壳走活塞头模型', () => {
    for (const n of ['minecraft:piston_arm_collision', 'minecraft:sticky_piston_arm_collision', 'minecraft:moving_piston']) {
        assert.strictEqual(registry.resolveWithState(n, { facing_direction: 2 }),
            n.startsWith('minecraft:sticky') ? 'lit:g_sticky_piston_head_f2' : 'lit:g_piston_head_f2', n);
    }
});

t('朝向由 identifier 承载 → buildStates 返回 null', () => {
    for (const n of ['minecraft:piston', 'minecraft:sticky_piston', 'minecraft:piston_head',
        'minecraft:piston_arm_collision', 'minecraft:sticky_piston_arm_collision', 'minecraft:moving_piston']) {
        assert.strictEqual(registry.buildStates(n, { facing_direction: 3, extended_bit: 1 }), null, n);
    }
});

console.log('\n=== 2. 伸出态推断（.mcstructure 缺 extended_bit）===');

t('六朝向：头格位置与 PISTON_FACING_VEC 一致时都补出伸出态', () => {
    for (let fd = 0; fd <= 5; fd++) {
        const v = PISTON_FACING_VEC[fd];
        const blocks = [
            { pos: [0, 0, 0], name: 'minecraft:piston', state: { facing_direction: fd }, bedrockState: { facing_direction: fd } },
            { pos: [v[0], v[1], v[2]], name: 'minecraft:piston_arm_collision', state: { facing_direction: fd } },
        ];
        assert.strictEqual(inferPistonExtendedStates(blocks), 1, `fd=${fd}(${PISTON_FACING_NAME[fd]}) 应补出伸出`);
        assert.strictEqual(blocks[0].bedrockState.extended_bit, 1);
    }
});

t('前方无头格 → 保持收缩且不写 0（MEGA 分块安全）', () => {
    const blocks = [
        { pos: [0, 0, 0], name: 'minecraft:piston', state: { facing_direction: 2 }, bedrockState: { facing_direction: 2 } },
        { pos: [0, 0, -1], name: 'minecraft:stone', state: {} },
    ];
    assert.strictEqual(inferPistonExtendedStates(blocks), 0);
    assert.strictEqual(blocks[0].bedrockState.extended_bit, undefined);
});

t('已有 extended 标志不被推断覆盖', () => {
    const blocks = [
        { pos: [0, 0, 0], name: 'minecraft:piston', state: { facing_direction: 1, extended_bit: 0 }, bedrockState: { facing_direction: 1, extended_bit: 0 } },
        { pos: [0, 1, 0], name: 'minecraft:piston_arm_collision', state: { facing_direction: 1 } },
    ];
    assert.strictEqual(inferPistonExtendedStates(blocks), 0);
});

t('头格朝向与本体的不一致时不误判', () => {
    const blocks = [
        { pos: [0, 0, 0], name: 'minecraft:piston', state: { facing_direction: 1 }, bedrockState: { facing_direction: 1 } },
        { pos: [0, 1, 0], name: 'minecraft:piston_arm_collision', state: { facing_direction: 2 } },
    ];
    assert.strictEqual(inferPistonExtendedStates(blocks), 0);
});

t('字符串 facing_direction（观察者一类）也能取方向', () => {
    assert.deepStrictEqual(frontDelta({ name: 'minecraft:observer', state: { facing_direction: 'north' } }), [0, 0, -1]);
});

console.log('\n=== 3. 几何剖面 ===');

t('收缩态：单 cube 满格，六面材质 == PISTON_SIDE_FACES', () => {
    for (let fd = 0; fd <= 5; fd++) {
        const c = geoOf('lit_piston', fd).bones[0].cubes[0];
        assert.deepStrictEqual(c.origin, [-8, 0, -8], `f${fd} origin`);
        assert.deepStrictEqual(c.size, [16, 16, 16], `f${fd} size`);
        const got = {};
        for (const f of FACES) got[f] = c.uv[f].material_instance;
        assert.deepStrictEqual(got, PISTON_SIDE_FACES[fd], `f${fd}(${PISTON_FACING_NAME[fd]}) 面材质`);
    }
});

t('收缩态：推面与背面互为对侧，其余四面都是四向侧图', () => {
    const SIDES = new Set(['side_up', 'side_down', 'side_left', 'side_right']);
    for (let fd = 0; fd <= 5; fd++) {
        const c = geoOf('lit_piston', fd).bones[0].cubes[0];
        const byMat = (m) => FACES.filter((f) => c.uv[f].material_instance === m);
        assert.strictEqual(byMat('top_carried').length, 1, `f${fd} 推面唯一`);
        assert.strictEqual(byMat('bottom').length, 1, `f${fd} 背面唯一`);
        assert.strictEqual(OPPOSITE[byMat('top_carried')[0]], byMat('bottom')[0], `f${fd} 推面/背面必须对侧`);
        const rest = FACES.filter((f) => SIDES.has(c.uv[f].material_instance));
        assert.strictEqual(rest.length, 4, `f${fd} 其余四面应为四向侧图`);
        for (const f of FACES) {
            assert.deepStrictEqual(c.uv[f].uv, [0, 0], `f${fd} ${f} uv 原点`);
            assert.deepStrictEqual(c.uv[f].uv_size, [16, 16], `f${fd} ${f} uv_size 全正`);
        }
    }
});

t('伸出态：本体 12 深 + 臂 4 深，两 cube 轴向连续', () => {
    for (let fd = 0; fd <= 5; fd++) {
        const cubes = geoOf('lit_piston_extended', fd).bones[0].cubes;
        assert.strictEqual(cubes.length, 2, `f${fd} cube 数`);
        assert.deepStrictEqual(sizeKey(cubes[0]), '12x16x16', `f${fd} 本体尺寸`);
        assert.deepStrictEqual(sizeKey(cubes[1]), '4x6x6', `f${fd} 臂尺寸`);
        const a = axisOf(fd);
        const body = cubes[0], arm = cubes[1];
        const bodyEnd = body.origin[a] + body.size[a];
        const armEnd = arm.origin[a] + arm.size[a];
        assert.strictEqual(Math.min(bodyEnd, armEnd) === Math.max(body.origin[a], arm.origin[a]) ? 'ok' : 'gap', 'ok',
            `f${fd} 本体与臂沿轴必须相接：本体 ${body.origin[a]}..${bodyEnd} / 臂 ${arm.origin[a]}..${armEnd}`);
    }
});

t('伸出态：臂位于几何推出方向一侧', () => {
    for (let fd = 0; fd <= 5; fd++) {
        const [body, arm] = geoOf('lit_piston_extended', fd).bones[0].cubes;
        const rel = center(arm).map((v, i) => v - center(body)[i]);
        assert.ok(dot(rel, GEO_VEC[fd]) > 0, `f${fd}(${PISTON_FACING_NAME[fd]}) 臂方向错: ${rel}`);
    }
});

t('头格：臂段 4 + 细杆 8 + 头板 4，三段沿轴铺满且推板在远端', () => {
    for (let fd = 0; fd <= 5; fd++) {
        const cubes = geoOf('lit_piston_head', fd).bones[0].cubes;
        assert.strictEqual(cubes.length, 3, `f${fd} cube 数`);
        const sizes = cubes.map(sizeKey);
        assert.ok(sizes.includes('4x6x6'), `f${fd} 缺臂段: ${sizes}`);
        assert.ok(sizes.includes('4x4x8'), `f${fd} 缺细杆: ${sizes}`);
        assert.ok(sizes.includes('4x16x16'), `f${fd} 缺头板: ${sizes}`);
        const a = axisOf(fd);
        const spans = cubes.map((c) => [c.origin[a], c.origin[a] + c.size[a]]).sort((x, y) => x[0] - y[0]);
        assert.strictEqual(spans[0][0], LIMIT[['x', 'y', 'z'][a]][0], `f${fd} 第一段应贴格界`);
        assert.strictEqual(spans[2][1], LIMIT[['x', 'y', 'z'][a]][1], `f${fd} 末段应贴格界`);
        assert.ok(spans[0][1] === spans[1][0] && spans[1][1] === spans[2][0], `f${fd} 三段必须首尾相接: ${JSON.stringify(spans)}`);
        const plate = cubes.find((c) => sizeKey(c) === '4x16x16');
        const rel = center(plate).map((v, i) => v - (i === 1 ? 8 : 0));
        assert.ok(dot(rel, GEO_VEC[fd]) > 0, `f${fd}(${PISTON_FACING_NAME[fd]}) 推板方向错: ${rel}`);
    }
});

t('伸出态与头格：非轴向两轴必须居中（臂/杆不能贴格子底部）', () => {
    for (let fd = 0; fd <= 5; fd++) {
        const a = axisOf(fd);
        for (const geo of ['lit_piston_extended', 'lit_piston_head']) {
            for (const c of geoOf(geo, fd).bones[0].cubes) {
                for (let k = 0; k < 3; k++) {
                    if (k === a) continue;
                    const axis = ['x', 'y', 'z'][k];
                    const [lo, hi] = LIMIT[axis];
                    const want = lo + (hi - lo - c.size[k]) / 2;
                    assert.strictEqual(c.origin[k], want, `${geo}_f${fd} ${axis} 应居中为 ${want}，实际 ${c.origin[k]}`);
                }
            }
        }
    }
});

t('全部活塞 cube 不越出本格', () => {
    for (const name of ['lit_piston', 'lit_piston_extended', 'lit_piston_head']) {
        for (let fd = 0; fd <= 5; fd++) {
            for (const c of geoOf(name, fd).bones[0].cubes) {
                for (let k = 0; k < 3; k++) {
                    const axis = ['x', 'y', 'z'][k];
                    const lo = c.origin[k], hi = lo + c.size[k];
                    assert.ok(lo >= LIMIT[axis][0] && hi <= LIMIT[axis][1],
                        `${name}_f${fd} ${axis} 越界 ${lo}..${hi}`);
                }
            }
        }
    }
});

console.log('\n=== 4. 材质 ===');

t('伸出态本体：推面 inner 在推出方向面，背面 bottom', () => {
    for (let fd = 0; fd <= 5; fd++) {
        const body = geoOf('lit_piston_extended', fd).bones[0].cubes[0];
        const byMat = (m) => FACES.filter((f) => body.uv[f].material_instance === m);
        // 材质面按世界语义（FACING），坐标侧才用镜像后的 GEO_VEC —— 两者在 f4/f5 上方向相反
        assert.deepStrictEqual(byMat('inner'), [FACING[fd].name], `f${fd} 内腔面`);
        assert.deepStrictEqual(byMat('bottom'), [OPPOSITE[FACING[fd].name]], `f${fd} 背面`);
    }
});

t('头格：推面 plate_top 在推出方向面，内面 plate_back 在对侧', () => {
    for (let fd = 0; fd <= 5; fd++) {
        const plate = geoOf('lit_piston_head', fd).bones[0].cubes.find((c) => sizeKey(c) === '4x16x16');
        const byMat = (m) => FACES.filter((f) => plate.uv[f].material_instance === m);
        assert.deepStrictEqual(byMat('plate_top'), [FACING[fd].name], `f${fd} 推面`);
        assert.deepStrictEqual(byMat('plate_back'), [OPPOSITE[FACING[fd].name]], `f${fd} 内面`);
    }
});

t('所有面的 uv_size 与该面实际尺寸一致（不拉伸）', () => {
    for (const geo of ['lit_piston', 'lit_piston_extended', 'lit_piston_head']) {
        for (let fd = 0; fd <= 5; fd++) {
            for (const c of geoOf(geo, fd).bones[0].cubes) {
                const [sx, sy, sz] = c.size;
                for (const f of FACES) {
                    const d = c.uv[f];
                    if (!d) continue;
                    const [fw, fh] = (f === 'north' || f === 'south') ? [sx, sy] : (f === 'east' || f === 'west') ? [sz, sy] : [sx, sz];
                    const [aw, ah] = [Math.abs(d.uv_size[0]), Math.abs(d.uv_size[1])];
                    assert.ok((aw === fw && ah === fh) || (aw === fh && ah === fw),
                        `${geo}_f${fd} ${f}: 面 ${fw}x${fh} 却用 ${aw}x${ah}`);
                }
            }
        }
    }
});

t('四向侧图与推面/背面材质在收缩态里各就各位（普通/黏性共用几何）', () => {
    const n = blockOf('g_piston_side', 0).components['minecraft:material_instances'];
    const s = blockOf('g_sticky_piston', 0).components['minecraft:material_instances'];
    assert.strictEqual(n.top_carried.texture, 'ghost_piston_top_normal');
    assert.strictEqual(s.top_carried.texture, 'ghost_piston_top_sticky');
    for (const k of ['bottom', 'side_up', 'side_down', 'side_left', 'side_right']) {
        assert.strictEqual(n[k].texture, s[k].texture, `${k} 普通/黏性应共用同一张图`);
        assert.strictEqual(n[k].render_method, 'blend', `${k} 必须 blend`);
    }
});

t('几何引用的 material_instance 都在对应 BP 材质表里', () => {
    const groups = [['lit_piston', 'g_piston_side'], ['lit_piston', 'g_sticky_piston'],
        ['lit_piston_extended', 'g_piston_side_extended'], ['lit_piston_extended', 'g_sticky_piston_extended'],
        ['lit_piston_head', 'g_piston_head'], ['lit_piston_head', 'g_sticky_piston_head']];
    for (const [geo, prefix] of groups) {
        for (let fd = 0; fd <= 5; fd++) {
            const mats = new Set(Object.keys(blockOf(prefix, fd).components['minecraft:material_instances']));
            for (const c of geoOf(geo, fd).bones[0].cubes) {
                for (const d of Object.values(c.uv)) {
                    assert.ok(mats.has(d.material_instance), `${prefix}_f${fd} 缺材质 ${d.material_instance}`);
                }
            }
        }
    }
});

console.log('\n=== 5. 贴图 ===');

t('活塞用到的贴图全部注册且文件存在', () => {
    for (const prefix of ['g_piston_side', 'g_sticky_piston_side', 'g_piston_side_extended', 'g_piston_head']) {
        for (let fd = 0; fd <= 5; fd++) {
            const file = path.join(BP, 'blocks', `${prefix}_f${fd}.json`);
            if (!fs.existsSync(file)) continue;
            const mi = readJson(file)['minecraft:block'].components['minecraft:material_instances'];
            for (const [slot, def] of Object.entries(mi)) {
                assert.ok(terrain[def.texture], `${prefix}_f${fd}.${slot} 未注册 ${def.texture}`);
                assert.ok(fs.existsSync(path.join(RP, `${terrain[def.texture].textures}.png`)), `${prefix}_f${fd}.${slot} 缺文件`);
            }
        }
    }
});

t('四向侧图的木条位置与命名一致（up=顶 / down=底 / left=左 / right=右）', () => {
    const dir = path.join(RP, 'textures', 'blocks', 'ghost');
    const edgeOf = (name) => {
        const im = PNG.decode(fs.readFileSync(path.join(dir, name + '.png')));
        const rowAvg = (y) => { let s = 0; for (let x = 0; x < 16; x++) s += im.data[(y * 16 + x) * 4]; return s / 16; };
        const colAvg = (x) => { let s = 0; for (let y = 0; y < 16; y++) s += im.data[(y * 16 + x) * 4]; return s / 16; };
        const cand = {
            top: (rowAvg(0) + rowAvg(1) + rowAvg(2) + rowAvg(3)) / 4,
            bottom: (rowAvg(12) + rowAvg(13) + rowAvg(14) + rowAvg(15)) / 4,
            left: (colAvg(0) + colAvg(1) + colAvg(2) + colAvg(3)) / 4,
            right: (colAvg(12) + colAvg(13) + colAvg(14) + colAvg(15)) / 4,
        };
        return Object.entries(cand).sort((a, b) => b[1] - a[1])[0][0];
    };
    const WANT = { up: 'top', down: 'bottom', left: 'left', right: 'right' };
    for (const k of ['up', 'down', 'left', 'right']) {
        assert.strictEqual(edgeOf('ghost_piston_side_' + k), WANT[k],
            `ghost_piston_side_${k} 木条应在贴图 ${WANT[k]}`);
    }
});

t('旧贴图 side_length / side_cross 已从 terrain 与目录移除', () => {
    for (const k of ['ghost_piston_side_length', 'ghost_piston_side_cross']) {
        assert.strictEqual(terrain[k], undefined, `${k} 不应再注册`);
        assert.ok(!fs.existsSync(path.join(RP, 'textures', 'blocks', 'ghost', k + '.png')), `${k}.png 应已删除`);
    }
});

t('全部 blend 材质贴图 alpha 均值 < 245（半透明生效）', () => {
    const dir = path.join(RP, 'textures', 'blocks', 'ghost');
    for (const n of fs.readdirSync(dir).filter((f) => /^ghost_piston.*\.png$/.test(f))) {
        const st = PNG.alphaStats(PNG.decode(fs.readFileSync(path.join(dir, n))));
        assert.ok(st.mean < 245, `${n} alpha 均值 ${st.mean.toFixed(1)} 过高`);
    }
});

console.log('\n=== 6. 外壳剔除 ===');

t('活塞臂/头这类不满格方块不参与遮挡', () => {
    for (const n of ['piston_arm_collision', 'sticky_piston_arm_collision', 'moving_piston', 'piston_head']) {
        assert.ok(isNonOccludingShape(n), `${n} 不应遮挡`);
    }
});

t('六面被不满格方块包围的中心格不被剔除，满格包围才剔除', () => {
    const mk = (name) => ({ pos: [0, 0, 0], name, state: {} });
    const ring = (name) => [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
        .map((p) => ({ pos: p, name, state: {} }));
    const soft = new SurfaceExtractor().extract([mk('minecraft:stone'), ...ring('minecraft:piston_arm_collision')], {});
    assert.ok(soft.blocks.some((b) => b.pos.join(',') === '0,0,0'), '不满格包围时中心格必须保留');
    const hard = new SurfaceExtractor().extract([mk('minecraft:stone'), ...ring('minecraft:stone')], {});
    assert.ok(!hard.blocks.some((b) => b.pos.join(',') === '0,0,0'), '满格包围时中心格应被剔除');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
