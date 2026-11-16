/**
 * GhostSelfCheck — ghost 安全写入世界自检
 * 入口：`/litematica selfcheck`
 */

const MAX_SCAN_UP = 24;      // 从头顶往上最多找 24 格
const CLEARANCE = 4;         // 至少离玩家 4 格高，别挡视野

// 国际化：玩家可见消息走 tell/t（翻译），steps 记录保留中文原文（zh）供测试与日志
const { tell, t, zh } = require('../i18n/I18n');

function dimidOf(player) {
    const d = player && player.pos && player.pos.dimid;
    return typeof d === 'number' ? d : 0;
}

/** 是否是"可以放/可以还"的空气格：只认 air 系 */
function isAirType(type) {
    if (!type) return false;
    const short = type.includes(':') ? type.slice(type.indexOf(':') + 1) : type;
    return short === 'air' || short === 'cave_air' || short === 'void_air';
}

class GhostSelfCheck {
    /**
     * @param {{registry?:object, addonCheck?:object, snapshot?:object, logger?:object}} opts
     */
    constructor(opts) {
        const o = opts || {};
        this.registry = o.registry || null;
        this.addonCheck = o.addonCheck || null;
        this.snapshot = o.snapshot || null;
        this.logger = o.logger || null;
    }

    _say(player, msg) {
        try { if (player && player.tell) player.tell(msg); } catch (e) { /* 忽略 */ }
    }

    _log(msg) {
        try { if (this.logger && this.logger.info) this.logger.info(`[SelfCheck] ${msg}`); } catch (e) { /* 忽略 */ }
    }

    /**
     * 找一个安全的测试点：玩家上方 CLEARANCE 格起向上找第一个空气格，
     * 且它下面那格也必须是空气（不会悬在建筑顶上）
     * @returns {{x,y,z,dimid}|null}
     */
    _pickSpot(player) {
        const pos = player && player.pos;
        if (!pos) return null;
        const dimid = dimidOf(player);
        const x = Math.floor(pos.x);
        const pz = Math.floor(pos.z);
        const py = Math.floor(pos.y);

        for (let dy = CLEARANCE; dy <= MAX_SCAN_UP; dy++) {
            const y = py + dy;
            let cur = null, below = null;
            try {
                cur = mc.getBlock(x, y, pz, dimid);
                below = mc.getBlock(x, y - 1, pz, dimid);
            } catch (e) {
                return null;
            }
            if (!cur || !below) return null;          // 区块未加载
            if (isAirType(cur.type) && isAirType(below.type)) {
                return { x, y, z: pz, dimid };
            }
        }
        return null;
    }

