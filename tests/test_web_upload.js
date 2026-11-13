/**
 * test_web_upload.js — 内置 HTTP 上传站离线回归
 *
 * 覆盖三块：
 *   1. uploadGuard 纯函数：文件名净化、路径穿越、扩展名白名单、魔数、IP 前缀
 *   2. 落盘全链路：init → chunk（分片序号/上限）→ finish（校验 + 原子 rename）
 *   3. 边界：令牌、IP 白名单、限流、超限、魔数不符、未传完、断点续传、同名不覆盖、端口占用
 *
 * 不碰网络：global.HttpServer 被替换成假实现，路由 handler 直接调用。
 * 不碰真实目录：targetDir / dataDir 全在系统临时目录里。
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PLUGIN = path.resolve(__dirname, '..');
const { WebUploadServer } = require(path.join(PLUGIN, 'src', 'web', 'WebUploadServer.js'));
const guard = require(path.join(PLUGIN, 'src', 'web', 'uploadGuard.js'));

let pass = 0, fail = 0;
function check(name, fn) {
    try {
        fn();
        console.log(`  ✅ ${name}`);
        pass++;
    } catch (e) {
        console.log(`  ❌ ${name}\n     ${e.message}`);
        fail++;
    }
}

const silent = { info() {}, warn() {}, error() {} };
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lit-web-'));
const warns = [];
const recordLogger = { info() {}, warn(m) { warns.push(String(m)); }, error() {} };

// ── 假 HttpServer：记录注册的路由与 listen 参数 ──
function installMockHttpServer(opts = {}) {
    const made = [];
    class MockHttpServer {
        constructor() {
            this.routes = [];
            this.listening = false;
            this.stopped = false;
            made.push(this);
        }
        onGet(p, h) { this.routes.push({ m: 'GET', p, h }); return this; }
        onPost(p, h) { this.routes.push({ m: 'POST', p, h }); return this; }
        onDelete(p, h) { this.routes.push({ m: 'DELETE', p, h }); return this; }
        onError(h) { this.err = h; return this; }
        onException(h) { this.exc = h; return this; }
        listen(a, p) {
            if (opts.throwOnListen) throw new Error('EADDRINUSE: address already in use');
            this.addr = a; this.port = p; this.listening = true; return this;
        }
        isRunning() { return this.listening && !this.stopped; }
        stop() { this.stopped = true; }
    }
    global.HttpServer = MockHttpServer;
    return made;
}

function mkCfg(overrides = {}) {
    const store = Object.assign({
        'web.enabled': true,
        // 这里固定走 lse 传输层：测试用假 HttpServer 直调 handler，不监听真实端口。
        // Node 引擎（真实 http）另有 tests/test_web_node_engine.js 覆盖。
        'web.engine': 'lse',
        'web.host': '127.0.0.1',
        'web.port': 18080,
        'web.tokenRequired': true,
        'web.localhostNoToken': false,
        'web.token': '',
        'web.allowIps': [],
        'web.maxFileMB': 1,
        'web.chunkKB': 64,
        'web.allowExt': ['.litematic', '.mcstructure'],
        'web.overwrite': false,
        'web.maxUploadsPerMinute': 100,
        'web.publicUrl': '',
    }, overrides);
    return { store, get(k, d) { return k in store ? store[k] : d; } };
}

function mkReq(o = {}) {
    const headers = o.headers || {};
    return {
        method: o.method || 'POST',
        path: o.path || '/',
        body: o.body === undefined ? '' : o.body,
        query: o.query || {},
        remoteAddr: o.remoteAddr || '10.0.0.5',
        remotePort: 33333,
        version: 'HTTP/1.1',
        matches: o.matches || [],
        getHeader(name) {
            const want = String(name).toLowerCase();
            for (const k of Object.keys(headers)) {
                if (k.toLowerCase() === want) {
                    const v = headers[k];
                    return Array.isArray(v) ? v : [v];
                }
            }
            return [];
        },
    };
}

function mkRes() {
    return {
        status: 0,
        reason: '',
        body: '',
        headers: {},
        setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
        getHeader(k) {
            const v = this.headers[String(k).toLowerCase()];
            return v === undefined ? [] : [v];
        },
        write(...parts) { this.body += parts.join(''); return this; },
    };
}

/** 建一个服务端实例：独立 targetDir / dataDir，返回 { svr, routes, token, call } */
function mkServer(name, cfgOverrides = {}, opts = {}) {
    installMockHttpServer(opts);
    const targetDir = path.join(tmpRoot, name, 'schematics');
    const dataDir = path.join(tmpRoot, name, 'data');
    const cfg = mkCfg(Object.assign({ 'web.targetDir': targetDir }, cfgOverrides));
    const svr = new WebUploadServer({
        logger: opts.logger || silent,
        configManager: cfg,
        dataDir,
        pluginDir: path.join(PLUGIN, 'src', 'web'),
    });
    const ok = svr.start();
    // _routes() 用 { method, path, handler }，这里统一成 { m, p, h } 方便查找
    const routes = svr._routes().map((r) => ({ m: r.method, p: r.path, h: r.handler }));
    const call = (method, routePath, req) => {
        const r = routes.find((x) => x.m === method && x.p === routePath);
        assert.ok(r, `路由未注册: ${method} ${routePath}`);
        const res = mkRes();
        r.h(req, res);
        return res;
    };
    return { svr, routes, call, targetDir, dataDir, cfg, started: ok, instances: installMockHttpServer.lastMade };
}

