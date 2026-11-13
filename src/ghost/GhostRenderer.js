/** GhostRenderer — ghost 渲染器 */

const { SurfaceExtractor } = require('./SurfaceExtractor');
const { inferPistonExtendedStates } = require('./PistonStateInfer');

const DEFAULT_WRITES_PER_TICK = 300;
const DEFAULT_MAX_BLOCKS = 60000;
const DEFAULT_RETRY_BATCH = 120;
/** 玩家离线后保活多久（毫秒）：超时仍没回来就把 ghost 还给世界，避免无限占内存/世界 */
const DEFAULT_SUSPEND_MAX_AGE_MS = 30 * 60 * 1000;
/** pruneSuspended 的最小执行间隔 */
const PRUNE_INTERVAL_MS = 60 * 1000;

/** 可被投影覆盖的"非方块"障碍（真实放方块时也是 replaceable 语义） */
const REPLACEABLE = new Set([
    'air', 'cave_air', 'void_air', 'structure_void', 'light',
    'water', 'flowing_water', 'lava', 'flowing_lava', 'bubble_column',
    'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern', 'short_dry_grass', 'tall_dry_grass',
    'dead_bush', 'bush', 'firefly_bush', 'leaf_litter', 'wildflowers',
    'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip',
    'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose',
    'torchflower', 'pink_petals', 'spore_blossom', 'sweet_berry_bush',
    'snow', 'snow_layer', 'powder_snow',
    'vine', 'glow_lichen', 'hanging_roots', 'sculk_vein', 'moss_carpet',
    'sugar_cane', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass', 'sea_pickle', 'lily_pad',
    'fire', 'soul_fire', 'torch', 'wall_torch', 'soul_torch', 'soul_wall_torch', 'redstone_wire', 'tripwire',
    'wheat', 'carrots', 'potatoes', 'beetroots', 'nether_wart', 'torchflower_crop', 'pitcher_crop',
    'pumpkin_stem', 'melon_stem', 'cocoa', 'bamboo_sapling', 'cobweb',
]);

function shortName(x) {
    if (!x || typeof x !== 'string') return '';
    const i = x.indexOf(':');
    return (i >= 0 ? x.slice(i + 1) : x).toLowerCase();
}

/** 投影相对坐标 → 世界坐标（镜像 + 旋转 + 原点平移，唯一实现，别在别处再写一份） */
function transformPosition(pos, projection) {
    let x = pos[0], y = pos[1], z = pos[2];
    const dims = projection.dimensions || { x: 0, y: 0, z: 0 };
    if (projection.mirrorX) x = dims.x - x - 1;
    if (projection.mirrorZ) z = dims.z - z - 1;

    let nx = x, nz = z;
    switch (projection.rotation) {
        case 90: nx = z; nz = dims.x - x - 1; break;
        case 180: nx = dims.x - x - 1; nz = dims.z - z - 1; break;
        case 270: nx = dims.z - z - 1; nz = x; break;
        default: break;
    }
    const origin = projection.position || { x: 0, y: 0, z: 0 };
    return { x: origin.x + nx, y: origin.y + y, z: origin.z + nz };
}

function dimidOf(player) {
    const d = player && player.pos && player.pos.dimid;
    return typeof d === 'number' ? d : 0;
}

/* ============================================================================
 * 会话身份：一个玩家可以同时铺**多个投影**
 * ----------------------------------------------------------------------------
 * 3.0.x 及以前，sessions 的 key 就是 xuid，于是"再加载一个投影"必然挤掉上一个：
 * enqueue 看到已有会话就 clear，玩家永远只能看一份 ghost。
 *
 * 现在 key 升维成 `xuid::projectionId`（不影响同一玩家同一投影"同层续用"），
 * 并额外记 `primarySession: xuid -> sessionKey`，表示"木剑当前控制的那份"。
 *
 * SessionMap 是一层兼容垫片：外部/旧代码仍可以 `sessions.get('P1')` / `has('P1')` /
 * `delete('P1')`，会解析到该玩家的主控会话（没有主控记录时退化为"该玩家第一个会话"）。
 * 遍历（values/keys/forEach/size）拿到的仍是**全部**会话，多投影共享 tick 预算。
 * ========================================================================== */

const SESSION_SEP = '::';

/** 会话键：xuid + 投影 id。projectionId 为空（旧数据/无 id 投影）时为 `xuid::-` */
function sessionKeyOf(xuid, projectionId) {
    const x = (xuid === undefined || xuid === null || xuid === '') ? 'unknown' : String(xuid);
    const p = (projectionId === undefined || projectionId === null || projectionId === '')
        ? '-' : String(projectionId);
    return `${x}${SESSION_SEP}${p}`;
}

/** 投影 id → 稳定的短后缀（sessionId 落在文件名里，只留 [0-9a-z]） */
function shortHash(str) {
    let h = 5381;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
}

class SessionMap extends Map {
    /** @param {{primarySession: Map<string,string>}} owner */
    constructor(owner) {
        super();
        this.owner = owner;
    }

    /** 把"玩家级" key 解析成真实的 sessionKey；真实 key 原样返回 */
    _resolve(k) {
        if (typeof k !== 'string' || k.indexOf(SESSION_SEP) >= 0) return k;
        const primary = this.owner && this.owner.primarySession;
        const sk = primary && primary.get(k);
        if (sk && super.has(sk)) return sk;
        const prefix = k + SESSION_SEP;
        for (const key of super.keys()) {
            if (typeof key === 'string' && key.indexOf(prefix) === 0) return key;
        }
        return k;
    }

    get(k) { return super.get(this._resolve(k)); }
    has(k) { return super.has(this._resolve(k)); }
    delete(k) { return super.delete(this._resolve(k)); }
}

