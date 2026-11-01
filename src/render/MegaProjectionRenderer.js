// MegaProjectionRenderer — 超大型投影分块注入器（ghost 通道）
//
// 与常规投影渲染的区别：**不做 LOD 抽样与粒子式渲染**，只负责——
// 将 .mcmega 分块中的方块按顺序全量喂给 GhostRenderer 的会话队列。
//
// 设计要点：
//   1. 数据在 32³ 分块里（BinaryChunkStorage）。加载期就落盘，省的是"解析期峰值内存"。
//   2. 渲染期不做 LOD 抽样：残缺的投影无法与"数据丢了"的 bug 区分，全量注入反而更好验收。
//   3. 每 tick 只读 1 个分块：readFileSync + gunzipSync + 位解码是同步 IO，必须限量，
//      否则会和 ghost 写入抢 tick 预算（render.tickBudgetMs）。
//   4. 注入 = 往队列尾部追加（GhostRenderer.appendBlocks），不动已写格、不重置游标，
//      所以铺设进度能连续推进；铺设速度由 ghostWritesPerTick 决定。
//   5. 撤销仍走 GhostRenderer.clear（整会话），本模块不碰世界、不碰快照。
//
// 本版本**故意不做**（等实测数据再决定）：视口跟随、分块卸载、逐层显示、LOD、重进恢复。

const { CHUNK_SIZE } = require('../core/BinaryChunkStorage');
const { DebugLogger } = require('../core/DebugLogger');

// 每 tick 最多读几个分块。1 块约 1–3 ms（32³ 位解码 + gunzip），固定 1 个最稳。
const CHUNKS_PER_TICK = 1;

/** "cx,cy,cz" → 注入顺序：y 低→高，再按 x、z。让投影从下往上"长"出来 */
function compareChunkKey(a, b) {
    const A = a.split(','), B = b.split(',');
    const ay = Number(A[1]), by = Number(B[1]);
    if (ay !== by) return ay - by;
    const ax = Number(A[0]), bx = Number(B[0]);
    if (ax !== bx) return ax - bx;
    return Number(A[2]) - Number(B[2]);
}

class MegaProjectionRenderer {
    /**
     * 注意：构造期**不读** global.configManager。
     * 它比 global.configManager 的赋值更早发生（index.js 顶部装配顺序），
     * 3.x 就是在这里把 enabled 永久锁成 false 的。配置一律由 isEnabled() 实时读。
     */
    constructor(megaSchematicManager) {
        this.megaManager = megaSchematicManager;
        this.renderStates = new Map();
        this.tickCount = 0;
        this.debugMode = false;
        this.fileDebug = false;
        this.debugLogger = null;

        this.enabled = false;

        this.loadConfig();
    }

    /** 可重复调用（index.js 在 global.configManager 赋值后会再调一次） */
    loadConfig() {
        const cm = global.configManager;
        const get = (key, def) => (cm && typeof cm.get === 'function' ? cm.get(key, def) : def);
        try {
            this.enabled = get('render.enableMega', false) === true;
            this.debugMode = get('megaRender.debug', false);
            this.fileDebug = get('megaRender.fileDebug', false);
            if (this.fileDebug && !this.debugLogger) {
                this.debugLogger = new DebugLogger({
                    enabled: true,
                    logDir: './plugins/LitematicaBE/logs/',
                    maxFileSize: 10 * 1024 * 1024,
                    maxFiles: 5,
                    bufferSize: 50
                });
            }
        } catch (e) {
            logger.warn(`[MegaRender] 配置读取失败，按默认值运行: ${e && e.message ? e.message : e}`);
        }
    }

    /** 实时判定开关：两个配置键都要开（与 index.js 的 megaAvailable 口径一致） */
    isEnabled() {
        const cm = global.configManager;
        if (cm && typeof cm.get === 'function') {
            return cm.get('render.enableMega', false) === true
                && cm.get('megaSchematic.enabled', true) === true;
        }
        return this.enabled === true;
    }

    log(level, category, message, data = null) {
        if (level === 'WARN' || level === 'ERROR') {
            logger.warn(`[MegaRender][${category}] ${message}${data ? ' ' + JSON.stringify(data) : ''}`);
        } else if (this.debugMode) {
            logger.info(`[MegaRender][${category}] ${message}${data ? ' ' + JSON.stringify(data) : ''}`);
        }
        if (this.fileDebug && this.debugLogger) {
            try { this.debugLogger.log(`[${level}][${category}] ${message}${data ? ' ' + JSON.stringify(data) : ''}`); } catch (e) { /* 忽略 */ }
        }
    }

    // ==================== 状态 ====================

