// LitematicaBE 模型查看器 —— 本地静态服务器 + manifest 构建
// 用法: node tools/model-viewer/server.mjs [端口]   (默认 8123)
// 零第三方依赖，仅用 Node 内置 http/fs/path/url。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOL_DIR = __dirname;
const REPO_ROOT = path.resolve(TOOL_DIR, '..', '..');
const RP_DIR = path.join(REPO_ROOT, 'resources', 'addon', 'LitematicaBE_RP');
const BP_DIR = path.join(REPO_ROOT, 'resources', 'addon', 'LitematicaBE_BP');
const MODELS_DIR = path.join(RP_DIR, 'models', 'blocks');
const GHOST_TEX_DIR = path.join(RP_DIR, 'textures', 'blocks', 'ghost');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---------- 解析工具 ----------

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { __error: String(e && e.message || e), __file: file };
  }
}

// 收集一个 BP 方块定义（base + 所有 permutations）里出现的
// geometry 标识符、材质纹理、render_method、transformation。
function collectBlockInfo(blockJson) {
  const out = { geometries: new Set(), textures: new Set(), renderMethods: new Set(), transforms: new Set(), materialInstances: {} };
  const grab = (comp) => {
    if (!comp) return;
    if (comp['minecraft:geometry']) out.geometries.add(String(comp['minecraft:geometry']));
    const mi = comp['minecraft:material_instances'];
    if (mi) {
      for (const key of Object.keys(mi)) {
        const inst = mi[key];
        if (!inst) continue;
        // 逐面材质实例：名称 → { texture, render_method }（含 permutation 覆盖）
        out.materialInstances[key] = {
          texture: inst.texture ? String(inst.texture) : null,
          render_method: inst.render_method ? String(inst.render_method) : null,
        };
        if (inst.texture) out.textures.add(String(inst.texture));
        if (inst.render_method) out.renderMethods.add(String(inst.render_method));
      }
    }
    const tr = comp['minecraft:transformation'];
    if (tr) out.transforms.add(JSON.stringify(tr));
  };
  const block = blockJson['minecraft:block'];
  if (!block) return out;
  grab(block.components);
  if (Array.isArray(block.permutations)) {
    for (const p of block.permutations) grab(p.components);
  }
  return out;
}

