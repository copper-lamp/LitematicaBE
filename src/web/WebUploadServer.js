// WebUploadServer - 插件内置 HTTP 上传站

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const guard = require('./uploadGuard');

const SCHEMATIC_DIR = './plugins/LitematicaBE/schematics/';
const PART_SUBDIR = '.uploading';
const DATA_DIR = './plugins/LitematicaBE/data/';
const TOKEN_NAME = 'web_token.txt';

const STALE_PART_MS = 6 * 60 * 60 * 1000;   // 6 小时没动静的残片自动清理

class WebUploadServer {
    /**
     * @param {{logger?: object, configManager?: object, pluginDir?: string, dataDir?: string}} [opts]
     *   pluginDir 用于定位 upload.html，默认 __dirname；dataDir 用于放令牌文件
     */
    constructor(opts = {}) {
        this._rawLogger = opts.logger || null;
        this.logger = this._makeLogger();
        this.cfg = opts.configManager || null;
        this.pluginDir = opts.pluginDir
            || (typeof __dirname === 'string' && __dirname ? __dirname : '')
            || path.resolve('./plugins/LitematicaBE/src/web');
        this.dataDir = opts.dataDir || DATA_DIR;

        this.svr = null;
        this.sessions = new Map();     // uploadId -> 会话元数据（不含字节）
        this.rate = new Map();         // ip -> { count, resetAt }
        this.token = '';
        this.startedAt = 0;
        this.stats = { inits: 0, chunks: 0, bytes: 0, files: 0, rejected: 0, lastFile: null };
        this._pageHtml = null;
    }

    // ─────────────── 配置 ───────────────

    /**
     * 安全 logger。三个级别都转发到 _emit，_emit 内部吞掉 EngineScope 异常并降级写文件。
     * 单独抽出来是因为上传回调线程无法访问宿主 logger，而启动期（主线程）又可以。
     */
    _makeLogger() {
        const wrapped = {};
        for (const lv of ['info', 'warn', 'error']) {
            wrapped[lv] = (msg) => this._emit(lv, msg);
        }
        return wrapped;
    }

    _emit(level, msg) {
        const text = String(msg === undefined || msg === null ? '' : msg);
        let ok = false;
        if (this._rawLogger && typeof this._rawLogger[level] === 'function') {
            try {
                this._rawLogger[level](text);
                ok = true;
            } catch (e) {
                // 典型：call engine APIs without a ::script::EngineScope
                this._rawLogger = null;
            }
        }
        if (!ok) this._debug(`[${level}] ${text}`);
    }

    _get(key, def) {
        try {
            if (this.cfg && typeof this.cfg.get === 'function') {
                const v = this.cfg.get('web.' + key, def);
                return v === undefined || v === null ? def : v;
            }
        } catch (e) { /* 配置读失败用默认值，不阻断上传 */ }
        return def;
    }

    /** 生效中的配置快照（命令/日志用） */
    config() {
        return this._conf();
    }

    _conf() {
        const maxFileMB = Math.max(1, Number(this._get('maxFileMB', 64)) || 64);
        const chunkKB = Math.max(64, Number(this._get('chunkKB', 512)) || 512);
        return {
            enabled: this._get('enabled', true) !== false,
            host: String(this._get('host', '0.0.0.0')),
            port: Number(this._get('port', 8080)) || 8080,
            tokenRequired: this._get('tokenRequired', true) !== false,
            localhostNoToken: this._get('localhostNoToken', true) !== false,
            allowIps: this._get('allowIps', []),
            maxFileMB,
            maxBytes: maxFileMB * 1024 * 1024,
            chunkKB,
            maxChunkBytes: chunkKB * 1024,
            allowExt: this._get('allowExt', ['.litematic', '.mcstructure']),
            overwrite: this._get('overwrite', false) === true,
            perMinute: Math.max(1, Number(this._get('maxUploadsPerMinute', 10)) || 10),
            targetDir: String(this._get('targetDir', SCHEMATIC_DIR)),
            publicUrl: String(this._get('publicUrl', '') || ''),
        };
    }

