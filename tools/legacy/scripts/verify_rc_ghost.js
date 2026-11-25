const fs = require('fs');
const path = require('path');

const ROOT = 'D:/GitHub/LitematicaBE';
const RP = path.join(ROOT, 'resources/addon/LitematicaBE_RP');
const BP = path.join(ROOT, 'resources/addon/LitematicaBE_BP');

let bad = 0;
function check(name, ok, extra = '') {
    if (!ok) bad++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
}

const models = fs.readdirSync(path.join(RP, 'models/blocks')).filter((f) => /^(lit_repeater|lit_comparator)/.test(f));
check('模型文件数 = 12', models.length === 12, models.length);

const geos = new Map();
for (const f of models) {
    const j = JSON.parse(fs.readFileSync(path.join(RP, 'models/blocks', f), 'utf8'));
    const g = j['minecraft:geometry'][0];
    geos.set(g.description.identifier, f);
    const cubes = g.bones[0].cubes;
    let facesOk = true;
    for (const c of cubes) {
        for (const [face, def] of Object.entries(c.uv)) {
            if (!Array.isArray(def.uv) || def.uv.length !== 2) facesOk = false;
            if (def.uv[0] < 0 || def.uv[1] < 0) facesOk = false;
            if (def.uv[0] + def.uv_size[0] > 16 || def.uv[1] + def.uv_size[1] > 16) facesOk = false;
            if (!def.material_instance) facesOk = false;
        }
    }
    check(`${f} UV 均在贴图内且有材质`, facesOk, `${cubes.length} cubes`);
}

// BP 引用的 geometry 全部存在
const expected = {
    'g_repeater.json': 'lit:g_repeater',
    'g_powered_repeater.json': 'lit:g_powered_repeater',
    'g_unpowered_repeater.json': 'lit:g_unpowered_repeater',
    'g_comparator.json': 'lit:g_comparator',
    'g_powered_comparator.json': 'lit:g_powered_comparator',
    'g_unpowered_comparator.json': 'lit:g_unpowered_comparator',
};
for (const [f, id] of Object.entries(expected)) {
    const j = JSON.parse(fs.readFileSync(path.join(BP, 'blocks', f), 'utf8'));
    const b = j['minecraft:block'];
    check(`${f} identifier=${id}`, b.description.identifier === id);
    const refs = new Set();
    if (b.components['minecraft:geometry']) refs.add(b.components['minecraft:geometry']);
    for (const p of b.permutations || []) if (p.components['minecraft:geometry']) refs.add(p.components['minecraft:geometry']);
    const missing = [...refs].filter((r) => !geos.has(r));
    check(`${f} 引用几何全部存在`, missing.length === 0, [...refs].join(','));
    // 材质贴图均已注册
    const tt = JSON.parse(fs.readFileSync(path.join(RP, 'textures/terrain_texture.json'), 'utf8'));
    const texMissing = new Set();
    const collect = (mi) => { for (const v of Object.values(mi)) if (!tt.texture_data[v.texture]) texMissing.add(v.texture); };
    if (b.components['minecraft:material_instances']) collect(b.components['minecraft:material_instances']);
    for (const p of b.permutations || []) if (p.components['minecraft:material_instances']) collect(p.components['minecraft:material_instances']);
    check(`${f} 材质贴图均已注册`, texMissing.size === 0, [...texMissing].join(','));
}

// 贴图 = 原版逐字节
const crypto = require('crypto');
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
const SRC = 'C:/Users/25491/Desktop/建模贴图/resource/bedrock-samples-v1.26.60.5-full/resource_pack/textures/blocks';
const texPairs = [
    ['repeater_off.png', 'ghost/ghost_repeater_off.png'],
    ['repeater_on.png', 'ghost/ghost_repeater_on.png'],
    ['comparator_off.png', 'ghost/ghost_comparator_off.png'],
    ['comparator_on.png', 'ghost/ghost_comparator_on.png'],
    ['redstone_torch_off.png', 'ghost/ghost_rtorch_off.png'],
    ['redstone_torch_on.png', 'ghost/ghost_rtorch_on.png'],
    ['stone_slab_top.png', 'ghost/ghost_comp_slab.png'],
];
for (const [a, b] of texPairs) {
    check(`贴图 ${b} 与原版一致`, md5(path.join(SRC, a)) === md5(path.join(RP, 'textures/blocks', b)));
}

// 版本三方一致
const ae = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources/data/addon_expected.json'), 'utf8'));
const gi = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources/data/ghost_index.json'), 'utf8'));
const bpm = JSON.parse(fs.readFileSync(path.join(BP, 'manifest.json'), 'utf8'));
const rpm = JSON.parse(fs.readFileSync(path.join(RP, 'manifest.json'), 'utf8'));
const v = (x) => x.join('.');
const verOk = v(ae.addonVersion) === v(gi.addonVersion) && v(ae.addonVersion) === v(bpm.header.version) && v(ae.addonVersion) === v(rpm.header.version)
    && v(bpm.modules[0].version) === v(ae.addonVersion) && v(rpm.modules[0].version) === v(ae.addonVersion);
check('addon 版本三方一致', verOk, v(ae.addonVersion));
check('uuid 一致', ae.bpUuid === bpm.header.uuid && ae.rpUuid === rpm.header.uuid);

console.log(`\n结果: ${bad === 0 ? '全部通过' : bad + ' 项失败'}`);
process.exit(bad ? 1 : 0);
