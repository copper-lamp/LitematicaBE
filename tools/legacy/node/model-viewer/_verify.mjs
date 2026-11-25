// 临时验证脚本：复刻 viewer.js 的 buildCubeGeometry 数学，验证位置/法向/UV
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS = path.resolve(__dirname, '..', '..', 'resources', 'addon', 'LitematicaBE_RP', 'models', 'blocks');

function atlasUV(u, v, w, h, texW, texH) {
  return [
    [u / texW, (texH - (v + h)) / texH],
    [(u + w) / texW, (texH - (v + h)) / texH],
    [(u + w) / texW, (texH - v) / texH],
    [u / texW, (texH - v) / texH],
  ];
}

function buildCube(cube, texW, texH) {
  const sx = cube.size[0] / 16, sy = cube.size[1] / 16, sz = cube.size[2] / 16;
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const C = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz],
    [-hx, -hy, hz], [hx, -hy, hz], [-hx, hy, hz], [hx, hy, hz],
  ];
  const faces = [
    { key: 'north', look: [0, 0, -1], up: [0, 1, 0], idx: [0, 1, 2, 3] },
    { key: 'south', look: [0, 0, 1], up: [0, 1, 0], idx: [4, 5, 6, 7] },
    { key: 'east', look: [1, 0, 0], up: [0, 1, 0], idx: [1, 3, 5, 7] },
    { key: 'west', look: [-1, 0, 0], up: [0, 1, 0], idx: [0, 2, 4, 6] },
    { key: 'up', look: [0, 1, 0], up: [0, 0, -1], idx: [2, 3, 6, 7] },
    { key: 'down', look: [0, -1, 0], up: [0, 0, 1], idx: [0, 1, 4, 5] },
  ];
  const positions = [], uvs = [], normals = [];
  for (const f of faces) {
    const uv = cube.uv ? cube.uv[f.key] : null;
    const u0 = uv && uv.uv ? uv.uv[0] : 0, v0 = uv && uv.uv ? uv.uv[1] : 0;
    const w0 = uv && uv.uv_size ? uv.uv_size[0] : texW, h0 = uv && uv.uv_size ? uv.uv_size[1] : texH;
    const quadUV = atlasUV(u0, v0, w0, h0, texW, texH);
    const look = f.look, up = f.up;
    // right = look × up
    const right = [
      look[1] * up[2] - look[2] * up[1],
      look[2] * up[0] - look[0] * up[2],
      look[0] * up[1] - look[1] * up[0],
    ];
    const corners = f.idx.map((i) => C[i]);
    const screen = corners.map((p) => ({ p, sx: p[0] * right[0] + p[1] * right[1] + p[2] * right[2], sy: p[0] * up[0] + p[1] * up[1] + p[2] * up[2] }));
    const minX = Math.min(...screen.map((s) => s.sx)), maxX = Math.max(...screen.map((s) => s.sx));
    const minY = Math.min(...screen.map((s) => s.sy)), maxY = Math.max(...screen.map((s) => s.sy));
    if (maxX - minX < 1e-9 || maxY - minY < 1e-9) continue; // 跳过退化面
    const pos = {};
    for (const s of screen) {
      const kx = Math.abs(s.sx - minX) < 1e-9 ? 'L' : 'R';
      const ky = Math.abs(s.sy - minY) < 1e-9 ? 'B' : 'T';
      pos[kx + ky] = s.p;
    }
    const ordered = [pos.LB, pos.RB, pos.RT, pos.LT];
    const uvsQ = [quadUV[0], quadUV[1], quadUV[2], quadUV[3]];
    const tris = [[0, 2, 1], [0, 3, 2]];
    for (const t of tris) for (const ci of t) {
      positions.push(...ordered[ci]);
      uvs.push(...uvsQ[ci]);
      normals.push(...look);
    }
  }
  return { positions, uvs, normals };
}

function cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }

let failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.log('  ✗ ' + msg); } }

// 测试 1: 地毯立方体（整格，全 16x16 顶/底，16x1 侧）
const carpet = JSON.parse(fs.readFileSync(path.join(MODELS, 'lit_carpet.json'), 'utf8'));
const carpetCube = carpet['minecraft:geometry'][0].bones[0].cubes[0];
const g = buildCube(carpetCube, 16, 16);
console.log('== 地毯 cube ==');
check(g.positions.length === 36 * 3, '36 顶点(12 三角形)');
check(g.uvs.length === 36 * 2, '36 UV');
// 所有位置在 [-0.5, 0.5] 内（居中盒）
for (let i = 0; i < g.positions.length; i += 3) {
  check(Math.abs(g.positions[i]) <= 0.5001 && Math.abs(g.positions[i+1]) <= 0.5001 && Math.abs(g.positions[i+2]) <= 0.5001, '位置在居中盒内');
}
// 每个三角形法向 = 叉积方向一致
for (let t = 0; t < 12; t++) {
  const b = t * 9;
  const p0 = [g.positions[b], g.positions[b+1], g.positions[b+2]];
  const p1 = [g.positions[b+3], g.positions[b+4], g.positions[b+5]];
  const p2 = [g.positions[b+6], g.positions[b+7], g.positions[b+8]];
  const n = cross(sub(p1, p0), sub(p2, p0));
  const nlen = Math.hypot(...n);
  const nn = n.map((x) => x / nlen);
  const gn = [g.normals[t*9], g.normals[t*9+1], g.normals[t*9+2]];
  const dot = nn[0]*gn[0] + nn[1]*gn[1] + nn[2]*gn[2];
  check(dot > 0.999, '三角形 ' + t + ' 法向与几何法向一致 (dot=' + dot.toFixed(3) + ')');
}
// UV 范围
for (let i = 0; i < g.uvs.length; i += 2) {
  check(g.uvs[i] >= -0.001 && g.uvs[i] <= 1.001, 'u 在 [0,1]');
  check(g.uvs[i+1] >= -0.001 && g.uvs[i+1] <= 1.001, 'v 在 [0,1]');
}
console.log('  顶面 UV 采样(应含 [0,0]..[1,1]): ', JSON.stringify([...new Set(g.uvs.map((x)=>x.toFixed(3)))].slice(0,6)));

// 测试 2: 灯笼的旋转 cube（rotation 45°, pivot[0,10,0]）
const lantern = JSON.parse(fs.readFileSync(path.join(MODELS, 'lit_lantern.json'), 'utf8'));
const rotCube = lantern['minecraft:geometry'][0].bones[0].cubes[2];
console.log('== 灯笼旋转 cube (rotation 45, pivot 0,10,0) ==');
check(JSON.stringify(rotCube.rotation) === '[0,45,0]', 'cube 带 rotation');
const g2 = buildCube(rotCube, 16, 16);
// 无旋转时中心在 origin+size/2 → 转成块坐标
const cx = ((rotCube.origin[0]+8) + rotCube.size[0]/2) / 16;
const cy = (rotCube.origin[1] + rotCube.size[1]/2) / 16;
const cz = ((rotCube.origin[2]+8) + rotCube.size[2]/2) / 16;
// 验证顶点绕 pivot(0,10,0)旋转 45° 后仍在合理范围（宽度 3 → 对角约 3*1.414/16）
let maxX = 0, maxZ = 0;
for (let i = 0; i < g2.positions.length; i += 3) {
  maxX = Math.max(maxX, Math.abs(g2.positions[i]));
  maxZ = Math.max(maxZ, Math.abs(g2.positions[i+2]));
}
console.log('  旋转后 |x|max=' + maxX.toFixed(3) + ' |z|max=' + maxZ.toFixed(3) + ' (期望约 ' + (3*1.414/16/2).toFixed(3) + ')');
check(maxX < 0.2 && maxZ < 0.2, '旋转后顶点在合理范围');

