/**
 * 把活塞侧面贴图从旧的 side_length / side_cross（已删除）改接到
 * 平面四向的 side_up / side_down / side_left / side_right。
 *
 * 语义（照 addon-model-texture-guide 1.6 的 u/v 实测表推出来）：
 *   side_up    木条在贴图顶部  → 侧面木条朝 +y
 *   side_down  木条在贴图底部  → 朝 -y
 *   side_left  木条在贴图左侧  → 朝该面 u 减小方向
 *   side_right 木条在贴图右侧  → 朝该面 u 增大方向
 *
 * 各面 u 增大方向：north=西(-x) south=东(+x) east=北(-z) west=南(+z) up/down=西(-x)
 * up/down 面 v 增大方向 = 北(-z)
 *
 * 收缩态：木条必须指向 facing（推面）。→ 见 SIDE_MAP。
 * 伸出态：本体侧面是纯灰的 spec 贴图（无木条），与朝向无关，尺寸正好对上
 *         16×12 / 12×16，直接换名。
 */
const fs = require('fs');
const path = require('path');

const RP = 'resources/addon/LitematicaBE_RP';
const BP = 'resources/addon/LitematicaBE_BP';
const readJ = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJ = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n');

/** 收缩态每个 geometry 的侧面 → 新材质键（只列需要改的面；north/south 的推面/背面不在表内） */
const SIDE_MAP = {
    f0: { north: 'side_down', south: 'side_down', east: 'side_down', west: 'side_down' },
    f1: { north: 'side_up', south: 'side_up', east: 'side_up', west: 'side_up' },
    f2: { east: 'side_right', west: 'side_left', up: 'side_down', down: 'side_down' },
    f3: { east: 'side_left', west: 'side_right', up: 'side_up', down: 'side_up' },
    f4: { north: 'side_right', south: 'side_left', up: 'side_right', down: 'side_right' },
    f5: { north: 'side_left', south: 'side_right', up: 'side_left', down: 'side_left' },
};

const NEW_KEYS = {
    side_up: 'ghost_piston_side_up',
    side_down: 'ghost_piston_side_down',
    side_left: 'ghost_piston_side_left',
    side_right: 'ghost_piston_side_right',
};

let changed = 0;

// ── 1. terrain_texture：删旧键，补四向注册 ──────────────────────────────
{
    const p = path.join(RP, 'textures', 'terrain_texture.json');
    const j = readJ(p);
    const td = j.texture_data;
    for (const dead of ['ghost_piston_side_length', 'ghost_piston_side_cross']) {
        if (td[dead]) { delete td[dead]; changed++; }
    }
    for (const [k, tex] of Object.entries(NEW_KEYS)) {
        td[tex] = { textures: `textures/blocks/ghost/${tex}` };
        changed++;
        void k;
    }
    writeJ(p, j);
    console.log('[terrain] 旧键已删，四向已注册');
}

// ── 2. 收缩态 geometry：按 SIDE_MAP 换材质键 + UV 全正立 ─────────────────
for (let f = 0; f <= 5; f++) {
    const name = `lit_piston_f${f}`;
    const p = path.join(RP, 'models', 'blocks', `${name}.json`);
    const j = readJ(p);
    const cube = j['minecraft:geometry'][0].bones[0].cubes[0];
    const map = SIDE_MAP[`f${f}`];
    for (const [face, mat] of Object.entries(map)) {
        const d = cube.uv[face];
        if (!d) throw new Error(`${name} 缺少面 ${face}`);
        d.material_instance = mat;
        d.uv = [0, 0];
        d.uv_size = [16, 16];
        changed++;
    }
    writeJ(p, j);
    console.log(`[geo] ${name}.json  ${Object.entries(map).map(([k, v]) => `${k}=${v}`).join(' ')}`);
}

// ── 3. 伸出态 geometry：spec 贴图改名（尺寸 16×12 / 12×16 正好对应）────────
for (let f = 0; f <= 5; f++) {
    const name = `lit_piston_extended_f${f}`;
    const p = path.join(RP, 'models', 'blocks', `${name}.json`);
    const j = readJ(p);
    let n = 0;
    for (const cube of j['minecraft:geometry'][0].bones[0].cubes) {
        for (const d of Object.values(cube.uv || {})) {
            if (d.material_instance === 'side_length') { d.material_instance = 'side_spec_length'; n++; }
            else if (d.material_instance === 'side_cross') { d.material_instance = 'side_spec_cross'; n++; }
        }
    }
    writeJ(p, j);
    changed += n;
    console.log(`[geo] ${name}.json  side_* → side_spec_*  (${n} 面)`);
}

// ── 4. BP：收缩态声明四向，伸出态声明 spec ───────────────────────────────
const miEntry = (tex) => ({ texture: tex, render_method: 'blend', face_dimming: false, ambient_occlusion: false });

for (let f = 0; f <= 5; f++) {
    for (const prefix of ['g_piston_side', 'g_sticky_piston']) {
        const p = path.join(BP, 'blocks', `${prefix}_f${f}.json`);
        const j = readJ(p);
        const mi = j['minecraft:block'].components['minecraft:material_instances'];
        delete mi.side_length;
        delete mi.side_cross;
        for (const [k, tex] of Object.entries(NEW_KEYS)) mi[k] = miEntry(tex);
        writeJ(p, j);
        changed++;
    }
    for (const prefix of ['g_piston_side_extended', 'g_sticky_piston_extended']) {
        const p = path.join(BP, 'blocks', `${prefix}_f${f}.json`);
        const j = readJ(p);
        const mi = j['minecraft:block'].components['minecraft:material_instances'];
        delete mi.side_length;
        delete mi.side_cross;
        mi.side_spec_length = miEntry('ghost_piston_side_spec_length');
        mi.side_spec_cross = miEntry('ghost_piston_side_spec_cross');
        writeJ(p, j);
        changed++;
    }
}
console.log('[bp] 12 个收缩态 + 12 个伸出态材质表已更新');
console.log(`完成，共改 ${changed} 处`);
