import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { collectDir, writeZip } from './zip.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'build');
const ADDON = path.join(ROOT, 'resources', 'addon');
const RUNTIME = path.join(ROOT, 'resources', 'data');

const PLUGIN_FILES = ['index.js', 'config.json', 'manifest.json', 'package.json', 'LICENSE', 'README.md'];
const RUNTIME_FILES = ['ghost_index.json', 'addon_expected.json'];

function fail(message) {
    console.error(`[build] ${message}`);
    process.exit(1);
}

function readJson(rel) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
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
