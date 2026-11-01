/**
 * check_ghost_renderer_api.js — 一条命令判断 GhostRenderer.js 有没有被旧版本覆盖
 *
 * 起因：部署时误把旧版 GhostRenderer 覆盖回来，会话保活/恢复能力全丢，
 * 表现为"玩家退出重进投影消失 + 木剑 UI 卡在[已加载]"。这个脚本做静态体检，
 * 不依赖 mc/logger，随时可跑，秒级给出"是不是旧版"。
 *
 * 用法：node tests/check_ghost_renderer_api.js
 * 退出码：0 = 完整；1 = 缺东西（会列出缺哪些）
 */
const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '..', 'src', 'ghost', 'GhostRenderer.js');

if (!fs.existsSync(FILE)) {
    console.error(`❌ 文件不存在：${FILE}`);
    process.exit(1);
}

const src = fs.readFileSync(FILE, 'utf8');
const lines = src.split('\n').length;
const bytes = fs.statSync(FILE).size;

/** 每个检查项：说明 + 判据（正则/包含） */
const REQUIRED = [
    // ===== 基础写入能力 =====
    ['常量 DEFAULT_WRITES_PER_TICK', /DEFAULT_WRITES_PER_TICK\s*=/],
    ['常量 DEFAULT_MAX_BLOCKS', /DEFAULT_MAX_BLOCKS\s*=/],
    ['常量 DEFAULT_RETRY_BATCH', /DEFAULT_RETRY_BATCH\s*=/],
    ['可替换方块表 REPLACEABLE', /const REPLACEABLE = new Set\(/],
    ['坐标变换 transformPosition', /function transformPosition\(/],
    ['写序：跳过空块', /\bAIR_LIKE\b|isAirLike/],
    ['写序：跳过已有 ghost', /isGhost\(/],
    ['写序：保护玩家方块', /protected/],
    ['写序：快照登记在 setBlock 之前', /snapshot\.record\([\s\S]{0,900}mc\.setBlock\(/],
    ['写序：期望集合登记 expect.set', /expect\.set\(/],
    ['撤销：先删期望', /expect\.del\(/],
    ['撤销：再关快照', /snapshot\.close\(/],
    ['方法 enqueue', /^\s{4}enqueue\(player, projection, opts\)/m],
    ['方法 tick(budget)', /^\s{4}tick\(budget\)/m],
    ['方法 _writeOne', /_writeOne\(/],
    ['方法 retryPending', /^\s{4}retryPending\(limitPerSession\)/m],
    ['方法 setLayer', /^\s{4}setLayer\(player, projection, layer\)/m],
    ['方法 clear', /^\s{4}clear\(player, opts\)/m],
    ['方法 updateBlocks', /^\s{4}updateBlocks\(xuid, newBlocks\)/m],
    ['方法 summary', /^\s{4}summary\(\)/m],

    // ===== 会话保活（被覆盖时最先丢失的能力） =====
    ['常量 DEFAULT_SUSPEND_MAX_AGE_MS', /DEFAULT_SUSPEND_MAX_AGE_MS\s*=/],
    ['常量 PRUNE_INTERVAL_MS', /PRUNE_INTERVAL_MS\s*=/],
    ['方法 suspend', /^\s{4}suspend\(player\)/m],
    ['方法 resume', /^\s{4}resume\(player\)/m],
    ['方法 isSuspended', /^\s{4}isSuspended\(player\)/m],
    ['方法 pruneSuspended', /^\s{4}pruneSuspended\(maxAgeMs, now\)/m],
    ['状态字面量 suspended', /state = 'suspended'/],
    ['离线时间戳 suspendedAt', /suspendedAt = Date\.now\(\)/],
    ['enqueue 同投影同层续用', /sameProj && sameLayer/],
    ['enqueue 续用返回 resumed', /resumed: true/],
    ['retryPending 顺带 prune', /pruneSuspended\(\)/],
    ['summary 暴露 suspended', /suspended,\s*$/m],

    // ===== 被真实方块挡住 → 挖掉后补写（"原地形吞投影"修复） =====
    ['session 带 blocked 队列', /blocked: \[\],/],
    ['全局 blocked 索引 blockedIndex', /this\.blockedIndex = new Map\(\)/],
    ['方法 _block', /^\s{4}_block\(s, entry\)/m],
    ['方法 _unblock', /^\s{4}_unblock\(s, entry\)/m],
    ['方法 retryBlocked', /^\s{4}retryBlocked\(limitPerSession\)/m],
    ['方法 retryBlockedAt', /^\s{4}retryBlockedAt\(x, y, z, dimid\)/m],
    ['tick 里 protected 入 blocked', /this\._block\(s, entry\)/],
    ['retryPending 调 retryBlocked', /this\.retryBlocked\(cap\)/],
    ['计数 blockedCount / blockedPlaced', /blockedCount: 0[\s\S]{0,200}blockedPlaced: 0/],
    ['clear 清理 blocked 索引', /for \(const e of s\.blocked\) this\.blockedIndex\.delete/],

    // ===== 导出完整性 =====
    ['模块导出 5 项', /module\.exports = \{ GhostRenderer, transformPosition, shortName, dimidOf, REPLACEABLE \}/],
];

let bad = 0;
console.log(`\n检查 ${path.relative(process.cwd(), FILE)}  (${bytes} 字节 / ${lines} 行)\n`);

for (const [name, re] of REQUIRED) {
    const ok = re.test(src);
    if (!ok) bad++;
    console.log(`${ok ? '✅' : '❌'} ${name}`);
}

// 语法自检（避免"结构对但括号坏了"）
try {
    new Function(src.replace(/^\uFEFF/, '') + '\n;return typeof GhostRenderer;');
    console.log('✅ 语法可解析（new Function 探测）');
} catch (e) {
    bad++;
    console.log(`❌ 语法解析失败：${e.message}`);
}

// 版本指纹：完整体约 34 KB / 784 行；旧版约 22.7 KB / 548 行
if (bytes < 32000 || lines < 760) {
    console.log(`\n⚠️  体积偏小（${bytes} 字节 / ${lines} 行）：完整体应在 34 KB / 784 行左右`
        + `（旧版 22.7 KB / 548 行，仅含会话保活的 27.4 KB / 645 行）。可能又覆盖回了旧版。`);
}

if (bad) {
    console.log(`\n结果：❌ ${bad} 项不通过 —— 这个文件不是最新版\n`);
    process.exit(1);
}
console.log('\n结果：✅ 全部通过，GhostRenderer.js 是最新版\n');
