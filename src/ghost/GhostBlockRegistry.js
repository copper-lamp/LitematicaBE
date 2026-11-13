/**
 * GhostBlockRegistry — ghost 方块与 Java 方块名的解析表（运行时）
 *
 * 设计原则：运行时不推导、不猜名字。所有 javaName -> ghostId 的映射在构建期
 * 由构建期（tools/build-release.mjs 校验）用映射表 + 贴图解析规则一次性算好，写进 ghost_index.json，
 * 这里只做 O(1) 查表。
 *
 * 数据来源：plugins/LitematicaBE/data/ghost_index.json
 */

const fs = require('fs');
const path = require('path');

const { JAVA_TO_PISTON_FACING, isPistonName } = require('../mappings/PistonFacing');
const { bedrockToJava } = require('../mappings/BlockMappingRegistry');

const GENERIC_ID = 'lit:g_generic';
const GHOST_PREFIX = 'lit:g_';

/** 状态值 → 分派表键：1/0/true/false/'1'/'0' 统一成 '1'/'0'，其余取字符串 */
function normalizeStateKey(raw) {
    if (raw === true || raw === 1 || raw === '1' || raw === 'true') return '1';
    if (raw === false || raw === 0 || raw === '0' || raw === 'false') return '0';
    return String(raw);
}

/** Java facing 字符串 → 基岩 facing_direction（0=down 1=up 2=north 3=south 4=west 5=east） */
const JAVA_FACING_TO_BE = { down: 0, up: 1, north: 2, south: 3, west: 4, east: 5 };

/**
 * 给分派键补别名：分派表按 `extended_bit` / `facing_direction` 走，但投影里的状态可能
 * 是 Java 风格（`extended: 'true'`、`facing: 'east'`）—— 例如 MEGA 分块重载后 `bedrockState`
 * 丢失、只剩 `.litematic` 原始 state 的时候。缺哪个键就按同名语义补一个，不改原对象。
 *
 * 不补的后果：活塞六朝向全部落回 `_default`，投影里朝东的活塞会朝上显示。
 *
 * @param {object} states
 * @param {string} [javaName] 方块名；活塞族要用专用语义（2=south 3=north 4=east 5=west）
 */
function withDispatchAliases(states, javaName) {
    if (!states || typeof states !== 'object') return states;
    const needExt = states.extended_bit === undefined && states.extended !== undefined;
    const needFacing = states.facing_direction === undefined
        && (typeof states.facing === 'string' || states.facing !== undefined);
    if (!needExt && !needFacing) return states;

    const out = Object.assign({}, states);
    if (needExt) {
        const v = states.extended;
        out.extended_bit = (v === true || v === 'true' || v === 1 || v === '1') ? 1 : 0;
    }
    if (needFacing) {
        const raw = states.facing;
        // 活塞族的 facing_direction 语义与通用枚举相反，必须走专用表
        const table = isPistonName(javaName) ? JAVA_TO_PISTON_FACING : JAVA_FACING_TO_BE;
        if (typeof raw === 'string') {
            const n = table[raw.toLowerCase()];
            if (n !== undefined) out.facing_direction = n;
        } else if (typeof raw === 'number' && raw >= 0 && raw <= 5) {
            out.facing_direction = raw;
        }
    }
    return out;
}

/** 候选索引路径。*/
function candidatePaths(explicit) {
    const list = [];
    if (explicit) list.push(explicit);
    list.push('./plugins/LitematicaBE/data/ghost_index.json');
    list.push('./data/ghost_index.json');
    try {
        if (typeof __dirname === 'string') {
            list.push(path.join(__dirname, '..', '..', 'data', 'ghost_index.json'));
        }
    } catch (e) { /* 无 __dirname 时跳过 */ }
    return list;
}

class GhostBlockRegistry {
    constructor(indexPath) {
        this.indexPath = indexPath || './plugins/LitematicaBE/data/ghost_index.json';
        this.ready = false;
        this.addonVersion = null;
        this.genericId = GENERIC_ID;
        this.blocks = new Map();      // ghostId -> { texture, geometry }
        this.deferred = new Map();    // ghostId -> { texture, geometry }（形状待做，运行时回落整块）
        this.javaMap = new Map();     // 'minecraft:oak_planks' -> 'lit:g_oak_planks'
        /** 'minecraft:piston' -> Map('extended_bit' -> { '0': id, '1': id })
         *  同一 Java 方块按状态选不同 ghost：活塞的 16/16 收缩几何与 12/16 伸出几何是两个方块，
         *  不靠 permutation 切 minecraft:geometry（实机上切不动时投影会一直停在收缩态）。 */
        this.javaMapByState = new Map();
        this.javaMapStats = null;
        this.loadError = null;
        this.load();
    }

