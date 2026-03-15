// Palette Decoder - 解码Litematic的调色板压缩数据
// 实现位打包(bit-packing)解码算法

class PaletteDecoder {
    constructor(bitsPerEntry) {
        this.bitsPerEntry = bitsPerEntry;
        this.mask = (1n << BigInt(bitsPerEntry)) - 1n;
    }

    /**
     * 解码调色板索引数组
     * @param {BigInt[]} longArray - LongArray类型的数据
     * @param {number} totalBlocks - 总方块数
     * @returns {number[]} - 调色板索引数组
     */
    decode(longArray, totalBlocks) {
        const indices = [];

        for (let i = 0; i < totalBlocks; i++) {
            const bitIndex = BigInt(i * this.bitsPerEntry);
            const longIndex = Number(bitIndex / 64n);
            const bitOffset = Number(bitIndex % 64n);

            let value;
            
            if (bitOffset + this.bitsPerEntry <= 64) {
                // 不跨long边界
                value = (longArray[longIndex] >> BigInt(bitOffset)) & this.mask;
            } else {
                // 跨long边界处理
                const bitsInFirst = 64 - bitOffset;
                const bitsInSecond = this.bitsPerEntry - bitsInFirst;

                const firstMask = (1n << BigInt(bitsInFirst)) - 1n;
                const firstPart = (longArray[longIndex] >> BigInt(bitOffset)) & firstMask;

                const secondMask = (1n << BigInt(bitsInSecond)) - 1n;
                const secondPart = longArray[longIndex + 1] & secondMask;

                value = firstPart | (secondPart << BigInt(bitsInFirst));
            }

            indices.push(Number(value));
        }

        return indices;
    }

    /**
     * 计算所需的bits per entry
     * @param {number} paletteSize - 调色板大小
     * @returns {number} - 所需的位数
     */
    static calculateBitsPerEntry(paletteSize) {
        if (paletteSize <= 1) return 1;
        return Math.ceil(Math.log2(paletteSize));
    }
}

module.exports = { PaletteDecoder };
