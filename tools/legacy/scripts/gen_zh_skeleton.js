// 生成 zh_CN.json 骨架：v2（ProjectionRenderer+UIManager 准确）+ v1 其他文件段
const fs = require('fs');
const path = require('path');
const TMP = process.env.TEMP || '/tmp';
const out = {};

function parse(file, skipFiles) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  let curFile = '';
  const re = /^===== ([^=]+) =====$|^([a-zA-Z0-9_.]+)\t"((?:\\.|[^"\\])*)"$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) { curFile = m[1].trim(); continue; }
    if (!m[2]) continue;
    if (skipFiles.includes(curFile)) continue;
    const key = m[2];
    let val = m[3].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    if (val.startsWith('\u0000NO_CJK:')) val = val.slice(8);
    val = val.replace(/\$\{[^}]*\}/g, '{}');
    if (!(key in out)) out[key] = val;
  }
}

// v2 优先：ProjectionRenderer + UIManager
parse(path.join(TMP, 'pair_tell2.txt'), []);
// v1 补充其它文件（跳过 ProjectionRenderer/UIManager 的错误段）
parse(path.join(TMP, 'pair_tell.txt'), ['src/render/ProjectionRenderer.js', 'src/ui/UIManager.js']);

fs.writeFileSync(path.join(TMP, 'zh_skeleton.json'), JSON.stringify(out, null, 2), 'utf8');
console.log('keys=' + Object.keys(out).length);
