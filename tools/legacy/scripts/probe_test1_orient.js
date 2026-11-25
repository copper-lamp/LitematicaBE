// 临时校验：解析 测试1.mcstructure，输出 dispenser / observer 的坐标与朝向，
// 并模拟「直接放置」链路最终交给 mc.setBlock 的 NBT 状态（work/ 已 gitignore）
const fs = require('fs');
const path = require('path');
const PLUGIN = path.resolve(__dirname, '..');

// ── 小端 NBT（带类型）──
function parseTypedLE(input) {
    const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let off = 0;
    const rb = () => dv.getInt8(off++);
    const rs = () => { const v = dv.getInt16(off, true); off += 2; return v; };
    const ri = () => { const v = dv.getInt32(off, true); off += 4; return v; };
    const rl = () => { let v = 0n; for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(dv.getUint8(off + i)); off += 8; return v; };
    const rf = () => { const v = dv.getFloat32(off, true); off += 4; return v; };
    const rd = () => { const v = dv.getFloat64(off, true); off += 8; return v; };
    const rstr = () => { const n = rs(); if (n <= 0) return ''; const s = new TextDecoder().decode(new Uint8Array(u8.buffer, u8.byteOffset + off, n)); off += n; return s; };
    function payload(t) {
        switch (t) {
            case 1: return { type: t, value: rb() };
            case 2: return { type: t, value: rs() };
            case 3: return { type: t, value: ri() };
            case 4: return { type: t, value: rl() };
            case 5: return { type: t, value: rf() };
            case 6: return { type: t, value: rd() };
            case 7: { const n = ri(); const a = []; for (let i = 0; i < n; i++) a.push(rb()); return { type: t, value: a }; }
            case 8: return { type: t, value: rstr() };
            case 9: { const et = rb(); const n = ri(); const a = []; for (let i = 0; i < n; i++) a.push(payload(et)); return { type: t, listType: et, value: a }; }
            case 10: return { type: t, value: compound() };
            case 11: { const n = ri(); const a = []; for (let i = 0; i < n; i++) a.push(ri()); return { type: t, value: a }; }
            case 12: { const n = ri(); const a = []; for (let i = 0; i < n; i++) a.push(rl()); return { type: t, value: a }; }
            default: throw new Error('bad tag ' + t);
        }
    }
    function compound() {
        const o = {};
        while (off < u8.length) { const t = rb(); if (t === 0) break; const n = rstr(); o[n] = payload(t); }
        return o;
    }
    rb(); rstr();
    return compound();
}

const DIR_NUM = { 0: 'down(下)', 1: 'up(上)', 2: 'north(北)', 3: 'south(南)', 4: 'west(西)', 5: 'east(东)' };
const NUM_DIR = { 0: 'down', 1: 'up', 2: 'north', 3: 'south', 4: 'west', 5: 'east' };
const CN = { east: '东', south: '南', west: '西', north: '北', up: '上', down: '下' };

const file = process.argv[2];
const root = parseTypedLE(fs.readFileSync(file));
const st = root.structure.value;
const size = root.size.value.map((n) => n.value);
const [sx, sy, sz] = size;
const pal = st.palette.value.default.value;
const palette = pal.block_palette.value.map((e) => ({
    name: e.value.name.value,
    states: Object.fromEntries(Object.entries(e.value.states.value).map(([k, v]) => [k, { v: v.value, t: v.type }]))
}));
const layer0 = st.block_indices.value[0].value.map((n) => n.value);

const TYPE_NAME = { 1: 'Byte', 2: 'Short', 3: 'Int', 4: 'Long', 5: 'Float', 6: 'Double', 7: 'ByteArray', 8: 'String', 9: 'List', 10: 'Compound' };

console.log(`文件: ${path.basename(file)}  尺寸 ${sx}×${sy}×${sz}  调色板 ${palette.length} 项`);
const all = [];
for (let i = 0; i < layer0.length; i++) {
    const entry = palette[layer0[i]];
    if (!entry) continue;
    const short = String(entry.name).replace(/^minecraft:/, '');
    if (short === 'air' || short.endsWith('_air') || short === 'structure_void') continue;
    const x = Math.floor(i / (sz * sy));
    const y = Math.floor(i / sz) % sy;
    const z = i % sz;
    all.push({ x, y, z, name: entry.name, states: entry.states, idx: i });
}
console.log(`非空气方块 ${all.length} 个`);

