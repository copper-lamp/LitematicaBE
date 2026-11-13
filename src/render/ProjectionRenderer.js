// ProjectionRenderer — 投影会话层
//   1. 会话状态：谁在看哪个投影、第几层、逐层显示开关（UIManager 直接读写这些 Map）
//   2. 调度入口：startRender / cancelRender / updateBlocks 转给 GhostRenderer
//   3. 边界提示：showBounds 改为聊天栏文字

const { transformPosition } = require('../ghost/GhostRenderer');
// 会话标定：删除投影时要按投影 id 的哈希后缀认出"这条快照会话属于谁"
const { shortHash } = require('../ghost/GhostRenderer');
const { isMegaProjection, normalizeProjection } = require('../data/projectionFlags');

class ProjectionRenderer {
    /**
     * @param {{ghostRenderer?: object, logger?: object}} [opts]
     */
    constructor(opts) {
        const o = opts || {};

        // ── 契约成员（硬契约，UIManager / index.js 直接用） ──
        /**
         * 木剑当前控制的那个投影任务（每玩家一份）。
         * 从 3.0.4 起它只代表"主控"，全部激活投影见 playerProjections。
         * @type {Map<string, object>} xuid -> { projection, layer, ... }
         */
        this.activeProjections = new Map();
        /** @type {Map<string, boolean>} 逐层显示开关（主控投影的视图） */
        this.layerRenderMode = new Map();
        /** @type {Map<string, number>} 当前层号，-1 = 全部层（主控投影的视图） */
        this.currentRenderLayer = new Map();

        // ── 多投影 ──
        /**
         * 同一玩家同时加载的全部投影：xuid -> (projectionId -> task)。
         * task = { id, projection, layer, layerMode, count, injected, isMega, suspended, ... }
         * @type {Map<string, Map<string, object>>}
         */
        this.playerProjections = new Map();

        // ── 内部状态 ──
        this.ghostRenderer = o.ghostRenderer || null;
        this.dataManager = o.dataManager || null;
        this.logger = o.logger || null;
        this.loadedProjections = new Map();
        this.lastLayerSwitch = new Map();
        this.lastLayerNotice = new Map();

        this.startItemUseListener();
    }

    _log(level, msg) {
        const target = this.logger || (typeof logger !== 'undefined' ? logger : null);
        if (!target) return;
        const fn = target[level];
        if (typeof fn === 'function') fn.call(target, msg);
    }

    /** 装配期注入（GhostRenderer 依赖 registry/snapshot，构造顺序在 renderer 之后） */
    attachGhostRenderer(ghostRenderer) {
        this.ghostRenderer = ghostRenderer || null;
        return this;
    }

    _gr() {
        if (this.ghostRenderer) return this.ghostRenderer;
        if (typeof global !== 'undefined' && global.ghostRenderer) return global.ghostRenderer;
        return null;
    }

    /** PlayerData 持久化（构造注入优先，其次 global.dataManager） */
    _dm() {
        if (this.dataManager) return this.dataManager;
        if (typeof global !== 'undefined' && global.dataManager) return global.dataManager;
        return null;
    }

    // ==================== 多投影：任务表 ====================
    //
    // 一个玩家可以同时加载多个投影，每个投影一条 task、一条 GhostRenderer 会话。
    //   playerProjections : xuid -> (projectionId -> task)   全部
    //   activeProjections : xuid -> task                     木剑控制的那份（主控）
    //   layerRenderMode / currentRenderLayer                 主控投影的层状态视图
    // 切主控只改视图，不动世界；卸载一个投影只撤它自己的会话。

    /** @returns {Map<string, object>|null} 该玩家的任务表（不存在返回 null，不创建） */
    _tasksOf(player) {
        const xuid = player && player.xuid ? player.xuid : player;
        if (!xuid) return null;
        return this.playerProjections.get(xuid) || null;
    }

    _ensureTasks(xuid) {
        let m = this.playerProjections.get(xuid);
        if (!m) {
            m = new Map();
            this.playerProjections.set(xuid, m);
        }
        return m;
    }

    /** 精确定位某投影的 task */
    _taskOf(player, projectionId) {
        const m = this._tasksOf(player);
        return (m && projectionId) ? (m.get(projectionId) || null) : null;
    }

    /** 该玩家已加载的投影 task 列表（加载顺序），带 primary 标记 */
    getPlayerProjections(player) {
        const m = this._tasksOf(player);
        if (!m) return [];
        const xuid = player && player.xuid ? player.xuid : player;
        const primary = this.activeProjections.get(xuid);
        const out = [];
        for (const task of m.values()) {
            out.push({
                id: task.id,
                name: (task.projection && task.projection.name) || task.id,
                projection: task.projection,
                layer: task.layer,
                layerMode: !!task.layerMode,
                count: task.count || 0,
                injected: task.injected || 0,
                isMega: !!task.isMega,
                primary: !!primary && primary.id === task.id,
            });
        }
        return out;
    }

    isProjectionActive(player, projectionId) {
        return !!this._taskOf(player, projectionId);
    }

    /** 只更新"主控视图"（activeProjections / layerRenderMode / currentRenderLayer） */
    _applyPrimary(player, task) {
        const xuid = player && player.xuid ? player.xuid : player;
        if (!xuid || !task) return;
        this.activeProjections.set(xuid, task);
        this.loadedProjections.set(xuid, task.id || null);
        const lay = (typeof task.layer === 'number') ? task.layer : -1;
        this.currentRenderLayer.set(xuid, lay);
        this.layerRenderMode.set(xuid, !!task.layerMode);
    }

    /**
     * 把某个任务升为"木剑控制"，并同步 projManager / 持久化。
     * 木剑切层、旋转、建造模式、轻松放置全部从这层取目标。
     * @param {object} player
     * @param {string} projectionId
     * @param {{notify?: boolean, persist?: boolean, silent?: boolean}} [opts]
     * @returns {boolean}
     */
    setPrimaryProjection(player, projectionId, opts) {
        const o = opts || {};
        const task = this._taskOf(player, projectionId);
        if (!task) return false;

        if (typeof task.layer !== 'number') task.layer = -1;
        if (typeof task.layerMode !== 'boolean') task.layerMode = task.layer >= 0;

        this._applyPrimary(player, task);

        // projManager 是"当前操作投影"的另一份状态（放置/旋转/建造/验证都用它）
        try {
            const pm = (typeof global !== 'undefined') ? global.projManager : null;
            if (pm && typeof pm.activateProjection === 'function') {
                pm.activateProjection(player, Object.assign({}, task.projection, { renderLayer: task.layer }));
            }
        } catch (e) { /* 同步失败不影响渲染 */ }

        if (o.persist !== false) this._remember(player);
        if (o.notify) player.tell(`§a木剑当前控制：§f${(task.projection && task.projection.name) || task.id}`);
        return true;
    }

    /** 从任务表里摘掉一个投影（不碰世界、不落盘） */
    _dropTask(player, projectionId) {
        const xuid = player && player.xuid ? player.xuid : player;
        const tasks = this.playerProjections.get(xuid);
        if (!tasks) {
            this.activeProjections.delete(xuid);
            this.currentRenderLayer.delete(xuid);
            this.layerRenderMode.delete(xuid);
            this.loadedProjections.delete(xuid);
            return;
        }
        const wasPrimary = !!(this.activeProjections.get(xuid) && this.activeProjections.get(xuid).id === projectionId);
        tasks.delete(projectionId);
        if (!tasks.size) {
            this.playerProjections.delete(xuid);
            this.activeProjections.delete(xuid);
            this.currentRenderLayer.delete(xuid);
            this.layerRenderMode.delete(xuid);
            this.loadedProjections.delete(xuid);
            this.lastLayerSwitch.delete(xuid);
            return;
        }
        if (wasPrimary) {
            // 主控被卸载 → 顺位到剩下第一个，木剑不会"没有目标"
            const next = tasks.values().next().value;
            this._applyPrimary(player, next);
            try {
                const pm = (typeof global !== 'undefined') ? global.projManager : null;
                if (pm && typeof pm.activateProjection === 'function' && next) {
                    pm.activateProjection(player, Object.assign({}, next.projection, { renderLayer: next.layer }));
                }
            } catch (e) { /* 忽略 */ }
        }
    }