class GhostRenderer {
    /**
     * @param {{registry:object, expectStore?:object, addonCheck?:object, snapshot?:object,
     *          guard?:object, logger?:object, writesPerTick?:number, maxBlocks?:number,
     *          retryBatch?:number, overwriteReplaceable?:boolean,
     *          transparentOccluders?:boolean}} opts
     */
    constructor(opts) {
        const o = opts || {};
        this.registry = o.registry;
        this.expect = o.expectStore || null;
        this.addonCheck = o.addonCheck || null;
        this.snapshot = o.snapshot || null;
        this.guard = o.guard || null;
        this.logger = o.logger || null;

        this.extractor = new SurfaceExtractor({ transparentOccluders: o.transparentOccluders });

        this.writesPerTick = Number.isFinite(o.writesPerTick) && o.writesPerTick > 0
            ? Math.floor(o.writesPerTick) : DEFAULT_WRITES_PER_TICK;
        this.maxBlocks = Number.isFinite(o.maxBlocks) && o.maxBlocks > 0
            ? Math.floor(o.maxBlocks) : DEFAULT_MAX_BLOCKS;
        this.retryBatch = Number.isFinite(o.retryBatch) && o.retryBatch > 0
            ? Math.floor(o.retryBatch) : DEFAULT_RETRY_BATCH;
        /** 是否允许覆盖花草/水/雪这类"可替换"方块（玩家建筑永远不覆盖） */
        this.overwriteReplaceable = o.overwriteReplaceable !== false;

        /**
         * @type {SessionMap} `xuid::projectionId` -> session（同一玩家可有多份）
         * 兼容读取：`sessions.get(xuid)` 解析到该玩家的主控会话。
         */
        this.primarySession = new Map();   // xuid -> sessionKey（木剑控制的那份）
        this.sessions = new SessionMap(this);
        /**
         * "被真实方块挡住"的格索引：`dim:x,y,z` -> { xuid, dimid, entry }
         * 用途：玩家挖掉那格时 O(1) 命中，立刻补 ghost（事件驱动，不用等轮转）
         * @type {Map<string, {xuid:string, dimid:number, entry:object}>}
         */
        this.blockedIndex = new Map();

        this.stats = {
            projections: 0,     // 建过的投影会话数
            queued: 0,          // 累计入队格数
            placed: 0,          // 累计写入格数
            skippedGhost: 0,    // 已是 ghost，省写
            protectedCells: 0,  // 被真实方块挡住（进 blocked 队列等待补写）
            pendingCount: 0,    // 当前待重试格数
            blockedCount: 0,    // 当前被真实方块挡住的格数
            blockedPlaced: 0,   // 挖掉原方块后补写成功的格数
            failed: 0,          // setBlock 失败次数
            reverted: 0,        // 累计还原格数
            layerSwitches: 0,
            emptySessions: 0,   // 外壳提取后为 0 的投影（全是空气/内部）
        };
    }

    _log(level, msg) {
        if (!this.logger) return;
        const fn = this.logger[level];
        if (typeof fn === 'function') fn.call(this.logger, msg);
    }

    /** 写入总闸：addon 版本不一致时一行代码关死所有写世界入口 */
    writesAllowed() {
        if (this.addonCheck && typeof this.addonCheck.isEnabled === 'function') {
            return !!this.addonCheck.isEnabled();
        }
        if (this.guard && this.guard.writesEnabled === false) return false;
        return true;
    }

    _newSessionId(xuid, dimid, projectionId) {
        const safe = String(xuid || 'unknown').replace(/[^0-9a-zA-Z]/g, '').slice(0, 12) || 'unknown';
        // 同一玩家可能同时开多份会话：光靠毫秒时间戳会撞名（快照文件名相同 → 互相覆盖）。
        // 加投影短哈希保证唯一；前缀 `proj-<xuid>-` 不变，reclaimOrphans 仍能按玩家找孤儿。
        const tail = projectionId ? `-${shortHash(projectionId)}` : '';
        return `proj-${safe}-${dimid}-${Date.now()}${tail}`;
    }

    /** 记下"木剑当前控制的那份会话"（同一玩家多投影时，会话级 API 默认作用在它上面） */
    _setPrimary(xuid, sessionKey) {
        if (!xuid || !sessionKey) return;
        this.primarySession.set(String(xuid), sessionKey);
    }

    /** 会话键（供外部按投影定位，别自己拼字符串） */
    keyOf(xuid, projectionId) {
        return sessionKeyOf(xuid, projectionId);
    }

    /** 该玩家的全部会话（多投影），按建会话的先后 */
    sessionsOfPlayer(xuid) {
        const x = (xuid === undefined || xuid === null) ? '' : String(xuid);
        if (!x) return [];
        const prefix = x + SESSION_SEP;
        const out = [];
        for (const [key, s] of this.sessions) {
            if (typeof key === 'string' && key.indexOf(prefix) === 0) out.push(s);
        }
        return out;
    }

    /** 精确定位某个投影的会话（projectionId 省略时退化为该玩家的主控会话） */
    getSessionOf(player, projectionId) {
        const xuid = player && player.xuid ? player.xuid : player;
        if (projectionId === undefined || projectionId === null || projectionId === '') {
            return this.sessions.get(xuid) || null;
        }
        return this.sessions.get(sessionKeyOf(xuid, projectionId)) || null;
    }

    _isReplaceableBlock(block) {        if (!this.overwriteReplaceable) return false;
        const n = shortName(block && (block.type || block.name));
        if (!n) return true;
        if (REPLACEABLE.has(n)) return true;
        return n.endsWith('_sapling') || n.endsWith('_propagule') || n.endsWith('_carpet');
    }

