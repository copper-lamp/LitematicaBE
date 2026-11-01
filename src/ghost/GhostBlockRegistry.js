/**
 * GhostBlockRegistry — ghost 方块与 Java 方块名的解析表（运行时）
 *
 * 设计原则：运行时不推导、不猜名字。所有 javaName -> ghostId 的映射在构建期
 * 由 tools/build_addon.js 用映射表 + 贴图解析规则一次性算好，写进 ghost_index.json，
 * 这里只做 O(1) 查表。
 *
 * 数据来源：plugins/LitematicaBE/data/ghost_index.json
 */

const fs = require('fs');
const path = require('path');

const GENERIC_ID = 'lit:g_generic';
const GHOST_PREFIX = 'lit:g_';

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
        if (id && this.blocks.has(id)) return id;
        return this.genericId;
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
        const id = this.resolve(javaName);
        const meta = this.blocks.get(id);
        const decl = meta && meta.states;
        if (!decl) return null;

        const src = bedrockStates || {};
        const out = {};
        for (const [key, spec] of Object.entries(decl)) {
            let v = spec.default;
            if (spec.from && src[spec.from] !== undefined) {
                v = src[spec.from];
                if (spec.map && spec.map[v] !== undefined) v = spec.map[v];
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
