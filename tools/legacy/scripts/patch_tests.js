const fs = require('fs');
const p = 'D:/GitHub/LitematicaBE/tests/test_ghost_states.js';
let s = fs.readFileSync(p, 'utf8');
s = s.replace("assert.deepStrictEqual(st, { 'lit:dir': 2 });", "assert.deepStrictEqual(st, { 'lit:dir': 2, 'lit:upside': 0 });");
s = s.replace("assert.deepStrictEqual(st, { 'lit:dir': 0 });", "assert.deepStrictEqual(st, { 'lit:dir': 0, 'lit:upside': 0 });");
s = s.replace("assert.deepStrictEqual(st, { 'lit:dir': 3 });", "assert.deepStrictEqual(st, { 'lit:dir': 3, 'lit:upside': 0 });");
fs.writeFileSync(p, s);
console.log('测试期望已更新（楼梯新增 lit:upside）');