    /**
     * 建会话：提取外壳 → 解析 ghost id → 登记快照 → 排队
     *
     * @param {object} player
     * @param {object} projection
     * @param {{layer?: number, silent?: boolean}} [opts]
     * @returns {{ok:boolean, count?:number, reason?:string, stats?:object}}
     */
    enqueue(player, projection, opts) {
        const o = opts || {};
        if (!player || !player.xuid) return { ok: false, reason: 'no-player' };
        if (!projection) return { ok: false, reason: 'no-projection' };
        if (!this.registry || !this.registry.ready) {
            return { ok: false, reason: 'registry' };
        }
        if (!this.writesAllowed()) return { ok: false, reason: 'writegate' };

        const dimid = dimidOf(player);
        const layer = (typeof o.layer === 'number') ? o.layer : -1;
        const projectionId = projection.id || null;
        const sessionKey = sessionKeyOf(player.xuid, projectionId);
        // keepOthers=true → 保留该玩家**其他投影**的会话（多投影并存）。
        // 缺省仍沿用旧语义：同一玩家换投影时先撤干净的，避免老数据和调用方混账。
        const keepOthers = o.keepOthers === true;

        // 已有会话时分两种处理：
        //   同一投影 + 同一层 → 直接续用（重进游戏、重复点"加载"都不该把整面墙撤了重写）
        //   同一投影换了层   → 先撤这一份再建（同一个投影的两层不能共存于一个会话）
        const prev = this.sessions.get(sessionKey);
        if (!keepOthers) {
            // 旧语义：该玩家的其它投影一并撤掉（新放置的投影取代旧投影）
            for (const s of this.sessionsOfPlayer(player.xuid)) {
                if (s !== prev) this._clearOne(s, { silent: true });
            }
        }
        if (prev) {
            const sameProj = !!projectionId && prev.projectionId === projectionId;
            const sameLayer = prev.layer === layer;
            if (sameProj && sameLayer) {
                prev.projection = projection;                       // 位置/旋转可能被重新设置过
                prev.playerName = player.name || prev.playerName;
                this._setPrimary(player.xuid, prev.key);
                if (prev.state === 'suspended') this.resume(player);
                return {
                    ok: true,
                    count: prev.queue.length,
                    resumed: true,
                    unchanged: prev.state === 'done' && prev.pending.length === 0 && prev.blocked.length === 0,
                    stats: { input: prev.queue.length, culled: 0 },
                };
            }
            this._clearOne(prev, { silent: true });
        }

        // deferBlocks=true：MEGA 投影的方块在 .mcmega 分块里，由 MegaProjectionRenderer
        // 分 tick 用 appendBlocks() 增量注入，这里只建一个空队列的会话。
        let blocks = [];
        let stats = { input: 0, culled: 0, kept: 0, deferred: o.deferBlocks === true };
        if (o.deferBlocks !== true) {
            const ex = this.extractor.extract(projection, { layerFilter: layer });
            blocks = ex.blocks;
            stats = ex.stats;
            // .mcstructure 的伸出活塞本体只带 facing_direction（没有 extended_bit），
            // "已伸出"由前方那格的活塞头方块体现 —— 不补这一步就会一律按收缩态建模
            try { stats.pistonExtended = inferPistonExtendedStates(blocks); } catch (e) { /* 推断失败不影响渲染 */ }
            if (stats.input === 0) {
                return { ok: false, reason: 'empty', stats };
            }
            if (blocks.length > this.maxBlocks) {
                return { ok: false, reason: 'too-many', count: blocks.length, stats };
            }
            if (blocks.length === 0) {
                this.stats.emptySessions++;
                return { ok: false, reason: 'empty-surface', stats };
            }
        }

        const queue = new Array(blocks.length);
        for (let i = 0; i < blocks.length; i++) {
            const b = blocks[i];
            const p = b.pos;
            const rel = Array.isArray(p) ? p : [p.x, p.y, p.z];
            const w = transformPosition(rel, projection);
            queue[i] = {
                x: w.x, y: w.y, z: w.z,
                gid: (typeof this.registry.resolveWithState === 'function'
            ? this.registry.resolveWithState(b.renderName || b.name || b.type || '', b.bedrockState || b.state)
            : this.registry.resolve(b.renderName || b.name || b.type || '')),
                st: (typeof this.registry.buildStates === 'function')
                    ? this.registry.buildStates(b.renderName || b.name || b.type || '', b.bedrockState || b.state)
                    : undefined,
            };
        }

        const sessionId = this._newSessionId(player.xuid, dimid, projectionId);
        let snapOk = false;
        if (this.snapshot) {
            try {
                // deferBlocks = MEGA：给它打上 mega 标记，快照落盘后重启时可以据此判定
                // "这堆 ghost 没人能接管"（MegaProjectionRenderer 的注入状态是纯内存的），
                // 启动时无条件还原，避免永久残留。
                this.snapshot.begin(sessionId, dimid, o.deferBlocks === true ? { mega: true } : null);
                snapOk = true;
            } catch (e) {
                this._log('warn', `[GhostRenderer] 快照初始化失败，本次投影无法撤销: ${e && e.message ? e.message : e}`);
            }
        }

        const session = {
            key: sessionKey,
            xuid: player.xuid,
            playerName: player.name || String(player.xuid),
            projectionId: projectionId,
            projection,
            dimid,
            layer,
            sessionId: snapOk ? sessionId : null,
            queue,
            cursor: 0,
            seen: new Set(),   // MEGA 增量注入去重（"x,y,z"），普通会话不填
            pending: [],       // 区块未加载/写失败，等重试
            blocked: [],       // 被真实方块挡住，等玩家挖掉后补写（不可丢，否则地形"吞"投影）
            blockedCursor: 0,  // blocked 轮转游标（上万格时保证每格都能轮到）
            written: [],       // 真正写成功的格（撤销时删期望用）
            counters: { placed: 0, skippedGhost: 0, protected: 0, pending: 0, failed: 0, blockedPlaced: 0 },
            state: 'building',
            startedAt: Date.now(),
            doneAt: null,
            lastError: null,
        };
        this.sessions.set(sessionKey, session);
        this._setPrimary(player.xuid, sessionKey);

        this.stats.projections++;
        this.stats.queued += queue.length;

        if (!o.silent) {
            this._log('info', `[GhostRenderer] 投影 "${projection.name || projection.id}" 入队 ${queue.length} 格`
                + `（输入 ${stats.input}，剔除 ${stats.culled}，层 ${layer < 0 ? '全部' : layer}，维度 ${dimid}）`);
        }
        return { ok: true, count: queue.length, stats };
    }

    /**
     * 消费队列（由统一调度器每 tick 调一次）
     * @param {number} [budget] 本次最多写多少格（默认 writesPerTick，多会话均分）
     * @returns {{written:number, skipped:number, protected:number, pending:number, doneSessions:number}}
     */
    tick(budget) {
        const out = { written: 0, skipped: 0, protected: 0, pending: 0, doneSessions: 0 };
        const active = [];
        for (const s of this.sessions.values()) {
            if (s.state === 'building' && s.cursor < s.queue.length) active.push(s);
        }
        if (active.length === 0) return out;

        const total = Number.isFinite(budget) && budget > 0
            ? Math.floor(budget)
            : this.writesPerTick;
        // 多会话均分，至少每会话 1 格，避免一个玩家的巨型投影把别人饿死
        const perSession = Math.max(1, Math.floor(total / active.length));

        if (!this.writesAllowed()) return out;

        for (const s of active) {
            let n = 0;
            while (n < perSession && s.cursor < s.queue.length) {
                const entry = s.queue[s.cursor++];
                const r = this._writeOne(s, entry);
                n++;
                if (r === 'placed') { out.written++; s.counters.placed++; }
                else if (r === 'skipped') { out.skipped++; s.counters.skippedGhost++; }
                else if (r === 'protected') {
                    // 被原地形挡住：**不能丢**。记进 blocked，等玩家挖掉后补上
                    out.protected++;
                    s.counters.protected++;
                    this._block(s, entry);
                } else { out.pending++; s.counters.pending++; }
            }
            if (s.cursor >= s.queue.length) {
                this._finishSession(s);
                out.doneSessions++;
            }
        }
        this.stats.pendingCount = this._countPending();
        return out;
    }

