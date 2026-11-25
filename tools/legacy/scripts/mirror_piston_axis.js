/**
 * mirror_piston_axis.js — 把东西朝向（f4/f5）的伸出态/头格沿 x 轴整体镜像一次。
 *
 * 目的：二分定位「东西方块自身反了」到底是不是端部/面名问题。
 *   · 镜像后画面有变化 → 在几何层，继续按实机反馈调
 *   · 镜像后画面毫无变化 → 客户端没加载新资源包（几何未生效），不是资产问题
 *
 * 镜像规则（格界 x −8..8）：x' = −x − size
 * 材质：east ↔ west 互换（inner↔bottom、plate_top↔plate_back、side_spec 自反）
 *
 * 用法：node work/mirror_piston_axis.js [f4 f5]   默认两个都做
 */
const fs = require('fs');
const path = require('path');

const RP = path.join(__dirname, '..', 'resources', 'addon', 'LitematicaBE_RP', 'models', 'blocks');
const FACES = ['north', 'south', 'east', 'west', 'up', 'down'];
const SWAP_FACE = { east: 'west', west: 'east', north: 'north', south: 'south', up: 'up', down: 'down' };

const targets = process.argv.slice(2).filter((a) => /^f\d$/.test(a));
const fds = targets.length ? targets.map((t) => Number(t.slice(1))) : [4, 5];

let changed = 0;
for (const fd of fds) {
    for (const geo of ['lit_piston_extended', 'lit_piston_head']) {
        const file = path.join(RP, `${geo}_f${fd}.json`);
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const c of raw['minecraft:geometry'][0].bones[0].cubes) {
            // 1) 坐标沿 x 镜像
            const [x, , ] = c.origin;
            const [sx] = c.size;
            c.origin[0] = -x - sx;

            // 2) 材质按镜像后的面重排：新 east 面 = 旧 west 面，反之亦然
            const old = {};
            for (const f of FACES) if (c.uv[f]) old[f] = c.uv[f].material_instance;
            for (const f of FACES) {
                if (!c.uv[f]) continue;
                const src = SWAP_FACE[f];
                if (old[src]) c.uv[f].material_instance = old[src];
            }
            changed++;
        }
        fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n', 'utf8');
        console.log(`${geo}_f${fd} 已沿 x 镜像`);
    }
}
console.log(`\n共处理 ${changed} 个 cube`);