    // ==================== 木剑切层 ====================

    startItemUseListener() {
        mc.listen('onUseItem', (player, item) => {
            if (!item) return;
            const itemName = item.name || item.type || '';
            if (String(itemName).includes('wooden_sword')) {
                this.handleLayerSwitch(player);
            }
        });
    }

    /**
     * 木剑抬头/低头切层。
     * ghost 语义（按层写入：切层时先撤旧层再铺新层）：
     *   切到第 N 层 = 把旧层的 ghost 还原 + 把第 N 层写进世界，两条都是真实世界写入。
     */
    handleLayerSwitch(player) {
        const now = Date.now();
        const lastSwitch = this.lastLayerSwitch.get(player.xuid) || 0;
        const COOLDOWN = 200;
        if (now - lastSwitch < COOLDOWN) return;

        if (!this.layerRenderMode.get(player.xuid)) return;

        const task = this.activeProjections.get(player.xuid);
        if (!task || !task.projection) {
            player.tell('§c当前没有加载的投影');
            return;
        }

        const projection = task.projection;
        const maxLayer = (projection.dimensions ? projection.dimensions.y : 1) - 1;
        let currentLayer = this.currentRenderLayer.get(player.xuid);

        if (currentLayer === undefined || currentLayer === null) {
            currentLayer = 0;
        }

        const pitch = (player.direction && typeof player.direction.pitch === 'number') ? player.direction.pitch : 0;
        // 阈值沿用原 getPlayerLookingLayer 的 ±30：抬头 = 上一层，低头 = 下一层，
        // 平视 = 回到施工层（projection.buildLayer）。目标层与当前层相同就不动，
        // 否则每次平视都会把整层 ghost 重写一遍。
        let target;
        if (pitch < -30) target = Math.min(currentLayer + 1, maxLayer);
        else if (pitch > 30) target = Math.max(currentLayer - 1, 0);
        else target = (typeof projection.buildLayer === 'number') ? projection.buildLayer : currentLayer;

        if (target === currentLayer) return;
        currentLayer = target;

        this.lastLayerSwitch.set(player.xuid, now);

        const gr = this._gr();
        if (!gr) {
            player.tell('§c渲染器未就绪（GhostRenderer 未装配）');
            return;
        }

        // 统一入口：普通投影走 gr.setLayer（按 y 过滤内存方块），MEGA 走分块计划
        const r = this.applyLayer(player, projection, currentLayer);

        if (!r.ok) {
            player.tell(`§c切换失败：${this._reasonText(r.reason)}`);
            return;
        }
        if (r.unchanged) return;
        const detail = (typeof r.chunks === 'number' && r.chunks > 0)
            ? `${r.chunks} 个分块待注入`
            : `${r.count || 0} 格`;
        player.tell(`§7已切换到第 ${currentLayer} 层 (共 ${maxLayer + 1} 层)，${detail}`);
    }

    /**
     * 切层统一入口（木剑 / 命令 / 表单都走这里）。
     *  - 普通投影：GhostRenderer.setLayer（extractor 按 y 过滤内存里的方块）
     *  - MEGA 投影：setMegaLayer（只注入该层所在分块行，块内按 y 过滤）
     * 两种都会：撤旧层 ghost → 建新会话 → 更新 currentRenderLayer/layerRenderMode → 落盘。
     *
     * @returns {{ok:boolean, count?:number, chunks?:number, unchanged?:boolean, reason?:string}}
     */
    /**
     * 切层之后统一收口：更新任务状态、主控视图、落盘。
     * 多投影下**只有主控的那份**会改 layerRenderMode / currentRenderLayer 视图，
     * 别的投影的层状态记在它自己的 task 上，切回主控时原样恢复。
     */
    _afterLayerChange(player, projection, lay) {
        const xuid = player.xuid;
        const pid = projection && projection.id;
        const tasks = this._tasksOf(player);
        let task = null;
        if (tasks) {
            task = (pid && tasks.get(pid)) || null;
            if (!task && pid) {
                // 视图里有、任务表里没有（外部直接调 setMegaLayer 的老路径）→ 补一条
                task = {
                    id: pid,
                    projection,
                    layer: lay,
                    layerMode: lay >= 0,
                    count: projection.totalBlocks || 0,
                    startedAt: Date.now(),
                    stats: null,
                    suspended: false,
                    isMega: isMegaProjection(projection),
                    injected: 0,
                };
                tasks.set(pid, task);
            }
        } else {
            task = this.activeProjections.get(xuid) || null;
        }
        if (task) {
            task.projection = projection;
            task.layer = lay;
            task.layerMode = lay >= 0;
            task.injected = 0;
        }

        const primary = this.activeProjections.get(xuid);
        if (!primary || !pid || primary.id === pid || !tasks) {
            this.currentRenderLayer.set(xuid, lay);
            this.layerRenderMode.set(xuid, lay >= 0);
            if (task) this._applyPrimary(player, task);
        }
        this._remember(player, projection, lay);
    }

    applyLayer(player, projection, layer) {
        const lay = (typeof layer === 'number' && Number.isFinite(layer)) ? layer : -1;
        if (!player || !player.xuid || !projection) return { ok: false, reason: 'no-player' };

        const isMega = isMegaProjection(projection) && !(projection.blocks && projection.blocks.length);
        if (isMega) return this.setMegaLayer(player, projection, lay);

        const gr = this._gr();
        if (!gr) return { ok: false, reason: 'no-ghost-renderer' };
        const r = gr.setLayer(player, projection, lay);
        this._afterLayerChange(player, projection, lay);
        return r;
    }

    /**
     * MEGA 投影切层（逐层显示）。
     *
     * 差别在数据源：普通投影靠 extractor 按 y 过滤内存里的方块；MEGA 的方块在 .mcmega
     * 分块里，所以"层"= 让 MegaProjectionRenderer 只注入该层所在的那一行分块
     * （cy = floor(layer / 32)），块内再按 y 精确过滤。
     *
     * 世界侧的旧 ghost 不用这里撤：`GhostRenderer.enqueue` 发现 layer 变了会自动 clear。
     *
     * @returns {{ok:boolean, layer:number, chunks:number, unchanged?:boolean, reason?:string}}
     */
    setMegaLayer(player, projection, layer) {
        if (!player || !player.xuid || !projection) return { ok: false, reason: 'no-player', layer: -1, chunks: 0 };
        const gr = this._gr();
        if (!gr) return { ok: false, reason: 'no-ghost-renderer', layer: -1, chunks: 0 };

        const lay = (typeof layer === 'number' && Number.isFinite(layer)) ? layer : -1;
        const mega = (typeof global !== 'undefined') ? global.megaRenderer : null;
        const key = this._megaStateKey(player, projection);

        if (!mega || typeof mega.setLayerMode !== 'function' || !key
            || !mega.renderStates || !mega.renderStates.has(key)) {
            return { ok: false, reason: 'mega-not-ready', layer: lay, chunks: 0 };
        }

        const plan = mega.setLayerMode(key, lay);
        if (!plan || !plan.ok) {
            return { ok: false, reason: (plan && plan.reason) || 'mega-layer', layer: lay, chunks: 0 };
        }

        // 层变了 → enqueue 内部会 clear 这一份的旧会话，再按 deferBlocks 建一个新的空会话。
        // keepOthers：别的投影的会话/ghost 一处都不能动。
        const r = gr.enqueue(player, projection, { layer: lay, deferBlocks: true, keepOthers: true });
        if (!r.ok) {
            return { ok: false, reason: r.reason, layer: lay, chunks: plan.chunks };
        }

        this._afterLayerChange(player, projection, lay);
        const task = this._taskOf(player, projection.id) || this.activeProjections.get(player.xuid);
        if (task) {
            task.count = projection.totalBlocks || task.count || 0;
            task.suspended = false;
            task.isMega = true;
        }

        this._log('info', `[ProjectionRenderer] MEGA 切层 → ${lay < 0 ? '全部层' : `第 ${lay} 层`}`
            + `，待注入 ${plan.chunks} 个分块`);
        return { ok: true, layer: lay, chunks: plan.chunks, unchanged: !!plan.unchanged };
    }

