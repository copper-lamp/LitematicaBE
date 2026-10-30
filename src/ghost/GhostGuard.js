/** GhostGuard — ghost 当作空气的统一判据 + ghost 期望的自动补齐（横切层） */

const AIR_LIKE = new Set(['air', 'cave_air', 'void_air', 'structure_void']);

/** 重试参数：20s 一轮、最多 30 轮（约 10 分钟），每 3 轮尝试一次 tickingarea 强制加载 */
const RETRY_INTERVAL_MS = 20000;
const RETRY_MAX_ROUNDS = 30;
const TICKINGAREA_BATCH_LIMIT = 8;

class GhostGuard {
    constructor(registry) {
        this.registry = registry;
        this.installed = false;
        this.expect = null;
        this.logger = null;
        this.stats = { destroyHits: 0, restored: 0, placeHits: 0, skipped: 0, failed: 0, pendingPeak: 0 };
        /** @type {Map<string, {dimid:number,x:number,y:number,z:number,ghostId:string,attempts:number}>} */
        this.pending = new Map();
        this._retryTimer = null;
        this._retryRound = 0;
        /**
         * 写入总闸：addon 版本对不上时由的 AddonVersionCheck 关掉。
         * 关闭后只是不往世界写 ghost，判定层（isAirLike）与事件记账照常工作。
         */
        this.writesEnabled = true;
        this.disabledReason = null;
    }

    /** 开/关 ghost 写入（版本校验的处置出口） */
    setWritesEnabled(enabled, reason) {
        this.writesEnabled = !!enabled;
        this.disabledReason = enabled ? null : (reason || 'addon 版本校验未通过');
        if (!this.writesEnabled) {
            // 关闸后排队中的格不再重试，避免持续刷失败的 setBlock
            if (this._retryTimer) {
                clearTimeout(this._retryTimer);
                this._retryTimer = null;
            }
            if (this.logger) this.logger.warn(`[GhostGuard] 写入已关闭：${this.disabledReason}`);
        }
        return this.writesEnabled;
    }

    /** 从 'minecraft:oak_planks' / 'oak_planks' 取短名 */
    static shortName(blockType) {
        if (!blockType || typeof blockType !== 'string') return '';
        const i = blockType.indexOf(':');
        return i >= 0 ? blockType.slice(i + 1) : blockType;
    }

    /**
     * 该方块在"投影语义"下是否可视为空气
     * @param {object|string|null} block Block 对象 / 方块类型字符串 / null
     */
    isAirLike(block) {
        if (!block) return true;
        if (typeof block === 'object' && block.isAir === true) return true;
        const type = typeof block === 'string' ? block : (block.type || block.name || '');
        if (!type) return true;
        if (AIR_LIKE.has(GhostGuard.shortName(type))) return true;
        if (this.registry && this.registry.isGhost(type)) return true;
        return false;
    }

    /** 反向查询：这个位置的方块是不是 ghost */
    isGhostBlock(block) {
        if (!block) return false;
        const type = typeof block === 'string' ? block : (block.type || block.name || '');
        return this.registry ? this.registry.isGhost(type) : false;
    }

    /** Block 对象 → {x,y,z,dimid}；取不到返回 null */
    static posOf(block) {
        const p = block && block.pos;
        if (!p) return null;
        const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
        const dimid = (typeof p.dimid === 'number') ? p.dimid : (typeof block.dimid === 'number' ? block.dimid : 0);
        return { x, y, z, dimid };
    }

    _getBlock(p) {
        try {
            return mc.getBlock(p.x, p.y, p.z, p.dimid);
        } catch (e) {
            return null;   // 区块未加载等
        }
    }

    static _pkey(p) {
        return `${p.dimid}:${p.x},${p.y},${p.z}`;
    }

    /**
     * 只做一次写入尝试，不碰 pending
     * @returns {'placed'|'skipped'|'failed'}
     */
    _placeRaw(p, ghostId) {
        if (!ghostId) return 'skipped';
        const cur = this._getBlock(p);
        if (cur) {
            // 已经是 ghost：不重写（restoreAll 每轮扫全部期望格，省掉无效 setBlock）
            if (this.isGhostBlock(cur)) return 'skipped';
            // 真方块：绝不硬盖玩家建筑
            if (!this.isAirLike(cur)) return 'skipped';
        }
        let ok = false;
        try {
            ok = !!mc.setBlock(p.x, p.y, p.z, p.dimid, ghostId, 0);
        } catch (e) {
            ok = false;
        }
        return ok ? 'placed' : 'failed';
    }

    _enqueuePending(p, ghostId) {
        const k = GhostGuard._pkey(p);
        const old = this.pending.get(k);
        this.pending.set(k, {
            dimid: p.dimid, x: p.x, y: p.y, z: p.z, ghostId,
            attempts: (old ? old.attempts : 0) + 1,
        });
        if (this.pending.size > this.stats.pendingPeak) this.stats.pendingPeak = this.pending.size;
    }

