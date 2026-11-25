// bump addon 版本到 1.1.15（ghost_index / addon_expected / BP manifest / RP manifest）
const fs = require('fs');
const V = [1, 1, 15];
const files = [
    ['resources/data/ghost_index.json', (j) => { j.addonVersion = V; }],
    ['resources/data/addon_expected.json', (j) => { j.addonVersion = V; }],
    ['resources/addon/LitematicaBE_BP/manifest.json', (j) => { j.header.version = V; (j.modules || []).forEach((m) => { m.version = V; }); }],
    ['resources/addon/LitematicaBE_RP/manifest.json', (j) => { j.header.version = V; (j.modules || []).forEach((m) => { m.version = V; }); }],
];
for (const [f, fn] of files) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    fn(j);
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
    console.log('  ✓', f);
}
// 校验
for (const f of files.slice(0, 2)) {
    const j = JSON.parse(fs.readFileSync(f[0], 'utf8'));
    console.log('   verify', f[0], 'addonVersion =', JSON.stringify(j.addonVersion));
}
