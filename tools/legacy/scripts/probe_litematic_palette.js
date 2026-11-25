// 临时探针：读 .litematic 的调色板（work/ 已 gitignore）
const fs = require('fs');
const zlib = require('zlib');

function parseBE(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let off = 0;
    const rb = () => dv.getInt8(off++);
    const ru8 = () => dv.getUint8(off++);
    const rs = () => { const v = dv.getInt16(off); off += 2; return v; };
    const ri = () => { const v = dv.getInt32(off); off += 4; return v; };
    const rl = () => { let v = 0n; for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(ru8()); return v; };
    const rf = () => { const v = dv.getFloat32(off); off += 4; return v; };
    const rd = () => { const v = dv.getFloat64(off); off += 8; return v; };
    const rstr = () => { const n = dv.getUint16(off); off += 2; const s = new TextDecoder().decode(new Uint8Array(u8.buffer, u8.byteOffset + off, n)); off += n; return s; };
    function payload(t) {
        switch (t) {
            case 1: return rb(); case 2: return rs(); case 3: return ri(); case 4: return rl();
            case 5: return rf(); case 6: return rd();
            case 7: { const n = ri(); const a = []; for (let i = 0; i < n; i++) a.push(rb()); return a; }
            case 8: return rstr();
            case 9: { const et = rb(); const n = ri(); const a = []; for (let i = 0; i < n; i++) a.push(payload(et)); return a; }
            case 10: return comp();
            case 11: { const n = ri(); const a = []; for (let i = 0; i < n; i++) a.push(ri()); return a; }
            case 12: { const n = ri(); const a = []; for (let i = 0; i < n; i++) a.push(rl()); return a; }
            default: throw new Error('tag ' + t);
        }
    }
    function comp() {
        const o = {};
        while (off < u8.length) { const t = rb(); if (t === 0) break; const n = rstr(); o[n] = payload(t); }
        return o;
    }
    const rt = rb();
    if (rt !== 10) throw new Error('root not compound');
    rstr();
    return comp();
}

const file = process.argv[2];
let data = fs.readFileSync(file);
if (data[0] === 0x1f && data[1] === 0x8b) data = zlib.gunzipSync(data);
const root = parseBE(data);
console.log('root keys:', Object.keys(root));
console.log('Metadata:', JSON.stringify(root.Metadata && root.Metadata.EnclosingSize));
const regions = root.Regions || {};
for (const [rname, region] of Object.entries(regions)) {
    const pal = region.BlockStatePalette || [];
    const keep = pal.filter((e) => /observer|dispenser|dropper|piston/.test(e.Name || ''));
    console.log(`\n区域 ${rname}: 调色板 ${pal.length} 项，其中观察者/发射器类 ${keep.length} 项：`);
    const seen = new Set();
    for (const e of keep) {
        const s = JSON.stringify({ name: e.Name, props: e.Properties || {} });
        if (seen.has(s)) continue;
        seen.add(s);
        console.log('  ', s);
    }
    if (pal.length && keep.length === 0) {
        console.log('  前 5 项:', pal.slice(0, 5).map((e) => e.Name + ' ' + JSON.stringify(e.Properties || {})).join(' | '));
    }
}
