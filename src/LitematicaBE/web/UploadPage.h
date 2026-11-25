#pragma once

namespace litematicabe::web {

// 上传页（内嵌，无需外部文件）。
// 把 .litematic / .mcstructure 传到插件的 schematics/ 目录
inline constexpr char const* kUploadPage = R"HTML(<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LitematicaBE 投影上传</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 32px; font: 15px/1.6 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
         background: #14161a; color: #e6e8eb; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p  { color: #9aa4b2; margin: 0 0 20px; }
  code { background: #1f242b; padding: 2px 6px; border-radius: 4px; }
  .row { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
  input[type=text], input[type=password] {
    background: #1f242b; border: 1px solid #2c333d; color: #e6e8eb;
    padding: 8px 10px; border-radius: 6px; min-width: 280px; }
  #drop { border: 2px dashed #2c333d; border-radius: 12px; padding: 48px 24px; text-align: center;
          color: #9aa4b2; transition: .15s; cursor: pointer; }
  #drop.hot { border-color: #4c9ffe; color: #4c9ffe; background: #17202b; }
  #drop b { color: #e6e8eb; }
  button { background: #2f6feb; color: #fff; border: 0; padding: 9px 18px; border-radius: 6px;
           cursor: pointer; font-size: 14px; }
  button:disabled { background: #2c333d; color: #9aa4b2; cursor: default; }
  pre { background: #1f242b; border-radius: 8px; padding: 14px; white-space: pre-wrap; word-break: break-all;
        min-height: 20px; }
  .ok { color: #4ade80; } .err { color: #f87171; }
</style>
</head>
<body>
<h1>LitematicaBE 投影上传</h1>
<p>把 <code>.litematic</code> 或 <code>.mcstructure</code> 文件放入上传框内，上传后回游戏执行 <code>/lit load 文件名</code>（或 <code>/lit info 文件名</code> 查看统计）。</p>

<div class="row">
  <label>访问令牌</label>
  <input id="token" type="password" placeholder="config/upload.json 里的 token">
</div>

<div id="drop">拖拽文件到此处，或<b>点击选择</b></div>
<input id="file" type="file" accept=".litematic,.mcstructure" style="display:none">
<pre id="out">等待上传…</pre>

<script>
const drop = document.getElementById('drop');
const input = document.getElementById('file');
const out = document.getElementById('out');
const tokenInput = document.getElementById('token');

tokenInput.value = localStorage.getItem('lit_token') || '';
tokenInput.addEventListener('change', () => localStorage.setItem('lit_token', tokenInput.value));

function say(text, cls) {
  out.textContent = text;
  out.className = cls || '';
}

function pick() { input.click(); }
drop.addEventListener('click', pick);
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('hot'); });
drop.addEventListener('dragleave', () => drop.classList.remove('hot'));
drop.addEventListener('drop', e => {
  e.preventDefault();
  drop.classList.remove('hot');
  if (e.dataTransfer.files.length) upload(e.dataTransfer.files[0]);
});
input.addEventListener('change', () => { if (input.files.length) upload(input.files[0]); });

async function upload(file) {
  const token = tokenInput.value.trim();
  if (!token) { say('请先填写访问令牌（在服务端 plugins/LitematicaBE/config/upload.json 记录）', 'err'); return; }
  localStorage.setItem('lit_token', token);

  say(`上传中：${file.name}（${(file.size / 1024).toFixed(1)} KB）…`);
  const body = new FormData();
  body.append('file', file, file.name);

  try {
    const resp = await fetch('/upload?token=' + encodeURIComponent(token), { method: 'POST', body });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      say('失败：' + (data.error || resp.status), 'err');
      return;
    }
    say(`已上传：${data.file}（${(data.size / 1024).toFixed(1)} KB）\n返回游戏执行：/lit info ${data.file}\n        或：/lit load ${data.file}`, 'ok');
  } catch (err) {
    say('上传出错：' + err, 'err');
  }
}
</script>
</body>
</html>
)HTML";

} // namespace litematicabe::web
