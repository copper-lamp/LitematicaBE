/**
 * web_e2e_smoke.js — 用 Node 的 http 模块冒充 LSE 的 HttpServer，端到端验证上传站
 *
 * 说明：这不是插件代码，只是本地冒烟脚本（work/ 已被 gitignore）。
 * 它实现 LSE HttpServer 的最小契约（onGet/onPost/onDelete/onError/onException/listen/
 * stop/isRunning），把请求转成 LSE 风格的 req/res，从而在没有 BDS 的环境里
 * 真实走一遍「页面 → init → 分片 → finish → 落盘」。
 *
 * 用法：node work/web_e2e_smoke.js [port]
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const { WebUploadServer } = require(path.join(ROOT, 'src', 'web', 'WebUploadServer.js'));

const PORT = Number(process.argv[2]) || 18099;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lit-web-e2e-'));
const TARGET = path.join(TMP, 'schematics');
const DATA = path.join(TMP, 'data');

// ── 冒充 LSE HttpServer ──
class NodeHttpServer {
    constructor() { this.routes = []; this.server = null; this.err = null; this.exc = null; }
    onGet(p, h) { this.routes.push({ m: 'GET', re: new RegExp(p), h }); return this; }
    onPost(p, h) { this.routes.push({ m: 'POST', re: new RegExp(p), h }); return this; }
    onDelete(p, h) { this.routes.push({ m: 'DELETE', re: new RegExp(p), h }); return this; }
    onError(h) { this.err = h; return this; }
    onException(h) { this.exc = h; return this; }
    listen(addr, port) {
        this.server = http.createServer((req, res) => this._handle(req, res));
        this.server.on('error', (e) => { console.error('[smoke] listen 失败:', e.message); });
        this.server.listen(port, addr === '0.0.0.0' ? '127.0.0.1' : addr);
        return this;
    }
    isRunning() { return !!(this.server && this.server.listening); }
    stop() { if (this.server) this.server.close(); }
    _handle(rawReq, rawRes) {
        const chunks = [];
        rawReq.on('data', (c) => {
            chunks.push(c);
            if (chunks.reduce((a, b) => a + b.length, 0) > 4 * 1024 * 1024) rawReq.destroy();
        });
        rawReq.on('end', () => {
            const url = new URL(rawReq.url, 'http://x');
            const body = Buffer.concat(chunks).toString('utf8');
            const headers = {};
            for (const [k, v] of Object.entries(rawReq.headers)) headers[k] = Array.isArray(v) ? v : [v];

            const req = {
                method: rawReq.method,
                path: url.pathname,
                query: Object.fromEntries([...url.searchParams.entries()]),
                headers,
                body,
                remoteAddr: (rawReq.socket.remoteAddress || '').replace('::ffff:', ''),
                remotePort: rawReq.socket.remotePort,
                version: rawReq.httpVersion,
                matches: [],
                getHeader(name) {
                    const want = String(name).toLowerCase();
                    for (const k of Object.keys(headers)) if (k.toLowerCase() === want) return headers[k];
                    return [];
                },
            };
            const res = {
                status: 200, reason: 'OK', body: '', headers: {},
                setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
                getHeader(k) { const v = this.headers[String(k).toLowerCase()]; return v === undefined ? [] : [v]; },
                write(...parts) { this.body += parts.join(''); return this; },
            };

            const route = this.routes.find((r) => {
                if (r.m !== rawReq.method) return false;
                const m = r.re.exec(url.pathname);
                if (!m || m[0] !== url.pathname) return false;
                req.matches = [...m];
                return true;
            });

            if (!route) {
                if (this.err) this.err(req, res);
                res.status = res.status || 404;
                res.body = res.body || 'not found';
            } else {
                try {
                    route.h(req, res);
                } catch (e) {
                    if (this.exc) this.exc(req, res, e.message);
                    res.status = 500;
                    res.body = JSON.stringify({ ok: false, error: 'internal' });
                }
            }

            const buf = Buffer.from(String(res.body || ''), 'utf8');
            rawRes.writeHead(res.status, res.reason, { ...res.headers, 'Content-Length': buf.length });
            rawRes.end(buf);
        });
    }
}

global.HttpServer = NodeHttpServer;

const logs = [];
const logger = { info: (m) => logs.push('INFO  ' + m), warn: (m) => logs.push('WARN  ' + m), error: (m) => logs.push('ERROR ' + m) };

const store = {
    'web.targetDir': TARGET,
    'web.host': '127.0.0.1',
    'web.port': PORT,
    'web.enabled': true,
    'web.tokenRequired': true,
    'web.localhostNoToken': false,
    'web.maxFileMB': 8,
    'web.chunkKB': 256,
};
const cfg = { get(k, d) { return k in store ? store[k] : d; } };

const svr = new WebUploadServer({ logger, configManager: cfg, dataDir: DATA });
const ok = svr.start();
if (!ok) { console.error('[smoke] 启动失败'); process.exit(1); }

const base = `http://127.0.0.1:${PORT}`;
const token = svr.token;
const H = { 'X-Upload-Token': token };
const steps = [];
function step(name, fn) { return Promise.resolve().then(fn).then((v) => { steps.push(['PASS', name, v]); return v; }, (e) => { steps.push(['FAIL', name, e.message]); throw e; }); }

// 造一个「真」.litematic：gzip 压缩的 NBT 头（10 字节 compound + 空名 + end）
function makeLitematic(size) {
    const head = Buffer.from([0x0a, 0x00, 0x00, 0x00]);           // TAG_Compound / 空名 / TAG_End
    const pad = Buffer.alloc(Math.max(0, size - head.length));
    crypto.randomFillSync(pad);
    return zlib.gzipSync(Buffer.concat([head, pad]));
}

(async () => {
    await step('GET / 返回上传页', async () => {
        const r = await fetch(`${base}/`);
        const t = await r.text();
        if (r.status !== 200) throw new Error('HTTP ' + r.status);
        if (!t.includes('window.__WEB_BOOT__ = {')) throw new Error('页面没注入 boot');
        if (!t.includes('把结构文件拖到这里')) throw new Error('页面内容不完整');
        return `${t.length} 字节 HTML`;
    });

    await step('GET /api/health', async () => {
        const j = await (await fetch(`${base}/api/health`)).json();
        if (!j.ok || j.chunkKB !== 256) throw new Error(JSON.stringify(j));
        return `chunkKB=${j.chunkKB} 上限=${j.maxFileMB}MB`;
    });

    await step('无令牌 init 应 401', async () => {
        const r = await fetch(`${base}/api/upload/init`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'x.litematic', size: 10 }),
        });
        if (r.status !== 401) throw new Error('期望 401，实际 ' + r.status);
        return 'HTTP 401';
    });

    const payload = makeLitematic(700 * 1024);     // 700KB → 3 片（256KB/片）
    let uploadId = null;

    await step('init（真实 gzip .litematic，700KB）', async () => {
        const r = await fetch(`${base}/api/upload/init`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...H },
            body: JSON.stringify({ name: '端到端测试.litematic', size: payload.length }),
        });
        const j = await r.json();
        if (!j.ok) throw new Error(JSON.stringify(j));
        uploadId = j.uploadId;
        return `id=${j.uploadId} 分片=${j.chunkSize / 1024}KB`;
    });

    await step('分片上传（base64，逐片 POST）', async () => {
        const CHUNK = 256 * 1024;
        let seq = 0, off = 0, n = 0;
        while (off < payload.length) {
            const part = payload.subarray(off, Math.min(off + CHUNK, payload.length));
            const r = await fetch(`${base}/api/upload/chunk`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...H },
                body: JSON.stringify({ uploadId, seq, data: part.toString('base64') }),
            });
            const j = await r.json();
            if (!j.ok) throw new Error(`第 ${seq} 片失败: ` + JSON.stringify(j));
            off = j.received; seq++; n++;
        }
        return `${n} 片全部写入`;
    });

    await step('finish 落盘（校验魔数 + 原子 rename）', async () => {
        const r = await fetch(`${base}/api/upload/finish`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...H },
            body: JSON.stringify({ uploadId }),
        });
        const j = await r.json();
        if (!j.ok) throw new Error(JSON.stringify(j));
        const file = path.join(TARGET, j.file);
        if (!fs.existsSync(file)) throw new Error('磁盘上没有文件');
        if (fs.statSync(file).size !== payload.length) throw new Error('大小不一致');
        const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        if (sha !== j.sha256) throw new Error('sha256 不一致');
        return `${j.file} ${j.size} 字节`;
    });

    await step('GET /api/list 能看到新文件', async () => {
        const j = await (await fetch(`${base}/api/list`, { headers: H })).json();
        if (!j.files || j.files.length !== 1) throw new Error(JSON.stringify(j));
        return j.files[0].name;
    });

    await step('把网页当 .litematic 传 → 400 且不落盘', async () => {
        const junk = Buffer.from('<html>not a schematic</html>');
        const init = await (await fetch(`${base}/api/upload/init`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...H },
            body: JSON.stringify({ name: '假的.litematic', size: junk.length }),
        })).json();
        await fetch(`${base}/api/upload/chunk`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...H },
            body: JSON.stringify({ uploadId: init.uploadId, seq: 0, data: junk.toString('base64') }),
        });
        const r = await fetch(`${base}/api/upload/finish`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...H },
            body: JSON.stringify({ uploadId: init.uploadId }),
        });
        if (r.status !== 400) throw new Error('期望 400，实际 ' + r.status);
        if (fs.existsSync(path.join(TARGET, '假的.litematic'))) throw new Error('竟然落盘了');
        return 'HTTP 400，已丢弃';
    });

    console.log('\n=== 端到端冒烟（Node 冒充 LSE HttpServer）===');
    for (const [st, name, info] of steps) console.log(`  ${st === 'PASS' ? '✅' : '❌'} ${name} — ${info}`);
    console.log('\n--- 插件日志 ---');
    for (const l of logs) console.log('  ' + l);
    console.log('\n--- 目录 ---');
    console.log('  targetDir:', TARGET);
    console.log('  内容:', fs.readdirSync(TARGET).join(', ') || '(空)');
    console.log('\n服务仍在运行：浏览器打开 ' + base + '/?token=' + token);
    console.log('（Ctrl+C 结束；它只是 work/ 下的本地冒烟脚本，不是插件本体）\n');
})().catch((e) => {
    console.error('\n=== 冒烟失败 ===');
    for (const [st, name, info] of steps) console.log(`  ${st === 'PASS' ? '✅' : '❌'} ${name} — ${info}`);
    console.error(e);
    process.exit(1);
});