    /**
     * 把某格补成 ghost（事件路径）。失败就进 pending 等重试
     * @returns {'placed'|'skipped'|'pending'}
     */
    placeGhost(p, ghostId, reason) {
        if (!this.writesEnabled) return 'skipped';
        const r = this._placeRaw(p, ghostId);
        if (r === 'placed') {
            this.stats.restored++;
            this.pending.delete(GhostGuard._pkey(p));
            return 'placed';
        }
        if (r === 'skipped') {
            this.stats.skipped++;
            this.pending.delete(GhostGuard._pkey(p));
            return 'skipped';
        }
        this.stats.failed++;
        this._enqueuePending(p, ghostId);
        if (this.logger && reason !== 'restoreAll') {
            // 单格失败（多为区块未加载）不刷屏，进队列等重试
            this.logger.debug(`[GhostGuard] 补写延后 (${p.x},${p.y},${p.z},dim ${p.dimid}, ${ghostId}, ${reason})`);
        }
        this._scheduleRetry();
        return 'pending';
    }

    /**
     * 装配事件层
     * @param {{expectStore: object, logger?: object}} opts
     */
    install(opts) {
        const o = opts || {};
        this.expect = o.expectStore || null;
        this.logger = o.logger || null;

        if (!this.expect) {
            if (this.logger) this.logger.warn('[GhostGuard] 未提供 expectStore，事件层不装配');
            return false;
        }

        // onDestroyBlock 在 LSE 里的语义是"破坏完成"（方块已被打掉），正好用来补回 ghost
        mc.listen('onDestroyBlock', (player, block) => this._onDestroy(block));
        // afterPlaceBlock 只做记账：玩家把方块盖到 ghost 位置上，这一格就算"已放置"
        mc.listen('afterPlaceBlock', (player, block) => this._onPlace(block));
        // 玩家进服时他附近的区块一定已加载：立刻清一轮 pending
        mc.listen('onJoin', () => {
            if (this.pending.size) {
                setTimeout(() => this.retryPending('onJoin'), 500);
            }
        });

        this.installed = true;
        return true;
    }

    _onDestroy(block) {
        if (!this.expect) return;
        const p = GhostGuard.posOf(block);
        if (!p) return;
        const entry = this.expect.get(p.dimid, p.x, p.y, p.z);
        if (!entry) return;               // 不是投影期望格，完全不参与
        this.stats.destroyHits++;
        // 破坏事件内同 tick 写回可能被引擎的"设为空气"覆盖，延后一 tick 再补
        setTimeout(() => {
            this.placeGhost(p, entry.ghostId, 'break');
        }, 1);
    }

    _onPlace(block) {
        if (!this.expect) return;
        const p = GhostGuard.posOf(block);
        if (!p) return;
        const entry = this.expect.get(p.dimid, p.x, p.y, p.z);
        if (!entry) return;
        this.stats.placeHits++;
        this.pending.delete(GhostGuard._pkey(p));   // 玩家自己盖上了，这一格不再需要补
        if (this.logger) {
            const t = (block && (block.type || block.name)) || '?';
            this.logger.debug(`[GhostGuard] 期望格被真方块覆盖 (${p.x},${p.y},${p.z}) ← ${t}`);
        }
    }

    /**
     * 遍历期望集合，把"世界是空气"的格补回 ghost（启动恢复 / 手动修复）
     * 区块没加载的格会进 pending，由重试链继续兜
     * @returns {{placed:number, skipped:number, failed:number, total:number, pending:number}}
     */
    restoreAll(reason) {
        const out = { placed: 0, skipped: 0, failed: 0, total: 0, pending: 0 };
        if (!this.expect) return out;
        if (!this.writesEnabled) {
            out.total = this.expect.count();
            if (this.logger) {
                this.logger.warn(`[GhostGuard] 跳过补齐(${reason || 'manual'})：ghost 写入已关闭（${this.disabledReason}）`);
            }
            return out;
        }
        const samples = [];
        this.expect.forEach((dimid, x, y, z, ghostId) => {
            out.total++;
            const p = { x, y, z, dimid };
            const r = this._placeRaw(p, ghostId);
            if (r === 'placed') { out.placed++; this.stats.restored++; this.pending.delete(GhostGuard._pkey(p)); }
            else if (r === 'skipped') { out.skipped++; this.pending.delete(GhostGuard._pkey(p)); }
            else {
                out.failed++;
                this._enqueuePending(p, ghostId);
                if (samples.length < 3) samples.push(`(${x},${y},${z},dim ${dimid})`);
            }
        });
        out.pending = this.pending.size;
        if (this.logger && out.total) {
            this.logger.info(`[GhostGuard] 期望补齐(${reason || 'manual'})：${out.placed} 补写 / ${out.skipped} 已有方块跳过 / ${out.failed} 待重试，共 ${out.total} 格`);
            if (out.failed) {
                this.logger.warn(`[GhostGuard] ${out.failed} 格写入失败，通常是区块未加载（服务端刚启动/无人在附近）：${samples.join(' ')}`);
                this.logger.warn('[GhostGuard] 已进入待恢复队列：每 20s 重试、最多 30 轮，玩家进服时会立即再试一轮');
            }
        }
        if (this.pending.size) {
            // 立即强制加载一次（别等 20s 后的第一轮），主世界通常 1s 内就能补齐
            this._primeChunks();
            this._scheduleRetry();
        }
        return out;
    }

