// ProjectionRenderer — 投影会话层
//   1. **会话状态**：谁在看哪个投影、第几层、逐层显示开关（UIManager 直接读写这些 Map）
//   2. **调度入口**：startRender / cancelRender / updateBlocks 转给 GhostRenderer
//   3. **边界提示**：showBounds 改为聊天栏文字

const { transformPosition } = require('../ghost/GhostRenderer');
const { isMegaProjection, normalizeProjection } = require('../data/projectionFlags');

class ProjectionRenderer {
    /**
     * @param {{ghostRenderer?: object, logger?: object}} [opts]
     */
    constructor(opts) {
        const o = opts || {};

        // ── 契约成员（硬契约，UIManager / index.js 直接用） ──
        /** @type {Map<string, object>} xuid -> { projection, layer, ... } */
        this.activeProjections = new Map();
        /** @type {Map<string, boolean>} 逐层显示开关 */
        this.layerRenderMode = new Map();
        /** @type {Map<string, number>} 当前层号，-1 = 全部层 */
        this.currentRenderLayer = new Map();

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
        if (task) task.layer = currentLayer;

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
    applyLayer(player, projection, layer) {
        const lay = (typeof layer === 'number' && Number.isFinite(layer)) ? layer : -1;
        if (!player || !player.xuid || !projection) return { ok: false, reason: 'no-player' };

        const isMega = isMegaProjection(projection) && !(projection.blocks && projection.blocks.length);
        if (isMega) return this.setMegaLayer(player, projection, lay);

        const gr = this._gr();
        if (!gr) return { ok: false, reason: 'no-ghost-renderer' };
        const r = gr.setLayer(player, projection, lay);
        this.currentRenderLayer.set(player.xuid, lay);
        this.layerRenderMode.set(player.xuid, lay >= 0);
        const task = this.activeProjections.get(player.xuid);
        if (task) { task.layer = lay; task.injected = 0; }
        this._remember(player, projection, lay);
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
        const key = projection.schematicId ? `${player.xuid}_${projection.schematicId}` : null;

        if (!mega || typeof mega.setLayerMode !== 'function' || !key
            || !mega.renderStates || !mega.renderStates.has(key)) {
            return { ok: false, reason: 'mega-not-ready', layer: lay, chunks: 0 };
        }

        const plan = mega.setLayerMode(key, lay);
        if (!plan || !plan.ok) {
            return { ok: false, reason: (plan && plan.reason) || 'mega-layer', layer: lay, chunks: 0 };
        }

        // 层变了 → enqueue 内部会 clear 旧会话，再按 deferBlocks 建一个新的空会话
        const r = gr.enqueue(player, projection, { layer: lay, deferBlocks: true });
        if (!r.ok) {
            return { ok: false, reason: r.reason, layer: lay, chunks: plan.chunks };
        }

        this.currentRenderLayer.set(player.xuid, lay);
        this.layerRenderMode.set(player.xuid, lay >= 0);
        this.loadedProjections.set(player.xuid, projection.id || null);

        const task = this.activeProjections.get(player.xuid);
        if (task) {
            task.projection = projection;
            task.layer = lay;
            task.count = projection.totalBlocks || task.count || 0;
            task.injected = 0;
            task.suspended = false;
            task.isMega = true;
        } else {
            this.activeProjections.set(player.xuid, {
                projection,
                layer: lay,
                count: projection.totalBlocks || 0,
                startedAt: Date.now(),
                stats: r.stats,
                suspended: false,
                isMega: true,
                injected: 0,
            });
        }

        this._remember(player, projection, lay);
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
        const key = projection.schematicId ? `${player.xuid}_${projection.schematicId}` : null;
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
     * 开投影之前先把"上次会话的孤儿快照"清掉。
     *
     * 为什么必须做：强退/重启后世界里留着 ghost、快照还认着它们、内存会话已经没了。
     * 此时直接 enqueue 新会话，`record()` 读到的"原方块"就是 ghost —— 撤销时会把 ghost
     * 写回去，残留不但消不掉，还会被当成"原状"固化下来。所以先还原再开新会话。
     *
     * @returns {number} 清掉的孤儿会话数
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
        const r = this.reclaimOrphans(player);
        this._log('info', `[ProjectionRenderer] 开投影前清掉上次的孤儿快照 ${orphans.length} 个（还原 ${r.restored} 格 / 残留 ${r.remaining}）`);
        return orphans.length;
    }

    /**
     * 开始显示一个投影（异步铺设，tick 里按预算推进）
     * @param {object} player
     * @param {object} projection
     * @param {number} [layer] -1 = 全部层
     */
    startRender(player, projection, layer) {
        const lay = (typeof layer === 'number') ? layer : -1;
        const gr = this._gr();
        if (!gr) {
            this._log('warn', '[ProjectionRenderer] GhostRenderer 未装配，startRender 无效');
            return false;
        }
        if (!player || !projection) return false;

        // 脏数据兜底：isMega 可能是旧格式的字符串，先就地修成布尔再往下走
        normalizeProjection(projection);

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
            const stateKey = projection.schematicId ? `${player.xuid}_${projection.schematicId}` : null;
            const ready = !!(mega && stateKey && mega.renderStates && mega.renderStates.has(stateKey));
            if (!ready) {
                // 分块数据缺失 / 开关被关掉 → 这个投影这次起不来了。
                // 但**不要删持久化记录**：那等于把玩家的投影弄丢，而且下次开服也不会再试。
                // 只清渲染态，等玩家修好配置或数据后再手动重开。
                this.activeProjections.delete(player.xuid);
                this.currentRenderLayer.delete(player.xuid);
                player.tell('§e超大投影渲染未就绪（render.enableMega 未开，或分块数据已缺失）');
                player.tell('§7投影记录已保留：打开 render.enableMega 后重进，或重新放置该投影');
                if (stateKey === null) {
                    player.tell('§c该投影缺少 schematicId，无法定位分块数据；请重新加载一次 .litematic');
                }
                this._log('warn', `[ProjectionRenderer] MEGA 投影 "${projection.name || projection.id}" 缺少注入状态（stateKey=${stateKey || 'null'}），已跳过，保留恢复记录`);
                return false;
            }
            const r = gr.enqueue(player, projection, { layer: lay, deferBlocks: true });
            if (!r.ok) {
                const text = this._reasonText(r.reason);
                this._log('warn', `[ProjectionRenderer] MEGA 投影 "${projection.name || projection.id}" 会话建立失败：${text}`);
                if (reasonIsUserFacing(r.reason)) player.tell(`§c超大投影无法显示：${text}`);
                return false;
            }
            // count 用投影真实方块数，否则 UI 会显示"0 方块"
            const task = {
                projection,
                layer: lay,
                count: projection.totalBlocks || 0,
                startedAt: Date.now(),
                stats: r.stats,
                suspended: false,
                isMega: true,
                injected: 0,
            };
            this.activeProjections.set(player.xuid, task);
            this.loadedProjections.set(player.xuid, projection.id || null);
            this.currentRenderLayer.set(player.xuid, lay);
            this._remember(player, projection, lay);
            player.tell('§e超大投影：正在按分块注入方块，进度见控制台');
            this._log('info', `[ProjectionRenderer] MEGA 会话已建立 "${projection.name || projection.id}"，等待分块注入（总数 ${projection.totalBlocks || '?'}）`);
            return true;
        }

        // 旧会话清空（会话层自身的 Map，不动世界）
        this.activeProjections.delete(player.xuid);

        const r = gr.enqueue(player, projection, { layer: lay });
        if (!r.ok) {
            const text = this._reasonText(r.reason);
            this._log('warn', `[ProjectionRenderer] 投影 "${projection.name || projection.id}" 未能铺设：${text}`);
            if (reasonIsUserFacing(r.reason)) player.tell(`§c投影无法显示：${text}`);
            return false;
        }

        const task = {
            projection,
            layer: lay,
            count: r.count,
            startedAt: Date.now(),
            stats: r.stats,
            suspended: false,
        };
        this.activeProjections.set(player.xuid, task);
        this.loadedProjections.set(player.xuid, projection.id || null);
        this.currentRenderLayer.set(player.xuid, lay);
        // 记住"这个玩家现在显示哪个投影"，玩家退出重进 / 服务器重启后靠它恢复
        this._remember(player, projection, lay);
        return true;
    }