// 构建 manifest：模型列表 + 方块列表 + 几何标识符 → 候选材质
function buildManifest() {
  const models = [];
  const blocks = [];
  const geometryMap = new Map(); // geometry -> [{blockId, texture, renderMethod}]

  let files = [];
  try { files = fs.readdirSync(MODELS_DIR).filter(f => f.endsWith('.json')); } catch (e) { /* 目录缺失 */ }
  files.sort();

  for (const file of files) {
    const full = path.join(MODELS_DIR, file);
    const j = readJson(full);
    const geomArr = j && Array.isArray(j['minecraft:geometry']) ? j['minecraft:geometry'] : [];
    const first = geomArr[0] || {};
    const desc = first.description || {};
    const identifier = desc.identifier || path.basename(file, '.json');
    models.push({
      file,
      identifier,
      bones: Array.isArray(first.bones) ? first.bones.length : 0,
      textureWidth: desc.texture_width || 16,
      textureHeight: desc.texture_height || 16,
      visibleBounds: desc.visible_bounds_width ? {
        width: desc.visible_bounds_width,
        height: desc.visible_bounds_height,
        offset: desc.visible_bounds_offset || [0, 0, 0],
      } : null,
      formatVersion: j && j.format_version ? j.format_version : '?',
    });
  }

  let bpFiles = [];
  try { bpFiles = fs.readdirSync(BP_DIR + '/blocks').filter(f => f.endsWith('.json')); } catch (e) { /* 目录缺失 */ }
  bpFiles.sort();
  for (const file of bpFiles) {
    const full = path.join(BP_DIR, 'blocks', file);
    const j = readJson(full);
    if (j.__error || !j['minecraft:block']) continue;
    const desc = j['minecraft:block'].description || {};
    const id = desc.identifier || file;
    const info = collectBlockInfo(j);
    const geos = [...info.geometries];
    const texs = [...info.textures];
    if (geos.length === 0 && texs.length === 0) continue;
    blocks.push({
      file,
      id,
      geometries: geos,
      textures: texs,
      renderMethods: [...info.renderMethods],
      transforms: [...info.transforms],
      materialInstances: info.materialInstances,
      states: desc.states ? Object.keys(desc.states) : [],
    });
    for (const g of geos) {
      if (!geometryMap.has(g)) geometryMap.set(g, []);
      const firstRender = [...info.renderMethods][0] || null;
      for (const t of texs) {
        geometryMap.get(g).push({ blockId: id, texture: t, renderMethod: firstRender });
      }
    }
  }

  // 几何标识符映射，去重（同 block+texture 只留一次）
  const geoObj = {};
  for (const [g, arr] of geometryMap) {
    const seen = new Set();
    geoObj[g] = arr.filter(x => {
      const k = x.blockId + '|' + x.texture;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  return {
    generatedAt: Date.now(),
    modelCount: models.length,
    blockCount: blocks.length,
    modelDir: 'models/blocks',
    ghostTexDir: 'textures/blocks/ghost',
    models,
    blocks,
    geometryMap: geoObj,
  };
}

// ---------- 静态文件服务 ----------

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + filePath);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// 安全地解析 /rp/... 与 /bp/... 子路径，防止目录穿越
function resolveSub(root, sub) {
  const p = path.normalize(path.join(root, sub));
  if (!p.startsWith(path.normalize(root + path.sep)) && p !== path.normalize(root)) return null;
  return p;
}

// ---------- 编辑器保存 ----------

const TERRAIN_FILE = path.join(RP_DIR, 'textures', 'terrain_texture.json');

// 清理文件名，仅保留安全字符
function safeName(s) {
  return String(s || '').replace(/[^a-zA-Z0-9_.-]/g, '');
}

// 在 terrain_texture.json 注册纹理（不存在才加），返回是否变更
function registerTerrainTextures(names) {
  let terrain;
  try {
    terrain = JSON.parse(fs.readFileSync(TERRAIN_FILE, 'utf8'));
  } catch (e) {
    return { changed: false, error: '读取 terrain_texture.json 失败: ' + (e && e.message || e) };
  }
  const data = terrain.texture_data || (terrain.texture_data = {});
  let changed = false;
  for (const raw of names) {
    const name = String(raw || '').replace(/[^a-zA-Z0-9_]/g, '');
    if (!name) continue;
    if (data[name]) continue;
    data[name] = { textures: 'textures/blocks/ghost/' + name };
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(TERRAIN_FILE, JSON.stringify(terrain, null, 2));
  }
  return { changed };
}

// 处理 /api/editor/save 请求体，落盘模型/方块 JSON、贴图 PNG、注册地形纹理
function saveEditorPayload(data) {
  const out = { ok: true, saved: [], errors: [] };

  // 1) 贴图 PNG（base64 → 文件）
  if (Array.isArray(data.textures)) {
    for (const t of data.textures) {
      const name = String(t.name || '').replace(/[^a-zA-Z0-9_]/g, '');
      if (!name || typeof t.base64 !== 'string') continue;
      try {
        const buf = Buffer.from(t.base64, 'base64');
        const file = path.join(GHOST_TEX_DIR, name + '.png');
        fs.writeFileSync(file, buf);
        out.saved.push(path.relative(REPO_ROOT, file));
      } catch (e) {
        out.errors.push('贴图 ' + name + ' 写入失败: ' + (e && e.message || e));
      }
    }
  }

  // 2) terrain_texture 注册
  if (Array.isArray(data.registerTextures) && data.registerTextures.length) {
    const r = registerTerrainTextures(data.registerTextures);
    if (r.error) out.errors.push(r.error);
    else if (r.changed) out.saved.push(path.relative(REPO_ROOT, TERRAIN_FILE));
  }

  // 3) 模型 JSON（minecraft:geometry）
  if (data.modelFile && data.model) {
    const file = path.join(MODELS_DIR, safeName(data.modelFile));
    try {
      fs.writeFileSync(file, JSON.stringify(data.model, null, 2));
      out.saved.push(path.relative(REPO_ROOT, file));
    } catch (e) {
      out.errors.push('模型写入失败: ' + (e && e.message || e));
    }
  }

  // 4) 方块 JSON（minecraft:block）
  if (data.blockFile && data.block) {
    const file = path.join(BP_DIR, 'blocks', safeName(data.blockFile));
    try {
      fs.writeFileSync(file, JSON.stringify(data.block, null, 2));
      out.saved.push(path.relative(REPO_ROOT, file));
    } catch (e) {
      out.errors.push('方块写入失败: ' + (e && e.message || e));
    }
  }

  out.ok = out.errors.length === 0;
  return out;
}

const port = Number(process.argv[2]) || 8123;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);

  if (pathname === '/' || pathname === '/index.html') {
    serveFile(res, path.join(TOOL_DIR, 'index.html'));
    return;
  }
  if (pathname === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(buildManifest()));
    return;
  }
  if (pathname === '/viewer.js') { serveFile(res, path.join(TOOL_DIR, 'viewer.js')); return; }
  if (pathname === '/style.css') { serveFile(res, path.join(TOOL_DIR, 'style.css')); return; }
  if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }

  // 编辑器保存：模型/方块 JSON + 贴图 PNG + terrain_texture 注册
  if (pathname === '/api/editor/save' && req.method === 'POST') {
    let body = '';
    let overflow = false;
    req.on('data', (c) => {
      body += c;
      if (body.length > 50 * 1024 * 1024) { overflow = true; req.destroy(); }
    });
    req.on('end', () => {
      if (overflow) {
        res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: '请求体过大' }));
        return;
      }
      let data;
      try {
        data = JSON.parse(body);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'JSON 解析失败: ' + (e && e.message || e) }));
        return;
      }
      const result = saveEditorPayload(data);
      res.writeHead(result.ok ? 200 : 500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    });
    return;
  }

  if (pathname.startsWith('/vendor/')) {
    const sub = pathname.slice('/vendor/'.length);
    serveFile(res, resolveSub(path.join(TOOL_DIR, 'vendor'), sub) || path.join(TOOL_DIR, 'vendor', 'x'));
    return;
  }
  if (pathname.startsWith('/rp/')) {
    const sub = pathname.slice('/rp/'.length);
    const p = resolveSub(RP_DIR, sub);
    if (!p) { res.writeHead(403); res.end('403'); return; }
    serveFile(res, p);
    return;
  }
  if (pathname.startsWith('/bp/')) {
    const sub = pathname.slice('/bp/'.length);
    const p = resolveSub(BP_DIR, sub);
    if (!p) { res.writeHead(403); res.end('403'); return; }
    serveFile(res, p);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found: ' + pathname);
});

server.listen(port, () => {
  console.log('LitematicaBE 模型查看器');
  console.log('  模型目录: ' + MODELS_DIR);
  console.log('  幽灵纹理: ' + GHOST_TEX_DIR);
  console.log('  打开:     http://localhost:' + port + '/');
});
