// 配对：HEAD 中文字面量（按序） ↔ 当前代码键（按序），生成 key→zh 映射
const fs = require('fs');
const path = require('path');
const HEAD_DIR = process.argv[2] || path.join(process.env.TEMP || process.env.TMP || '/tmp', 'litematica_head');
const SRC = process.argv[3] || '.';
const files = [
  'src/ui/UIManager.js', 'src/render/ProjectionRenderer.js', 'src/render/MegaProjectionRenderer.js',
  'src/ghost/GhostRenderer.js', 'src/easyplace/EasyPlaceManager.js', 'src/easyplace/BlockVerifier.js',
  'src/utils/MaterialCounter.js', 'src/core/MegaSchematicManager.js', 'src/core/SelectionTool.js',
  'src/ghost/GhostSelfCheck.js',
];
const CJK = /[\u4e00-\u9fff]/;

function headName(f) { return path.join(HEAD_DIR, f.replace(/[\/\\]/g, '_')); }

function extractZh(text) {
  const out = [];
  const re = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const v = m[2];
    if (!CJK.test(v)) continue;
    // 排除注释里的中文：若字面量整行前有 // 或行首有 *（JSDoc）则跳过——粗略
    out.push(v);
  }
  return out;
}

function extractKeys(text) {
  const out = [];
  const re = /(?:t|tell|tr)\(\s*[^,()]+,\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

for (const f of files) {
  const headFile = headName(f);
  const curFile = path.join(SRC, f);  if (!fs.existsSync(headFile) || !fs.existsSync(curFile)) continue;
  const headText = fs.readFileSync(headFile, 'utf8');
  const curText = fs.readFileSync(curFile, 'utf8');
  const zhs = extractZh(headText);
  const keys = extractKeys(curText);
  console.log(`\n===== ${f} (zh:${zhs.length} keys:${keys.length}) =====`);
  const n = Math.min(zhs.length, keys.length);
  for (let i = 0; i < n; i++) {
    console.log(`${keys[i]}\t${JSON.stringify(zhs[i])}`);
  }
  if (zhs.length !== keys.length) {
    console.log(`!! MISMATCH zh=${zhs.length} keys=${keys.length}`);
  }
}
