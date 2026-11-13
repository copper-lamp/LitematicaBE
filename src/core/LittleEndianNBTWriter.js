// LittleEndianNBTWriter - 小端 NBT 写入器（专用于 .mcstructure）

const TAG_END = 0;
const TAG_BYTE = 1;
const TAG_SHORT = 2;
const TAG_INT = 3;
const TAG_LONG = 4;
const TAG_FLOAT = 5;
const TAG_DOUBLE = 6;
const TAG_BYTE_ARRAY = 7;
const TAG_STRING = 8;
const TAG_LIST = 9;
const TAG_COMPOUND = 10;
const TAG_INT_ARRAY = 11;
const TAG_LONG_ARRAY = 12;

class LittleEndianNBTWriter {
    constructor() {
        this.chunks = [];
    }

    /**
     * 写入完整 NBT 并返回 Uint8Array
     * @param {{type:number, name?:string, value:any}} nbtData
     * @returns {Uint8Array}
     */
    write(nbtData) {
        this.chunks = [];
        if (!nbtData || typeof nbtData !== 'object') {
            throw new Error('LittleEndianNBTWriter.write: 需要 { type, name, value } 描述树');
        }
        this.writeTag(nbtData.type === undefined ? TAG_COMPOUND : nbtData.type,
            nbtData.name || '', nbtData.value);
        return new Uint8Array(Buffer.concat(this.chunks));
    }

    /** 完整标签：类型 + 名称 + payload */
    writeTag(type, name, value) {
        this.byte(type);
        this.string(name);
        this.writePayload(type, value);
    }

    /** 只写 payload（不含类型与名称） */
    writePayload(type, value) {
        switch (type) {
            case TAG_BYTE: this.byte(value); break;
            case TAG_SHORT: this.short(value); break;
            case TAG_INT: this.int(value); break;
            case TAG_LONG: this.long(value); break;
            case TAG_FLOAT: this.float(value); break;
            case TAG_DOUBLE: this.double(value); break;
            case TAG_BYTE_ARRAY: this.byteArray(value); break;
            case TAG_STRING: this.string(value); break;
            case TAG_LIST: this.list(value); break;
            case TAG_COMPOUND: this.compound(value); break;
            case TAG_INT_ARRAY: this.intArray(value); break;
            case TAG_LONG_ARRAY: this.longArray(value); break;
            default:
                throw new Error(`未知 NBT tag type: ${type}`);
        }
    }

    // ── 基础写入 ────────────────────────────────────────────────
    _buf(n) {
        const b = Buffer.allocUnsafe(n);
        this.chunks.push(b);
        return b;
    }

    byte(value) {
        const b = this._buf(1);
        b.writeInt8(Number(value) | 0, 0);
    }

    short(value) {
        const b = this._buf(2);
        b.writeInt16LE(Number(value) | 0, 0);
    }

    int(value) {
        const b = this._buf(4);
        b.writeInt32LE(Number(value) | 0, 0);
    }

    long(value) {
        const b = this._buf(8);
        let v;
        try {
            v = BigInt.asIntN(64, BigInt(value));
        } catch (e) {
            v = 0n;
        }
        b.writeBigInt64LE(v, 0);
    }

    float(value) {
        const b = this._buf(4);
        b.writeFloatLE(Number(value) || 0, 0);
    }

    double(value) {
        const b = this._buf(8);
        b.writeDoubleLE(Number(value) || 0, 0);
    }

    string(value) {
        const bytes = Buffer.from(String(value === undefined || value === null ? '' : value), 'utf8');
        if (bytes.length > 32767) {
            throw new Error(`NBT 字符串过长（${bytes.length} 字节，上限 32767）`);
        }
        this.short(bytes.length);
        this.chunks.push(bytes);
    }

    byteArray(value) {
        const arr = value && typeof value.length === 'number' ? value : [];
        this.int(arr.length);
        const b = this._buf(arr.length);
        for (let i = 0; i < arr.length; i++) b.writeInt8(Number(arr[i]) | 0, i);
    }

    intArray(value) {
        const arr = value && typeof value.length === 'number' ? value : [];
        this.int(arr.length);
        const b = this._buf(arr.length * 4);
        for (let i = 0; i < arr.length; i++) b.writeInt32LE(Number(arr[i]) | 0, i * 4);
    }

    longArray(value) {
        const arr = value && typeof value.length === 'number' ? value : [];
        this.int(arr.length);
        const b = this._buf(arr.length * 8);
        for (let i = 0; i < arr.length; i++) {
            let v;
            try { v = BigInt.asIntN(64, BigInt(arr[i])); } catch (e) { v = 0n; }
            b.writeBigInt64LE(v, i * 8);
        }
    }

