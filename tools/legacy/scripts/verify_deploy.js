/**
 * verify_deploy.js — 用「测试服务端的部署副本 + 部署 config.json」真实起一次上传站
 *
 * 只做只读验证：起服务 → 取页面 / 健康检查 / 列目录 → 关服务。
 * 不往用户的 schematics 里写任何文件（上传链路由离线测试覆盖）。
 *
 * 用法：node work/verify_deploy.js [serverDir]
 */
const fs = require('fs');
const path = require('path');

const SERVER = process.argv[2] || 'C:\\Users\\25491\\Desktop\\MCBEserver1.21.132';
const PLUGIN_DIR = path.join(SERVER, 'plugins', 'LitematicaBE');

process.chdir(SERVER);   // 插件所有相对路径都以 BDS 根为基准

const { WebUploadServer } = require(path.join(PLUGIN_DIR, 'src', 'web', 'WebUploadServer.js'));

// ── 模拟 ConfigManager：宽松解析部署 config.json ──
const raw = fs.readFileSync(path.join(PLUGIN_DIR, 'config.json'), 'utf8')
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
const config = JSON.parse(raw);

const cfg = {
    get(key, def) {
        let v = config;
        for (const k of key.split('.')) {
            if (v && typeof v === 'object' && k in v) v = v[k];
            else return def;
        }
        return v === undefined ? def : v;
    },
};

const logs = [];
const logger = { info: (m) => logs.push('INFO  ' + m), warn: (m) => logs.push('WARN  ' + m), error: (m) => logs.push('ERROR ' + m) };

// ── 用 Node 的 http 冒充 LSE 的 HttpServer（与 work/web_e2e_smoke.js 同款最小契约） ──
const http = require('http');
class NodeHttpServer {
    constructor() { this.routes = []; this.server = null; }
    onGet(p, h) { this.routes.push({ m: 'GET', re: new RegExp(p), h }); return this; }
    onPost(p, h) { this.routes.push({ m: 'POST', re: new RegExp(p), h }); return this; }
    onDelete(p, h) { this.routes.push({ m: 'DELETE', re: new RegExp(p), h }); return this; }
    onError(h) { this.err = h; return this; }
    onException(h) { this.exc = h; return this; }
    listen(addr, port) {
        this.server = http.createServer((req, res) => this._handle(req, res));
        this.server.listen(port, addr === '0.0.0.0' ? '127.0.0.1' : addr);
        return this;
    }
    isRunning() { return !!(this.server && this.server.listening); }
    stop() { if (this.server) this.server.close(); }
    _handle(rawReq, rawRes) {
        const chunks = [];
        rawReq.on('data', (c) => chunks.push(c));
        rawReq.on('end', () => {
            const url = new URL(rawReq.url, 'http://x');
            const headers = {};
            for (const [k, v] of Object.entries(rawReq.headers)) headers[k] = Array.isArray(v) ? v : [v];
            const req = {
                method: rawReq.method, path: url.pathname,
                query: Object.fromEntries([...url.searchParams.entries()]),
                headers, body: Buffer.concat(chunks).toString('utf8'),
                remoteAddr: (rawReq.socket.remoteAddress || '').replace('::ffff:', ''),
                remotePort: rawReq.socket.remotePort, version: rawReq.httpVersion, matches: [],
                getHeader(n) { const w = String(n).toLowerCase(); for (const k of Object.keys(headers)) if (k.toLowerCase() === w) return headers[k]; return []; },
            };
            const res = {
                status: 200, reason: 'OK', body: '', headers: {},
                setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
                getHeader(k) { const v = this.headers[String(k).toLowerCase()]; return v === undefined ? [] : [v]; },
                write(...p) { this.body += p.join(''); return this; },
            };
            const route = this.routes.find((r) => {
                if (r.m !== rawReq.method) return false;
                const m = r.re.exec(url.pathname);
                if (!m || m[0] !== url.pathname) return false;
                req.matches = [...m];
                return true;
            });
            if (route) {
                try { route.h(req, res); } catch (e) { res.status = 500; res.body = '{"ok":false}'; }
            } else { res.status = 404; res.body = 'not found'; }
            const buf = Buffer.from(String(res.body || ''), 'utf8');
            rawRes.writeHead(res.status, res.reason, { ...res.headers, 'Content-Length': buf.length });
            rawRes.end(buf);
        });
    }
}
global.HttpServer = NodeHttpServer;

const svr = new WebUploadServer({ logger, configManager: cfg });
const ok = svr.start();
const s = svr.summary();

(async () => {
    const base = `http://127.0.0.1:${s.port}`;
    const results = [];
    const add = (n, v) => results.push(`${v ? '✅' : '❌'} ${n}`);

    add(`start() 成功（端口 ${s.port}）`, ok);
    const health = await (await fetch(`${base}/api/health`)).json();
    add(`/api/health → 分片 ${health.chunkKB}KB / 上限 ${health.maxFileMB}MB / 已有 ${health.files} 个文件`, !!health.ok);
    const page = await (await fetch(`${base}/`)).text();
    add(`GET / 页面 ${page.length} 字节，boot 已注入`, page.includes('window.__WEB_BOOT__ = {') && page.includes('把结构文件拖到这里'));
    const list = await (await fetch(`${base}/api/list`, { headers: { 'X-Upload-Token': s.token } })).json();
    add(`/api/list 读到 ${(list.files || []).length} 个文件（目录 ${list.dir}）`, !!list.ok);

    console.log('\n=== 部署副本验证（真实 config.json + 真实 schematics 目录）===');
    for (const r of results) console.log('  ' + r);
    console.log('\n--- 插件日志 ---');
    for (const l of logs) console.log('  ' + l);
    console.log('\n令牌:', s.token);
    console.log('浏览器地址: http://127.0.0.1:' + s.port + '/?token=' + s.token);
    svr.stop();
    console.log('\n服务已关闭（验证结束）\n');
    // 不用 process.exit()：node 24 在 stdio/undici 句柄仍在收尾时强制退出会触发
    // libuv 断言（Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)）把已通过的
    // 校验伪装成崩溃。设置 exitCode 让进程自然收尾即可。
    process.exitCode = results.some((r) => r.startsWith('❌')) ? 1 : 0;
})();
