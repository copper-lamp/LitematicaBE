// 测试NBTWriter和LitematicLoader的兼容性
const { NBTWriter } = require('./src/core/NBTWriter');
const { LitematicLoader } = require('./src/core/LitematicLoader');
const zlib = require('zlib');
const fs = require('fs');

// 模拟全局logger
global.logger = {
    info: (...args) => console.log('[INFO]', ...args),
    warn: (...args) => console.log('[WARN]', ...args),
    error: (...args) => console.log('[ERROR]', ...args),
};

// 模拟File API
global.File = {
    readFrom: (path) => fs.readFileSync(path),
    writeTo: (path, data) => fs.writeFileSync(path, data),
    exists: (path) => fs.existsSync(path),
    mkdir: (path) => fs.mkdirSync(path, { recursive: true }),
};

// 创建简单的NBT数据（模拟Litematica格式）
const nbtData = {
    type: 10,
    name: '',
    value: {
        MinecraftDataVersion: { type: 3, value: 3953 },
        Version: { type: 3, value: 7 },
        SubVersion: { type: 3, value: 1 },
        Metadata: {
            type: 10,
            value: {
                Name: { type: 8, value: 'test' },
                Author: { type: 8, value: 'player' },
                Description: { type: 8, value: '' },
                RegionCount: { type: 3, value: 1 },
                TotalVolume: { type: 3, value: 1000 },
                TotalBlocks: { type: 3, value: 500 },
                TimeCreated: { type: 4, value: 1234567890 },
                TimeModified: { type: 4, value: 1234567890 },
                EnclosingSize: { type: 11, value: [10, 10, 10] }
            }
        },
        Regions: {
            type: 10,
            value: {
                test: {
                    type: 10,
                    value: {
                        Position: { type: 11, value: [0, 0, 0] },
                        Size: { type: 11, value: [10, 10, 10] },
                        BlockStatePalette: {
                            type: 9,
                            listType: 10,
                            value: [
                                { type: 10, value: { Name: { type: 8, value: 'minecraft:air' } } },
                                { type: 10, value: { Name: { type: 8, value: 'minecraft:stone' } } }
                            ]
                        },
                        BlockStates: { type: 12, value: [0, 1, 0] },
                        TileEntities: { type: 9, listType: 10, value: [] },
                        Entities: { type: 9, listType: 10, value: [] }
                    }
                }
            }
        }
    }
};

const writer = new NBTWriter();
const buffer = writer.write(nbtData);
console.log('NBT buffer length:', buffer.length);
console.log('First 32 bytes:', Array.from(buffer.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));

const compressed = zlib.gzipSync(Buffer.from(buffer));
console.log('Compressed length:', compressed.length);

// 保存到文件
fs.writeFileSync('./test_output.litematic', compressed);
console.log('File saved to ./test_output.litematic');

// 使用LitematicLoader加载
const loader = new LitematicLoader();
loader.load('./test_output.litematic').then(result => {
    console.log('\n=== LitematicLoader result ===');
    console.log('Success:', !!result);
    if (result) {
        console.log('Name:', result.name);
        console.log('Author:', result.author);
        console.log('Dimensions:', result.dimensions);
        console.log('Total blocks:', result.totalBlocks);
        console.log('Blocks count:', result.blocks?.length);
        if (result.blocks && result.blocks.length > 0) {
            console.log('First block:', JSON.stringify(result.blocks[0]));
        }
    }
}).catch(err => {
    console.error('Error:', err.message);
});