    _targetDir() {
        return path.resolve(this._conf().targetDir);
    }

    _partDir() {
        return path.join(this._targetDir(), PART_SUBDIR);
    }

    _tokenPath() {
        return path.join(path.resolve(this.dataDir), TOKEN_NAME);
    }

    /**
     * 定位前端页面文件。
     * 按「插件目录 → BDS 根下的插件目录 → 相对当前目录」依次探测，取第一个存在的。
     */
    _pageFile() {
        const cands = [];
        if (this.pluginDir) cands.push(path.join(this.pluginDir, 'upload.html'));
        cands.push(path.resolve('./plugins/LitematicaBE/src/web/upload.html'));
        cands.push(path.resolve('./src/web/upload.html'));
        for (const p of cands) {
            try { if (fs.existsSync(p)) return p; } catch (e) { /* 试下一个 */ }
        }
        return cands[0];
    }

    // ─────────────── 生命周期 ───────────────

    start() {
        const c = this._conf();
        if (!c.enabled) {
            this.logger.info('[Web] 上传站未启用（config web.enabled = false）');
            return false;
        }
        if (this.isRunning()) {
            this.logger.info('[Web] 上传站已在运行，忽略重复启动');
            return true;
        }

        try {
            fs.mkdirSync(this._targetDir(), { recursive: true });
            fs.mkdirSync(this._partDir(), { recursive: true });
            this._cleanStaleParts();
            this.token = this._resolveToken();
        } catch (e) {
            this.logger.warn(`[Web] 初始化目录/令牌失败: ${e && e.message ? e.message : e}`);
            return false;
        }

        try {
            const engine = String(this._get('engine', 'node')).toLowerCase();
            let svr = null;
            let usedEngine = 'node';

            if (engine === 'lse') {
                if (typeof HttpServer !== 'function') {
                    this.logger.warn('[Web] 本运行时没有 ll.network 的 HttpServer，回退 Node 原生 http');
                } else {
                    svr = new HttpServer();
                    usedEngine = 'lse';
                }
            }
            if (!svr) {
                // 默认走 Node 原生 http
                const { NodeHttpServer } = require('./NodeHttpServer');
                svr = new NodeHttpServer({ onLog: (m) => this.logger.warn(m) });
                usedEngine = 'node';
            }
            this._engine = usedEngine;

            const routes = this._routes();
            let registered = 0;
            for (const r of routes) {
                const reg = 'on' + r.method[0] + r.method.slice(1).toLowerCase();
                if (typeof svr[reg] !== 'function') continue;
                try {
                    svr[reg](r.path, (req, res) => this._dispatch(r, req, res));
                    registered++;
                } catch (e) {
                    // 单个路由注册失败（path 写法不被接受等）记录
                    this.logger.warn(`[Web] 路由注册失败 ${r.method} ${r.path}: ${e && e.message ? e.message : e}`);
                }
            }
            this.logger.info(`[Web] 引擎=${this._engine}，已注册路由 ${registered}/${routes.length} 条`);
            if (typeof svr.onError === 'function') {
                svr.onError((req, res) => {
                    const hasBody = res && typeof res.body === 'string' && res.body.length > 0;
                    this._debug(`框架错误 ${(req && req.method) || '?'} ${(req && req.path) || '?'}`
                        + ` → status=${res && res.status} reason=${(res && res.reason) || ''} hasBody=${hasBody}`);
                    if (hasBody) return;
                    this._json(res, (res && res.status) || 400, { ok: false, error: (res && res.reason) || 'bad request' });
                });
            }
            if (typeof svr.onException === 'function') {
                svr.onException((req, res, err) => {
                    this.logger.warn(`[Web] 处理请求异常 ${(req && req.method) || '?'} ${(req && req.path) || '?'}: ${err}`);
                    this._debug(`onException ${(req && req.path) || '?'}: ${err}`);
                    if (res && typeof res.body === 'string' && res.body.length > 0) return;
                    this._json(res, 500, { ok: false, error: '内部错误' });
                });
            }
            svr.listen(c.host, c.port);
            this.svr = svr;
            this.startedAt = Date.now();
        } catch (e) {
            // 端口占用或权限不足：只告警，插件其它功能照常
            this.logger.warn(`[Web] 启动失败（端口 ${c.port} 是否被占用？）: ${e && e.message ? e.message : e}`);
            this.svr = null;
            return false;
        }

        const url = c.publicUrl || `http://${c.host === '0.0.0.0' ? '本机IP' : c.host}:${c.port}/`;
        this._debug(`start ok host=${c.host} port=${c.port} target=${this._targetDir()} page=${this._pageFile()}`);
        this.logger.info(`[Web] 上传站已启动 ${url}（目录 ${this._targetDir()}）`);
        if (c.tokenRequired) {
            const q = this.token ? `?token=${this.token}` : '';
            this.logger.info(`[Web] 访问地址（带令牌）: ${url}${q}`);
            this.logger.info(`[Web] 令牌文件: ${this._tokenPath()}`);
        }
        // 启动即自检并打印
        this._selfCheck();
        return true;
    }

