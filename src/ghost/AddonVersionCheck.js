/**
 * addon（BP/RP）与插件运行时索引的版本一致性校验
 *
 * 校验两侧：
 *   1. **数据侧**：插件 `data/ghost_index.json` 的 addonVersion/bpUuid/rpUuid
 *      必须与构建期写下的 `data/addon_expected.json` 一致（即"索引与代码同批"）。
 *   2. **部署侧**：服务端 `behavior_packs/` 里确实存在 header.uuid = bpUuid 的包，
 *      且版本等于期望版本。
 *      顺带看 `worlds/<世界>/world_behavior_packs.json` 有没有引用它。
 */

const fs = require('fs');
const path = require('path');

const MANIFEST_SCAN_DEPTH = 3;

/** 主版本数组比较：不足位补 0，逐位比 */
function versionEq(a, b) {
    const x = Array.isArray(a) ? a : [];
    const y = Array.isArray(b) ? b : [];
    const n = Math.max(x.length, y.length);
    for (let i = 0; i < n; i++) {
        if ((x[i] || 0) !== (y[i] || 0)) return false;
    }
    return true;
}

function vstr(v) {
    return Array.isArray(v) ? v.join('.') : (v === undefined || v === null ? '?' : String(v));
}

/** 小补丁：宽松 JSON：容忍注释与尾随逗号 */
function stripBom(s) {
    return s && s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
}