    /**
     * 建注入状态。此时只读分块索引（一个 JSON），不读任何分块内容。
     * @returns {object|null} 失败返回 null（调用方据此提示玩家）
     */
    initRenderState(player, schematicId, projection) {
        if (!player || !schematicId) return null;
        if (!this.isEnabled()) {
            logger.info('[MegaRender] render.enableMega=false，跳过超大型投影渲染');
            if (typeof player.tell === 'function') player.tell('§e超大投影渲染未启用（render.enableMega=false）');
            return null;
        }

        const stateId = `${player.xuid}_${schematicId}`;
        const existing = this.renderStates.get(stateId);
        if (existing && existing.isActive) {
            // 上一轮已经注入完，但 ghost 会话可能被重建过（切层 / 重新加载 / 掉线回来）。
            // 重建后的会话队列是空的，而 seen 也跟着会话一起丢了 —— 此时必须重置游标重灌一遍，
            // 否则会出现"会话是空的、却因为 done=true 永远不注入"的死投影。
            if (existing.done) {
                existing.player = player;
                // 按当前层模式重算计划（切层恢复或玩家重进时均走此路径，确保层模式不丢失）
                const chunks = this._rebuildPlan(existing);
                logger.info(`[MegaRender] 会话重建，重置注入 ${stateId} | 分块 ${chunks}`
                    + (existing.isLayerMode && existing.currentLayer >= 0 ? ` | 第 ${existing.currentLayer} 层` : ''));
            }
            return existing;
        }

        let index = null;
        try {
            index = this.megaManager.loadChunkIndex(schematicId);
        } catch (e) {
            logger.warn(`[MegaRender] 分块索引读取失败: ${e && e.message ? e.message : e}`);
        }
        if (!index || index.size === 0) {
            logger.warn(`[MegaRender] 分块索引为空或缺失: ${schematicId}`);
            if (typeof player.tell === 'function') player.tell('§c超大投影的分块数据缺失，请重新加载该投影');
            return null;
        }

        const keys = [...index.keys()].sort(compareChunkKey);
        let totalBlocks = 0;
        for (const k of keys) totalBlocks += index.get(k) || 0;

        const state = {
            stateId,
            player,
            schematicId,
            projection,
            chunkKeys: keys,
            allChunkKeys: keys.slice(),   // 全量键表：层模式只过滤 chunkKeys，不动它
            cursor: 0,
            chunkTotal: keys.length,
            injectedChunks: 0,
            injectedBlocks: 0,
            dupBlocks: 0,
            failedChunks: 0,
            isActive: true,
            done: false,
            suspended: false,
            isLayerMode: false,
            currentLayer: -1,
            startedAt: Date.now(),
            finishedAt: null,
            lastProgressAt: 0,
            stats: {
                input: totalBlocks,
                chunks: keys.length,
                injected: 0,
                failed: 0
            }
        };

        this.renderStates.set(stateId, state);
        logger.info(`[MegaRender] 注入开始 ${stateId} | 分块 ${keys.length} | 方块 ${totalBlocks}`);
        this.log('INFO', 'INIT', `state=${stateId} chunks=${keys.length} blocks=${totalBlocks}`);
        return state;
    }

    // ==================== 每 tick 推进 ====================

    onTick() {
        if (!this.isEnabled()) return;
        if (this.renderStates.size === 0) return;
        this.tickCount++;
        for (const state of this.renderStates.values()) {
            if (!state.isActive || state.suspended || state.done) continue;
            const pl = this._playerOf(state);
            if (!pl) { state.suspended = true; continue; }
            state.player = pl;
            this.pumpChunks(state);
        }
    }

    /** 每 tick 最多读 CHUNKS_PER_TICK 个分块，灌进 ghost 会话队列 */
    pumpChunks(state) {
        const renderer = global.renderer;
        const gr = global.ghostRenderer;
        const xuid = state.player && state.player.xuid;
        // 会话尚未建立（刚点击"放置"、startRender 尚未执行）→ 本 tick 不动作，避免数据丢失
        if (!renderer || !gr || !xuid || !gr.has(xuid)) return;

        for (let i = 0; i < CHUNKS_PER_TICK; i++) {
            if (state.cursor >= state.chunkKeys.length) break;
            this.injectChunk(state, state.chunkKeys[state.cursor++]);
        }
        if (state.cursor >= state.chunkKeys.length) {
            this._finish(state);
            return;
        }
        this._progressLog(state);
    }

