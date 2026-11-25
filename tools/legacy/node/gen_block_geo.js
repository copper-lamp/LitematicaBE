#!/usr/bin/env node
/**
 * gen_block_geo.js — 从「建模对应清单」现成原版几何数据生成 ghost 方块几何
 *
 * 输入：C:\Users\25491\Desktop\建模对应清单\（block_shape_map.json / shape_models.json / block_models.json）
 * 用法：node tools/gen_block_geo.js oak_stairs,chain,lantern,unpowered_repeater,unpowered_comparator
 *
 * 对每个方块：
 *   1. block_shape_map[block] 取形状名 → shape_models[shape].cubes
 *   2. 过滤 cubes：只留默认 state 分支（if 里 `== 0` 的，丢弃 `== 1` / `!=` / 字符串）
 *   3. 生成 RP/models/blocks/<shape>.json（geometry.lit_<shape>，独立贴图全图 UV）
 *   4. 生成 BP/blocks/g_<block>.json（引用几何 + lit:dir state + 4 向 permutations 旋转）
 *   5. 更新 resources/data/ghost_index.json（blocks[id].geometry/states + javaMap 重定向）
 *
 * 说明：
 *   - 朝向基准来自原版提取模板（如 stairs 低端朝西），lit:dir 旋转由 permutations 表达，
 *     ROT_OFFSET 是全局校准值；实机确认后修改。
 *   - 贴图：优先用 ghost/<block>.png（或主贴图），缺失回退 ghost_generic（形状仍可辨）。
 */
const fs = require('fs');
const path = require('path');

const MODEL_DIR = 'C:/Users/25491/Desktop/建模对应清单';
const RP_BLOCKS = 'resources/addon/LitematicaBE_RP/models/blocks';
const BP_BLOCKS = 'resources/addon/LitematicaBE_BP/blocks';
const IDX = 'resources/data/ghost_index.json';
const TEX_DIR = 'resources/addon/LitematicaBE_RP/textures/blocks/ghost';

// 每方块：几何形状的默认朝向偏移（度，绕 Y）。0 = 模板默认。实机校准改这里。
const ROT_OFFSET = { stairs: 90, chain: 0, lantern: 0, repeater: 0, comparator: 0 };

// 有 dir 状态（4 向旋转）的方块，及其 BE 状态来源键
const DIR_STATE = {
    oak_stairs: 'weirdo_direction',
    unpowered_repeater: 'direction',
    powered_repeater: 'direction',
    unpowered_comparator: 'direction',
    powered_comparator: 'direction',
};

// 贴图映射：block -> 贴图短名（缺 png 回退 ghost_generic）
const TEX_MAP = {
    oak_stairs: 'oak_planks',
    chain: 'iron_chain',
    lantern: 'lantern',
    soul_lantern: 'soul_lantern',
    unpowered_repeater: 'repeater',
    powered_repeater: 'repeater',
    unpowered_comparator: 'comparator',
    powered_comparator: 'comparator',
    redstone_wire: 'redstone_dust_dot',
    hopper: 'hopper_inside',
    composter: 'generic',
};

// 原版几何用 terrainTexture（repeater_torch / comparator_torch）→ 需独立 torch 材质
const TORCH_BLOCKS = new Set(['unpowered_repeater', 'powered_repeater', 'unpowered_comparator', 'powered_comparator']);

// 面名材质（material_instances 键 = 面名，priority 2 自动关联对应面；漏斗内/外/顶贴图）
const FACE_MATS = {
    hopper: {
        down: 'ghost_hopper_inside',
        up: 'ghost_hopper_top',
        north: 'ghost_hopper_outside',
        south: 'ghost_hopper_outside',
        east: 'ghost_hopper_outside',
        west: 'ghost_hopper_outside',
    },
};

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, o) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(o, null, 2));
    console.log('  >', path.relative('.', p).replace(/\\/g, '/'));
}

/** 确保 ghost 贴图存在（缺则从原版拷）并在 terrain_texture.json 注册 shortname。
 *  注意：只拷 png 不注册会导致材质引用失效（terrain shortname 不存在）。 */
