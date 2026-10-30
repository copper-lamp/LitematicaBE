// ProjectionRenderer — 投影会话层
//   1. **会话状态**：谁在看哪个投影、第几层、逐层显示开关（UIManager 直接读写这些 Map）
//   2. **调度入口**：startRender / cancelRender / updateBlocks 转给 GhostRenderer
//   3. **边界提示**：showBounds 改为聊天栏文字

const { transformPosition } = require('../ghost/GhostRenderer');

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
     * ghost 语义（P4 决策："按层写，切层先撤旧层再铺新层"）：
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

        const r = gr.setLayer(player, projection, currentLayer);
        this.currentRenderLayer.set(player.xuid, currentLayer);
        if (task) task.layer = currentLayer;
        // 层变了也要落盘，否则重进会回到旧层
        this._remember(player, projection, currentLayer);

        if (!r.ok) {
            player.tell(`§c切换失败：${this._reasonText(r.reason)}`);
            return;
        }
        player.tell(`§7已切换到第 ${currentLayer} 层 (共 ${maxLayer + 1} 层)，${r.count} 格`);
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
            default: return reason || '未知原因';
        }
    }

    // ==================== 契约方法 ====================

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

        // 超大投影（MEGA/LOD）暂不启用，等普通投影跑通再优化。
        // 此时 projection.blocks 通常为空（方数据在 .mcmega 分块里，靠 megaRenderer 注入）。
        if (projection.isMega && (!projection.blocks || projection.blocks.length === 0)) {
            player.tell('§e超大投影（MEGA）暂未启用，等普通投影跑通后再优化');
            this._log('info', `[ProjectionRenderer] 跳过 MEGA 投影 "${projection.name || projection.id}"（render.enableMega=false）`);
            return false;
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

    // ==================== P5.3 会话保活 ====================

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
            // 会话都没了，就别让玩家重进时又把它拉回来
            this._forget(player);
        }
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
