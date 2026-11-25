import { deflateRawSync } from 'node:zlib';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        table[i] = c >>> 0;
    }
    return table;
})();

function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

// 固定时间戳，保证同一份源码产出的 zip 可复现
const DOS_TIME = 0;
const DOS_DATE = 33; // 1980-01-01

/** 递归收集目录下的文件，返回 { name, path }，name 一律使用 / 分隔 */
export function collectDir(dir, prefix = '') {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...collectDir(full, `${prefix}${entry.name}/`));
        } else if (entry.isFile()) {
            out.push({ name: `${prefix}${entry.name}`, path: full });
        }
    }
    return out;
}

/**
 * 写出 ZIP 归档（deflate，无额外依赖）
 * @param {string} outPath
 * @param {Array<{name: string, path?: string, data?: Buffer}>} entries
 */
export function writeZip(outPath, entries) {
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const entry of entries) {
        const data = entry.data || readFileSync(entry.path);
        const name = Buffer.from(entry.name, 'utf8');
        const compressed = deflateRawSync(data, { level: 9 });
        const crc = crc32(data);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034B50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6); // UTF-8 文件名
        local.writeUInt16LE(8, 8);      // deflate
        local.writeUInt16LE(DOS_TIME, 10);
        local.writeUInt16LE(DOS_DATE, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);

        const localOffset = offset;
        const localRecord = Buffer.concat([local, name, compressed]);
        locals.push(localRecord);
        offset += localRecord.length;

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014B50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(8, 10);
        central.writeUInt16LE(DOS_TIME, 12);
        central.writeUInt16LE(DOS_DATE, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
        central.writeUInt32LE(localOffset, 42);
        centrals.push(Buffer.concat([central, name]));
    }

    const centralSize = centrals.reduce((n, b) => n + b.length, 0);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054B50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);

    writeFileSync(outPath, Buffer.concat([...locals, ...centrals, eocd]));
}