    load() {
        this.loadError = null;
        const tried = [];
        let raw = null;

        for (const p of candidatePaths(this.indexPath)) {
            tried.push(p);
            try {
                if (!fs.existsSync(p)) continue;
                raw = JSON.parse(fs.readFileSync(p, 'utf8'));
                this.indexPath = p;
                break;
            } catch (e) {
                this.loadError = `读取 ${p} 失败: ${e.message}`;
            }
        }

        if (!raw) {
            if (!this.loadError) {
                this.loadError = `ghost_index.json 不存在，已尝试: ${tried.join(' | ')}`;
            }
            this._warn(this.loadError);
            return false;
        }

        try {
            this.addonVersion = raw.addonVersion || null;
            this.bpUuid = raw.bpUuid || null;
            this.rpUuid = raw.rpUuid || null;
            this.genericId = raw.genericId || GENERIC_ID;

            this.blocks.clear();
            for (const [id, meta] of Object.entries(raw.blocks || {})) {
                this.blocks.set(id, meta);
            }
            this.deferred.clear();
            for (const [id, meta] of Object.entries(raw.deferred || {})) {
                this.deferred.set(id, meta);
            }
            this.javaMap.clear();
            for (const [java, id] of Object.entries(raw.javaMap || {})) {
                this.javaMap.set(java, id);
            }
            this.javaMapByState.clear();
            for (const [java, byState] of Object.entries(raw.javaMapByState || {})) {
                const parsed = new Map();
                for (const [stateKey, table] of Object.entries(byState || {})) {
                    parsed.set(stateKey, { ...(table || {}) });
                }
                this.javaMapByState.set(java, parsed);
            }
            this.javaMapStats = raw.javaMapStats || null;

            // 兜底块必须真实存在，否则一切回落都会写失败
            if (!this.blocks.has(this.genericId)) {
                this.loadError = `ghost_index 里缺少兜底方块 ${this.genericId}`;
                this._warn(this.loadError);
                this.ready = false;
                return false;
            }

            this.ready = this.blocks.size > 0;
            return this.ready;
        } catch (e) {
            this.loadError = `解析 ghost_index.json 失败: ${e.message}`;
            this._warn(this.loadError);
            this.ready = false;
            return false;
        }
    }

    /**
     * Java 方块名 -> ghost 方块 ID
     * @param {string} javaName 例 'minecraft:oak_planks'
     * @returns {string} 永远返回一个可用 ID（最差是 genericId）
     */
    resolve(javaName) {
        if (!this.ready) return this.genericId;
        if (!javaName) return this.genericId;
        let id = this.javaMap.get(javaName);
        if (!id) {
            // 容许调用方传不带 namespace 的名字
            id = this.javaMap.get(`minecraft:${javaName}`);
        }
        if (!id) {
            // .mcstructure 的 block.name 是 BE 名（如 minecraft:slime / minecraft:fence_gate），
            // 而 javaMap 的键是 Java 名（minecraft:slime_block / minecraft:oak_fence_gate）。
            // 这里用 bedrockToJava 反查：BE 名 → Java 名（可能多个）→ 逐一查 javaMap。
            // 覆盖"BE 名 ≠ Java 名"的全部方块，避免落 lit:g_generic 灰色。
            // 例：minecraft:slime → ['minecraft:slime_block'] → 命中 lit:g_slime_block。
            const javaCands = this._javaCandidatesOf(javaName);
            for (const cand of javaCands) {
                const hit = this.javaMap.get(cand);
                if (hit && this.blocks.has(hit)) { id = hit; break; }
            }
        }
        if (id && this.blocks.has(id)) return id;
        return this.genericId;
    }

    /**
     * BE 名 → 可查 javaMap 的 Java 名候选列表（去重、保持顺序）。
     * 用 bedrockToJava 反查表；找不到时返回空数组。
     */
    _javaCandidatesOf(beName) {
        if (!beName || typeof beName !== 'string') return [];
        // 去命名空间：bedrockToJava 的键是无前缀短名（'slime'/'fence_gate'）
        let short = beName;
        const ci = short.indexOf(':');
        if (ci >= 0) short = short.slice(ci + 1);
        const list = bedrockToJava[short];
        if (!Array.isArray(list) || list.length === 0) return [];
        const out = [];
        for (const j of list) {
            const full = j.startsWith('minecraft:') ? j : `minecraft:${j}`;
            if (!out.includes(full)) out.push(full);
        }
        return out;
    }

    /**
     * Java 方块名 + BE 状态 -> ghost 方块 ID，支持「按状态换方块」。
     *
     * 为什么需要它：活塞伸出与否是两种完全不同的几何（16/16 收回 vs 12/16 伸出），
     * 而且朝向必须体现在模型上。早先靠 permutation 在同一 ghost 方块里切
     * `minecraft:geometry`，实测在 BDS 上不生效（模型首次注册即固定）。
     *
     * 现在改成「状态 → 独立 identifier」的二维查表，缺一级就往上一级回落：
     *   'minecraft:piston': {
     *       extended_bit: { 0: { facing_direction: {0:id0, 1:id1, ...} },
     *                       1: { facing_direction: {...} } } }
     * 例：extended_bit=1、facing_direction=4 → 查到「伸出态 朝西」那个方块。
     *
     * @param {string} javaName  例 'minecraft:piston'
     * @param {object} [bedrockStates] block.bedrockState（.litematic 转换后）或 block.state（.mcstructure）
     */
    resolveWithState(javaName, bedrockStates) {
        if (!this.ready || !javaName) return this.genericId;
        const node = this.javaMapByState.get(javaName)
            || this.javaMapByState.get(`minecraft:${javaName}`);
        if (node && bedrockStates) {
            const hit = this._drillDown(node, withDispatchAliases(bedrockStates, javaName));
            if (hit) return hit;
        }
        return this.resolve(javaName);
    }