    /** 记一个"被真实方块挡住"的格（去重：同格重复入队只留一份） */
    _block(s, entry) {
        const k = `${s.dimid}:${entry.x},${entry.y},${entry.z}`;
        if (this.blockedIndex.has(k)) return;
        s.blocked.push(entry);
        // 记 sessionKey：同一玩家多投影时，光靠 xuid 定位不到是哪一份会话
        this.blockedIndex.set(k, {
            xuid: s.xuid,
            projectionId: s.projectionId || null,
            sessionKey: s.key || null,
            dimid: s.dimid,
            entry,
        });
    }

    /** 补写成功/转入 pending 后，从 blocked 移除 */
    _unblock(s, entry) {
        const k = `${s.dimid}:${entry.x},${entry.y},${entry.z}`;
        this.blockedIndex.delete(k);
        const i = s.blocked.indexOf(entry);
        if (i >= 0) s.blocked.splice(i, 1);
    }

    /**
     * 轮转重试"被真实方块挡住"的格（玩家挖掉原方块后补上 ghost）。
     * 每会话最多处理 cap 格，游标轮转，避免上万格 blocked 一次性查爆主线程。
     * @param {number} [limitPerSession]
     * @returns {{checked:number, placed:number, stillBlocked:number, remaining:number}}
     */
    retryBlocked(limitPerSession) {
        const out = { checked: 0, placed: 0, stillBlocked: 0, remaining: 0 };
        const cap = Number.isFinite(limitPerSession) && limitPerSession > 0
            ? Math.floor(limitPerSession) : this.retryBatch;
        if (!this.writesAllowed()) {
            for (const s of this.sessions.values()) out.remaining += s.blocked.length;
            return out;
        }

        for (const s of this.sessions.values()) {
            if (!s.blocked.length) continue;
            // 先拍快照再按游标遍历：
            //  · 处理成功会移除元素，直接按索引遍历会漏格
            //  · 必须轮转，否则上万格 blocked 永远只查最前面那批
            const snapshot = s.blocked.slice();
            const n = snapshot.length;
            const take = Math.min(cap, n);
            const start = (s.blockedCursor || 0) % n;
            for (let i = 0; i < take; i++) {
                const entry = snapshot[(start + i) % n];
                if (!entry || entry._processing) continue;
                entry._processing = true;
                out.checked++;
                const r = this._writeOne(s, entry);
                delete entry._processing;
                if (r === 'placed') {
                    out.placed++;
                    s.counters.placed++;
                    s.counters.blockedPlaced++;
                    this.stats.placed++;
                    this.stats.blockedPlaced++;
                    this._unblock(s, entry);
                } else if (r === 'skipped') {
                    // 已经是 ghost（别处补过），直接销账
                    this._unblock(s, entry);
                } else if (r === 'pending') {
                    // 挪进 pending 队列，由 retryPending 继续兜
                    this._unblock(s, entry);
                } else {
                    out.stillBlocked++;
                }
            }
            // 游标推进（数组长度会因 splice 变化，取模兜住）
            s.blockedCursor = (start + take) % Math.max(1, s.blocked.length);
        }
        for (const s of this.sessions.values()) out.remaining += s.blocked.length;
        this.stats.blockedCount = out.remaining;
        return out;
    }

    /**
     * 定点补写：玩家挖掉某格后立刻补（事件驱动，O(1) 命中索引）。
     * @returns {'placed'|'skipped'|'protected'|'pending'|'none'}
     */
    retryBlockedAt(x, y, z, dimid) {
        if (!this.writesAllowed()) return 'none';
        const k = `${dimid}:${x},${y},${z}`;
        const hit = this.blockedIndex.get(k);
        if (!hit) return 'none';
        const s = this.sessions.get(hit.sessionKey || hit.xuid);
        if (!s) { this.blockedIndex.delete(k); return 'none'; }

        const entry = hit.entry;
        const r = this._writeOne(s, entry);
        if (r === 'placed') {
            s.counters.placed++;
            s.counters.blockedPlaced++;
            this.stats.placed++;
            this.stats.blockedPlaced++;
            this._unblock(s, entry);
        } else if (r === 'skipped' || r === 'pending') {
            this._unblock(s, entry);
        }
        return r;
    }

    /**
     * 该格已经由别人（打印机 / 玩家）填成真方块 → 销掉"待补 / 被挡住"的账。
     *
     * 只销账、不写世界、**不碰 expect**：Litematica 的语义是"挖掉已放好的方块 → ghost
     * 回来提示该补"，所以期望记录要留着；也不碰 written：撤销时 WorldSnapshot.revert
     * 见到"当前不是 ghost 且不是空气"会走 kept，打印机放的方块会被保留。
     *
     * 不做这一步的后果：同一格会一直挂在 blocked 里被 retryBlocked 反复重试（每轮都读一次
     * 世界、判一次 protected），最坏情况下上万格的轮转全被这些无效格吃掉。
     *
     * @returns {boolean} 是否真的销掉了什么
     */
    markSatisfied(xuid, dimid, x, y, z) {
        const d = Number.isFinite(dimid) ? dimid : 0;
        const xs = Math.floor(x), ys = Math.floor(y), zs = Math.floor(z);
        if (!Number.isFinite(xs) || !Number.isFinite(ys) || !Number.isFinite(zs)) return false;

        this.blockedIndex.delete(`${d}:${xs},${ys},${zs}`);

        const targets = this.sessionsOfPlayer(xuid);
        if (!targets.length) {
            const one = this.sessions.get(xuid);
            if (!one) return false;
            targets.push(one);
        }

        let touched = false;
        for (const s of targets) {
            for (let i = s.blocked.length - 1; i >= 0; i--) {
                const e = s.blocked[i];
                if (e.x === xs && e.y === ys && e.z === zs) { s.blocked.splice(i, 1); touched = true; }
            }
            for (let i = s.pending.length - 1; i >= 0; i--) {
                const e = s.pending[i];
                if (e.x === xs && e.y === ys && e.z === zs) { s.pending.splice(i, 1); touched = true; }
            }
        }
        if (touched) {
            this.stats.blockedCount = this._countBlocked();
            this.stats.pendingCount = this._countPending();
        }
        return touched;
    }