    /**
     * 跑一次自检
     * @param {object} player
     * @returns {{ok:boolean, passed:number, failed:number, steps:Array, spot:object|null, ghostId:string|null}}
     */
    run(player) {
        const steps = [];
        const ctx = { ghostId: null, spot: null, prev: null, sessionId: null };
        let ok = true;

        // step(nameKey, passed, detailKey?, ...detailArgs)
        // 玩家可见行按玩家语言翻译；steps 记录保留中文原文（测试与日志依赖中文名/详情）。
        const step = (nameKey, passed, detailKey, ...detailArgs) => {
            const zhName = zh(nameKey);
            const zhDetail = detailKey ? zh(detailKey, ...detailArgs) : '';
            steps.push({ name: zhName, ok: !!passed, detail: zhDetail });
            const dn = t(player, nameKey);
            const dd = detailKey ? t(player, detailKey, ...detailArgs) : '';
            this._say(player, `${passed ? '§a✅' : '§c❌'} ${dn}${dd ? ` §7${dd}` : ''}`);
            if (!passed) ok = false;
            return !!passed;
        };

        tell(player, 'selfcheck.header');

        try {
            // ── 1. 注册表 ──
            const reg = this.registry;
            if (!reg) {
                step('selfcheck.step.reg', false, 'selfcheck.detail.regNoInject');
                return this._done(player, steps, ok, ctx);
            }
            const rs = reg.stats ? reg.stats() : {};
            if (!reg.ready) {
                step('selfcheck.step.reg', false, 'selfcheck.detail.regNotReady', rs.loadError || 'ghost_index 未就绪');
                return this._done(player, steps, ok, ctx);
            }
            if (!reg.ids || !reg.ids.length) {
                step('selfcheck.step.reg', false, 'selfcheck.detail.regEmpty');
                return this._done(player, steps, ok, ctx);
            }
            step('selfcheck.step.reg', true, 'selfcheck.detail.regOk', reg.ids.length, (rs.addonVersion || []).join('.') || '?');

            // ── 2. 写闸门 ──
            if (this.addonCheck && !this.addonCheck.isEnabled()) {
                const rep = this.addonCheck.summary ? this.addonCheck.summary() : {};
                const first = rep.issues ? rep.issues.find(i => i.level === 'error') : null;
                step('selfcheck.step.addon', false, 'selfcheck.detail.addonMismatch', first ? `${first.code}: ${first.message}` : '版本不一致，ghost 写入已禁用');
                tell(player, 'selfcheck.fix');
                return this._done(player, steps, ok, ctx);
            }
            if (this.addonCheck) {
                step('selfcheck.step.addon', true, 'selfcheck.detail.addonOk');
            } else {
                step('selfcheck.step.addon', true, 'selfcheck.detail.addonSkip');
            }

            // ── 3. 快照可用 ──
            if (!this.snapshot) {
                step('selfcheck.step.snap', false, 'selfcheck.detail.snapNoInject');
                return this._done(player, steps, ok, ctx);
            }
            step('selfcheck.step.snap', true, 'selfcheck.detail.snapDir', this.snapshot.stats().dir);

            // ── 4. 选点 ──
            const spot = this._pickSpot(player);
            if (!spot) {
                step('selfcheck.step.spot', false, 'selfcheck.detail.spotFail', CLEARANCE, MAX_SCAN_UP);
                return this._done(player, steps, ok, ctx);
            }
            if (mc.getBlock(spot.x, spot.y, spot.z, spot.dimid) === null) {
                step('selfcheck.step.spot', false, 'selfcheck.detail.spotChunk');
                return this._done(player, steps, ok, ctx);
            }
            ctx.spot = spot;
            step('selfcheck.step.spot', true, 'selfcheck.detail.spotOk', spot.x, spot.y, spot.z, spot.dimid);

            // ── 5. 读原状 ──
            const prevBlock = mc.getBlock(spot.x, spot.y, spot.z, spot.dimid);
            ctx.prev = { type: prevBlock.type, tileData: prevBlock.tileData || 0 };
            if (!isAirType(ctx.prev.type)) {
                step('selfcheck.step.read', false, 'selfcheck.detail.readNotAir', ctx.prev.type);
                return this._done(player, steps, ok, ctx);
            }
            step('selfcheck.step.read', true, 'selfcheck.detail.readOk', ctx.prev.type, ctx.prev.tileData);

            // ── 6. 快照登记 ──
            const sessionId = `selfcheck-${String((player && player.xuid) || 'unknown').replace(/[^0-9a-zA-Z]/g, '').slice(0, 12) || 'unknown'}-${Date.now()}`;
            ctx.sessionId = sessionId;
            try {
                this.snapshot.begin(sessionId, spot.dimid);
                this.snapshot.record(sessionId, spot.x, spot.y, spot.z, ctx.prev);
                this.snapshot.persist(sessionId);
            } catch (e) {
                step('selfcheck.step.record', false, 'selfcheck.detail.recordFail', e && e.message ? e.message : String(e));
                return this._done(player, steps, ok, ctx);
            }
            const snapRec = this.snapshot.get(sessionId, spot.x, spot.y, spot.z);
            if (!snapRec || snapRec.type !== ctx.prev.type) {
                step('selfcheck.step.record', false, 'selfcheck.detail.recordMismatch');
                return this._done(player, steps, ok, ctx);
            }
            step('selfcheck.step.record', true, 'selfcheck.detail.recordOk', snapRec.type);

            // ── 7. 写幽灵 ──
            const ids = (this.registry.ids || []).filter(id => id !== this.registry.genericId);
            const gid = ids.length ? ids[0] : this.registry.ids[0];
            ctx.ghostId = gid;
            let wrote = false;
            try {
                wrote = !!mc.setBlock(spot.x, spot.y, spot.z, spot.dimid, gid, 0);
            } catch (e) {
                wrote = false;
            }
            if (!wrote) {
                step('selfcheck.step.write', false, 'selfcheck.detail.writeFalse');
                return this._done(player, steps, ok, ctx);
            }
            step('selfcheck.step.write', true, 'selfcheck.detail.writeOk', gid);

            // ── 8. 读回 ──
            const back = mc.getBlock(spot.x, spot.y, spot.z, spot.dimid);
            if (!back || back.type !== gid) {
                step('selfcheck.step.back', false, 'selfcheck.detail.backFail', back ? back.type : 'null', gid);
                return this._done(player, steps, ok, ctx);
            }
            step('selfcheck.step.back', true, 'selfcheck.detail.backOk', back.type);

            // ── 9. 撤销 ──
            let rev = null;
            try {
                rev = this.snapshot.close(sessionId);
                ctx.sessionId = null;       // close 已处理，finally 不必再关
            } catch (e) {
                step('selfcheck.step.restore', false, 'selfcheck.detail.restoreFail', e && e.message ? e.message : String(e));
                return this._done(player, steps, ok, ctx);
            }
            if (!rev || rev.remaining > 0) {
                step('selfcheck.step.restore', false, 'selfcheck.detail.restoreRemain', rev ? rev.remaining : '?');
                return this._done(player, steps, ok, ctx);
            }
            step('selfcheck.step.restore', true, 'selfcheck.detail.restoreOk', rev.restored, rev.kept, rev.skipped);

            // ── 10. 再读回 ──
            const after = mc.getBlock(spot.x, spot.y, spot.z, spot.dimid);
            const sameType = after && after.type === ctx.prev.type;
            const sameData = !after || (Number(after.tileData) || 0) === (ctx.prev.tileData || 0);
            if (!sameType || !sameData) {
                step('selfcheck.step.vrestore', false, 'selfcheck.detail.vrestoreFail', after ? after.type : 'null', after ? after.tileData : '?', ctx.prev.type, ctx.prev.tileData);
                return this._done(player, steps, ok, ctx);
            }
            step('selfcheck.step.vrestore', true, 'selfcheck.detail.vrestoreOk', after.type);

            // ── 11. 残留检查 ──
            const left = this.snapshot.findSessions(`selfcheck-`) || [];
            if (left.length) {
                step('selfcheck.step.residue', false, 'selfcheck.detail.residueLeft', left.length);
                return this._done(player, steps, ok, ctx);
            }
            step('selfcheck.step.residue', true, 'selfcheck.detail.residueOk');
        } catch (e) {
            step('selfcheck.step.except', false, 'selfcheck.detail.except', e && e.message ? e.message : String(e));
        }

        return this._done(player, steps, ok, ctx);
    }

