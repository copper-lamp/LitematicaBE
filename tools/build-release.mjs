import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { collectDir, writeZip } from './zip.mjs';

// png.js 是 CommonJS（最小 PNG 编解码），用于 addon 自检的 ghost 贴图半透明验证
const require = createRequire(import.meta.url);
const png = require('./lib/png.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'build');
const ADDON = path.join(ROOT, 'resources', 'addon');
const RUNTIME = path.join(ROOT, 'resources', 'data');
const BP_DIR = path.join(ADDON, 'LitematicaBE_BP');
const RP_DIR = path.join(ADDON, 'LitematicaBE_RP');

const PLUGIN_FILES = ['index.js', 'config.json', 'manifest.json', 'package.json', 'LICENSE', 'README.md'];
const RUNTIME_FILES = ['ghost_index.json', 'addon_expected.json'];

function fail(message) {
    console.error(`[build] ${message}`);
    process.exit(1);
}

function readJson(rel) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

/** 读绝对路径 JSON（verifyAddon 用，避免与 readJson 的 ROOT 拼接冲突） */
function readJsonFile(p) {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function requirePath(target, label) {
    if (!fs.existsSync(target)) fail(`缺少 ${label}：${path.relative(ROOT, target)}`);
}

const pkg = readJson('package.json');
const version = pkg.version;
const manifest = readJson('manifest.json');
const tooth = readJson('tooth.json');

if (manifest.version !== version) fail(`manifest.json 版本 ${manifest.version} ≠ package.json ${version}`);
if (tooth.version !== version) fail(`tooth.json 版本 ${tooth.version} ≠ package.json ${version}`);

// index.js 的 PLUGIN_VERSION 是运行时真正展示的版本（启动日志 / 欢迎语 / 表单），
// 必须和清单同步，否则日志里会出现"加载 3.0.0"而 manifest 写 3.0.1 的错位。
const INDEX_SRC = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
const pluginVersionMatch = INDEX_SRC.match(/const\s+PLUGIN_VERSION\s*=\s*['"]([^'"]+)['"]/);
if (!pluginVersionMatch) fail('index.js 里找不到 PLUGIN_VERSION 常量');
if (pluginVersionMatch[1] !== version) {
    fail(`index.js 的 PLUGIN_VERSION ${pluginVersionMatch[1]} ≠ package.json ${version}`);
}

requirePath(path.join(ADDON, 'LitematicaBE_BP'), '行为包源码');
requirePath(path.join(ADDON, 'LitematicaBE_RP'), '资源包源码');
for (const file of RUNTIME_FILES) requirePath(path.join(RUNTIME, file), '运行时索引');

/** 版本数组比较：不足位补 0，逐位比 */
function versionEq(a, b) {
    const x = Array.isArray(a) ? a : [];
    const y = Array.isArray(b) ? b : [];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if ((x[i] || 0) !== (y[i] || 0)) return false;
    }
    return true;
}

// addon 版本必须三处一致：构建期望、运行时索引、BP/RP 的 header.version
// 不一致时插件会禁用 ghost 写入（AddonVersionCheck），因此这里直接拦住发布
const expected = readJson('resources/data/addon_expected.json');
const wantAddonVersion = expected.addonVersion;
const addonVersionSources = [
    ['resources/data/ghost_index.json', readJson('resources/data/ghost_index.json').addonVersion],
    ['resources/addon/LitematicaBE_BP/manifest.json', readJson('resources/addon/LitematicaBE_BP/manifest.json').header.version],
    ['resources/addon/LitematicaBE_RP/manifest.json', readJson('resources/addon/LitematicaBE_RP/manifest.json').header.version],
];
for (const [label, got] of addonVersionSources) {
    if (!versionEq(got, wantAddonVersion)) {
        fail(`addon 版本不一致：${label} = ${(got || []).join('.')}，期望 ${(wantAddonVersion || []).join('.')}`);
    }
}

/** 插件目录条目（dest 为安装后的相对前缀） */
function pluginEntries(prefix) {
    const entries = [];
    for (const file of PLUGIN_FILES) {
        const full = path.join(ROOT, file);
        if (fs.existsSync(full)) entries.push({ name: `${prefix}${file}`, path: full });
    }
    entries.push(...collectDir(path.join(ROOT, 'src'), `${prefix}src/`));
    for (const file of RUNTIME_FILES) {
        entries.push({ name: `${prefix}data/${file}`, path: path.join(RUNTIME, file) });
    }

    const nodeModules = path.join(ROOT, 'node_modules');
    if (fs.existsSync(nodeModules)) {
        entries.push(...collectDir(nodeModules, `${prefix}node_modules/`));
    } else {
        console.warn('[build] 未找到 node_modules，产物将缺少 xlsx 依赖（CI 会先执行 npm ci）');
    }
    return entries;
}

const packEntries = (prefix, name) => collectDir(path.join(ADDON, name), prefix);

// ── addon 自检（移植自 tools/build_addon.js 的 verify()，适配当前 resources/addon 结构）──
// 把"客户端紫黑 / ghost 方块不透明 / 无法在 ghost 位置放置 / 版本错配"这类故障挡在交付前。
const GHOST_ALPHA_MEAN_MAX = 245;   // blend 材质贴图 alpha 均值上限（0.80 系数对应 204）
const BLOCK_FORMAT_MIN = [1, 21, 70]; // minecraft:replaceable 的官方最低 format_version

/** 版本数组比较：不足位补 0，逐位比（v >= min） */
function versionAtLeast(v, min) {
    for (let i = 0; i < min.length; i++) {
        const a = v[i] || 0, b = min[i];
        if (a > b) return true;
        if (a < b) return false;
    }
    return true;
}

/**
 * 校验 resources/addon 的 BP/RP 一致性。
 * 检查项：pack_icon、manifest 版本、format_version、replaceable、材质实例与
 * terrain_texture 引用、blend 贴图半透明、ghost_index 与 BP 定义一致、版本/uuid 一致。
 * @returns {string[]} 问题列表（空数组 = 通过）
 */
function verifyAddon() {
    const problems = [];
    const expected = readJson('resources/data/addon_expected.json');
    const want = (expected.addonVersion || []).join('.');

    for (const [label, dir] of [['BP', BP_DIR], ['RP', RP_DIR]]) {
        if (!fs.existsSync(path.join(dir, 'pack_icon.png'))) problems.push(`${label} 缺 pack_icon.png`);
        const mf = readJsonFile(path.join(dir, 'manifest.json'));
        const v = ((mf.header && mf.header.version) || []).join('.');
        if (v !== want) problems.push(`${label}/manifest.json 版本 ${v} ≠ ${want}`);
    }

    const tt = readJsonFile(path.join(RP_DIR, 'textures', 'terrain_texture.json'));
    const texData = tt.texture_data || {};
    const texKeys = new Set(Object.keys(texData));

    const identifiers = new Set();
    const blocksDir = path.join(BP_DIR, 'blocks');
    for (const f of fs.readdirSync(blocksDir)) {
        if (!f.endsWith('.json')) continue;
        const def = readJsonFile(path.join(blocksDir, f));
        const desc = (def['minecraft:block'] || {}).description;
        const comp = (def['minecraft:block'] || {}).components || {};
        if (!desc || !desc.identifier) { problems.push(`BP/${f} 缺 identifier`); continue; }
        identifiers.add(desc.identifier);

        const fv = String(def.format_version || '').split('.').map(Number);
        if (!versionAtLeast(fv, BLOCK_FORMAT_MIN)) {
            problems.push(`BP/${f} format_version ${def.format_version} < 1.21.70（minecraft:replaceable 不会生效）`);
        }
        if (!Object.prototype.hasOwnProperty.call(comp, 'minecraft:replaceable')) {
            problems.push(`BP/${f} 缺 minecraft:replaceable（玩家无法在 ghost 位置放置方块）`);
        }

        const mi = comp['minecraft:material_instances'] || {};
        if (Object.keys(mi).length === 0) { problems.push(`BP/${f} 缺 minecraft:material_instances`); continue; }
        for (const k of Object.keys(mi)) {
            const inst = mi[k];
            if (!inst || !inst.texture) { problems.push(`BP/${f} 材质 ${k} 缺 texture`); continue; }
            if (!texKeys.has(inst.texture)) { problems.push(`BP/${f} 材质 ${k} 引用 ${inst.texture} 不在 terrain_texture`); continue; }
            const rel = texData[inst.texture].textures;
            const texFile = path.join(RP_DIR, `${rel}.png`);
            if (typeof rel === 'string' && !fs.existsSync(texFile)) {
                problems.push(`BP/${f} 材质 ${k} 引用的贴图 ${rel}.png 不存在`);
                continue;
            }
            // 仅 blend 材质需要半透明；alpha_test 按阈值裁切，不强制
            if (inst.render_method === 'blend' && fs.existsSync(texFile)) {
                const stats = png.alphaStats(png.decode(fs.readFileSync(texFile)));
                if (stats.mean >= GHOST_ALPHA_MEAN_MAX) {
                    problems.push(`BP/${f} 材质 ${k} 贴图 ${rel} alpha 均值 ${stats.mean.toFixed(0)} >= ${GHOST_ALPHA_MEAN_MAX}（不半透明，检查 GHOST_ALPHA_FACTOR 或贴图源）`);
                }
            }
        }
    }

    const index = readJson('resources/data/ghost_index.json');
    for (const id of Object.keys(index.blocks || {})) {
        if (!identifiers.has(id)) problems.push(`ghost_index 的 ${id} 在 BP 里没有定义`);
    }
    if ((index.addonVersion || []).join('.') !== want) {
        problems.push(`ghost_index 版本 ${(index.addonVersion || []).join('.')} ≠ ${want}`);
    }
    if (expected.bpUuid !== index.bpUuid || expected.rpUuid !== index.rpUuid) {
        problems.push('addon_expected 的 uuid 与 ghost_index 不一致（插件会判定版本错配并禁用 ghost）');
    }

    return problems;
}

// 构建前先自检源：不通过则直接终止，避免产出带缺陷的包
{
    const addonProblems = verifyAddon();
    if (addonProblems.length) {
        fail(`addon 自检失败 ${addonProblems.length} 项：\n  - ${addonProblems.join('\n  - ')}`);
    }
    console.log('[build] addon 自检通过：pack_icon / 版本 / replaceable / 材质引用 / blend 半透明 / ghost_index');
}

fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });

const serverZip = path.join(BUILD, `LitematicaBE-server-${version}.zip`);
writeZip(serverZip, [
    ...pluginEntries('plugin/'),
    ...packEntries('packs/LitematicaBE_BP/', 'LitematicaBE_BP'),
    ...packEntries('packs/LitematicaBE_RP/', 'LitematicaBE_RP'),
]);

const clientZip = path.join(BUILD, `LitematicaBE-client-${version}.zip`);
writeZip(clientZip, [
    ...packEntries('resource_packs/LitematicaBE_RP/', 'LitematicaBE_RP'),
    ...packEntries('behavior_packs/LitematicaBE_BP/', 'LitematicaBE_BP'),
]);

// mcaddon 直接由入库的 BP/RP 打包，避免与 zip 产物出现版本漂移
const mcaddonTarget = path.join(BUILD, `LitematicaBE-client-${version}.mcaddon`);
const mcaddonRoot = `LitematicaBE-${expected.addonVersion.join('.')}/`;
writeZip(mcaddonTarget, [
    ...packEntries(`${mcaddonRoot}BP/`, 'LitematicaBE_BP'),
    ...packEntries(`${mcaddonRoot}RP/`, 'LitematicaBE_RP'),
]);

const legacyZip = path.join(BUILD, `LitematicaBE-${version}.zip`);
writeZip(legacyZip, [
    ...pluginEntries('plugins/LitematicaBE/'),
    ...packEntries('LitematicaBE-server-BP/', 'LitematicaBE_BP'),
    ...packEntries('LitematicaBE-server-RP/', 'LitematicaBE_RP'),
    { name: `LitematicaBE-client-${version}.mcaddon`, path: mcaddonTarget },
]);

const sums = fs.readdirSync(BUILD)
    .filter((name) => name !== 'SHA256SUMS.txt')
    .sort()
    .map((name) => {
        const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(BUILD, name))).digest('hex');
        return `${hash}  ${name}`;
    });
fs.writeFileSync(path.join(BUILD, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);

for (const name of [serverZip, clientZip, legacyZip, mcaddonTarget].map((p) => path.basename(p))) {
    const size = fs.statSync(path.join(BUILD, name)).size;
    console.log(`[build] ${name}  ${(size / 1024 / 1024).toFixed(2)} MB`);
}
console.log(`[build] 完成：${path.relative(ROOT, BUILD)}/`);