/** 第一遍：去掉字符串字面量之外的 // 与 /* *\/ 注释 */
function stripComments(s) {
    const out = [];
    let i = 0;
    const n = s.length;
    let inStr = false;
    let quote = '';
    while (i < n) {
        const c = s[i];
        if (inStr) {
            out.push(c);
            if (c === '\\') {          // 转义：原样吃掉下一个字符，避免把 \" 当成字符串结束
                i++;
                if (i < n) out.push(s[i]);
                i++;
                continue;
            }
            if (c === quote) inStr = false;
            i++;
            continue;
        }
        if (c === '"' || c === "'") { inStr = true; quote = c; out.push(c); i++; continue; }
        if (c === '/' && s[i + 1] === '/') {
            while (i < n && s[i] !== '\n') i++;
            continue;
        }
        if (c === '/' && s[i + 1] === '*') {
            i += 2;
            while (i < n && !(s[i] === '*' && s[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        out.push(c);
        i++;
    }
    return out.join('');
}

/** 第二遍：去掉 `,}` 与 `,]` 前的尾随逗号（必须在去注释之后做，否则 `,//注释\n}` 判不出来） */
function removeTrailingCommas(s) {
    const out = [];
    let i = 0;
    const n = s.length;
    let inStr = false;
    let quote = '';
    while (i < n) {
        const c = s[i];
        if (inStr) {
            out.push(c);
            if (c === '\\') {
                i++;
                if (i < n) out.push(s[i]);
                i++;
                continue;
            }
            if (c === quote) inStr = false;
            i++;
            continue;
        }
        if (c === '"' || c === "'") { inStr = true; quote = c; out.push(c); i++; continue; }
        if (c === ',') {
            let j = i + 1;
            while (j < n && /\s/.test(s[j])) j++;
            if (s[j] === '}' || s[j] === ']') { i++; continue; }   // 尾随逗号，丢弃
        }
        out.push(c);
        i++;
    }
    return out.join('');
}

function stripCommentsAndTrailingCommas(s) {
    return removeTrailingCommas(stripComments(s));
}

/** 先严格解析，失败再按 BDS 的宽松语法重试；两次都失败才抛 */
function looseJsonParse(text) {
    const src = stripBom(String(text === undefined || text === null ? '' : text));
    try { return JSON.parse(src); } catch (e) { /* 落到宽松解析 */ }
    return JSON.parse(stripCommentsAndTrailingCommas(src));
}

class AddonVersionCheck {
    /**
     * @param {{logger?: object, serverRoot?: string, expectedPath?: string}} [opts]
     */
    constructor(opts) {
        const o = opts || {};
        this.logger = o.logger || null;
        this.serverRoot = o.serverRoot || process.cwd();
        this.expectedPath = o.expectedPath || null;
        this.expectedCandidates = Array.isArray(o.expectedCandidates) ? o.expectedCandidates : null;
        this.expected = null;
        this.expectedSource = null;
        /** 扫目录时解析失败的包（无关包居多，如原版 chemistry 的 manifest 带 // 注释） */
        this.skipped = [];
        this.report = {
            state: 'unknown',
            enabled: true,
            issues: [],
            expected: null,
            index: null,
            deployed: { bp: null, rp: null },
            worldRefs: [],
            serverRootUsable: false,
        };
    }

    _warn(msg) {
        try {
            if (this.logger && this.logger.warn) this.logger.warn(`[AddonCheck] ${msg}`);
        } catch (e) { /* 无 logger 时静默 */ }
    }

    _info(msg) {
        try {
            if (this.logger && this.logger.info) this.logger.info(`[AddonCheck] ${msg}`);
        } catch (e) { /* 无 logger 时静默 */ }
    }

    /**
     * 读 JSON：先严格、再宽松（容忍注释/尾随逗号）。
     * @param {string} p
     * @param {{quiet?: boolean, keepRaw?: boolean}} [opts]
     *        quiet=true 时不打 WARN，只记进 this.skipped（扫无关包时用，避免刷屏）
     */
    _readJson(p, opts) {
        const o = opts || {};
        if (!fs.existsSync(p)) return null;
        let raw = null;
        try {
            raw = fs.readFileSync(p, 'utf8');
        } catch (e) {
            if (!o.quiet) this._warn(`读取 ${p} 失败: ${e.message}`);
            else this.skipped.push({ path: p, error: e.message });
            return null;
        }
        try {
            return looseJsonParse(raw);
        } catch (e) {
            if (!o.quiet) this._warn(`解析 ${p} 失败: ${e.message}`);
            else this.skipped.push({ path: p, error: e.message });
            return null;
        }
    }

    /** 期望版本文件的多候选路径（与 GhostBlockRegistry 同样的容错策略） */
    _candidateExpectedPaths() {
        // 显式候选（测试用）优先，且不再追加默认路径 —— 否则测试环境会读到仓库里的真文件
        if (this.expectedCandidates) return this.expectedCandidates.slice();
        const list = [];
        if (this.expectedPath) list.push(this.expectedPath);
        list.push('./plugins/LitematicaBE/data/addon_expected.json');
        list.push('./data/addon_expected.json');
        try {
            if (typeof __dirname === 'string') {
                list.push(path.join(__dirname, '..', '..', 'data', 'addon_expected.json'));
            }
        } catch (e) { /* 无 __dirname 时跳过 */ }
        return list;
    }

    loadExpected() {
        for (const p of this._candidateExpectedPaths()) {
            const raw = this._readJson(p);
            if (raw && (raw.addonVersion || raw.version)) {
                this.expected = {
                    version: raw.addonVersion || raw.version,
                    bpUuid: raw.bpUuid || null,
                    rpUuid: raw.rpUuid || null,
                };
                this.expectedSource = p;
                return this.expected;
            }
        }
        this.expected = null;
        return null;
    }

    /** 递归找 manifest.json，按 header.uuid 匹配 */
    _findPack(baseDir, uuid, depth) {
        if (depth < 0) return null;
        let entries = [];
        try {
            entries = fs.readdirSync(baseDir, { withFileTypes: true });
        } catch (e) {
            return null;
        }
        // 先看本层（扫目录阶段一律 quiet：无关包解析失败不该刷 WARN）
        const mfPath = path.join(baseDir, 'manifest.json');
        const mf = this._readJson(mfPath, { quiet: true });
        if (mf && mf.header && (!uuid || String(mf.header.uuid).toLowerCase() === String(uuid).toLowerCase())) {
            return { path: mfPath, version: mf.header.version || [], uuid: mf.header.uuid || null };
        }
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            const r = this._findPack(path.join(baseDir, e.name), uuid, depth - 1);
            if (r) return r;
        }
        return null;
    }

    /** 世界里的 world_behavior_packs.json / world_resource_packs.json 引用情况 */
    _readWorldRefs(bpUuid, rpUuid) {
        const out = [];
        const worldsDir = path.join(this.serverRoot, 'worlds');
        let worlds = [];
        try {
            worlds = fs.readdirSync(worldsDir, { withFileTypes: true }).filter(d => d.isDirectory());
        } catch (e) {
            return out;
        }
        for (const w of worlds) {
            const wdir = path.join(worldsDir, w.name);
            for (const [file, uuid] of [['world_behavior_packs.json', bpUuid], ['world_resource_packs.json', rpUuid]]) {
                const p = path.join(wdir, file);
                if (!fs.existsSync(p)) continue;      // 文件不存在 = 这个世界没引用，不是解析失败
                const arr = this._readJson(p, { quiet: true });
                if (!Array.isArray(arr)) {
                    // 文件在但读不了：单独标记，避免误报成"世界没启用行为包"
                    out.push({ world: w.name, file, active: false, unparsable: true });
                    continue;
                }
                const hit = arr.some(it => {
                    const id = String((it && (it.pack_id || it.uuid)) || '').toLowerCase();
                    return uuid ? id === String(uuid).toLowerCase() : false;
                });
                out.push({ world: w.name, file, active: hit });
            }
        }
        return out;
    }

    /**
     * 执行校验
     * @param {object} indexStats GhostBlockRegistry.stats()
     * @returns {object} this.report
     */
    run(indexStats) {
        this.skipped = [];      // 每轮重新收集"解析失败的无关包"
        const issues = [];
        const report = {
            state: 'ok',
            enabled: true,
            issues,
            expected: null,
            index: null,
            deployed: { bp: null, rp: null },
            worldRefs: [],
            serverRootUsable: false,
            checkedAt: new Date().toISOString(),
        };

        // ── 数据侧：索引必须与构建期期望同批 ──
        const s = indexStats || {};
        const indexRec = {
            version: s.addonVersion || null,
            bpUuid: s.bpUuid || null,
            rpUuid: s.rpUuid || null,
        };
        report.index = indexRec;

        if (!s.ready) {
            issues.push({ level: 'error', code: 'index-not-ready', message: `ghost_index 未就绪：${s.loadError || '未知原因'}` });
            report.state = 'unavailable';
            report.enabled = false;
            this.report = report;
            return report;
        }

        const expected = this.loadExpected();
        if (!expected) {
            issues.push({
                level: 'warn',
                code: 'expected-missing',
                message: '缺少 data/addon_expected.json（构建期未生成或未随插件复制），改用索引自身作基准，校验收窄为「部署侧」',
            });
        } else {
            report.expected = expected;
            if (!versionEq(indexRec.version, expected.version)) {
                issues.push({
                    level: 'error',
                    code: 'index-version-mismatch',
                    message: `ghost_index 版本 ${vstr(indexRec.version)} ≠ 构建期望 ${vstr(expected.version)}（索引与插件代码不同批，需重跑 build_addon.js 并整目录复制）`,
                });
            }
            if (expected.bpUuid && indexRec.bpUuid && String(expected.bpUuid).toLowerCase() !== String(indexRec.bpUuid).toLowerCase()) {
                issues.push({ level: 'error', code: 'index-bpuuid-mismatch', message: `ghost_index bpUuid ${indexRec.bpUuid} ≠ 期望 ${expected.bpUuid}` });
            }
            if (expected.rpUuid && indexRec.rpUuid && String(expected.rpUuid).toLowerCase() !== String(indexRec.rpUuid).toLowerCase()) {
                issues.push({ level: 'error', code: 'index-rpuuid-mismatch', message: `ghost_index rpUuid ${indexRec.rpUuid} ≠ 期望 ${expected.rpUuid}` });
            }
        }

        // ── 部署侧：服务端是否真的装了这一版 ──
        const bpDir = path.join(this.serverRoot, 'behavior_packs');
        const rpDir = path.join(this.serverRoot, 'resource_packs');
        const hasBpDir = fs.existsSync(bpDir);
        const hasRpDir = fs.existsSync(rpDir);
        const hasWorlds = fs.existsSync(path.join(this.serverRoot, 'worlds'));
        report.serverRootUsable = hasBpDir || hasRpDir || hasWorlds;

        const wantBp = (expected && expected.bpUuid) || indexRec.bpUuid;
        const wantRp = (expected && expected.rpUuid) || indexRec.rpUuid;
        const wantVer = (expected && expected.version) || indexRec.version;

        if (!report.serverRootUsable) {
            issues.push({
                level: 'warn',
                code: 'server-root-unknown',
                message: `未在 ${this.serverRoot} 找到 behavior_packs/resource_packs/worlds，跳过部署校验（工作目录可能不是服务器根）`,
            });
        } else {
            if (wantBp) {
                report.deployed.bp = this._findPack(bpDir, wantBp, MANIFEST_SCAN_DEPTH);
            }
            if (!report.deployed.bp) {
                const skippedHint = this.skipped.length
                    ? `；另有 ${this.skipped.length} 个 manifest 无法解析（可能是注释/尾随逗号），已跳过`
                    : '';
                issues.push({
                    level: 'error',
                    code: 'server-bp-missing',
                    message: `behavior_packs/ 下找不到 uuid=${wantBp || '?'} 的行为包（addon 未部署到服务端，写 ghost 会变成未知方块）${skippedHint}`,
                });
            } else if (!versionEq(report.deployed.bp.version, wantVer)) {
                issues.push({
                    level: 'error',
                    code: 'server-bp-version-mismatch',
                    message: `服务端行为包版本 ${vstr(report.deployed.bp.version)} ≠ 期望 ${vstr(wantVer)}（${report.deployed.bp.path}）`,
                });
            }

            if (wantRp) {
                report.deployed.rp = this._findPack(rpDir, wantRp, MANIFEST_SCAN_DEPTH);
            }
            if (!report.deployed.rp) {
                issues.push({
                    level: 'warn',
                    code: 'server-rp-missing',
                    message: `resource_packs/ 下找不到 uuid=${wantRp || '?'} 的资源包（客户端侧仍需安装，否则看不到半透明 ghost）`,
                });
            } else if (!versionEq(report.deployed.rp.version, wantVer)) {
                issues.push({
                    level: 'warn',
                    code: 'server-rp-version-mismatch',
                    message: `服务端资源包版本 ${vstr(report.deployed.rp.version)} ≠ 期望 ${vstr(wantVer)}（${report.deployed.rp.path}）`,
                });
            }

            report.worldRefs = this._readWorldRefs(wantBp, wantRp);
            const bpRefs = report.worldRefs.filter(r => r.file === 'world_behavior_packs.json');
            const badRefs = bpRefs.filter(r => r.unparsable);
            if (badRefs.length) {
                issues.push({
                    level: 'warn',
                    code: 'world-ref-unparsable',
                    message: `${badRefs[0].world} 的 ${badRefs[0].file} 无法解析（JSON 语法问题），无法确认行为包是否启用；请检查该文件`,
                });
            }
            if (hasWorlds && !bpRefs.length) {
                issues.push({
                    level: 'warn',
                    code: 'world-not-activated',
                    message: 'worlds/ 下没有任何世界写入 world_behavior_packs.json（世界设置里勾选该行为包）',
                });
            } else if (bpRefs.length && !bpRefs.some(r => r.active) && !badRefs.length) {
                issues.push({
                    level: 'warn',
                    code: 'world-not-activated',
                    message: '没有世界在 world_behavior_packs.json 里启用该行为包（世界设置里勾选资源包/行为包）',
                });
            }
        }

        const errors = issues.filter(i => i.level === 'error');
        const warns = issues.filter(i => i.level === 'warn');
        report.state = errors.length ? 'error' : (warns.length ? 'warn' : 'ok');
        report.enabled = errors.length === 0;

        this.report = report;
        this._log(report);
        return report;
    }

    _log(report) {
        const idx = report.index || {};
        if (this.skipped.length) {
            const names = this.skipped.slice(0, 3).map(s => path.basename(path.dirname(s.path)));
            const more = this.skipped.length > 3 ? ` 等 ${this.skipped.length} 个` : '';
            this._info(`跳过 ${this.skipped.length} 个无法解析的 manifest（${names.join(', ')}${more}；与本包校验无关）`);
        }
        if (report.state === 'ok') {
            this._info(`addon 版本一致：${vstr(idx.version)}（索引 ${report.expected ? '与构建期望同批' : '无期望文件'}；服务端 BP ${report.deployed.bp ? '已部署' : '未校验'}）`);
            return;
        }
        if (report.state === 'unavailable') {
            this._warn(`ghost 子系统不可用，跳过版本校验：${(report.issues[0] || {}).message || ''}`);
            return;
        }
        for (const i of report.issues) {
            if (i.level === 'error') this._warn(`版本校验失败 [${i.code}] ${i.message}`);
            else this._warn(`版本校验提示 [${i.code}] ${i.message}`);
        }
        if (!report.enabled) {
            this._warn('已禁用 ghost 写入（/litematica:ghost lay|undo|restore 与自动补齐），投影与其它功能不受影响');
            this._warn('修复：重跑 node tools/build_addon.js --pack → 用新 .mcaddon 重装客户端 → 把 addon/LitematicaBE_BP|RP 覆盖到服务器并重启');
        }
    }

    /** ghost 写入是否放行 */
    isEnabled() {
        return this.report.enabled !== false;
    }

    /** 给命令/日志用的一句话状态 */
    summaryText() {
        const r = this.report;
        const idx = vstr(r.index && r.index.version);
        if (r.state === 'ok') return `§a一致 §7(addon ${idx})`;
        if (r.state === 'unavailable') return '§7未就绪';
        const first = r.issues.find(i => i.level === 'error') || r.issues[0];
        const head = r.enabled ? '§e告警' : '§c不一致';
        return `${head} §7(addon ${idx}) ${first ? first.message : ''}`;
    }

    summary() {
        const r = this.report;
        return {
            state: r.state,
            enabled: r.enabled,
            expected: r.expected,
            index: r.index,
            deployed: r.deployed,
            issues: r.issues,
            serverRootUsable: r.serverRootUsable,
            expectedSource: this.expectedSource,
            checkedAt: r.checkedAt,
        };
    }
}

module.exports = { AddonVersionCheck, versionEq, vstr, looseJsonParse, stripCommentsAndTrailingCommas };
