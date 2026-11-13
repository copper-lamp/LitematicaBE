/**
 * test_update_checker.js — 版本更新检查（启动时一次）离线回归
 *
 * 覆盖：
 *   1. 版本号解析与比较（v 前缀 / 缺段 / -prerelease）
 *   2. 响应解析：302 location、API JSON 单对象、镜像的 /releases 数组（跳过 draft/预发布）、HTML 门户页
 *   3. checkOnce 全链路：官方 API 成功 → 官方网页 302 兜底 → 镜像（若配置）→ 全挂报错
 *   4. 只查一次：第二次 checkOnce 直接 false，不再发请求
 *   5. 开关：updateCheck.enabled=false 时零请求、结果 disabled、日志不打印
 *   6. 日志文案精确匹配（[LitematicaBE]发现新版本vX.Y.Z，前往…以了解更多 / [LitematicaBE]当前已是最新版本）
 *   7. **铁律**：异步回调里不许出现引擎对象（静态扫描 + 注入抛 EngineScope 的假全局）
 *   8. index.js 装配：只在 onServerStarted 发起一次、一次性 tick 任务打印、无周期/退避/OP 提示/version 命令
 *   9. ConfigManager / config.json：updateCheck 只有 enabled / repo / mirror / timeoutMs
 *
 * 全程不联网：fetcher 一律注入假实现（唯一例外是本地回环 socket 上的 302 语义测试）。
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

const PLUGIN = path.resolve(__dirname, '..');
const UPDATE_SRC = fs.readFileSync(path.join(PLUGIN, 'src', 'net', 'UpdateChecker.js'), 'utf8');
const INDEX_SRC = fs.readFileSync(path.join(PLUGIN, 'index.js'), 'utf8');
const CONFIG_JSON = fs.readFileSync(path.join(PLUGIN, 'config.json'), 'utf8');

const {
    UpdateChecker,
    compareVersions,
    parseVersion,
    stripVersionPrefix,
    parseRedirectTag,
    extractTag,
    formatLogLine,
    fetchOnce,
} = require(path.join(PLUGIN, 'src', 'net', 'UpdateChecker.js'));

let pass = 0, fail = 0;
async function check(name, fn) {
    try {
        await fn();
        console.log(`  ✅ ${name}`);
        pass++;
    } catch (e) {
        console.log(`  ❌ ${name}\n     ${(e && e.message) || e}`);
        fail++;
    }
}

const tick = () => new Promise((r) => setImmediate(r));
/** 让候选链（可能连试 3 个 URL）跑干净 */
async function flush() {
    for (let i = 0; i < 8; i++) await tick();
}

const REPO = 'copper-lamp/LitematicaBE';
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const HTML_URL = `https://github.com/${REPO}/releases/latest`;
const HOME = `https://github.com/${REPO}`;

function rel(tag, extra) {
    return Object.assign({ tag_name: tag, draft: false, prerelease: /-/.test(tag) }, extra || {});
}
function jsonRes(obj, status) {
    return { status: status === undefined ? 200 : status, headers: {}, location: '', body: JSON.stringify(obj) };
}
function redirectRes(location, status) {
    return { status: status === undefined ? 302 : status, headers: { location }, location, body: '' };
}
function fakeFetcher(plan) {
    const calls = [];
    const fn = (url, opts) => {
        calls.push({ url, opts });
        const step = plan[calls.length - 1];
        if (typeof step === 'function') return step(url, opts);
        if (step instanceof Error) return Promise.reject(step);
        if (step) return Promise.resolve(step);
        return Promise.reject(new Error('假 fetcher 没有为第 ' + calls.length + ' 次请求准备响应'));
    };
    fn.calls = calls;
    return fn;
}
function makeChecker(cfg, fetcher, current) {
    const store = Object.assign({
        'updateCheck.enabled': true,
        'updateCheck.repo': REPO,
        'updateCheck.mirror': '',
        'updateCheck.timeoutMs': 8000,
    }, cfg || {});
    return new UpdateChecker({
        currentVersion: current || '3.1.0',
        getConfig: (k, d) => (k in store ? store[k] : d),
        fetcher,
    });
}