    stop() {
        if (!this.svr) return false;
        try {
            if (typeof this.svr.isRunning === 'function' && !this.svr.isRunning()) {
                this.svr = null;
                return true;
            }
            this.svr.stop();
            this.logger.info('[Web] 上传站已停止');
        } catch (e) {
            this.logger.warn(`[Web] 停止失败: ${e && e.message ? e.message : e}`);
        }
        this.svr = null;
        return true;
    }

    isRunning() {
        if (!this.svr) return false;
        try {
            return typeof this.svr.isRunning === 'function' ? !!this.svr.isRunning() : true;
        } catch (e) {
            return false;
        }
    }

    regenerateToken() {
        this.token = crypto.randomBytes(18).toString('hex');
        this._writeToken(this.token);
        return this.token;
    }

    /** 命令及日志用的一览 */
    summary() {
        const c = this._conf();
        return {
            running: this.isRunning(),
            enabled: c.enabled,
            host: c.host,
            port: c.port,
            url: c.publicUrl || `http://${c.host}:${c.port}/`,
            targetDir: this._targetDir(),
            tokenRequired: c.tokenRequired,
            token: c.tokenRequired ? this.token : '(未启用)',
            tokenFile: this._tokenPath(),
            sessions: this.sessions.size,
            stats: { ...this.stats },
        };
    }

    // ─────────────── 路由 ───────────────

    /**
     * 路由表。start() 会把它注册到 HttpServer；handler 也能被离线测试直接调用。
     * 写法约束：LSE 的 `onGet/onPost(path, cb)` 要求 path 以 `/` 开头（官方示例 `/test/(.+)`）。
     * 写成 `^/$` 这种“纯正则”形式，路由在 LSE 侧挂不上，所有请求都会落到框架默认的 500 Internal Server Error。
     */
    _routes() {
        return [
            // 探针：区分 LSE 回调机制问题或我响应写法问题
            // /ping  只用 res.write（官方样例写法）
            // /ping2 用 res.status + res.reason + res.setHeader + res.body 属性赋值
            { method: 'GET', path: '/ping$', handler: (req, res) => { res.write('pong'); } },
            {
                method: 'GET', path: '/ping2$', handler: (req, res) => {
                    res.status = 200;
                    res.reason = 'OK';
                    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                    res.body = 'pong2';
                },
            },
            { method: 'GET', path: '/$', handler: (req, res) => this._index(req, res) },
            { method: 'GET', path: '/api/health$', handler: (req, res) => this._health(req, res) },
            { method: 'GET', path: '/api/list$', handler: (req, res) => this._list(req, res) },
            { method: 'GET', path: '/api/download/(.+)', handler: (req, res) => this._download(req, res) },
            { method: 'POST', path: '/api/upload/init$', handler: (req, res) => this._wrap(res, () => this._init(req, res)) },
            { method: 'POST', path: '/api/upload/chunk$', handler: (req, res) => this._wrap(res, () => this._chunk(req, res)) },
            { method: 'POST', path: '/api/upload/finish$', handler: (req, res) => this._wrap(res, () => this._finish(req, res)) },
            { method: 'POST', path: '/api/upload/abort$', handler: (req, res) => this._wrap(res, () => this._abortReq(req, res)) },
            { method: 'DELETE', path: '/api/file/(.+)', handler: (req, res) => this._wrap(res, () => this._deleteFile(req, res)) },
            // 最后兜底：命中说明有请求没被上面的路由接住（浏览器 /favicon.ico 之类），
            // 记录日志便于排查，同时给出正常 JSON
            { method: 'GET', path: '/(.+)', handler: (req, res) => this._notFound(req, res) },
        ];
    }

