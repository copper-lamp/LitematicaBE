// 临时诊断脚本（work/ 已 gitignore）：解析指定 .mcstructure，复现活塞方向/伸出态的判定链路
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { McstructureLoader } = require(path.join(ROOT, 'src', 'core', 'McstructureLoader.js'));
const { SurfaceExtractor } = require(path.join(ROOT, 'src', 'ghost', 'SurfaceExtractor.js'));
const { GhostBlockRegistry } = require(path.join(ROOT, 'src', 'ghost', 'GhostBlockRegistry.js'));
const { inferPistonExtendedStates, frontDelta, hasExtendedFlag } = require(path.join(ROOT, 'src', 'ghost', 'PistonStateInfer.js'));

const FILE = process.argv[2];
const DIRNAME = [null, 'down', 'up', 'north', 'south', 'west', 'east'];
const VEC_NAME = (v) => v ? (v[1] === -1 ? 'down' : v[1] === 1 ? 'up' : v[2] === -1 ? 'north' : v[2] === 1 ? 'south' : v[0] === -1 ? 'west' : 'east') : '-';

(async () => {
  const loader = new McstructureLoader(null);
  const sch = await loader.load(FILE);
  const reg = new GhostBlockRegistry(path.join(ROOT, 'resources', 'data', 'ghost_index.json'));
  console.log('=== 文件 ===');
  console.log('尺寸', sch.dimensions, '方块数', sch.totalBlocks);

  const names = new Map();
  for (const b of sch.blocks) {
    const n = b.name || b.type;
    names.set(n, (names.get(n) || 0) + 1);
  }
  console.log('\n=== 方块名统计（前 25）===');
  [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
    .forEach(([n, c]) => console.log(String(c).padStart(5), n));

  const isPistonish = (n) => /piston/.test(n || '');
  const pistons = sch.blocks.filter((b) => isPistonish(b.name || b.type));
  console.log(`\n=== 活塞相关格 ${pistons.length} 个 ===`);
  for (const b of pistons) {
    console.log(`${(b.name || b.type).padEnd(42)} pos=${JSON.stringify(b.pos)}`
      + ` state=${JSON.stringify(b.state)} bedrockState=${JSON.stringify(b.bedrockState)}`
      + ` renderName=${b.renderName || '-'}`);
  }

  // 原始状态 → ghost id（推断前）
  console.log('\n=== 推断前：resolveWithState ===');
  for (const b of pistons) {
    const gid = reg.resolveWithState(b.renderName || b.name, b.bedrockState || b.state);
    console.log(`${(b.name).padEnd(42)} f=${JSON.stringify((b.bedrockState || b.state || {}).facing_direction)}`
      + ` front=${VEC_NAME(frontDelta(b))} -> ${gid}`);
  }

  // 全量外壳提取
  const ex = new SurfaceExtractor().extract(sch, {});
  console.log('\n=== SurfaceExtractor 全量 ===');
  console.log('stats', JSON.stringify(ex.stats));
  const keptSet = new Set(ex.blocks.map((b) => `${b.pos[0]},${b.pos[1]},${b.pos[2]}`));
  const lostPistons = pistons.filter((b) => !keptSet.has(`${b.pos[0]},${b.pos[1]},${b.pos[2]}`));
  console.log(`活塞相关被剔除 ${lostPistons.length} 格：`);
  for (const b of lostPistons) console.log(`  ✗ ${(b.name).padEnd(40)} pos=${JSON.stringify(b.pos)} state=${JSON.stringify(b.bedrockState || b.state)}`);

  // 推断
  const fixed = inferPistonExtendedStates(ex.blocks);
  console.log(`\n=== inferPistonExtendedStates：补出伸出态 ${fixed} 格 ===`);

  console.log('\n=== 最终：每格活塞 → ghost id ===');
  for (const b of pistons) {
    const inKept = keptSet.has(`${b.pos[0]},${b.pos[1]},${b.pos[2]}`);
    const be = b.bedrockState || b.state || {};
    const gid = reg.resolveWithState(b.renderName || b.name, be);
    console.log(`${inKept ? '✓' : '✗'} ${(b.name).padEnd(40)} pos=${JSON.stringify(b.pos)}`
      + ` facing_direction=${be.facing_direction}(${DIRNAME[be.facing_direction + 1] || '?'})`
      + ` front=${VEC_NAME(frontDelta(b))} ext=${be.extended_bit === undefined ? '无标志' : be.extended_bit}`
      + ` -> ${gid}`);
  }
})().catch((e) => { console.error('ERROR', e && e.stack || e); process.exit(1); });
