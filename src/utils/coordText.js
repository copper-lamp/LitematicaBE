// src/utils/coordText.js - 坐标解析的唯一实现：表单输入、命令文本（含短命令 `/lit placeat`）

/** 世界坐标合法范围（与原版一致），超出会直接 setBlock 失败或内存爆炸 */
const COORD_LIMIT = 30000000;

/** 数值化 + 取整；非数字/空串回退 fallback（注意：0 与负数都是合法值） */
function toIntOr(value, fallback) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? Math.floor(value) : fallback;
    }
    const s = String(value === undefined || value === null ? '' : value).trim();
    if (!s) return fallback;
    const n = Number(s);
    return Number.isFinite(n) ? Math.floor(n) : fallback;
}

/** 把坐标夹到合法范围 */
function clampCoord(v) {
    if (!Number.isFinite(v)) return 0;
    return Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, Math.floor(v)));
}

/**
 * 解析 "100 64 200" / "100,64,200" / "~ ~5 ~-3" 这类坐标文本。
 * @param {string} text
 * @param {number[]} [base] 相对坐标的基准（一般是玩家坐标 x,y,z）
 * @returns {number[]|null} [x,y,z]；解析不出 3 个分量返回 null
 */
function parseXYZText(text, base) {
    const parts = String(text === undefined || text === null ? '' : text)
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean);
    if (parts.length < 3) return null;

    const b = Array.isArray(base) ? base : [];
    const out = [];
    for (let i = 0; i < 3; i++) {
        const raw = parts[i];
        const rel = /^~(-?\d+(?:\.\d+)?)?$/.exec(raw);
        if (rel) {
            const origin = Number.isFinite(b[i]) ? b[i] : 0;
            const off = rel[1] === undefined ? 0 : Number(rel[1]);
            if (!Number.isFinite(off)) return null;
            out.push(clampCoord(origin + off));
            continue;
        }
        const n = Number(raw);
        if (!Number.isFinite(n)) return null;
        out.push(clampCoord(n));
    }
    return out;
}

module.exports = { COORD_LIMIT, toIntOr, clampCoord, parseXYZText };