    _notFound(req, res) {
        this.logger.warn(`[Web] 未匹配的路径 ${(req && req.method) || '?'} ${(req && req.path) || '?'}`);
        this._json(res, 404, { ok: false, error: 'not found' });
    }

    /**
     * 启动后自检：直接用内部 req/res 打一次首页，把「页面读不到 / 抛异常」暴露在启动日志里。
     * 不上传任何文件、不碰网络。
     */
    _selfCheck() {
        const res = {
            status: 0, reason: '', body: '', headers: {},
            setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
            getHeader(k) { return this.headers[String(k).toLowerCase()] === undefined ? [] : [this.headers[String(k).toLowerCase()]]; },
            write(...p) { this.body += p.join(''); return this; },
        };
        const req = {
            method: 'GET', path: '/', query: {}, headers: {}, body: '', matches: [],
            remoteAddr: '127.0.0.1', remotePort: 0, version: 'HTTP/1.1',
            getHeader() { return []; },
        };
        try {
            this._index(req, res);
            const page = this._pageFile();
            if (res.status === 200 && res.body.indexOf('__WEB_BOOT__') >= 0) {
                this.logger.info(`[Web] 页面自检通过（${res.body.length} 字节，来自 ${page}）`);
                this._debug(`selfCheck 通过 status=${res.status} len=${res.body.length} page=${page}`);
            } else {
                this.logger.warn(`[Web] 页面自检异常: status=${res.status}，body 长度=${res.body.length}，页面=${page}`);
                this._debug(`selfCheck 异常 status=${res.status} len=${res.body.length} page=${page}`);
            }
        } catch (e) {
            this.logger.warn(`[Web] 页面自检抛错: ${e && e.message ? e.message : e}`);
            this._debug(`selfCheck 抛错: ${e && e.stack ? e.stack : e}`);
        }
    }

    _dispatch(route, req, res) {
        try {
            route.handler(req, res);
        } catch (e) {
            const detail = e && e.stack ? e.stack : (e && e.message ? e.message : String(e));
            this.logger.warn(`[Web] ${req && req.path} 处理失败: ${e && e.message ? e.message : e}`);
            // 控制台日志可能被 BDS 的缓冲吞掉，直接落一份到 data/web_debug.log
            this._debug(`handler 异常 ${route.method} ${route.path} ← ${(req && req.method) || '?'} ${(req && req.path) || '?'}\n${detail}`);
            this._json(res, 500, { ok: false, error: '内部错误' });
        }
    }

    /**
     * 诊断日志：写 plugins/LitematicaBE/data/web_debug.log。
     * 只在出问题时追加，绕开 BDS 控制台/日志缓冲，方便定位 handler 内部异常。
     */
    _debug(msg) {
        try {
            const p = path.join(path.resolve(this.dataDir), 'web_debug.log');
            fs.mkdirSync(path.dirname(p), { recursive: true });
            // 上限 2MB：超了把旧文件挪成 .1，防止长期运行写满磁盘
            try {
                if (fs.existsSync(p) && fs.statSync(p).size > 2 * 1024 * 1024) fs.renameSync(p, p + '.1');
            } catch (e) { /* 轮转失败就继续追加 */ }
            fs.appendFileSync(p, `[${new Date().toISOString()}] ${msg}\n`, 'utf8');
        } catch (e) { /* 诊断失败不影响主流程 */ }
    }

