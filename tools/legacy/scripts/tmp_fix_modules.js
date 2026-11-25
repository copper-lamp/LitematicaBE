const fs = require('fs');
// verify_deploy 期望 BP/RP modules[0].version = [0,0,1]（只改 header.version=addonVersion，modules 保持默认）
for (const f of ['resources/addon/LitematicaBE_BP/manifest.json', 'resources/addon/LitematicaBE_RP/manifest.json']) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    (j.modules || []).forEach((m) => { m.version = [0, 0, 1]; });
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
    console.log('  ✓', f, 'header=', JSON.stringify(j.header.version), 'modules=', JSON.stringify((j.modules || []).map((m) => m.version)));
}