    injectChunk(state, chunkKey) {
        const parts = chunkKey.split(',');
        const cx = Number(parts[0]);
        const cy = Number(parts[1]);
        const cz = Number(parts[2]);

        let blocks = null;
        try {
            blocks = this.megaManager.loadChunkFromDisk(state.schematicId, cx, cy, cz);
        } catch (e) {
            state.failedChunks++;
            this.log('WARN', 'CHUNK', `读取失败 (${chunkKey}): ${e && e.message ? e.message : e}`);
            return;
        }
        if (!blocks || blocks.length === 0) return;

        // 层模式：一个 32³ 分块里有 32 层，只把目标层那一层挑出来。
        // pos 是投影内相对坐标（数组或 {x,y,z}），与 transformPosition 的输入一致。
        if (state.isLayerMode && state.currentLayer >= 0) {
            const wantY = state.currentLayer;
            blocks = blocks.filter((b) => {
                const p = b && b.pos;
                const y = Array.isArray(p) ? p[1] : (p && p.y);
                return y === wantY;
            });
            if (blocks.length === 0) return;
        }

        const r = global.renderer.appendBlocks(state.player.xuid, blocks);
        state.injectedChunks++;
        state.injectedBlocks += r.added;
        state.dupBlocks += r.dup;
        state.stats.injected = state.injectedBlocks;
    }

    _finish(state) {
        if (state.done) return;
        state.done = true;
        state.finishedAt = Date.now();
        const secs = ((state.finishedAt - state.startedAt) / 1000).toFixed(1);
        logger.info(`[MegaRender] 注入完成 ${state.stateId} | 分块 ${state.injectedChunks}/${state.chunkTotal}`
            + ` | 入队 ${state.injectedBlocks} 格（去重 ${state.dupBlocks}）| ${secs}s`);
        this.log('INFO', 'DONE', `state=${state.stateId} blocks=${state.injectedBlocks} ms=${state.finishedAt - state.startedAt}`);
        try {
            const pl = mc.getPlayer(state.player && state.player.xuid);
            const scope = (state.isLayerMode && state.currentLayer >= 0)
                ? `第 ${state.currentLayer} 层`
                : '全部层';
            if (pl) pl.tell(`§a超大投影${scope}分块已全部入队：§e${state.injectedBlocks} §a格（铺设由 ghost 队列按 tick 推进）`);
        } catch (e) { /* 玩家不在线 */ }
    }

    _progressLog(state) {
        const now = Date.now();
        if (now - state.lastProgressAt < 3000) return;
        state.lastProgressAt = now;
        const scope = (state.isLayerMode && state.currentLayer >= 0) ? ` | 第 ${state.currentLayer} 层` : '';
        logger.info(`[MegaRender] 注入进度 ${state.stateId}${scope} | 分块 ${state.cursor}/${state.chunkTotal}`
            + ` | 入队 ${state.injectedBlocks} 格`);
    }

    _playerOf(state) {
        try {
            const xuid = state.player && state.player.xuid;
            return xuid ? mc.getPlayer(xuid) : null;
        } catch (e) {
            return null;
        }
    }

    // ==================== 层模式 ====================

    /**
     * 重算"这一轮要注入哪些分块"。
     *  全量模式：allChunkKeys 全上；
     *  层模式：只留 cy === floor(layer / 32) 那一行分块（块内再按 y 过滤，见 injectChunk）。
     * 只动注入计划，不碰世界 —— 旧 ghost 由 GhostRenderer 自己撤。
     * @returns {number} 本轮分块数
     */
    _rebuildPlan(state) {
        const all = state.allChunkKeys || state.chunkKeys || [];
        if (state.isLayerMode && state.currentLayer >= 0) {
            const cy = Math.floor(state.currentLayer / CHUNK_SIZE);
            state.chunkKeys = all.filter((k) => Number(k.split(',')[1]) === cy);
        } else {
            state.chunkKeys = all.slice();
        }
        state.chunkTotal = state.chunkKeys.length;
        state.cursor = 0;
        state.done = false;
        state.finishedAt = null;
        state.injectedChunks = 0;
        state.injectedBlocks = 0;
        state.dupBlocks = 0;
        state.failedChunks = 0;
        state.startedAt = Date.now();
        state.lastProgressAt = 0;
        state.stats.chunks = state.chunkTotal;
        state.stats.injected = 0;
        return state.chunkTotal;
    }

    /**
     * 切层（真生效）。
     *  layer < 0  = 显示全部层（全量注入）
     *  layer >= 0 = 只显示投影内第 layer 层（只注入该层所在的那一行分块）
     *
     * **本方法不碰世界**：调用方（ProjectionRenderer.setMegaLayer）会先让 GhostRenderer
     * 按新层重建会话，`GhostRenderer.enqueue` 发现层变了会自动 clear 旧会话；
     * 这里只负责把"下一步注入什么"改成对的。
     *
     * @returns {{ok:boolean, layer:number, chunks:number, unchanged?:boolean, reason?:string}}
     */
    setLayerMode(stateId, layerY) {
        const state = this.renderStates.get(stateId);
        if (!state) {
            return { ok: false, reason: 'no-state', layer: -1, chunks: 0 };
        }
        const layer = (typeof layerY === 'number' && Number.isFinite(layerY)) ? layerY : -1;
        const wantLayerMode = layer >= 0;

        // 同一层且本轮尚未注入完成 → 幂等返回，避免重复注入已写入的分块
        if (state.isLayerMode === wantLayerMode && state.currentLayer === layer
            && state.cursor < state.chunkKeys.length) {
            return { ok: true, layer, chunks: state.chunkTotal, unchanged: true };
        }

        state.isLayerMode = wantLayerMode;
        state.currentLayer = layer;
        const chunks = this._rebuildPlan(state);
        const all = state.allChunkKeys ? state.allChunkKeys.length : chunks;
        logger.info(`[MegaRender][LAYER] ${stateId} → ${layer < 0 ? '全部层' : `第 ${layer} 层`}`
            + ` | 待注入分块 ${chunks}/${all}`);
        this.log('INFO', 'LAYER', `state=${stateId} layer=${layer} chunks=${chunks}/${all}`);
        return { ok: true, layer, chunks };
    }