    /**
     * 取消显示并撤销世界里的 ghost
     * @returns {boolean} 有没有会话被撤销
     */
    cancelRender(player) {
        const task = this.activeProjections.get(player.xuid);
        if (!task) {
            player.tell('§c当前没有正在渲染的投影');
            return false;
        }
        this.clearPlayerProjection(player);
        this._forget(player);      // 用户主动取消：重进不该再把它拉回来
        player.tell('§a投影显示已取消，世界已还原');
        return true;
    }

    // ==================== 会话保活 ====================

    /** 记住该玩家正在显示的投影（写进 dataManager 的 playerData，会落盘） */
    _remember(player, projection, layer) {
        try {
            const dm = this._dm();
            if (!dm || typeof dm.updatePlayerData !== 'function') return;
            dm.updatePlayerData(player.xuid, {
                currentProjectionId: (projection && projection.id) || null,
                currentRenderLayer: (typeof layer === 'number') ? layer : -1,
                renderLayerMode: !!this.layerRenderMode.get(player.xuid),
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
                projectionSavedAt: Date.now(),
            });
        } catch (e) { /* 忽略 */ }
    }

    /**
     * 玩家离线：只暂停，不撤世界（玩家重进后投影还在）。
     * @returns {boolean}
     */
    suspendPlayer(player) {
        if (!player || !player.xuid) return false;
        const task = this.activeProjections.get(player.xuid);
        if (!task) return false;
        const gr = this._gr();
        if (gr && typeof gr.suspend === 'function') gr.suspend(player);
        task.suspended = true;
        this._log('info', `[ProjectionRenderer] 会话保活：${player.name || player.xuid} → "${task.projection && task.projection.name}"`);
        return true;
    }

