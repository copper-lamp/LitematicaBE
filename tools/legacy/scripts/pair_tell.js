// 精确配对 v2：排除注释行 + 支持跨行模板
const fs = require('fs');
const path = require('path');
const HEAD_DIR = process.argv[2] || path.join(process.env.TEMP || process.env.TMP || '/tmp', 'litematica_head');
const files = process.argv[3] ? process.argv[3].split(',') : [
  'src/render/ProjectionRenderer.js', 'src/ui/UIManager.js',
];
const CJK = /[\u4e00-\u9fff]/;

function headName(f) { return path.join(HEAD_DIR, f.replace(/[\/\\]/g, '_')); }

function isCommentLine(text, index) {
  const lineStart = text.lastIndexOf('\n', index) + 1;
  const seg = text.slice(lineStart, index);
  return /^\s*(\/\/|\*)/.test(seg);
}

function extractTellZh(text) {
  const out = [];
  const re = /(?:player|pl|p)\.tell\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (isCommentLine(text, m.index)) continue;
    const v = m[2];
    if (CJK.test(v)) out.push(v);
    else out.push('\x00NO_CJK:' + v); // 无中文也占位，保持顺序
  }
  return out;
}

function extractTellKeys(text) {
  const out = [];
  const re = /tell\(\s*(?:player|pl|p)[^,]*,\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

for (const f of files) {
  const headText = fs.readFileSync(headName(f), 'utf8');
  const curText = fs.readFileSync(f, 'utf8');
  const zhs = extractTellZh(headText);
  const keys = extractTellKeys(curText);
  console.log(`\n===== ${f} (tellZh:${zhs.length} tellKeys:${keys.length}) =====`);
  const n = Math.min(zhs.length, keys.length);
  for (let i = 0; i < n; i++) console.log(`${keys[i]}\t${JSON.stringify(zhs[i])}`);
  if (zhs.length !== keys.length) console.log(`!! MISMATCH tellZh=${zhs.length} tellKeys=${keys.length}`);
}