// 统一的小工具：造一个带 gzip 魔数的假 .litematic 载荷
function fakeLitematic(bytes) {
    const body = Buffer.alloc(Math.max(4, bytes));
    crypto.randomFillSync(body);
    body[0] = 0x1f; body[1] = 0x8b; body[2] = 0x08; body[3] = 0x00;
    return body;
}

const AUTH = { 'X-Upload-Token': '' };   // 占位，mkServer 拿到 token 后再填

console.log('\n=== 上传站：闸门（文件名 / 魔数 / IP） ===');

check('文件名净化：去路径、去非法字符、去首尾点、截断、保留名回落', () => {
    assert.strictEqual(guard.sanitizeStem('../../etc/passwd'), 'passwd');
    assert.strictEqual(guard.sanitizeStem('C:\\tmp\\城堡'), '城堡');
    assert.strictEqual(guard.sanitizeStem('a<b>c*d?e'), 'a_b_c_d_e');
    assert.strictEqual(guard.sanitizeStem('...hidden...'), 'hidden');
    assert.strictEqual(guard.sanitizeStem('   ').startsWith('schematic_'), true);
    assert.strictEqual(guard.sanitizeStem('CON'), 'schematic_CON');
    assert.strictEqual(guard.sanitizeStem('x'.repeat(200)).length, 80);
});

check('文件名校验：只给白名单扩展名，拒绝 ..', () => {
    assert.strictEqual(guard.checkUploadName('城堡.litematic', ['.litematic']).ok, true);
    assert.strictEqual(guard.checkUploadName('城堡.LITEMATIC', ['.litematic']).ok, true, '扩展名大小写应兼容');
    assert.strictEqual(guard.checkUploadName('a.exe', ['.litematic']).ok, false);
    assert.strictEqual(guard.checkUploadName('a..b.litematic', ['.litematic']).ok, false);
    assert.strictEqual(guard.checkUploadName('', ['.litematic']).ok, false);
    assert.strictEqual(guard.checkUploadName('x'.repeat(300) + '.litematic', ['.litematic']).ok, false);
});

