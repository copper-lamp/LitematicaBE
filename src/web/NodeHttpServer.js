// NodeHttpServer - 用 Node 原生 http 模块实现的 HTTP 服务端

const http = require('http');

class NodeHttpServer {
    /**
     * @param {{onLog?: Function, maxBodyBytes?: number}} [opts]
     *   onLog 用于记录启动/错误信息；它内部必须自己吞掉 engine 相关异常
     */
    constructor(opts = {}) {
        this.routes = [];        // { m, re, h }
        this.err = null;
        this.exc = null;
        this.server = null;
        this.lastError = null;
        this.onLog = typeof opts.onLog === 'function' ? opts.onLog : () => {};
        this.maxBodyBytes = Math.max(1024, Number(opts.maxBodyBytes) || 4 * 1024 * 1024);
        this.listening = false;
    }

    onGet(p, h) { this.routes.push({ m: 'GET', re: new RegExp(p), h }); return this; }
    onPost(p, h) { this.routes.push({ m: 'POST', re: new RegExp(p), h }); return this; }
    onDelete(p, h) { this.routes.push({ m: 'DELETE', re: new RegExp(p), h }); return this; }
    onError(h) { this.err = h; return this; }
    onException(h) { this.exc = h; return this; }

    listen(addr, port) {
        if (this.server) return this;
        const server = http.createServer((req, res) => this._handle(req, res));
        server.on('error', (e) => {
            this.lastError = e && e.message ? e.message : String(e);
            this.listening = false;
            try { this.onLog(`http server 错误: ${this.lastError}`); } catch (e2) { /* ignore */ }
        });
        server.on('listening', () => { this.listening = true; });
        // keep-alive 与超时都给保守值：BDS 里不要长期占着连接
        server.keepAliveTimeout = 5000;
        server.headersTimeout = 10000;
        server.requestTimeout = 30000;
        server.listen(port, addr);
        this.server = server;
        return this;
    }

    isRunning() {
        return !!(this.server && this.server.listening);
    }

    stop() {
        if (!this.server) return;
        try {
            this.server.close();
        } catch (e) { /* ignore */ }
        this.server = null;
        this.listening = false;
    }

    /** 把原生请求转成 LSE 风格的 req/res，再交给已注册的 handler */
    _handle(rawReq, rawRes) {
        const chunks = [];
        let size = 0;
        let destroyed = false;

        rawReq.on('data', (c) => {
            if (destroyed) return;
            size += c.length;
            if (size > this.maxBodyBytes) {
                destroyed = true;
                try { rawReq.destroy(); } catch (e) { /* ignore */ }
                return;
            }
            chunks.push(c);
        });

        rawReq.on('end', () => {
            if (destroyed) return;
            try {
                this._dispatch(rawReq, rawRes, chunks);
            } catch (e) {
                // 兜底：任何没被 handler 内部捕获的异常都必须在这里收住，
                // 否则会升级成 uncaughtException，把整个服务端带下去
                try { this._write(rawRes, 500, 'Internal Server Error', { 'Content-Type': 'application/json; charset=utf-8' }, '{"ok":false,"error":"internal"}'); } catch (e2) { /* ignore */ }
            }
        });

        rawReq.on('error', () => { /* 客户端断开，忽略 */ });
    }

    _dispatch(rawReq, rawRes, chunks) {
        let pathname = '/';
        let search = '';
        try {
            const raw = String(rawReq.url || '/');
            const q = raw.indexOf('?');
            pathname = q >= 0 ? raw.slice(0, q) : raw;
            search = q >= 0 ? raw.slice(q + 1) : '';
        } catch (e) { /* 用默认值 */ }

        const query = {};
        if (search) {
            for (const pair of search.split('&')) {
                if (!pair) continue;
                const eq = pair.indexOf('=');
                const k = decodeURIComponent(eq >= 0 ? pair.slice(0, eq) : pair);
                const v = decodeURIComponent(eq >= 0 ? pair.slice(eq + 1) : '');
                if (query[k] === undefined) query[k] = v;
                else if (Array.isArray(query[k])) query[k].push(v);
                else query[k] = [query[k], v];
            }
        }

        const headers = {};
        for (const k of Object.keys(rawReq.headers || {})) {
            const v = rawReq.headers[k];
            headers[k] = Array.isArray(v) ? v.slice() : [String(v)];
        }

        const body = chunks.length ? Buffer.concat(chunks).toString('utf8') : '';
        const remote = String((rawReq.socket && rawReq.socket.remoteAddress) || '').replace('::ffff:', '');

        const req = {
            method: String(rawReq.method || 'GET'),
            path: pathname,
            query,
            headers,
            body,
            remoteAddr: remote,
            remotePort: (rawReq.socket && rawReq.socket.remotePort) || 0,
            version: String(rawReq.httpVersion || '1.1'),
            matches: [],
            getHeader(name) {
                const want = String(name).toLowerCase();
                for (const k of Object.keys(headers)) {
                    if (k.toLowerCase() === want) return headers[k];
                }
                return [];
            },
        };

        const res = {
            status: 200,
            reason: 'OK',
            body: '',
            headers: {},
            setHeader(k, v) { this.headers[String(k)] = String(v); return this; },
            getHeader(k) {
                const v = this.headers[String(k)];
                return v === undefined ? [] : [v];
            },
            write(...parts) { this.body += parts.join(''); return this; },
        };

        // 路由匹配：先定义的优先；要求整串匹配（LSE 的语义），避免 /api/list 被 /api/listxxx 误命中
        let hit = null;
        for (const r of this.routes) {
            if (r.m !== req.method) continue;
            let m = null;
            try { m = r.re.exec(pathname); } catch (e) { continue; }
            if (!m || m[0] !== pathname) continue;
            req.matches = [...m];
            hit = r;
            break;
        }

        if (hit) {
            try {
                hit.h(req, res);
            } catch (e) {
                const msg = e && e.message ? e.message : String(e);
                if (typeof this.exc === 'function') {
                    try { this.exc(req, res, msg); } catch (e2) { /* ignore */ }
                }
                if (!res.body) {
                    res.status = 500;
                    res.reason = 'Internal Server Error';
                    res.body = JSON.stringify({ ok: false, error: 'internal' });
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                }
            }
        } else {
            res.status = 404;
            res.reason = 'Not Found';
            res.body = JSON.stringify({ ok: false, error: 'not found' });
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            if (typeof this.err === 'function') {
                try { this.err(req, res); } catch (e) { /* ignore */ }
            }
        }

        const headers_out = Object.assign({}, res.headers);
        const buf = Buffer.from(String(res.body || ''), 'utf8');
        headers_out['Content-Length'] = String(buf.length);
        this._write(rawRes, res.status, res.reason, headers_out, buf);
    }

    _write(rawRes, status, reason, headers, body) {
        if (rawRes.writableEnded) return;
        try {
            rawRes.writeHead(status, reason || undefined, headers || {});
            rawRes.end(body);
        } catch (e) {
            try { rawRes.end(); } catch (e2) { /* ignore */ }
        }
    }
}

module.exports = { NodeHttpServer };