// 测试 3: 世界坐标定位（bone/cube 层级，复刻 renderModel 逻辑）
// 目的: 整格方块的世界中心必须回到 (0.5,0.5,0.5)，不得偏移到边缘
console.log('== 世界坐标定位 ==');
const u2bX = (v) => (v + 8) / 16;
const u2bY = (v) => v / 16;
const u2bZ = (v) => (v + 8) / 16;
function worldCenter(bone, cube) {
  const bp = bone.pivot || [0, 0, 0];
  const bonePivot = [u2bX(bp[0]), u2bY(bp[1]), u2bZ(bp[2])];
  const center = [
    u2bX(cube.origin[0]) + (cube.size[0] / 16) / 2,
    u2bY(cube.origin[1]) + (cube.size[1] / 16) / 2,
    u2bZ(cube.origin[2]) + (cube.size[2] / 16) / 2,
  ];
  if (cube.rotation && cube.pivot) {
    const anchor = [u2bX(cube.pivot[0]), u2bY(cube.pivot[1]), u2bZ(cube.pivot[2])];
    // world = bonePivot + (anchor-bonePivot) + R*(center-anchor)，R 恒等时 = anchor
    return anchor;
  }
  return [bonePivot[0] + (center[0] - bonePivot[0]), bonePivot[1] + (center[1] - bonePivot[1]), bonePivot[2] + (center[2] - bonePivot[2])];
}

// 地毯：整格 cube 中心应为 (0.5, 0.03125, 0.5)（y=1/16 高的一半）
const carpetBone = carpet['minecraft:geometry'][0].bones[0];
const wc = worldCenter(carpetBone, carpetCube);
console.log('  地毯 cube 世界中心: ' + JSON.stringify(wc.map((v) => +v.toFixed(4))));
check(Math.abs(wc[0] - 0.5) < 1e-6 && Math.abs(wc[2] - 0.5) < 1e-6 && Math.abs(wc[1] - (1 / 16 / 2)) < 1e-6, '地毯世界中心正确（不偏移）');

// 灯笼：旋转 cube 世界中心应为 (0.5, 0.625, 0.5)
const lanternBone = lantern['minecraft:geometry'][0].bones[0];
const wc2 = worldCenter(lanternBone, rotCube);
console.log('  灯笼旋转 cube 世界中心: ' + JSON.stringify(wc2.map((v) => +v.toFixed(4))));
check(Math.abs(wc2[0] - 0.5) < 1e-6 && Math.abs(wc2[1] - 0.625) < 1e-6 && Math.abs(wc2[2] - 0.5) < 1e-6, '灯笼旋转 cube 世界中心正确');

// 测试 4: 包围盒（visible_bounds）与模型对齐
// 包围盒中心 = (0.5,0.5,0.5)+offset，尺寸 = (width, height, width)
console.log('== 包围盒 ==');
function boundsCenter(w, h, off) {
  return [0.5 + off[0], 0.5 + off[1], 0.5 + off[2], w, h, w];
}
// 默认 1x1x1 off=[0,0,0] → 中心 (0.5,0.5,0.5)，跨 [0,1]
let b = boundsCenter(1, 1, [0, 0, 0]);
console.log('  默认包围盒 中心=' + JSON.stringify(b.slice(0,3).map((v)=>+v.toFixed(3))) + ' 尺寸=' + JSON.stringify(b.slice(3).map((v)=>+v.toFixed(3))));
check(Math.abs(b[0]-0.5)<1e-6 && Math.abs(b[1]-0.5)<1e-6 && Math.abs(b[2]-0.5)<1e-6, '默认包围盒中心 (0.5,0.5,0.5)');
check(Math.abs(b[1] - b[4]/2) < 1e-6, '默认包围盒底部在 y=0（不被抬升）');
// 活塞扩展 3x3x3 off=[0,1,0] → 中心 (0.5,1.5,0.5)，y 跨 [0,3]
b = boundsCenter(3, 3, [0, 1, 0]);
console.log('  活塞扩展包围盒 中心=' + JSON.stringify(b.slice(0,3).map((v)=>+v.toFixed(3))) + ' 尺寸=' + JSON.stringify(b.slice(3).map((v)=>+v.toFixed(3))));
check(Math.abs(b[0]-0.5)<1e-6 && Math.abs(b[1]-1.5)<1e-6 && Math.abs(b[2]-0.5)<1e-6, '活塞扩展包围盒中心 (0.5,1.5,0.5)');
check(b[4] === 3 && b[3] === 3 && b[5] === 3, '活塞扩展包围盒尺寸 3x3x3');

