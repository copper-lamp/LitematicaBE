/**
 * probe_png_types.js — 统计 addon/RP 里 ghost 贴图的 PNG 编码类型与 alpha 分布
 *
 * 目的：确认"ghost 方块不半透明"是否因为贴图本身 alpha 全 255。
 * PNG 颜色类型：0=灰度 2=RGB 3=调色板 4=灰度+A 6=RGBA
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const texDir = path.join(ROOT, 'addon', 'RP', 'textures', 'blocks');

function parseChunks(buf) {
    const chunks = [];
    let off = 8;
    while (off < buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('ascii', off + 4, off + 8);
        const data = buf.subarray(off + 8, off + 8 + len);
        chunks.push({ type, data });
        off += 12 + len;
    }
    return chunks;
}

function analyze(file) {
    const buf = fs.readFileSync(file);
    const chunks = parseChunks(buf);
    const ihdr = chunks.find(c => c.type === 'IHDR').data;
    const width = ihdr.readUInt32BE(0);
    const height = ihdr.readUInt32BE(4);
    const bitDepth = ihdr[8];
    const colorType = ihdr[9];
    const interlace = ihdr[12];
    const idat = Buffer.concat(chunks.filter(c => c.type === 'IDAT').map(c => c.data));
    let raw = null;
    let note = '';
    try { raw = zlib.inflateSync(idat); } catch (e) { note = 'inflate失败'; }
    return { width, height, bitDepth, colorType, interlace, rawLen: raw ? raw.length : 0, note, size: buf.length };
}

const files = fs.readdirSync(texDir).filter(f => f.endsWith('.png'));
const stat = {};
const rows = [];
for (const f of files) {
    const a = analyze(path.join(texDir, f));
    const key = `ct${a.colorType}/bd${a.bitDepth}/il${a.interlace}`;
    stat[key] = (stat[key] || 0) + 1;
    rows.push({ f, ...a });
}

console.log(`贴图总数: ${files.length}`);
console.log('编码分布:');
for (const [k, v] of Object.entries(stat).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(22)} ${v}`);

console.log('\n抽样 6 张:');
for (const r of rows.filter(r => /^(stone|grass_block_top|cobblestone|oak_planks|glass|water_still)/.test(r.f)).slice(0, 6)) {
    console.log(`  ${r.f.padEnd(26)} ${r.width}x${r.height} ct=${r.colorType} bd=${r.bitDepth} raw=${r.rawLen} ${r.note}`);
}

// 粗判 alpha：ct6 时每像素 4 字节，逐像素看 A 通道的 max
function alphaSummary(r) {
    if (r.colorType !== 6 || r.bitDepth !== 8 || !r.rawLen) return '非 RGBA8，跳过';
    const bpp = 4;
    const stride = r.width * bpp;
    const raw = fs.readFileSync(path.join(texDir, r.f));
    const chunks = parseChunks(raw);
    const idat = Buffer.concat(chunks.filter(c => c.type === 'IDAT').map(c => c.data));
    const data = zlib.inflateSync(idat);
    let maxA = 0, minA = 255, transparent = 0;
    for (let y = 0; y < r.height; y++) {
        const rowStart = y * (stride + 1) + 1;
        for (let x = 0; x < r.width; x++) {
            const a = data[rowStart + x * bpp + 3];
            if (a > maxA) maxA = a;
            if (a < minA) minA = a;
            if (a < 255) transparent++;
        }
    }
    return `alpha min=${minA} max=${maxA} 非全不透明像素=${transparent}/${r.width * r.height}`;
}

console.log('\nalpha 抽样（未反滤波，仅看原始 A 字节的极值）:');
for (const r of rows.filter(r => r.colorType === 6 && /^(stone|cobblestone|oak_planks|glass)\.png$/.test(r.f))) {
    console.log(`  ${r.f.padEnd(20)} ${alphaSummary(r)}`);
}
