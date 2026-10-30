/**
 * GhostSelfCheck — ghost 安全写入世界自检
 * 入口：`/litematica selfcheck`
 */

const MAX_SCAN_UP = 24;      // 从头顶往上最多找 24 格
const CLEARANCE = 4;         // 至少离玩家 4 格高，别挡视野

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

        const step = (name, passed, detail) => {
            steps.push({ name, ok: !!passed, detail: detail || '' });
            this._say(player, `${passed ? '§a✅' : '§c❌'} ${name}${detail ? ` §7${detail}` : ''}`);
            if (!passed) ok = false;
            return !!passed;
        };

        this._say(player, '§6=== LitematicaBE selfcheck（写世界链路自检）===');

        try {
            // ── 1. 注册表 ──
            const reg = this.registry;
            if (!reg) {
                step('注册表就绪', false, '未注入 GhostBlockRegistry');
                return this._done(player, steps, ok, ctx);
            }
            const rs = reg.stats ? reg.stats() : {};
            if (!reg.ready) {
                step('注册表就绪', false, `${rs.loadError || 'ghost_index 未就绪'}；确认 data/ghost_index.json 存在`);
                return this._done(player, steps, ok, ctx);
            }
            if (!reg.ids || !reg.ids.length) {
                step('注册表就绪', false, 'ghost_index 里没有任何方块定义');
                return this._done(player, steps, ok, ctx);
            }
            step('注册表就绪', true, `${reg.ids.length} 种定义 / addon ${(rs.addonVersion || []).join('.') || '?'}`);

            // ── 2. 写闸门 ──
            if (this.addonCheck && !this.addonCheck.isEnabled()) {
                const rep = this.addonCheck.summary ? this.addonCheck.summary() : {};
                const first = rep.issues ? rep.issues.find(i => i.level === 'error') : null;
                step('addon 版本校验', false, first ? `${first.code}: ${first.message}` : '版本不一致，ghost 写入已禁用');
                this._say(player, '§7修复：node tools/build_addon.js --pack → 客户端重装 .mcaddon → 覆盖服务端 BP/RP → 重启');
                return this._done(player, steps, ok, ctx);
            }
            step('addon 版本校验', true, this.addonCheck ? '一致，写入可用' : '未注入校验（跳过）');

            // ── 3. 快照可用 ──
            if (!this.snapshot) {
                step('快照可用', false, '未注入 WorldSnapshot，无法保证可撤销');
                return this._done(player, steps, ok, ctx);
            }
            step('快照可用', true, `目录 ${this.snapshot.stats().dir}`);

            // ── 4. 选点 ──
            const spot = this._pickSpot(player);
            if (!spot) {
                step('选取测试点', false, `玩家上方 ${CLEARANCE}–${MAX_SCAN_UP} 格内找不到"上下都是空气"的位置（或区块未加载）`);
                return this._done(player, steps, ok, ctx);
            }
            if (mc.getBlock(spot.x, spot.y, spot.z, spot.dimid) === null) {
                step('选取测试点', false, '目标格区块未加载');
                return this._done(player, steps, ok, ctx);
            }
            ctx.spot = spot;
            step('选取测试点', true, `(${spot.x}, ${spot.y}, ${spot.z}) dim ${spot.dimid}`);

            // ── 5. 读原状 ──
            const prevBlock = mc.getBlock(spot.x, spot.y, spot.z, spot.dimid);
            ctx.prev = { type: prevBlock.type, tileData: prevBlock.tileData || 0 };
            if (!isAirType(ctx.prev.type)) {
                step('读取原方块', false, `目标格是 ${ctx.prev.type}，不是空气（拒绝在非空气格上测试）`);
                return this._done(player, steps, ok, ctx);
            }
            step('读取原方块', true, `${ctx.prev.type} (data ${ctx.prev.tileData})`);

            // ── 6. 快照登记 ──
            const sessionId = `selfcheck-${String((player && player.xuid) || 'unknown').replace(/[^0-9a-zA-Z]/g, '').slice(0, 12) || 'unknown'}-${Date.now()}`;
            ctx.sessionId = sessionId;
            try {
                this.snapshot.begin(sessionId, spot.dimid);
                this.snapshot.record(sessionId, spot.x, spot.y, spot.z, ctx.prev);
                this.snapshot.persist(sessionId);
            } catch (e) {
                step('快照登记', false, e && e.message ? e.message : String(e));
                return this._done(player, steps, ok, ctx);
            }
            const snapRec = this.snapshot.get(sessionId, spot.x, spot.y, spot.z);
            if (!snapRec || snapRec.type !== ctx.prev.type) {
                step('快照登记', false, '写进快照的原方块与读到的原方块不一致');
                return this._done(player, steps, ok, ctx);
            }
            step('快照登记', true, `已记录 ${snapRec.type} 并落盘`);

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
                step('写入幽灵方块', false, `mc.setBlock 返回 false（区块未加载？先靠近目标位置再试）`);
                return this._done(player, steps, ok, ctx);
            }
            step('写入幽灵方块', true, gid);

            // ── 8. 读回 ──
            const back = mc.getBlock(spot.x, spot.y, spot.z, spot.dimid);
            if (!back || back.type !== gid) {
                step('读回验证', false, `读到 ${back ? back.type : 'null'}，期望 ${gid}（addon 是否双端安装？）`);
                return this._done(player, steps, ok, ctx);
            }
            step('读回验证', true, `世界返回 ${back.type}`);

            // ── 9. 撤销 ──
            let rev = null;
            try {
                rev = this.snapshot.close(sessionId);
                ctx.sessionId = null;       // close 已处理，finally 不必再关
            } catch (e) {
                step('还原原方块', false, e && e.message ? e.message : String(e));
                return this._done(player, steps, ok, ctx);
            }
            if (!rev || rev.remaining > 0) {
                step('还原原方块', false, `仍有 ${rev ? rev.remaining : '?'} 格未还原（区块未加载）`);
                return this._done(player, steps, ok, ctx);
            }
            step('还原原方块', true, `还原 ${rev.restored} 格 / 保留 ${rev.kept} / 跳过 ${rev.skipped}`);

            // ── 10. 再读回 ──
            const after = mc.getBlock(spot.x, spot.y, spot.z, spot.dimid);
            const sameType = after && after.type === ctx.prev.type;
            const sameData = !after || (Number(after.tileData) || 0) === (ctx.prev.tileData || 0);
            if (!sameType || !sameData) {
                step('还原校验', false, `读到 ${after ? after.type : 'null'} / data ${after ? after.tileData : '?'}，期望 ${ctx.prev.type} / ${ctx.prev.tileData}`);
                return this._done(player, steps, ok, ctx);
            }
            step('还原校验', true, `世界回到 ${after.type}`);

            // ── 11. 残留检查 ──
            const left = this.snapshot.findSessions(`selfcheck-`) || [];
            if (left.length) {
                step('清理残留', false, `还有 ${left.length} 个 selfcheck 快照没删`);
                return this._done(player, steps, ok, ctx);
            }
            step('清理残留', true, 'data/sessions/ 未留下 selfcheck 文件');
        } catch (e) {
            step('selfcheck 异常', false, e && e.message ? e.message : String(e));
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
                    this._say(player, `§e⚠ 清理未完成：还有 ${r.remaining} 格没还原（区块未加载），已留在快照里，重启或靠近后会再试`);
                    steps.push({ name: '兜底清理', ok: false, detail: `剩余 ${r.remaining} 格` });
                    ok = false;
                } else {
                    this._say(`§7兜底清理：还原 ${r.restored} 格 / 保留现状 ${r.kept}（没留下半截幽灵）`);
                }
            } catch (e) {
                this._say(player, `§c兜底清理失败：${e && e.message ? e.message : e}`);
                steps.push({ name: '兜底清理', ok: false, detail: String(e && e.message ? e.message : e) });
                ok = false;
            }
        }

        const passed = steps.filter(s => s.ok).length;
        const failed = steps.length - passed;
        this._say(player, `${ok ? '§a' : '§c'}=== selfcheck ${ok ? '全部通过' : '未通过'}：${passed} 项通过 / ${failed} 项失败 ===`);
        if (!ok) this._say(player, '§7把上面第一条 ❌ 连同这一行一起发我，就能定位是哪一层的问题');
        this._log(`${ok ? 'PASS' : 'FAIL'} ${passed}/${steps.length}${ok ? '' : ' :: ' + ((steps.find(s => !s.ok) || {}).name || '')}`);
        return { ok, passed, failed, steps, spot: c.spot || null, ghostId: c.ghostId || null, cleanup };
    }
}

module.exports = { GhostSelfCheck, isAirType, MAX_SCAN_UP, CLEARANCE };