    _reasonText(reason) {
        switch (reason) {
            case 'writegate': return 'addon 版本校验未通过，ghost 写入已禁用（/litematica:ghost info 查看）';
            case 'registry': return 'ghost_index 未就绪（检查 plugins/LitematicaBE/data/ghost_index.json）';
            case 'too-many': return '投影可见方块超过单次铺设上限';
            case 'empty':
            case 'empty-surface': return '这一层没有任何可见方块';
            case 'no-projection': return '投影数据为空';
            case 'no-player': return '取不到玩家信息';
            case 'no-ghost-renderer': return 'GhostRenderer 未装配';
            case 'mega-not-ready': return '超大投影的分块注入状态不在（通常是服务器重启过），请重新放置该投影';
            case 'mega-layer': return '超大投影切层失败（分块计划为空）';
            case 'no-state': return '超大投影注入状态缺失';
            default: return reason || '未知原因';
        }
    }

    // ==================== 契约方法 ====================

    /**
     * MEGA 注入状态的键。统一走 MegaProjectionRenderer.stateIdFor：
     * 同一玩家同一图纸放多份时它会带后缀，这里绝不能再手拼 `${xuid}_${schematicId}`。
     */
    _megaStateKey(player, projection) {
        const mega = (typeof global !== 'undefined') ? global.megaRenderer : null;
        if (!mega) return null;
        if (typeof mega.stateIdFor === 'function') return mega.stateIdFor(player, projection);
        return (projection && projection.schematicId) ? `${player.xuid}_${projection.schematicId}` : null;
    }

    /**
     * MEGA 注入状态自愈：renderStates 只活在内存里（玩家退出、服务器重启都会丢）。
     * 任何"打开/恢复已有 MEGA 投影"的路径都应先调一次，否则切层报 mega-not-ready、
     * 剩余分块也永远不会再注入。
     * @returns {boolean} 状态是否可用
     */
    _ensureMegaState(player, projection) {
        if (!player || !projection) return false;
        // 统一判定 + 就地归一化：restoreForPlayer 直接调这里、不经过 startRender，
        // 所以脏数据（isMega 是字符串）必须在这一层就修好。
        normalizeProjection(projection);
        if (!isMegaProjection(projection)) return false;
        const mega = (typeof global !== 'undefined') ? global.megaRenderer : null;
        const key = this._megaStateKey(player, projection);
        if (!mega || !key || !mega.renderStates) return false;
        if (typeof mega.isEnabled === 'function' && !mega.isEnabled()) return false;
        if (mega.renderStates.has(key)) return true;
        try {
            return !!mega.initRenderState(player, projection.schematicId, projection);
        } catch (e) {
            this._log('warn', `[ProjectionRenderer] MEGA 注入状态重建失败: ${e && e.message ? e.message : e}`);
            return false;
        }
    }

    /**
     * 开投影之前先把"上次会话的无主快照"清掉。
     *
     * 为什么必须做：强退/重启后世界里留着 ghost、快照还认着它们、内存会话已经没了。
     * 此时直接 enqueue 新会话，`record()` 读到的"原方块"就是 ghost —— 撤销时会把 ghost
     * 写回去，残留不但消不掉，还会被当成"原状"固化下来。所以先还原再开新会话。
     *
     * @returns {number} 清掉的无主会话数
     */
    _reclaimBeforeStart(player) {
        const g = (typeof global !== 'undefined') ? global : {};
        const snap = g.worldSnapshot;
        if (!snap || typeof snap.findSessions !== 'function') return 0;
        const gr = this._gr();
        const prefix = this._sessionPrefix(player.xuid);
        const orphans = (snap.findSessions(prefix) || [])
            .filter(s => !gr || !gr.sessions || !gr.sessions.has(s.sessionId));
        if (!orphans.length) return 0;
        const r = this.reclaimOrphans(player, { resetState: false });
        this._log('info', `[ProjectionRenderer] 开投影前清掉上次的孤儿快照 ${orphans.length} 个（还原 ${r.restored} 格 / 残留 ${r.remaining}）`);
        return orphans.length;
    }

    /**
     * 开始显示一个投影（异步铺设，tick 里按预算推进）。
     *
     * 多投影：默认与已加载的其它投影**并存**（各自一条 ghost 会话），
     * 新开的这份自动成为"木剑控制"（primary）。传 `{ primary: false }` 可只加载不夺焦。
     *
     * @param {object} player
     * @param {object} projection
     * @param {number} [layer] -1 = 全部层
     * @param {{primary?: boolean}} [opts]
     */
    startRender(player, projection, layer, opts) {
        const o = opts || {};
        const lay = (typeof layer === 'number') ? layer : -1;
        const gr = this._gr();
        if (!gr) {
            this._log('warn', '[ProjectionRenderer] GhostRenderer 未装配，startRender 无效');
            return false;
        }
        if (!player || !projection) return false;

        // 脏数据兜底：isMega 可能是旧格式的字符串，先就地修成布尔再往下走
        normalizeProjection(projection);

        // 没有 id 的临时投影也要能进任务表：给一个玩家级键位（同一时刻只允许一份）
        const taskId = projection.id || `__anon_${player.xuid}`;
        const prevTask = this._taskOf(player, taskId);
        const makePrimary = o.primary !== false;
        const finishOk = () => {
            if (makePrimary) this.setPrimaryProjection(player, taskId, { persist: false });
            // 全量落盘：loadedProjections（全部）、projectionLayers、currentProjectionId（主控）。
            // persist:false 用于"逐个恢复"，由恢复流程在任务表齐全后统一落一次。
            if (o.persist !== false) this._remember(player);
        };

        // 上次的残格先清掉，再开新会话（否则 record() 会把 ghost 当成原方块记下来）
        try { this._reclaimBeforeStart(player); } catch (e) {
            this._log('warn', `[ProjectionRenderer] 开投影前清理孤儿快照失败: ${e && e.message ? e.message : e}`);
        }

        // 超大投影（MEGA）：方块在 .mcmega 分块里，projection.blocks 是空的。
        // 这里只建一个**空队列会话**（快照/期望/撤销链路全部照常），
        // 方块由 MegaProjectionRenderer 每 tick 用 appendBlocks 增量灌进来。
        if (isMegaProjection(projection) && (!projection.blocks || projection.blocks.length === 0)) {
            // 自愈：任何一条"打开已有投影"的路径只要调到这里，就确保注入状态已存在
            this._ensureMegaState(player, projection);
            const mega = (typeof global !== 'undefined') ? global.megaRenderer : null;
            const stateKey = this._megaStateKey(player, projection);
            const ready = !!(mega && stateKey && mega.renderStates && mega.renderStates.has(stateKey));
            if (!ready) {
                // 分块数据缺失 / 开关被关掉 → 这个投影这次起不来了。
                // 但**不要删持久化记录**：那等于把玩家的投影弄丢，而且下次开服也不会再试。
                // 只清这一份的渲染态（其它投影照常显示），等玩家修好配置或数据后再手动重开。
                this._dropTask(player, taskId);
                if (makePrimary && o.persist !== false) this._remember(player);
                player.tell('§e超大投影渲染未就绪（render.enableMega 未开，或分块数据已缺失）');
                player.tell('§7投影记录已保留：打开 render.enableMega 后重进，或重新放置该投影');
                if (stateKey === null) {
                    player.tell('§c该投影缺少 schematicId，无法定位分块数据；请重新加载一次 .litematic');
                }
                this._log('warn', `[ProjectionRenderer] MEGA 投影 "${projection.name || projection.id}" 缺少注入状态（stateKey=${stateKey || 'null'}），已跳过，保留恢复记录`);
                return false;
            }
            const r = gr.enqueue(player, projection, { layer: lay, deferBlocks: true, keepOthers: true });
            if (!r.ok) {
                const text = this._reasonText(r.reason);
                this._log('warn', `[ProjectionRenderer] MEGA 投影 "${projection.name || projection.id}" 会话建立失败：${text}`);
                if (reasonIsUserFacing(r.reason)) player.tell(`§c超大投影无法显示：${text}`);
                return false;
            }
            // count 用投影真实方块数，否则 UI 会显示"0 方块"
            const task = {
                id: taskId,
                projection,
                layer: lay,
                layerMode: lay >= 0,
                count: projection.totalBlocks || 0,
                startedAt: Date.now(),
                stats: r.stats,
                suspended: false,
                isMega: true,
                injected: prevTask ? prevTask.injected : 0,
            };
            this._ensureTasks(player.xuid).set(taskId, task);
            finishOk();
            player.tell(`§e超大投影"${projection.name || projection.id}"：正在按分块注入方块，进度见控制台`);
            this._log('info', `[ProjectionRenderer] MEGA 会话已建立 "${projection.name || projection.id}"，等待分块注入（总数 ${projection.totalBlocks || '?'}）`);
            return true;
        }

        // 普通投影：只替换**这一份**的会话，别的投影会话不动（keepOthers）
        const r = gr.enqueue(player, projection, { layer: lay, keepOthers: true });
        if (!r.ok) {
            const text = this._reasonText(r.reason);
            this._log('warn', `[ProjectionRenderer] 投影 "${projection.name || projection.id}" 未能铺设：${text}`);
            if (reasonIsUserFacing(r.reason)) player.tell(`§c投影无法显示：${text}`);
            return false;
        }

        const task = {
            id: taskId,
            projection,
            layer: lay,
            layerMode: lay >= 0,
            count: r.count,
            startedAt: Date.now(),
            stats: r.stats,
            suspended: false,
            isMega: false,
            injected: 0,
        };
        this._ensureTasks(player.xuid).set(taskId, task);
        // 记住"这个玩家现在显示哪些投影"，玩家退出重进 / 服务器重启后靠它恢复
        finishOk();
        return true;
    }

