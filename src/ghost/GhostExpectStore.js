/** GhostExpectStore —  ghost 方块显示的持久化期望集合。 */

const fs = require('fs');
const path = require('path');

const FILE_NAME = 'ghost_expect.json';
const SCHEMA_VERSION = 1;

function keyOf(x, y, z) {
    return `${x},${y},${z}`;
}

class GhostExpectStore {
    /**
     * @param {{dataDir?: string, logger?: object}} [opts]
     */
    constructor(opts) {
        const o = opts || {};
        this.dataDir = o.dataDir || path.join(__dirname, '..', '..', 'data');
        this.filePath = path.join(this.dataDir, FILE_NAME);
        this.logger = o.logger || null;
        /** @type {Map<number, Map<string, string>>} dimid -> ("x,y,z" -> ghostId) */
        this.dims = new Map();
        this.dirty = false;
        this._timer = null;
        this.loadError = null;
    }

    load() {
        try {
            if (!fs.existsSync(this.filePath)) return this;
            const raw = fs.readFileSync(this.filePath, 'utf8');
            const obj = JSON.parse(raw);
            const dims = (obj && obj.dims) || {};
            for (const [dimStr, table] of Object.entries(dims)) {
                const dimid = Number(dimStr);
                if (!Number.isFinite(dimid) || !table || typeof table !== 'object') continue;
                const m = new Map();
                for (const [pos, ghostId] of Object.entries(table)) {
                    if (typeof ghostId === 'string' && ghostId) m.set(pos, ghostId);
                }
                if (m.size) this.dims.set(dimid, m);
            }
            if (this.logger) this.logger.info(`[GhostExpect] 已载入 ${this.count()} 条期望记录（${this.filePath}）`);
        } catch (e) {
            this.loadError = e && e.message ? e.message : String(e);
            // 坏文件不覆盖：改名为 .corrupt，保留现场
            try { fs.renameSync(this.filePath, `${this.filePath}.corrupt`); } catch (e2) { /* 忽略 */ }
            if (this.logger) this.logger.warn(`[GhostExpect] 载入失败：${this.loadError}（已备份为 .corrupt）`);
        }
        return this;
    }

    count() {
        let n = 0;
        for (const m of this.dims.values()) n += m.size;
        return n;
    }

    countDim(dimid) {
        const m = this.dims.get(dimid);
        return m ? m.size : 0;
    }

    set(dimid, x, y, z, ghostId) {
        const d = Number.isFinite(dimid) ? dimid : 0;
        if (!ghostId) return false;
        let m = this.dims.get(d);
        if (!m) { m = new Map(); this.dims.set(d, m); }
        const k = keyOf(x, y, z);
        if (m.get(k) === ghostId) return false;
        m.set(k, ghostId);
        this._touch();
        return true;
    }

    get(dimid, x, y, z) {
        const m = this.dims.get(Number.isFinite(dimid) ? dimid : 0);
        const ghostId = m ? m.get(keyOf(x, y, z)) : null;
        return ghostId ? { ghostId } : null;
    }

    del(dimid, x, y, z) {
        const m = this.dims.get(Number.isFinite(dimid) ? dimid : 0);
        if (!m) return false;
        const ok = m.delete(keyOf(x, y, z));
        if (ok) this._touch();
        return ok;
    }

    /** 遍历某维度（或全部）的期望格：cb(dimid, x, y, z, ghostId) */
    forEach(cb, dimid) {
        const dims = (dimid === undefined || dimid === null) ? [...this.dims.keys()] : [dimid];
        for (const d of dims) {
            const m = this.dims.get(d);
            if (!m) continue;
            for (const [k, ghostId] of m) {
                const [x, y, z] = k.split(',').map(Number);
                cb(d, x, y, z, ghostId);
            }
        }
    }

    /** 合并写：同一 tick 内的多次改动只落盘一次 */
    _touch() {
        this.dirty = true;
        if (this._timer) return;
        this._timer = setTimeout(() => {
            this._timer = null;
            this.flush();
        }, 32);
    }

    flush() {
        if (!this.dirty) return false;
        try {
            fs.mkdirSync(this.dataDir, { recursive: true });
            const dims = {};
            for (const [dimid, m] of this.dims) {
                if (!m.size) continue;
                const table = {};
                for (const [k, ghostId] of m) table[k] = ghostId;
                dims[String(dimid)] = table;
            }
            const payload = JSON.stringify({ version: SCHEMA_VERSION, dims }, null, 0) + '\n';
            const tmp = `${this.filePath}.tmp`;
            fs.writeFileSync(tmp, payload, 'utf8');
            fs.renameSync(tmp, this.filePath);   // 原子替换，避免半截文件
            this.dirty = false;
            return true;
        } catch (e) {
            if (this.logger) this.logger.warn(`[GhostExpect] 落盘失败：${e && e.message ? e.message : e}`);
            return false;
        }
    }

    stats() {
        return { count: this.count(), dims: this.dims.size, file: this.filePath, loadError: this.loadError };
    }
}

module.exports = { GhostExpectStore };