    _wrap(res, fn) {
        try {
            fn();
        } catch (e) {
            this.logger.warn(`[Web] 请求处理失败: ${e && e.message ? e.message : e}`);
            this._json(res, 500, { ok: false, error: '内部错误' });
        }
    }

    // ─────────────── 响应 helper ───────────────

    _json(res, code, obj) {
        try {
            res.status = code;
            res.reason = REASONS[code] || 'OK';
            if (typeof res.setHeader === 'function') {
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.setHeader('Cache-Control', 'no-store');
            }
            res.body = JSON.stringify(obj);
        } catch (e) { /* 响应对象异常时不二次抛错 */ }
    }

    _html(res, code, html) {
        try {
            res.status = code;
            res.reason = REASONS[code] || 'OK';
            if (typeof res.setHeader === 'function') {
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.setHeader('Cache-Control', 'no-store');
            }
            res.body = html;
        } catch (e) { /* ignore */ }
    }

    // ─────────────── 鉴权 / 限流 ───────────────

    _isLocal(ip) {
        const a = String(ip || '');
        return a === '127.0.0.1' || a === '::1' || a === 'localhost' || a.startsWith('127.');
    }

    _tokenFrom(req) {
        let cand = '';
        try {
            if (typeof req.getHeader === 'function') {
                const h = req.getHeader('X-Upload-Token');
                cand = Array.isArray(h) ? (h[0] || '') : (h || '');
            }
        } catch (e) { /* ignore */ }
        if (!cand && req.query) {
            const q = req.query.token;
            cand = Array.isArray(q) ? (q[0] || '') : (q || '');
        }
        return String(cand || '');
    }

    _authorized(req) {
        const c = this._conf();
        if (!c.tokenRequired) return true;
        if (c.localhostNoToken && this._isLocal(req && req.remoteAddr)) return true;
        if (!this.token) return true;                     // 还没生成令牌时不锁死（启动失败场景）
        return safeEqual(this._tokenFrom(req), this.token);
    }

    /** 每 IP 每分钟的 init 次数限制 */
    _rateOk(ip) {
        const perMinute = this._conf().perMinute;
        const now = Date.now();
        const rec = this.rate.get(ip);
        if (!rec || now >= rec.resetAt) {
            this.rate.set(ip, { count: 1, resetAt: now + 60000 });
            return true;
        }
        if (rec.count >= perMinute) return false;
        rec.count++;
        return true;
    }

    _reject(res, code, msg) {
        this.stats.rejected++;
        this._json(res, code, { ok: false, error: msg });
    }

    // ─────────────── 页面 / 查询 ───────────────

    _index(req, res) {
        try {
            if (!this._pageHtml) {
                this._pageHtml = fs.readFileSync(this._pageFile(), 'utf8');
            }
            const c = this._conf();
            // 注入启动参数：分片大小、白名单、上限都从服务端来
            const boot = JSON.stringify({
                token: this._tokenFrom(req) || '',
                chunkKB: c.chunkKB,
                maxFileMB: c.maxFileMB,
                allowExt: c.allowExt,
                publicUrl: c.publicUrl,
            }).replace(/</g, '\\u003c');
            this._html(res, 200, this._pageHtml.replace('/*__BOOT__*/null', () => boot));
        } catch (e) {
            this._html(res, 500, '<h1>上传页缺失</h1><p>插件内 upload.html 读取失败，请看服务端控制台日志。</p>');
        }
    }

    _health(req, res) {
        const c = this._conf();
        this._json(res, 200, {
            ok: true,
            plugin: 'LitematicaBE',
            running: this.isRunning(),
            chunkKB: c.chunkKB,
            maxFileMB: c.maxFileMB,
            allowExt: c.allowExt,
            files: this._listFiles().length,
        });
    }

