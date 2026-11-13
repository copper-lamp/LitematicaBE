// uploadGuard - 上传站的文件名/路径/魔数校验

const fs = require('fs');
const path = require('path');

// Windows 保留设备名：这些名字在 Windows 上无法作为文件名（哪怕带扩展名）
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

const MAX_STEM = 80;

/**
 * 把任意字符串净化成安全的文件名主体（不含扩展名）。
 * - 只取最后一段（去掉 / 与 \ 之前的路径，防目录穿越）
 * - 去掉控制字符与 Windows 非法字符 <>:"|?*
 * - 去掉首尾的点与空格，防止 "..." / "x " / 隐藏文件
 * - 截断到 80 字符，避开 Windows 260 路径上限
 * - 空名或保留设备名时回落成 schematic_<时间戳>
 *
 * @param {string} raw
 * @returns {string}
 */
function sanitizeStem(raw) {
    let n = String(raw === undefined || raw === null ? '' : raw);
    n = n.split(/[\\/]/).pop() || '';                 // 去目录部分（两种分隔符都切）
    n = n.replace(/[\u0000-\u001f<>:"|?*]/g, '_');    // 控制字符 + Windows 非法字符
    n = n.replace(/\s+/g, ' ').trim();                // 折叠空白
    n = n.replace(/^[.\s]+|[.\s]+$/g, '');            // 去首尾点与空格
    n = n.slice(0, MAX_STEM);
    if (!n) n = `schematic_${Date.now()}`;
    if (WIN_RESERVED.test(n)) n = `schematic_${n}`;
    return n;
}

/**
 * 校验一次上传声明的文件名。
 *
 * @param {string} raw       客户端给的原始文件名（可含路径）
 * @param {string[]} allowExt 允许的扩展名（小写，含点）
 * @returns {{ok: boolean, ext?: string, stem?: string, safeName?: string, error?: string}}
 */
function checkUploadName(raw, allowExt) {
    const src = String(raw === undefined || raw === null ? '' : raw).trim();
    if (!src) return { ok: false, error: '文件名不能为空' };
    if (src.length > 200) return { ok: false, error: '文件名过长' };
    // 先按两种分隔符取最后一段：浏览器在旧版本里会带完整路径
    const base = src.split(/[\\/]/).pop() || '';
    if (!base || base === '.' || base === '..') return { ok: false, error: '文件名非法' };
    if (base.includes('..')) return { ok: false, error: '文件名非法' };

    const ext = path.extname(base).toLowerCase();
    const list = Array.isArray(allowExt) ? allowExt.map((e) => String(e).toLowerCase()) : [];
    if (!ext || !list.includes(ext)) {
        return { ok: false, error: `只接受 ${list.join(' / ') || '(未配置白名单)'} 文件` };
    }

    const stem = sanitizeStem(base.slice(0, base.length - ext.length));
    return { ok: true, ext, stem, safeName: stem + ext };
}

/**
 * 在目标目录内解析出最终落盘路径。
 *
 * @param {string} dir       目标目录（schematics）
 * @param {string} stem      已净化的文件名主体
 * @param {string} ext       扩展名（含点）
 * @param {boolean} overwrite 是否允许覆盖同名文件
 * @returns {string} 绝对路径
 * @throws {Error} 解析结果跳出目标目录时抛错（正常输入不会发生）
 */
function resolveTarget(dir, stem, ext, overwrite) {
    const root = path.resolve(dir);
    const safeStem = sanitizeStem(stem);
    let target = path.resolve(root, safeStem + ext);
    if (target !== root && !target.startsWith(root + path.sep)) {
        throw new Error('path escape');
    }
    if (!overwrite) {
        let i = 1;
        while (fs.existsSync(target)) {
            target = path.resolve(root, `${safeStem}-${i++}${ext}`);
            if (i > 999) throw new Error('同名文件过多');
        }
    }
    return target;
}

/**
 * 文件头魔数校验：只读前 8 字节，不解析内容。
 *
 * .litematic：Java 版 NBT，gzip 压缩（1f 8b）或未压缩（0a = TAG_Compound）
 * .mcstructure：基岩版小端 NBT，首字节同样是 TAG 类型（0a 最常见），
 *               McstructureLoader 也接受 gzip 包裹，因此一并放行
 *
 * @param {string} ext 小写扩展名（含点）
 * @param {Buffer} head 文件头
 * @returns {boolean}
 */
function checkMagic(ext, head) {
    if (!head || head.length < 1) return false;
    const isGzip = head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b;
    if (ext === '.litematic') {
        // TAG_Compound 或 gzip 头
        return isGzip || head[0] === 0x0a;
    }
    if (ext === '.mcstructure') {
        // 小端 NBT：TAG 类型 1..12（Byte/Short/Int/Long/Float/Double/ByteArray/String/List/Compound/IntArray/LongArray）
        // 基岩结构文件实际只会出现 10（Compound），这里放宽到 1..12 以免误杀工具变体
        return isGzip || (head[0] >= 0x01 && head[0] <= 0x0c);
    }
    return false;
}

/**
 * 是否允许这个客户端 IP 访问（前缀匹配）。
 * allowIps 为空 = 不限制；支持 "192.168." / "10.0.0.5" 这类前缀。
 *
 * @param {string[]} allowIps
 * @param {string} ip
 * @returns {boolean}
 */
function ipAllowed(allowIps, ip) {
    const list = Array.isArray(allowIps) ? allowIps.filter((x) => typeof x === 'string' && x.length) : [];
    if (!list.length) return true;
    const addr = String(ip || '');
    return list.some((p) => addr.startsWith(p));
}

module.exports = {
    sanitizeStem,
    checkUploadName,
    resolveTarget,
    checkMagic,
    ipAllowed,
    WIN_RESERVED,
};