    /**
     * 取消显示并撤销世界里的 ghost。
     * @param {object} player
     * @param {string} [projectionId] 只撤这一个；省略 = 撤该玩家全部会话（旧语义）
     * @returns {boolean} 有没有会话被撤销
     */
    cancelRender(player, projectionId) {
        const xuid = player && player.xuid ? player.xuid : player;
        const tasks = this._tasksOf(player);
        const pid = projectionId
            || (this.activeProjections.get(xuid) && this.activeProjections.get(xuid).id)
            || null;

        if (!tasks || !tasks.size) {
            player.tell('§c当前没有正在渲染的投影');
            return false;
        }
        if (pid && !tasks.has(pid)) {
            player.tell('§c当前没有正在渲染的投影');
            return false;
        }

        if (pid) {
            this.clearProjection(player, pid, { silent: false });
            player.tell('§a投影显示已取消，世界已还原');
            return true;
        }

        // 没给 id（旧调用）：清全部会话
        this.clearPlayerProjection(player);
        this._forget(player);      // 用户主动取消：重进不该再把它拉回来
        player.tell('§a投影显示已取消，世界已还原');
        return true;
    }

    /**
     * 只卸载某一个投影（多投影的"卸载这个"）。
     * @param {object} player
     * @param {string} projectionId
     * @param {{silent?: boolean, forget?: boolean}} [opts] forget=true 时一并清持久化记录
     * @returns {boolean}
     */
    clearProjection(player, projectionId, opts) {
        const o = opts || {};
        const gr = this._gr();
        let ok = false;
        try {
            if (gr && typeof gr.clear === 'function') {
                const r = gr.clear(player, { silent: o.silent === true, projectionId });
                ok = !!(r && r.ok);
            }
        } catch (e) {
            this._log('warn', `[ProjectionRenderer] 撤销投影 ${projectionId} 失败（任务仍会被摘掉）: ${e && e.message ? e.message : e}`);
        } finally {
            this._dropTask(player, projectionId);
            // 先把这一条从存档里删掉（_remember 是合并语义，不删会被合并回来）
            try {
                const dm = this._dm();
                if (dm && typeof dm.updatePlayerData === 'function') {
                    const pd = dm.getPlayerData(player.xuid) || {};
                    const ids = Array.isArray(pd.loadedProjections)
                        ? pd.loadedProjections.filter(id => id && id !== projectionId) : [];
                    const layers = Object.assign({}, pd.projectionLayers || {});
                    const modes = Object.assign({}, pd.projectionLayerModes || {});
                    delete layers[projectionId];
                    delete modes[projectionId];
                    const nextPrimary = (pd.currentProjectionId && pd.currentProjectionId !== projectionId)
                        ? pd.currentProjectionId
                        : (ids.length ? ids[ids.length - 1] : null);
                    dm.updatePlayerData(player.xuid, {
                        loadedProjections: ids,
                        projectionLayers: layers,
                        projectionLayerModes: modes,
                        currentProjectionId: nextPrimary,
                    });
                }
            } catch (e) { /* 记录清理失败不影响撤销 */ }

            // 还有别的投影在显示 → 只更新记录；一个都不剩 → 清空恢复记录
            if (this._tasksOf(player)) {
                if (o.forget !== false) this._remember(player);
            } else {
                this._forget(player);
            }
        }
        return ok;
    }

    // ==================== 删除投影：把世界清干净 ====================
    //
    // 事故（2026-11-11 真机）：
    //   加载 MEGA 投影 → 强关服（注入状态是纯内存的，世界 ghost 残留、快照保留）→ 重进 →
    //   在菜单/命令里删投影。旧实现只在"该投影有活跃会话"时才撤世界：
    //     if (renderer.isProjectionLoaded(player, id)) renderer.cancelRender(player, id);
    //   重启后没有会话 → 世界一格没动，但 projections.json 里的记录被删了 ——
    //   玩家看到"列表里没了，投影还在世界里"，而且 MEGA 的注入状态还可能继续往世界灌方块。
    //
    // 正确顺序：**先清世界，清不干净就不许删记录**（否则永久残留、连撤销线索都丢了）。

    /**
     * 投影的世界包围盒（考虑 rotation 交换 x/z 跨度）。
     * @returns {{minX:number,maxX:number,minY:number,maxY:number,minZ:number,maxZ:number}}
     */
    _bboxOf(projection) {
        const p = projection.position || {};
        const d = projection.dimensions || {};
        const w = Math.max(1, Math.round(Number(d.x) || 1));
        const h = Math.max(1, Math.round(Number(d.y) || 1));
        const dd = Math.max(1, Math.round(Number(d.z) || 1));
        const rot = ((Math.round(Number(projection.rotation) || 0) % 360) + 360) % 360;
        const spanX = (rot === 90 || rot === 270) ? dd : w;
        const spanZ = (rot === 90 || rot === 270) ? w : dd;
        const ox = Math.round(Number(p.x) || 0);
        const oy = Math.round(Number(p.y) || 0);
        const oz = Math.round(Number(p.z) || 0);
        return { minX: ox, maxX: ox + spanX - 1, minY: oy, maxY: oy + h - 1, minZ: oz, maxZ: oz + spanZ - 1 };
    }

    _inBox(box, x, y, z) {
        return x >= box.minX && x <= box.maxX
            && y >= box.minY && y <= box.maxY
            && z >= box.minZ && z <= box.maxZ;
    }

    /**
     * 这条快照会话是不是"这个投影"留下的？
     *   1. 新会话：sessionId 末尾带 `-<shortHash(projectionId)>`，直接认亲
     *   2. 旧会话：抽样看方块落点是否在本投影包围盒内（≥90% 即认）
     */
    _sessionBelongsToProjection(session, projection, projectionId) {
        if (!session || !projection) return false;
        const pid = projectionId || projection.id;
        if (!pid) return false;
        const suffix = `-${shortHash(pid)}`;
        if (String(session.sessionId || '').endsWith(suffix)) return true;

        const dimid = Number.isFinite(projection.dimension) ? projection.dimension : 0;
        if (Number.isFinite(session.dimid) && session.dimid !== dimid) return false;

        const box = this._bboxOf(projection);
        let total = 0, inside = 0;
        for (const rec of session.blocks.values()) {
            total++;
            if (this._inBox(box, rec.x, rec.y, rec.z)) inside++;
            if (total >= 400) break;
        }
        return total > 0 && inside / total >= 0.9;
    }