    /**
     * 列表：元素类型(1) + 长度(4) + 各元素 payload
     * value 形态兼容：
     *   - 数组 / Int32Array 等类数组（元素为 number/string/{type,value}）
     *   - { listType, value:[...] }
     *   - { type:9, listType, value:[...] }
     */
    list(value) {
        let listType;
        let items;

        if (Array.isArray(value) || (value && typeof value === 'object' && typeof value.length === 'number')) {
            items = value;
            listType = this.inferListType(items);
        } else if (value && typeof value === 'object') {
            const rawItems = value.value !== undefined ? value.value : value.items;
            // Int32Array / 普通数组都接受（block_indices 的两层就是 Int32Array）
            items = rawItems && typeof rawItems.length === 'number' ? rawItems : [];
            listType = value.listType !== undefined ? value.listType : this.inferListType(items);
        } else {
            items = [];
            listType = TAG_COMPOUND;
        }

        // 空列表允许元素类型为 TAG_End（BDS 方块实体 NBT 语法）；
        // 但非空列表若标成 End 就是坏数据，退回推断值。
        if (listType === TAG_END && items.length > 0) {
            listType = this.inferListType(items);
        }

        this.byte(listType);
        this.int(items.length);

        for (const item of items) {
            if (item === null || item === undefined) {
                // NBT 里没有 TAG_End 元素，跳过（调用方应保证列表项有效）
                continue;
            }
            // 顺序要紧：列表节点可能同时带 type 与 listType，必须让 listType 优先，
            // 否则会退化成 inferListType（空列表会被写成 List<Compound>，与原文件不符）。
            if (typeof item === 'object' && !Array.isArray(item)
                && Object.prototype.hasOwnProperty.call(item, 'listType')) {
                this.list(item);   // 嵌套列表元素（List<List<Int>> / List<End>）
            } else if (typeof item === 'object' && !Array.isArray(item)
                && Object.prototype.hasOwnProperty.call(item, 'type')) {
                this.writePayload(item.type, item.value);
            } else {
                this.writePayload(listType, item);
            }
        }
    }

    /**
     * Compound：[类型 + 名称 + payload]* + TAG_End
     * 每个值可以是：
     *   - { type, value }          显式类型
     *   - { listType, value:[...] } 列表
     *   - 原生 number/string/boolean/数组（推断）
     */
    compound(value) {
        if (!value || typeof value !== 'object') {
            this.byte(TAG_END);
            return;
        }

        for (const [key, val] of Object.entries(value)) {
            if (val === undefined || val === null) continue;
            // listType 优先：列表节点常同时带 type（=9）与 listType，
            // 若先按 type 走会把 listType 丢掉（空列表被写成 List<Compound>）。
            if (typeof val === 'object' && Object.prototype.hasOwnProperty.call(val, 'listType')) {
                this.writeTag(TAG_LIST, key, val);
            } else if (typeof val === 'object' && Object.prototype.hasOwnProperty.call(val, 'type')) {
                this.writeTag(val.type, key, val.value);
            } else {
                this.writeTag(this.inferType(val), key, val);
            }
        }

        this.byte(TAG_END);
    }

    // ── 类型推断（仅在调用方没显式给 type 时使用）────────────────
    inferListType(items) {
        if (!items || items.length === 0) return TAG_COMPOUND;
        const first = items[0];
        if (first === null || first === undefined) return TAG_COMPOUND;
        if (typeof first === 'object') {
            if (Object.prototype.hasOwnProperty.call(first, 'type')) return first.type;
            if (Object.prototype.hasOwnProperty.call(first, 'listType')) return TAG_LIST;
            return TAG_COMPOUND;
        }
        if (typeof first === 'string') return TAG_STRING;
        if (typeof first === 'boolean') return TAG_BYTE;
        if (typeof first === 'number') {
            if (!Number.isInteger(first)) return TAG_DOUBLE;
            if (first >= -128 && first <= 127) return TAG_BYTE;
            if (first >= -32768 && first <= 32767) return TAG_SHORT;
            return TAG_INT;
        }
        return TAG_COMPOUND;
    }

    inferType(value) {
        if (value === null || value === undefined) return TAG_COMPOUND;
        if (typeof value === 'boolean') return TAG_BYTE;
        if (typeof value === 'bigint') return TAG_LONG;
        if (typeof value === 'number') {
            if (!Number.isInteger(value)) return TAG_DOUBLE;
            if (value >= -128 && value <= 127) return TAG_BYTE;
            if (value >= -32768 && value <= 32767) return TAG_SHORT;
            if (value >= -2147483648 && value <= 2147483647) return TAG_INT;
            return TAG_LONG;
        }
        if (typeof value === 'string') return TAG_STRING;
        if (Array.isArray(value)) {
            return value.length > 0 && typeof value[0] === 'number' && Number.isInteger(value[0])
                ? TAG_INT_ARRAY
                : TAG_LIST;
        }
        if (value instanceof Uint8Array || value instanceof Buffer) return TAG_BYTE_ARRAY;
        if (typeof value === 'object') return TAG_COMPOUND;
        return TAG_INT;
    }
}

module.exports = {
    LittleEndianNBTWriter,
    TAG_END,
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
};