    /**
     * 递归走分派表：每层挑一个「状态键 → 值」，值是字符串就是目标方块，是对象就继续往下。
     * 状态键缺失或值非法时用该层的 `_default` 兜底 —— 这样「朝向读到异常值」时仍能保留
     * 上一层（比如 extended_bit）的语义，不至于把伸出态退回成收回态。
     */
    _drillDown(node, states) {
        for (const [stateKey, table] of node) {
            if (stateKey === '_default') continue;
            if (!table || typeof table !== 'object') continue;
            const raw = states[stateKey];
            const key = (raw === undefined || raw === null) ? null : normalizeStateKey(raw);
            let next = key === null ? undefined : table[key];
            if (next === undefined) next = table._default;
            if (next === undefined) continue;
            if (typeof next === 'string') {
                if (this.blocks.has(next)) return next;
                continue;
            }
            const deeper = this._drillDown(new Map(Object.entries(next)), states);
            if (deeper) return deeper;
        }
        return null;
    }

    /**
     * 把 Java/BE 状态收窄成「该 ghost 方块声明的 state 集合」。
     *
     * 为什么必须严格按声明出键：基岩版自定义方块写 states 时，**多写或少写一个键
     * 都会让 setBlock 返回 false**（不抛异常、不忽略），结果 _writeOne 把它推进
     * pending 重试，表现为"静默失败"。因此仅输出声明中包含的键，缺失的补默认值。
     *
     * @param {string} javaName  例 'minecraft:oak_stairs'（或短名 'oak_stairs'）
     * @param {object} [bedrockStates] 已由 javaToBedrock 转换的 BE states（block.bedrockState）
     * @returns {object|null} 归一化 state 对象；该 ghost 无 state 载体时返回 null（走旧路径）
     */
    buildStates(javaName, bedrockStates) {
        if (!this.ready) return null;
        if (!javaName) return null;
        const id = this.resolveWithState ? this.resolveWithState(javaName, bedrockStates) : this.resolve(javaName);
        const meta = this.blocks.get(id);
        const decl = meta && meta.states;
        // 没有声明 states 的 ghost（活塞这类朝向由 identifier 硬编码的）→ 不写 state
        if (!decl) return null;

        const src = bedrockStates || {};
        const out = {};
        for (const [key, spec] of Object.entries(decl)) {
            let v = spec.default;
            // from 取不到时用 fallbackFrom：同一 ghost 要同时吃「Java 状态」和「BE 状态」两套键名
            // （例：piston_head 从 .litematic 来是 facing='up'，从 .mcstructure 来是 facing_direction=1）
            let raw;
            if (spec.from && src[spec.from] !== undefined) raw = src[spec.from];
            else if (spec.fallbackFrom && src[spec.fallbackFrom] !== undefined) raw = src[spec.fallbackFrom];
            if (raw !== undefined) {
                v = (spec.map && spec.map[raw] !== undefined) ? spec.map[raw] : raw;
            }
            if (spec.type === 'int') {
                v = Math.floor(Number(v) || 0);
                if (typeof spec.min === 'number' && v < spec.min) v = spec.min;
                if (typeof spec.max === 'number' && v > spec.max) v = spec.max;
            } else if (spec.type === 'bool') {
                v = !!v;
            } else {
                v = String(v);
            }
            out[key] = v;
        }
        return out;
    }

    /** 是否是本插件写入的 ghost 方块 */
    isGhost(blockType) {
        return typeof blockType === 'string' && blockType.startsWith(GHOST_PREFIX);
    }

    getMeta(ghostId) {
        return this.blocks.get(ghostId) || null;
    }

    get ids() {
        return Array.from(this.blocks.keys());
    }

    stats() {
        return {
            ready: this.ready,
            indexPath: this.indexPath,
            addonVersion: this.addonVersion,
            bpUuid: this.bpUuid,
            rpUuid: this.rpUuid,
            blockCount: this.blocks.size,
            deferredCount: this.deferred.size,
            javaMapCount: this.javaMap.size,
            javaMapStats: this.javaMapStats,
            loadError: this.loadError,
        };
    }

    _warn(msg) {
        try {
            if (typeof logger !== 'undefined' && logger.warn) logger.warn(`[GhostRegistry] ${msg}`);
        } catch (e) { /* logger 不可用时静默 */ }
    }
}

module.exports = { GhostBlockRegistry, GHOST_PREFIX, GENERIC_ID };
