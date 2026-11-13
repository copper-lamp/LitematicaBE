/** WorldSnapshot — 写世界之前的"原方块快照"，保存与还原 */

const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const DEFAULT_RESTORE_BATCH = 600;   // 每次 revert 默认最多还原的方块数

function posKey(x, y, z) {
    return `${x},${y},${z}`;
}

/** 默认的 ghost 判定：与 GhostBlockRegistry.isGhost 同义 */
function defaultIsGhost(type) {
    return typeof type === 'string' && type.startsWith('lit:g_');
}

function airLike(type) {
    if (!type) return true;
    const short = type.includes(':') ? type.slice(type.indexOf(':') + 1) : type;
    return short === 'air' || short === 'cave_air' || short === 'void_air' || short === 'structure_void';
}

class WorldSnapshot {
    /**
     * @param {{dataDir?: string, logger?: object, isGhost?: function(string):boolean, restoreBatch?: number}} [opts]
     */
    constructor(opts) {
        const o = opts || {};
        this.dataDir = o.dataDir || path.join(__dirname, '..', '..', 'data', 'sessions');
        this.logger = o.logger || null;
        this.isGhost = typeof o.isGhost === 'function' ? o.isGhost : defaultIsGhost;
        this.restoreBatch = Number.isFinite(o.restoreBatch) ? o.restoreBatch : DEFAULT_RESTORE_BATCH;
        /** @type {Map<string, {sessionId:string, dimid:number, blocks:Map<string,object>, createdAt:number, updatedAt:number, persisted:boolean}>} */
        this.sessions = new Map();
        this.loadError = null;
    }

    _info(msg) {
        try { if (this.logger && this.logger.info) this.logger.info(`[WorldSnapshot] ${msg}`); } catch (e) { /* 静默 */ }
    }

    _warn(msg) {
        try { if (this.logger && this.logger.warn) this.logger.warn(`[WorldSnapshot] ${msg}`); } catch (e) { /* 静默 */ }
    }

    fileOf(sessionId) {
        return path.join(this.dataDir, `${sessionId}.json`);
    }

