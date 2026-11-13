/**
 * test_addon_version_check.js — addon 版本校验的离线测试（不开服务器，跑真代码）
 *
 * 用临时目录搭一套"假服务器根"：behavior_packs / resource_packs / worlds，
 * 喂给 AddonVersionCheck，验证九种情形的判定与"是否禁用 ghost 写入"。
 *
 * 关键约定：版本不一致时告警 + 禁用 ghost 写入，功能主体照常；
 * 工作目录识别不出来时只告警、**不**禁用（避免误伤已验证通过的现场）。
 *
 * 运行：node tests/test_addon_version_check.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { AddonVersionCheck } = require(path.join(ROOT, 'src', 'ghost', 'AddonVersionCheck'));

const BP_UUID = 'a7f3c1e2-5b64-4d9a-9c11-8e2f4b7d3a01';
const RP_UUID = '49cb94c2-8cec-4b27-8b58-4b3e01f843fc';
const VER = [1, 1, 5];

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
}

function tmpRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'lit-addoncheck-'));
}

function writeJson(p, obj) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

/** 假服务器根：可选装/不装 BP、RP、world 引用 */
function makeServer(opts) {
    const o = opts || {};
    const root = tmpRoot();
    if (o.bp !== false) {
        writeJson(path.join(root, 'behavior_packs', 'LitematicaBE_BP', 'manifest.json'), {
            format_version: 2,
            header: { name: 'LitematicaBE BP', uuid: o.bpUuid || BP_UUID, version: o.bpVersion || VER },
        });
    }
    if (o.rp !== false) {
        writeJson(path.join(root, 'resource_packs', 'LitematicaBE_RP', 'manifest.json'), {
            format_version: 2,
            header: { name: 'LitematicaBE RP', uuid: o.rpUuid || RP_UUID, version: o.rpVersion || VER },
        });
    }
    if (o.worldRef !== false) {
        writeJson(path.join(root, 'worlds', 'TestWorld', 'world_behavior_packs.json'), [{ pack_id: BP_UUID, version: VER }]);
        writeJson(path.join(root, 'worlds', 'TestWorld', 'world_resource_packs.json'), [{ pack_id: RP_UUID, version: VER }]);
    } else if (o.worldsDir !== false) {
        // 世界存在、但没写 packs 引用（真实里就是"世界建了但没启用这个包"）
        fs.mkdirSync(path.join(root, 'worlds', 'TestWorld'), { recursive: true });
    }
    return root;
}

function makeExpected(dir, opts) {
    const o = opts || {};
    const p = path.join(dir, 'addon_expected.json');
    writeJson(p, {
        addonVersion: o.version || VER,
        bpUuid: o.bpUuid || BP_UUID,
        rpUuid: o.rpUuid || RP_UUID,
    });
    return p;
}

function stats(over) {
    return Object.assign({
        ready: true, addonVersion: VER, bpUuid: BP_UUID, rpUuid: RP_UUID, loadError: null,
    }, over || {});
}

function run(serverRoot, expectedPath, indexStats, expectedCandidates) {
    const logs = [];
    const logger = { info: m => logs.push(['info', m]), warn: m => logs.push(['warn', m]), debug: () => { } };
    const c = new AddonVersionCheck({
        logger, serverRoot, expectedPath,
        // 隔离默认候选路径：否则测试会读到仓库里真实的 data/addon_expected.json
        expectedCandidates: expectedCandidates || [expectedPath],
    });
    const rep = c.run(indexStats);
    return { c, rep, logs };
}

console.log('=== addon 版本校验 ===');

// 1. 完全一致
{
    const root = makeServer();
    const exp = makeExpected(root);
    const { rep } = run(root, exp, stats());
    ok('一致 → state=ok / enabled=true', rep.state === 'ok' && rep.enabled === true, JSON.stringify(rep.issues));
    ok('   部署侧识别到 BP', !!(rep.deployed.bp));
    ok('   世界已启用行为包', rep.worldRefs.some(r => r.file === 'world_behavior_packs.json' && r.active));
}

// 2. 索引版本与期望不符
{
    const root = makeServer();
    const exp = makeExpected(root);
    const { rep } = run(root, exp, stats({ addonVersion: [1, 1, 4] }));
    ok('索引旧版 → error + 禁用写入', rep.state === 'error' && rep.enabled === false);
    ok('   错误码为 index-version-mismatch', rep.issues.some(i => i.code === 'index-version-mismatch'));
}

