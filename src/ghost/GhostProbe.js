/**
 * GhostProbe — 临时验证工具
 * 入口：`/litematica:ghost`（独立命令）或 `/litematica ghost`（主命令枚举分支）。
 */

const DEFAULT_WIDTH = 7;
const DEFAULT_HEIGHT = 5;
const WALL_DISTANCE = 4;

/** 取玩家所在维度 ID：Player 上没有 dim/dimid，维度在 pos 上 */
function dimidOf(player) {
    const d = player && player.pos && player.pos.dimid;
    return typeof d === 'number' ? d : 0;
}

/**
 * 玩家水平朝向的单位向量（整数格）。
 * yaw 0 = +Z（南），90 = -X（西），180 = -Z（北），270 = +X（东）。
 * 玩家没取到 direction 时按"朝北"处理，与旧版行为一致。
 */
function facingOf(player) {
    const yaw = (player && player.direction && typeof player.direction.yaw === 'number')
        ? player.direction.yaw
        : 180;
    const deg = ((yaw % 360) + 360) % 360;
    if (deg >= 45 && deg < 135) return { x: -1, z: 0 };
    if (deg >= 135 && deg < 225) return { x: 0, z: -1 };
    if (deg >= 225 && deg < 315) return { x: 1, z: 0 };
    return { x: 0, z: 1 };
}

class GhostProbe {
    /**
     * @param {object} registry GhostBlockRegistry
     * @param {object} [expectStore] GhostExpectStore（不传则退化为纯临时铺墙）
     * @param {object} [addonCheck] AddonVersionCheck（P2.3：版本不一致时关掉写入入口）
     * @param {object} [worldSnapshot] WorldSnapshot（P3.2：原方块落盘，撤销/崩溃恢复的依据）
     */
    constructor(registry, expectStore, addonCheck, worldSnapshot) {
        this.registry = registry;
        this.expect = expectStore || null;
        this.addonCheck = addonCheck || null;
        this.snapshot = worldSnapshot || null;
        this.sessions = new Map(); // xuid -> { dimid, sessionId, blocks: [{x,y,z,gid}] }
    }

    /** 会话 ID：一个探针一面墙一个文件；只留安全字符（会当文件名用） */
    _newSessionId(player, dimid) {
        return `${this._prefix(player)}-${dimid}-${Date.now()}`;
    }

    /** 该玩家的会话前缀（崩溃后靠它把快照找回来） */
    _prefix(player) {
        const xuid = String((player && player.xuid) || 'unknown').replace(/[^0-9a-zA-Z]/g, '').slice(0, 12) || 'unknown';
        return `probe-${xuid}`;
    }

    /**
     * 崩溃恢复：把磁盘上属于该玩家、但内存里没有的会话接管进 this.sessions
     * @returns {number} 接管的格数
     */
    _adoptOrphanSessions(player) {
        if (!this.snapshot) return 0;
        const prefix = this._prefix(player);
        const found = this.snapshot.findSessions(prefix);
        if (!found.length) return 0;
        const blocks = [];
        let dimid = 0;
        for (const s of found) {
            dimid = s.dimid;
            for (const b of s.blocks.values()) blocks.push({ x: b.x, y: b.y, z: b.z, gid: null, prev: b.type, prevData: b.data });
        }
        if (!blocks.length) return 0;
        // 只接管一个会话（一个玩家通常只有一面墙；多个则逐个 undo）
        const first = found[0];
        this.sessions.set(player.xuid, {
            dimid: first.dimid,
            sessionId: first.sessionId,
            blocks: [...first.blocks.values()].map(b => ({ x: b.x, y: b.y, z: b.z, gid: null, prev: b.type, prevData: b.data })),
        });
        return first.blocks.size;
    }

    /** P2.3 闸门：版本校验未通过时不许写世界，并把原因告诉玩家 */
    _blocked(player) {
        if (!this.addonCheck || this.addonCheck.isEnabled()) return false;
        const rep = this.addonCheck.summary ? this.addonCheck.summary() : null;
        const first = rep && rep.issues ? rep.issues.find(i => i.level === 'error') : null;
        player.tell('§cghost 写入已禁用：addon 与插件版本不一致');
        if (first) player.tell(`§7原因：${first.message}`);
        player.tell('§7修复：npm run build → 客户端重装 build/ 的 .mcaddon → 服务器覆盖新 packs → 重启');
        player.tell('§7用法：/litematica:ghost info 可查看完整校验结果');
        return true;
    }

    _pickIds() {
        // generic 留作最后兜底，优先展示真实贴图的 ghost
        const all = this.registry.ids.filter(id => id !== this.registry.genericId);
        return all.length ? all : this.registry.ids;
    }

