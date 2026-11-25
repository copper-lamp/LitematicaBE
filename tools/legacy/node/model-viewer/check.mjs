// LitematicaBE 模型无头体检 —— 校验 models/blocks 下所有模型的结构正确性
// 用法: node tools/model-viewer/check.mjs [--json]
// 输出: 每个模型的校验结果 + 汇总；--json 输出机器可读 JSON
// 零第三方依赖。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MODELS_DIR = path.join(REPO_ROOT, 'resources', 'addon', 'LitematicaBE_RP', 'models', 'blocks');

function readJson(file) {
  try { return { ok: true, data: JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

function validateModel(file, j) {
  const report = { file, ok: true, errors: [], warnings: [], geometry: null, bones: 0, cubes: 0 };
  if (!j.ok) {
    report.ok = false;
    report.errors.push('JSON 解析失败: ' + j.error);
    return report;
  }
  const data = j.data;
  const geomArr = data['minecraft:geometry'];
  if (!Array.isArray(geomArr) || geomArr.length === 0) {
    report.ok = false;
    report.errors.push('缺少 minecraft:geometry 数组');
    return report;
  }
  if (!data.format_version) report.warnings.push('缺少 format_version');
  const geom = geomArr[0];
  report.geometry = geom.description && geom.description.identifier || '?';
  const desc = geom.description || {};
  const texW = desc.texture_width || 16;
  const texH = desc.texture_height || 16;
  const bones = geom.bones || [];
  report.bones = bones.length;

  for (const b of bones) {
    if (b.rotation && !b.pivot) report.warnings.push('bone "' + b.name + '" 有 rotation 无 pivot');
    const cubes = b.cubes || [];
    for (const c of cubes) {
      report.cubes++;
      const o = c.origin, s = c.size;
      if (!o || !s || o.length !== 3 || s.length !== 3) {
        report.ok = false;
        report.errors.push('cube 缺 origin/size');
        continue;
      }
      if (s.some((v) => v < 0)) { report.ok = false; report.errors.push('cube 负尺寸 [' + s.join(',') + ']'); }
      if (s.some((v) => v > 16)) report.warnings.push('cube 尺寸超格 [' + s.join(',') + ']');
      // 越界检查
      const x0 = (o[0] + 8) / 16, y0 = o[1] / 16, z0 = (o[2] + 8) / 16;
      const x1 = x0 + s[0] / 16, y1 = y0 + s[1] / 16, z1 = z0 + s[2] / 16;
      if (x0 < -0.001 || z0 < -0.001 || x1 > 1.001 || z1 > 1.001)
        report.warnings.push('cube 超出 1 格水平范围 origin[' + o.join(',') + '] size[' + s.join(',') + ']');
      if (y0 < -0.001 || y1 > 1.001)
        report.warnings.push('cube 超出 1 格垂直范围 origin[' + o.join(',') + '] size[' + s.join(',') + ']');
      // UV 检查
      if (c.uv) {
        for (const face of ['north', 'south', 'east', 'west', 'up', 'down']) {
          const f = c.uv[face];
          if (!f) continue;
          const u = f.uv && f.uv[0], v = f.uv && f.uv[1];
          const w = f.uv_size && f.uv_size[0], h = f.uv_size && f.uv_size[1];
          if (typeof u !== 'number' || typeof v !== 'number' || typeof w !== 'number' || typeof h !== 'number') {
            report.warnings.push('face ' + face + ' uv/uv_size 非数字');
            continue;
          }
          if (u + w > texW + 0.001 || v + h > texH + 0.001)
            report.warnings.push('face ' + face + ' UV 超出图集 [' + u + ',' + v + ' ' + w + '×' + h + ']');
        }
      } else {
        report.warnings.push('cube 无 uv（使用整张图集）');
      }
      // 旋转校验
      if (c.rotation && (!c.pivot || c.pivot.length !== 3)) report.warnings.push('cube 有 rotation 无 pivot');
    }
  }
  if (report.errors.length === 0 && report.warnings.length === 0) report.ok = true;
  return report;
}

// 主流程
const useJson = process.argv.includes('--json');
const files = fs.existsSync(MODELS_DIR)
  ? fs.readdirSync(MODELS_DIR).filter((f) => f.endsWith('.json')).sort()
  : [];

const results = files.map((f) => validateModel(f, readJson(path.join(MODELS_DIR, f))));

if (useJson) {
  process.stdout.write(JSON.stringify(results, null, 2));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

// 人类可读输出
let errCount = 0, warnCount = 0;
for (const r of results) {
  const status = r.ok && r.errors.length === 0 ? '✓' : '✗';
  console.log(status + ' ' + r.file + '  (' + r.geometry + ')  bones=' + r.bones + ' cubes=' + r.cubes);
  for (const e of r.errors) { errCount++; console.log('    ✗ ' + e); }
  for (const w of r.warnings) { warnCount++; console.log('    ⚠ ' + w); }
  if (r.errors.length === 0 && r.warnings.length === 0) console.log('    OK');
}
console.log('---');
console.log('模型总数: ' + results.length + '  错误: ' + errCount + '  警告: ' + warnCount);
process.exit(errCount > 0 ? 1 : 0);