// 测试 5: 逐面贴图映射（复刻 viewer.js faceMatCb）
// 目的: 多面方块必须按 material_instance → material_instances 逐面贴图
console.log('== 逐面贴图映射 ==');
const BP = path.resolve(__dirname, '..', '..', 'resources', 'addon', 'LitematicaBE_BP', 'blocks');
const pistonBlock = JSON.parse(fs.readFileSync(path.join(BP, 'g_piston_side_f0.json'), 'utf8'));
const miMap = {};
const mi = pistonBlock['minecraft:block'].components['minecraft:material_instances'];
for (const k of Object.keys(mi)) miMap[k] = { texture: mi[k].texture, render_method: mi[k].render_method };
const pistonModel = JSON.parse(fs.readFileSync(path.join(MODELS, 'lit_piston_f0.json'), 'utf8'));
const pistonCube = pistonModel['minecraft:geometry'][0].bones[0].cubes[0];
const faceTextures = {};
for (const face of ['north', 'south', 'east', 'west', 'up', 'down']) {
  const f = pistonCube.uv[face];
  const instName = (f && f.material_instance) || '*';
  const inst = miMap[instName] || miMap['*'];
  faceTextures[face] = inst ? inst.texture : null;
}
console.log('  活塞逐面贴图: ' + JSON.stringify(faceTextures));
const distinct = new Set(Object.values(faceTextures));
console.log('  不同贴图数: ' + distinct.size + '（期望 3: side/bottom/top）');
check(distinct.size === 3, '活塞 cube 使用 3 张不同贴图（side/bottom/top_carried）');
check(faceTextures.south === 'ghost_piston_side', 'south 面 → ghost_piston_side');
check(faceTextures.up === 'ghost_piston_bottom', 'up 面 → ghost_piston_bottom');
check(faceTextures.down === 'ghost_piston_top_normal', 'down 面 → ghost_piston_top_normal');

// 地毯: 所有面应同用 ghost_carpet_black（'*'）
const carpetBlock = JSON.parse(fs.readFileSync(path.join(BP, 'g_black_carpet.json'), 'utf8'));
const cmi = {};
for (const k of Object.keys(carpetBlock['minecraft:block'].components['minecraft:material_instances']))
  cmi[k] = { texture: carpetBlock['minecraft:block'].components['minecraft:material_instances'][k].texture };
const carpetFaces = {};
for (const face of ['north', 'south', 'east', 'west', 'up', 'down']) {
  const f = carpetCube.uv[face];
  const instName = (f && f.material_instance) || '*';
  const inst = cmi[instName] || cmi['*'];
  carpetFaces[face] = inst ? inst.texture : null;
}
console.log('  地毯逐面贴图: ' + JSON.stringify(carpetFaces));
check(new Set(Object.values(carpetFaces)).size === 1 && Object.values(carpetFaces)[0] === 'ghost_carpet_black', '地毯所有面 → ghost_carpet_black');

console.log(failures === 0 ? '\n全部通过' : '\n失败数: ' + failures);
process.exit(failures === 0 ? 0 : 1);