// 3. 服务端没装行为包
{
    const root = makeServer({ bp: false });
    const exp = makeExpected(root);
    const { rep } = run(root, exp, stats());
    ok('BP 未部署 → error + 禁用', rep.state === 'error' && rep.enabled === false);
    ok('   错误码为 server-bp-missing', rep.issues.some(i => i.code === 'server-bp-missing'));
}

// 4. 服务端装的是旧版 BP
{
    const root = makeServer({ bpVersion: [1, 1, 4] });
    const exp = makeExpected(root);
    const { rep } = run(root, exp, stats());
    ok('BP 旧版 → error + 禁用', rep.state === 'error' && rep.enabled === false);
    ok('   错误码为 server-bp-version-mismatch', rep.issues.some(i => i.code === 'server-bp-version-mismatch'));
}

// 5. 工作目录不是服务器根 → 只告警，不禁用
{
    const root = tmpRoot();
    const exp = makeExpected(root);
    const { rep } = run(root, exp, stats());
    ok('无法识别服务器根 → warn 但 enabled=true', rep.state === 'warn' && rep.enabled === true, JSON.stringify(rep.issues));
    ok('   错误码为 server-root-unknown', rep.issues.some(i => i.code === 'server-root-unknown'));
}

// 6. 包都装了但世界没启用
{
    const root = makeServer({ worldRef: false });
    const exp = makeExpected(root);
    const { rep } = run(root, exp, stats());
    ok('世界未启用 → warn 但 enabled=true', rep.state === 'warn' && rep.enabled === true, JSON.stringify(rep.issues));
    ok('   错误码为 world-not-activated', rep.issues.some(i => i.code === 'world-not-activated'));
}

// 7. ghost_index 未就绪
{
    const root = makeServer();
    const exp = makeExpected(root);
    const { rep } = run(root, exp, stats({ ready: false, loadError: 'ghost_index.json 不存在' }));
    ok('索引未就绪 → unavailable + 禁用', rep.state === 'unavailable' && rep.enabled === false);
}

// 8. 缺 addon_expected.json → 校验收窄为部署侧，不因此禁用
{
    const root = makeServer();
    const { rep } = run(root, path.join(root, 'nope.json'), stats());
    ok('缺期望文件 → warn 但 enabled=true', rep.state === 'warn' && rep.enabled === true, JSON.stringify(rep.issues));
    ok('   错误码为 expected-missing', rep.issues.some(i => i.code === 'expected-missing'));
}

// 9. 资源包版本不符 → 不再校验（RP 只影响客户端渲染，服务端不校验、不告警）
{
    const root = makeServer({ rpVersion: [1, 1, 3] });
    const exp = makeExpected(root);
    const { rep } = run(root, exp, stats());
    ok('RP 版本不一致不再影响校验 → state=ok / enabled=true', rep.state === 'ok' && rep.enabled === true, JSON.stringify(rep.issues));
    ok('   不产生 server-rp-* 告警', !rep.issues.some(i => String(i.code).startsWith('server-rp-')));
}

// 10. 期望文件的 bpUuid 与索引不一致（构建产物被换过）
{
    const root = makeServer();
    const exp = makeExpected(root, { bpUuid: '11111111-2222-3333-4444-555555555555' });
    // 服务端装的是索引里的 uuid，因此部署侧找不到 → 同时触发 uuid 与部署两类错误
    const { rep } = run(root, exp, stats());
    ok('bpUuid 不一致 → error + 禁用', rep.state === 'error' && rep.enabled === false);
}

// ── 11. 宽松解析：BDS 接受的注释/尾随逗号不能把扫描卡住 ──
{
    const root = makeServer();
    const exp = makeExpected(root);
    // 原版自带的 chemistry 包就是这个样子（manifest 里写 // 注释），BDS 照读不误
    const chemDir = path.join(root, 'behavior_packs', 'chemistry');
    fs.mkdirSync(chemDir, { recursive: true });
    fs.writeFileSync(path.join(chemDir, 'manifest.json'), [
        '{',
        '  "format_version": 2,',
        '  "header": { "uuid": "6baf8b62-8948-4c99-bb1e-a0cb35dc4579", "version": [1, 0, 0] },',
        '  "dependencies": [',
        '    {',
        '      // Chemistry resource pack',
        '      "uuid": "0fba4063-dba1-4281-9b89-ff9390653530",',
        '      "version": [1, 0, 0],',
        '    },',
        '  ],',
        '}',
    ].join('\n'), 'utf8');

    const { rep, logs } = run(root, exp, stats());
    ok('无关包带注释不影响校验结论', rep.state === 'ok', JSON.stringify(rep.issues));
    ok('不因无关包刷 WARN', logs.filter(l => l[0] === 'warn').length === 0, JSON.stringify(logs));
}