function ensureGhostTex(texName, srcFile) {
    const dst = path.join(TEX_DIR, `ghost_${texName}.png`);
    if (!fs.existsSync(dst) && fs.existsSync(srcFile)) {
        fs.copyFileSync(srcFile, dst);
        console.log('  >', path.relative('.', dst).replace(/\\/g, '/'), `(由 ${path.basename(srcFile)})`);
    }
    const ttPath = 'resources/addon/LitematicaBE_RP/textures/terrain_texture.json';
    const tt = readJson(ttPath);
    const key = `ghost_${texName}`;
    if (!tt.texture_data[key]) {
        tt.texture_data[key] = { textures: `textures/blocks/ghost/ghost_${texName}` };
        writeJson(ttPath, tt);
    }
}

/** 只保留默认分支：cube.if 形如 "xxx == 0"（默认 0）保留；==1 / != / 字符串丢弃。
 *  同时按 pos+size 去重：原版数据里"无条件基础"与"delay==0 分支"pos/size 完全相同，
 *  不去重会叠两套火把/滑条（渲染重叠）。 */
function filterCubes(cubes) {
    const seen = new Set();
    const out = [];
    for (const c of (cubes || [])) {
        if (c.if && !/(\w+)\s*==\s*0$/.test(c.if)) continue;
        const key = JSON.stringify([c.pos, c.size]);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(c);
    }
    return out;
}

/** 给火把顶部补"杆"，让前端红石火把接触底座（原版提取漏了杆，导致悬浮）。
 *  repeater/comparator 的前端火把顶 = pos[0,5,0] size[2,0,2]，下面加 [0,2,0] size[2,3,2] 杆。 */
function withStem(cubes, shape) {
    if (shape !== 'repeater' && shape !== 'comparator') return cubes;
    const out = cubes.map((c) => ({ ...c }));
    const torch = out.find((c) => c.pos && c.pos[0] === 0 && c.pos[1] === 5 && c.pos[2] === 0
        && c.size && c.size[0] === 2 && c.size[2] === 2);
    if (torch) {
        const stem = { pos: [0, 2, 0], size: [2, 3, 2], terrainTexture: 'torch' };
        // 补杆与火把顶同 translate（火把顶居中时杆也居中）
        if (torch.translate) stem.translate = torch.translate;
        out.push(stem);
    }
    return out;
}

/** 每面取整张贴图（独立贴图，不用原版图集坐标） */
function fullUv() {
    const f = { uv: [0, 0], uv_size: [16, 16] };
    return { north: { ...f }, south: { ...f }, east: { ...f }, west: { ...f }, up: { ...f }, down: { ...f } };
}

/** 保留原版 uv（图集坐标 → 各面 [u,v] 起点 + 面尺寸 uv_size）。
 *  原版 cube.uv 键：'*'(全面) / 'side'(4 侧面) / 'up' / 'down' / 面名。
 *  无 uv 的 cube 走 fullUv()（全图）。 */
function toUv(c) {
    if (!c.uv) return fullUv();
    const s = c.size;
    const faceSize = (f) =>
        (f === 'north' || f === 'south') ? [s[0], s[1]]
        : (f === 'east' || f === 'west') ? [s[2], s[1]]
        : [s[0], s[2]];
    const conv = (uv, w, h) => ({ uv: [uv[0], uv[1]], uv_size: [w, h] });
    const out = {};
    for (const [k, uv] of Object.entries(c.uv)) {
        if (!uv) continue;
        if (k === '*') {
            for (const f of ['north', 'south', 'east', 'west', 'up', 'down']) out[f] = conv(uv, ...faceSize(f));
        } else if (k === 'side') {
            for (const f of ['north', 'south', 'east', 'west']) out[f] = conv(uv, ...faceSize(f));
        } else if (k === 'up' || k === 'down') {
            out[k] = conv(uv, ...faceSize(k));
        } else {
            out[k] = conv(uv, ...faceSize(k));
        }
    }
    return out;
}

/** cube 转基岩几何 cube：origin/size + 保留原版 uv + rotation(pivot 居中)/translation。
 *  材质指定（基岩优先级：①UV 内 material_instance → ②面名材质 → ③"*" 默认）：
 *   - c.textures（原版面→材质名映射，如 {"up":"down"}）→ 每面 UV.material_instance
 *   - c.terrainTexture（原版图集地形贴图，如 repeater_torch）→ 每面 UV.material_instance="torch"
 *  注意：cube.textures 不是有效字段，必须走 UV 内 material_instance。 */