    /**
     * 扫一片区域，把"已经失去所有账本"的 ghost 直接清掉。
     *
     * 为什么需要它：如果服务器在某个投影显示期间被强关，MegaProjectionRenderer 的注入状态、
     * GhostRenderer 的会话、甚至快照与期望全都可能已经散失或被人删掉 —— 这时世界里残留的
     * `lit:g_*` 方块**没有任何东西能接管**：`/lit ghost clean` 找不到快照会话，
     * `reclaimOrphans` 也认不出来。唯一的办法是"按坐标读世界、判是不是 ghost、写回空气"。
     *
     * 安全约束：
     *   - 只碰 ghost 方块（`lit:g_*`），玩家自己的建筑一格不动；
     *   - **活跃会话（正在显示的投影）那些格一律跳过**——它们有账本，扫掉只会让投影"缺块"；
     *   - 读不到方块（区块未加载）就跳过，绝不盲写；
     *   - 写之前先 `expect.del` + `guard.forget`，否则 GhostGuard 会立刻把 ghost 补回来；
     *   - 半径上限 32（65³ ≈ 27 万格），避免一条命令把主线程卡死。
     *
     * @param {object} player
     * @param {{radius?:number, box?:{minX:number,minY:number,minZ:number,maxX:number,maxY:number,maxZ:number},
     *          dimid?:number, dryRun?:boolean}} [opts]
     * @returns {{scanned:number, cleared:number, failed:number, skipped:number, kept:number, dryRun:boolean, error?:string}}
     */
    sweepGhosts(player, opts) {
        const o = opts || {};
        const g = (typeof global !== 'undefined') ? global : {};
        const guard = g.ghostGuard;
        const registry = g.ghostRegistry;
        const expect = g.ghostExpect;
        const gr = this._gr();
        const out = { scanned: 0, cleared: 0, failed: 0, skipped: 0, kept: 0, dryRun: !!o.dryRun };
        if (!player || !player.pos) { out.error = 'no-player'; return out; }

        const dimid = Number.isFinite(o.dimid) ? o.dimid
            : ((typeof player.pos.dimid === 'number') ? player.pos.dimid : 0);
        const px = Math.floor(Number(player.pos.x) || 0);
        const py = Math.floor(Number(player.pos.y) || 0);
        const pz = Math.floor(Number(player.pos.z) || 0);

        // 三种范围来源，优先级：box > chunks（N×N 区块，以玩家所在区块为中心）> radius（格）
        let box = null;
        if (o.box) {
            box = o.box;
        } else if (o.chunks) {
            // 以自身为中心的 N×N 区块。默认 5 → 水平 80×80，纵向按 yRange（默认 ±32 层）
            const CHUNK = 16;
            const n = Math.max(1, Math.min(9, Math.round(Number(o.chunks) || 5)));
            const half = Math.floor(n / 2);
            const pcx = Math.floor(px / CHUNK);
            const pcz = Math.floor(pz / CHUNK);
            const yRange = Math.max(1, Math.min(128, Math.round(Number(o.yRange) || 32)));
            box = {
                minX: (pcx - half) * CHUNK,
                maxX: (pcx - half + n) * CHUNK - 1,
                minY: Math.max(-64, py - yRange),
                maxY: Math.min(320, py + yRange),
                minZ: (pcz - half) * CHUNK,
                maxZ: (pcz - half + n) * CHUNK - 1,
            };
            out.chunks = n;
        } else {
            const r = Math.max(1, Math.min(32, Math.round(Number(o.radius) || 16)));
            box = {
                minX: px - r, maxX: px + r,
                minY: py - r, maxY: py + r,
                minZ: pz - r, maxZ: pz + r,
            };
        }
        out.box = box;

        // 活跃会话已写进世界的格：它们有账本（能正常撤销/补写），扫描不能碰
        const live = new Set();
        try {
            if (gr && gr.sessions) {
                for (const s of gr.sessions.values()) {
                    if (!s || (Number.isFinite(s.dimid) && s.dimid !== dimid)) continue;
                    for (const e of (s.written || [])) live.add(`${e.x},${e.y},${e.z}`);
                }
            }
        } catch (e) { /* 取不到活跃集合就退化成"全扫"，仍只碰 ghost */ }

        const isGhost = (b) => {
            if (!b) return false;
            const t = b.type || b.name || '';
            if (guard && typeof guard.isGhostBlock === 'function') {
                try { return !!guard.isGhostBlock(b); } catch (e) { return false; }
            }
            if (registry && typeof registry.isGhost === 'function') {
                try { return !!registry.isGhost(t); } catch (e) { return false; }
            }
            return typeof t === 'string' && t.indexOf('lit:g_') === 0;
        };

        for (let y = box.minY; y <= box.maxY; y++) {
            for (let x = box.minX; x <= box.maxX; x++) {
                for (let z = box.minZ; z <= box.maxZ; z++) {
                    let b = null;
                    try { b = mc.getBlock(x, y, z, dimid); } catch (e) { b = null; }
                    if (!b) { out.skipped++; continue; }     // 区块未加载：绝不盲写
                    out.scanned++;
                    if (!isGhost(b)) continue;
                    if (live.has(`${x},${y},${z}`)) { out.kept++; continue; }   // 活跃投影的格
                    if (o.dryRun) { out.cleared++; continue; }

                    try { if (expect && typeof expect.del === 'function') expect.del(dimid, x, y, z); } catch (e) { /* 忽略 */ }
                    try { if (guard && typeof guard.forget === 'function') guard.forget(dimid, x, y, z); } catch (e) { /* 忽略 */ }
                    let ok = false;
                    try { ok = !!mc.setBlock(x, y, z, dimid, 'minecraft:air', 0); } catch (e) { ok = false; }
                    if (ok) out.cleared++; else out.failed++;
                }
            }
        }

        try { if (expect && typeof expect.flush === 'function') expect.flush(); } catch (e) { /* 落盘失败不影响已清掉的格 */ }
        this._log('info', `[ProjectionRenderer] ghost 扫描 (${dimid}) ${box.minX}~${box.maxX}, ${box.minY}~${box.maxY}, `
            + `${box.minZ}~${box.maxZ}：扫描 ${out.scanned} 格，清掉 ${out.cleared}，失败 ${out.failed}，`
            + `活跃投影保留 ${out.kept}，跳过 ${out.skipped}`
            + (o.dryRun ? '（演练模式，未写世界）' : ''));
        return out;
    }

