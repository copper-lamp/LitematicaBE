// work/inspect_mega.js —— 只读体检：MEGA 投影的注入前置条件是否齐全
// 用法：node work\inspect_mega.js ["C:\...\MCBEserver1.21.132"]
const fs = require('fs');
const path = require('path');

const SRV = process.argv[2] || 'C:\\Users\\25491\\Desktop\\MCBEserver1.21.132';
const P = path.join(SRV, 'plugins', 'LitematicaBE');

function readLoose(p) {
    const s = fs.readFileSync(p, 'utf8');
    return JSON.parse(s.replace(/^\s*\/\/.*$/gm, '').replace(/\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'));
}

let bad = 0;
const ok = (label, cond, extra) => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra !== undefined ? `  (${extra})` : ''}`);
    if (!cond) bad++;
};

console.log(`插件目录: ${P}\n`);

console.log('[1] 配置');
let cfg = {};
try { cfg = readLoose(path.join(P, 'config.json')); } catch (e) { console.log('  config.json 读取失败: ' + e.message); }
ok('render.enableMega', cfg.render && cfg.render.enableMega === true, cfg.render && cfg.render.enableMega);
ok('megaSchematic.enabled', cfg.megaSchematic && cfg.megaSchematic.enabled === true);
ok('megaSchematic.threshold', !!(cfg.megaSchematic && cfg.megaSchematic.threshold), cfg.megaSchematic && cfg.megaSchematic.threshold);

console.log('\n[2] 投影记录里的 isMega 形态（旧数据可能是字符串）');
let projs = [];
try {
    const o = JSON.parse(fs.readFileSync(path.join(P, 'data', 'projections.json'), 'utf8'));
    projs = o.projections || [];
} catch (e) { console.log('  projections.json 读取失败: ' + e.message); }
for (const pj of projs) {
    const t = typeof pj.isMega;
    const flag = t === 'string' ? ' ← 旧格式字符串，需归一化' : '';
    console.log(`  ${pj.name || pj.id}: isMega=${JSON.stringify(pj.isMega)} (${t}) schematicId=${pj.schematicId || 'null'} totalBlocks=${pj.totalBlocks}${flag}`);
    if (t === 'string') bad++;
}

console.log('\n[3] MEGA 分块数据（注入前置）');
const ms = path.join(P, 'mega_schematics');
ok('mega_schematics 目录存在', fs.existsSync(ms));
if (fs.existsSync(ms)) {
    for (const id of fs.readdirSync(ms)) {
        const dir = path.join(ms, id);
        if (!fs.statSync(dir).isDirectory()) continue;
        const idx = path.join(dir, 'chunk_index.json');
        const chunks = path.join(dir, 'chunks');
        // chunk_index.json 是扁平表 {"cx,cy,cz": 方块数}，不是 {chunks:{...}}
        const nChunks = fs.existsSync(chunks) ? fs.readdirSync(chunks).filter(f => f.endsWith('.mcmega')).length : 0;
        let idxSize = -1;
        try { idxSize = Object.keys(JSON.parse(fs.readFileSync(idx, 'utf8'))).length; } catch (e) { idxSize = -1; }
        // 索引里有、磁盘上也得有（少一个分块 = 那一片投影永远缺）
        const good = idxSize > 0 && nChunks >= idxSize;
        ok(`${id} 分块完整`, good, `索引 ${idxSize} 块 / 磁盘 ${nChunks} 块`);
    }
}

console.log('\n[4] 玩家恢复记录');
try {
    const pd = JSON.parse(fs.readFileSync(path.join(P, 'data', 'player_data.json'), 'utf8'));
    const list = Array.isArray(pd.players) ? pd.players : Object.entries(pd.players || pd).map(([k, v]) => ({ xuid: k, ...v }));
    for (const d of list) {
        if (!d || typeof d !== 'object') continue;
        console.log(`  ${d.xuid || d.name || '?'}: currentProjectionId=${d.currentProjectionId || 'null'} layer=${d.currentRenderLayer} dimid=${d.projectionDimid}`);
        if (!d.currentProjectionId) console.log('     ↑ 没有恢复记录：进服不会自动恢复投影，需要重新放置一次（投影本身还在 projections.json 里）');
    }
} catch (e) { console.log('  player_data.json 读取失败: ' + e.message); }

console.log(`\n结论: ${bad === 0 ? '前置条件齐全' : bad + ' 处需要处理'}`);
process.exit(bad ? 1 : 0);