function toGeoCube(c) {
    // 提取数据 pos 是 Java 角坐标(0-16，lower corner 在方块角)，而 Bedrock 几何 cube
    // origin 是"中心坐标"(X/Z 相对方块中心 -8..8，Y 0-16 相对底部)。因此 X/Z 各减 8，Y 不变。
    // translate（如灯笼 [5,0,5]）直接合并进 origin：geometry cube 的 translation 在 format_version
    // 1.19.0 下不生效（渲染忽略），合并进 origin 才能居中。
    const t = c.translate || [0, 0, 0];
    const o = [c.pos[0] - 8 + t[0], c.pos[1] + t[1], c.pos[2] - 8 + t[2]];
    const out = { origin: o, size: c.size, uv: toUv(c) };
    // 原版面→材质名映射（漏斗 {"up":"down"}、{"*":"north"}；堆肥桶 {"up":"down"}）
    if (c.textures) {
        for (const [face, matName] of Object.entries(c.textures)) {
            if (face === '*') {
                for (const k of Object.keys(out.uv)) out.uv[k].material_instance = matName;
            } else if (out.uv[face]) {
                out.uv[face].material_instance = matName;
            }
        }
    }
    if (c.terrainTexture) {
        // 该 cube 的所有面都映射到独立 torch 材质（material_instances.torch 定义）
        for (const k of Object.keys(out.uv)) {
            out.uv[k].material_instance = 'torch';
        }
    }
    if (c.rot) {
        // 绕自身中心旋转，避免 45° 斜板被甩出方块外（pivot 同为中心坐标）
        out.rotation = c.rot;
        out.pivot = [o[0] + c.size[0] / 2, o[1] + c.size[1] / 2, o[2] + c.size[2] / 2];
    }
    return out;
}

/** 生成 geometry.lit_<shape> JSON */
function buildGeometry(shapeName, cubes) {
    return {
        format_version: '1.19.0',
        'minecraft:geometry': [{
            description: {
                identifier: `geometry.lit_${shapeName}`,
                texture_width: 16,
                texture_height: 16,
                visible_bounds_width: 1,
                visible_bounds_height: 1,
                visible_bounds_offset: [0, 0, 0],
            },
            bones: [{
                name: 'body',
                pivot: [0, 0, 0],
                cubes: cubes.map(toGeoCube),
            }],
        }],
    };
}

/** 生成 BP 方块定义（引用几何 + lit:dir state + 4 向 permutation 旋转） */
function buildBlock(block, shape, ghostId, hasDir, tex, hasTorch, faceMats) {
    const states = hasDir ? { 'lit:dir': { values: { min: 0, max: 3 } } } : {};
    const permutations = [];
    if (hasDir) {
        const off = ROT_OFFSET[shape] || 0;
        for (let d = 0; d < 4; d++) {
            const ry = ((d * 90 + off) % 360);
            permutations.push({
                condition: `query.block_state('lit:dir') == ${d}`,
                components: {
                    'minecraft:transformation': { rotation: [0, ry, 0], scale: [1, 1, 1], translation: [0, 0, 0] },
                },
            });
        }
    }
    // 火把/滑条贴图：红石火把（ghost_redstone_torch，红色）。薄板用 blend（双面半透明），
    // 避免 alpha_test 单面渲染导致"从背面看消失、方向随视角"。
    const mainRender = (block === 'chain') ? 'alpha_test' : 'blend';
    const torchRender = 'blend';
    const mi = { '*': { texture: tex, render_method: mainRender, face_dimming: false, ambient_occlusion: false } };
    if (hasTorch) {
        mi.torch = { texture: 'ghost_redstone_torch', render_method: torchRender, face_dimming: false, ambient_occlusion: false };
    }
    if (faceMats) {
        for (const [f, t] of Object.entries(faceMats)) {
            mi[f] = { texture: t, render_method: mainRender, face_dimming: false, ambient_occlusion: false };
        }
    }
    return {
        format_version: '1.21.70',
        'minecraft:block': {
            description: {
                identifier: ghostId,
                menu_category: { category: 'none' },
                ...(Object.keys(states).length ? { states } : {}),
            },
            components: {
                'minecraft:geometry': `geometry.lit_${shape}`,
                'minecraft:material_instances': mi,
                'minecraft:collision_box': false,
                'minecraft:selection_box': false,
                'minecraft:destructible_by_mining': false,
                'minecraft:destructible_by_explosion': false,
                'minecraft:replaceable': {},
                'minecraft:light_dampening': 0,
                'minecraft:map_color': '#888888',
                'minecraft:transformation': { rotation: [0, 0, 0], scale: [1, 1, 1], translation: [0, 0, 0] },
            },
            permutations,
        },
    };
}