    /**
     * 在玩家视线前方 WALL_DISTANCE 格处铺一面 width×height 的 ghost 墙
     * @returns {boolean} 是否至少写入了一格
     */
    lay(player, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
        if (this._blocked(player)) return false;
        if (!this.registry.ready) {
            player.tell(`§cghost_index 未就绪：${this.registry.loadError || '未知原因'}`);
            player.tell('§7确认服务端 plugins/LitematicaBE/data/ghost_index.json 存在');
            return false;
        }

        const ids = this._pickIds();
        if (!ids.length) {
            player.tell('§cghost_index 里没有任何 ghost 方块定义');
            return false;
        }

        const pos = player.pos;
        if (!pos) {
            player.tell('§c取不到玩家坐标');
            return false;
        }

        const dimid = dimidOf(player);
        const px = Math.floor(pos.x), py = Math.floor(pos.y), pz = Math.floor(pos.z);

        // 上一面墙还没撤：先还原再铺新的，避免两次铺墙混进同一会话（否则 undo 会连带还原别的墙）
        const old = this.sessions.get(player.xuid);
        if (old) {
            this.undo(player, { silent: true });
            player.tell('§7（上一面探针墙已先还原）');
        }

        const sessionId = this._newSessionId(player, dimid);
        let snapOk = false;
        if (this.snapshot) {
            try {
                this.snapshot.begin(sessionId, dimid);
                snapOk = true;
            } catch (e) {
                snapOk = false;
                player.tell(`§e快照初始化失败，本次铺墙无法撤销：${e && e.message ? e.message : e}`);
            }
        }

        // 墙中心：玩家前方 WALL_DISTANCE 格；墙沿"视线的垂直方向"展开
        const facing = facingOf(player);
        const centerX = px + facing.x * WALL_DISTANCE;
        const centerZ = pz + facing.z * WALL_DISTANCE;
        const perp = { x: -facing.z, z: facing.x };   // 水平垂直向量
        const half = Math.floor(width / 2);

        const rec = [];
        let ok = 0, fail = 0, i = 0;

        for (let y = 0; y < height; y++) {
            for (let col = 0; col < width; col++) {
                const offset = col - half;
                const wx = centerX + perp.x * offset;
                const wy = py + y;
                const wz = centerZ + perp.z * offset;

                let prevType = 'minecraft:air';
                let prevData = 0;
                try {
                    const prev = mc.getBlock(wx, wy, wz, dimid);
                    if (prev) {
                        if (prev.type) prevType = prev.type;
                        if (typeof prev.tileData === 'number') prevData = prev.tileData;
                    }
                } catch (e) {
                    // 未加载区块等情况：该格不写，避免盲写产生不可撤销的残留
                    fail++;
                    continue;
                }

                // 顺序铁律：**先登记快照，再写世界**。写成功却漏记 = 永久丢原方块。
                // 反过来（先记后写失败）最多留一条多余记录，revert 时"当前==原"会自己跳过。
                if (snapOk) {
                    this.snapshot.record(sessionId, wx, wy, wz, { type: prevType, tileData: prevData });
                }

                const gid = ids[i % ids.length];
                i++;

                let success = false;
                try {
                    success = !!mc.setBlock(wx, wy, wz, dimid, gid, 0);
                } catch (e) {
                    success = false;
                }

                if (success) {
                    ok++;
                    rec.push({ x: wx, y: wy, z: wz, gid, prev: prevType, prevData });
                    // 关键：登记"这一格应该有 ghost"，玩家盖方块再破坏后由 GhostGuard 补回
                    if (this.expect) this.expect.set(dimid, wx, wy, wz, gid);
                } else {
                    fail++;
                }
            }
        }

        if (!rec.length) {
            // 一格都没写成功：把可能已登记的空会话清掉，别留孤儿
            if (snapOk) {
                try { this.snapshot.close(sessionId); } catch (e) { /* 忽略 */ }
            }
            player.tell('§c一块都没写成功。检查：addon 是否双端安装、该位置区块是否加载');
            return false;
        }

        // 立刻落盘：中途崩溃时快照文件已经在，restoreOrphaned 才能救回来
        let persisted = false;
        if (snapOk) {
            try { persisted = this.snapshot.persist(sessionId); } catch (e) { persisted = false; }
        }

        this.sessions.set(player.xuid, { dimid, sessionId: snapOk ? sessionId : null, blocks: rec });

        const s = this.registry.stats();
        player.tell(`§a已放置 §e${ok} §a个 ghost 方块（失败 ${fail}）`);
        player.tell(`§7墙面朝向你，中心 (${centerX}, ${py + 1}, ${centerZ})，${width}×${height}，维度 ${dimid}`);
        player.tell(`§7addon ${s.addonVersion ? s.addonVersion.join('.') : '?'} / 定义 ${s.blockCount} 种 / javaMap ${s.javaMapCount} 条`);
        if (this.expect) {
            player.tell(`§7期望记录：本维度 §f${this.expect.countDim(dimid)} §7格 / 全服 §f${this.expect.count()} §7格`);
        }
        if (snapOk) {
            player.tell(`§7快照：§f${rec.length} §7格原方块已落盘（${persisted ? '§a已写入' : '§e仅内存'}），可崩溃恢复`);
        }
        player.tell('§f转身面对墙查看；输入 §e/litematica:ghost undo §f还原');
        player.tell('§7盖方块顶掉 ghost 后，把方块破坏掉，ghost 会自动补回');
        return true;
    }

