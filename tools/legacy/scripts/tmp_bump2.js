// bump addon header 到 1.1.16（modules 保持 [0,0,1]）
const fs = require('fs');
const V = [1, 1, 16];
const MOD = [0, 0, 1];
const files = [
    ['resources/data/ghost_index.json', (j) => { j.addonVersion = V; }],
    ['resources/data/addon_expected.json', (j) => { j.addonVersion = V; }],
    ['resources/addon/LitematicaBE_BP/manifest.json', (j) => { j.header.version = V; (j.modules || []).forEach((m) => { m.version = MOD; }); }],
    ['resources/addon/LitematicaBE_RP/manifest.json', (j) => { j.header.version = V; (j.modules || []).forEach((m) => { m.version = MOD; }); }],
];
for (const [f, fn] of files) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    fn(j);
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
    console.log('  ✓', f);
}
for (const f of ['resources/data/ghost_index.json', 'resources/data/addon_expected.json']) {
    console.log('   verify', f, JSON.stringify(JSON.parse(fs.readFileSync(f, 'utf8')).addonVersion));
}