    /** 重试 pending 里的所有格；成功/跳过的移出队列 */
    retryPending(reason) {
        if (!this.pending.size) return { placed: 0, skipped: 0, left: 0 };
        if (!this.writesEnabled) return { placed: 0, skipped: 0, left: this.pending.size };
        const snap = [...this.pending.values()];
        let placed = 0, skipped = 0;
        for (const item of snap) {
            const p = { x: item.x, y: item.y, z: item.z, dimid: item.dimid };
            const r = this._placeRaw(p, item.ghostId);
            const k = GhostGuard._pkey(p);
            if (r === 'placed') {
                placed++;
                this.stats.restored++;
                this.pending.delete(k);
            } else if (r === 'skipped') {
                skipped++;
                this.pending.delete(k);
            } else {
                item.attempts++;
            }
        }
        if (this.logger && (placed || skipped)) {
            this.logger.info(`[GhostGuard] 待恢复重试(${reason})：成功 ${placed} / 跳过 ${skipped} / 剩余 ${this.pending.size}`);
        }
        return { placed, skipped, left: this.pending.size };
    }

    /**
     * 主世界用 tickingarea 临时加载 pending 涉及的区块，再写一次。
     * 只有主世界能做：tickingarea 是后台命令，作用维度固定为主世界。
     * @returns {boolean} 是否成功下发过 tickingarea
     */
    _primeChunks() {
        if (!this.pending.size) return false;
        if (typeof mc.runcmdEx !== 'function') return false;

        const groups = new Map();   // "cx,cz" -> {cx, cz}
        for (const item of this.pending.values()) {
            if (item.dimid !== 0) continue;              // 非主世界跳过
            const cx = Math.floor(item.x / 16);
            const cz = Math.floor(item.z / 16);
            groups.set(`${cx},${cz}`, { cx, cz });
            if (groups.size >= TICKINGAREA_BATCH_LIMIT) break;
        }
        if (!groups.size) return false;

        const names = [];
        let i = 0;
        for (const g of groups.values()) {
            const name = `litgh${i++}`;
            const cmd = `tickingarea add ${g.cx * 16} -64 ${g.cz * 16} ${g.cx * 16 + 15} 320 ${g.cz * 16 + 15} ${name}`;
            try {
                const r = mc.runcmdEx(cmd);
                if (r && r.success) names.push(name);
            } catch (e) { /* 忽略单个失败 */ }
        }
        if (!names.length) return false;

        if (this.logger) {
            this.logger.info(`[GhostGuard] 临时加载 ${names.length} 个区块以补写 ghost（${[...groups.keys()].join(' ')}）`);
        }
        // 等区块真正进入内存再写，写完立刻撤掉 tickingarea
        setTimeout(() => {
            this.retryPending('tickingarea');
            for (const n of names) {
                try { mc.runcmdEx(`tickingarea remove ${n}`); } catch (e) { /* 忽略 */ }
            }
        }, 800);
        return true;
    }

    _scheduleRetry() {
        if (this._retryTimer) return;
        if (!this.pending.size) return;
        if (this._retryRound >= RETRY_MAX_ROUNDS) {
            if (this.logger) {
                this.logger.warn(`[GhostGuard] 待恢复重试已达上限 ${RETRY_MAX_ROUNDS} 轮，仍有 ${this.pending.size} 格未补；玩家进服或执行 /litematica:ghost restore 可再试`);
            }
            return;
        }
        this._retryTimer = setTimeout(() => {
            this._retryTimer = null;
            this._retryRound++;
            // 前几轮优先强制加载（启动时最可能就是"区块没加载"）
            if (this._retryRound <= 3 || this._retryRound % 3 === 0) {
                if (!this._primeChunks()) this.retryPending(`retry#${this._retryRound}`);
            } else {
                this.retryPending(`retry#${this._retryRound}`);
            }
            if (this.pending.size) {
                this._scheduleRetry();
            } else {
                this._retryRound = 0;
                if (this.logger) this.logger.info('[GhostGuard] 待恢复队列已清空');
            }
        }, RETRY_INTERVAL_MS);
    }

    summary() {
        return {
            installed: this.installed,
            expectCount: this.expect ? this.expect.count() : 0,
            pending: this.pending.size,
            retryRound: this._retryRound,
            ...this.stats,
        };
    }
}

module.exports = { GhostGuard };