    /**
     * 删除投影前把世界里的 ghost 清干净。
     *
     * 三层兜底（按可靠性从高到低）：
     *   1. 活跃会话：`GhostRenderer.clear({projectionId})` —— 走快照精确还原
     *   2. 孤儿快照（重启/强退后没有内存会话）：按 sessionId 哈希或包围盒认出，`snapshot.revert`
     *   3. 期望账本：包围盒内仍是 ghost、但已经没有快照的格 → 写回空气并删期望
     *
     * @param {object|object[]} players 需要一并清理的玩家（可为 `{xuid}` 伪对象，覆盖离线玩家）
     * @param {object} projection 要删除的投影（至少要 id/dimension/position/dimensions）
     * @param {{dimid?: number}} [opts]
     * @returns {{ok:boolean, restored:number, kept:number, failed:number, remaining:number,
     *            sessions:number, expect:number, megaStopped:number, reason?:string}}
     */
    purgeProjection(players, projection, opts) {
        const o = opts || {};
        const out = {
            ok: false, restored: 0, kept: 0, failed: 0, remaining: 0,
            sessions: 0, expect: 0, megaStopped: 0,
        };
        if (!projection) { out.reason = 'no-projection'; return out; }

        const list = (Array.isArray(players) ? players : [players]).filter((p) => p && p.xuid);
        const pid = projection.id || null;
        const g = (typeof global !== 'undefined') ? global : {};
        const snap = g.worldSnapshot;
        const expect = g.ghostExpect;
        const guard = g.ghostGuard;
        const gr = this._gr();
        const dimid = Number.isFinite(o.dimid) ? o.dimid
            : (Number.isFinite(projection.dimension) ? projection.dimension : 0);

        // ── 0) 先掐掉 MEGA 注入：否则删完记录，MegaProjectionRenderer 还在每 tick 往世界灌方块 ──
        try {
            const mega = g.megaRenderer;
            if (mega && typeof mega.stopRender === 'function') {
                for (const p of list) {
                    const sid = this._megaStateKey(p, projection);
                    if (sid) { mega.stopRender(sid); out.megaStopped++; }
                }
            }
        } catch (e) { /* 停注入失败不阻塞清理 */ }

        // ── 1) 活跃会话：走正规撤销（会话里有 written/期望，能精确还原）──
        if (gr && pid) {
            for (const p of list) {
                const has = (typeof gr.hasProjection === 'function')
                    ? gr.hasProjection(p, pid) : gr.has(p.xuid);
                if (!has) continue;
                try {
                    const r = gr.clear(p, { silent: true, projectionId: pid });
                    out.sessions++;
                    out.restored += r.restored || 0;
                    out.kept += r.kept || 0;
                    out.failed += r.failed || 0;
                    out.remaining += r.remaining || 0;
                } catch (e) {
                    this._log('warn', `[ProjectionRenderer] 删除投影时撤销活跃会话失败: ${e && e.message ? e.message : e}`);
                    out.failed++;
                }
            }
        }

        // ── 2) 孤儿快照：重启/强退后没有内存会话，但快照里记着"哪些格原来是空气" ──
        if (snap && typeof snap.findSessions === 'function' && typeof snap.revert === 'function') {
            const live = new Set();
            if (gr && gr.sessions) for (const s of gr.sessions.values()) if (s && s.sessionId) live.add(s.sessionId);

            for (const p of list) {
                const prefix = this._sessionPrefix(p.xuid);
                const cands = (snap.findSessions(prefix) || [])
                    .filter((s) => !live.has(s.sessionId))
                    .filter((s) => this._sessionBelongsToProjection(s, projection, pid));
                for (const s of cands) {
                    out.sessions++;
                    // 先删期望：否则 GhostGuard 会把这格又补回 ghost
                    for (const rec of s.blocks.values()) {
                        try { if (expect && typeof expect.del === 'function') expect.del(s.dimid, rec.x, rec.y, rec.z); } catch (e) { /* 忽略 */ }
                        try { if (guard && typeof guard.forget === 'function') guard.forget(s.dimid, rec.x, rec.y, rec.z); } catch (e) { /* 忽略 */ }
                    }
                    try {
                        const r = snap.revert(s.sessionId, { limit: Number.MAX_SAFE_INTEGER });
                        out.restored += r.restored || 0;
                        out.kept += r.kept || 0;
                        out.failed += r.failed || 0;
                        out.remaining += r.remaining || 0;
                        if ((r.remaining || 0) === 0 && typeof snap.close === 'function') snap.close(s.sessionId);
                        else if (typeof snap.persist === 'function') snap.persist(s.sessionId);
                    } catch (e) {
                        this._log('warn', `[ProjectionRenderer] 删除投影时还原快照 ${s.sessionId} 失败: ${e && e.message ? e.message : e}`);
                        out.failed++;
                    }
                }
            }
        }

        // ── 3) 期望账本兜底：包围盒内仍挂着 ghost、但快照已经丢了（或从来没落过盘）──
        if (expect && typeof expect.forEach === 'function') {
            const registry = (gr && gr.registry) || g.ghostRegistry || null;
            const isGhostFn = (guard && typeof guard.isGhostBlock === 'function')
                ? (b) => !!guard.isGhostBlock(b)
                : ((registry && typeof registry.isGhost === 'function')
                    ? (b) => !!registry.isGhost(b.type || b.name || '')
                    : () => false);
            const box = this._bboxOf(projection);
            const drops = [];
            expect.forEach((d, x, y, z) => {
                if (d !== dimid) return;
                if (this._inBox(box, x, y, z)) drops.push([d, x, y, z]);
            }, dimid);

            for (const [d, x, y, z] of drops) {
                let cur = null;
                try { cur = mc.getBlock(x, y, z, d); } catch (e) { cur = null; }
                if (!cur) {
                    // 区块未加载：状态未知，既不能写也不能保证干净 —— 保留期望，等玩家靠近再清
                    out.remaining++;
                    continue;
                }
                if (isGhostFn(cur)) {
                    try {
                        if (mc.setBlock(x, y, z, d, 'minecraft:air', 0)) out.restored++;
                        else out.failed++;
                    } catch (e) { out.failed++; }
                }
                try { expect.del(d, x, y, z); out.expect++; } catch (e) { /* 忽略 */ }
                try { if (guard && typeof guard.forget === 'function') guard.forget(d, x, y, z); } catch (e) { /* 忽略 */ }
            }
            if (typeof expect.flush === 'function') {
                try { expect.flush(); } catch (e) { /* 落盘失败不影响内存态 */ }
            }
        }

        out.ok = out.remaining === 0;
        if (!out.ok) out.reason = 'not-loaded';
        this._log('info', `[ProjectionRenderer] 删除投影前清理 "${projection.name || pid}"：`
            + `会话 ${out.sessions} / 还原 ${out.restored} / 玩家方块保持 ${out.kept} / 失败 ${out.failed}`
            + ` / 未清 ${out.remaining} / 期望 ${out.expect} / MEGA状态 ${out.megaStopped}`
            + `${out.ok ? '' : ' → 未清干净，保留投影记录待重试'}`);
        return out;
    }

    // ==================== 会话保活 ====================

    /**
     * 记住该玩家正在显示的全部投影（写进 dataManager 的 playerData，会落盘）。
     *
     * **合并语义**：以存档里已有的 loadedProjections 为底，内存任务覆盖对应条目。
     * 原因：多投影"逐个恢复"的中途，任务表还不是全集 —— 直接覆盖会把
     * 尚未恢复的那几个投影的层记录抹成 -1（实测会导致重进后所有投影都变成"显示全部层"）。
     * 卸载某个投影时，调用方（clearProjection）会先把该 id 从存档里删掉，再调这里。
     */
    _remember(player, projection, layer) {
        try {
            const dm = this._dm();
            if (!dm || typeof dm.updatePlayerData !== 'function') return;
            const xuid = player.xuid;
            const prev = (typeof dm.getPlayerData === 'function') ? (dm.getPlayerData(xuid) || {}) : {};

            const ids = Array.isArray(prev.loadedProjections) ? prev.loadedProjections.filter(Boolean).slice() : [];
            const layers = Object.assign({}, prev.projectionLayers || {});
            const modes = Object.assign({}, prev.projectionLayerModes || {});

            const tasks = this._tasksOf(player);
            if (tasks) {
                for (const [pid, task] of tasks) {
                    if (!ids.includes(pid)) ids.push(pid);
                    layers[pid] = (typeof task.layer === 'number') ? task.layer : -1;
                    modes[pid] = !!task.layerMode;
                }
            }
            // 兼容旧调用：直接传 projection/layer（不经任务表）时把这个记成主控
            if (projection && projection.id && (!tasks || !tasks.has(projection.id))) {
                if (!ids.includes(projection.id)) ids.push(projection.id);
                layers[projection.id] = (typeof layer === 'number') ? layer : -1;
                modes[projection.id] = (typeof layer === 'number') ? layer >= 0 : false;
            }

            const primaryTask = this.activeProjections.get(xuid);
            let primaryId = primaryTask ? primaryTask.id
                : ((projection && projection.id) || prev.currentProjectionId || null);
            if (primaryId && !ids.includes(primaryId)) {
                primaryId = ids.length ? ids[ids.length - 1] : null;
            }
            if (!primaryId && ids.length) primaryId = ids[ids.length - 1];

            const primaryLayer = primaryTask && typeof primaryTask.layer === 'number'
                ? primaryTask.layer
                : ((typeof layer === 'number') ? layer
                    : (Number.isFinite(prev.currentRenderLayer) ? prev.currentRenderLayer : -1));

            dm.updatePlayerData(xuid, {
                // currentProjectionId 保留为"木剑控制的投影"（旧字段语义收窄，读方不必改）
                currentProjectionId: primaryId || null,
                loadedProjections: ids,
                projectionLayers: layers,
                projectionLayerModes: modes,
                currentRenderLayer: primaryLayer,
                renderLayerMode: primaryTask ? !!primaryTask.layerMode : !!prev.renderLayerMode,
                projectionDimid: (player.pos && typeof player.pos.dimid === 'number') ? player.pos.dimid : 0,
                projectionSavedAt: Date.now(),
            });
        } catch (e) { /* 持久化失败不影响渲染 */ }
    }