check('resolveTarget：默认不覆盖（自动加 -1）、覆盖模式同名、只落目标目录内', () => {
    const dir = path.join(tmpRoot, 'guard-target');
    fs.mkdirSync(dir, { recursive: true });
    const first = guard.resolveTarget(dir, '城堡', '.litematic', false);
    assert.strictEqual(path.basename(first), '城堡.litematic');
    fs.writeFileSync(first, 'x');
    const second = guard.resolveTarget(dir, '城堡', '.litematic', false);
    assert.strictEqual(path.basename(second), '城堡-1.litematic');
    const forced = guard.resolveTarget(dir, '城堡', '.litematic', true);
    assert.strictEqual(path.basename(forced), '城堡.litematic');
    // 带目录的 stem 会被切成最后一段，不会跳出去
    const sneaky = guard.resolveTarget(dir, '../../evil', '.litematic', false);
    assert.strictEqual(path.dirname(sneaky), path.resolve(dir));
});

check('魔数校验：.litematic 认 gzip / NBT，.mcstructure 认小端 TAG，文本一律拒绝', () => {
    const gz = Buffer.from([0x1f, 0x8b, 0x08, 0x00]);
    const nbt = Buffer.from([0x0a, 0x00, 0x00]);
    assert.strictEqual(guard.checkMagic('.litematic', gz), true);
    assert.strictEqual(guard.checkMagic('.litematic', nbt), true);
    assert.strictEqual(guard.checkMagic('.litematic', Buffer.from('<html>')), false);
    assert.strictEqual(guard.checkMagic('.litematic', Buffer.alloc(0)), false);
    assert.strictEqual(guard.checkMagic('.mcstructure', Buffer.from([0x0a])), true);
    assert.strictEqual(guard.checkMagic('.mcstructure', gz), true);
    assert.strictEqual(guard.checkMagic('.mcstructure', Buffer.from([0x00])), false);
});

check('IP 白名单：空 = 放行；前缀匹配；不匹配拒绝', () => {
    assert.strictEqual(guard.ipAllowed([], '1.2.3.4'), true);
    assert.strictEqual(guard.ipAllowed(['192.168.', '10.0.'], '192.168.1.9'), true);
    assert.strictEqual(guard.ipAllowed(['192.168.'], '10.0.0.5'), false);
    assert.strictEqual(guard.ipAllowed([''], '10.0.0.5'), true);
});

console.log('\n=== 上传站：启动与路由 ===');

check('start() 注册全部路由、listen 到配置的地址端口、令牌落盘', () => {
    const s = mkServer('boot');
    assert.strictEqual(s.started, true, 'start 应成功');
    assert.strictEqual(s.svr.isRunning(), true);
    const inst = global.HttpServer;
    assert.strictEqual(s.svr.svr.addr, '127.0.0.1');
    assert.strictEqual(s.svr.svr.port, 18080);
    const paths = s.routes.map((r) => `${r.m} ${r.p}`);
    for (const must of ['GET /$', 'POST /api/upload/init$', 'POST /api/upload/chunk$',
        'POST /api/upload/finish$', 'GET /api/list$', 'DELETE /api/file/(.+)']) {
        assert.ok(paths.includes(must), `缺路由 ${must}`);
    }
    assert.ok(fs.existsSync(path.join(s.dataDir, 'web_token.txt')), '令牌文件应写入 dataDir');
    assert.strictEqual(s.svr.token.length >= 32, true);
    assert.ok(inst);
});

check('端口占用只告警不抛错（插件其它功能必须照常）', () => {
    warns.length = 0;
    const s = mkServer('portbusy', {}, { throwOnListen: true, logger: recordLogger });
    assert.strictEqual(s.started, false);
    assert.strictEqual(s.svr.isRunning(), false);
    assert.ok(warns.some((w) => w.includes('启动失败')), '应有启动失败告警');
});

check('stop() 停服且可重启', () => {
    const s = mkServer('stop');
    assert.strictEqual(s.svr.stop(), true);
    assert.strictEqual(s.svr.isRunning(), false);
    assert.strictEqual(s.svr.stop(), false, '已停时再 stop 应返回 false');
    assert.strictEqual(s.svr.start(), true);
    assert.strictEqual(s.svr.isRunning(), true);
});

