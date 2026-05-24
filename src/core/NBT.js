// NBT Parser - 解析Litematic文件的NBT数据
// 支持大端序读取和12种NBT标签类型

const NBT_TAGS = {
    END: 0,
    BYTE: 1,
    SHORT: 2,
    INT: 3,
    LONG: 4,
    FLOAT: 5,
    DOUBLE: 6,
    BYTE_ARRAY: 7,
    STRING: 8,
    LIST: 9,
    COMPOUND: 10,
    INT_ARRAY: 11,
    LONG_ARRAY: 12
};

class NBTParser {
    constructor(buffer) {
        this.buffer = buffer;
        this.offset = 0;
        
        // 确保是DataView
        if (buffer instanceof DataView) {
            this.dataView = buffer;
        } else if (buffer instanceof ArrayBuffer) {
            this.dataView = new DataView(buffer);
        } else if (buffer.buffer instanceof ArrayBuffer) {
            this.dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        } else {
            this.dataView = new DataView(new ArrayBuffer(0));
        }
    }

    static parse(buffer) {
        const parser = new NBTParser(buffer);
        return parser.parseRoot();
    }

    parseRoot() {
        const result = {};
        try {
            while (this.offset < this.dataView.byteLength) {
                const tag = this.readTag();
                if (tag === null) break;
                if (tag.name) {
                    result[tag.name] = tag.value;
                }
            }
        } catch (e) {
            logger.warn(`NBT parseRoot error: ${e.message}`);
        }
        return result;
    }

    readTag() {
        if (this.offset >= this.dataView.byteLength) return null;
        
        const type = this.readByte();
        if (type === NBT_TAGS.END) return null;

        const name = this.readString();
        const value = this.readPayload(type);

        return { name, type, value };
    }

    readByte() {
        return this.dataView.getInt8(this.offset++);
    }

    readShort() {
        const val = this.dataView.getInt16(this.offset);
        this.offset += 2;
        return val;
    }

    readInt() {
        const val = this.dataView.getInt32(this.offset);
        this.offset += 4;
        return val;
    }

    readLong() {
        const high = BigInt(this.dataView.getInt32(this.offset));
        const low = BigInt(this.dataView.getUint32(this.offset + 4));
        this.offset += 8;
        return (high << 32n) | low;
    }

    readFloat() {
        const val = this.dataView.getFloat32(this.offset);
        this.offset += 4;
        return val;
    }

    readDouble() {
        const val = this.dataView.getFloat64(this.offset);
        this.offset += 8;
        return val;
    }

    readString() {
        if (this.offset + 2 > this.dataView.byteLength) return '';
        const length = this.dataView.getUint16(this.offset);
        this.offset += 2;
        if (length < 0) return '';
        if (length === 0) return '';
        
        if (this.offset + length > this.dataView.byteLength) {
            return '';
        }
        
        let str = '';
        try {
            const bytes = new Uint8Array(this.dataView.buffer, this.dataView.byteOffset + this.offset, length);
            str = new TextDecoder('utf-8').decode(bytes);
        } catch (e) {
            str = '';
        }
        this.offset += length;
        return str;
    }

    readByteArray() {
        const length = this.readInt();
        const arr = new Uint8Array(length);
        for (let i = 0; i < length; i++) {
            arr[i] = this.readByte();
        }
        return arr;
    }

    readIntArray() {
        const length = this.readInt();
        const arr = [];
        for (let i = 0; i < length; i++) {
            arr.push(this.readInt());
        }
        return arr;
    }

    readLongArray() {
        const length = this.readInt();
        const arr = [];
        for (let i = 0; i < length; i++) {
            arr.push(this.readLong());
        }
        return arr;
    }

    readList() {
        const listType = this.readByte();
        const length = this.readInt();
        
        const list = [];
        for (let i = 0; i < length; i++) {
            list.push(this.readPayloadByType(listType));
        }
        return list;
    }

    readCompound() {
        const obj = {};
        while (this.offset < this.dataView.byteLength) {
            const tag = this.readTag();
            if (tag === null) break;
            if (tag.name) {
                obj[tag.name] = tag.value;
            }
        }
        return obj;
    }

    readPayload(type) {
        switch (type) {
            case NBT_TAGS.BYTE:
                return this.readByte();
            case NBT_TAGS.SHORT:
                return this.readShort();
            case NBT_TAGS.INT:
                return this.readInt();
            case NBT_TAGS.LONG:
                return this.readLong();
            case NBT_TAGS.FLOAT:
                return this.readFloat();
            case NBT_TAGS.DOUBLE:
                return this.readDouble();
            case NBT_TAGS.BYTE_ARRAY:
                return this.readByteArray();
            case NBT_TAGS.STRING:
                return this.readString();
            case NBT_TAGS.LIST:
                return this.readList();
            case NBT_TAGS.COMPOUND:
                return this.readCompound();
            case NBT_TAGS.INT_ARRAY:
                return this.readIntArray();
            case NBT_TAGS.LONG_ARRAY:
                return this.readLongArray();
            default:
                throw new Error(`Unknown NBT tag type: ${type}`);
        }
    }

    readPayloadByType(type) {
        return this.readPayload(type);
    }
}

module.exports = { NBTParser, NBT_TAGS };
