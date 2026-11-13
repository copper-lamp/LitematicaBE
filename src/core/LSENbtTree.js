// LSENbtTree - 把 LSE 的 NbtCompound / NbtList 转成导出用的 { type, value } 描述树

const {
    TAG_BYTE,
    TAG_SHORT,
    TAG_INT,
    TAG_LONG,
    TAG_FLOAT,
    TAG_DOUBLE,
    TAG_BYTE_ARRAY,
    TAG_STRING,
    TAG_LIST,
    TAG_COMPOUND,
    TAG_INT_ARRAY,
    TAG_LONG_ARRAY
} = require('./LittleEndianNBTWriter');

/** 下标即 NBT 类型号（End=0 … LongArray=12） */
const TAG_NAMES = [
    'End', 'Byte', 'Short', 'Int', 'Long', 'Float', 'Double',
    'ByteArray', 'String', 'List', 'Compound', 'IntArray', 'LongArray'
];

/** LSE 的 Enum / number / 字符串 → 类型号；认不出返回 0 */
function tagTypeToNumber(t) {
    if (typeof t === 'number' && t >= 0 && t <= 12) return t;
    if (typeof t === 'string') {
        const i = TAG_NAMES.indexOf(t);
        if (i >= 0) return i;
    }
    if (t && typeof t === 'object') {
        for (const k of ['value', 'id', 'type', 'tagType', 'getValue']) {
            const v = t[k];
            if (typeof v === 'number' && v >= 0 && v <= 12) return v;
            if (typeof v === 'function') {
                try {
                    const got = v.call(t);
                    if (typeof got === 'number' && got >= 0 && got <= 12) return got;
                } catch (e) { /* 忽略 */ }
            }
        }
        if (typeof t.name === 'string') {
            const i = TAG_NAMES.indexOf(t.name);
            if (i >= 0) return i;
        }
        try {
            const s = String(t);
            const i = TAG_NAMES.indexOf(s);
            if (i >= 0) return i;
        } catch (e) { /* 忽略 */ }
    }
    // 最后一招：与全局 NBT 枚举逐个比对
    if (typeof NBT !== 'undefined' && NBT) {
        for (let i = 0; i < TAG_NAMES.length; i++) {
            if (NBT[TAG_NAMES[i]] !== undefined && NBT[TAG_NAMES[i]] === t) return i;
        }
    }
    return 0;
}

function isCompoundTag(x) {
    return !!x && typeof x === 'object' && typeof x.getKeys === 'function' && typeof x.getTag === 'function';
}

function isListTag(x) {
    return !!x && typeof x === 'object' && typeof x.getSize === 'function'
        && typeof x.getTag === 'function' && typeof x.getKeys !== 'function';
}

function rawValue(tag) {
    if (tag && typeof tag.get === 'function') {
        try { return tag.get(); } catch (e) { return null; }
    }
    return tag;
}

function toNumberArray(v) {
    if (!v) return [];
    if (typeof v.length === 'number') {
        const out = new Array(v.length);
        for (let i = 0; i < v.length; i++) out[i] = v[i];
        return out;
    }
    return [];
}

/**
 * 任意 NBT 标签 → 描述树
 * @returns {{type:number,value:any}|{listType:number,value:Array}|null}
 */
function nbtTagToTree(tag, depth = 0) {
    if (tag === null || tag === undefined) return null;
    if (depth > 32) throw new Error('NBT 嵌套过深（>32 层），可能存在环');

    if (isCompoundTag(tag)) {
        return { type: TAG_COMPOUND, value: compoundToValue(tag, depth) };
    }
    if (isListTag(tag)) {
        // 注意：空列表的元素类型可能是 TAG_End（0）—— BDS 自己写方块实体 NBT 时就是这样
        // （实测样本 AttachedBlocks / BreakBlocks 均为 List<End> len=0）。这里必须保真，
        // 不能 `|| TAG_COMPOUND` 把 0 覆盖掉，否则写回去与原文件不一致。
        const et = tagTypeToNumber(typeof tag.getType === 'function' ? safeCall(() => tag.getType()) : TAG_COMPOUND);
        return { listType: et, value: listToValue(tag, et, depth) };
    }

    // 标量标签：类型优先取 getType()，取不到按值推断
    let type = 0;
    if (typeof tag.getType === 'function') type = tagTypeToNumber(safeCall(() => tag.getType()));
    if (!type) type = inferScalarType(rawValue(tag));
    return payloadToTree(type, tag, depth);
}

function safeCall(fn) {
    try { return fn(); } catch (e) { return undefined; }
}

function inferScalarType(v) {
    if (typeof v === 'boolean') return TAG_BYTE;
    if (typeof v === 'string') return TAG_STRING;
    if (typeof v === 'bigint') return TAG_LONG;
    if (typeof v === 'number') {
        if (!Number.isInteger(v)) return TAG_DOUBLE;
        if (v >= -128 && v <= 127) return TAG_BYTE;
        if (v >= -32768 && v <= 32767) return TAG_SHORT;
        return TAG_INT;
    }
    return TAG_INT;
}

