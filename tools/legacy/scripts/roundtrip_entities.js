// 临时校验：真实样本的 block_position_data（方块实体）能否原样带过写→读（work/ 已 gitignore）
const fs = require('fs');
const path = require('path');
const PLUGIN = path.resolve(__dirname, '..');
const { McstructureWriter } = require(path.join(PLUGIN, 'src/core/McstructureWriter.js'));

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

const file = process.argv[2];
const root = parseTypedLE(fs.readFileSync(file));
const sizeNode = root.size.value.map((n) => n.value);
const [sx, sy, sz] = sizeNode;
const st = root.structure.value;
const pal = st.palette.value.default.value;
const blockPalette = pal.block_palette.value.map((e) => ({
    name: e.value.name.value,
    states: Object.fromEntries(Object.entries(e.value.states.value).map(([k, v]) => [k, { v: v.value, type: v.type }]))
}));
const layer0 = st.block_indices.value[0].value.map((n) => n.value);

// 原 block_position_data → { linearIndex: {type:10,value:{block_entity_data: ...}} }
const srcBpd = {};
for (const [k, v] of Object.entries(pal.block_position_data.value)) {
    srcBpd[k] = v;   // { block_entity_data: {type,value} }
}

const blocks = [];
for (let i = 0; i < layer0.length; i++) {
    const entry = blockPalette[layer0[i]];
    if (!entry) continue;
    const n = String(entry.name || '').replace(/^minecraft:/, '');
    if (n === 'air' || n.endsWith('_air') || n === 'structure_void') continue;
    const x = Math.floor(i / (sz * sy));
    const y = Math.floor(i / sz) % sy;
    const z = i % sz;
    const rec = { pos: [x, y, z], name: entry.name, states: entry.states };
    if (srcBpd[String(i)]) rec.blockEntity = srcBpd[String(i)].value.block_entity_data;
    blocks.push(rec);
}

const built = McstructureWriter.build({ size: { x: sx, y: sy, z: sz }, blocks, worldOrigin: { x: 0, y: 0, z: 0 } });
const again = parseTypedLE(Buffer.from(built.buffer));
const dstBpd = again.structure.value.palette.value.default.value.block_position_data.value;

const norm = (node) => JSON.stringify(node, (k, v) => (typeof v === 'bigint' ? `${v}n` : v));
const srcKeys = Object.keys(srcBpd).sort();
const dstKeys = Object.keys(dstBpd).sort();
const missing = srcKeys.filter((k) => !dstKeys.includes(k));
const mismatched = dstKeys.filter((k) => srcBpd[k] && norm(srcBpd[k]) !== norm(dstBpd[k]));

console.log(`样本: ${path.basename(file)}  ${sx}×${sy}×${sz}`);
console.log(`原方块实体块 ${srcKeys.length} → 重建 ${dstKeys.length}（stats.entityBlocks=${built.stats.entityBlocks}）`);
console.log(`  丢失 ${missing.length}，内容不一致 ${mismatched.length}`);
if (missing.length) console.log('  missing 示例:', missing.slice(0, 5));
if (mismatched.length) {
    const k = mismatched[0];
    console.log('  差异键', k);
    console.log('   原:', norm(srcBpd[k]).slice(0, 240));
    console.log('   新:', norm(dstBpd[k]).slice(0, 240));
}
console.log(`文件字节 ${built.buffer.length}`);
process.exit(missing.length === 0 && mismatched.length === 0 ? 0 : 1);
