const fs = require('fs');
const d = 'C:/Users/25491/Desktop/建模对应清单';
const bm = JSON.parse(fs.readFileSync(d + '/block_models.json', 'utf8'));
for (const b of ['lantern', 'chain', 'stairs', 'redstone_wire', 'hopper', 'composter', 'unpowered_repeater']) {
    const e = bm[b];
    console.log(`===== block_models.${b} =====`);
    if (!e) { console.log('  (无条目)'); continue; }
    console.log('  shape=', e.shape, 'cubeCount=', e.cubeCount, 'cond=', e.conditionedCubeCount, 'fallback=', e.fallback);
    const cs = e.cubes || [];
    console.log('  cubes 数量=', cs.length);
    cs.slice(0, 4).forEach((c, i) => console.log('   [' + i + '] pos', JSON.stringify(c.pos), 'size', JSON.stringify(c.size),
        'if', JSON.stringify(c.if || null), 'translate', JSON.stringify(c.translate || null),
        'uv?', c.uv ? 'yes' : 'no', 'tt?', c.terrainTexture ? 'yes' : 'no', 'tex?', c.textures ? 'yes' : 'no'));
}
