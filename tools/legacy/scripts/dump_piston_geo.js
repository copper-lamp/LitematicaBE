/** 打印 6 个朝向的几何摘要，用面法线核对面朝向是否正确 */
const fs = require('fs');
const path = require('path');
const RP = path.join(__dirname, '..', 'resources', 'addon', 'LitematicaBE_RP', 'models', 'blocks');
const F = { 0: 'down', 1: 'up', 2: 'north', 3: 'south', 4: 'west', 5: 'east' };
const load = (n) => JSON.parse(fs.readFileSync(path.join(RP, `${n}.json`), 'utf8'))['minecraft:geometry'][0];

for (const kind of ['lit_piston', 'lit_piston_extended', 'lit_piston_head']) {
    console.log(`\n########## ${kind} ##########`);
    for (let f = 0; f <= 5; f++) {
        const g = load(`${kind}_f${f}`);
        const parts = g.bones[0].cubes.map((c) => {
            const faces = Object.entries(c.uv).map(([face, d]) => {
                const mat = d.material_instance;
                const us = d.uv_size;
                const flip = (us[0] < 0 ? 'H' : '') + (us[1] < 0 ? 'V' : '');
                return `${face}:${mat}${flip ? `[${flip}]` : ''}`;
            });
            return `    o${JSON.stringify(c.origin)} s${JSON.stringify(c.size)}  ${faces.join(' ')}`;
        });
        console.log(`  f${f} ${F[f]}`);
        parts.forEach((p) => console.log(p));
    }
}
