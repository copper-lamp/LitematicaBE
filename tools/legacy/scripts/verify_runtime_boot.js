// work/verify_runtime_boot.js — 在服务器根目录离线模拟插件启动时的两个关键判定
//   1. GhostBlockRegistry 能否从 data/ghost_index.json 载入（决定 ghost 写入总闸）
//   2. AddonVersionCheck.run() 是否 enabled（决定 addon 三方一致）
// 不启动 BDS，只跑判定逻辑。
const path = require('path');

const SRV = 'C:\\Users\\25491\\Desktop\\MCBEserver1.21.132';
const REPO = path.resolve(__dirname, '..');

// 插件用 ./plugins/LitematicaBE/... 这类相对路径 + process.cwd()，所以必须先 chdir
process.chdir(SRV);

const logs = [];
global.logger = {
    info: (m) => logs.push('INFO  ' + m),
    warn: (m) => logs.push('WARN  ' + m),
    error: (m) => logs.push('ERROR ' + m),
    debug: () => {},
};
global.mc = { listen() { return true; }, getPlayer() { return null; } };

const { GhostBlockRegistry } = require(path.join(REPO, 'src/ghost/GhostBlockRegistry.js'));
const { AddonVersionCheck } = require(path.join(REPO, 'src/ghost/AddonVersionCheck.js'));

const registry = new GhostBlockRegistry();
const stats = registry.stats();

console.log('=== GhostBlockRegistry ===');
console.log('ready        :', registry.ready);
console.log('stats        :', JSON.stringify(stats));
console.log('loadError    :', registry.loadError || '(none)');

const check = new AddonVersionCheck({ logger: global.logger });
const rep = check.run(stats);

console.log('\n=== AddonVersionCheck ===');
console.log('enabled      :', rep.enabled);
console.log('summary      :', check.summaryText());
console.log('issues       :');
for (const i of rep.issues || []) console.log(`   [${i.level}] ${i.message}`);
console.log('deployed     :', JSON.stringify(rep.deployed));
console.log('worldRefs    :', JSON.stringify(rep.worldRefs));

console.log('\n=== 插件日志 ===');
for (const l of logs) console.log(l);

const ok = registry.ready === true && rep.enabled === true;
console.log('\n结果: ' + (ok ? 'PASS（ghost 写入会启用，addon 校验通过）' : 'FAIL'));
process.exit(ok ? 0 : 1);
