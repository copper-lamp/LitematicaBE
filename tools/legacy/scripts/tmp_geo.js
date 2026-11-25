// 临时核验：原版 repeater 几何 vs 生成
const fs = require('fs');
const d = 'C:/Users/25491/Desktop/建模对应清单';
const sm = JSON.parse(fs.readFileSync(d + '/shape_models.json', 'utf8'));
console.log('===== 原版 shape_models.repeater 全部 cube =====');
sm.repeater.forEach((c, i) => console.log('[' + i + '] pos', JSON.stringify(c.pos), 'size', JSON.stringify(c.size), c.if ? (' if=' + c.if) : ''));
console.log('');
console.log('===== 我生成的 lit_repeater.json cube =====');
const g = JSON.parse(fs.readFileSync('resources/addon/LitematicaBE_RP/models/blocks/lit_repeater.json', 'utf8'));
g['minecraft:geometry'][0].bones[0].cubes.forEach((c, i) => {
    const mat = (c.uv && c.uv.up && c.uv.up.material_instance) || '*';
    console.log('[' + i + '] origin', JSON.stringify(c.origin), 'size', JSON.stringify(c.size), 'mat=' + mat);
});