check('GET / 返回上传页并注入启动参数', () => {
    const s = mkServer('page');
    const res = s.call('GET', '/$', mkReq({ method: 'GET', path: '/' }));
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes('window.__WEB_BOOT__ = {'), '应注入 boot 参数');
    assert.ok(res.body.includes('"chunkKB":64'), 'boot 应带 chunkKB');
    assert.strictEqual(res.headers['content-type'].includes('text/html'), true);
});

console.log('\n=== 上传站：鉴权 / 限流 / 白名单 ===');

check('无令牌 401、错令牌 401、正确令牌 200', () => {
    const s = mkServer('auth');
    const token = s.svr.token;
    const bad = s.call('POST', '/api/upload/init$', mkReq({
        body: JSON.stringify({ name: 'a.litematic', size: 10 }),
    }));
    assert.strictEqual(bad.status, 401);

    const wrong = s.call('POST', '/api/upload/init$', mkReq({
        body: JSON.stringify({ name: 'a.litematic', size: 10 }),
        headers: { 'X-Upload-Token': 'deadbeef' },
    }));
    assert.strictEqual(wrong.status, 401);

    const ok = s.call('POST', '/api/upload/init$', mkReq({
        body: JSON.stringify({ name: 'a.litematic', size: 10 }),
        headers: { 'X-Upload-Token': token },
    }));
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(JSON.parse(ok.body).ok, true);
});

check('localhostNoToken=true 时本机免令牌，远端仍然要令牌', () => {
    const s = mkServer('local', { 'web.localhostNoToken': true });
    const local = s.call('POST', '/api/upload/init$', mkReq({
        remoteAddr: '127.0.0.1',
        body: JSON.stringify({ name: 'a.litematic', size: 10 }),
    }));
    assert.strictEqual(local.status, 200);
    const remote = s.call('POST', '/api/upload/init$', mkReq({
        remoteAddr: '10.0.0.5',
        body: JSON.stringify({ name: 'a.litematic', size: 10 }),
    }));
    assert.strictEqual(remote.status, 401);
});

check('IP 白名单不匹配 403', () => {
    const s = mkServer('ipfilter', { 'web.allowIps': ['192.168.'] });
    const res = s.call('POST', '/api/upload/init$', mkReq({
        remoteAddr: '10.0.0.5',
        headers: { 'X-Upload-Token': s.svr.token },
        body: JSON.stringify({ name: 'a.litematic', size: 10 }),
    }));
    assert.strictEqual(res.status, 403);
});

check('限流：超过每分钟次数后 429', () => {
    const s = mkServer('rate', { 'web.maxUploadsPerMinute': 2 });
    const body = JSON.stringify({ name: 'a.litematic', size: 10 });
    const hdr = { 'X-Upload-Token': s.svr.token };
    const r1 = s.call('POST', '/api/upload/init$', mkReq({ body, headers: hdr }));
    const r2 = s.call('POST', '/api/upload/init$', mkReq({ body, headers: hdr }));
    const r3 = s.call('POST', '/api/upload/init$', mkReq({ body, headers: hdr }));
    assert.strictEqual(r1.status, 200);
    assert.strictEqual(r2.status, 200);
    assert.strictEqual(r3.status, 429);
});

console.log('\n=== 上传站：落盘全链路 ===');

/** 走完 init → chunk* → finish，返回 { ok, init, chunks, finish, id } */
function uploadFull(s, name, payload, opts = {}) {
    const token = s.svr.token;
    const hdr = { 'X-Upload-Token': token };
    const initBody = JSON.stringify({ name, size: opts.size !== undefined ? opts.size : payload.length });
    const init = s.call('POST', '/api/upload/init$', mkReq({ body: initBody, headers: hdr }));
    const initJson = JSON.parse(init.body || '{}');
    if (init.status !== 200) return { init, initJson, name };
    const id = initJson.uploadId;
    const CHUNK = initJson.chunkSize;
    let seq = Math.floor((initJson.offset || 0) / CHUNK);
    let off = initJson.offset || 0;
    const chunks = [];
    while (off < payload.length) {
        const part = payload.subarray(off, Math.min(off + CHUNK, payload.length));
        const r = s.call('POST', '/api/upload/chunk$', mkReq({
            body: JSON.stringify({ uploadId: id, seq, data: part.toString('base64') }),
            headers: hdr,
        }));
        chunks.push(r);
        if (r.status !== 200) break;
        const j = JSON.parse(r.body);
        off = j.received;
        seq++;
    }
    const finish = s.call('POST', '/api/upload/finish$', mkReq({
        body: JSON.stringify({ uploadId: id }), headers: hdr,
    }));
    return { init, initJson, chunks, finish, finishJson: JSON.parse(finish.body || '{}'), id };
}

