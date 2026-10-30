/** RenderScheduler — P4.3 统一 tick 调度器 */

const DEFAULT_BUDGET_MS = 8;

class RenderScheduler {
    /**
     * @param {{logger?: object, budgetMs?: number, tickMs?: number}} [opts]
     *        budgetMs：单 tick 允许给周期任务的总耗时（毫秒），默认 8
     *        tickMs：一个逻辑 tick 的时长，仅用于把毫秒换算成 everyTicks，默认 50
     */
    constructor(opts) {
        const o = opts || {};
        this.logger = o.logger || null;
        this.budgetMs = typeof o.budgetMs === 'number' && o.budgetMs > 0 ? o.budgetMs : DEFAULT_BUDGET_MS;
        this.tickMs = typeof o.tickMs === 'number' && o.tickMs > 0 ? o.tickMs : 50;

        this.tasks = new Map();
        this.tickCount = 0;
        this.started = false;
        this.starvedTicks = 0;      // 有任务因预算被顺延的 tick 数
        this.slowTicks = 0;         // 单 tick 总耗时超预算的 tick 数
        this._listenHandle = null;
    }

    /**
     * 注册一个周期任务（同名重复注册会覆盖，方便热重载不留重复监听）。
     *
     * @param {string} name 唯一名字，用于 stats()/enable()
     * @param {Function} fn 任务体
     * @param {{everyTicks?: number, everyMs?: number, priority?: number, enabled?: boolean}} [opts]
     *        everyMs 优先于 everyTicks：按 tickMs 换算并向上取整（最小 1）
     */
    add(name, fn, opts) {
        if (typeof name !== 'string' || !name) throw new Error('任务名必须是非空字符串');
        if (typeof fn !== 'function') throw new Error(`任务 ${name} 的 fn 必须是函数`);
        const o = opts || {};
        let everyTicks = 1;
        if (typeof o.everyMs === 'number' && o.everyMs > 0) {
            everyTicks = Math.max(1, Math.ceil(o.everyMs / this.tickMs));
        } else if (typeof o.everyTicks === 'number' && o.everyTicks > 0) {
            everyTicks = Math.floor(o.everyTicks);
        }

        this.tasks.set(name, {
            name,
            fn,
            everyTicks,
            priority: typeof o.priority === 'number' ? o.priority : 50,
            enabled: o.enabled !== false,
            lastRunTick: -Infinity,
            lastMs: 0,
            totalMs: 0,
            runs: 0,
            errors: 0,
            skipped: 0,
            lastError: null,
        });
        return this;
    }

    remove(name) {
        return this.tasks.delete(name);
    }

    enable(name, on) {
        const t = this.tasks.get(name);
        if (!t) return false;
        t.enabled = on !== false;
        return true;
    }

    has(name) {
        return this.tasks.has(name);
    }

    /** 绑定唯一的 onTick。重复调用只生效一次（防止热重载叠监听）。 */
    start() {
        if (this.started) return false;
        this.started = true;
        this._listenHandle = mc.listen('onTick', () => {
            try {
                this.runTick();
            } catch (e) {
                if (this.logger) this.logger.error(`[Scheduler] tick 异常: ${e && e.message ? e.message : e}`);
            }
        });
        return true;
    }

    /**
     * 走一个 tick。测试直接调这个，不需要真的 onTick。
     * @returns {{ran: number, skipped: number, spentMs: number}}
     */
    runTick() {
        this.tickCount++;
        const due = [];
        for (const task of this.tasks.values()) {
            if (!task.enabled) continue;
            if (this.tickCount - task.lastRunTick < task.everyTicks) continue;
            due.push(task);
        }
        if (due.length === 0) return { ran: 0, skipped: 0, spentMs: 0 };
        due.sort((a, b) => (a.priority - b.priority) || (a.everyTicks - b.everyTicks));

        let spent = 0;
        let ran = 0;
        let skipped = 0;

        for (const task of due) {
            if (spent >= this.budgetMs) {
                task.skipped++;
                skipped++;
                continue;
            }
            task.lastRunTick = this.tickCount;
            const t0 = Date.now();
            try {
                task.fn();
                ran++;
            } catch (e) {
                task.errors++;
                task.lastError = e && e.message ? e.message : String(e);
                if (this.logger) {
                    this.logger.warn(`[Scheduler] 任务 ${task.name} 抛错: ${task.lastError}`);
                }
            }
            const ms = Date.now() - t0;
            task.lastMs = ms;
            task.totalMs += ms;
            task.runs++;
            spent += ms;
        }

        if (skipped > 0) this.starvedTicks++;
        if (spent > this.budgetMs) this.slowTicks++;
        return { ran, skipped, spentMs: spent };
    }

    /** 面板/诊断用：按耗时降序，能直接看出谁在吃 tick */
    stats() {
        const rows = [];
        for (const t of this.tasks.values()) {
            rows.push({
                name: t.name,
                enabled: t.enabled,
                everyTicks: t.everyTicks,
                everyMs: t.everyTicks * this.tickMs,
                priority: t.priority,
                runs: t.runs,
                errors: t.errors,
                skipped: t.skipped,
                lastMs: t.lastMs,
                avgMs: t.runs ? +(t.totalMs / t.runs).toFixed(3) : 0,
                lastError: t.lastError,
            });
        }
        rows.sort((a, b) => b.avgMs - a.avgMs);
        return {
            tickCount: this.tickCount,
            taskCount: this.tasks.size,
            budgetMs: this.budgetMs,
            starvedTicks: this.starvedTicks,
            slowTicks: this.slowTicks,
            tasks: rows,
        };
    }

    /** 一行摘要，进日志/命令输出 */
    summaryText() {
        const s = this.stats();
        const worst = s.tasks.filter(t => t.avgMs > 0).slice(0, 3)
            .map(t => `${t.name} ${t.avgMs}ms`).join(' / ') || '无';
        return `tick ${s.tickCount} / 任务 ${s.taskCount} / 预算 ${s.budgetMs}ms / 顺延 ${s.starvedTicks} / 最重 ${worst}`;
    }
}

module.exports = { RenderScheduler };