    // ==================== 查询 / 管理 ====================

    getBlocksInRadius(stateId, worldCenterX, worldCenterY, worldCenterZ, radius) {
        const state = this.renderStates.get(stateId);
        if (!state) return [];
        const projPos = state.projection.position;
        return this.megaManager.getBlocksNear(
            state.schematicId,
            worldCenterX - projPos.x,
            worldCenterY - projPos.y,
            worldCenterZ - projPos.z,
            radius
        );
    }

    stopRender(stateId) {
        const state = this.renderStates.get(stateId);
        if (!state) return;
        const done = state.injectedChunks;
        state.isActive = false;
        this.renderStates.delete(stateId);
        logger.info(`[MegaRender][STOP] ${stateId} chunks=${done}/${state.chunkTotal}`);
    }

    clearAll() {
        this.renderStates.clear();
    }

    getStats(stateId) {
        const state = this.renderStates.get(stateId);
        if (!state) return null;
        return {
            ...state.stats,
            chunks: state.chunkTotal,
            injectedChunks: state.injectedChunks,
            injectedBlocks: state.injectedBlocks,
            dupBlocks: state.dupBlocks,
            failedChunks: state.failedChunks,
            progress: `${state.cursor}/${state.chunkTotal}`,
            done: state.done,
            isLayerMode: state.isLayerMode,
            currentLayer: state.currentLayer
        };
    }

    getDebugInfo(stateId) {
        const state = this.renderStates.get(stateId);
        if (!state) return null;
        const player = state.player;
        return {
            stateId,
            isActive: state.isActive,
            playerPos: player ? { x: player.pos.x, y: player.pos.y, z: player.pos.z } : null,
            projection: {
                name: state.projection.name,
                position: state.projection.position,
                totalBlocks: state.projection.totalBlocks,
                isMega: state.projection.isMega,
                schematicId: state.projection.schematicId
            },
            inject: {
                strategy: 'full',
                chunksPerTick: CHUNKS_PER_TICK,
                chunks: state.chunkTotal,
                injectedChunks: state.injectedChunks,
                injectedBlocks: state.injectedBlocks,
                dupBlocks: state.dupBlocks,
                failedChunks: state.failedChunks,
                done: state.done
            },
            layerMode: {
                active: state.isLayerMode,
                layer: state.currentLayer,
                chunkRow: state.isLayerMode && state.currentLayer >= 0
                    ? Math.floor(state.currentLayer / CHUNK_SIZE)
                    : null
            },
            config: {
                injectStrategy: 'full',
                chunksPerTick: CHUNKS_PER_TICK,
                storageFormat: 'mcmega_v2 (palette+GZip)',
                chunkSize: CHUNK_SIZE,
                debugMode: this.debugMode
            }
        };
    }

    outputDebugInfo(state) {
        const player = state && state.player;
        if (!player || typeof player.tell !== 'function') return;
        player.tell(`§8[D] 分块 ${state.injectedChunks}/${state.chunkTotal}`
            + ` 入队 ${state.injectedBlocks} 格 去重 ${state.dupBlocks} 失败 ${state.failedChunks}`
            + ` done=${state.done}`);
    }

    setDebugMode(enabled) {
        this.debugMode = enabled;
        this.log('INFO', 'CONFIG', `Debug mode: ${enabled}`);
    }

    setFileDebug(enabled) {
        this.fileDebug = enabled;
        if (enabled && !this.debugLogger) {
            this.debugLogger = new DebugLogger({
                enabled: true,
                logDir: './plugins/LitematicaBE/logs/',
                maxFileSize: 10 * 1024 * 1024,
                maxFiles: 5,
                bufferSize: 50
            });
        }
        this.log('INFO', 'CONFIG', `File debug: ${enabled}`);
    }

    flushLogs() {
        if (this.debugLogger) this.debugLogger.flush();
    }
}

module.exports = { MegaProjectionRenderer };
