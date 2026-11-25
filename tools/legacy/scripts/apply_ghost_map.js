// 一次性脚本：给方向族 ghost 补状态映射（work/ 已 gitignore）
//
// 背景（2026-11-13 实测校准，勿凭对称性再改）：
//   · `lit:facing` 是 addon 方块的 int 状态，实际朝向由 BP 的 permutations 决定：
//       dispenser（geometry.lit_dispenser，front 贴 south 面）: 2=北 3=南 4=东 5=西
//       observer （geometry.lit_observer， front 贴 north 面）: 2=北 3=南 4=东 5=西
//     水平四向两者相同；X 轴表互换 → 0/1（下/上）相反。
//   · 投影数据里：
//       dispenser/dropper → `facing_direction` = int（2=北 3=南 4=西 5=东，通用表）
//       observer          → `facing_direction` = **字符串**（观察面朝向）
//   · observer 的 `facing_direction` 指**侦测面（脸）**，而 ghost 模型 front 面贴的正是
//     `ghost_observer_front.png`（脸，已核对贴图）→ 同向直映，**不要反向**。
//     红点在 `ghost_observer_back.png`（输出面），与 facing 相反；
//     曾把 front 当成红点面做反向，导致观察者南北颠倒。
const fs = require('fs');
const p = 'resources/data/ghost_index.json';
const obj = JSON.parse(fs.readFileSync(p, 'utf8'));

// observer：数据（观察面）→ lit:facing（front/脸 的朝向）
//   水平四向直映；但 **上下要互换**（2026-11-13 真机校准）：
//   X 轴旋转与"默认面相反"并不抵消 —— 实测 [−90,0,0]（lit:facing 1）让朝南的 dispenser
//   抬成朝上，对朝北的 observer 却压成朝下。所以 observer 的 0/1 与 dispenser 相反。
const OBSERVER_MAP = {
    north: 2, south: 3, east: 4, west: 5, up: 0, down: 1,
    // 旧结构里 facing_direction 若是 int 0-5（0=下 1=上），同为观察面语义 → 只换 0/1
    0: 1, 1: 0, 2: 2, 3: 3, 4: 4, 5: 5,
};

// dispenser/dropper：`facing_direction` 是 4=西 5=东，而 lit:facing 是 4=东 5=西 → 交换 4/5；
// 上下按实测颠倒互换 0/1；南北直映。
const DIRECT_MAP = {
    north: 2, south: 3, east: 4, west: 5, up: 0, down: 1,
    0: 1, 1: 0, 2: 2, 3: 3, 4: 5, 5: 4,
};

let changed = 0;

function patch(ghostId, map, withFallback) {
    const entry = obj.blocks[ghostId];
    if (!entry || !entry.states || !entry.states['lit:facing']) {
        console.log('跳过（条目不存在）:', ghostId);
        return;
    }
    const spec = entry.states['lit:facing'];
    spec.map = map;
    if (withFallback) {
        // .litematic 数据里没有 facing_direction，只有 Java 的 facing（字符串）
        spec.fallbackFrom = 'facing';
    }
    changed++;
    console.log('已更新:', ghostId);
}

patch('lit:g_observer_front', OBSERVER_MAP, false);
patch('lit:g_dispenser_front', DIRECT_MAP, true);
patch('lit:g_dropper_front', DIRECT_MAP, true);

fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
console.log(`完成：${changed} 条`);

// ── 自检：用真实 registry 跑一遍推导结果 ─────────────────────────
const path = require('path');
const { GhostBlockRegistry } = require('../src/ghost/GhostBlockRegistry.js');
// 构造参数是 indexPath（不是 logger），必须给绝对路径，否则落到 ./plugins/... 找不到
const reg = new GhostBlockRegistry(path.join(__dirname, '..', 'resources', 'data', 'ghost_index.json'));
console.log('registry ready:', reg.ready, '| ghost 条目:', reg.blocks.size);
const cases = [
    // 观察面(数据) → 脸(ghost front) 朝向：水平直映。lit:facing 4=东 5=西
    ['observer', { facing_direction: 'west' }, 5],
    ['observer', { facing_direction: 'north' }, 2],
    ['observer', { facing_direction: 'east' }, 4],
    ['observer', { facing_direction: 'south' }, 3],
    // 上下：观察者与发射器相反（X 轴旋转不抵消默认面差异）
    ['observer', { facing_direction: 'up' }, 0],
    ['observer', { facing_direction: 'down' }, 1],
    ['dispenser', { facing_direction: 5 }, 4],
    ['dispenser', { facing_direction: 4 }, 5],
    ['dispenser', { facing_direction: 2 }, 2],
    ['dispenser', { facing_direction: 3 }, 3],
    ['dispenser', { facing_direction: 1 }, 0],
    ['dispenser', { facing_direction: 0 }, 1],
];
let bad = 0;
for (const [name, states, expect] of cases) {
    const got = reg.buildStates(`minecraft:${name}`, states);
    const v = got && got['lit:facing'];
    const ok = v === expect;
    if (!ok) bad++;
    console.log(`${ok ? '✅' : '❌'} ${name} ${JSON.stringify(states)} → lit:facing=${v} (期望 ${expect})`);
}
console.log(bad ? `自检不符 ${bad} 项` : '自检全部通过');
process.exit(bad ? 1 : 0);
