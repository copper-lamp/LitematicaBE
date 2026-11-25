/**
 * check_piston_head_align.js — 用真实结构验证「本体 ↔ 头格」的分派与位置是否一致
 *
 * 对每个已判定为伸出的活塞：
 *   · 本体 fd 的方向向量 v，头格应在 pos + v
 *   · 本体选中的 ghost 应是 *_f{fd}，头格选中的也应与同一个 fd 对齐
 *   · 打印两者的世界位置，便于肉眼确认「臂/头」是在推方向一侧
 */
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { McstructureLoader } = require(path.join(ROOT, 'src/core/McstructureLoader.js'));
const { inferPistonExtendedStates } = require(path.join(ROOT, 'src/ghost/PistonStateInfer.js'));
const { GhostBlockRegistry } = require(path.join(ROOT, 'src/ghost/GhostBlockRegistry.js'));
const { PISTON_FACING_NAME, PISTON_FACING_VEC } = require(path.join(ROOT, 'src/mappings/PistonFacing.js'));

const FILE = process.argv[2];

(async () => {
    const sch = await new McstructureLoader(null).load(FILE);
    const reg = new GhostBlockRegistry(path.join(ROOT, 'resources', 'data', 'ghost_index.json'));
    const idx = new Map(sch.blocks.map((b) => [b.pos.join(','), b]));
    inferPistonExtendedStates(sch.blocks);

    let n = 0;
    let bad = 0;
    const rows = [];
    for (const b of sch.blocks) {
        const name = b.name || '';
        if (!/(sticky_piston|^minecraft:piston)$/.test(name)) continue;
        const be = b.bedrockState || b.state || {};
        if (be.extended_bit !== 1) continue;

        const fd = be.facing_direction;
        const v = PISTON_FACING_VEC[fd];
        const [x, y, z] = b.pos;
        const head = idx.get([x + v[0], y + v[1], z + v[2]].join(','));
        if (!head) {
            rows.push(`  ✗ 伸出但推方向无头格 pos=${b.pos} fd=${fd}`);
            bad++;
            continue;
        }
        const hfd = (head.bedrockState || head.state || {}).facing_direction;
        const bodyGid = reg.resolveWithState(name, be);
        const headGid = reg.resolveWithState(head.name, head.bedrockState || head.state);
        const ok =
            bodyGid.endsWith('_f' + fd) &&
            headGid.endsWith('_f' + fd) &&
            String(hfd) === String(fd);
        if (!ok) bad++;
        rows.push(
            `  本体[${b.pos}] fd=${fd}(${PISTON_FACING_NAME[fd]}) → ${bodyGid}\n` +
            `    头格[${head.pos}] fd=${hfd} → ${headGid} ${ok ? '✔' : '✗'}`);
        n++;
    }

    rows.slice(0, 12).forEach((r) => console.log(r));
    console.log(`\n伸出活塞 ${n} 个；本体 / 头格 的 fd 与 identifier 全部一致：${n - bad} / ${n}`);
    console.log(bad ? `存在 ${bad} 处不一致` : '无错位');
})();