    /** 载入 data/sessions/ 下所有未还原的会话（= 上次异常退出的遗留） */
    load() {
        this.loadError = null;
        let files = [];
        try {
            if (!fs.existsSync(this.dataDir)) return this;
            files = fs.readdirSync(this.dataDir).filter(f => f.endsWith('.json'));
        } catch (e) {
            this.loadError = e && e.message ? e.message : String(e);
            this._warn(`扫描 ${this.dataDir} 失败：${this.loadError}`);
            return this;
        }

        for (const f of files) {
            const p = path.join(this.dataDir, f);
            try {
                const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
                const sessionId = obj.sessionId || f.replace(/\.json$/, '');
                const blocks = new Map();
                for (const b of (obj.blocks || [])) {
                    if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.z)) continue;
                    blocks.set(posKey(b.x, b.y, b.z), {
                        x: b.x, y: b.y, z: b.z,
                        type: b.t || 'minecraft:air',
                        data: Number.isFinite(b.d) ? b.d : 0,
                        nbt: b.nbt || null,
                    });
                }
                this.sessions.set(sessionId, {
                    sessionId,
                    dimid: Number.isFinite(obj.dimid) ? obj.dimid : 0,
                    meta: (obj.meta && typeof obj.meta === 'object') ? obj.meta : null,
                    blocks,
                    createdAt: Number.isFinite(obj.createdAt) ? obj.createdAt : Date.now(),
                    updatedAt: Date.now(),
                    persisted: true,
                });
            } catch (e) {
                // 坏文件不覆盖：改名保留现场（与 GhostExpectStore 一致）
                try { fs.renameSync(p, `${p}.corrupt`); } catch (e2) { /* 忽略 */ }
                this._warn(`快照 ${f} 解析失败：${e && e.message ? e.message : e}（已备份为 .corrupt）`);
            }
        }
        if (this.sessions.size) {
            const n = this.countAll();
            this._info(`载入 ${this.sessions.size} 个未还原会话（${n} 格），等待 restoreOrphaned()`);
        }
        return this;
    }

    /**
     * 开一个新会话（若同名会话已存在 → 说明上次没还原，复用并告警，绝不覆盖）
     */
    begin(sessionId, dimid, meta) {
        if (!sessionId) throw new Error('WorldSnapshot.begin 需要 sessionId');
        const exist = this.sessions.get(sessionId);
        if (exist) {
            this._warn(`会话 ${sessionId} 已存在（${exist.blocks.size} 格未还原），复用而不覆盖`);
            if (meta && !exist.meta) exist.meta = meta;
            return exist;
        }
        const s = {
            sessionId,
            dimid: Number.isFinite(dimid) ? dimid : 0,
            // meta 会跟着快照一起落盘：MEGA 会话标记 mega=true（重启后注入状态全丢，
            // 只能无条件还原，不能像普通投影那样"保留 + 补齐"，见 restoreOrphaned）
            meta: (meta && typeof meta === 'object') ? { ...meta } : null,
            blocks: new Map(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            persisted: false,
        };
        this.sessions.set(sessionId, s);
        return s;
    }

    /** 是否是 MEGA 会话（注入状态是纯内存的，重启后无人能接管） */
    static isMegaSession(session) {
        return !!(session && session.meta && session.meta.mega === true);
    }

    /**
     * 遍历满足条件的会话里的每一格（只读，不改任何状态）
     *
     * 用途：重启后清理 MEGA 期望账本 —— 得先知道"哪些格属于 MEGA 会话"，而期望账本
     * 只存 ghostId 不存归属，只能反过来从快照里取坐标。
     *
     * @param {((session:object)=>boolean)|null} pred 会话过滤器，null = 全部
     * @param {(dimid:number, x:number, y:number, z:number, session:object)=>void} cb
     * @returns {number} 回调成功执行的格数
     */
    forEachSessionBlock(pred, cb) {
        let n = 0;
        for (const s of this.sessions.values()) {
            let ok = true;
            if (typeof pred === 'function') {
                try { ok = !!pred(s); } catch (e) { ok = false; }
            }
            if (!ok) continue;
            for (const rec of s.blocks.values()) {
                try { cb(s.dimid, rec.x, rec.y, rec.z, s); n++; } catch (e) { /* 单格异常不影响其余 */ }
            }
        }
        return n;
    }

    has(sessionId) {
        return this.sessions.has(sessionId);
    }

    /**
     * 登记一格的原始状态（同一格只记首次）
     * @param {string} sessionId
     * @param {number} x @param {number} y @param {number} z
     * @param {{type?:string, tileData?:number, data?:number, nbt?:object}|null} prev 原方块；空气也要记（撤销时要把 ghost 变回空气）
     * @returns {boolean} 是否新登记
     */
    record(sessionId, x, y, z, prev) {
        const s = this.sessions.get(sessionId) || this.begin(sessionId, 0);
        const k = posKey(x, y, z);
        if (s.blocks.has(k)) return false;
        const p = prev || {};
        // 防呆：原方块不可能是 ghost。能读到 ghost 说明世界里的上一次投影没撤干净
        // （强退/重启的残留）。把它当"原状态"记下来，撤销时就会把 ghost 写回去 ——
        // 不但消不掉，还会让残留变成"官方认可的原状"。这种情况按空气记。
        let type = p.type || 'minecraft:air';
        let data = Number.isFinite(p.tileData) ? p.tileData : (Number.isFinite(p.data) ? p.data : 0);
        let poisoned = false;
        try {
            if (typeof this.isGhost === 'function' && this.isGhost(type)) {
                type = 'minecraft:air';
                data = 0;
                poisoned = true;
            }
        } catch (e) { /* 判定失败就按原样记 */ }
        s.blocks.set(k, { x, y, z, type, data, nbt: p.nbt || null });
        s.updatedAt = Date.now();
        if (poisoned && !this._poisonWarned) {
            this._poisonWarned = true;
            this._warn('快照读到 ghost 方块（上次投影的残留），已按空气记录；请用 /litematica ghost clean 清理残留');
        }
        return true;
    }

    get(sessionId, x, y, z) {
        const s = this.sessions.get(sessionId);
        return s ? (s.blocks.get(posKey(x, y, z)) || null) : null;
    }

    size(sessionId) {
        const s = this.sessions.get(sessionId);
        return s ? s.blocks.size : 0;
    }

    countAll() {
        let n = 0;
        for (const s of this.sessions.values()) n += s.blocks.size;
        return n;
    }

    /** 落盘（原子写；空会话不落盘，避免留垃圾文件） */
    persist(sessionId) {
        const s = this.sessions.get(sessionId);
        if (!s) return false;
        if (!s.blocks.size) return false;
        try {
            fs.mkdirSync(this.dataDir, { recursive: true });
            // 按 y 从高到低存：还原顺序与文件顺序一致，便于人工核对
            const blocks = [...s.blocks.values()]
                .sort((a, b) => (b.y - a.y) || (a.x - b.x) || (a.z - b.z))
                .map(b => ({ x: b.x, y: b.y, z: b.z, t: b.type, d: b.data, ...(b.nbt ? { nbt: b.nbt } : {}) }));
            const payload = JSON.stringify({
                version: SCHEMA_VERSION,
                sessionId: s.sessionId,
                dimid: s.dimid,
                createdAt: s.createdAt,
                updatedAt: s.updatedAt,
                ...(s.meta ? { meta: s.meta } : {}),
                blocks,
            }, null, 0) + '\n';
            const target = this.fileOf(sessionId);
            const tmp = `${target}.tmp`;
            fs.writeFileSync(tmp, payload, 'utf8');
            fs.renameSync(tmp, target);
            s.persisted = true;
            return true;
        } catch (e) {
            this._warn(`会话 ${sessionId} 落盘失败：${e && e.message ? e.message : e}`);
            return false;
        }
    }

    /**
     * 反向写回（按 y 从高到低）
     *
     * @param {string} sessionId
     * @param {{limit?: number, shouldRestore?: function(number,number,number,number):boolean, onProgress?: function(object):void}} [opts]
     *        limit: 本次最多写多少格（分批用），不传则用 restoreBatch
     *        shouldRestore(dimid, x, y, z): 返回 false 表示"这格现在不该还原"（比如期望集合仍认为
     *        这一格应该有幽灵 = 投影还在正常工作中），该格**保留在快照里**等下次，计 held
     * @returns {{restored:number, skipped:number, failed:number, remaining:number, kept:number, held:number}}
     *          kept = 因"当前是真方块"而永久跳过、并从快照里移除的格数
     *          held = 因 shouldRestore 为假而保留待处理的格数
     */
    revert(sessionId, opts) {
        const o = opts || {};
        const out = { restored: 0, skipped: 0, failed: 0, remaining: 0, kept: 0, held: 0 };
        const s = this.sessions.get(sessionId);
        if (!s) return out;

        const limit = Number.isFinite(o.limit) ? o.limit : this.restoreBatch;
        const list = [...s.blocks.values()].sort((a, b) => (b.y - a.y) || (a.x - b.x) || (a.z - b.z));

        let processed = 0;
        for (const rec of list) {
            if (processed >= limit) break;
            processed++;

            // 规则 0：调用方判定"这格现在不该还原" → 保留，不写、不删
            //         （典型：期望集合仍认这一格，说明投影还在正常工作，重启不该把墙拆掉）
            if (typeof o.shouldRestore === 'function') {
                let allow = true;
                try { allow = !!o.shouldRestore(s.dimid, rec.x, rec.y, rec.z); } catch (e) { allow = true; }
                if (!allow) { out.held++; continue; }
            }

            let cur = null;
            try {
                cur = mc.getBlock(rec.x, rec.y, rec.z, s.dimid);
            } catch (e) {
                cur = null;   // 区块未加载
            }
            // 读不到当前方块（区块未加载）→ 绝不在"状态未知"的格子上盲写，留着下次
            if (!cur) { out.failed++; continue; }
            const curType = cur.type || null;

            // 规则 1：玩家已经放了真方块 → 永久跳过（不覆盖玩家建筑）
            if (curType && !this.isGhost(curType) && !airLike(curType)) {
                s.blocks.delete(posKey(rec.x, rec.y, rec.z));
                out.kept++;
                continue;
            }
            // 规则 2：当前状态与原状态完全一致 → 无需写（含"原空气+现空气"，也含
            //         "当初 setBlock 失败、世界其实没变"的情况，省掉无谓的世界写入）
            if (curType === rec.type && (Number(cur && cur.tileData) || 0) === (rec.data || 0)) {
                s.blocks.delete(posKey(rec.x, rec.y, rec.z));
                out.skipped++;
                continue;
            }

            let ok = false;
            try {
                ok = mc.setBlock(rec.x, rec.y, rec.z, s.dimid, rec.type, rec.data);
            } catch (e) {
                ok = false;
            }
            if (ok) {
                s.blocks.delete(posKey(rec.x, rec.y, rec.z));
                out.restored++;
            } else {
                // 规则 3：写失败留在快照里，下次再试（区块未加载是常态）
                out.failed++;
            }
        }

        out.remaining = s.blocks.size;
        s.updatedAt = Date.now();
        if (typeof o.onProgress === 'function') {
            try { o.onProgress(out); } catch (e) { /* 忽略回调异常 */ }
        }
        return out;
    }

    /**
     * 结束会话：先还原，再删文件
     * @param {{revert?: boolean}} [opts] revert=false 时表示"放弃还原，只清记录"
     */
    close(sessionId, opts) {
        const o = opts || {};
        const s = this.sessions.get(sessionId);
        if (!s) return { restored: 0, skipped: 0, failed: 0, remaining: 0, kept: 0, removed: false };
        let r = { restored: 0, skipped: 0, failed: 0, remaining: s.blocks.size, kept: 0 };
        if (o.revert !== false) {
            r = this.revert(sessionId, { limit: Number.MAX_SAFE_INTEGER });
        }
        // 还有没还原的格（写失败/未 revert）→ 保留文件，别丢现场
        if (r.remaining > 0) {
            this.persist(sessionId);
            return { ...r, removed: false };
        }
        this.sessions.delete(sessionId);
        try {
            const p = this.fileOf(sessionId);
            if (fs.existsSync(p)) fs.rmSync(p, { force: true });
        } catch (e) {
            this._warn(`删除会话文件失败：${e && e.message ? e.message : e}`);
        }
        return { ...r, removed: true };
    }

    /**
     * 启动时处理无主会话（上次异常退出留下的快照）
     * @param {{shouldRestore?: function(number,number,number,number):boolean, limit?: number,
     *          restoreMega?: boolean, skip?: function(object):boolean}} [opts]
     *        restoreMega: true 时，MEGA 会话（meta.mega）**无条件还原**——它的注入状态只活在
     *        内存里，重启后没人能接管，保留下来就是永久残留（玩家连撤销的会话都找不到）
     *        skip: 返回 true 的会话整段不动（比如内存里还有活跃会话在用它）
     * @returns {{sessions:number, restored:number, skipped:number, failed:number, kept:number, held:number, remaining:number, skippedSessions:number}}
     */
    restoreOrphaned(opts) {
        const o = opts || {};
        const total = { sessions: 0, restored: 0, skipped: 0, failed: 0, kept: 0, held: 0, remaining: 0, skippedSessions: 0 };
        for (const sessionId of [...this.sessions.keys()]) {
            const s = this.sessions.get(sessionId);
            if (typeof o.skip === 'function') {
                let skipIt = false;
                try { skipIt = !!o.skip(s); } catch (e) { skipIt = false; }
                if (skipIt) { total.skippedSessions++; continue; }
            }
            // MEGA 会话强制全还原：不传 shouldRestore 等价于"每格都还原"
            const forceMega = o.restoreMega === true && WorldSnapshot.isMegaSession(s);
            const r = this.revert(sessionId, {
                limit: Number.isFinite(o.limit) ? o.limit : Number.MAX_SAFE_INTEGER,
                shouldRestore: forceMega ? null : o.shouldRestore,
            });
            total.sessions++;
            total.restored += r.restored;
            total.skipped += r.skipped;
            total.failed += r.failed;
            total.kept += r.kept;
            total.held += r.held;
            total.remaining += r.remaining;

            if (r.remaining > 0) {
                this.persist(sessionId);      // 留着下次再试（含 held 的格，仍可撤销）
                if (r.failed) this._warn(`会话 ${sessionId} 有 ${r.failed} 格还原失败（区块未加载居多），已保留待重试`);
            } else {
                this.sessions.delete(sessionId);
                try {
                    const p = this.fileOf(sessionId);
                    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
                } catch (e) { /* 忽略 */ }
            }
        }
        // 唯一的一条汇总（调用方不得再打一份）：残留格数只有这里知道，缺了它运维看不出"还没收拾干净"
        if (total.sessions) {
            const rest = total.remaining ? ` / 残留 ${total.remaining}` : '';
            this._info(`无主会话：${total.sessions} 个 / 还原 ${total.restored} 格 / 保留待撤销 ${total.held} 格 / 保留现状 ${total.kept} / 跳过 ${total.skipped} / 失败 ${total.failed}${rest}`);
        }
        if (total.remaining > 0) {
            this._warn(`仍有 ${total.remaining} 格未还原（区块未加载居多），已保留待下次重试`);
        }
        return total;
    }
    /** 按前缀找会话（崩溃后内存里的 xuid→session 映射丢了，用 sessionId 前缀把撤销能力找回来） */
    findSessions(prefix) {
        const out = [];
        for (const s of this.sessions.values()) {
            if (!prefix || s.sessionId.startsWith(prefix)) out.push(s);
        }
        return out;
    }

    stats() {
        return {
            dir: this.dataDir,
            sessions: this.sessions.size,
            blocks: this.countAll(),
            restoreBatch: this.restoreBatch,
            loadError: this.loadError,
            detail: [...this.sessions.values()].map(s => ({ sessionId: s.sessionId, dimid: s.dimid, blocks: s.blocks.size, persisted: s.persisted })),
        };
    }
}

module.exports = { WorldSnapshot, posKey, defaultIsGhost, airLike, DEFAULT_RESTORE_BATCH, SCHEMA_VERSION };
