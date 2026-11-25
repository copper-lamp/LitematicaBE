#!/usr/bin/env node
/**
 * bump_addon_version.js — 统一升级 addon 版本（唯一入口，别手改任何一处）
 *
 * 覆盖的每一处版本载体：
 *   1. resources/data/ghost_index.json        addonVersion   （运行时索引）
 *   2. resources/data/addon_expected.json     addonVersion   （构建期望）
 *   3. resources/addon/LitematicaBE_BP/manifest.json  header.version + modules[].version
 *   4. resources/addon/LitematicaBE_RP/manifest.json  header.version + modules[].version
 *   5. 上面两个 manifest 的 header.description 里 `addon 版本 x.y.z` 文本
 *      （历史上漏过一次：header.version 已经 1.1.4x，描述里还写着 1.1.18）
 *
 * 用法：node work/bump_addon_version.js 1.1.50
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NEW = process.argv[2];
if (!NEW) throw new Error('用法: node work/bump_addon_version.js 1.1.50');
const ver = NEW.split('.').map(Number);
if (ver.length !== 3 || ver.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error('版本需形如 1.1.50');
}

const files = [
    'resources/data/ghost_index.json',
    'resources/data/addon_expected.json',
    'resources/addon/LitematicaBE_BP/manifest.json',
    'resources/addon/LitematicaBE_RP/manifest.json',
];

let problems = 0;

for (const rel of files) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { console.error(`✗ 缺文件 ${rel}`); problems++; continue; }
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));

    if (j.header && Array.isArray(j.header.version)) {
        const old = j.header.version.join('.');
        j.header.version = ver;
        for (const m of j.modules || []) m.version = ver;
        let descNote = '';
        if (typeof j.header.description === 'string') {
            const before = j.header.description;
            j.header.description = before.replace(/addon\s*版本\s*\d+\.\d+\.\d+/g, `addon 版本 ${NEW}`);
            if (j.header.description !== before) descNote = '（description 同步）';
        }
        fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
        console.log(`${rel}: header ${old} -> ${NEW}（modules 同步）${descNote}`);
    } else {
        const old = Array.isArray(j.addonVersion) ? j.addonVersion.join('.') : String(j.addonVersion);
        j.addonVersion = ver;
        fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
        console.log(`${rel}: addonVersion ${old} -> ${NEW}`);
    }
}

// ── 收尾校验：四处 + 描述文本 + uuid 交叉核对，任何一处没跟上就非零退出 ──
const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources/data/ghost_index.json'), 'utf8'));
const exp = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources/data/addon_expected.json'), 'utf8'));
const bp = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources/addon/LitematicaBE_BP/manifest.json'), 'utf8'));
const rp = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources/addon/LitematicaBE_RP/manifest.json'), 'utf8'));

const eq = (v) => Array.isArray(v) && v.join('.') === NEW;
const checks = [
    ['ghost_index.addonVersion', eq(idx.addonVersion)],
    ['addon_expected.addonVersion', eq(exp.addonVersion)],
    ['BP header', eq(bp.header.version)],
    ['BP modules', (bp.modules || []).every((m) => eq(m.version))],
    ['RP header', eq(rp.header.version)],
    ['RP modules', (rp.modules || []).every((m) => eq(m.version))],
    ['RP description', !/addon\s*版本\s*\d+\.\d+\.\d+/.test(rp.header.description || '')
        || (rp.header.description.match(/addon\s*版本\s*(\d+\.\d+\.\d+)/) || [])[1] === NEW],
    ['BP description', !/addon\s*版本\s*\d+\.\d+\.\d+/.test(bp.header.description || '')
        || (bp.header.description.match(/addon\s*版本\s*(\d+\.\d+\.\d+)/) || [])[1] === NEW],
    ['bpUuid 与 manifest 一致', exp.bpUuid === idx.bpUuid && idx.bpUuid === bp.header.uuid],
    ['rpUuid 与 manifest 一致', exp.rpUuid === idx.rpUuid && idx.rpUuid === rp.header.uuid],
];

console.log('\n=== 版本一致性收尾校验 ===');
for (const [label, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (!ok) problems++;
}
if (problems) {
    console.error(`\n有 ${problems} 处不一致，检查后再交付`);
    process.exit(1);
}
console.log(`\n全部一致：addon ${NEW}`);
