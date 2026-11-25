// UI 配对：HEAD 的 setTitle/setContent/addButton/addLabel/addDropdown/addInput 参数内中文字面量段
// ↔ 当前代码的 t(player,'ui...') 键（按出现顺序）
const fs = require('fs');
const path = require('path');
const HEAD_DIR = process.argv[2] || path.join(process.env.TEMP || process.env.TMP || '/tmp', 'litematica_head');
const file = process.argv[3] || 'src/ui/UIManager.js';
const CJK = /[\u4e00-\u9fff]/;

function headName(f) { return path.join(HEAD_DIR, f.replace(/[\/\\]/g, '_')); }

// 提取 HEAD：UI 方法调用参数区间内的中文字面量段（跨行拼接全部）
function extractUiZh(text) {
  const out = [];
  const re = /\.(setTitle|setContent|addButton|addLabel|addDropdown|addInput)\(\s*/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    // 从方法名后找参数区间（括号平衡）
    let i = re.lastIndex - 1; // 指向 '('
    let depth = 0;
    let seg = '';
    for (; i < text.length; i++) {
      const ch = text[i];
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) { i++; break; } }
      if (depth > 0) seg += ch;
    }
    // 提取 seg 内所有字面量（含中文）
    const lre = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
    let lm;
    while ((lm = lre.exec(seg)) !== null) {
      if (CJK.test(lm[2])) out.push(lm[2]);
    }
  }
  return out;
}

// 提取当前：所有 t(player,'ui...') 键（按序）
function extractUiKeys(text) {
  const out = [];
  const re = /t\(\s*player,\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

const headText = fs.readFileSync(headName(file), 'utf8');
const curText = fs.readFileSync(file, 'utf8');
const zhs = extractUiZh(headText);
const keys = extractUiKeys(curText);
console.log(`===== ${file} (uiZh:${zhs.length} uiKeys:${keys.length}) =====`);
const n = Math.min(zhs.length, keys.length);
for (let i = 0; i < n; i++) console.log(`${keys[i]}\t${JSON.stringify(zhs[i])}`);
if (zhs.length !== keys.length) console.log(`!! MISMATCH uiZh=${zhs.length} uiKeys=${keys.length}`);