    /** 忘记该玩家的投影（取消/卸载时调） */
    _forget(player) {
        try {
            const dm = this._dm();
            if (!dm || typeof dm.updatePlayerData !== 'function') return;
            dm.updatePlayerData(player.xuid, {
                currentProjectionId: null,
                loadedProjections: [],
                projectionLayers: {},
                projectionLayerModes: {},
                currentRenderLayer: -1,
                renderLayerMode: false,
                projectionSavedAt: Date.now(),
            });
        } catch (e) { /* 忽略 */ }
    }

    /**
     * 玩家离线：只暂停，不撤世界（玩家重进后投影还在）。同一玩家的所有投影一起保活。
     * @returns {boolean}
     */
    suspendPlayer(player) {
        if (!player || !player.xuid) return false;
        const tasks = this._tasksOf(player);
        if (!tasks || !tasks.size) return false;
        const gr = this._gr();
        if (gr && typeof gr.suspend === 'function') gr.suspend(player);
        for (const task of tasks.values()) task.suspended = true;
        const names = [...tasks.values()].map(t => (t.projection && t.projection.name) || t.id).join('、');
        this._log('info', `[ProjectionRenderer] 会话保活：${player.name || player.xuid} → "${names}"（${tasks.size} 个投影）`);
        return true;
    }

    /**
     * 玩家回来：优先恢复内存里的保活会话（零重写）；没有就返回 false 交给上层按持久化记录重建。
     * 多投影：逐个恢复，任何一份会话已丢（例如被 prune 掉）就只摘掉那一份，其余照常。
     * @returns {boolean} 是否至少恢复了一份
     */
    restoreForPlayer(player) {
        if (!player || !player.xuid) return false;
        const tasks = this._tasksOf(player);
        if (!tasks || !tasks.size) return false;
        const gr = this._gr();
        if (!gr) return false;

        const lost = [];
        let restored = 0;
        for (const [pid, task] of [...tasks]) {
            const alive = typeof gr.hasProjection === 'function'
                ? gr.hasProjection(player, pid)
                : gr.has(player.xuid);
            if (!alive) { lost.push(pid); continue; }
            if (typeof gr.resume === 'function') gr.resume(player);
            task.suspended = false;
            // MEGA：玩家退出时 index.js 会 stopRender 掉注入状态，而这里是"零重写"恢复路径，
            // 不重建状态的话残余分块永远不会再注入、切层也会报 mega-not-ready。
            // 重建的 cursor 从 0 开始，靠 GhostRenderer 的 seen 去重，已写的格不会重写。
            if (task.projection && isMegaProjection(task.projection)) this._ensureMegaState(player, task.projection);
            restored++;
            this._log('info', `[ProjectionRenderer] 会话恢复：${player.name || player.xuid} → "${task.projection && task.projection.name}"`);
        }

        for (const pid of lost) this._dropTask(player, pid);
        if (!restored) return false;

        // 进服瞬间区块刚加载，立刻补一轮待写的格
        try { gr.retryPending(); } catch (e) { /* 交给定时重试 */ }
        this._remember(player);
        return true;
    }

    /**
     * 只清会话与显示（会调用 GhostRenderer.clear 还原世界）。
     * 契约要求：**不得**触发"撤销投影数据"以外的东西（不删投影、不回滚未完成的事务）。
     *
     * @param {object} player
     * @param {string} [projectionId] 只清这一个；省略 = 清该玩家全部会话（旧语义）
     */
    clearPlayerProjection(player, projectionId) {
        if (!player || !player.xuid) return;
        // world 侧撤销可能因为区块未加载 / 玩家已离线而抛错。
        // **Map 清理必须在 finally 里**：否则 activeProjections 留着一个不存在的会话，
        // UI 会一直显示"[已加载]"，玩家只能先点卸载再点加载。
        try {
            const gr = this._gr();
            if (gr && typeof gr.clear === 'function') {
                gr.clear(player, projectionId
                    ? { silent: false, projectionId }
                    : { silent: false });
            }
        } catch (e) {
            this._log('warn', `[ProjectionRenderer] 撤销会话失败（会话仍会被清掉）: ${e && e.message ? e.message : e}`);
        } finally {
            if (projectionId) {
                this._dropTask(player, projectionId);
                if (this._tasksOf(player)) this._remember(player);
                else this._forget(player);
            } else {
                this.playerProjections.delete(player.xuid);
                this.activeProjections.delete(player.xuid);
                this.currentRenderLayer.delete(player.xuid);
                this.layerRenderMode.delete(player.xuid);
                this.loadedProjections.delete(player.xuid);
                this.lastLayerSwitch.delete(player.xuid);
                // 会话已不存在：玩家重进时不应再次恢复该投影
                this._forget(player);
            }
        }

        // 会话不在（服务器重启过 / MEGA 注入状态已丢）时世界里的残格没人撤 ——
        // 落到"无主 ghost"清理，保证玩家点一次清除就真的干净。
        // 会话刚被 clear 掉时快照已 close 删除，这里是空操作。
        try {
            const g = this._gr();
            if (!g || typeof g.has !== 'function' || (!projectionId && !g.has(player.xuid))) {
                this.reclaimOrphans(player);
            }
        } catch (e) {
            this._log('warn', `[ProjectionRenderer] 清除后清理残留失败: ${e && e.message ? e.message : e}`);
        }
    }

    /**
     * 与 GhostRenderer._newSessionId 的 xuid 归一化保持一致：
     * 崩溃/重启后内存里 xuid→session 的映射丢了，只能靠 sessionId 前缀把撤销能力找回来。
     */
    _sessionPrefix(xuid) {
        const safe = String(xuid || 'unknown').replace(/[^0-9a-zA-Z]/g, '').slice(0, 12) || 'unknown';
        return `proj-${safe}-`;
    }

    /**
     * 强力清理「无主 ghost」：**不依赖内存会话**。
     *
     * 场景：服务器强退/重启后，世界里还留着 ghost、期望账本里还认着它们，
     * 但内存里的会话（以及 MEGA 的注入状态）全没了 —— 玩家进服看不到"已加载"，
     * 想清也没有会话可撤销，于是 ghost 永久留在世界。MEGA 投影尤其必然踩到，
     * 因为它的注入状态（MegaProjectionRenderer.renderStates）是纯内存的。
     *
     * 顺序不能反：**先删期望，再还原世界**。否则 GhostGuard 的 restoreAll /
     * 事件守护会把刚还原掉的格又按期望补回来。
     *
     * @param {object} [player] 传了就同时清掉该玩家的持久化投影记录
     * @param {{resetState?: boolean}} [opts] resetState=false 时只清世界与期望，不动会话任务表
     *        （"开投影前清孤儿"用这个：多投影并存时不能顺手把别人的任务也删了）
     * @returns {{expect:number, sessions:number, restored:number, failed:number, remaining:number, skippedSessions:number}}
     */
    reclaimOrphans(player, opts) {
        const o = opts || {};
        const out = { expect: 0, sessions: 0, restored: 0, failed: 0, remaining: 0, skippedSessions: 0 };
        const g = (typeof global !== 'undefined') ? global : {};
        const snap = g.worldSnapshot;
        const expect = g.ghostExpect;
        const guard = g.ghostGuard;
        const gr = this._gr();

        // 内存里还活着的会话不能碰：别人的投影可能正在用
        const liveSessions = new Set();
        if (gr && gr.sessions) {
            for (const s of gr.sessions.values()) if (s && s.sessionId) liveSessions.add(s.sessionId);
        }
        // 传了 player 就只清"这个玩家自己的"无主会话（sessionId 前缀里带 xuid），
        // 不传（服务端启动清理）就是全清
        const mine = player && player.xuid ? this._sessionPrefix(player.xuid) : null;
        const isOrphan = (s) => !liveSessions.has(s.sessionId) && (!mine || String(s.sessionId || '').startsWith(mine));

        if (snap && expect && typeof snap.forEachSessionBlock === 'function') {
            out.expect = snap.forEachSessionBlock(isOrphan, (dimid, x, y, z) => {
                expect.del(dimid, x, y, z);
                if (guard && typeof guard.forget === 'function') guard.forget(dimid, x, y, z);
            });
            if (out.expect && typeof expect.flush === 'function') expect.flush();
        }

        if (snap && typeof snap.restoreOrphaned === 'function') {
            // skip 传"不该动"的判定：活跃会话、以及（指定玩家时）别人的会话
            const r = snap.restoreOrphaned({
                restoreMega: true,
                skip: (s) => !isOrphan(s),
            });
            out.sessions = r.sessions;
            out.restored = r.restored;
            out.failed = r.failed;
            out.remaining = r.remaining;
            out.skippedSessions = r.skippedSessions || 0;
        }

        if (player && o.resetState !== false) {
            this.playerProjections.delete(player.xuid);
            this.activeProjections.delete(player.xuid);
            this.currentRenderLayer.delete(player.xuid);
            this.layerRenderMode.delete(player.xuid);
            this.loadedProjections.delete(player.xuid);
            this._forget(player);
        }
        this._log('info', `[ProjectionRenderer] 清理无主 ghost：期望 ${out.expect} 格 / 会话 ${out.sessions} 个 / 还原 ${out.restored} 格 / 失败 ${out.failed} / 残留 ${out.remaining}`);
        return out;
    }