    _listFiles() {
        const dir = this._targetDir();
        const out = [];
        try {
            if (!fs.existsSync(dir)) return out;
            for (const name of fs.readdirSync(dir)) {
                const ext = path.extname(name).toLowerCase();
                if (ext !== '.litematic' && ext !== '.mcstructure') continue;
                try {
                    const st = fs.statSync(path.join(dir, name));
                    if (!st.isFile()) continue;
                    out.push({ name, size: st.size, mtime: st.mtimeMs, type: ext.slice(1) });
                } catch (e) { /* 单个文件 stat 失败跳过 */ }
            }
        } catch (e) {
            this.logger.warn(`[Web] 列目录失败: ${e && e.message ? e.message : e}`);
        }
        out.sort((a, b) => b.mtime - a.mtime);
        return out;
    }

    _list(req, res) {
        if (!this._authorized(req)) return this._reject(res, 401, '令牌无效');
        this._json(res, 200, { ok: true, dir: this._conf().targetDir, files: this._listFiles() });
    }

    _download(req, res) {
        if (!this._authorized(req)) return this._reject(res, 401, '令牌无效');
        const raw = pickMatch(req, 1) || '';
        const checked = guard.checkUploadName(raw, this._conf().allowExt);
        if (!checked.ok) return this._reject(res, 400, checked.error);
        const file = path.join(this._targetDir(), checked.safeName);
        if (!fs.existsSync(file)) return this._reject(res, 404, '文件不存在');
        const st = fs.statSync(file);
        if (st.size > this._conf().maxBytes) return this._reject(res, 413, '文件过大，请直接取服务器上的文件');
        try {
            const buf = fs.readFileSync(file);
            this._json(res, 200, { ok: true, name: path.basename(file), size: buf.length, data: buf.toString('base64') });
        } catch (e) {
            this._reject(res, 500, '读取失败');
        }
    }

    _deleteFile(req, res) {
        if (!this._authorized(req)) return this._reject(res, 401, '令牌无效');
        const raw = pickMatch(req, 1) || '';
        const checked = guard.checkUploadName(raw, this._conf().allowExt);
        if (!checked.ok) return this._reject(res, 400, checked.error);
        const file = path.join(this._targetDir(), checked.safeName);
        if (!fs.existsSync(file)) return this._reject(res, 404, '文件不存在');
        try {
            fs.unlinkSync(file);
            this.logger.info(`[Web] 已删除 ${file}`);
            this._json(res, 200, { ok: true, deleted: path.basename(file) });
        } catch (e) {
            this._reject(res, 500, '删除失败');
        }
    }

    // ─────────────── 上传：init / chunk / finish ───────────────

    _init(req, res) {
        const c = this._conf();
        if (!this._authorized(req)) return this._reject(res, 401, '令牌无效');
        if (!guard.ipAllowed(c.allowIps, req.remoteAddr)) return this._reject(res, 403, '来源地址不在白名单');
        if (!this._rateOk(String(req.remoteAddr || ''))) return this._reject(res, 429, '上传过于频繁，请稍后再试');

        const body = this._jsonBody(req);
        if (!body) return this._reject(res, 400, '请求体不是合法 JSON');

        const checked = guard.checkUploadName(body.name, c.allowExt);
        if (!checked.ok) return this._reject(res, 400, checked.error);

        const size = Number(body.size);
        if (!Number.isFinite(size) || size <= 0) return this._reject(res, 400, '文件大小非法');
        if (size > c.maxBytes) return this._reject(res, 413, `单个文件不能超过 ${c.maxFileMB} MB`);

        const id = crypto.createHash('sha1')
            .update(`${checked.safeName}|${size}`)
            .digest('hex').slice(0, 16);
        const partPath = path.join(this._partDir(), `${id}.part`);

        // 断点续传：同名同大小的残片还在，就从残片长度接着传
        let offset = 0;
        try {
            if (fs.existsSync(partPath)) offset = fs.statSync(partPath).size;
            if (offset > size) { fs.unlinkSync(partPath); offset = 0; }
        } catch (e) {
            offset = 0;
        }

        const hash = crypto.createHash('sha256');
        if (offset > 0) {
            try {
                hash.update(fs.readFileSync(partPath));
            } catch (e) {
                offset = 0;
            }
        }

        this.sessions.set(id, {
            id,
            safeName: checked.safeName,
            ext: checked.ext,
            size,
            received: offset,
            seq: Math.floor(offset / c.maxChunkBytes),
            partPath,
            hash,
            ip: String(req.remoteAddr || ''),
            createdAt: Date.now(),
            touchedAt: Date.now(),
        });
        this.stats.inits++;

        this._json(res, 200, {
            ok: true,
            uploadId: id,
            offset,
            chunkSize: c.chunkKB * 1024,
            name: checked.safeName,
        });
    }

