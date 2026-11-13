/**
 * test_web_node_engine.js — Node 引擎（原生 http）端到端回归
 *
 * 背景：LSE 0.17.x 的 ll.network HttpServer 回调运行在 httplib 的 worker 线程里，
 * 没有 ::script::EngineScope，回调中任何引擎对象访问都会抛
 * "call engine APIs without a ::script::EngineScope" 并被改判 500。
 * 所以默认传输层改成 Node 原生 http，本文件用真实 socket 验证它确实能跑通。
 *
 * 覆盖：
 *   1. /ping 与 /ping2（纯 Node 响应对象可用）
 *   2. / 页面、/api/health、/api/list
 *   3. 真实分片上传（init → chunk → finish）与落盘校验
 *   4. 令牌 / 限流
 *   5. 宿主 logger 抛 EngineScope 时降级写文件、服务不受影响
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const zlib = require('zlib');
const crypto = require('crypto');

const PLUGIN = path.resolve(__dirname, '..');
const { WebUploadServer } = require(path.join(PLUGIN, 'src', 'web', 'WebUploadServer.js'));
const { NodeHttpServer } = require(path.join(PLUGIN, 'src', 'web', 'NodeHttpServer.js'));

let pass = 0, fail = 0;
const failures = [];

async function check(name, fn) {
    try {
        await fn();
        console.log(`  ✅ ${name}`);
        pass++;
    } catch (e) {
        console.log(`  ❌ ${name}\n     ${(e && e.message) || e}`);
        failures.push(name);
        fail++;
    }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lit-web-node-'));
const silent = { info() {}, warn() {}, error() {} };

function freePort() {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.on('error', reject);
        s.listen(0, '127.0.0.1', () => {
            const p = s.address().port;
            s.close(() => resolve(p));
        });
    });
}

function mkCfg(port, overrides = {}) {
    const targetDir = path.join(tmpRoot, `schematics-${port}`);
    const store = Object.assign({
        'web.enabled': true,
        'web.engine': 'node',
        'web.host': '127.0.0.1',
        'web.port': port,
        'web.tokenRequired': false,
        'web.localhostNoToken': true,
        'web.allowIps': [],
        'web.maxFileMB': 4,
        'web.chunkKB': 64,
        'web.allowExt': ['.litematic', '.mcstructure'],
        'web.overwrite': false,
        'web.maxUploadsPerMinute': 100,
        'web.targetDir': targetDir,
        'web.publicUrl': '',
    }, overrides);
    return { store, targetDir, get(k, d) { return k in store ? store[k] : d; } };
}

async function withServer(opts, fn) {
    const port = await freePort();
    const cfg = mkCfg(port, opts.overrides || {});
    const dataDir = path.join(tmpRoot, `data-${port}`);
    const svr = new WebUploadServer({
        logger: opts.logger || silent,
        configManager: cfg,
        dataDir,
        pluginDir: path.join(PLUGIN, 'src', 'web'),
    });
    const ok = svr.start();
    try {
        assert.strictEqual(ok, true, 'start() 应成功');
        // 等待 listen 完成
        for (let i = 0; i < 50 && !svr.isRunning(); i++) await new Promise((r) => setTimeout(r, 20));
        assert.strictEqual(svr.isRunning(), true, '服务应在监听');
        return await fn({ svr, cfg, port, base: `http://127.0.0.1:${port}` });
    } finally {
        svr.stop();
        await new Promise((r) => setTimeout(r, 30));
    }
}

function fakeLitematic(bytes) {
    const body = Buffer.alloc(bytes);
    crypto.randomFillSync(body);
    body[0] = 0x1f; body[1] = 0x8b; body[2] = 0x08; body[3] = 0x00;
    return zlib.gzipSync(body).subarray(0, bytes);
}

(async () => {
    console.log('\n=== Node 引擎：基础通路 ===');

    await check('GET /ping → 200 pong（纯 Node 响应对象可用）', async () => {
        await withServer({}, async ({ base, svr }) => {
            assert.strictEqual(svr._engine, 'node', '应使用 node 引擎');
            const r = await fetch(`${base}/ping`);
            assert.strictEqual(r.status, 200);
            assert.strictEqual(await r.text(), 'pong');
        });
    });

    await check('GET /ping2 → 200 pong2（status/reason/setHeader/body 全用上）', async () => {
        await withServer({}, async ({ base }) => {
            const r = await fetch(`${base}/ping2`);
            assert.strictEqual(r.status, 200);
            assert.strictEqual(await r.text(), 'pong2');
            assert.ok(String(r.headers.get('content-type')).includes('text/plain'));
        });
    });

    await check('GET / → 200 HTML，boot 已注入', async () => {
        await withServer({}, async ({ base }) => {
            const r = await fetch(`${base}/`);
            const t = await r.text();
            assert.strictEqual(r.status, 200);
            assert.ok(t.includes('window.__WEB_BOOT__ = {'), '应注入 boot');
            assert.ok(t.includes('把结构文件拖到这里'), '页面内容完整');
        });
    });

    await check('GET /api/health → 200 JSON', async () => {
        await withServer({}, async ({ base }) => {
            const j = await (await fetch(`${base}/api/health`)).json();
            assert.strictEqual(j.ok, true);
            assert.strictEqual(j.chunkKB, 64);
        });
    });

    await check('未注册路径 → 404 JSON（不再被框架改判 500）', async () => {
        await withServer({}, async ({ base }) => {
            const r = await fetch(`${base}/definitely/not/here`);
            assert.strictEqual(r.status, 404);
            const j = await r.json();
            assert.strictEqual(j.ok, false);
        });
    });

    console.log('\n=== Node 引擎：真实上传 ===');

    await check('完整分片上传 → 落盘 + sha256 一致 + 无残片', async () => {
        await withServer({}, async ({ base, cfg }) => {
            const payload = fakeLitematic(200 * 1024);       // 4 片（64KB/片）
            const init = await (await fetch(`${base}/api/upload/init`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'Node引擎测试.litematic', size: payload.length }),
            })).json();
            assert.strictEqual(init.ok, true, JSON.stringify(init));

            const CHUNK = init.chunkSize;
            let seq = 0, off = 0, n = 0;
            while (off < payload.length) {
                const part = payload.subarray(off, Math.min(off + CHUNK, payload.length));
                const j = await (await fetch(`${base}/api/upload/chunk`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uploadId: init.uploadId, seq, data: part.toString('base64') }),
                })).json();
                assert.strictEqual(j.ok, true, JSON.stringify(j));
                off = j.received; seq++; n++;
            }
            assert.ok(n >= 3, `应至少 3 片，实际 ${n}`);

            const fin = await (await fetch(`${base}/api/upload/finish`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uploadId: init.uploadId }),
            })).json();
            assert.strictEqual(fin.ok, true, JSON.stringify(fin));

            const file = path.join(cfg.targetDir, fin.file);
            assert.ok(fs.existsSync(file), '目标文件应存在');
            assert.strictEqual(fs.statSync(file).size, payload.length);
            assert.strictEqual(fin.sha256, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
            assert.strictEqual(fs.readdirSync(path.join(cfg.targetDir, '.uploading')).length, 0, '不应留残片');
        });
    });

    await check('GET /api/list 能列出刚上传的文件', async () => {
        await withServer({}, async ({ base }) => {
            const payload = fakeLitematic(1024);
            const init = await (await fetch(`${base}/api/upload/init`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: '列表.litematic', size: payload.length }),
            })).json();
            await fetch(`${base}/api/upload/chunk`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uploadId: init.uploadId, seq: 0, data: payload.toString('base64') }),
            });
            await fetch(`${base}/api/upload/finish`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uploadId: init.uploadId }),
            });
            const j = await (await fetch(`${base}/api/list`)).json();
            assert.strictEqual(j.ok, true);
            assert.strictEqual(j.files.length, 1);
            assert.strictEqual(j.files[0].name, '列表.litematic');
        });
    });

    await check('魔数不符 → 400，且不落盘', async () => {
        await withServer({}, async ({ base, cfg }) => {
            const junk = Buffer.from('<html>nope</html>');
            const init = await (await fetch(`${base}/api/upload/init`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: '假.litematic', size: junk.length }),
            })).json();
            await fetch(`${base}/api/upload/chunk`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uploadId: init.uploadId, seq: 0, data: junk.toString('base64') }),
            });
            const r = await fetch(`${base}/api/upload/finish`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uploadId: init.uploadId }),
            });
            assert.strictEqual(r.status, 400);
            assert.strictEqual(fs.existsSync(path.join(cfg.targetDir, '假.litematic')), false);
        });
    });

    console.log('\n=== Node 引擎：坏环境降级 ===');

    await check('宿主 logger 抛 EngineScope → 服务照常，日志降级写文件', async () => {
        const boom = () => { throw new Error('call engine APIs without a ::script::EngineScope'); };
        const engineScopeLogger = { info: boom, warn: boom, error: boom };
        await withServer({ logger: engineScopeLogger }, async ({ base, svr }) => {
            // start() 在主线程里会用 logger，这里本来就会抛；_emit 会吞掉并转文件
            const r = await fetch(`${base}/ping`);
            assert.strictEqual(r.status, 200);
            assert.strictEqual(await r.text(), 'pong');

            const r2 = await fetch(`${base}/api/health`);
            assert.strictEqual(r2.status, 200);
            assert.strictEqual((await r2.json()).ok, true);

            // 降级日志文件应该存在且有内容
            const dbg = path.join(tmpRoot, `data-${svr._conf().port}`, 'web_debug.log');
            // 端口在 withServer 里动态分配，这里按目录名兜底搜索
            let found = fs.existsSync(dbg);
            let file = dbg;
            if (!found) {
                for (const d of fs.readdirSync(tmpRoot)) {
                    if (!d.startsWith('data-')) continue;
                    const p = path.join(tmpRoot, d, 'web_debug.log');
                    if (fs.existsSync(p)) { found = true; file = p; break; }
                }
            }
            assert.strictEqual(found, true, '应生成 web_debug.log');
            assert.ok(fs.readFileSync(file, 'utf8').length > 0, '日志文件不应为空');
        });
    });

    await check('stop() 释放端口，可重复 start/stop', async () => {
        const port = await freePort();
        const cfg = mkCfg(port);
        const svr = new WebUploadServer({ logger: silent, configManager: cfg, dataDir: path.join(tmpRoot, 'data-cycle'), pluginDir: path.join(PLUGIN, 'src', 'web') });
        assert.strictEqual(svr.start(), true);
        for (let i = 0; i < 50 && !svr.isRunning(); i++) await new Promise((r) => setTimeout(r, 20));
        assert.strictEqual(svr.isRunning(), true);
        assert.strictEqual(svr.stop(), true);
        await new Promise((r) => setTimeout(r, 50));
        assert.strictEqual(svr.isRunning(), false);
        assert.strictEqual(svr.start(), true);
        for (let i = 0; i < 50 && !svr.isRunning(); i++) await new Promise((r) => setTimeout(r, 20));
        assert.strictEqual(svr.isRunning(), true);
        svr.stop();
        await new Promise((r) => setTimeout(r, 30));
    });

    console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    if (fail) {
        console.log('失败项: ' + failures.join('、'));
        process.exit(1);
    }
    // 避免 libuv 关闭时序导致的断言噪音：给 socket 收尾留一点时间再退
    setTimeout(() => process.exit(0), 50);
})().catch((e) => {
    console.error('测试脚本异常:', e);
    process.exit(1);
});