    /**
     * 读当前方块的实际 BE states（自定义方块含 lit:* 键）。
     * 失败返回 {}，调用方按"缺键=不同"处理。
     */
    _readGhostStates(cur) {
        try {
            if (cur && typeof cur.getBlockState === 'function') {
                const st = cur.getBlockState();
                return (st && typeof st === 'object') ? st : {};
            }
        } catch (e) { /* 读不到就当无状态 */ }
        return {};
    }

    /**
     * 目标 states 与当前 states 是否一致。
     * 基岩 NBT 里自定义 state 键是 `lit:dir`，但 getBlockState 部分版本会转成 `lit_dir`，
     * 所以同时查冒号/下划线两种写法；当前缺键视为"不同"（需要重写）。
     */
    _statesEqual(curSt, want) {
        if (!curSt || !want) return false;
        for (const k of Object.keys(want)) {
            const alt = k.replace(/:/g, '_');
            let v = curSt[k];
            if (v === undefined && alt !== k) v = curSt[alt];
            if (v === undefined) return false;
            if (String(v) !== String(want[k])) return false;
        }
        return true;
    }

    /**
     * 构造带自定义 states 的 ghost NBT（mc.setBlock 的 blockObject 重载）。
     * NbtCompound 不可用时回落普通对象（与 buildBlockNbt 同策略）。
     */
    _buildGhostNbt(gid, st) {
        if (typeof NbtCompound === 'undefined') {
            return { name: gid, states: st, version: 17959425 };
        }
        const blockNbt = new NbtCompound();
        blockNbt.setString('name', gid);
        const statesNbt = new NbtCompound();
        for (const [k, v] of Object.entries(st)) {
            if (typeof v === 'boolean') statesNbt.setByte(k, v ? 1 : 0);
            else if (typeof v === 'number') statesNbt.setInt(k, v);
            else statesNbt.setString(k, String(v));
        }
        blockNbt.setTag('states', statesNbt);
        blockNbt.setInt('version', 17959425);
        return blockNbt;
    }

    /**
     * 写一格。返回 'placed' | 'skipped' | 'protected' | 'pending'
     */
    _writeOne(s, entry) {
        let cur = null;
        try {
            cur = mc.getBlock(entry.x, entry.y, entry.z, s.dimid);
        } catch (e) {
            cur = null;
        }
        // 区块没加载：读不到当前状态，绝不盲写（盲写等于"不可撤销的污染"）
        if (!cur) {
            s.pending.push(entry);
            return 'pending';
        }

        const curType = cur.type || cur.name || '';
        const isGhost = this.guard && typeof this.guard.isGhostBlock === 'function'
            ? this.guard.isGhostBlock(cur)
            : (this.registry.isGhost(curType));

        // 已经是 ghost：仅当「无朝向状态 或 状态与目标一致」才跳过；状态不一致必须重写
        // （楼梯等形状方块换个朝向，同一格必须重写，否则永远停在旧朝向）
        if (isGhost) {
            // 目标方块 ID 也可能变（例如墙挂火把从「站立火把 ghost」改到「斜插火把 ghost」）。
            // 只比对 states 会把"换了模型但 state 相同"误判为无需重写，画面永远停在旧方块上。
            const sameType = !entry.gid || curType === entry.gid;
            const needSt = entry.st && Object.keys(entry.st).length > 0;
            if (sameType && (!needSt || this._statesEqual(this._readGhostStates(cur), entry.st))) return 'skipped';
            // 状态不一致 → 继续往下重写，但**不重复记快照**（首次写入已记过真原方块）
        }

        const airLike = this.guard && typeof this.guard.isAirLike === 'function'
            ? this.guard.isAirLike(cur)
            : !curType;
        if (!airLike && !this._isReplaceableBlock(cur)) {
            // 玩家建筑：永久跳过，绝不覆盖
            return 'protected';
        }

        // 先备再写：写成功却漏记 = 永久丢原方块。仅「真方块 → ghost 首次写入」记录；
        // ghost 重写（朝向变了）不重复记录，否则撤销会把真原方块还原成 ghost。
        if (!isGhost && this.snapshot && s.sessionId) {
            try {
                this.snapshot.record(s.sessionId, entry.x, entry.y, entry.z, {
                    type: curType || 'minecraft:air',
                    tileData: typeof cur.tileData === 'number' ? cur.tileData : 0,
                });
            } catch (e) {
                // 快照登记失败也不能写：宁可这一格不显示，也不能留下不可撤销的方块
                s.lastError = `snapshot: ${e && e.message ? e.message : e}`;
                s.pending.push(entry);
                return 'pending';
            }
        }

        let ok = false;
        try {
            if (entry.st && Object.keys(entry.st).length > 0) {
                ok = !!mc.setBlock(entry.x, entry.y, entry.z, s.dimid, this._buildGhostNbt(entry.gid, entry.st));
            } else {
                ok = !!mc.setBlock(entry.x, entry.y, entry.z, s.dimid, entry.gid, 0);
            }
        } catch (e) {
            ok = false;
        }
        if (!ok) {
            this.stats.failed++;
            s.pending.push(entry);
            return 'pending';
        }

        this.stats.placed++;
        s.written.push(entry);
        if (this.expect) {
            try { this.expect.set(s.dimid, entry.x, entry.y, entry.z, entry.gid); } catch (e) { /* 期望落盘失败不影响显示 */ }
        }
        return 'placed';
    }