    _chunk(req, res) {
        const c = this._conf();
        if (!this._authorized(req)) return this._reject(res, 401, '令牌无效');

        const body = this._jsonBody(req);
        if (!body) return this._reject(res, 400, '请求体不是合法 JSON');
        const s = this.sessions.get(String(body.uploadId || ''));
        if (!s) return this._reject(res, 404, '上传会话不存在或已过期，请重新上传');

        const raw = String(body.data || '');
        if (!raw) return this._reject(res, 400, '分片内容为空');
        if (!/^[A-Za-z0-9+/=\r\n]+$/.test(raw)) return this._reject(res, 400, '分片不是合法 base64');
        const buf = Buffer.from(raw, 'base64');
        if (buf.length > c.maxChunkBytes * 1.1) return this._reject(res, 413, '分片超过声明大小');

        // 序号必须连续：乱序/重发会让文件内容错位
        if (body.seq !== undefined && body.seq !== null && Number(body.seq) !== s.seq) {
            return this._json(res, 409, { ok: false, error: '分片序号不连续', expectSeq: s.seq, received: s.received });
        }

        if (s.received + buf.length > s.size) {
            this._abortSession(s.id);
            return this._reject(res, 413, '累计大小超过声明值');
        }

        try {
            fs.appendFileSync(s.partPath, buf);
        } catch (e) {
            this.logger.warn(`[Web] 写入分片失败: ${e && e.message ? e.message : e}`);
            return this._reject(res, 500, '写入失败（磁盘或权限问题，详见控制台）');
        }
        s.hash.update(buf);
        s.received += buf.length;
        s.seq++;
        s.touchedAt = Date.now();
        this.stats.chunks++;
        this.stats.bytes += buf.length;

        this._json(res, 200, { ok: true, received: s.received, size: s.size });
    }

    _finish(req, res) {
        const c = this._conf();
        if (!this._authorized(req)) return this._reject(res, 401, '令牌无效');

        const body = this._jsonBody(req);
        if (!body) return this._reject(res, 400, '请求体不是合法 JSON');
        const s = this.sessions.get(String(body.uploadId || ''));
        if (!s) return this._reject(res, 404, '上传会话不存在或已过期，请重新上传');

        if (s.received !== s.size) {
            return this._json(res, 400, { ok: false, error: '文件未传完', received: s.received, size: s.size });
        }

        // 魔数校验
        let head;
        try {
            const fd = fs.openSync(s.partPath, 'r');
            head = Buffer.alloc(8);
            const n = fs.readSync(fd, head, 0, 8, 0);
            fs.closeSync(fd);
            head = head.subarray(0, n);
        } catch (e) {
            this._abortSession(s.id);
            return this._reject(res, 500, '读取临时文件失败');
        }
        if (!guard.checkMagic(s.ext, head)) {
            this._abortSession(s.id);
            return this._reject(res, 400, `文件内容不像 ${s.ext}（文件头校验未通过）`);
        }

        let target;
        try {
            target = guard.resolveTarget(this._targetDir(), path.basename(s.safeName, s.ext), s.ext, c.overwrite);
            fs.renameSync(s.partPath, target);
        } catch (e) {
            this.logger.warn(`[Web] 落盘失败: ${e && e.message ? e.message : e}`);
            this._abortSession(s.id);
            return this._reject(res, 500, '落盘失败（详见控制台）');
        }

        const sha = s.hash.digest('hex');
        this.sessions.delete(s.id);
        this.stats.files++;
        this.stats.lastFile = { name: path.basename(target), size: s.size, at: Date.now() };
        this.logger.info(`[Web] 收到结构文件 ${target}（${s.size} 字节，sha256=${sha.slice(0, 16)}…，来自 ${s.ip}）`);

        this._json(res, 200, {
            ok: true,
            file: path.basename(target),
            size: s.size,
            sha256: sha,
            dir: this._conf().targetDir,
            tip: '游戏内输入 /litematica load ' + path.basename(target, s.ext) + ' 即可加载',
        });
    }

