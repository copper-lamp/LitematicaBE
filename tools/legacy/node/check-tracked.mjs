#!/usr/bin/env node
/**
 * check-tracked.mjs — 确保「代码引用的文件」都在仓库里
 *
 * 背景（2026-11-14 CI 事故）：`.gitignore` 用 `/tools/*` 白名单制忽略整个 tools/ 目录，
 * 只对三个 .mjs 开了例外。后来 `tools/build-release.mjs` 新增了对 `tools/lib/png.js`
 * 的依赖，而例外没跟上 —— 本地一切正常（文件在磁盘上），CI 的干净检出里根本没有这个文件，
 * 于是 `npm test` 直接 MODULE_NOT_FOUND 崩掉三个脚本，`Build release artifacts` 也会崩。
 *
 * 本脚本做三件事：
 *   1. 扫出所有已跟踪的 .js/.mjs 里的项目内 require（相对路径 / path.join(PLUGIN|ROOT|__dirname, ...)），
 *      逐个解析到磁盘，若文件存在但**不在 git 索引里**（= 被忽略 / 忘了 add）就报错；
 *      引用了既不存在也未跟踪的模块同样报错。
 *   2. 检查 `package.json` 的 scripts 与 `.github/workflows/*.yml` 里点名的 `tools/*.mjs` 是否已跟踪
 *      —— 这类入口没人 require，只能从调用文本里发现（`tools/sync-version.mjs` 就是这么漏的）。
 *   3. 断言构建/运行期必需的关键资源（ghost_index / addon manifest / 图标 / 清单元数据）已被跟踪。
 *
 * 只在需要仓库真相时运行（CI 的 checkout 有 .git）；无 git 环境直接跳过并提示。
 *
 * 运行：node tools/check-tracked.mjs
 * 退出码：0 全部就绪；1 有缺失；0 且带 SKIP 提示表示没有 git 环境
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 仓库根相对的 POSIX 路径（git 的记法） */
const rel = (abs) => path.relative(ROOT, abs).replace(/\\/g, '/');

function gitLsFiles() {
    const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], {
        encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024,
    });
    return new Set(out.split('\0').filter(Boolean));
}

/** 项目内必需资源：缺一个就说明 .gitignore 或 add 出了纰漏 */
const REQUIRED_RESOURCES = [
    'index.js',
    'manifest.json',
    'package.json',
    'package-lock.json',
    'tooth.json',
    'config.json',
    'CHANGELOG.md',
    'resources/pack_icon.png',
    'resources/data/ghost_index.json',
    'resources/data/addon_expected.json',
    'resources/addon/LitematicaBE_BP/manifest.json',
    'resources/addon/LitematicaBE_RP/manifest.json',
    'resources/addon/LitematicaBE_RP/textures/terrain_texture.json',
];

/** 只扫这些范围内的已跟踪文件（其余如 resources 的 5000 个模型不必扫） */
const SCAN_PREFIXES = ['index.js', 'src/', 'tools/', 'tests/'];

/** 把 require 的目标解析成真实文件（补扩展名 / index.js） */
function resolveFile(abs) {
    const tries = [abs, `${abs}.js`, `${abs}.mjs`, `${abs}.cjs`, `${abs}.json`,
        path.join(abs, 'index.js'), path.join(abs, 'index.mjs')];
    for (const t of tries) {
        try {
            if (fs.statSync(t).isFile()) return t;
        } catch { /* 继续试下一个 */ }
    }
    return null;
}