    _finishSession(s) {
        s.state = 'done';
        s.doneAt = Date.now();
        if (this.snapshot && s.sessionId) {
            try { this.snapshot.persist(s.sessionId); } catch (e) { /* 下 tick 还会 persist */ }
        }
        const c = s.counters;
        const secs = ((s.doneAt - s.startedAt) / 1000).toFixed(2);
        this._log('info', `[GhostRenderer] "${s.projection && s.projection.name}" 铺设完成 | 写入 ${c.placed}`
            + ` / 已是ghost ${c.skippedGhost} / 被真实方块挡住 ${s.blocked.length}`
            + ` / 待重试 ${s.pending.length} | ${secs}s`
            + (s.lastError ? ` | 最后错误 ${s.lastError}` : ''));
        if (this.expect) {
            try {
                const pl = mc.getPlayer(s.xuid);
                if (pl) {
                    const parts = [];
                    if (s.pending.length) parts.push(`§7${s.pending.length} 格待补`);
                    if (s.blocked.length) parts.push(`§7${s.blocked.length} 格被原地形挡住（挖掉后自动补上）`);
                    const extra = parts.length ? `（${parts.join('，')}）` : '';
                    const nm = (s.projection && s.projection.name) ? `"${s.projection.name}"` : '投影';
                    pl.tell(`§a${nm}已铺设 §e${c.placed} §a格${extra}`);
                }
            } catch (e) { /* 玩家不在线，无所谓 */ }
        }
    }

    _countPending() {
        let n = 0;
        for (const s of this.sessions.values()) n += s.pending.length;
        return n;
    }

    _countBlocked() {
        let n = 0;
        for (const s of this.sessions.values()) n += s.blocked.length;
        return n;
    }

    /**
     * 重试"区块当时没加载"的格。由调度器每 20 tick 调一次，玩家进服时也立即踢一次。
     * @returns {{retried:number, placed:number, remaining:number}}
     */
    retryPending(limitPerSession) {
        const out = { retried: 0, placed: 0, remaining: 0 };
        // 顺带清理"再也没回来"的保活会话（内部 60s 节流）
        try { this.pruneSuspended(); } catch (e) { /* 清理失败不影响补写 */ }
        if (!this.writesAllowed()) {
            out.remaining = this._countPending();
            return out;
        }
        const cap = Number.isFinite(limitPerSession) && limitPerSession > 0
            ? Math.floor(limitPerSession) : this.retryBatch;

        for (const s of this.sessions.values()) {
            if (!s.pending.length) continue;
            const list = s.pending.splice(0, cap);
            for (const entry of list) {
                out.retried++;
                const r = this._writeOne(s, entry);
                if (r === 'placed') { out.placed++; s.counters.placed++; }
            }
        }
        out.remaining = this._countPending();
        this.stats.pendingCount = out.remaining;

        // 顺带轮转"被真实方块挡住"的格：玩家挖掉原地形后在这里补上 ghost。
        try {
            out.blocked = this.retryBlocked(cap);
        } catch (e) {
            this._log('warn', `[GhostRenderer] blocked 补写异常: ${e && e.message ? e.message : e}`);
        }
        return out;
    }    /**
     * 按层显示（切层时先撤旧层，再铺新层）
     *
     * @param {object} player
     * @param {object} projection
     * @param {number} layer -1 = 全部层
     * @returns {{ok:boolean, count?:number, reverted?:object, reason?:string}}
     */
    setLayer(player, projection, layer) {
        if (!player || !player.xuid) return { ok: false, reason: 'no-player' };
        // 按投影定位：多投影下切层绝不能顺手把别的投影也撤了
        const prev = projection && projection.id
            ? this.sessions.get(sessionKeyOf(player.xuid, projection.id))
            : this.sessions.get(player.xuid);
        if (prev && prev.layer === layer) {
            return { ok: true, count: 0, unchanged: true };
        }
        this.stats.layerSwitches++;
        const reverted = this.clear(player, {
            silent: true,
            projectionId: projection && projection.id ? projection.id : undefined,
        });
        const r = this.enqueue(player, projection, {
            layer: layer === undefined ? -1 : layer,
            keepOthers: true,
        });
        return { ...r, reverted };
    }

    /**
     * 撤销会话：先删期望 → 再按快照还原世界
     *   opts.projectionId  只撤这一个投影（多投影）
     *   opts.sessionKey    直接指定会话键（prune 内部用）
     *   都不给             撤该玩家全部会话（旧语义，单投影时等价）
     * @param {object} player
     * @param {{silent?: boolean, projectionId?: string, sessionKey?: string}} [opts]
     */
    clear(player, opts) {
        const o = opts || {};
        const xuid = player && player.xuid ? player.xuid : player;

        let targets;
        if (o.sessionKey) {
            const one = this.sessions.get(o.sessionKey);
            targets = one ? [one] : [];
        } else if (o.projectionId) {
            const one = this.sessions.get(sessionKeyOf(xuid, o.projectionId));
            targets = one ? [one] : [];
        } else {
            targets = this.sessionsOfPlayer(xuid);
            if (!targets.length) {
                const one = this.sessions.get(xuid);
                if (one) targets = [one];
            }
        }
        if (!targets.length) return { ok: false, removed: 0 };

        const out = { ok: true, removed: 0, restored: 0, remaining: 0, kept: 0, failed: 0 };
        for (const s of targets) {
            const r = this._clearOne(s, o);
            out.removed++;
            out.restored += r.restored;
            out.remaining += r.remaining;
            out.kept += r.kept;
            out.failed += r.failed;
        }
        this.stats.pendingCount = this._countPending();
        this.stats.blockedCount = this._countBlocked();
        return out;
    }

