/**
 * GZIP/DEFLATE 解压实现
 * 基于Java的NbtIo.readCompressed逻辑
 */

// DEFLATE常量
const MAX_WBITS = 15;
const DEF_WBITS = MAX_WBITS;
const PRESET_DICT = 0x20;

// 压缩块类型
const BLOCK_TYPE_NONE = 0;
const BLOCK_TYPE_FIXED = 1;
const BLOCK_TYPE_DYNAMIC = 2;
const BLOCK_TYPE_STORED = 3;

// Huffman树节点
class HuffmanNode {
    constructor() {
        this.symbol = 0;
        this.count = 0;
        this.left = null;
        this.right = null;
    }
}

const Zlib = {
    /**
     * 解压GZIP数据
     */
    unzip: function(data) {
        if (!data || data.length < 2) {
            return null;
        }
        
        // 检查GZIP魔术字
        if (data[0] !== 0x1f || data[1] !== 0x8b) {
            logger.warn("Not a GZIP file");
            return null;
        }
        
        try {
            // 跳过GZIP头
            let pos = 10;
            const flags = data[3];
            
            // 跳过可选头字段
            if (flags & 0x04) { // FEXTRA
                const xlen = data[pos] | (data[pos + 1] << 8);
                pos += 2 + xlen;
            }
            if (flags & 0x08) { // FNAME
                while (data[pos++] !== 0) {}
            }
            if (flags & 0x10) { // FCOMMENT
                while (data[pos++] !== 0) {}
            }
            if (flags & 0x02) { // FHCRC
                pos += 2;
            }
            
            // 获取压缩数据
            const compressedSize = data.length - 8 - pos;
            const compressed = data.slice(pos, pos + compressedSize);
            
            // 使用 inflate 解压
            return this.inflate(compressed);
        } catch (e) {
            logger.error(`GZIP unzip error: ${e.message}`);
            return null;
        }
    },
    
    /**
     * 解压DEFLATE数据 (简化版)
     */
    inflate: function(data) {
        try {
            // 创建结果数组
            const result = [];
            
            // 解析DEFLATE数据
            let pos = 0;
            let isFinalBlock = false;
            
            while (!isFinalBlock && pos < data.length) {
                // 读取块头
                const header = data[pos++];
                isFinalBlock = (header & 0x01) !== 0;
                const blockType = (header >> 1) & 0x03;
                
                switch (blockType) {
                    case BLOCK_TYPE_STORED:
                        // 存储块 - 直接复制
                        pos = this.readStoredBlock(data, pos, result);
                        break;
                    case BLOCK_TYPE_FIXED:
                        // 固定Huffman编码
                        pos = this.readFixedBlock(data, pos, result);
                        break;
                    case BLOCK_TYPE_DYNAMIC:
                        // 动态Huffman编码 - 简化处理
                        pos = this.readDynamicBlock(data, pos, result);
                        break;
                    default:
                        logger.warn(`Unknown block type: ${blockType}`);
                        return null;
                }
            }
            
            return new Uint8Array(result);
        } catch (e) {
            logger.error(`Inflate error: ${e.message}`);
            return null;
        }
    },
    
    /**
     * 读取存储块
     */
    readStoredBlock: function(data, pos, result) {
        // 跳过LEN的低2位（因为它们是块类型）
        // 对齐到字节边界
        if ((pos % 8) !== 0) {
            pos += (8 - (pos % 8));
        }
        
        // 读取长度
        const len = data[pos] | (data[pos + 1] << 8);
        pos += 2;
        
        // 读取补码长度
        const nlen = data[pos] | (data[pos + 1] << 8);
        pos += 2;
        
        // 复制数据
        for (let i = 0; i < len; i++) {
            result.push(data[pos + i]);
        }
        
        return pos + len;
    },
    
    /**
     * 读取固定Huffman编码块
     */
    readFixedBlock: function(data, pos, result) {
        // 固定Huffman表
        // Littlenub和Dist_codes来自zlib规范
        const litCodes = this.createFixedLiteralLengthCodes();
        const distCodes = this.createFixedDistanceCodes();
        
        return this.decodeHuffman(data, pos, result, litCodes, distCodes);
    },
    
    /**
     * 读取动态Huffman编码块
     */
    readDynamicBlock: function(data, pos, result) {
        // 读取编码长度
        const hlit = data[pos] + 257;
        pos++;
        const hdist = data[pos] + 1;
        pos++;
        const hclen = data[pos] + 4;
        pos++;
        
        // 读取代码长度顺序
        const codeLengths = [];
        for (let i = 0; i < 19; i++) {
            codeLengths.push(0);
        }
        
        const codeLengthOrder = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
        for (let i = 0; i < hclen; i++) {
            codeLengths[codeLengthOrder[i]] = data[pos + i];
        }
        pos += hclen;
        
        // 构建Huffman树
        const litCodeTree = this.createHuffmanTree(codeLengths.slice(0, hlit + 258));
        const distCodeTree = this.createHuffmanTree(codeLengths.slice(hlit + 258, hlit + 258 + hdist));
        
        return this.decodeHuffman(data, pos, result, litCodeTree, distCodeTree);
    },
    
    /**
     * 使用Huffman树解码
     */
    decodeHuffman: function(data, pos, result, litTree, distTree) {
        let current = litTree;
        let bitBuffer = 0;
        let bitsInBuffer = 0;
        
        while (true) {
            // 读取一位
            while (bitsInBuffer < 16) {
                if (pos >= data.length) break;
                bitBuffer |= data[pos++] << bitsInBuffer;
                bitsInBuffer += 8;
            }
            
            // 遍历Huffman树
            let node = current;
            while (node.left || node.right) {
                if (bitsInBuffer <= 0) break;
                const bit = bitBuffer & 1;
                bitBuffer >>= 1;
                bitsInBuffer--;
                node = bit ? node.right : node.left;
            }
            
            if (!node) break;
            
            const symbol = node.symbol;
            
            if (symbol < 256) {
                // 字面字节
                result.push(symbol);
            } else if (symbol === 256) {
                // 块结束
                break;
            } else {
                // 解码长度和距离
                const lenSym = symbol - 257;
                let length = this.getLength(lenSym);
                
                // 读取距离码
                let dist = 0;
                let distNode = distTree;
                while (distNode.left || distNode.right) {
                    if (bitsInBuffer <= 0) break;
                    const bit = bitBuffer & 1;
                    bitBuffer >>= 1;
                    bitsInBuffer--;
                    distNode = bit ? distNode.right : distNode.left;
                }
                
                const distSymbol = distNode ? distNode.symbol : 0;
                const distCode = this.getDistance(distSymbol);
                
                // 读取额外的距离位
                let extraDistBits = 0;
                let distBase = distCode;
                if (distCode > 4) {
                    extraDistBits = Math.floor(Math.log2(distCode - 2)) + 1;
                }
                
                for (let i = 0; i < extraDistBits; i++) {
                    if (bitsInBuffer <= 0) break;
                    distBase |= (bitBuffer & 1) << i;
                    bitBuffer >>= 1;
                    bitsInBuffer--;
                }
                
                dist = distBase + 1;
                
                // 复制数据 (使用已解压的数据)
                const startPos = result.length - dist;
                for (let i = 0; i < length; i++) {
                    result.push(result[startPos + i]);
                }
            }
        }
        
        return pos;
    },
    
    /**
     * 创建固定文字长度码
     */
    createFixedLiteralLengthCodes: function() {
        // 简化实现：返回null表示使用内置表
        return null;
    },
    
    /**
     * 创建固定距离码
     */
    createFixedDistanceCodes: function() {
        return null;
    },
    
    /**
     * 从符号获取长度
     */
    getLength: function(symbol) {
        // 简化：返回近似长度
        if (symbol < 8) return symbol + 3;
        if (symbol < 16) return symbol + 3;
        if (symbol < 24) return symbol - 8 + 11;
        if (symbol < 32) return symbol - 16 + 19;
        return 11;
    },
    
    /**
     * 从符号获取距离
     */
    getDistance: function(symbol) {
        if (symbol < 1) return 1;
        if (symbol < 2) return 2;
        if (symbol < 3) return 3;
        if (symbol < 4) return 4;
        return Math.pow(2, symbol - 2);
    },
    
    /**
     * 从代码长度数组创建Huffman树
     */
    createHuffmanTree: function(codeLengths) {
        const nodes = [];
        for (let i = 0; i < codeLengths.length; i++) {
            if (codeLengths[i] > 0) {
                const node = new HuffmanNode();
                node.symbol = i;
                node.count = codeLengths[i];
                nodes.push(node);
            }
        }
        
        // 简化：返回一个虚拟根节点
        const root = new HuffmanNode();
        if (nodes.length > 0) {
            root.left = nodes[0];
            if (nodes.length > 1) {
                root.right = nodes[1];
            }
        }
        return root;
    }
};

// 尝试加载zlib模块
let zlib = null;
try {
    zlib = require('zlib');
    logger.info("zlib module available");
} catch (e) {
    logger.warn("zlib module not available, using custom implementation");
}

// 导出解压函数
function gunzip(data) {
    // 首先尝试使用zlib
    if (zlib) {
        try {
            return zlib.inflateRawSync(data);
        } catch (e) {
            logger.warn(`zlib.inflateRawSync failed: ${e.message}`);
        }
        
        try {
            return zlib.gunzipSync(data);
        } catch (e) {
            logger.warn(`zlib.gunzipSync failed: ${e.message}`);
        }
        
        try {
            return zlib.inflateSync(data);
        } catch (e) {
            logger.warn(`zlib.inflateSync failed: ${e.message}`);
        }
    }
    
    // 使用自定义实现
    return Zlib.unzip(data);
}

function inflate(data) {
    if (zlib) {
        try {
            return zlib.inflateRawSync(data);
        } catch (e) {
            logger.warn(`zlib.inflateRawSync failed: ${e.message}`);
        }
    }
    
    return Zlib.inflate(data);
}

module.exports = { gunzip, inflate, Zlib };