    /**
     * 玩家回来：优先恢复内存里的保活会话（零重写）；没有就返回 false 交给上层按持久化记录重建。
     * @returns {boolean}
     */
    restoreForPlayer(player) {
        if (!player || !player.xuid) return false;
        const task = this.activeProjections.get(player.xuid);
        if (!task) return false;
        const gr = this._gr();
        if (!gr || !gr.has(player.xuid)) {
            // 世界侧会话已不在（例如被 prune 掉），交给持久化重建
            this.activeProjections.delete(player.xuid);
            return false;
        }
        if (typeof gr.resume === 'function') gr.resume(player);
        task.suspended = false;
        // MEGA：玩家退出时 index.js 会 stopRender 掉注入状态，而这里是"零重写"恢复路径，
        // 不重建状态的话残余分块永远不会再注入、切层也会报 mega-not-ready。
        // 重建的 cursor 从 0 开始，靠 GhostRenderer 的 seen 去重，已写的格不会重写。
        if (task.projection && isMegaProjection(task.projection)) this._ensureMegaState(player, task.projection);
        // 进服瞬间区块刚加载，立刻补一轮待写的格
        try { gr.retryPending(); } catch (e) { /* 交给定时重试 */ }
        this._log('info', `[ProjectionRenderer] 会话恢复：${player.name || player.xuid} → "${task.projection && task.projection.name}"`);
        return true;
    }

    /**
     * 只清会话与显示（会调用 GhostRenderer.clear 还原世界）。
     * 契约要求：**不得**触发"撤销投影数据"以外的东西（不删投影、不回滚未完成的事务）。
     */
    clearPlayerProjection(player) {
        if (!player || !player.xuid) return;
        // world 侧撤销可能因为区块未加载 / 玩家已离线而抛错。
        // **Map 清理必须在 finally 里**：否则 activeProjections 留着一个不存在的会话，
        // UI 会一直显示"[已加载]"，玩家只能先点卸载再点加载。
        try {
            const gr = this._gr();
            if (gr && gr.has(player.xuid)) gr.clear(player, { silent: false });
        } catch (e) {
            this._log('warn', `[ProjectionRenderer] 撤销会话失败（会话仍会被清掉）: ${e && e.message ? e.message : e}`);
        } finally {
            this.activeProjections.delete(player.xuid);
            this.currentRenderLayer.delete(player.xuid);
            this.loadedProjections.delete(player.xuid);
            this.lastLayerSwitch.delete(player.xuid);
            // 会话已不存在：玩家重进时不应再次恢复该投影
            this._forget(player);
        }

        // 会话不在（服务器重启过 / MEGA 注入状态已丢）时世界里的残格没人撤 ——
        // 落到"无主 ghost"清理，保证玩家点一次清除就真的干净。
        // 会话刚被 clear 掉时快照已 close 删除，这里是空操作。
        try {
            const g = this._gr();
            if (!g || !g.has(player.xuid)) this.reclaimOrphans(player);
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
     * @returns {{expect:number, sessions:number, restored:number, failed:number, remaining:number, skippedSessions:number}}
     */
    reclaimOrphans(player) {
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
        // 传了 player 就只清"这个玩家自己的"孤儿会话（sessionId 前缀里带 xuid），
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

        if (player) {
            this.activeProjections.delete(player.xuid);
            this.currentRenderLayer.delete(player.xuid);
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
     * @returns {{added:number, dup:number, total:number}}
     */
    appendBlocks(playerXuid, blocks) {
        const gr = this._gr();
        const r = gr ? gr.appendBlocks(playerXuid, blocks) : { added: 0, dup: 0, total: 0 };
        const task = this.activeProjections.get(playerXuid);
        if (task) {
            task.blocksUpdated = Date.now();
            task.injected = r.total;
        }
        return r;
    }

    /** 调度器每 tick 调一次：消费 GhostRenderer 队列 */
    tick(budget) {
        const gr = this._gr();
        if (!gr) return { written: 0, skipped: 0, protected: 0, pending: 0, doneSessions: 0 };
        const out = gr.tick(budget);
        // 会话结束后 activeProjections 仍需保留（投影还在世界里显示），只更新状态
        for (const [xuid, task] of this.activeProjections) {
            const s = gr.getSession(xuid);
            if (!s) {
                this.activeProjections.delete(xuid);
                continue;
            }
            task.state = s.state;
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
        const loadedId = this.loadedProjections.get(player.xuid);
        return loadedId === projectionId;
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
        const ok = this.startRender(player, projection, -1);
        if (ok) player.tell(`§a已加载投影: ${projection.name}`);
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
