// UpdateChecker — 启动时一次性版本检查（GitHub Release）

const DEFAULT_REPO = 'copper-lamp/LitematicaBE';
const DEFAULT_API_BASE = 'https://api.github.com';
const DEFAULT_HTML_BASE = 'https://github.com';
const DEFAULT_USER_AGENT = 'LitematicaBE-UpdateChecker/1.0';
const MAX_BODY_BYTES = 512 * 1024;

// 模块加载期完成 require（此时有 EngineScope）；回调里零 require。
let https = null;
let http = null;
try { https = require('https'); } catch (e) { https = null; }
try { http = require('http'); } catch (e) { http = null; }

// ═══════════════════════ 版本号 ═══════════════════════

/** 去掉 `v` 前缀与 `release/` 一类噪声 */
function stripVersionPrefix(input) {
    return String(input === undefined || input === null ? '' : input)
        .trim()
        .replace(/^release[-/_\s]*/i, '')
        .replace(/^[vV]/, '')
        .trim();
}

/**
 * 解析版本串（容忍 `v` 前缀、多余段、`-prerelease`、`+build`）。
 * @returns {{core: number[], pre: string[], valid: boolean}}
 */
function parseVersion(input) {
    const bare = stripVersionPrefix(input);
    const plus = bare.indexOf('+');
    const noBuild = plus >= 0 ? bare.slice(0, plus) : bare;
    const dash = noBuild.indexOf('-');
    const coreStr = (dash >= 0 ? noBuild.slice(0, dash) : noBuild).trim();
    const preStr = dash >= 0 ? noBuild.slice(dash + 1).trim() : '';

    const core = coreStr === ''
        ? [0]
        : coreStr.split('.').map((s) => {
            const n = parseInt(s, 10);
            return Number.isFinite(n) ? n : 0;
        });
    while (core.length < 3) core.push(0);

    const pre = preStr ? preStr.split('.').map((s) => s.trim()).filter((s) => s !== '') : [];
    return { core, pre, valid: /\d/.test(coreStr) };
}

/** prerelease 段比较（数字段 < 字母段；没有 prerelease 的最大） */
function comparePreSegments(a, b) {
    if (!a.length && !b.length) return 0;
    if (!a.length) return 1;
    if (!b.length) return -1;
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
        const x = a[i];
        const y = b[i];
        if (x === undefined) return -1;
        if (y === undefined) return 1;
        const xn = /^\d+$/.test(x);
        const yn = /^\d+$/.test(y);
        if (xn && yn) {
            const d = parseInt(x, 10) - parseInt(y, 10);
            if (d) return d > 0 ? 1 : -1;
        } else if (xn) {
            return -1;
        } else if (yn) {
            return 1;
        } else if (x !== y) {
            return x > y ? 1 : -1;
        }
    }
    return 0;
}

/**
 * 比较两个版本：a > b → 1，a < b → -1，相等 → 0。
 * `compareVersions('v3.2.0', '3.1.0') === 1`；`compareVersions('3.1.0', '3.1.0-test.1') === 1`。
 */
function compareVersions(a, b) {
    const va = parseVersion(a);
    const vb = parseVersion(b);
    const n = Math.max(va.core.length, vb.core.length);
    for (let i = 0; i < n; i++) {
        const d = (va.core[i] || 0) - (vb.core[i] || 0);
        if (d) return d > 0 ? 1 : -1;
    }
    return comparePreSegments(va.pre, vb.pre);
}

// ═══════════════════════ 响应解析 ═══════════════════════