function main() {
    const list = (process.argv[2] || 'oak_stairs').split(',').map((s) => s.trim()).filter(Boolean);

    // torch 材质贴图：原版红石火把（repeater/comparator 的火把/滑条近似）
    const torchSrc = path.join(TEX_DIR, '..', 'redstone_torch.png');
    const torchDst = path.join(TEX_DIR, 'ghost_torch.png');
    if (fs.existsSync(torchSrc) && !fs.existsSync(torchDst)) {
        fs.copyFileSync(torchSrc, torchDst);
        console.log('  >', path.relative('.', torchDst).replace(/\\/g, '/'), '(由 redstone_torch.png)');
    }

    // 漏斗内/外/顶贴图（原版 hopper_inside/outside），拷 ghost 版 + terrain 注册
    ensureGhostTex('hopper_inside', path.join(TEX_DIR, '..', 'hopper_inside.png'));
    ensureGhostTex('hopper_outside', path.join(TEX_DIR, '..', 'hopper_outside.png'));

    const bsm = readJson(`${MODEL_DIR}/block_shape_map.json`);
    const sm = readJson(`${MODEL_DIR}/shape_models.json`);
    const bm = readJson(`${MODEL_DIR}/block_models.json`);
    const idx = readJson(IDX);

    const doneShapes = new Set();
    let geoCount = 0, bpCount = 0;

    for (const block of list) {
        const shape = bsm[block];
        if (!shape) { console.warn(`  ! ${block}: 无形状映射，跳过`); continue; }
        // block_models[block].cubes 带 translate（如灯笼 [5,0,5]、中继器火把顶 [7,2,2]），
        // shape_models 丢失 translate（几何会偏到方块角）。按 pos+size+if 匹配补回。
        const tl = new Map();
        for (const cc of (bm[block]?.cubes || [])) {
            if (cc.translate) tl.set(JSON.stringify([cc.pos, cc.size, cc.if || null]), cc.translate);
        }
        const cubes = withStem(filterCubes((sm[shape] || [])), shape)
            .map((c) => {
                const t = tl.get(JSON.stringify([c.pos, c.size, c.if || null]));
                return t ? { ...c, translate: t } : c;
            });
        if (!cubes.length) { console.warn(`  ! ${block}: 形状 ${shape} 无 cubes，跳过`); continue; }

        // 几何（每 shape 一份，去重）
        if (!doneShapes.has(shape)) {
            writeJson(path.join(RP_BLOCKS, `lit_${shape}.json`), buildGeometry(shape, cubes));
            doneShapes.add(shape);
            geoCount++;
        }

        // ghost id：优先用已有 javaMap 映射，否则新建
        const existing = idx.javaMap[`minecraft:${block}`];
        const ghostId = existing || `lit:g_${block}`;

        // 贴图
        let tex = TEX_MAP[block] || block;
        if (!fs.existsSync(path.join(TEX_DIR, `ghost_${tex}.png`))) {
            tex = 'generic';
        }

        const hasDir = !!DIR_STATE[block];
        writeJson(path.join(BP_BLOCKS, `${ghostId.split(':').pop()}.json`), buildBlock(block, shape, ghostId, hasDir, `ghost_${tex}`, TORCH_BLOCKS.has(block), FACE_MATS[block]));

        // index：blocks + javaMap + states 声明
        const statesDecl = hasDir
            ? { 'lit:dir': { type: 'int', min: 0, max: 3, default: 0, from: DIR_STATE[block] } }
            : undefined;
        idx.blocks[ghostId] = { texture: tex, geometry: shape, ...(statesDecl ? { states: statesDecl } : {}) };
        idx.javaMap[`minecraft:${block}`] = ghostId;
        bpCount++;

        console.log(`  ✓ ${block} -> ${ghostId} (shape=${shape}, dir=${hasDir ? 'on' : 'off'}, tex=${tex})`);
    }

    writeJson(IDX, idx);
    console.log(`\n生成 ${geoCount} 个几何 / ${bpCount} 个 BP 定义，更新 ${IDX}`);
}

main();