async function main() {
    console.log('\n=== 版本更新检查（启动时一次） ===');

    // ═══════════ 1. 版本号 ═══════════
    await check('版本号解析：v 前缀 / 缺段 / prerelease', () => {
        assert.strictEqual(stripVersionPrefix('v3.1.0'), '3.1.0');
        assert.strictEqual(stripVersionPrefix('release/v3.1.0'), '3.1.0');
        assert.deepStrictEqual(parseVersion('v3.1').core, [3, 1, 0]);
        assert.deepStrictEqual(parseVersion('3.0.3-test.6').pre, ['test', '6']);
        assert.strictEqual(parseVersion('').valid, false);
    });

    await check('版本比较：真 semver（不是字符串比较）', () => {
        assert.strictEqual(compareVersions('v3.2.0', '3.1.0'), 1);
        assert.strictEqual(compareVersions('v3.1.0', '3.1.0'), 0);
        assert.strictEqual(compareVersions('3.1.0', '3.2.0'), -1);
        assert.strictEqual(compareVersions('3.10.0', '3.9.9'), 1);
        assert.strictEqual(compareVersions('3.1.0', '3.1.0-test.1'), 1);
        assert.strictEqual(compareVersions('3.0.3-test.6', '3.1.0'), -1);
    });

    // ═══════════ 2. 响应解析 ═══════════
    await check('parseRedirectTag：从 302 的 location 抠 tag', () => {
        assert.strictEqual(parseRedirectTag(`https://github.com/${REPO}/releases/tag/v3.2.0`), 'v3.2.0');
        assert.strictEqual(parseRedirectTag(`https://github.com/${REPO}/releases/tag/3.2.0?x=1`), '3.2.0');
        assert.strictEqual(parseRedirectTag(`https://github.com/${REPO}/releases/latest`), '');
    });

    await check('extractTag：302 / JSON 单对象 / 列表 / HTML 门户页', () => {
        assert.strictEqual(extractTag(redirectRes(`https://github.com/${REPO}/releases/tag/v3.2.0`)), 'v3.2.0');
        assert.strictEqual(extractTag(jsonRes(rel('v3.2.0'))), 'v3.2.0');
        assert.strictEqual(extractTag(jsonRes(rel('v3.2.0', { draft: true }))), '', 'draft 不算');
        assert.strictEqual(extractTag(jsonRes(rel('v3.2.0-rc.1'))), '', '预发布不算');
        assert.strictEqual(extractTag({
            status: 200, headers: {}, location: '', body: '<!DOCTYPE html><html>…',
        }), '', 'HTML 门户页不算');
        assert.strictEqual(extractTag({ status: 404, headers: {}, location: '', body: '{}' }), '');
        // 镜像透传 /releases 列表：按版本取最大
        assert.strictEqual(extractTag(jsonRes([rel('v3.1.0'), rel('v3.3.0'), rel('v3.2.0')])), 'v3.3.0');
    });

    await check('formatLogLine：两条成功文案与失败文案（逐字）', () => {
        assert.strictEqual(
            formatLogLine({ status: 'update', latest: '3.2.0' }, { home: HOME }),
            '[LitematicaBE]发现新版本v3.2.0，前往https://github.com/copper-lamp/LitematicaBE以了解更多');
        assert.strictEqual(
            formatLogLine({ status: 'latest' }, { home: HOME }),
            '[LitematicaBE]当前已是最新版本');
        assert.strictEqual(
            formatLogLine({ status: 'error', error: '请求超时 8000ms' }, { home: HOME }),
            '[LitematicaBE]版本检查失败：请求超时 8000ms');
        assert.strictEqual(formatLogLine({ status: 'disabled' }), '', '关闭时不出日志');
        assert.strictEqual(formatLogLine(null), '');
    });

    // ═══════════ 3. checkOnce 全链路 ═══════════
    await check('官方 API 有新版本 → status=update，latest 去 v 前缀', async () => {
        const fetcher = fakeFetcher([jsonRes(rel('v3.2.0'))]);
        const uc = makeChecker({}, fetcher);
        assert.strictEqual(uc.checkOnce(), true);
        await flush();
        const r = uc.takeResult();
        assert.strictEqual(r.status, 'update');
        assert.strictEqual(r.latest, '3.2.0');
        assert.strictEqual(r.current, '3.1.0');
        assert.strictEqual(r.source, API_URL);
        assert.strictEqual(fetcher.calls.length, 1, '官方 API 成功就不该再试其它地址');
        assert.strictEqual(fetcher.calls[0].url, API_URL);
        assert.strictEqual(fetcher.calls[0].opts.redirectsLeft, 0, '必须不跟随跳转（否则拿到 HTML）');
        assert.ok(/LitematicaBE/.test(fetcher.calls[0].opts.headers['User-Agent']));
        assert.strictEqual(uc.takeResult(), null, 'takeResult 取走即清空');
    });

    await check('官方 API 版本相同/更低 → status=latest', async () => {
        for (const tag of ['v3.1.0', 'v3.0.9']) {
            const uc = makeChecker({}, fakeFetcher([jsonRes(rel(tag))]));
            uc.checkOnce();
            await flush();
            assert.strictEqual(uc.takeResult().status, 'latest', `tag=${tag}`);
        }
    });

    await check('官方 API 挂了 → 官方网页 302 兜底成功', async () => {
        const fetcher = fakeFetcher([
            { status: 500, headers: {}, location: '', body: '' },
            redirectRes(`https://github.com/${REPO}/releases/tag/v3.2.0`),
        ]);
        const uc = makeChecker({}, fetcher);
        uc.checkOnce();
        await flush();
        const r = uc.takeResult();
        assert.strictEqual(r.status, 'update');
        assert.strictEqual(r.latest, '3.2.0');
        assert.strictEqual(r.source, HTML_URL);
        assert.deepStrictEqual(fetcher.calls.map((c) => c.url), [API_URL, HTML_URL]);
    });

    await check('官方两路都挂 → 用配置的镜像（{repo} 占位已替换）', async () => {
        const mirror = 'https://gh-proxy.com/https://api.github.com/repos/{repo}/releases/latest';
        const fetcher = fakeFetcher([
            new Error('getaddrinfo ENOTFOUND api.github.com'),
            new Error('getaddrinfo ENOTFOUND github.com'),
            jsonRes(rel('v3.2.0')),
        ]);
        const uc = makeChecker({ 'updateCheck.mirror': mirror }, fetcher);
        uc.checkOnce();
        await flush();
        const r = uc.takeResult();
        assert.strictEqual(r.status, 'update');
        assert.strictEqual(r.source, mirror.replace('{repo}', REPO));
        assert.strictEqual(fetcher.calls.length, 3);
        assert.strictEqual(fetcher.calls[2].url, mirror.replace('{repo}', REPO));
    });

    await check('没配镜像时只有官方两路；两路全挂 → status=error（带原因）', async () => {
        const fetcher = fakeFetcher([
            new Error('getaddrinfo ENOTFOUND api.github.com'),
            { status: 404, headers: {}, location: '', body: 'Not Found' },
        ]);
        const uc = makeChecker({}, fetcher);
        uc.checkOnce();
        await flush();
        const r = uc.takeResult();
        assert.strictEqual(r.status, 'error');
        assert.ok(/404/.test(r.error), `错误信息应带最后一次原因，实际：${r.error}`);
        assert.strictEqual(fetcher.calls.length, 2, '没镜像就只有官方两路');
    });

    await check('旧键 checkUrl 仍可当镜像用（向后兼容）', async () => {
        const fetcher = fakeFetcher([
            new Error('boom'),
            new Error('boom'),
            jsonRes(rel('v3.2.0')),
        ]);
        const uc = makeChecker({ 'updateCheck.checkUrl': 'https://mirror.example/{repo}/latest' }, fetcher);
        uc.checkOnce();
        await flush();
        assert.strictEqual(uc.takeResult().status, 'update');
        assert.strictEqual(fetcher.calls[2].url, `https://mirror.example/${REPO}/latest`);
    });

    await check('只查一次：第二次 checkOnce 直接 false，不发新请求', async () => {
        const fetcher = fakeFetcher([jsonRes(rel('v3.2.0'))]);
        const uc = makeChecker({}, fetcher);
        assert.strictEqual(uc.checkOnce(), true);
        await flush();
        assert.strictEqual(uc.checkOnce(), false);
        assert.strictEqual(fetcher.calls.length, 1);
    });

    await check('enabled=false：零请求，结果 disabled，无日志行', async () => {
        const fetcher = fakeFetcher([]);
        const uc = makeChecker({ 'updateCheck.enabled': false }, fetcher);
        assert.strictEqual(uc.checkOnce(), false);
        await flush();
        assert.strictEqual(fetcher.calls.length, 0, '关闭时一个请求都不许发');
        const r = uc.takeResult();
        assert.strictEqual(r.status, 'disabled');
        assert.strictEqual(formatLogLine(r, { home: HOME }), '');
        assert.strictEqual(uc.isEnabled(), false);
    });

    await check('enabled 接受 "false"/0 等写法', () => {
        for (const v of [false, 'false', '0', 'off', 'no']) {
            assert.strictEqual(makeChecker({ 'updateCheck.enabled': v }, fakeFetcher([])).isEnabled(), false, String(v));
        }
        for (const v of [true, 'true', '1', 'on', 1]) {
            assert.strictEqual(makeChecker({ 'updateCheck.enabled': v }, fakeFetcher([])).isEnabled(), true, String(v));
        }
    });

    await check('非法 repo（协议/路径穿越/空格）回落默认仓库', () => {
        for (const bad of ['../../../etc/passwd', 'https://evil.com/x', 'a b/c', '']) {
            const uc = makeChecker({ 'updateCheck.repo': bad }, fakeFetcher([]));
            assert.strictEqual(uc.repo(), REPO, `repo=${bad}`);
            assert.strictEqual(uc.candidates()[0], API_URL);
        }
    });

    await check('homeUrl() 指向项目主页（日志里「前往 … 以了解更多」）', () => {
        assert.strictEqual(makeChecker({}, fakeFetcher([])).homeUrl(), HOME);
    });

    // ═══════════ 4. 铁律：异步回调不许碰引擎对象 ═══════════
    await check('静态扫描：UpdateChecker 全文件没有 logger / mc / player / ll', () => {
        // 先剥注释：文件头的"铁律"说明里本来就会出现 logger 这个词。
        // 行注释只在 // 前是行首或空白时剥 —— 免得把 "https://…" 里的 // 当注释切掉。
        const code = UPDATE_SRC
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split('\n')
            .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
            .join('\n');
        for (const re of [/\blogger\b/, /\bmc\./, /\bplayer\b/, /\bll\./, /\bFile\./]) {
            const m = code.match(re);
            assert.ok(!m, `代码里出现了引擎对象 ${m && m[0]}（网络回调里会抛 EngineScope）`);
        }
    });

    await check('注入必抛 EngineScope 的假全局也不影响流程', async () => {
        const saved = { logger: global.logger, mc: global.mc, ll: global.ll };
        const boom = () => { throw new Error('call engine APIs without a ::script::EngineScope'); };
        global.logger = { info: boom, warn: boom, error: boom, debug: boom };
        global.mc = { getOnlinePlayers: boom, newCommand: boom };
        global.ll = { getLogger: boom };
        try {
            const uc = makeChecker({}, fakeFetcher([jsonRes(rel('v3.2.0'))]));
            uc.checkOnce();
            await flush();
            assert.strictEqual(uc.takeResult().status, 'update');
        } finally {
            global.logger = saved.logger;
            global.mc = saved.mc;
            global.ll = saved.ll;
        }
    });

    await check('fetchOnce：redirectsLeft=0 只读 302，默认才跟随（真实回环 socket）', async () => {
        const server = http.createServer((req, res) => {
            if (req.url === '/html') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<!DOCTYPE html><title>portal</title>');
                return;
            }
            if (req.url === '/tag') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(rel('v3.2.0')));
                return;
            }
            res.writeHead(302, { Location: '/tag' });
            res.end();
        });
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        const port = server.address().port;
        try {
            const noFollow = await fetchOnce(`http://127.0.0.1:${port}/latest`, { redirectsLeft: 0, timeoutMs: 3000 });
            assert.strictEqual(noFollow.status, 302);
            assert.ok(String(noFollow.location).indexOf('/tag') >= 0, '不跟随时要拿到 location');

            const follow = await fetchOnce(`http://127.0.0.1:${port}/latest`, { timeoutMs: 3000 });
            assert.strictEqual(follow.status, 200, '默认应跟随跳转');
            assert.strictEqual(extractTag(follow), 'v3.2.0');
        } finally {
            await new Promise((r) => server.close(r));
        }
    });

    // ═══════════ 5. index.js 装配 ═══════════
    await check('index.js：只在 onServerStarted 发起一次', () => {
        assert.ok(/require\('\.\/src\/net\/UpdateChecker'\)/.test(INDEX_SRC));
        assert.ok(/new UpdateChecker\(\{/.test(INDEX_SRC));
        assert.ok(/currentVersion:\s*PLUGIN_VERSION/.test(INDEX_SRC), '当前版本必须取 PLUGIN_VERSION');
        assert.ok(/global\.updateChecker\s*=\s*updateChecker/.test(INDEX_SRC));

        const block = INDEX_SRC.match(/mc\.listen\('onServerStarted',[\s\S]{0,400}/);
        assert.ok(block, '找不到 onServerStarted');
        assert.ok(/startUpdateCheck\(\)/.test(block[0]), 'onServerStarted 里没有发起检查');

        const fired = INDEX_SRC.match(/startUpdateCheck\(\);/g) || [];
        assert.strictEqual(fired.length, 1, `startUpdateCheck() 只该在一处调用，实际 ${fired.length} 处`);
        assert.ok(/if \(updateCheckFired\) return false;/.test(INDEX_SRC), '需要幂等标志');
    });

    await check('index.js：一次性 tick 任务负责打印，打完就摘掉', () => {
        assert.ok(/renderScheduler\.add\('update-check',\s*\(\)\s*=>\s*drainUpdateCheck\(\)/.test(INDEX_SRC),
            '没有把打印挂进调度器任务（网络回调里不能 log）');
        assert.ok(/renderScheduler\.remove\('update-check'\)/.test(INDEX_SRC), '一次性任务打完必须摘掉');
        assert.ok(/formatLogLine\(r,/.test(INDEX_SRC), '日志文案应走 formatLogLine（可单测）');
        assert.ok(/if \(updateChecker\.isEnabled\(\)\) \{\s*\n\s*renderScheduler\.add\('update-check'/
            .test(INDEX_SRC), '关闭时不该注册任务');
    });

    await check('index.js：周期/退避/OP 提示/version 命令都已移除', () => {
        for (const [re, name] of [
            [/intervalHours/, '周期复查'],
            [/delaySeconds/, '启动延迟'],
            [/nextRetryAt|_retryDelay/, '失败退避'],
            [/notifyOpsOnJoin|UPDATE_NOTIFIED|broadcastUpdateToOps/, 'OP 提示'],
            [/mc\.listen\('onJoin'/, 'onJoin 监听'],
            [/handleVersionCommand/, 'version 命令实现'],
            [/case "version"/, 'version 命令分支'],
            [/"select",\s*"version"/, 'ActionEnum 里的 version'],
        ]) {
            assert.ok(!re.test(INDEX_SRC), `${name} 应已移除（本轮要求"只启动查一次、只打日志"）`);
        }
    });

    await check('index.js：日志前缀常量存在，文案与要求逐字一致', () => {
        assert.ok(/const UPDATE_LOG_TAG = '\[LitematicaBE\]'/.test(INDEX_SRC));
        // 用同一份 formatLogLine 复算，确认最终打印出来的两行就是要求的文案
        const update = formatLogLine({ status: 'update', latest: '3.2.0' }, {
            tag: '[LitematicaBE]', home: HOME,
        });
        assert.strictEqual(update, '[LitematicaBE]发现新版本v3.2.0，前往https://github.com/copper-lamp/LitematicaBE以了解更多');
        const latest = formatLogLine({ status: 'latest' }, { tag: '[LitematicaBE]', home: HOME });
        assert.strictEqual(latest, '[LitematicaBE]当前已是最新版本');
    });

    // ═══════════ 6. 配置 ═══════════
    await check('ConfigManager 默认配置：updateCheck 只有 4 个键，旧键已删', () => {
        const fileStore = new Map();
        global.File = {
            exists: (p) => fileStore.has(p),
            readFrom: (p) => fileStore.get(p) || '',
            writeTo: (p, c) => { fileStore.set(p, c); return true; },
            mkdir: () => true,
        };
        global.logger = { info() { }, warn() { }, error() { }, debug() { } };
        const { ConfigManager } = require(path.join(PLUGIN, 'src', 'core', 'ConfigManager.js'));
        const cm = new ConfigManager();
        assert.strictEqual(cm.get('updateCheck.enabled'), true);
        assert.strictEqual(cm.get('updateCheck.repo'), REPO);
        assert.strictEqual(cm.get('updateCheck.mirror'), '');
        assert.strictEqual(cm.get('updateCheck.timeoutMs'), 8000);
        for (const gone of ['channel', 'intervalHours', 'delaySeconds', 'notifyOpsOnJoin', 'verbose', 'checkUrl', 'apiBase', 'htmlBase']) {
            assert.strictEqual(cm.get(`updateCheck.${gone}`, null), null, `旧键 updateCheck.${gone} 应已删除`);
        }
    });

    await check('config.json 模板：updateCheck 段可解析且键集合精确', () => {
        const { ConfigManager } = require(path.join(PLUGIN, 'src', 'core', 'ConfigManager.js'));
        global.File = { exists: () => false, readFrom: () => '', writeTo: () => true, mkdir: () => true };
        global.logger = { info() { }, warn() { }, error() { }, debug() { } };
        const cm = new ConfigManager();
        const parsed = JSON.parse(cm.removeComments(CONFIG_JSON));
        assert.ok(parsed.updateCheck, 'config.json 缺 updateCheck 段');
        assert.deepStrictEqual(Object.keys(parsed.updateCheck).sort(),
            ['enabled', 'mirror', 'repo', 'timeoutMs']);
        assert.strictEqual(parsed.updateCheck.enabled, true);
        assert.strictEqual(parsed.updateCheck.mirror, '');
    });

    console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
    process.exit(fail ? 1 : 0);
}

main().catch((e) => {
    console.error('测试脚本自身异常：', e);
    process.exit(1);
});