    /**
     * 还原本玩家的测试方块
     * @param {object} player
     * @param {{silent?: boolean, reopen?: boolean}} [opts] silent=true 时不打印（内部自动还原用）
     */
    undo(player, opts) {
        const o = opts || {};
        if (!o.silent && this._blocked(player)) return false;
        const key = player.xuid;
        let sess = this.sessions.get(key);

        // 崩溃后内存映射丢了：按 sessionId 前缀（probe-<xuid>-…）把会话找回来，撤销能力不能随进程一起没
        if ((!sess || !sess.blocks.length) && this.snapshot && !o.silent) {
            const adopt = this._adoptOrphanSessions(player);
            if (adopt) sess = this.sessions.get(key);
        }
        if (!sess || !sess.blocks.length) {
            if (!o.silent) player.tell('§e没有需要还原的测试方块');
            return false;
        }

        // 先删期望：否则还原完 GhostGuard 又会把幽灵补回来（P1.5e 踩过）
        if (this.expect) {
            for (const b of sess.blocks) this.expect.del(sess.dimid, b.x, b.y, b.z);
        }

        let ok = 0, fail = 0, kept = 0;
        if (this.snapshot && sess.sessionId && this.snapshot.has(sess.sessionId)) {
            try {
                const r = this.snapshot.close(sess.sessionId);
                ok = r.restored;
                kept = r.kept;
                // skipped 不计失败（要么是"世界本来就没变"，要么是原空气留下）
                fail = r.failed + Math.max(0, r.remaining);
            } catch (e) {
                if (!o.silent) player.tell(`§c快照还原失败：${e && e.message ? e.message : e}`);
                return false;
            }
        } else {
            // 退化路径：没有快照时按内存记录反向写（旧行为，保证能用）
            for (let i = sess.blocks.length - 1; i >= 0; i--) {
                const b = sess.blocks[i];
                let success = false;
                try {
                    success = !!mc.setBlock(b.x, b.y, b.z, sess.dimid, b.prev, b.prevData || 0);
                } catch (e) {
                    success = false;
                }
                if (success) ok++;
                else fail++;
            }
        }

        this.sessions.delete(key);
        if (!o.silent) {
            player.tell(`§a已还原 §e${ok} §a格（失败 ${fail}）`);
            if (kept) player.tell(`§7有 §f${kept} §7格已被你放了别的方块，保持原样未覆盖`);
            if (fail) player.tell('§7失败格可能因区块未加载，已留在快照里，重启或靠近后会再试');
        }
        return true;
    }

    /** 打印注册表状态 */
    info(player) {
        const s = this.registry.stats();
        player.tell('§6=== Ghost 注册表 ===');
        player.tell(`§7就绪: ${s.ready ? '§a是' : '§c否'}`);
        player.tell(`§7addon 版本: §f${s.addonVersion ? s.addonVersion.join('.') : '?'}`);
        player.tell(`§7ghost 定义: §f${s.blockCount} §7种（延后 ${s.deferredCount}）`);
        player.tell(`§7javaMap: §f${s.javaMapCount} §7条`);
        if (s.javaMapStats) {
            player.tell(`§7  命中 §a${s.javaMapStats.mapped}§7 / 回落 generic §e${s.javaMapStats.generic}`);
        }
        const sess = this.sessions.get(player.xuid);
        if (sess && sess.blocks.length) {
            player.tell(`§7你当前有 §f${sess.blocks.length} §7个待还原的探针方块`);
        }
        if (this.expect) {
            const es = this.expect.stats();
            player.tell(`§7期望集合: §f${es.count} §7格 / §f${es.dims} §7个维度`);
        }
        if (this.snapshot) {
            const ss = this.snapshot.stats();
            player.tell(`§7快照: §f${ss.sessions} §7个未还原会话 / §f${ss.blocks} §7格`);
        } else {
            player.tell('§7快照: §e未启用（探针只能内存撤销，崩溃即丢）');
        }
        if (global.ghostGuard && global.ghostGuard.summary) {
            const g = global.ghostGuard.summary();
            player.tell(`§7守卫: 破坏补回 §f${g.destroyHits} §7次 / 已补写 §f${g.restored} §7次 / 跳过 §f${g.skipped}`);
        }
        if (s.loadError) player.tell(`§c错误: ${s.loadError}`);
        if (this.addonCheck) {
            player.tell(`§6=== addon 版本校验 ===`);
            player.tell(`§7状态: ${this.addonCheck.summaryText()}`);
            const rep = this.addonCheck.summary();
            if (rep.deployed) {
                const bp = rep.deployed.bp;
                player.tell(`§7服务端 BP: §f${bp ? (bp.version || []).join('.') : '未找到'}`);
            }
            if (rep.issues && rep.issues.length) {
                for (const i of rep.issues.slice(0, 4)) {
                    player.tell(`§7- ${i.level === 'error' ? '§c' : '§e'}${i.code}§7: ${i.message}`);
                }
            }
        }
        return true;
    }
}

module.exports = { GhostProbe, facingOf, dimidOf };