function main() {
    let tracked;
    try {
        tracked = gitLsFiles();
    } catch (e) {
        console.log('[tracked] SKIP：当前环境没有可用的 git（干净检出才会缺文件，无需校验）');
        return 0;
    }

    const errors = [];
    const scanned = [];
    const refs = [];

    // require('./x') / require("../y")
    const RE_PLAIN = /require\(\s*(['"])(\.{1,2}\/[^'"]*)\1\s*\)/g;
    // require(path.join(PLUGIN, 'a', 'b.js')) / require(path.join(__dirname, 'lib', 'png.js'))
    const RE_JOIN = /require\(\s*path\.join\(\s*(PLUGIN|ROOT|__dirname)\s*((?:,\s*['"][^'"]+['"])*)\s*\)/g;

    for (const file of tracked) {
        if (!/\.(?:js|mjs|cjs)$/.test(file)) continue;
        // 跳过自身：本文件里带 require 形式的文档示例，扫自己只会自伤
        if (file === 'tools/check-tracked.mjs') continue;
        if (!SCAN_PREFIXES.some((p) => file === p || file.startsWith(p)) && file !== 'index.js') continue;
        const abs = path.join(ROOT, file);
        let src;
        try {
            src = fs.readFileSync(abs, 'utf8');
        } catch {
            continue; // 索引里有、磁盘上没有（删除待提交）：由 git status 暴露，不在这里报
        }
        scanned.push(file)
        const lines = src.split(/\r?\n/);

        lines.forEach((line, i) => {
            for (const m of line.matchAll(RE_PLAIN)) {
                const target = resolveFile(path.resolve(path.dirname(abs), m[2]));
                refs.push({ file, line: i + 1, raw: m[2], target });
            }
            for (const m of line.matchAll(RE_JOIN)) {
                const base = m[1] === '__dirname' ? path.dirname(abs) : ROOT;
                const parts = [...m[2].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
                const target = resolveFile(path.join(base, ...parts));
                refs.push({ file, line: i + 1, raw: `path.join(${m[1]}, ${parts.map((p) => `'${p}'`).join(', ')})`, target });
            }
        });
    }

    for (const r of refs) {
        if (r.target) {
            const key = rel(r.target);
            if (!tracked.has(key)) {
                errors.push(`${r.file}:${r.line} 引用的 ${key} 存在于磁盘但未被 git 跟踪（被 .gitignore 忽略或漏 add）`);
            }
        } else {
            // 解析不到真实文件：可能是裸模块名以外的动态路径，按"引用缺失"报出，便于人工确认
            errors.push(`${r.file}:${r.line} 引用的 ${r.raw} 既不存在磁盘上、也不在 git 索引里`);
        }
    }

    // npm script / CI workflow 里直接点名的脚本：没人 require 它们，只能靠入口文本发现
    const assertEntry = (label, rawPath) => {
        const abs = resolveFile(path.join(ROOT, rawPath));
        if (!abs) {
            errors.push(`${label} 指向的 ${rawPath} 在磁盘上不存在`);
        } else if (!tracked.has(rel(abs))) {
            errors.push(`${label} 指向的 ${rel(abs)} 未被 git 跟踪（干净检出里 npm run 会 MODULE_NOT_FOUND）`);
        }
    };

    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
        for (const m of String(cmd).matchAll(/node\s+([A-Za-z0-9_.\-/]+\.(?:mjs|js))/g)) {
            assertEntry(`package.json scripts.${name}`, m[1]);
        }
    }

    const wfDir = path.join(ROOT, '.github', 'workflows');
    if (fs.existsSync(wfDir)) {
        for (const f of fs.readdirSync(wfDir)) {
            if (!/\.ya?ml$/.test(f)) continue;
            const src = fs.readFileSync(path.join(wfDir, f), 'utf8');
            for (const m of src.matchAll(/(tools\/[A-Za-z0-9_.\-/]+\.(?:mjs|js))/g)) {
                assertEntry(`.github/workflows/${f}`, m[1]);
            }
        }
    }

    for (const res of REQUIRED_RESOURCES) {
        if (!tracked.has(res)) errors.push(`必需资源未入库：${res}`);
        else if (!fs.existsSync(path.join(ROOT, res))) errors.push(`必需资源在磁盘上缺失：${res}`);
    }

    console.log(`[tracked] 已跟踪文件 ${tracked.size}，扫描脚本 ${scanned.length}，解析引用 ${refs.length}`);

    if (errors.length) {
        console.error(`[tracked] 发现 ${errors.length} 处问题（CI 的干净检出会在这里失败）：`);
        for (const e of errors) console.error(`  ✗ ${e}`);
        return 1;
    }
    console.log('[tracked] OK：被引用的脚本与关键资源都在仓库里');
    return 0;
}

process.exitCode = main();
