// 临时校验：真实样本 .mcstructure 的「读 → 写 → 再读」一致性（work/ 已 gitignore）
const fs = require('fs');
const path = require('path');
const PLUGIN = path.resolve(__dirname, '..');
const { parseLittleEndianNbt, extractStructure } = require(path.join(PLUGIN, 'src/core/McstructureLoader.js'));
const { McstructureWriter } = require(path.join(PLUGIN, 'src/core/McstructureWriter.js'));

const sample = process.argv[2];
if (!sample) { console.error('用法: node work/roundtrip_sample.js <file.mcstructure>'); process.exit(2); }

function decode(root) {
    const { size, blockPalette, blockIndices } = extractStructure(root);
    const [sx, sy, sz] = size;
    const [i0] = blockIndices;
    const blocks = [];
    for (let i = 0; i < i0.length; i++) {
        const idx = i0[i];
        const entry = blockPalette[idx];
        if (!entry) continue;
        const n = String(entry.name || '').replace(/^minecraft:/, '');
        if (n === 'air' || n.endsWith('_air') || n === 'structure_void') continue;
        const x = Math.floor(i / (sz * sy));
        const y = Math.floor(i / sz) % sy;
        const z = i % sz;
        blocks.push({ pos: [x, y, z], name: entry.name, states: entry.states || {} });
    }
    const bpd = (root.structure.palette.default && root.structure.palette.default.block_position_data) || null;
    return { size: [sx, sy, sz], blocks, blockPalette, blockEntityCount: bpd ? Object.keys(bpd).length : 0 };
}

const t0 = Date.now();
const original = decode(parseLittleEndianNbt(fs.readFileSync(sample)));
console.log(`原文件: ${path.basename(sample)}`);
console.log(`  size = ${original.size.join('×')}  非空气方块 = ${original.blocks.length}  ` +
    `调色板 = ${original.blockPalette.length}  方块实体 = ${original.blockEntityCount}`);

// 用 writer 重建（states 直接取原文件的原始对象，等价于"世界扫描拿到的裸值"）
const rebuilt = McstructureWriter.build({
    size: { x: original.size[0], y: original.size[1], z: original.size[2] },
    blocks: original.blocks.map((b) => ({ pos: b.pos, name: b.name, states: b.states })),
    worldOrigin: { x: 0, y: 0, z: 0 }
});
const outPath = path.join(__dirname, 'roundtrip_out.mcstructure');
fs.writeFileSync(outPath, Buffer.from(rebuilt.buffer));

const roundTripped = decode(parseLittleEndianNbt(fs.readFileSync(outPath)));
console.log(`重建文件: ${path.basename(outPath)}  ${rebuilt.buffer.length} 字节（原 ${fs.statSync(sample).size} 字节）`);
console.log(`  size = ${roundTripped.size.join('×')}  非空气方块 = ${roundTripped.blocks.length}  ` +
    `调色板 = ${roundTripped.blockPalette.length}`);

const key = (b) => `${b.pos.join(',')}|${b.name}|${JSON.stringify(b.states)}`;
const A = new Set(original.blocks.map(key));
const B = new Set(roundTripped.blocks.map(key));
const onlyA = [...A].filter((k) => !B.has(k));
const onlyB = [...B].filter((k) => !A.has(k));

console.log(`\n一致性: 原 ${A.size} vs 重建 ${B.size}`);
console.log(`  仅原文件有: ${onlyA.length}`);
console.log(`  仅重建文件有: ${onlyB.length}`);
if (onlyA.length) console.log('  示例 onlyA:', onlyA.slice(0, 3));
if (onlyB.length) console.log('  示例 onlyB:', onlyB.slice(0, 3));
console.log(`  尺寸一致: ${JSON.stringify(original.size) === JSON.stringify(roundTripped.size)}`);
console.log(`耗时 ${Date.now() - t0} ms`);
process.exit(onlyA.length === 0 && onlyB.length === 0 ? 0 : 1);