    /**
     * 撤掉**一个**会话（内部实现）。调用方负责决定撤哪些。
     * @returns {{restored:number, remaining:number, kept:number, failed:number}}
     */
    _clearOne(s, opts) {
        const o = opts || {};
        const xuid = s.xuid || (s.player && s.player.xuid);

        // 先删除期望记录：否则还原完成后 GhostGuard 会重新补回 ghost
        if (this.expect) {
            for (const e of s.written) {
                try { this.expect.del(s.dimid, e.x, e.y, e.z); } catch (err) { /* 忽略 */ }
            }
        }

        let restored = 0, remaining = 0, kept = 0, failed = 0;
        if (this.snapshot && s.sessionId && this.snapshot.has(s.sessionId)) {
            try {
                const r = this.snapshot.close(s.sessionId);
                restored = r.restored || 0;
                remaining = r.remaining || 0;
                kept = r.kept || 0;
                failed = r.failed || 0;
            } catch (e) {
                this._log('warn', `[GhostRenderer] 撤销快照失败: ${e && e.message ? e.message : e}`);
            }
        } else {
            // 退化路径：没有快照就按"写过的格写回空气"（保证不残留；玩家建筑已在写时跳过）
            for (let i = s.written.length - 1; i >= 0; i--) {
                const e = s.written[i];
                try {
                    if (mc.setBlock(e.x, e.y, e.z, s.dimid, 'minecraft:air', 0)) restored++;
                    else failed++;
                } catch (err) { failed++; }
            }
        }

        this.stats.reverted += restored;
        // blocked 是尚未写入世界的格，撤销时直接销账即可（不涉及还原）
        for (const e of s.blocked) this.blockedIndex.delete(`${s.dimid}:${e.x},${e.y},${e.z}`);
        s.blocked = [];
        this.sessions.delete(s.key || sessionKeyOf(xuid, s.projectionId));
        if (this.primarySession.get(String(xuid)) === (s.key || null)) {
            this.primarySession.delete(String(xuid));
        }

        if (!o.silent) {
            this._log('info', `[GhostRenderer] 撤销 "${s.projection && s.projection.name}" | 还原 ${restored}`
                + ` / 玩家方块保持 ${kept} / 失败 ${failed} / 剩余 ${remaining}`);
            try {
                const pl = mc.getPlayer(xuid);
                const nm = (s.projection && s.projection.name) ? `"${s.projection.name}"` : '';
                if (pl) {
                    pl.tell(`§a${nm}投影已撤销：还原 §e${restored} §a格` + (kept ? `，§7${kept} 格已被你放的方块占据，保持原样` : ''));
                    if (remaining) pl.tell(`§7还有 ${remaining} 格因区块未加载未还原，已留在快照里，重启或靠近后会再试`);
                }
            } catch (e) { /* 忽略 */ }
        }
        return { restored, remaining, kept, failed };
    }


    /** Mega 注入 / 会话可见集更新：只换未写的队列，已写的不动 */
    updateBlocks(xuid, newBlocks) {
        const s = this.sessions.get(xuid);
        if (!s || !Array.isArray(newBlocks) || newBlocks.length === 0) return 0;
        try { inferPistonExtendedStates(newBlocks); } catch (e) { /* 推断失败不影响渲染 */ }

        const rebuilt = [];
        for (const b of newBlocks) {
            let w;
            if (Array.isArray(b.worldPos) && b.worldPos.length >= 3) {
                w = { x: b.worldPos[0], y: b.worldPos[1], z: b.worldPos[2] };
            } else if (b.pos) {
                const rel = Array.isArray(b.pos) ? b.pos : [b.pos.x, b.pos.y, b.pos.z];
                w = transformPosition(rel, s.projection);
            } else {
                continue;
            }
            rebuilt.push({
                x: w.x, y: w.y, z: w.z,
                gid: (typeof this.registry.resolveWithState === 'function'
            ? this.registry.resolveWithState(b.renderName || b.name || b.type || '', b.bedrockState || b.state)
            : this.registry.resolve(b.renderName || b.name || b.type || '')),
                st: (typeof this.registry.buildStates === 'function')
                    ? this.registry.buildStates(b.renderName || b.name || b.type || '', b.bedrockState || b.state)
                    : undefined,
            });
        }
        if (!rebuilt.length) return 0;

        s.queue = rebuilt;
        s.cursor = 0;
        s.state = 'building';
        s.pending = [];
        // 旧 blocked 索引指向被替换掉的队列，全部作废（新队列会重新判定）
        for (const e of s.blocked) this.blockedIndex.delete(`${s.dimid}:${e.x},${e.y},${e.z}`);
        s.blocked = [];
        this.stats.queued += rebuilt.length;
        return rebuilt.length;
    }

    /**
     * MEGA 增量注入：把分块读出来的方块**追加**到会话队列尾部。
     *
     * 与 updateBlocks 的区别（这是 MEGA 能用的关键）：
     *   - updateBlocks 会整体替换 queue 并把 cursor 归零，世界里已写的格不动 → 换批次就重铺、账本错乱
     *   - appendBlocks 只往尾部追加，不动 cursor、不动已写格，铺设进度可以连续推进
     *
     * @param {string} xuid
     * @param {Array<{pos:number[]|{x:number,y:number,z:number}, name?:string, type?:string}>} blocks
     *        坐标必须是**相对投影原点**的（分块存储就是这个坐标系），内部统一走 transformPosition
     * @returns {{added:number, dup:number, total:number}}
     */
    appendBlocks(xuid, blocks, projectionId) {
        // projectionId 省略 = 该玩家主控会话（旧调用方 / 单投影）
        const s = this.getSessionOf(xuid, projectionId);
        if (!s || !Array.isArray(blocks) || blocks.length === 0) {
            return { added: 0, dup: 0, total: 0 };
        }
        return this._appendTo(s, blocks);
    }

    /** appendBlocks 的实现体：往指定会话尾部追加 */
    _appendTo(s, blocks) {
        const out = { added: 0, dup: 0, total: 0 };
        if (!s.seen) s.seen = new Set();
        // 活塞伸出态推断走「本批可见的邻居」：MEGA 一个 32³ 分块里活塞臂几乎总与本体同块，
        // 只有正好压在分块边界上的极少数会漏判（漏判 = 保持收缩态，不会画错别的方块）。
        try { inferPistonExtendedStates(blocks); } catch (e) { /* 推断失败不影响渲染 */ }

        for (const b of blocks) {
            const p = b && b.pos;
            if (!p) continue;
            const rel = Array.isArray(p) ? p : [p.x, p.y, p.z];
            const w = transformPosition(rel, s.projection);
            const key = `${w.x},${w.y},${w.z}`;
            if (s.seen.has(key)) { out.dup++; continue; }
            s.seen.add(key);
            s.queue.push({
                x: w.x, y: w.y, z: w.z,
                gid: (typeof this.registry.resolveWithState === 'function'
            ? this.registry.resolveWithState(b.renderName || b.name || b.type || '', b.bedrockState || b.state)
            : this.registry.resolve(b.renderName || b.name || b.type || '')),
                st: (typeof this.registry.buildStates === 'function')
                    ? this.registry.buildStates(b.renderName || b.name || b.type || '', b.bedrockState || b.state)
                    : undefined,
            });
            out.added++;
        }

        out.total = s.queue.length;
        // 会话已经判过"铺完"，但 MEGA 每 tick 又塞进新分块 —— 必须复位，
        // 否则 tick 只挑 state==='building' 的会话，后追加的格子永远写不进世界。
        // （实测：5 格仅落地 4 格，且无报错，仅表现为"少一格"）
        if (out.added > 0 && s.state === 'done') {
            s.state = 'building';
            s.doneAt = null;
        }
        this.stats.queued += out.added;
        return out;
    }