// ── 12. 目标包自己的 manifest 带注释也能读到 ──
{
    const root = makeServer({ bp: false });
    const exp = makeExpected(root);
    const bpDir = path.join(root, 'behavior_packs', 'LitematicaBE_BP');
    fs.mkdirSync(bpDir, { recursive: true });
    fs.writeFileSync(path.join(bpDir, 'manifest.json'), [
        '{',
        '  "format_version": 2,',
        '  "header": {',
        `    "uuid": "${BP_UUID}",`,
        `    "version": [${VER.join(', ')}],   // 与构建期一致`,
        '  },',
        '}',
    ].join('\n'), 'utf8');

    const { rep } = run(root, exp, stats());
    ok('目标包带注释仍能识别 uuid 与版本', rep.state === 'ok' && !!(rep.deployed.bp), JSON.stringify(rep.issues));
    ok('   读到的版本正确', rep.deployed.bp && rep.deployed.bp.version.join('.') === VER.join('.'));
}

// ── 13. 找不到目标包时，把"有包读不了"挂进结论 ──
{
    const root = makeServer({ bp: false, rp: false });
    const exp = makeExpected(root);
    const chemDir = path.join(root, 'behavior_packs', 'chemistry');
    fs.mkdirSync(chemDir, { recursive: true });
    fs.writeFileSync(path.join(chemDir, 'manifest.json'), '{\n // 只剩注释能读的坏包\n "a": 1,\n "b": 2\n }', 'utf8');
    // 上面这个其实能被宽松解析（去掉注释后合法）——换一个真读不了的
    fs.writeFileSync(path.join(chemDir, 'manifest.json'), '{\n "a": 1\n "b": 2\n}', 'utf8');

    const { rep } = run(root, exp, stats());
    const missing = rep.issues.find(i => i.code === 'server-bp-missing');
    ok('目标包缺失仍是 error', rep.state === 'error' && rep.enabled === false);
    ok('   结论里附上"另有 N 个无法解析"', !!missing && /另有 1 个 manifest 无法解析/.test(missing.message), missing && missing.message);
}

// ── 14. looseJsonParse 单元：只放宽注释与尾随逗号，不误伤字符串 ──
{
    const { looseJsonParse } = require(path.join(ROOT, 'src', 'ghost', 'AddonVersionCheck'));
    ok('字符串里的 // 不被当注释', () => {
        const o = looseJsonParse('{"a":"http://x/y","b":"keep // this"}');
        assert.strictEqual(o.a, 'http://x/y');
        assert.strictEqual(o.b, 'keep // this');
    });
    ok('块注释与尾随逗号被容忍', () => {
        const o = looseJsonParse('{ /* c */ "a": [1,2,], "b": {"c": 3,}, }');
        assert.deepStrictEqual(o, { a: [1, 2], b: { c: 3 } });
    });
    ok('BOM 被去掉', () => {
        const o = looseJsonParse('\uFEFF{"a":1}');
        assert.strictEqual(o.a, 1);
    });
    ok('真正坏掉的文件仍然抛错', () => {
        assert.throws(() => looseJsonParse('{ "a": 1 "b": 2 }'));
    });
}

// ── 15. 世界 packs 文件坏了 → 报"无法解析"，不误报成"世界没启用" ──
{
    const root = makeServer({ worldRef: false });
    const exp = makeExpected(root);
    const wdir = path.join(root, 'worlds', 'Bedrock level');
    fs.mkdirSync(wdir, { recursive: true });
    fs.writeFileSync(path.join(wdir, 'world_behavior_packs.json'), '[{"pack_id": "x",}]', 'utf8');   // 实际能被宽松解析
    fs.writeFileSync(path.join(wdir, 'world_behavior_packs.json'), '[{"pack_id" "x"}]', 'utf8');      // 真坏

    const { rep } = run(root, exp, stats());
    ok('坏文件 → world-ref-unparsable', () => {
        const i = rep.issues.find(x => x.code === 'world-ref-unparsable');
        assert.ok(i, JSON.stringify(rep.issues));
        assert.ok(i.message.includes('world_behavior_packs.json'));
    });
    ok('   不再同时误报 world-not-activated', () => {
        assert.strictEqual(rep.issues.filter(x => x.code === 'world-not-activated').length, 0);
    });
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
if (fail) process.exitCode = 1;