    /**
     * 边界提示 —— 文字实现。
     *  player.spawnParticle('minecraft:basic_particle') 粒子名在基岩版不存在
     */
    showBounds(projection, player) {
        try {
            if (!projection || !player || !player.tell) return;
            const dims = projection.dimensions;
            const pos = projection.position;
            if (!dims || !pos) return;

            const w = dims.x, h = dims.y, d = dims.z;
            const corners = [
                [0, 0], [w - 1, 0], [w - 1, d - 1], [0, d - 1],
            ].map(([x, z]) => transformPosition([x, 0, z], projection));

            const y0 = pos.y;
            const y1 = pos.y + h - 1;

            player.tell('§6=== 投影边界 ===');
            player.tell(`§7名称: §f${projection.name || projection.id || '?'}`);
            player.tell(`§7尺寸: §f${w} × ${h} × ${d}§7（宽 × 高 × 深）`);
            player.tell(`§7高度: §fy ${y0} → ${y1}`);
            player.tell('§7占地四角（x, z）:');
            for (const c of corners) {
                player.tell(`§7  (§f${c.x}§7, §f${c.z}§7)`);
            }
        } catch (e) {
            // 边界提示失败不能影响投影本身
        }
    }

    /**
     * Mega / 会话可见集更新（契约成员）
     * @param {string} playerXuid
     * @param {Array} newBlocks
     */
    updateBlocks(playerXuid, newBlocks) {
        const gr = this._gr();
        const n = gr ? gr.updateBlocks(playerXuid, newBlocks) : 0;
        const task = this.activeProjections.get(playerXuid);
        if (task) {
            task.blocksUpdated = Date.now();
            task.count = n || task.count;
        }
        return n;
    }

    /**
     * MEGA 分块增量注入（非契约成员，仅供 MegaProjectionRenderer 用）
     * 与 updateBlocks 的区别：只往队列尾部追加，不清已写格、不重置游标。
     * @param {string} playerXuid
     * @param {Array} blocks 相对投影原点的方块，见 GhostRenderer.appendBlocks
     * @param {string} [projectionId] 多投影时必须给，否则追加进主控会话
     * @returns {{added:number, dup:number, total:number}}
     */
    appendBlocks(playerXuid, blocks, projectionId) {
        const gr = this._gr();
        const r = gr
            ? gr.appendBlocks(playerXuid, blocks, projectionId)
            : { added: 0, dup: 0, total: 0 };
        const task = projectionId
            ? this._taskOf({ xuid: playerXuid }, projectionId)
            : this.activeProjections.get(playerXuid);
        if (task) {
            task.blocksUpdated = Date.now();
            task.injected = r.total;
        }
        return r;
    }

    /** 调度器每 tick 调一次：消费 GhostRenderer 队列（多会话按会话均分预算） */
    tick(budget) {
        const gr = this._gr();
        if (!gr) return { written: 0, skipped: 0, protected: 0, pending: 0, doneSessions: 0 };
        const out = gr.tick(budget);
        // 会话结束后任务仍需保留（投影还在世界里显示），只更新状态；
        // 会话真的没了（被 prune / 手动撤销）才摘掉那份任务。
        for (const [xuid, tasks] of this.playerProjections) {
            for (const [pid, task] of [...tasks]) {
                const s = (typeof gr.getSessionOf === 'function')
                    ? gr.getSessionOf(xuid, pid)
                    : gr.getSession(xuid);
                if (!s) {
                    this._dropTask({ xuid }, pid);
                    continue;
                }
                task.state = s.state;
            }
        }
        return out;
    }

    /** 区块加载后补写（调度器周期调） */
    retryPending() {
        const gr = this._gr();
        return gr ? gr.retryPending() : { retried: 0, placed: 0, remaining: 0 };
    }

    /** 玩家进服：他附近的区块一定已加载，立刻补一轮 */
    retryForPlayer(player) {
        const gr = this._gr();
        if (!gr || !player) return null;
        return gr.retryPending(gr.retryBatch);
    }

    // ==================== 查询 / 工具（保留原语义） ====================

    getPlayerProjection(player) {
        const task = this.activeProjections.get(player && player.xuid);
        return task ? task.projection : null;
    }

    isProjectionLoaded(player, projectionId) {
        if (!player || !projectionId) return false;
        // 多投影：查任务表（一份投影一条任务），不是查"主控是谁"
        if (this._taskOf(player, projectionId)) return true;
        // 兼容外部直接写 loadedProjections 的老路径（单投影时代）
        return this.loadedProjections.get(player.xuid) === projectionId;
    }

    loadProjection(player, projectionId) {
        const dataManager = global.dataManager;
        if (!dataManager) {
            player.tell('§c数据管理器未初始化');
            return false;
        }
        const projection = dataManager.getProjection(projectionId);
        if (!projection) {
            player.tell('§c投影不存在');
            return false;
        }
        if (this.isProjectionLoaded(player, projectionId)) {
            // 已经加载过：只把木剑控制切过去，不重铺一遍
            this.setPrimaryProjection(player, projectionId, { notify: true });
            return true;
        }
        const ok = this.startRender(player, projection, -1);
        if (ok) {
            const n = this.getPlayerProjections(player).length;
            player.tell(`§a已加载投影: ${projection.name}§7（当前共 ${n} 个，木剑控制这一个）`);
        }
        return ok;
    }

    rotateProjection(projection, degrees) {
        const newRotation = (projection.rotation + degrees) % 360;
        return { ...projection, rotation: newRotation };
    }

    getPlayerLookingLayer(player, projection) {
        const pitch = (player.direction && typeof player.direction.pitch === 'number') ? player.direction.pitch : 0;
        if (pitch < -30) return Math.min(projection.buildLayer + 1, projection.dimensions.y - 1);
        if (pitch > 30) return Math.max(projection.buildLayer - 1, 0);
        return projection.buildLayer;
    }

    hexToRGB(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16) / 255,
            g: parseInt(result[2], 16) / 255,
            b: parseInt(result[3], 16) / 255
        } : { r: 0, g: 1, b: 0 };
    }
}

/** 哪些失败原因值得直接告诉玩家（注册表/版本这类静默记日志即可，玩家看 ghost info） */
function reasonIsUserFacing(reason) {
    return reason === 'too-many' || reason === 'empty-surface' || reason === 'empty' || reason === 'writegate';
}

module.exports = { ProjectionRenderer };
