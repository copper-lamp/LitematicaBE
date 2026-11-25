// 临时验证：用服务器真实 config.json 走一遍 index.js 的装配路径
const fs = require('fs');
const { LogCleaner } = require('../src/core/LogCleaner.js');

function looseParse(p) {
    let t = fs.readFileSync(p, 'utf8');
    let out = '', inStr = false, esc = false;
    for (let i = 0; i < t.length; i++) {
        const c = t[i], n = t[i + 1];
        if (inStr) {
            out += c;
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') { inStr = true; out += c; continue; }
        if (c === '/' && n === '/') { while (i < t.length && t[i] !== '\n') i++; out += '\n'; continue; }
        out += c;
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

const p = process.argv[2];
const cfg = looseParse(p);
const lcCfg = cfg.logCleaner || {};

const enabled = lcCfg.enabled !== false;
const n = Number(lcCfg.scanInterval);
const interval = Number.isFinite(n) ? Math.min(3600000, Math.max(1000, Math.floor(n))) : 60000;

const lc = new LogCleaner();
lc.setVerboseStartup(cfg.misc && cfg.misc.verboseStartupLog === true);
lc.configure({
    scanInterval: interval,
    backupEnabled: lcCfg.backupEnabled,
    maxBackupFiles: lcCfg.maxBackupFiles,
    patterns: lcCfg.patterns
});

const pats = lc.config.patterns;
console.log('logCleaner.enabled       :', enabled, '-> 调度任务 enabled:', enabled);
console.log('logCleaner.scanInterval  :', lcCfg.scanInterval, '-> everyMs:', interval);
console.log('backupEnabled/maxBackup  :', lc.config.backupEnabled, '/', lc.config.maxBackupFiles);
console.log('patterns compiled        :', pats.length, '条，全部 RegExp =', pats.every((r) => r instanceof RegExp));
console.log('pattern sources          :', pats.map((r) => r.source).join(' | '));
console.log('sample match             :', pats.some((r) => r.test('Spawning particle litematica:block_ghost')),
    '| 普通日志不误删 =', !pats.some((r) => r.test('Player Steve joined the game')));
