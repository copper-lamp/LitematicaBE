#!/usr/bin/env node
/**
 * inspect_orphans.js —— 只读体检：看看服务端 data/sessions/ 里到底压着多少没还原的格
 *
 * 用法：
 *   node work\inspect_orphans.js
 *   node work\inspect_orphans.js "C:\Users\25491\Desktop\MCBEserver1.21.132\plugins\LitematicaBE"
 *
 * 只读：不写任何文件、不动世界。输出每个孤儿会话的格数、包围盒、是否 MEGA、
 * 以及期望账本里还认领了多少格（这些格就是"重启后会被 restoreAll 补回来"的那批）。
 */
const fs = require('fs');
const path = require('path');

const root = process.argv[2] || 'C:\\Users\\25491\\Desktop\\MCBEserver1.21.132\\plugins\\LitematicaBE';
const sessDir = path.join(root, 'data', 'sessions');
const expectFile = path.join(root, 'data', 'ghost_expect.json');

function loadExpect() {
    const set = new Set();
    try {
        if (!fs.existsSync(expectFile)) return { set, note: 'ghost_expect.json 不存在' };
        const obj = JSON.parse(fs.readFileSync(expectFile, 'utf8'));
        const dims = obj.dims || obj || {};
        for (const dimid of Object.keys(dims)) {
            const cols = dims[dimid] || {};
            for (const key of Object.keys(cols)) {
                // 键形如 "x,y,z"，值可能是 ghostId 或数组
                if (typeof key === 'string' && key.split(',').length === 3) set.add(`${dimid}:${key}`);
            }
        }
        return { set, note: `ghost_expect.json 认领 ${set.size} 格` };
    } catch (e) {
        return { set, note: `ghost_expect.json 解析失败: ${e.message}` };
    }
}

function main() {
    console.log(`插件目录: ${root}`);
    if (!fs.existsSync(sessDir)) { console.log('没有 data/sessions 目录 —— 说明没有未还原的会话'); return; }
    const files = fs.readdirSync(sessDir).filter(f => f.endsWith('.json'));
    const ex = loadExpect();
    console.log(`期望账本: ${ex.note}`);
    console.log(`未还原会话: ${files.length} 个\n`);
    if (!files.length) return;

    let totalBlocks = 0;
    for (const f of files) {
        const p = path.join(sessDir, f);
        let obj;
        try { obj = JSON.parse(fs.readFileSync(p, 'utf8')); }
        catch (e) { console.log(`  ! ${f} 解析失败: ${e.message}`); continue; }
        const blocks = obj.blocks || [];
        totalBlocks += blocks.length;
        let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
        let claimed = 0;
        const dimid = Number.isFinite(obj.dimid) ? obj.dimid : 0;
        for (const b of blocks) {
            if (b.x < x0) x0 = b.x; if (b.x > x1) x1 = b.x;
            if (b.y < y0) y0 = b.y; if (b.y > y1) y1 = b.y;
            if (b.z < z0) z0 = b.z; if (b.z > z1) z1 = b.z;
            if (ex.set.has(`${dimid}:${b.x},${b.y},${b.z}`)) claimed++;
        }
        const size = (fs.statSync(p).size / 1024).toFixed(0);
        const isMega = !!(obj.meta && obj.meta.mega);
        console.log(`  ${f}`);
        console.log(`    格数 ${blocks.length} · 文件 ${size}K · dimid ${dimid} · MEGA标记 ${isMega ? '有' : '无（旧格式）'}`);
        console.log(`    包围盒 x ${x0}..${x1} · y ${y0}..${y1} · z ${z0}..${z1}`);
        console.log(`    期望账本仍认领 ${claimed} 格${claimed ? '（restoreAll 会把这些 ghost 补回来）' : ''}`);
        console.log(`    创建 ${new Date(obj.createdAt || 0).toLocaleString()} · 更新 ${new Date(obj.updatedAt || 0).toLocaleString()}`);
    }
    console.log(`\n合计 ${totalBlocks} 格待还原。清理方式：服务器启动后游戏内执行 /litematica ghost clean`);
    console.log('  或者：进服后重新加载一次投影（startRender 前会自动清掉本人的孤儿快照）');
}

main();