function compoundToValue(comp, depth) {
    const out = Object.create(null);
    let keys = [];
    try { keys = comp.getKeys() || []; } catch (e) { keys = []; }
    for (const key of keys) {
        let type = 0;
        try { type = tagTypeToNumber(comp.getTypeOf(key)); } catch (e) { type = 0; }
        let tag = null;
        try { tag = comp.getTag(key); } catch (e) { tag = null; }
        if (!type) type = inferScalarType(rawValue(tag));
        const tree = payloadToTree(type, tag, depth + 1);
        if (tree) out[key] = tree;
    }
    return out;
}

function listToValue(listTag, elemType, depth) {
    const out = [];
    let size = 0;
    try { size = listTag.getSize() | 0; } catch (e) { size = 0; }
    for (let i = 0; i < size; i++) {
        let tag = null;
        try { tag = listTag.getTag(i); } catch (e) { tag = null; }
        out.push(payloadToTree(elemType, tag, depth + 1));
    }
    return out;
}

function payloadToTree(type, tag, depth) {
    switch (type) {
        case TAG_COMPOUND: {
            const comp = isCompoundTag(tag) ? tag : null;
            return { type: TAG_COMPOUND, value: comp ? compoundToValue(comp, depth) : Object.create(null) };
        }
        case TAG_LIST: {
            const rawEt = tag && typeof tag.getType === 'function'
                ? safeCall(() => tag.getType())
                : TAG_COMPOUND;
            // 0 = TAG_End：空列表可以合法地标成 End（BDS 自己就这么写），必须原样保留
            const et = tagTypeToNumber(rawEt);
            return { listType: et, value: isListTag(tag) ? listToValue(tag, et, depth) : [] };
        }
        case TAG_BYTE_ARRAY:
            return { type: TAG_BYTE_ARRAY, value: toNumberArray(rawValue(tag)) };
        case TAG_INT_ARRAY:
            return { type: TAG_INT_ARRAY, value: toNumberArray(rawValue(tag)) };
        case TAG_LONG_ARRAY:
            return { type: TAG_LONG_ARRAY, value: toNumberArray(rawValue(tag)) };
        case TAG_BYTE: {
            const v = rawValue(tag);
            return { type: TAG_BYTE, value: typeof v === 'boolean' ? (v ? 1 : 0) : (Number(v) | 0) };
        }
        case TAG_SHORT:
            return { type: TAG_SHORT, value: Number(rawValue(tag)) | 0 };
        case TAG_INT:
            return { type: TAG_INT, value: Number(rawValue(tag)) | 0 };
        case TAG_LONG: {
            const v = rawValue(tag);
            return { type: TAG_LONG, value: typeof v === 'bigint' ? v : BigInt(Math.trunc(Number(v) || 0)) };
        }
        case TAG_FLOAT:
            return { type: TAG_FLOAT, value: Number(rawValue(tag)) || 0 };
        case TAG_DOUBLE:
            return { type: TAG_DOUBLE, value: Number(rawValue(tag)) || 0 };
        case TAG_STRING:
            return { type: TAG_STRING, value: String(rawValue(tag) === null || rawValue(tag) === undefined ? '' : rawValue(tag)) };
        default:
            return null;
    }
}

/**
 * 读方块的 states（带类型保真）
 * @param {object} statesNbt NbtCompound（block.getNbt().getTag('states')）
 * @returns {Object<string,{v:any,type:number}>}
 */
function readBlockStates(statesNbt) {
    const out = {};
    if (!isCompoundTag(statesNbt)) return out;
    let keys = [];
    try { keys = statesNbt.getKeys() || []; } catch (e) { return out; }

    for (const key of keys) {
        let type = 0;
        try { type = tagTypeToNumber(statesNbt.getTypeOf(key)); } catch (e) { type = 0; }
        let tag = null;
        try { tag = statesNbt.getTag(key); } catch (e) { tag = null; }
        if (!type) type = inferScalarType(rawValue(tag));

        let v = rawValue(tag);
        // 方块状态理论上只有标量；万一拿到 Compound/List，降级成字符串以免写出非法结构
        if (type === TAG_COMPOUND || type === TAG_LIST || type === TAG_BYTE_ARRAY
            || type === TAG_INT_ARRAY || type === TAG_LONG_ARRAY) {
            try { v = JSON.stringify(v); } catch (e) { v = String(v); }
            type = TAG_STRING;
        }
        if (type === TAG_BYTE) v = typeof v === 'boolean' ? (v ? 1 : 0) : (Number(v) | 0);
        if (type === TAG_SHORT || type === TAG_INT) v = Number(v) | 0;
        if (type === TAG_STRING) v = String(v === null || v === undefined ? '' : v);

        out[key] = { v, type };
    }
    return out;
}

module.exports = {
    tagTypeToNumber,
    nbtTagToTree,
    readBlockStates,
    isCompoundTag,
    isListTag,
    TAG_NAMES
};