function facingOf(entry) {
    const s = entry.states || {};
    // 1) 带前缀的字符串型（observer 的现代写法）
    for (const k of ['minecraft:facing_direction', 'minecraft:cardinal_direction']) {
        if (s[k] !== undefined) return { key: k, raw: s[k].v, type: s[k].t, dir: String(s[k].v).toLowerCase() };
    }
    // 2) 短键整型（piston / dispenser / hopper / observer 旧写法）
    if (s.facing_direction !== undefined) {
        const num = Number(s.facing_direction.v);
        return { key: 'facing_direction', raw: num, type: s.facing_direction.t, dir: NUM_DIR[num] || `?(${num})` };
    }
    // 3) 其它常见方向键
    for (const k of ['direction', 'cardinal_direction']) {
        if (s[k] !== undefined) return { key: k, raw: s[k].v, type: s[k].t, dir: String(s[k].v).toLowerCase() };
    }
    return null;
}

for (const target of ['minecraft:dispenser', 'minecraft:observer']) {
    const list = all.filter((b) => b.name === target).sort((a, b) => (a.y - b.y) || (a.z - b.z) || (a.x - b.x));
    console.log(`\n=== ${target}（${list.length} 个）===`);
    console.log('  pos(x,y,z)       状态键 / 原值(类型)                      → 方向');
    const seq = [];
    for (const b of list) {
        const f = facingOf(b);
        let desc = '(无方向状态)';
        if (f) {
            desc = `${f.key} = ${JSON.stringify(f.raw)} (${TYPE_NAME[f.type] || f.type})`.padEnd(46, ' ')
                + ` → ${f.dir}`;
            seq.push(f.dir);
        }
        console.log(`  (${String(b.x).padStart(2)},${String(b.y).padStart(2)},${String(b.z).padStart(2)})   ${desc}`);
    }
    console.log(`  顺序: ${seq.map((d) => `${d}(${CN[d] || '?'})`).join(' → ')}`);

    // 与用户描述「依次东南西北」比对
    const expected = ['east', 'south', 'west', 'north'];
    const got = list.map((b) => (facingOf(b) || {}).dir);
    const sameSet = got.length === 4 && new Set(got).size === 4
        && expected.every((d) => got.includes(d));
    console.log(`  四个方向互不相同且覆盖东南西北: ${sameSet ? '是' : '否'}`);
    const isOrder = got.length === expected.length && got.every((d, i) => d === expected[i]);
    console.log(`  严格按「东南西北」顺序: ${isOrder ? '是' : '否（若你把方块沿其它轴排列，顺序会不同，需看坐标）'}`);
}

// ── 模拟直接放置链路的最终 NBT（验证状态有没有被改写）──
const { BlockStateConverters } = require(path.join(PLUGIN, 'src/mappings/BlockStateConverters.js'));
const { BlockMappingRegistry } = require(path.join(PLUGIN, 'src/mappings/BlockMappingRegistry.js'));
const { BlockConversions } = require(path.join(PLUGIN, 'src/easyplace/BlockConversions.js'));
const stateConverter = new BlockStateConverters();
const registry = new BlockMappingRegistry();

console.log('\n=== 直接放置链路：投影数据 → 最终 mc.setBlock 的 states ===');
const seen = new Set();
for (const b of all) {
    const short = String(b.name).replace(/^minecraft:/, '');
    if (short !== 'dispenser' && short !== 'observer') continue;
    const javaStates = Object.fromEntries(Object.entries(b.states).map(([k, v]) => [k, v.v]));
    const key = b.name + JSON.stringify(javaStates);
    if (seen.has(key)) continue;
    seen.add(key);

    const mapping = registry.getMapping(b.name);
    const beName = mapping ? mapping.b : b.name;
    const beStates = stateConverter.convertJavaToBedrock(b.name, javaStates);
    const converted = BlockConversions.convertToValid(beName, beStates);
    const finalStates = BlockConversions.resetToDefaultStates(converted.states);
    console.log(`  ${b.name}  输入 ${JSON.stringify(javaStates)}`);
    console.log(`    → name=${converted.name}  states=${JSON.stringify(finalStates)}`);
    const f = facingOf({ states: Object.fromEntries(Object.entries(finalStates).map(([k, v]) => [k, { v, t: typeof v }])) });
    console.log(`    → 方向键 ${f ? `${f.key}=${JSON.stringify(f.raw)} → ${f.dir}` : '无'}`);
}
