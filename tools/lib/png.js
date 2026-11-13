/**
 * png.js — 最小 PNG 编解码（只覆盖基岩版资源包实际用到的形态）
 *
 * 支持：colorType 6 (RGBA) / 2 (RGB) / 0 (灰度) / 4 (灰度+alpha) / 3 (调色板)，
 *       bitDepth 8（调色板额外支持 1/2/4/8），无隔行（interlace=0）。
 * 输出：统一 RGBA8、interlace=0、每行 filter 0。
 *
 * 用途：build_addon 构建期给 ghost 贴图做 alpha 调制 —— 基岩版原版方块贴图 alpha 全 255，
 * 单靠 render_method:"blend" 不会变半透明（ghost 实测"能穿过但完全不透明"就是这个原因）。
 */

const zlib = require('zlib');

const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, c]);
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
}

/** 反滤波单行（原地写入 out） */
function unfilter(filter, cur, prev, bpp, stride) {
    for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0;
        const b = prev ? prev[i] : 0;
        const c = (i >= bpp && prev) ? prev[i - bpp] : 0;
        let v = cur[i];
        switch (filter) {
            case 0: break;
            case 1: v = (v + a) & 0xFF; break;
            case 2: v = (v + b) & 0xFF; break;
            case 3: v = (v + ((a + b) >> 1)) & 0xFF; break;
            case 4: v = (v + paeth(a, b, c)) & 0xFF; break;
            default: throw new Error(`不支持的 PNG filter ${filter}`);
        }
        cur[i] = v;
    }
}

/**
 * @param {Buffer} buf PNG 文件内容
 * @returns {{width:number,height:number,data:Buffer}} RGBA8 像素（行优先，无 padding）
 */
function decode(buf) {
    if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('不是 PNG（signature 不匹配）');
    let off = 8;
    let ihdr = null;
    const idats = [];
    let palette = null;
    let trns = null;
    while (off < buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('ascii', off + 4, off + 8);
        const data = buf.subarray(off + 8, off + 8 + len);
        if (type === 'IHDR') ihdr = data;
        else if (type === 'IDAT') idats.push(data);
        else if (type === 'PLTE') palette = data;
        else if (type === 'tRNS') trns = data;
        else if (type === 'IEND') break;
        off += 12 + len;
    }
    if (!ihdr) throw new Error('PNG 缺 IHDR');

    const width = ihdr.readUInt32BE(0);
    const height = ihdr.readUInt32BE(4);
    const bitDepth = ihdr[8];
    const colorType = ihdr[9];
    const interlace = ihdr[12];
    if (interlace !== 0) throw new Error('不支持隔行 PNG');

    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
    if (!channels) throw new Error(`不支持 colorType ${colorType}`);

    // 每像素位宽 -> 每行字节数
    const bitsPerPixel = channels * bitDepth;
    const stride = Math.ceil(width * bitsPerPixel / 8);
    const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8));

    const raw = zlib.inflateSync(Buffer.concat(idats));
    const expected = (stride + 1) * height;
    if (raw.length < expected) throw new Error(`IDAT 数据不足：${raw.length} < ${expected}`);

    const out = Buffer.alloc(width * height * 4);
    let prev = null;
    for (let y = 0; y < height; y++) {
        const rowStart = y * (stride + 1);
        const filter = raw[rowStart];
        const cur = Buffer.from(raw.subarray(rowStart + 1, rowStart + 1 + stride));
        unfilter(filter, cur, prev, bpp, stride);
        prev = cur;

        for (let x = 0; x < width; x++) {
            const o = (y * width + x) * 4;
            if (colorType === 6) {
                out[o] = cur[x * 4]; out[o + 1] = cur[x * 4 + 1]; out[o + 2] = cur[x * 4 + 2]; out[o + 3] = cur[x * 4 + 3];
            } else if (colorType === 2) {
                out[o] = cur[x * 3]; out[o + 1] = cur[x * 3 + 1]; out[o + 2] = cur[x * 3 + 2]; out[o + 3] = 255;
            } else if (colorType === 0) {
                if (bitDepth === 8) {
                    const v = cur[x]; out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255;
                } else {
                    const perByte = 8 / bitDepth;
                    const byte = cur[Math.floor(x / perByte)];
                    const shift = 8 - bitDepth * ((x % perByte) + 1);
                    const v = ((byte >> shift) & ((1 << bitDepth) - 1)) * (255 / ((1 << bitDepth) - 1));
                    out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255;
                }
            } else if (colorType === 4) {
                const v = cur[x * 2]; out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = cur[x * 2 + 1];
            } else if (colorType === 3) {
                let idx;
                if (bitDepth === 8) idx = cur[x];
                else {
                    const perByte = 8 / bitDepth;
                    const byte = cur[Math.floor(x / perByte)];
                    const shift = 8 - bitDepth * ((x % perByte) + 1);
                    idx = (byte >> shift) & ((1 << bitDepth) - 1);
                }
                const p = idx * 3;
                out[o] = palette[p]; out[o + 1] = palette[p + 1]; out[o + 2] = palette[p + 2];
                out[o + 3] = (trns && idx < trns.length) ? trns[idx] : 255;
            }
        }
    }
    return { width, height, data: out };
}

/** @param {{width:number,height:number,data:Buffer}} img @returns {Buffer} PNG8 RGBA */
function encode(img) {
    const { width, height, data } = img;
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0;
        data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    return Buffer.concat([
        SIGNATURE,
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

/**
 * alpha 调制：把不透明像素的 alpha 按系数压缩，完全透明像素保持 0。
 * @param {{width:number,height:number,data:Buffer}} img
 * @param {number} factor 0..1
 * @returns {{width:number,height:number,data:Buffer}} 新图像
 */
function modulateAlpha(img, factor) {
    const data = Buffer.from(img.data);
    for (let i = 3; i < data.length; i += 4) {
        const a = data[i];
        if (a === 0) continue;
        data[i] = Math.min(255, Math.max(1, Math.round(a * factor)));
    }
    return { width: img.width, height: img.height, data };
}

/** 统计 alpha 分布，用于构建期自检 */
function alphaStats(img) {
    let sum = 0, opaque = 0, clear = 0;
    const total = img.width * img.height;
    for (let i = 3; i < img.data.length; i += 4) {
        const a = img.data[i];
        sum += a;
        if (a === 255) opaque++;
        if (a === 0) clear++;
    }
    return { total, mean: total ? sum / total : 0, opaque, clear };
}

module.exports = { decode, encode, modulateAlpha, alphaStats, crc32, chunk, SIGNATURE };
