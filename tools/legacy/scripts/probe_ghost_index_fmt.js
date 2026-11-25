// 临时：打印 ghost_index 中目标条目的原文片段（work/ 已 gitignore）
const fs = require('fs');
const s = fs.readFileSync('resources/data/ghost_index.json', 'utf8');
console.log('bytes', s.length, 'hasNewlines', /\n/.test(s));
for (const k of ['"lit:g_observer_front"', '"lit:g_dispenser_front"', '"lit:g_dropper_front"']) {
    const i = s.indexOf(k);
    console.log('---', k, 'at', i);
    console.log(JSON.stringify(s.slice(i, i + 240)));
}
