import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;

function readJson(file) {
    return JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'));
}

function fail(messages) {
    for (const m of messages) console.error(`[version] ${m}`);
    process.exit(1);
}

const pkg = readJson('package.json');
const tag = process.argv[2] || '';
const version = (tag || pkg.version).replace(/^v/, '');
const errors = [];

if (!VERSION_RE.test(version)) errors.push(`版本号不是 SemVer 2.0.0：${version}`);

const manifest = readJson('manifest.json');
const tooth = readJson('tooth.json');

if (pkg.version !== version) errors.push(`package.json 版本 ${pkg.version} ≠ ${version}`);
if (manifest.version !== version) errors.push(`manifest.json 版本 ${manifest.version} ≠ ${version}`);
if (tooth.version !== version) errors.push(`tooth.json 版本 ${tooth.version} ≠ ${version}`);

// index.js 里的 PLUGIN_VERSION 是运行时实际打印/展示的版本（BDS 启动日志 "正在加载 LitematicaBE vX"），
// 它和上面三处不同步过一次（3.0.1 发布在即却仍是 3.0.0），排查线上问题时被误当成 manifest 版本。
const INDEX_SRC = readFileSync(path.join(ROOT, 'index.js'), 'utf8');
const m = INDEX_SRC.match(/const\s+PLUGIN_VERSION\s*=\s*['"]([^'"]+)['"]/);
if (!m) {
    errors.push('index.js 里找不到 PLUGIN_VERSION 常量');
} else if (m[1] !== version) {
    errors.push(`index.js 的 PLUGIN_VERSION ${m[1]} ≠ ${version}`);
}

// ─────────────── 第 5 处版本：ll.registerPlugin 的数字三元组 ───────────────
// legacy-script-engine 在注册插件时会把 `ll.registerPlugin(name, desc, [x,y,z], {})` 的
// 版本**回写进 plugins/LitematicaBE/manifest.json**（写成 `x.y.z`，丢弃 -prerelease 后缀）。
// 历史上这里是写死的 `[3, 0, 0]`，于是每次启动清单都被刷回 3.0.0，与 PLUGIN_VERSION 3.0.3-test.6
// 对不上，被误判成"清单被改过"。规则：必须从 PLUGIN_VERSION 派生，不许出现数字字面量。
const HARDCODED = /ll\.registerPlugin\s*\(\s*['"][^'"]*['"]\s*,\s*['"][\s\S]{0,400}?['"]\s*,\s*\[\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\]/;
if (HARDCODED.test(INDEX_SRC)) {
    errors.push('ll.registerPlugin 的版本不能写死数字数组：LSE 会把它回写成 manifest.version（应从 PLUGIN_VERSION 派生）');
}
if (!/const\s+PLUGIN_VERSION_TUPLE\s*=\s*PLUGIN_VERSION\.split\(/.test(INDEX_SRC)) {
    errors.push('index.js 缺少从 PLUGIN_VERSION 派生的 PLUGIN_VERSION_TUPLE');
}
if (!/ll\.registerPlugin\s*\([\s\S]{0,400}?PLUGIN_VERSION_TUPLE[\s\S]{0,200}?\)/.test(INDEX_SRC)) {
    errors.push('ll.registerPlugin 的第三个参数必须是 PLUGIN_VERSION_TUPLE');
}

const changelog = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
if (!new RegExp(`^## \\[${escaped}\\]`, 'm').test(changelog)) {
    errors.push(`CHANGELOG.md 缺少 "## [${version}]" 段落`);
}

// ─────────────────────── addon 版本（独立于插件版本）───────────────────────
// addon 版本不走 SemVer 的插件版本号，但它自己必须在五处同值，否则客户端装了旧包、
// 插件写新 ghost ID 会失败（setBlock 返回 false → pending 无限重试）。
// 这里把「BP/RP manifest + 运行时索引 + 构建期望 + manifest 描述文本 + uuid」一次性校验，
// 避免再次出现 header.version 已经升级、description 里还停在旧版本这种漂移。
const ghostIndex = readJson('resources/data/ghost_index.json');
const addonExpected = readJson('resources/data/addon_expected.json');
const bpManifest = readJson('resources/addon/LitematicaBE_BP/manifest.json');
const rpManifest = readJson('resources/addon/LitematicaBE_RP/manifest.json');

const addonVersion = (addonExpected.addonVersion || []).join('.');
const isAddon = (v) => Array.isArray(v) && v.join('.') === addonVersion;

if (!VERSION_RE.test(addonVersion)) errors.push(`addon 版本号不合法：${addonVersion}`);
if (!isAddon(ghostIndex.addonVersion)) {
    errors.push(`ghost_index.json 的 addonVersion ${(ghostIndex.addonVersion || []).join('.')} ≠ ${addonVersion}`);
}
for (const [label, mf] of [['BP', bpManifest], ['RP', rpManifest]]) {
    if (!isAddon(mf.header && mf.header.version)) {
        errors.push(`${label} manifest 的 header.version ${((mf.header && mf.header.version) || []).join('.')} ≠ ${addonVersion}`);
    }
    for (const mod of mf.modules || []) {
        if (!isAddon(mod.version)) {
            errors.push(`${label} manifest 的 modules[].version ${(mod.version || []).join('.')} ≠ ${addonVersion}`);
        }
    }
    const desc = (mf.header && mf.header.description) || '';
    const hit = desc.match(/addon\s*版本\s*([\d.]+)/);
    if (hit && hit[1] !== addonVersion) {
        errors.push(`${label} manifest 的 description 写着 ${hit[1]} ≠ ${addonVersion}`);
    }
}
if (addonExpected.bpUuid !== ghostIndex.bpUuid || ghostIndex.bpUuid !== (bpManifest.header && bpManifest.header.uuid)) {
    errors.push('bpUuid 不一致：addon_expected / ghost_index / BP manifest');
}
if (addonExpected.rpUuid !== ghostIndex.rpUuid || ghostIndex.rpUuid !== (rpManifest.header && rpManifest.header.uuid)) {
    errors.push('rpUuid 不一致：addon_expected / ghost_index / RP manifest');
}

if (errors.length) fail(errors);

console.log(`[version] OK ${version}${tag ? ` (tag ${tag})` : ''}  |  addon ${addonVersion}`);
