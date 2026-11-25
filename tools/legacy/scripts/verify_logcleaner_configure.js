// 临时验证：LogCleaner.configure 对 config 里的字符串 patterns 做编译
const { LogCleaner } = require('../src/core/LogCleaner.js');

const lc = new LogCleaner();
const before = lc.config.patterns.length;
const isRe = (a) => Array.isArray(a) && a.every((x) => x instanceof RegExp);

console.log('builtin patterns are RegExp:', isRe(lc.config.patterns), '| count', before);

lc.configure({ patterns: ['render', 'litematica:.*particle', '  ', '(', 'Spawning particle', '[]', 'a*'] });
const after = lc.config.patterns;
console.log('after configure are RegExp:', isRe(after), '| count', after.length);
console.log('compiled sources:', after.map((r) => r.source).join(' | '));
console.log('match test:', after.some((r) => r.test('Spawning particle litematica:block_x render')));
console.log('dropped empty-match pattern (a*):', !after.some((r) => r.source === 'a*'));
console.log('[] is a never-match regex (harmless):', (after.find((r) => r.source === '[]') || /x/).test('abc') === false);

// 全部无效 → 保留原值
const lc2 = new LogCleaner();
const kept = lc2.config.patterns;
lc2.configure({ patterns: ['(', ''] });
console.log('all-invalid keeps builtin:', lc2.config.patterns === kept, '| count', lc2.config.patterns.length);

// 传 RegExp 也照用
const lc3 = new LogCleaner();
lc3.configure({ patterns: [/foo/i] });
console.log('regexp passthrough:', isRe(lc3.config.patterns), lc3.config.patterns.length === 1 && lc3.config.patterns[0].source === 'foo');

// scanInterval / backup 直通
const lc4 = new LogCleaner();
lc4.configure({ scanInterval: 5000, backupEnabled: false, maxBackupFiles: 3 });
console.log('scanInterval', lc4.config.scanInterval, '| backupEnabled', lc4.config.backupEnabled, '| maxBackupFiles', lc4.config.maxBackupFiles);