check('正常上传：文件落到 schematics，大小与 sha256 一致，无残留 .part', () => {
    const s = mkServer('full');
    const payload = fakeLitematic(150 * 1024);         // 3 片（64KB/片）
    const r = uploadFull(s, '我的城堡.litematic', payload);
    assert.strictEqual(r.init.status, 200);
    assert.strictEqual(r.chunks.length, 3);
    assert.strictEqual(r.finish.status, 200, r.finish.body);
    assert.strictEqual(r.finishJson.ok, true);

    const target = path.join(s.targetDir, '我的城堡.litematic');
    assert.ok(fs.existsSync(target), '目标文件应存在');
    const onDisk = fs.readFileSync(target);
    assert.strictEqual(onDisk.length, payload.length);
    assert.strictEqual(r.finishJson.sha256, crypto.createHash('sha256').update(payload).digest('hex'));

    const parts = fs.readdirSync(path.join(s.targetDir, '.uploading'));
    assert.strictEqual(parts.length, 0, '.part 应被 rename 掉，不留残片');
    assert.strictEqual(s.svr.stats.files, 1);
});

check('分片序号不连续 → 409 并回告期望序号（前端据此回退）', () => {
    const s = mkServer('seq');
    const hdr = { 'X-Upload-Token': s.svr.token };
    const init = s.call('POST', '/api/upload/init$', mkReq({
        body: JSON.stringify({ name: 'seq.litematic', size: 200 }), headers: hdr,
    }));
    const id = JSON.parse(init.body).uploadId;
    const res = s.call('POST', '/api/upload/chunk$', mkReq({
        body: JSON.stringify({ uploadId: id, seq: 7, data: Buffer.alloc(10).toString('base64') }),
        headers: hdr,
    }));
    assert.strictEqual(res.status, 409);
    const j = JSON.parse(res.body);
    assert.strictEqual(j.expectSeq, 0);
    assert.strictEqual(j.received, 0);
});

check('魔数不符（把网页当 .litematic 传）→ 400 且清掉临时文件', () => {
    const s = mkServer('magic');
    const junk = Buffer.from('<html>this is not a schematic</html>');
    const r = uploadFull(s, 'junk.litematic', junk);
    assert.strictEqual(r.finish.status, 400);
    assert.strictEqual(fs.existsSync(path.join(s.targetDir, 'junk.litematic')), false);
    assert.strictEqual(fs.readdirSync(path.join(s.targetDir, '.uploading')).length, 0, '临时分片应被清理');
});

check('未传完就 finish → 400（不落盘）', () => {
    const s = mkServer('partial');
    const hdr = { 'X-Upload-Token': s.svr.token };
    const payload = fakeLitematic(1000);
    const r = uploadFull(s, 'half.litematic', payload, { size: payload.length + 500 });
    assert.strictEqual(r.finish.status, 400);
    const j = JSON.parse(r.finish.body);
    assert.strictEqual(j.received, payload.length);
    assert.strictEqual(fs.existsSync(path.join(s.targetDir, 'half.litematic')), false);
});