    /** 收尾：无论成败都把可能写下去的幽灵与快照清干净，再汇总 */
    _done(player, steps, ok, ctx) {
        const c = ctx || {};
        let cleanup = null;

        // 兜底清理：任何提前 return 的路径（比如幽灵写进去了、读回失败）都要还原
        if (c.sessionId && this.snapshot && this.snapshot.has(c.sessionId)) {
            try {
                const r = this.snapshot.close(c.sessionId);
                cleanup = r;
                if (r.remaining > 0) {
                    tell(player, 'selfcheck.cleanupRemain', r.remaining);
                    steps.push({ name: zh('selfcheck.step.cleanup'), ok: false, detail: `${r.remaining} 格` });
                    ok = false;
                } else {
                    tell(player, 'selfcheck.cleanupOk', r.restored, r.kept);
                }
            } catch (e) {
                tell(player, 'selfcheck.cleanupFail', e && e.message ? e.message : e);
                steps.push({ name: zh('selfcheck.step.cleanup'), ok: false, detail: String(e && e.message ? e.message : e) });
                ok = false;
            }
        }

        const passed = steps.filter(s => s.ok).length;
        const failed = steps.length - passed;
        tell(player, 'selfcheck.result', ok ? '§a' : '§c', ok ? '全部通过' : '未通过', passed, failed);
        if (!ok) tell(player, 'selfcheck.resultHint');
        this._log(`${ok ? 'PASS' : 'FAIL'} ${passed}/${steps.length}${ok ? '' : ' :: ' + ((steps.find(s => !s.ok) || {}).name || '')}`);
        return { ok, passed, failed, steps, spot: c.spot || null, ghostId: c.ghostId || null, cleanup };
    }
}

module.exports = { GhostSelfCheck, isAirType, MAX_SCAN_UP, CLEARANCE };