    /** 某玩家当前（主控）会话 */
    getSession(player) {
        const xuid = player && player.xuid ? player.xuid : player;
        return this.sessions.get(xuid) || null;
    }

    has(player) {
        return this.sessions.has(player && player.xuid ? player.xuid : player);
    }

    /** 某玩家有没有**这个投影**的会话（多投影判定，别用 has() 代替） */
    hasProjection(player, projectionId) {
        const xuid = player && player.xuid ? player.xuid : player;
        if (projectionId === undefined || projectionId === null || projectionId === '') return this.has(player);
        return this.sessions.has(sessionKeyOf(xuid, projectionId));
    }

    // ==================== 会话保活 ====================

    /**
     * 玩家离线：暂停写入，**不撤销世界 ghost**。同一玩家的所有投影一起暂停。
     * @returns {boolean} 是否有会话被暂停
     */
    suspend(player) {
        const xuid = player && player.xuid ? player.xuid : player;
        const targets = this.sessionsOfPlayer(xuid);
        if (!targets.length) {
            const one = this.sessions.get(xuid);
            if (one) targets.push(one);
        }
        if (!targets.length) return false;
        for (const s of targets) {
            if (s.state === 'suspended') continue;
            s.prevState = s.state;
            s.state = 'suspended';
            s.suspendedAt = Date.now();
            this._log('info', `[GhostRenderer] 会话暂停（玩家离线）"${s.projection && s.projection.name}"`
                + ` | 已写 ${s.written.length} 格 / 待补 ${s.pending.length} 格`);
        }
        return true;
    }

    /**
     * 玩家回来：恢复写入（重进时区块刚加载，pending 会被重试链补上）。
     * @returns {boolean} 是否有会话被恢复
     */
    resume(player) {
        const xuid = player && player.xuid ? player.xuid : player;
        const targets = this.sessionsOfPlayer(xuid);
        if (!targets.length) {
            const one = this.sessions.get(xuid);
            if (one) targets.push(one);
        }
        let resumed = false;
        for (const s of targets) {
            if (s.state !== 'suspended') continue;
            if (player && player.xuid && player.name) s.playerName = player.name;
            const unfinished = s.cursor < s.queue.length || s.pending.length > 0;
            s.state = unfinished ? 'building' : 'done';
            s.suspendedAt = null;
            s.prevState = null;
            resumed = true;
            this._log('info', `[GhostRenderer] 会话恢复"${s.projection && s.projection.name}"`
                + ` | 剩余 ${Math.max(0, s.queue.length - s.cursor)} 格 / 待补 ${s.pending.length} 格`);
        }
        return resumed;
    }

    isSuspended(player) {
        const xuid = player && player.xuid ? player.xuid : player;
        const targets = this.sessionsOfPlayer(xuid);
        if (!targets.length) {
            const one = this.sessions.get(xuid);
            return !!one && one.state === 'suspended';
        }
        return targets.some((s) => s.state === 'suspended');
    }

    /**
     * 清理"玩家再也没回来"的保活会话（默认 30 分钟），把这些 ghost 还给世界。
     * 由调度器的 ghost-retry 顺带调用，内部按 60 秒节流。
     * @param {number} [maxAgeMs]
     * @param {number} [now]
     * @returns {{pruned:number, restored:number}}
     */
    pruneSuspended(maxAgeMs, now) {
        const age = Number.isFinite(maxAgeMs) && maxAgeMs > 0 ? maxAgeMs : DEFAULT_SUSPEND_MAX_AGE_MS;
        const t = Number.isFinite(now) ? now : Date.now();
        const out = { pruned: 0, restored: 0 };
        if (this._lastPrune && t - this._lastPrune < PRUNE_INTERVAL_MS) return out;
        this._lastPrune = t;

        for (const s of [...this.sessions.values()]) {
            if (s.state !== 'suspended' || !s.suspendedAt) continue;
            if (t - s.suspendedAt < age) continue;
            const r = this.clear(s.xuid, { silent: true, sessionKey: s.key });
            out.pruned++;
            out.restored += (r && r.restored) || 0;
            this._log('info', `[GhostRenderer] 保活会话超时（离线 ${Math.round((t - s.suspendedAt) / 60000)} 分钟），已撤销 "${s.projection && s.projection.name}"`);
        }
        return out;
    }

    /** 命令面板 / 诊断 */
    summary() {
        let queued = 0, written = 0, pending = 0, suspended = 0, blocked = 0;
        const sessions = [];
        for (const s of this.sessions.values()) {
            queued += Math.max(0, s.queue.length - s.cursor);
            written += s.counters.placed;
            pending += s.pending.length;
            blocked += s.blocked.length;
            if (s.state === 'suspended') suspended++;
            sessions.push({
                key: s.key,
                xuid: s.xuid,
                projectionId: s.projectionId || null,
                name: s.projection && s.projection.name,
                layer: s.layer,
                state: s.state,
                queued: Math.max(0, s.queue.length - s.cursor),
                placed: s.counters.placed,
                protectedCells: s.counters.protected,
                pending: s.pending.length,
                blocked: s.blocked.length,
                sessionId: s.sessionId,
            });
        }
        return {
            sessions: sessions.length,
            queued,
            written,
            pending,
            blocked,
            suspended,
            counters: { ...this.stats, pendingCount: pending, blockedCount: blocked },
            list: sessions,
        };
    }
}

module.exports = {
    GhostRenderer, transformPosition, shortName, dimidOf, REPLACEABLE,
    // 会话身份相关：snapshot 侧的会话标定（删除投影时按哈希后缀认亲）要用同一套算法
    sessionKeyOf, shortHash,
};
