#!/usr/bin/env node
/**
 * sync-version.mjs — 插件版本唯一写源（SSOT）与统一复写工具
 *
 * 唯一真源：index.js 的 `const PLUGIN_VERSION = 'x.y.z'`。
 * 一次命令复写整个项目的插件版本载体：
 *   1. index.js        PLUGIN_VERSION = 'x.y.z'（传入新版本时改写；不传则以现有值为准）
 *   2. package.json    version
 *   3. manifest.json   version
 *   4. tooth.json      version
 *
 * 派生项自动跟随、无需手改：
 *   - PLUGIN_VERSION_TUPLE   （PLUGIN_VERSION.split('-')[0].split('.').slice(0,3)）
 *   - PLUGIN_VERSION_CORE    （三元组 join）
 *   - ll.registerPlugin 第三参数（PLUGIN_VERSION_TUPLE）
 *
 * addon 版本（resources/data/*.json、BP/RP manifest 共五处）是独立版本轴，
 * 不归本工具管：node work/bump_addon_version.js <x.y.z>
 *
 * 用法：
 *   node tools/sync-version.mjs                  以 index.js 现有 PLUGIN_VERSION 为准，回写三份清单
 *   node tools/sync-version.mjs 3.1.0            升级：index.js 与三份清单一并写为 3.1.0
 *   node tools/sync-version.mjs v3.1.0           同上（可带 v 前缀）
 *   node tools/sync-version.mjs 3.1.0 --dry      只预览将改动的行，不落盘
 *   node tools/sync-version.mjs 3.1.0 --no-check 跳过写后自动校验
 *
 * 写后默认自动运行 tools/check-version.mjs，校验四份字符串版本 + 第 5 处三元组
 * （PLUGIN_VERSION_TUPLE）+ CHANGELOG 段落；任一不过即非零退出。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 与 check-version.mjs 保持一致：允许 `3.0.3-test.6` 这类 prerelease 后缀
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;

const JSON_FILES = ['package.json', 'manifest.json', 'tooth.json'];

function readText(rel) {
    return readFileSync(path.join(ROOT, rel), 'utf8');
}

function writeText(rel, text) {
    writeFileSync(path.join(ROOT, rel), text, 'utf8');
}

function readPluginVersion() {
    const src = readText('index.js');
    const m = src.match(/(const\s+PLUGIN_VERSION\s*=\s*)['"]([^'"]+)['"]/);
    return m ? m[2] : null;
}

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const targets = argv.filter((a) => !a.startsWith('--'));
const DRY = flags.has('--dry');
const NO_CHECK = flags.has('--no-check');

if (flags.has('--help') || flags.has('-h')) {
    console.log(`用法：
  node tools/sync-version.mjs                  以 index.js 的 PLUGIN_VERSION 为准，回写 package.json / manifest.json / tooth.json
  node tools/sync-version.mjs 3.1.0            升级版本：index.js + 三份清单一并写为 3.1.0
  node tools/sync-version.mjs v3.1.0 --dry     只预览，不落盘
  node tools/sync-version.mjs 3.1.0 --no-check 跳过写后自动校验`);
    process.exit(0);
}

if (targets.length > 1) {
    console.error('[version:sync] ✗ 只接受一个版本参数，收到：' + targets.join(', '));
    process.exit(1);
}

const current = readPluginVersion();
if (!current) {
    console.error('[version:sync] ✗ index.js 里找不到 PLUGIN_VERSION 常量');
    process.exit(1);
}
if (!VERSION_RE.test(current)) {
    console.error(`[version:sync] ✗ index.js 的 PLUGIN_VERSION 不是合法 SemVer：${current}`);
    process.exit(1);
}

let target = current;
if (targets[0]) {
    target = targets[0].replace(/^v/, '');
    if (!VERSION_RE.test(target)) {
        console.error(`[version:sync] ✗ 版本不合法（需形如 3.1.0 或 3.0.3-test.6）：${targets[0]}`);
        process.exit(1);
    }
}

const changes = [];

// ── 1) index.js：PLUGIN_VERSION 字符串（唯一真源） ──
if (target !== current) {
    const src = readText('index.js');
    const replaced = src.replace(
        /(const\s+PLUGIN_VERSION\s*=\s*)['"][^'"]*['"]/,
        `$1'${target}'`,
    );
    if (replaced === src) {
        console.error('[version:sync] ✗ index.js 的 PLUGIN_VERSION 未被替换（正则未命中）');
        process.exit(1);
    }
    changes.push(['index.js', current, target]);
    if (!DRY) writeText('index.js', replaced);
}

// ── 2) 三份清单：仅替换 version 字段，保留原缩进/键序/换行风格 ──
for (const rel of JSON_FILES) {
    const text = readText(rel);
    let obj;
    try {
        obj = JSON.parse(text);
    } catch (e) {
        console.error(`[version:sync] ✗ ${rel} 不是合法 JSON：${e.message}`);
        process.exit(1);
    }
    const old = obj.version;
    if (old === target) {
        console.log(`[version:sync] · ${rel} 已是 ${target}，跳过`);
        continue;
    }
    // 只替换第一个 `"version": "..."`（三份文件均只有一个顶层 version 键），
    // 锚定行首缩进，完全不重排文件其余字节。
    const replaced = text.replace(/(\n[ \t]*"version"[ \t]*:[ \t]*)"[^"]*"/, `$1"${target}"`);
    if (replaced === text) {
        console.error(`[version:sync] ✗ ${rel} 未找到可替换的 version 字段`);
        process.exit(1);
    }
    // 写前自检：替换后仍是合法 JSON 且 version 正确
    try {
        const probe = JSON.parse(replaced);
        if (probe.version !== target) throw new Error(`写后 version=${probe.version}`);
    } catch (e) {
        console.error(`[version:sync] ✗ ${rel} 替换结果自检失败：${e.message}`);
        process.exit(1);
    }
    changes.push([rel, old, target]);
    if (!DRY) writeText(rel, replaced);
}

if (!changes.length) {
    console.log(`[version:sync] · 全部已是最新 ${target}，无需改动`);
} else {
    for (const [file, from, to] of changes) {
        console.log(`[version:sync] ${DRY ? '预览' : '写入'} ${file}: ${from} → ${to}`);
    }
    if (DRY) {
        console.log(`[version:sync] （--dry，未落盘）目标版本 ${target}`);
    } else {
        console.log(`[version:sync] ✓ 完成，插件版本 ${target}`);
    }
    console.log('[version:sync] 派生项 PLUGIN_VERSION_TUPLE / PLUGIN_VERSION_CORE / ll.registerPlugin 自动跟随，无需手改。');
    console.log('[version:sync] addon 五处版本独立：node work/bump_addon_version.js <x.y.z>');
}

// ── 3) 写后自动校验 ──
if (!DRY && !NO_CHECK) {
    console.log('[version:sync] 运行 tools/check-version.mjs 校验 …');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'check-version.mjs')], {
        stdio: 'inherit',
        cwd: ROOT,
    });
    if (r.status !== 0) {
        console.error('[version:sync] ✗ 校验未通过。若提示 CHANGELOG 缺少段落，');
        console.error(`[version:sync]   请在 CHANGELOG.md 补 "## [${target}]" 段落后再运行一次。`);
        process.exit(r.status ?? 1);
    }
}
