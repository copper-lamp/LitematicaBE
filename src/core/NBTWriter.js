// NBTWriter - NBT数据写入器
// 将JavaScript对象序列化为NBT二进制格式
// 格式与原版Litematica完全兼容

class NBTWriter {
    constructor() {
        this.buffer = [];
    }

    /**
     * 写入NBT数据并返回Uint8Array
     */
    write(nbtData) {
        this.buffer = [];
        // 写入根标签（名称空字符串）
        this.writeTag(nbtData.type || 10, nbtData.name || '', nbtData.value);
        return new Uint8Array(this.buffer);
    }

    /**
     * 写入完整标签（类型+名称+值）
     */
    writeTag(type, name, value) {
        this.writeByte(type);
        this.writeString(name);
        this.writePayload(type, value);
    }

    /**
     * 写入payload（不含类型和名称）
     */
    writePayload(type, value) {
        switch (type) {
            case 1: // TAG_Byte
                this.writeByte(value);
                break;
            case 2: // TAG_Short
                this.writeShort(value);
                break;
            case 3: // TAG_Int
                this.writeInt(value);
                break;
            case 4: // TAG_Long
                this.writeLong(value);
                break;
            case 5: // TAG_Float
                this.writeFloat(value);
                break;
            case 6: // TAG_Double
                this.writeDouble(value);
                break;
            case 7: // TAG_Byte_Array
                this.writeByteArray(value);
                break;
            case 8: // TAG_String
                this.writeString(value);
                break;
            case 9: // TAG_List
                this.writeList(value);
                break;
            case 10: // TAG_Compound
                this.writeCompound(value);
                break;
            case 11: // TAG_Int_Array
                this.writeIntArray(value);
                break;
            case 12: // TAG_Long_Array
                this.writeLongArray(value);
                break;
            default:
                throw new Error(`Unknown NBT tag type: ${type}`);
        }
    }

    writeByte(value) {
        this.buffer.push(value & 0xFF);
    }

    writeShort(value) {
        const v = value | 0;
        this.buffer.push((v >> 8) & 0xFF);
        this.buffer.push(v & 0xFF);
    }

    writeInt(value) {
        const v = value | 0;
        this.buffer.push((v >> 24) & 0xFF);
        this.buffer.push((v >> 16) & 0xFF);
        this.buffer.push((v >> 8) & 0xFF);
        this.buffer.push(v & 0xFF);
    }

    writeLong(value) {
        let val = BigInt.asIntN(64, BigInt(value));
        if (val < 0n) {
            val = val + (1n << 64n);
        }
        for (let i = 7; i >= 0; i--) {
            this.buffer.push(Number((val >> BigInt(i * 8)) & 0xFFn));
        }
    }

    writeFloat(value) {
        const buf = new ArrayBuffer(4);
        new DataView(buf).setFloat32(0, value, false);
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < 4; i++) {
            this.buffer.push(bytes[i]);
        }
    }

    writeDouble(value) {
        const buf = new ArrayBuffer(8);
        new DataView(buf).setFloat64(0, value, false);
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < 8; i++) {
            this.buffer.push(bytes[i]);
        }
    }

    writeByteArray(value) {
        const arr = Array.isArray(value) ? value : [];
        this.writeInt(arr.length);
        for (const b of arr) {
            this.writeByte(b);
        }
    }

    writeString(value) {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(String(value));
        this.writeShort(bytes.length);
        for (let i = 0; i < bytes.length; i++) {
            this.buffer.push(bytes[i]);
        }
    }

    /**
     * 写入列表
     * 格式: 元素类型(1字节) + 长度(4字节) + 元素payload
     */
    writeList(value) {
        let listType, items;

        if (Array.isArray(value)) {
            // 直接数组: 推断元素类型
            items = value;
            listType = this.inferListType(items);
        } else if (value && typeof value === 'object') {
            if (Array.isArray(value.value)) {
                items = value.value;
                // 如果对象指定了元素类型，使用它
                listType = value.listType || this.inferListType(items);
            } else {
                items = [];
                listType = 10; // 默认Compound
            }
        } else {
            items = [];
            listType = 10;
        }

        this.writeByte(listType);
        this.writeInt(items.length);

        for (const item of items) {
            if (listType === 10 && item && typeof item === 'object' && 'type' in item && 'value' in item) {
                // 列表项是完整的标签对象 {type, value}，提取value作为compound内容
                this.writePayload(10, item.value);
            } else {
                this.writePayload(listType, item);
            }
        }
    }

    /**
     * 写入Compound
     * 格式: [标签]* + TAG_End(0x00)
     */
    writeCompound(value) {
        if (!value || typeof value !== 'object') {
            this.writeByte(0); // TAG_End
            return;
        }

        for (const [key, val] of Object.entries(value)) {
            if (val && typeof val === 'object' && 'type' in val && 'value' in val) {
                // 完整的标签对象 {type, value[, name]}
                this.writeTag(val.type, key, val.value);
            } else {
                // 自动推断类型
                const inferredType = this.inferType(val);
                this.writeTag(inferredType, key, val);
            }
        }

        this.writeByte(0); // TAG_End
    }

    writeIntArray(value) {
        const arr = Array.isArray(value) ? value : [];
        this.writeInt(arr.length);
        for (const v of arr) {
            this.writeInt(v);
        }
    }

    writeLongArray(value) {
        const arr = Array.isArray(value) ? value : [];
        this.writeInt(arr.length);
        for (const v of arr) {
            this.writeLong(v);
        }
    }

    /**
     * 推断列表元素类型
     */
    inferListType(items) {
        if (!items || items.length === 0) return 10; // 默认Compound
        const first = items[0];
        if (typeof first === 'object') {
            if ('type' in first) return first.type;
            return 10; // Compound
        }
        if (typeof first === 'string') return 8; // String
        if (typeof first === 'number') {
            if (Number.isInteger(first)) return 3; // Int
            return 6; // Double
        }
        return 10;
    }

    /**
     * 推断值的NBT类型
     */
    inferType(value) {
        if (value === null || value === undefined) return 10; // Compound
        if (typeof value === 'boolean') return 1; // Byte
        if (typeof value === 'number') {
            if (Number.isInteger(value)) {
                if (value >= -128 && value <= 127) return 1; // Byte
                if (value >= -32768 && value <= 32767) return 2; // Short
                if (value >= -2147483648 && value <= 2147483647) return 3; // Int
                return 4; // Long
            }
            return 6; // Double
        }
        if (typeof value === 'string') return 8; // String
        if (Array.isArray(value)) {
            // 检查是否是Int_Array或Long_Array
            if (value.length > 0 && typeof value[0] === 'number' && Number.isInteger(value[0])) {
                // 默认使用Int_Array表示整数数组（与Litematica兼容）
                return 11; // Int_Array
            }
            return 9; // List
        }
        if (typeof value === 'bigint') return 4; // Long
        if (value instanceof Uint8Array) return 7; // Byte_Array
        if (typeof value === 'object') return 10; // Compound
        return 3; // 默认Int
    }
}

module.exports = { NBTWriter };