    _abortReq(req, res) {
        if (!this._authorized(req)) return this._reject(res, 401, '令牌无效');
        const body = this._jsonBody(req);
        const id = body ? String(body.uploadId || '') : '';
        if (id && this.sessions.has(id)) this._abortSession(id);
        this._json(res, 200, { ok: true });
    }

    _abortSession(id) {
        const s = this.sessions.get(id);
        if (!s) return;
        try {
            if (fs.existsSync(s.partPath)) fs.unlinkSync(s.partPath);
        } catch (e) { /* 删不掉也无所谓，启动时会清 */ }
        this.sessions.delete(id);
    }

    _cleanStaleParts() {
        const dir = this._partDir();
        const now = Date.now();
        let n = 0;
        try {
            for (const name of fs.readdirSync(dir)) {
                if (!name.endsWith('.part')) continue;
                const p = path.join(dir, name);
                try {
                    if (now - fs.statSync(p).mtimeMs > STALE_PART_MS) { fs.unlinkSync(p); n++; }
                } catch (e) { /* ignore */ }
            }
        } catch (e) { /* 目录不存在等 */ }
        if (n) this.logger.info(`[Web] 清理上次残留分片 ${n} 个`);
        return n;
    }

    // ─────────────── 请求体 ───────────────

    _bodyLimit() {
        return Math.ceil(this._conf().maxChunkBytes * 1.5) + 8192;
    }

    _jsonBody(req) {
        const raw = String((req && req.body) || '');
        if (raw.length > this._bodyLimit()) return null;
        if (!raw) return {};
        try {
            const v = JSON.parse(raw);
            return v && typeof v === 'object' ? v : null;
        } catch (e) {
            return null;
        }
    }

    // ─────────────── 令牌 ───────────────

    _resolveToken() {
        const fromCfg = String(this._get('token', '') || '').trim();
        if (fromCfg) return fromCfg;
        const tp = this._tokenPath();
        try {
            if (fs.existsSync(tp)) {
                const t = fs.readFileSync(tp, 'utf8').trim();
                if (t) return t;
            }
        } catch (e) { /* ignore */ }
        const t = crypto.randomBytes(18).toString('hex');
        this._writeToken(t);
        this.logger.info('[Web] 已生成上传令牌，写入 data/web_token.txt（可用 /litematica:web token 重新生成）');
        return t;
    }

    _writeToken(t) {
        try {
            fs.mkdirSync(path.dirname(this._tokenPath()), { recursive: true });
            fs.writeFileSync(this._tokenPath(), t + '\n', 'utf8');
        } catch (e) {
            this.logger.warn(`[Web] 令牌写入失败: ${e && e.message ? e.message : e}`);
        }
    }
}

const REASONS = {
    200: 'OK',
    301: 'Moved Permanently',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    413: 'Payload Too Large',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
};

/** 定长比较，避免令牌比较泄漏长度信息 */
function safeEqual(a, b) {
    const x = Buffer.from(String(a || ''), 'utf8');
    const y = Buffer.from(String(b || ''), 'utf8');
    if (x.length !== y.length || x.length === 0) return false;
    try {
        return crypto.timingSafeEqual(x, y);
    } catch (e) {
        return false;
    }
}

/** 取正则捕获组：req.matches[0] 是原始路径，捕获组从 1 开始 */
function pickMatch(req, i) {
    const m = req && req.matches;
    if (Array.isArray(m)) return m[i];
    return undefined;
}

module.exports = { WebUploadServer, safeEqual, REASONS };