check('断点续传：第二次 init 返回已有 offset，从断点继续能成功', () => {
    const s = mkServer('resume');
    const hdr = { 'X-Upload-Token': s.svr.token };
    const payload = fakeLitematic(100 * 1024);
    const first = s.call('POST', '/api/upload/init$', mkReq({
        body: JSON.stringify({ name: 'resume.litematic', size: payload.length }), headers: hdr,
    }));
    const id1 = JSON.parse(first.body).uploadId;
    const part = payload.subarray(0, 64 * 1024);
    s.call('POST', '/api/upload/chunk$', mkReq({
        body: JSON.stringify({ uploadId: id1, seq: 0, data: part.toString('base64') }), headers: hdr,
    }));

    const again = s.call('POST', '/api/upload/init$', mkReq({
        body: JSON.stringify({ name: 'resume.litematic', size: payload.length }), headers: hdr,
    }));
    const j = JSON.parse(again.body);
    assert.strictEqual(j.offset, 64 * 1024, '应从残片长度续传');
    assert.strictEqual(j.uploadId, id1, '同名同大小应复用同一会话 id');
});

check('同名不覆盖：第二个同名文件落成 -1', () => {
    const s = mkServer('dup');
    const payload = fakeLitematic(512);
    const r1 = uploadFull(s, 'same.litematic', payload);
    const r2 = uploadFull(s, 'same.litematic', payload);
    assert.strictEqual(r1.finishJson.file, 'same.litematic');
    assert.strictEqual(r2.finishJson.file, 'same-1.litematic');
    assert.ok(fs.existsSync(path.join(s.targetDir, 'same-1.litematic')));
});

check('超过 maxFileMB → 413（init 阶段就拦）', () => {
    const s = mkServer('toobig', { 'web.maxFileMB': 1 });
    const res = s.call('POST', '/api/upload/init$', mkReq({
        body: JSON.stringify({ name: 'big.litematic', size: 2 * 1024 * 1024 }),
        headers: { 'X-Upload-Token': s.svr.token },
    }));
    assert.strictEqual(res.status, 413);
});

check('分片内容不是 base64 → 400（不把乱码写进文件）', () => {
    const s = mkServer('b64');
    const hdr = { 'X-Upload-Token': s.svr.token };
    const init = s.call('POST', '/api/upload/init$', mkReq({
        body: JSON.stringify({ name: 'b.litematic', size: 100 }), headers: hdr,
    }));
    const id = JSON.parse(init.body).uploadId;
    const res = s.call('POST', '/api/upload/chunk$', mkReq({
        body: JSON.stringify({ uploadId: id, seq: 0, data: '这不是 base64!!' }), headers: hdr,
    }));
    assert.strictEqual(res.status, 400);
});

check('列目录只返回结构文件；上传后 list 能看到', () => {
    const s = mkServer('list');
    const before = JSON.parse(s.call('GET', '/api/list$', mkReq({
        method: 'GET', headers: { 'X-Upload-Token': s.svr.token },
    })).body);
    assert.strictEqual(before.files.length, 0);

    uploadFull(s, '可见.litematic', fakeLitematic(256));
    fs.writeFileSync(path.join(s.targetDir, 'readme.txt'), 'x');

    const after = JSON.parse(s.call('GET', '/api/list$', mkReq({
        method: 'GET', headers: { 'X-Upload-Token': s.svr.token },
    })).body);
    assert.strictEqual(after.files.length, 1, '只应列出 .litematic/.mcstructure');
    assert.strictEqual(after.files[0].name, '可见.litematic');
});

check('清理 6 小时前的残片，保留新鲜的', () => {
    const s = mkServer('stale');
    const partDir = path.join(s.targetDir, '.uploading');
    const oldPart = path.join(partDir, 'old.part');
    const newPart = path.join(partDir, 'new.part');
    fs.writeFileSync(oldPart, 'x');
    fs.writeFileSync(newPart, 'x');
    const past = Date.now() - 7 * 60 * 60 * 1000;
    fs.utimesSync(oldPart, past / 1000, past / 1000);
    const n = s.svr._cleanStaleParts();
    assert.strictEqual(n, 1);
    assert.strictEqual(fs.existsSync(oldPart), false);
    assert.strictEqual(fs.existsSync(newPart), true);
});

console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) { /* ignore */ }
process.exit(fail ? 1 : 0);
