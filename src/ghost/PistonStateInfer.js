/**
 * PistonStateInfer.js — 活塞/黏性活塞「伸出态」状态补全
 *
 *   只在「本体完全没有 extended 标志」时，看它的朝向前方一格是不是活塞头；
 *   是 → 补 `extended_bit = 1`。不命中时绝不写入 `0`，避免 MEGA 分块注入时邻格还在别的分块里没读出来，被误判成收缩态。
 *
 * @module ghost/PistonStateInfer
 */

const NS = 'minecraft:';

// 活塞族的 facing_direction 语义与「自定义方块通用枚举」**相反**（2=south 3=north 4=east 5=west），
// 唯一真源在 mappings/PistonFacing.js，判据是「活塞头格必在本体推出方向上」的结构自证。
const { PISTON_FACING_VEC, PISTON_FACING_NAME, isPistonName } = require('../mappings/PistonFacing');

/** 活塞本体（要补状态的） */
const PISTON_BASES = new Set([
    `${NS}piston`, `${NS}sticky_piston`,
]);

/** 活塞头 / 臂（伸出时出现在本体正前方一格；缩回时消失） */
const PISTON_HEADS = new Set([
    `${NS}piston_head`, `${NS}piston_arm_collision`,
    `${NS}sticky_piston_arm_collision`, `${NS}moving_piston`,
]);

/** Java facing 字符串 → 方向向量 */
const JAVA_FACING_VEC = {
    down: [0, -1, 0], up: [0, 1, 0],
    north: [0, 0, -1], south: [0, 0, 1],
    west: [-1, 0, 0], east: [1, 0, 0],
};

/** BE facing_direction → 方向向量（活塞语义：0=down 1=up 2=south 3=north 4=east 5=west） */
const BE_FACING_VEC = PISTON_FACING_VEC;

function fullName(name) {
    if (!name || typeof name !== 'string') return '';
    return name.includes(':') ? name : NS + name;
}

/** 取方块名（渲染兜底名优先，和 GhostRenderer 一致） */
function nameOf(block) {
    return fullName(block && (block.renderName || block.name || block.type));
}

/** Java 侧状态（.litematic 原样保留的、带 facing 字符串的那份） */
function javaStatesOf(block) {
    const s = block && block.state;
    if (!s || typeof s !== 'object') return null;
    if (s.facing !== undefined && s.facing_direction === undefined) return s;
    return null;
}

/** 基岩侧状态（.mcstructure 的 state / .litematic 转换出的 bedrockState） */
function bedrockStatesOf(block) {
    const s = block && (block.bedrockState || block.state);
    return s && typeof s === 'object' ? s : null;
}

/** 已经带 extended 标志（不论 Java 的 extended 还是 BE 的 extended_bit）就说明来源可信 */
function hasExtendedFlag(states) {
    if (!states) return false;
    return states.extended_bit !== undefined || states.extended !== undefined;
}

/** 该方块朝前的方向向量（BE 优先，其次 Java 字符串） */
function frontDelta(block) {
    const be = bedrockStatesOf(block);
    if (be) {
        const fd = be.facing_direction;
        if (fd !== undefined && fd !== null) {
            // .mcstructure 里活塞是整数，观察者一类是字符串方向名，两种都要认
            if (typeof fd === 'string' && JAVA_FACING_VEC[fd.toLowerCase()]) {
                return JAVA_FACING_VEC[fd.toLowerCase()];
            }
            const n = Math.floor(Number(fd));
            if (Number.isInteger(n) && n >= 0 && n <= 5) return BE_FACING_VEC[n];
        }
        if (typeof be.facing === 'string' && JAVA_FACING_VEC[be.facing]) return JAVA_FACING_VEC[be.facing];
    }
    const js = javaStatesOf(block);
    if (js && typeof js.facing === 'string' && JAVA_FACING_VEC[js.facing]) return JAVA_FACING_VEC[js.facing];
    return null;
}

/** 活塞 fd 的方向名（供日志/诊断） */
function pistonFacingNameOf(block) {
    const be = bedrockStatesOf(block);
    const fd = be && be.facing_direction;
    const n = Math.floor(Number(fd));
    if (Number.isInteger(n) && n >= 0 && n <= 5) return PISTON_FACING_NAME[n];
    return null;
}


function posKey(x, y, z) {
    return `${x},${y},${z}`;
}

/** 两个方向向量是否一致（都必须是已知向量） */
function sameVec(a, b) {
    return !!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** 把补出来的伸出标志同时写到基岩状态与（若存在且为基岩风格）state 上 */
function markExtended(block) {
    const be = bedrockStatesOf(block);
    if (be) be.extended_bit = 1;
    const st = block && block.state;
    if (st && typeof st === 'object' && st !== be) {
        if (st.facing_direction !== undefined || st.extended_bit !== undefined) {
            st.extended_bit = 1;
        } else if (st.extended !== undefined || st.facing !== undefined) {
            st.extended = 'true';
        }
    }
    return true;
}

/**
 * 就地补全一批方块的活塞伸出态。
 *
 * @param {Array<{pos:number[]|{x:number,y:number,z:number}, name?:string, renderName?:string, state?:object, bedrockState?:object}>} blocks
 *        坐标必须是**同一坐标系**（相对投影原点即可），函数内部只用相对位置找邻居
 * @param {object} [opts]
 * @param {boolean} [opts.requireSameFacing=true] 活塞头朝向必须与本体一致才认（防误判）
 * @returns {number} 被补上 extended_bit 的方块数
 */
function inferPistonExtendedStates(blocks, opts = {}) {
    if (!Array.isArray(blocks) || blocks.length === 0) return 0;
    const requireSameFacing = opts.requireSameFacing !== false;

    // 先建索引：一次性 O(n)
    const index = new Map();
    for (const b of blocks) {
        const p = b && b.pos;
        if (!p) continue;
        const x = Array.isArray(p) ? p[0] : p.x;
        const y = Array.isArray(p) ? p[1] : p.y;
        const z = Array.isArray(p) ? p[2] : p.z;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        index.set(posKey(x, y, z), b);
    }

    let fixed = 0;
    for (const b of blocks) {
        const name = nameOf(b);
        if (!PISTON_BASES.has(name)) continue;
        if (hasExtendedFlag(bedrockStatesOf(b)) || hasExtendedFlag(b && b.state)) continue;

        const d = frontDelta(b);
        if (!d) continue;

        const p = b.pos;
        const x = Array.isArray(p) ? p[0] : p.x;
        const y = Array.isArray(p) ? p[1] : p.y;
        const z = Array.isArray(p) ? p[2] : p.z;
        const nb = index.get(posKey(x + d[0], y + d[1], z + d[2]));
        if (!nb || !PISTON_HEADS.has(nameOf(nb))) continue;

        // 头的朝向若可知，必须与本体一致，避免「收缩活塞正前方恰好是别的活塞的头」被误判
        if (requireSameFacing) {
            const nd = frontDelta(nb);
            if (nd && !sameVec(nd, d)) continue;
        }

        if (markExtended(b)) fixed++;
    }
    return fixed;
}

module.exports = {
    inferPistonExtendedStates,
    // 供测试使用
    PISTON_BASES,
    PISTON_HEADS,
    frontDelta,
    hasExtendedFlag,
};
