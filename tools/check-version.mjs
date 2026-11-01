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

const changelog = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
if (!new RegExp(`^## \\[${escaped}\\]`, 'm').test(changelog)) {
    errors.push(`CHANGELOG.md 缺少 "## [${version}]" 段落`);
}

if (errors.length) fail(errors);

console.log(`[version] OK ${version}${tag ? ` (tag ${tag})` : ''}`);