/** 从 302 的 location 里抠 tag：…/releases/tag/v3.2.0 → v3.2.0 */
function parseRedirectTag(location) {
    const m = String(location || '').match(/\/releases\/tag\/([^/?#]+)/);
    if (!m) return '';
    try {
        return decodeURIComponent(m[1]);
    } catch (e) {
        return m[1];
    }
}

/** release 对象 → tag（过滤 draft / 预发布；`/releases/latest` 已预筛，列表要给镜像用） */
function pickTagFromRelease(rel) {
    if (!rel || typeof rel !== 'object') return '';
    if (rel.draft === true || rel.prerelease === true) return '';
    const tag = String(rel.tag_name || '').trim();
    if (!tag) return '';
    const v = parseVersion(tag);
    if (!v.valid || v.pre.length) return '';
    return tag;
}

/** 从一次响应里取出远端 tag；取不到给空串 */
function extractTag(res) {
    const status = res && typeof res.status === 'number' ? res.status : 0;
    const body = res && typeof res.body === 'string' ? res.body : '';
    const location = res && res.location ? String(res.location) : '';

    if (status >= 300 && status < 400) return parseRedirectTag(location);
    if (status < 200 || status >= 300) return '';

    let data = null;
    try {
        data = body ? JSON.parse(body) : null;
    } catch (e) {
        return '';   // 门户页 / HTML / 空响应
    }
    if (!data) return '';

    // 数组（镜像常透传 /releases 列表）：按 version 取最大的那一条
    if (Array.isArray(data)) {
        let best = '';
        for (const rel of data) {
            const tag = pickTagFromRelease(rel);
            if (tag && (!best || compareVersions(tag, best) > 0)) best = tag;
        }
        return best;
    }
    return pickTagFromRelease(data);
}

/** 失败原因的人话描述（只进 this.result.error，由调用方打日志） */
function describeFailure(res) {
    const status = res && typeof res.status === 'number' ? res.status : 0;
    if (status === 404) return 'HTTP 404（仓库或 release 不存在）';
    if (status === 403 || status === 429) return `HTTP ${status}（GitHub API 限流）`;
    if (status >= 300 && status < 400) return `HTTP ${status}（跳转里没有 releases/tag）`;
    if (status) return `HTTP ${status}`;
    return '响应无法解析';
}

// ═══════════════════════ HTTP ═══════════════════════

/**
 * 单次 GET。
 * @param {string} url
 * @param {{timeoutMs?: number, headers?: object, redirectsLeft?: number}} [opts]
 *   redirectsLeft 默认 3（自动跟随）；传 0 = 不跟随，直接返回 3xx 与 location。
 * @returns {Promise<{status:number, headers:object, location:string, body:string}>}
 */
function fetchOnce(url, opts) {
    const o = opts || {};
    const timeoutMs = Math.max(1000, Number(o.timeoutMs) || 8000);
    const redirectsLeft = typeof o.redirectsLeft === 'number' ? o.redirectsLeft : 3;

    return new Promise((resolve, reject) => {
        let parsed = null;
        try {
            parsed = new URL(url);
        } catch (e) {
            reject(new Error(`非法 URL: ${url}`));
            return;
        }
        const mod = parsed.protocol === 'https:' ? https : (parsed.protocol === 'http:' ? http : null);
        if (!mod || typeof mod.get !== 'function') {
            reject(new Error(`不支持的协议或运行时缺少对应模块: ${parsed.protocol}`));
            return;
        }

        let settled = false;
        const done = (fn, val) => {
            if (settled) return;
            settled = true;
            fn(val);
        };

        let req = null;
        try {
            req = mod.get(parsed, { headers: o.headers || {} }, (res) => {
                const status = res.statusCode || 0;
                const location = String(res.headers.location || '');

                if (status >= 300 && status < 400 && location && redirectsLeft > 0) {
                    try { res.resume(); } catch (e) { /* 忽略 */ }
                    let next = location;
                    try { next = new URL(location, parsed).toString(); } catch (e2) { /* 用原串 */ }
                    fetchOnce(next, Object.assign({}, o, { redirectsLeft: redirectsLeft - 1 }))
                        .then((r) => done(resolve, r), (e) => done(reject, e));
                    return;
                }

                const chunks = [];
                let size = 0;
                res.on('data', (c) => {
                    size += c.length;
                    if (size > MAX_BODY_BYTES) {
                        try { req.destroy(); } catch (e) { /* 忽略 */ }
                        done(resolve, { status, headers: res.headers || {}, location, body: Buffer.concat(chunks).toString('utf8') });
                        return;
                    }
                    chunks.push(c);
                });
                res.on('end', () => done(resolve, {
                    status,
                    headers: res.headers || {},
                    location,
                    body: Buffer.concat(chunks).toString('utf8'),
                }));
                res.on('error', (e) => done(reject, e));
            });
        } catch (e) {
            done(reject, e);
            return;
        }

        req.on('error', (e) => done(reject, e));
        // 整体超时：DNS/握手挂住时 error 事件可能永远不来，必须自己掐断
        req.setTimeout(timeoutMs, () => {
            try { req.destroy(new Error(`请求超时 ${timeoutMs}ms`)); } catch (e) { /* 忽略 */ }
        });
    });
}

function clampNumber(v, def, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
}

/**
 * 检查结果 → 日志行（纯函数，方便单测与统一文案）。
 * 只有两条成功文案 + 一条失败文案；`disabled` 返回空串（关了就不说话）。
 *
 * @param {{status:string, latest?:string, error?:string}|null} r takeResult() 的结果
 * @param {{tag?: string, home?: string}} [opts] tag 默认 "[LitematicaBE]"，home 默认项目主页
 * @returns {string}
 */
function formatLogLine(r, opts) {
    if (!r) return '';
    const o = opts || {};
    const tag = o.tag === undefined ? '[LitematicaBE]' : String(o.tag);
    const home = o.home === undefined
        ? `${DEFAULT_HTML_BASE}/${DEFAULT_REPO}`
        : String(o.home);

    if (r.status === 'update') return `${tag}发现新版本v${r.latest}，前往${home}以了解更多`;
    if (r.status === 'latest') return `${tag}当前已是最新版本`;
    if (r.status === 'error') return `${tag}版本检查失败：${r.error}`;
    return '';   // disabled / 未知状态：不打印
}

// ═══════════════════════ UpdateChecker ═══════════════════════

class UpdateChecker {
    /**
     * @param {{
     *   currentVersion: string,
     *   getConfig?: (key: string, def: any) => any,
     *   fetcher?: (url: string, opts: object) => Promise<object>,
     *   apiBase?: string,
     *   htmlBase?: string
     * }} opts
     *   fetcher 可注入（离线测试用），签名 (url, {timeoutMs, headers, redirectsLeft}) => Promise<{status, location, body}>。
     */
    constructor(opts) {
        const o = opts || {};
        this.currentVersion = stripVersionPrefix(o.currentVersion || '0.0.0') || '0.0.0';
        this.getConfig = typeof o.getConfig === 'function' ? o.getConfig : (k, d) => d;
        this.fetcher = typeof o.fetcher === 'function' ? o.fetcher : fetchOnce;
        this.apiBase = String(o.apiBase || DEFAULT_API_BASE).replace(/\/+$/, '');
        this.htmlBase = String(o.htmlBase || DEFAULT_HTML_BASE).replace(/\/+$/, '');

        this.started = false;    // 只查一次
        this.done = false;
        this.result = null;      // 纯数据；由主线程 takeResult() 取走
    }

    // ── 配置（实时读取，/litematica:config reload 后立即生效） ─────────

    isEnabled() {
        const v = this.getConfig('updateCheck.enabled', true);
        if (typeof v === 'boolean') return v;
        const s = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
        if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false;
        if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true;
        return true;
    }

    repo() {
        const r = String(this.getConfig('updateCheck.repo', DEFAULT_REPO) || '').trim();
        // 只接受 owner/name，防止拼出奇怪的 URL（含 ../、空格、协议头）
        return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(r) ? r : DEFAULT_REPO;
    }

    timeoutMs() {
        return clampNumber(this.getConfig('updateCheck.timeoutMs', 8000), 8000, 1000, 30000);
    }

    /** 项目主页（日志文案里的「前往 …」） */
    homeUrl() {
        return `${this.htmlBase}/${this.repo()}`;
    }

    /**
     * 一次检查要依次尝试的 URL：官方 API → 官方网页 → 镜像（若配置）。
     * 镜像可以是 API 地址也可以是网页地址，两者都能解析（见 extractTag）。
     */
    candidates() {
        const repo = this.repo();
        const list = [
            `${this.apiBase}/repos/${repo}/releases/latest`,
            `${this.htmlBase}/${repo}/releases/latest`,
        ];
        // mirror 是主配置键；checkUrl 是上一版的旧键，保留兼容（只读，不再写入默认配置）
        const mirror = String(
            this.getConfig('updateCheck.mirror', '')
            || this.getConfig('updateCheck.checkUrl', '')
            || ''
        ).trim();
        if (mirror) {
            const url = mirror.replace(/\{repo\}/g, repo);
            if (!list.includes(url)) list.push(url);
        }
        return list;
    }

    // ── 检查 ────────────────────────────────────────────────────

    /**
     * 发起一次检查（不阻塞、不抛错、幂等）。返回是否真的发出去了。
     * 结果写入 this.result，由主线程 takeResult() 取走并打印。
     */
    checkOnce() {
        if (this.started) return false;
        this.started = true;

        if (!this.isEnabled()) {
            this.result = { status: 'disabled', current: this.currentVersion };
            this.done = true;
            return false;
        }
        if (!https && !http) {
            this.result = {
                status: 'error',
                current: this.currentVersion,
                error: '运行时没有 Node 的 http/https 模块',
            };
            this.done = true;
            return false;
        }

        this._try(0, this.candidates(), '');
        return true;
    }

    /**
     * 主线程取结果（取走即清空）。
     * @returns {{status:'update'|'latest'|'error'|'disabled', current:string, latest?:string, tag?:string, source?:string, error?:string}|null}
     */
    takeResult() {
        const r = this.result;
        this.result = null;
        return r;
    }

    /** 内部：按顺序试候选 URL。**异步回调里只写纯数据。** */
    _try(i, list, lastError) {
        if (i >= list.length) {
            this.result = {
                status: 'error',
                current: this.currentVersion,
                error: lastError || '全部请求失败',
            };
            this.done = true;
            return;
        }

        const url = list[i];
        let p = null;
        try {
            // redirectsLeft: 0 —— 网页 releases/latest 只给 302，tag 在 location 里；
            // 跟着跳转会拿到一整页 HTML，JSON.parse 必失败（真机踩过，白瞎了兜底）。
            p = this.fetcher(url, {
                timeoutMs: this.timeoutMs(),
                headers: {
                    'User-Agent': String(this.getConfig('updateCheck.userAgent', DEFAULT_USER_AGENT) || DEFAULT_USER_AGENT),
                    'Accept': 'application/vnd.github+json',
                },
                redirectsLeft: 0,
            });
        } catch (e) {
            p = Promise.reject(e);
        }

        Promise.resolve(p).then((res) => {
            const tag = extractTag(res);
            if (!tag) {
                this._try(i + 1, list, describeFailure(res));
                return;
            }
            this.done = true;
            this.result = {
                status: compareVersions(tag, this.currentVersion) > 0 ? 'update' : 'latest',
                current: this.currentVersion,
                latest: stripVersionPrefix(tag),
                tag,
                source: url,
            };
        }).catch((err) => {
            const msg = err && err.message ? err.message : String(err);
            this._try(i + 1, list, msg);
        });
    }
}

module.exports = {
    UpdateChecker,
    // 纯函数：离线可测
    compareVersions,
    parseVersion,
    stripVersionPrefix,
    parseRedirectTag,
    extractTag,
    formatLogLine,
    fetchOnce,
    DEFAULT_REPO,
    DEFAULT_API_BASE,
    DEFAULT_HTML_BASE,
    httpAvailable: () => !!(https || http),
};
