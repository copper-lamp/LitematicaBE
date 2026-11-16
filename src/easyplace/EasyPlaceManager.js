const { BlockMatcher } = require('./BlockMatcher');
const { PositionConverter } = require('./PositionConverter');
const { InventoryHelper } = require('./InventoryHelper');
const { BlockConversions } = require('./BlockConversions');
const { bidirectionalConverter } = require('../mappings/BidirectionalBlockConverter');
const { SpatialIndexUtils } = require('./SpatialIndexUtils');
const { BlockStateConverters } = require('../mappings/BlockStateConverters');
const { BlockMappingRegistry } = require('../mappings/BlockMappingRegistry');
const { PlacementLogger } = require('./PlacementLogger');
// 依附表（从 easyplace 移植）：只给"火把/红石线/铁轨/按钮/拉杆/双高植物…"判定支撑方向，
// 不碰世界/投影。普通方块查表返回 null，零开销。
const { getAttachedOffsets } = require('./AttachedBlockSupport');
// 世界坐标的唯一实现（镜像 + 旋转 + 原点平移）：打印机不能自己再算一遍，否则投影一转就错位。
// REPLACEABLE 与 ghost 写入共用同一份"可被顶掉"名单（草/雪/水/花…），避免两套口径。
const { transformPosition, shortName, REPLACEABLE } = require('../ghost/GhostRenderer');
const { isMegaProjection } = require('../data/projectionFlags');
// 国际化：t 按玩家语言取翻译，tell 翻译后发聊天栏
const { tell, t } = require('../i18n/I18n');
const fs = require('fs');
const path = require('path');

/** 与 GhostGuard.isAirLike 的兜底口径一致（注入的谓词不可用时才走这里） */
const AIR_LIKE = new Set(['air', 'cave_air', 'void_air', 'structure_void']);

/** 颜色写在方块状态、物品用 Damage 表达颜色的方块（纠错返还时要折一下，否则串色） */
const COLOR_STATE_BLOCKS = new Set(['bed', 'banner', 'wool', 'shulker_box']);

/** Minecraft 16 色的 Damage 顺序（白 0 … 黑 15） */
const COLOR_TO_DAMAGE = {
    white: 0, orange: 1, magenta: 2, light_blue: 3, yellow: 4, lime: 5, pink: 6,
    gray: 7, light_gray: 8, cyan: 9, purple: 10, blue: 11, brown: 12, green: 13, red: 14, black: 15,
};

/** 打印机默认参数（config.easyPlace.printer.* 覆盖） */
const PRINTER_DEFAULTS = {
    radius: 6,
    maxPerCycle: 12,
    budgetMs: 6,
    placeDelayMs: 0,
    overwriteReplaceable: true,
    debug: false,
    // 依附智能打印：先放支撑、再放依附方块（火把/红石线/铁轨/按钮/拉杆/双高植物…）
    supportCheck: true,
    supportMaxDepth: 3,
};

class EasyPlaceManager {
    /** 向后兼容的外部引用；实际默认值以 PRINTER_DEFAULTS.radius（可配置）为准 */
    static SEARCH_RADIUS = PRINTER_DEFAULTS.radius;
    static TICK_INTERVAL = 200;

    constructor(projectionManager, dataManager, megaManager) {
        this.projectionManager = projectionManager;
        this.dataManager = dataManager;
        this.megaManager = megaManager;
        this.blockMatcher = new BlockMatcher();
        this.inventoryHelper = new InventoryHelper();
        this.positionConverter = new PositionConverter();
        // 映射表 / 状态转换器只在构造期建一次：打印机是 200ms 一轮的热路径，
        // 循环里 new 一次 BlockMappingRegistry（1400+ 行表）会直接吃满主线程。
        this.registry = new BlockMappingRegistry();
        this.stateConverter = new BlockStateConverters();
        this.playerStates = new Map();
        this.fastPlaceStates = new Map();
        this.placedLocations = new Map();
        this.tickInterval = null;
        this.debugMode = false;
        this.debugLogPath = './logs/LitematicaBE/easyplace_debug.log';
        this.placementLogger = new PlacementLogger();
        this.logFailures = true;
        /** ghost 判定（attachGhostChecks 注入；未注入时回落到 global.ghostGuard） */
        this.isAirLike = null;
        /** 已提示过"缺材料"的方块名（打印机每 200ms 一轮，不去重会刷屏 + 刷日志） */
        this.missingNotified = new Set();
        /** 已提示过"开着打印机但没有投影"的玩家 */
        this.noProjectionNotified = new Set();
        /** 扣物品失败的方块名 → 解禁时间戳（避免扣不掉还继续白放） */
        this.consumeBlockedUntil = new Map();
        this.lastDebugAt = 0;
        this.printerStats = {
            cycles: 0, checked: 0, placed: 0, free: 0, replaceable: 0,
            blockedTarget: 0, unloaded: 0, banned: 0, missing: 0, failed: 0, layerFiltered: 0,
            pendingSupport: 0,
        };
        this.ensureDebugLogDir();
    }

    /**
     * 装配期注入 ghost 判定（index.js 在 ghostGuard 建好后调一次）。
     * 不注入也能工作：_isAirLike 会回落到 global.ghostGuard，再回落本地集合。
     */
    attachGhostChecks(opts) {
        const o = opts || {};
        if (typeof o.isAirLike === 'function') this.isAirLike = o.isAirLike;
        return this;
    }

    ensureDebugLogDir() {
        try {
            const dir = path.dirname(this.debugLogPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        } catch (e) {
            logger.error(`[EasyPlace] Failed to create debug log directory: ${e.message}`);
        }
    }

    /**
     * 调试日志。注意：打印机是 200ms 一轮的热路径，这里必须
     *   a) 只在 debugMode 打开时才写盘（默认关），
     *   b) 且 5 秒最多一条 —— 否则 appendFileSync 会把主线程拖死。
     */
    logDebug(message, data = null, opts = {}) {
        if (!this.debugMode) return;
        const now = Date.now();
        const force = !!(opts && opts.force);
        if (!force && now - this.lastDebugAt < 5000) return;
        this.lastDebugAt = now;
        try {
            const timestamp = new Date().toISOString();
            let logLine = `[${timestamp}] ${message}`;
            if (data) {
                logLine += ` | DATA: ${JSON.stringify(data)}`;
            }
            logLine += '\n';
            fs.appendFileSync(this.debugLogPath, logLine);
        } catch (e) {
            logger.error(`[EasyPlace] Failed to write debug log: ${e.message}`);
        }
    }

    enable(player) {
        if (!this.easyPlaceAllowed()) {
            tell(player, 'easyplace.disabledCfg');
            return;
        }
        this.playerStates.set(player.xuid, {
            enabled: true,
            correctionEnabled: true,
            placedCount: 0
        });
        tell(player, 'easyplace.enabled');
        tell(player, 'easyplace.enabledHint');
    }

    disable(player) {
        this.playerStates.delete(player.xuid);
        tell(player, 'easyplace.disabled');
    }

    /**
     * 玩家退出：清掉所有按 xuid 攒的状态，并在没人用打印机时停掉 tick 循环。
     *
     * 不清理的后果：离线玩家的 fastPlaceStates 留着 → `tickFastPlace` 每 200ms 仍然遍历
     * 并在 `mc.getOnlinePlayers()` 里找不到他而空转；`noProjectionNotified` 会把
     * "开着打印机却没投影"的提示永久吃掉，玩家重新进服后再也看不到这条提示。
     */
    onPlayerLeave(player) {
        const xuid = player && player.xuid;
        if (!xuid) return;
        this.playerStates.delete(xuid);
        this.fastPlaceStates.delete(xuid);
        this.placedLocations.delete(xuid);
        this.noProjectionNotified.delete(xuid);
        // 提示/冷却的 key 都形如 `${xuid}:方块`（也有 `fail:${xuid}:方块` 这种带前缀的），
        // 只清这个玩家的项，别把别人的一起去掉
        const head = `${xuid}:`;
        const mid = `:${xuid}:`;
        for (const k of Array.from(this.missingNotified)) {
            if (k.startsWith(head) || k.includes(mid)) this.missingNotified.delete(k);
        }
        for (const k of Array.from(this.consumeBlockedUntil.keys())) {
            if (k.startsWith(head) || k.includes(mid)) this.consumeBlockedUntil.delete(k);
        }
        if (this.fastPlaceStates.size === 0 && this.tickInterval) this.stopTickLoop();
    }

    toggle(player) {
        if (this.isEnabled(player)) {
            this.disable(player);
        } else {
            this.enable(player);
        }
    }

    isEnabled(player) {
        return this.playerStates.get(player.xuid)?.enabled || false;
    }

    enableCorrection(player) {
        let s = this.playerStates.get(player.xuid);
        if (!s) s = { enabled: false, correctionEnabled: false, placedCount: 0 };
        s.correctionEnabled = true;
        this.playerStates.set(player.xuid, s);
        tell(player, 'easyplace.corrOn');
    }

    disableCorrection(player) {
        const s = this.playerStates.get(player.xuid);
        if (s) s.correctionEnabled = false;
        tell(player, 'easyplace.corrOff');
    }

    toggleCorrection(player) {
        const s = this.playerStates.get(player.xuid);
        const current = s?.correctionEnabled ?? false;
        if (current) {
            this.disableCorrection(player);
        } else {
            this.enableCorrection(player);
        }
    }

    isCorrectionEnabled(player) {
        const s = this.playerStates.get(player.xuid);
        // 如果玩家启用了轻松放置，默认纠错也启用；兼容旧状态（没有 correctionEnabled 字段时回退到 enabled）
        if (!s) return false;
        return s.correctionEnabled === undefined ? s.enabled : s.correctionEnabled;
    }

    // ==================== 投影打印机 ====================

    /** 实时读配置（不要缓存：改配置不该重启服务器） */
    printerConfig() {
        const cm = (typeof global !== 'undefined') ? global.configManager : null;
        const get = (k, d) => (cm && typeof cm.get === 'function') ? cm.get(`easyPlace.printer.${k}`, d) : d;
        const num = (v, d, min) => (Number.isFinite(v) && v >= min ? v : d);
        const cfg = {
            radius: num(get('radius', PRINTER_DEFAULTS.radius), PRINTER_DEFAULTS.radius, 1),
            maxPerCycle: num(get('maxPerCycle', PRINTER_DEFAULTS.maxPerCycle), PRINTER_DEFAULTS.maxPerCycle, 1),
            budgetMs: num(get('budgetMs', PRINTER_DEFAULTS.budgetMs), PRINTER_DEFAULTS.budgetMs, 1),
            placeDelayMs: num(get('placeDelayMs', PRINTER_DEFAULTS.placeDelayMs), PRINTER_DEFAULTS.placeDelayMs, 0),
            overwriteReplaceable: get('overwriteReplaceable', PRINTER_DEFAULTS.overwriteReplaceable) !== false,
            debug: get('debug', PRINTER_DEFAULTS.debug) === true,
            supportCheck: get('supportCheck', PRINTER_DEFAULTS.supportCheck) !== false,
            supportMaxDepth: num(get('supportMaxDepth', PRINTER_DEFAULTS.supportMaxDepth), PRINTER_DEFAULTS.supportMaxDepth, 1),
        };
        this.debugMode = cfg.debug;
        return cfg;
    }

    /** easyPlace.enabled 总开关（关掉后拒绝开启打印机） */
    easyPlaceAllowed() {
        const cm = (typeof global !== 'undefined') ? global.configManager : null;
        if (!cm || typeof cm.get !== 'function') return true;
        return cm.get('easyPlace.enabled', true) !== false;
    }

    /**
     * 开/关投影打印机（唯一入口：命令、表单、其它模块都走这里）
     * @param {object} player
     * @param {boolean} on
     * @returns {boolean} 操作后是否处于开启态
     */
    setFastPlace(player, on) {
        if (on) {
            if (this.fastPlaceStates.has(player.xuid)) {
                tell(player, 'easyplace.printerOn');
                return true;
            }
            if (!this.easyPlaceAllowed()) {
                tell(player, 'easyplace.printerCfg');
                return false;
            }
            const cfg = this.printerConfig();
            this.fastPlaceStates.set(player.xuid, { enabled: true, placedCount: 0, startedAt: Date.now() });
            this.missingNotified.clear();
            this.consumeBlockedUntil.clear();   // 重新开启 = 重新给一次机会（玩家可能刚补了材料/解开背包锁）
            tell(player, 'easyplace.printerOn2', cfg.radius, cfg.maxPerCycle);
            tell(player, 'easyplace.printerHint');
            if (!this.tickInterval) this.startTickLoop();
            return true;
        }

        this.fastPlaceStates.delete(player.xuid);
        this.placedLocations.delete(player.xuid);
        tell(player, 'easyplace.printerOff');
        if (this.fastPlaceStates.size === 0 && this.tickInterval) this.stopTickLoop();
        return false;
    }

    enableFastPlace(player) { return this.setFastPlace(player, true); }
    disableFastPlace(player) { return this.setFastPlace(player, false); }

    toggleFastPlace(player) {
        return this.setFastPlace(player, !this.isFastPlaceEnabled(player));
    }

    isFastPlaceEnabled(player) {
        return this.fastPlaceStates.get(player.xuid)?.enabled || false;
    }

    /**
     * FastPlace 的单个执行周期。
     * 由统一调度器（global.renderScheduler 的 easyplace-fast 任务）调用；
     * 未启用调度器时由 startTickLoop 以 setInterval 驱动，两侧共用此方法。
     */
    tickFastPlace() {
        if (this.fastPlaceStates.size === 0) return;
        let players = [];
        try {
            players = mc.getOnlinePlayers() || [];
        } catch (e) {
            return;
        }
        for (const player of players) {
            if (!this.isFastPlaceEnabled(player)) continue;
            // 单个玩家异常（区块未加载 / 投影数据坏）不能打断别人的打印机
            try {
                this.processFastPlace(player);
            } catch (e) {
                logger.warn(`[EasyPlace] 打印机处理 ${player.name} 异常: ${e && e.message ? e.message : e}`);
            }
        }
        this.placedLocations.clear();
    }

    startTickLoop() {
        if (this.tickInterval) return;

        // 优先交给统一调度器：全插件只保留一个 onTick
        const sched = (typeof global !== 'undefined') ? global.renderScheduler : null;
        if (sched && sched.has && sched.has('easyplace-fast')) {
            sched.enable('easyplace-fast', true);
            this.tickInterval = 'scheduler';
            logger.info('[EasyPlace] FastPlace tick 已交给统一调度器（200ms）');
            return;
        }

        this.tickInterval = setInterval(() => {
            this.tickFastPlace();
        }, EasyPlaceManager.TICK_INTERVAL);

        logger.info('[EasyPlace] FastPlace tick loop started (setInterval 降级)');
    }

    stopTickLoop() {
        if (!this.tickInterval) return;
        if (this.tickInterval === 'scheduler') {
            const sched = (typeof global !== 'undefined') ? global.renderScheduler : null;
            if (sched && sched.enable) sched.enable('easyplace-fast', false);
            this.tickInterval = null;
            logger.info('[EasyPlace] FastPlace tick 已从调度器摘除');
            return;
        }
        clearInterval(this.tickInterval);
        this.tickInterval = null;
        logger.info('[EasyPlace] FastPlace tick loop stopped');
    }

    // ==================== 打印机：判定与辅助 ====================

    /**
     * 「这一格是不是空的」——打印机的核心判据。
     * ghost 是真实方块（`lit:g_*`），所以**不能**再写 `type !== 'minecraft:air'`：
     * 那会把整个投影判成"非空"，导致打印机无法放置任何一格。
     */
    _isAirLike(block) {
        if (!block) return false;
        if (this.isAirLike) return !!this.isAirLike(block);
        const g = (typeof global !== 'undefined') ? global.ghostGuard : null;
        if (g && typeof g.isAirLike === 'function') return !!g.isAirLike(block);
        const type = block.type || block.name || '';
        if (!type) return true;
        const n = shortName(type);
        if (AIR_LIKE.has(n)) return true;
        const reg = (typeof global !== 'undefined') ? global.ghostRegistry : null;
        return !!(reg && typeof reg.isGhost === 'function' && reg.isGhost(type));
    }

    /**
     * 目标格分类
     *   free        空气 / ghost          → 直接放
     *   replaceable 花草 / 雪 / 水 / 火    → 顶掉再放（与 ghost 写入同一份 REPLACEABLE 名单）
     *   blocked     玩家建筑              → 永不覆盖
     *   unloaded    读不到方块            → 不盲写（区块没加载）
     */
    _printerTarget(block, cfg) {
        if (!block) return 'unloaded';
        const type = block.type || block.name || '';
        if (!type) return 'unloaded';
        if (this._isAirLike(block)) return 'free';
        if (cfg && cfg.overwriteReplaceable && REPLACEABLE.has(shortName(type))) return 'replaceable';
        return 'blocked';
    }

    /**
     * 层号唯一来源：渲染器的会话层 >> projManager 的 renderLayer >> -1。
     * `undefined !== -1` 恒为真，会把所有格判成"层不对"然后一格不放 —— 所以必须归一化。
     */
    _currentLayer(player, activeProj) {
        const r = (typeof global !== 'undefined') ? global.renderer : null;
        const map = r && r.currentRenderLayer;
        if (map && typeof map.get === 'function' && map.has(player.xuid)) {
            const v = map.get(player.xuid);
            if (Number.isFinite(v)) return v;
        }
        const v2 = activeProj && activeProj.renderLayer;
        return Number.isFinite(v2) ? v2 : -1;
    }

    /**
     * 缺料时是否要拦掉这次右键。
     * 只有"手持方块"才拦：玩家在投影范围内喝药水 / 吃食物 / 用工具时，投影不该吞掉右键。
     * LSE 的 Item 有 `isBlock`；宿主缺这个字段（测试桩 / 旧版）时回退旧行为（拦）。
     */
    _shouldBlockUse(item) {
        if (!item) return false;
        if (typeof item.isBlock === 'boolean') return item.isBlock;
        return true;
    }

    /**
     * 缺材料：每个（玩家, 方块名）只提示一次 + 只记一次失败日志（否则每 200ms × 每格刷盘）。
     * key 必须带 xuid：全局去重会让"A 玩家缺石头"把"B 玩家缺石头"的提示一起吃掉。
     */
    _notifyMissing(player, beName, javaName, javaStates, beStates) {
        const key = `${player.xuid}:${beName}`;
        if (this.missingNotified.has(key)) return;
        this.missingNotified.add(key);
        try {
            tell(player, 'easyplace.missing', beName);
        } catch (e) { /* 玩家可能已离线 */ }
        if (this.logFailures) {
            this.placementLogger.logFailure(player.name, javaName, beName, javaStates, beStates, '', `缺少物品: ${beName}`);
        }
    }

    /**
     * 放置成功后与 ghost 账本对账：这一格不再需要"补 ghost"。
     * 期望记录（expect）故意不删 —— 玩家把这块挖掉时 ghost 应该回来（Litematica 的既有语义）。
     */
    _markSatisfied(player, dimid, x, y, z) {
        if (typeof global === 'undefined' || !global) return;
        const gr = global.ghostRenderer;
        if (gr && typeof gr.markSatisfied === 'function') {
            try { gr.markSatisfied(player.xuid, dimid, x, y, z); } catch (e) { /* 账本对账失败不影响已放置的方块 */ }
        }
        const guard = global.ghostGuard;
        if (guard && typeof guard.forget === 'function') {
            try { guard.forget(dimid, x, y, z); } catch (e) { /* 同上 */ }
        }
    }

    /**
     * 投影格 → BE 方块名/状态（打印机与轻松放置共用的一套转换）
     * @returns {{name:string, states:object, javaName:string, javaStates:object}|null}
     */
    _resolveTargetBlock(javaName, javaStates) {
        if (!javaName || javaName === 'minecraft:air') return null;
        const mapping = this.registry.getMapping(javaName);
        const beName = mapping ? mapping.b : javaName;
        const beStates = this.stateConverter.convertJavaToBedrock(javaName, javaStates || {});
        const converted = BlockConversions.convertToValid(beName, beStates);
        if (javaName === 'minecraft:redstone_torch' || javaName === 'minecraft:redstone_wall_torch') {
            if (javaStates && (javaStates.lit === 'false' || javaStates.lit === false)) {
                converted.name = 'unlit_redstone_torch';
            }
        }
        return {
            name: converted.name,
            states: BlockConversions.resetToDefaultStates(converted.states),
            javaName,
            javaStates: javaStates || {},
        };
    }

    /** 放一格并处理物品消耗 / 日志记账（preTarget 可传已解析的 target，避免重复映射） */
    _placeOneFromProjection(player, cand, dimid, isCreative, preTarget = null) {
        const javaName = cand.block.name;
        const javaStates = cand.block.state || {};

        if (BlockConversions.isBanned(javaName, dimid)) return 'banned';
        if (!BlockConversions.isWhitelistedState(javaName, javaStates)) return 'banned';

        const target = preTarget || this._resolveTargetBlock(javaName, javaStates);
        if (!target) return 'skipped';

        let success = false;
        if (isCreative) {
            success = this.fastPlaceBlockAt(cand.w.x, cand.w.y, cand.w.z, dimid, target.name, target.states);
        } else {
            // 上次扣物品失败（背包被其他插件锁定 / 仅剩最后一个却无法清除）→ 进入冷却期，不再空放。
            // 冷却必须按玩家隔离，否则 A 扣不掉会让 B 也放不了同一种方块。
            const blockedKey = `${player.xuid}:${target.name}`;
            const blockedUntil = this.consumeBlockedUntil.get(blockedKey);
            if (blockedUntil && Date.now() < blockedUntil) return 'banned';

            const inventory = player.getInventory();
            const foundSlot = this.inventoryHelper.findBlockInInventory(
                inventory, target.name, -1, target.states
            );
            // 二次确认槽位真的有货：findBlockInInventory 在边界情况下（背包被别的插件改过、
            // 潜影盒取物失败）可能返回一个空槽，只信返回值就会白放。
            let slotItem = null;
            try {
                slotItem = (foundSlot === -1) ? null : inventory.getItem(foundSlot);
            } catch (e) {
                slotItem = null;
            }
            if (foundSlot === -1 || !slotItem || slotItem.isNull() || !(slotItem.count > 0)) {
                this._notifyMissing(player, target.name, javaName, javaStates, target.states);
                return 'missing';
            }
            success = this.fastPlaceBlockAt(cand.w.x, cand.w.y, cand.w.z, dimid, target.name, target.states);
            if (success) {
                // 生存模式：放成功必须真扣掉 1 个。扣不动就停用这个方块 5 秒，
                // 否则背包剩 1 个时会出现"物品不减少、方块一直放"的无限复制。
                const consumed = this.consumeItem(player, target.name, foundSlot, target.states);
                if (!consumed) {
                    const first = !this.consumeBlockedUntil.has(blockedKey);
                    this.consumeBlockedUntil.set(blockedKey, Date.now() + 5000);
                    if (first) {
                        try {
                            tell(player, 'easyplace.consumeBlocked', target.name);
                        } catch (e) { /* 玩家可能已离线 */ }
                        logger.warn(`[EasyPlace] 扣物品失败，暂停放置 ${target.name}`);
                    }
                    this.printerStats.consumeFailed = (this.printerStats.consumeFailed || 0) + 1;
                }
            }
        }

        if (success) {
            this.markAsPlaced(player.xuid, cand.key);
            this._markSatisfied(player, dimid, cand.w.x, cand.w.y, cand.w.z);
            const state = this.fastPlaceStates.get(player.xuid);
            if (state) state.placedCount++;
            if (this.logFailures) this.placementLogger.logSuccess();
            return 'placed';
        }

        // setBlock 失败：同一（玩家, 方块）仅记录一次，避免每轮重复写入日志
        const failKey = `fail:${player.xuid}:${target.name}`;
        if (this.logFailures && !this.missingNotified.has(failKey)) {
            this.missingNotified.add(failKey);
            this.placementLogger.logFailure(
                player.name, javaName, target.name, javaStates, target.states, '', 'setblock失败'
            );
        }
        return 'failed';
    }

    /**
     * 投影内某格的方块定义（普通投影走 blockIndex / 测试桩兜底 blocks；MEGA 走磁盘）。
     * 只用于依附检查取"支撑格应该是什么"，不参与放置。
     */
    _getProjectionBlockDef(projection, rel) {
        if (!projection || !rel) return null;
        const x = rel[0];
        const y = rel[1];
        const z = rel[2];
        const dims = projection.dimensions || {};
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
        if (x < 0 || x >= (dims.x || 0) || y < 0 || y >= (dims.y || 0) || z < 0 || z >= (dims.z || 0)) {
            return null;
        }

        if (isMegaProjection(projection) && projection.schematicId && this.megaManager) {
            try {
                return this.megaManager.getBlockAt(projection.schematicId, x, y, z) || null;
            } catch (e) {
                return null;
            }
        }

        if (projection.blockIndex && typeof projection.blockIndex.get === 'function') {
            const hit = projection.blockIndex.get(`${x},${y},${z}`);
            if (hit) return hit;
            // 索引非空 = 生产投影，查不到就是真没有这一格；空索引（测试桩 / 未建索引）才兜底扫 blocks。
            if (projection.blockIndex.size > 0) return null;
        }

        // 测试桩兜底：没有 blockIndex（或空索引）时线性扫 blocks。
        // 生产环境的普通投影一定带非空 blockIndex（LitematicLoader 构建），不会走这里。
        if (Array.isArray(projection.blocks)) {
            for (const b of projection.blocks) {
                if (!b || !b.pos) continue;
                const p = b.pos;
                const bx = Array.isArray(p) ? p[0] : p.x;
                const by = Array.isArray(p) ? p[1] : p.y;
                const bz = Array.isArray(p) ? p[2] : p.z;
                if (bx === x && by === y && bz === z) return b;
            }
        }
        return null;
    }

    /**
     * 依附网关：若 cand 是依附型方块且某个方向的支撑还没就位，就**先放支撑、本轮跳过自己**。
     *
     * 与 easyplace 的 attached_set_block 等价，但适配本项目的"逐轮调度"：
     *   - 原插件在同一个 tick 里同步递归放支撑；本项目每 200ms 一轮，支撑格放进本轮候选，
     *     依附方块留到下一轮（支撑已在世界 → 网关放行）。
     *   - `supportMaxDepth` 限制依赖链展开深度，防止 A↔B 互相依附或超深链条。
     *
     * @returns {null | {placed: boolean}} null = 正常放自己；对象 = 本轮不放自己（placed 表示是否放下了支撑）
     */
    _handleAttachment(player, cand, projection, dimid, cfg, isCreative, depth = 0) {
        if (!cfg || cfg.supportCheck === false) return null;
        if (!cand || !cand.rel || !cand.block) return null;

        const target = this._resolveTargetBlock(cand.block.name, cand.block.state || {});
        if (!target) return null;
        const attach = getAttachedOffsets(target.name, target.states);
        if (!attach || !attach.offsets) return null;

        let sawValidSupport = false;
        for (const [dx, dy, dz] of attach.offsets) {
            const srel = [cand.rel.x + dx, cand.rel.y + dy, cand.rel.z + dz];
            const supportDef = this._getProjectionBlockDef(projection, srel);
            if (!supportDef || !supportDef.name || supportDef.name === 'minecraft:air') continue;
            // 双高植物：支撑必须是同种方块（下格）
            if (attach.sameAsSelf && shortName(supportDef.name) !== shortName(target.name)) continue;
            sawValidSupport = true;

            // 世界支撑坐标必须走 transformPosition：镜像/旋转下 `cand.w + offset` 会落到错位的格
            const sw = transformPosition(srel, projection);
            let worldSupport = null;
            try {
                worldSupport = mc.getBlock(sw.x, sw.y, sw.z, dimid);
            } catch (e) {
                worldSupport = null;
            }
            const st = worldSupport ? (worldSupport.type || worldSupport.name || '') : '';
            let settled = !!worldSupport && !this._isAirLike(worldSupport) && !REPLACEABLE.has(shortName(st));
            if (attach.sameAsSelf) {
                // 双高植物上格：世界支撑必须是**同种下格**。
                if (!settled) {
                    // 空/ghost/可替换 → 走"先放支撑"分支
                } else {
                    // 已有方块但不是同种 → 不覆盖（那是玩家建筑）；是上格也不算下格
                    if (shortName(st) !== shortName(target.name)) return { placed: false };
                    const ss = this._extractBlockStates(worldSupport) || {};
                    if (ss.upper_block_bit === 1 || ss.upper_block_bit === true) return { placed: false };
                    continue;   // 同种下格已就位
                }
            } else if (settled) {
                continue;   // 普通依附：支撑已有任何方块即视为就位
            }

            if (depth >= cfg.supportMaxDepth) return { placed: false };   // 超深度：本轮跳过

            // 支撑格本身可能也是依附型：递归先处理它
            const supportCand = {
                block: supportDef,
                w: sw,
                rel: { x: srel[0], y: srel[1], z: srel[2] },
                key: `${sw.x},${sw.y},${sw.z}`,
                distSquared: cand.distSquared,
            };
            const sub = this._handleAttachment(player, supportCand, projection, dimid, cfg, isCreative, depth + 1);
            if (sub && sub.placed === false) return { placed: false };

            // 放支撑（支撑自身的依附已由 sub 处理过，这里直接放它自己）
            const supportTarget = this._resolveTargetBlock(supportCand.block.name, supportCand.block.state || {});
            const r = this._placeOneFromProjection(player, supportCand, dimid, isCreative, supportTarget);
            return { placed: r === 'placed' };
        }

        // 双高植物上格在投影里根本找不到同种下格：物理上放不出来（BDS 会立即破坏），
        // 只能永远 pending。普通依附方块（火把/红石线…）投影缺支撑则视为贴投影外地面，直接放。
        if (attach.sameAsSelf && !sawValidSupport) return { placed: false };

        return null;   // 所有方向都就位 / 无有效支撑 → 正常放自己
    }

    /**
     * 打印机的一轮：找半径内的待放格 → 按距离近的先放 → 限速 + 时间预算。
     * 由统一调度器（easyplace-fast，200ms）调用，**不要**自己起定时器。
     */
    processFastPlace(player) {
        const activeProj = this.projectionManager.getActiveProjectionByPlayer(player);
        if (!activeProj || !activeProj.projection) {
            if (!this.noProjectionNotified.has(player.xuid)) {
                this.noProjectionNotified.add(player.xuid);
                try {
                    tell(player, 'easyplace.noProjection');
                } catch (e) { /* 忽略 */ }
            }
            this.logDebug('FASTPLACE_NO_PROJECTION', { player: player.xuid });
            return;
        }
        this.noProjectionNotified.delete(player.xuid);

        const cfg = this.printerConfig();
        const projection = activeProj.projection;
        const layer = this._currentLayer(player, activeProj);
        const playerPos = player.pos || {};
        const dimid = Number.isFinite(playerPos.dimid) ? playerPos.dimid : (parseInt(playerPos.dimid) || 0);

        const centerX = Number(playerPos.x) || 0;
        const centerY = Number(playerPos.y) || 0;
        const centerZ = Number(playerPos.z) || 0;

        // 每轮重置"本轮已放"的记录（跨轮不靠它判重：放成功的格世界已不是空气）
        this.placedLocations.delete(player.xuid);
        this.printerStats.cycles++;

        // 玩家在"投影内相对坐标"里的位置。镜像/旋转/原点必须一起算（与 transformPosition 互逆）：
        // 手算 `center - projPos` 在旋转 90°/镜像后会把中心算到另一条轴上，粗筛就会误杀所有格。
        const relC = this.positionConverter.worldToProjection(
            { x: centerX, y: centerY, z: centerZ }, projection
        );

        // ── 候选集：MEGA 走磁盘分块，普通投影走 16³ 内存索引（都按相对坐标定位分块）──
        let blocksToCheck = [];
        const isMega = isMegaProjection(projection);
        try {
            if (isMega && projection.schematicId && this.megaManager) {
                blocksToCheck = this.megaManager.getBlocksNear(
                    projection.schematicId,
                    relC.x, relC.y, relC.z,
                    cfg.radius + 1
                ) || [];
            } else {
                blocksToCheck = SpatialIndexUtils.getBlocksInRadius(
                    projection, relC.x, relC.y, relC.z, cfg.radius
                ) || [];
            }
        } catch (e) {
            logger.warn(`[EasyPlace] 打印机取投影方块失败: ${e && e.message ? e.message : e}`);
            return;
        }

        const radiusSquared = cfg.radius * cfg.radius;
        // 先用相对坐标做切比雪夫粗筛（旋转/镜像只翻转或交换坐标轴，切比雪夫距离不变），
        // 只有粗筛通过的格才做 transformPosition —— 否则 3 万方块的投影每 200ms
        // 就要构造 3 万个世界坐标对象。
        const relCX = relC.x;
        const relCY = relC.y;
        const relCZ = relC.z;
        const st = {
            checked: blocksToCheck.length, layer: 0, radius: 0, dup: 0,
            free: 0, replaceable: 0, blocked: 0, unloaded: 0,
            placed: 0, missing: 0, banned: 0, failed: 0, pendingSupport: 0,
        };
        const candidates = [];

        for (const block of blocksToCheck) {
            if (!block || !block.pos) continue;
            // pos 可能是数组 [x,y,z]，也可能是对象 {x,y,z}（兼容两种存储格式）
            const p = block.pos;
            const rx = Array.isArray(p) ? p[0] : p.x;
            const ry = Array.isArray(p) ? p[1] : p.y;
            const rz = Array.isArray(p) ? p[2] : p.z;
            if (!Number.isFinite(rx) || !Number.isFinite(ry) || !Number.isFinite(rz)) continue;

            // 层过滤用**投影内相对 y**，与 SurfaceExtractor / setLayer 同一口径
            if (layer !== -1 && ry !== layer) { st.layer++; continue; }

            const drx = rx - relCX, dry = ry - relCY, drz = rz - relCZ;
            // 粗筛用切比雪夫距离：旋转/镜像只是翻转或交换坐标轴，切比雪夫距离不变，
            // 所以这一步不会漏格；只有落进半径立方体的格才需要算世界坐标。
            if (Math.abs(drx) > cfg.radius || Math.abs(dry) > cfg.radius || Math.abs(drz) > cfg.radius) {
                st.radius++;
                continue;
            }

            // 世界坐标唯一实现：镜像 + 旋转 + 原点（自己加 projPos 会在投影旋转后错位）
            const w = transformPosition([rx, ry, rz], projection);
            const dx = w.x - centerX, dy = w.y - centerY, dz = w.z - centerZ;
            const distSquared = dx * dx + dy * dy + dz * dz;
            if (distSquared > radiusSquared) { st.radius++; continue; }

            const key = `${w.x},${w.y},${w.z}`;
            if (this.wasPlacedThisTick(player.xuid, key)) { st.dup++; continue; }
            candidates.push({ block, w, key, distSquared, rel: { x: rx, y: ry, z: rz } });
        }

        candidates.sort((a, b) => a.distSquared - b.distSquared);   // 近的先放：玩家立刻看到效果

        const isCreative = player.gameMode === 1;
        const deadline = Date.now() + cfg.budgetMs;
        let placed = 0;

        for (const cand of candidates) {
            if (placed >= cfg.maxPerCycle) break;
            if (Date.now() > deadline) break;

            let worldBlock = null;
            try {
                worldBlock = mc.getBlock(cand.w.x, cand.w.y, cand.w.z, dimid);
            } catch (e) {
                worldBlock = null;
            }
            const kind = this._printerTarget(worldBlock, cfg);
            if (kind === 'unloaded') { st.unloaded++; continue; }
            if (kind === 'blocked') { st.blocked++; continue; }
            if (kind === 'free') st.free++; else st.replaceable++;

            // 依附智能打印：先放支撑、本轮跳过依附方块（下一轮支撑就位后自然放行）
            const gate = this._handleAttachment(player, cand, projection, dimid, cfg, isCreative);
            if (gate) {
                if (gate.placed) { placed++; st.placed++; }
                st.pendingSupport++;
                continue;
            }

            const r = this._placeOneFromProjection(player, cand, dimid, isCreative);
            if (r === 'placed') { placed++; st.placed++; }
            else if (r === 'missing') st.missing++;
            else if (r === 'banned') st.banned++;
            else if (r === 'failed') st.failed++;

            if (cfg.placeDelayMs > 0 && placed > 0) break;   // 启用放置间隔时每轮仅放一格，避免主线程繁忙等待
        }

        // 累计统计（供调试日志/后续诊断用）
        const ps = this.printerStats;
        ps.checked += st.checked; ps.layerFiltered += st.layer;
        ps.free += st.free; ps.replaceable += st.replaceable;
        ps.blockedTarget += st.blocked; ps.unloaded += st.unloaded;
        ps.placed += st.placed; ps.missing += st.missing;
        ps.banned += st.banned; ps.failed += st.failed;
        ps.pendingSupport = (ps.pendingSupport || 0) + st.pendingSupport;

        if (st.placed || st.checked) {
            this.logDebug('FASTPLACE_SUMMARY', { layer, isMega, radius: cfg.radius, ...st });
        }
    }

    /** 兼容包装：**入参是投影内相对坐标**（见 SpatialIndexUtils.getBlocksInRadius 注释） */
    getBlocksInRadius(projection, relCenterX, relCenterY, relCenterZ, radius) {
        return SpatialIndexUtils.getBlocksInRadius(projection, relCenterX, relCenterY, relCenterZ, radius);
    }

    wasPlacedThisTick(playerXuid, locationKey) {
        return this.placedLocations.get(playerXuid)?.has(locationKey) || false;
    }

    markAsPlaced(playerXuid, locationKey) {
        if (!this.placedLocations.has(playerXuid)) {
            this.placedLocations.set(playerXuid, new Set());
        }
        this.placedLocations.get(playerXuid).add(locationKey);
    }

    handleUseItemOn(player, item, block, side, pos) {
        if (!this.isEnabled(player)) {
            return true;
        }

        const activeProj = this.projectionManager.getActiveProjectionByPlayer(player);
        if (!activeProj || !activeProj.projection) {
            return true;
        }

        if (!block || !block.pos) {
            return true;
        }

        const projection = activeProj.projection;
        const projDim = projection.dimensions;
        const dimid = player.pos?.dimid ?? 0;

        const offsets = [
            { x: 0, y: -1, z: 0 },
            { x: 0, y: 1, z: 0 },
            { x: 0, y: 0, z: -1 },
            { x: 0, y: 0, z: 1 },
            { x: -1, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 }
        ];
        const offset = offsets[side] || offsets[0];

        let placeX = block.pos.x + offset.x;
        let placeY = block.pos.y + offset.y;
        let placeZ = block.pos.z + offset.z;
        const placeDim = block.pos.dimid ?? dimid;

        if (pos && typeof pos.x === 'number') {
            const preciseX = Math.floor(pos.x);
            const preciseY = Math.floor(pos.y);
            const preciseZ = Math.floor(pos.z);
            if (preciseX !== block.pos.x || preciseY !== block.pos.y || preciseZ !== block.pos.z) {
                placeX = preciseX;
                placeY = preciseY;
                placeZ = preciseZ;
            }
        }

        // 世界 → 投影内相对坐标必须走 PositionConverter（旋转/镜像/原点统一反解）。
        // 历史写法 `placeX - projPos.x` 在投影旋转/镜像后取到的是错位的投影格。
        const rel = this.positionConverter.worldToProjection(
            { x: placeX, y: placeY, z: placeZ },
            projection
        );
        const relX = rel.x;
        const relY = rel.y;
        const relZ = rel.z;

        if (relX < 0 || relX >= projDim.x ||
            relY < 0 || relY >= projDim.y ||
            relZ < 0 || relZ >= projDim.z) {
            return true;
        }

        const currentLayer = this._currentLayer(player, activeProj);
        if (currentLayer !== -1 && relY !== currentLayer) {
            return true;
        }

        let projBlock = null;
        
        if (isMegaProjection(projection) && projection.schematicId) {
            // Mega 模式：从磁盘查询方块（使用相对投影坐标，不是世界坐标）
            projBlock = this.megaManager.getBlockAt(projection.schematicId, relX, relY, relZ);
        } else if (projection.blockIndex && typeof projection.blockIndex.get === 'function') {
            // 普通模式：从内存索引查询（非 Map 的 {} 会由 DataManager 恢复时重建成 Map）
            projBlock = projection.blockIndex.get(`${relX},${relY},${relZ}`);
        }

        if (!projBlock) {
            return true;
        }

        let neededBlockType = projBlock.name;
        // rawState = BDS 原始状态键（.mcstructure 的 state 去掉了 `minecraft:` 前缀，
        // 写回世界必须用原始键，否则带前缀状态名会被 BDS 丢弃 —— 观察者方向丢失即此）
        let neededBlockState = projBlock.rawState || projBlock.state || {};

        if (neededBlockType === 'minecraft:air') {
            return true;
        }

        if (BlockConversions.isBanned(neededBlockType, placeDim)) {
            return false;
        }

        const converted = BlockConversions.convertToValid(neededBlockType, neededBlockState);
        neededBlockType = converted.name;
        neededBlockState = BlockConversions.filterDirectionStates(converted.states);

        if (item) {
            const isCorrectBlock = this.blockMatcher.match(item.type, neededBlockType, null, neededBlockState);
            if (isCorrectBlock) {
                return true;
            }
        }

        // 目标格必须是空气 / ghost / 可替换方块才动手：ghost 判据与打印机同口径，
        // 否则"轻松放置"会把玩家自己搭的方块顶掉（setBlock 不带任何保护）。
        let targetBlock = null;
        try {
            targetBlock = mc.getBlock(placeX, placeY, placeZ, placeDim);
        } catch (e) {
            targetBlock = null;
        }
        if (targetBlock) {
            const tt = targetBlock.type || targetBlock.name || '';
            if (!this._isAirLike(targetBlock) && !REPLACEABLE.has(shortName(tt))) {
                return true;   // 玩家建筑：交给玩家自己挖/放，不覆盖
            }
        }

        const isCreative = player.gameMode === 1;

        if (isCreative) {
            const success = this.placeBlockAt(placeX, placeY, placeZ, placeDim, neededBlockType, neededBlockState);
            if (success) {
                return false;
            }
            return true;
        }

        let foundSlot = this.inventoryHelper.findBlockInInventory(
            player.getInventory(),
            neededBlockType,
            -1,
            neededBlockState
        );

        if (foundSlot === -1) {
            const foundInShulker = this.inventoryHelper.findBlockInShulkerBoxes(
                player,
                player.getInventory(),
                neededBlockType,
                neededBlockState
            );

            if (foundInShulker === -1) {
                const totalCount = this.inventoryHelper.countBlock(player, neededBlockType, neededBlockState);
                if (totalCount > 0) {
                    logger.info(`[EasyPlace] 无法从潜隐盒提取: ${neededBlockType}`);
                } else {
                    logger.info(`[EasyPlace] 缺少: ${neededBlockType}`);
                }
                // 只有手持物是方块时才拦截。历史行为一律 `return false`，
                // 导致玩家在投影里喝药水 / 吃食物 / 用桶都会被吞掉这次右键。
                return this._shouldBlockUse(item) ? false : true;
            }

            // 潜影盒取料：findBlockInShulkerBoxes 已经把物品抽到背包槽并返回该槽位，
            // 必须回填给 foundSlot，否则后面的 consumeItem 只能靠"恰好是选中槽"扣到。
            foundSlot = foundInShulker;
        }

        const success = this.placeBlockAt(placeX, placeY, placeZ, placeDim, neededBlockType, neededBlockState);
        if (success) {
            // 手动轻松放置也要真扣物品：扣不掉必须让玩家知道，否则就是在复制材料
            const consumed = this.consumeItem(player, neededBlockType, foundSlot, neededBlockState);
            const consumeKey = `consume:${player.xuid}:${neededBlockType}`;
            if (!consumed && !this.missingNotified.has(consumeKey)) {
                this.missingNotified.add(consumeKey);
                try {
                    tell(player, 'easyplace.easyConsume', neededBlockType);
                } catch (e) { /* 玩家可能已离线 */ }
                logger.warn(`[EasyPlace] 轻松放置扣物品失败: ${neededBlockType}`);
            }
            return false;
        }

        return true;
    }

    /**
     * 在方块放置后检测并修正（onBlockPlaced 事件回调）
     * 比 onUseItemOn 更可靠，能确保正确检测到放置的方块
     */
    correctBlockPlacement(player, block) {
        if (!this.isCorrectionEnabled(player)) return;

        if (!block || !block.pos) {
            return;
        }

        const activeProj = this.projectionManager.getActiveProjectionByPlayer(player);
        if (!activeProj || !activeProj.projection) {
            return;
        }

        const projection = activeProj.projection;
        const projDim = projection.dimensions;

        const blockX = block.pos.x;
        const blockY = block.pos.y;
        const blockZ = block.pos.z;
        const blockDim = block.pos.dimid ?? 0;

        // 世界 → 投影内相对坐标：旋转/镜像必须反解（不能手减 projPos），
        // 否则木剑旋转 90° 后纠错会落到镜像位置、甚至取不到投影块。
        const rel = this.positionConverter.worldToProjection(
            { x: blockX, y: blockY, z: blockZ },
            projection
        );
        if (rel.x < 0 || rel.x >= projDim.x ||
            rel.y < 0 || rel.y >= projDim.y ||
            rel.z < 0 || rel.z >= projDim.z) {
            return;
        }

        // 检查层级限制（层号唯一来源，见 _currentLayer）
        const currentLayer = this._currentLayer(player, activeProj);
        if (currentLayer !== -1 && rel.y !== currentLayer) {
            return;
        }

        let projBlock = null;

        if (isMegaProjection(projection) && projection.schematicId && this.megaManager) {
            // Mega 模式：从磁盘查询方块（使用相对投影坐标）
            projBlock = this.megaManager.getBlockAt(projection.schematicId, rel.x, rel.y, rel.z);
        } else {
            projBlock = (projection.blockIndex && typeof projection.blockIndex.get === 'function')
                ? projection.blockIndex.get(`${rel.x},${rel.y},${rel.z}`)
                : null;
        }

        if (!projBlock) return;

        const neededBlockType = projBlock.name;
        if (!neededBlockType || neededBlockType === 'minecraft:air') return;
        if (BlockConversions.isBanned(neededBlockType, blockDim)) return;

        // 转换方块（rawState = BDS 原始状态键，见上方说明）
        const neededBlockState = projBlock.rawState || projBlock.state || {};
        const converted = BlockConversions.convertToValid(neededBlockType, neededBlockState);
        const finalType = converted.name;
        const finalStates = BlockConversions.filterDirectionStates(converted.states);

        // 检查放置的方块是否正确（优先提取实际方块的状态）
        const actualBlockType = block.type || block.name || '';
        const actualStates = this._extractBlockStates(block);

        const isCorrect = this.blockMatcher.match(actualBlockType, finalType, actualStates, finalStates);

        if (isCorrect) return; // 方块正确，不需要修正

        // 用世界里的真实方块再兜一次：`afterPlaceBlock` 对同一格可能重复触发
        // （快速连点 / 其它插件重放事件），若这一格已经是正确方块就没必要再覆盖、再扣一次料。
        try {
            const worldNow = mc.getBlock(blockX, blockY, blockZ, blockDim);
            if (worldNow) {
                const nowType = worldNow.type || worldNow.name || '';
                if (nowType && this.blockMatcher.match(nowType, finalType, this._extractBlockStates(worldNow), finalStates)) {
                    return;
                }
            }
        } catch (e) { /* 读不到世界方块就继续按事件参数处理 */ }

        // ── 纠错固定"扣料 + 返还"，不做开关 ──
        // 这两条是纠错的底层正确性约束，不是体验选项：
        //   不扣料 = 玩家放块泥土就能免费换投影方块（材料复制）；不返还 = 玩家净损失 2 个物品。
        // 创造模式物品无限，既不扣也不退，直接覆盖。
        const isCreative = player.gameMode === 1;
        if (isCreative) {
            this.placeBlockAt(blockX, blockY, blockZ, blockDim, finalType, finalStates);
            return;
        }

        const cooldownKey = `correction:${player.xuid}:${finalType}`;
        const cooldownUntil = this.consumeBlockedUntil.get(cooldownKey);
        if (cooldownUntil && Date.now() < cooldownUntil) return;

        // 找料：背包 → 潜影盒（与轻松放置同一套口径）。
        // 背包接口在玩家离线 / 其它插件锁定槽位时可能抛错，这里兜住并当作"没材料"处理。
        let slot = -1;
        try {
            slot = this.inventoryHelper.findBlockInInventory(
                player.getInventory(), finalType, -1, finalStates
            );
            if (slot === -1) {
                slot = this.inventoryHelper.findBlockInShulkerBoxes(
                    player, player.getInventory(), finalType, finalStates
                );
            }
        } catch (e) {
            slot = -1;
        }
        if (slot === -1) {
            // 没材料就不纠错（保留玩家自己放的方块），只提示一次
            this._notifyCorrection(
                player,
                `correction-missing:${finalType}`,
                'easyplace.corrNeedMaterial',
                finalType
            );
            return;
        }

        if (!this.placeBlockAt(blockX, blockY, blockZ, blockDim, finalType, finalStates)) return;

        const consumed = this.consumeItem(player, finalType, slot, finalStates);
        if (!consumed) {
            // 扣不掉就别再纠错，否则等于免费出方块（与打印机的反复制口径一致）。
            // 也**不返还**：没付材料就退方块 = 净赚，宁可让玩家看到提示后手动处理。
            this.consumeBlockedUntil.set(cooldownKey, Date.now() + 5000);
            this._notifyCorrection(
                player,
                `correction-consume:${finalType}`,
                'easyplace.corrConsume',
                finalType
            );
            return;
        }

        // 替换完成、材料已扣：把玩家放错的那块还给他。
        // 净变化 = 失去 1 个正确材料、得到 1 个错误方块（世界那格变成投影要求的样子）。
        // 固定执行，不开配置：不退而只扣就是让玩家白亏一个方块。
        this._refundWrongBlock(player, block, actualBlockType);
    }

    /**
     * 把玩家刚放错、已被替换掉的那块方块还原成物品塞回背包。
     *
     * 方块名 ≠ 物品名（`standing_sign` / `lit_furnace` / `wall_sign` 都不是物品），
     * 所以按「方块名 → 可放置物品名 → Java 名」依次试，第一个能 newItem 出来的就是物品形态。
     */
    _refundWrongBlock(player, block, beBlockType) {
        if (!beBlockType) return false;
        const states = this._extractBlockStates(block);

        const item = this._makeRefundItem(beBlockType, states);
        if (!item) {
            this._notifyCorrection(
                player,
                `correction-refund-nf:${beBlockType}`,
                'easyplace.corrRefundNoItem',
                beBlockType
            );
            return false;
        }

        try {
            const ok = player.giveItem(item);
            if (ok !== false) return true;
        } catch (e) { /* 背包接口异常按失败处理 */ }

        this._notifyCorrection(
            player,
            `correction-refund-full:${beBlockType}`,
            'easyplace.corrRefundFull',
            beBlockType
        );
        return false;
    }

    /** 方块名 → 可给玩家的物品对象；失败返回 null */
    _makeRefundItem(beBlockType, states) {
        const names = [];
        const push = (n) => {
            if (n && !names.includes(n)) names.push(n);
        };
        push(beBlockType);
        try { push(BlockConversions.getPlaceableItem(beBlockType)); } catch (e) { /* 映射表缺项 */ }
        try {
            const javas = this.registry.getJavaNames(beBlockType) || [];
            for (const j of javas.slice(0, 3)) push(j);
        } catch (e) { /* 反查失败就只用前两个候选 */ }

        for (const name of names) {
            let item = null;
            try {
                item = mc.newItem(name, 1);
            } catch (e) {
                item = null;
            }
            if (!item) continue;
            this._applyColorDamage(item, beBlockType, states);
            return item;
        }
        return null;
    }

    /**
     * 床 / 旗帜 / 羊毛这类「颜色写在方块状态里、物品用 Damage 表示颜色」的方块，
     * 直接 newItem 会拿到默认白色。把状态里的 color 折成 Damage，返还才不会串色。
     */
    _applyColorDamage(item, beBlockType, states) {
        if (!states || !states.color) return;
        const key = String(beBlockType || '').toLowerCase().replace(/^minecraft:/, '');
        if (!COLOR_STATE_BLOCKS.has(key)) return;
        const dmg = COLOR_TO_DAMAGE[String(states.color).toLowerCase()];
        if (dmg === undefined) return;
        try {
            item.damage = dmg;
        } catch (e) { /* 宿主没有可写 Damage 时保持默认色 */ }
    }

    /** 纠错相关提示节流（复用 missingNotified，按 (玩家, key) 去重） */
    _notifyCorrection(player, key, msgKey, ...args) {
        const k = `${player.xuid}:${key}`;
        if (this.missingNotified.has(k)) return;
        this.missingNotified.add(k);
        try {
            tell(player, msgKey, ...args);
        } catch (e) { /* 玩家可能已离线 */ }
    }

    /**
     * 尝试从事件回调的 block 对象中抽取实际方块状态（兼容多种 LL/LeviLamina API）
     */
    _extractBlockStates(block) {
        try {
            if (!block) return null;
            // 常见 API 尝试顺序
            if (typeof block.getStates === 'function') {
                const s = block.getStates();
                if (s && typeof s === 'object') return s;
            }
            if (block.states && typeof block.states === 'object' && !Array.isArray(block.states)) {
                return block.states;
            }
            if (block.permutation && typeof block.permutation.getStates === 'function') {
                const s = block.permutation.getStates();
                if (s && typeof s === 'object') return s;
            }
            if (block.permutation && block.permutation.states && typeof block.permutation.states === 'object') {
                return block.permutation.states;
            }
            if (typeof block.getState === 'function') {
                // 有些 API 是逐个 getState(key) 获取，这里不做全量遍历
                const allKeys = block.getAllStateKeys ? block.getAllStateKeys() : null;
                if (allKeys && Array.isArray(allKeys)) {
                    const out = {};
                    for (const k of allKeys) out[k] = block.getState(k);
                    return out;
                }
            }
        } catch (e) {}
        return null;
    }

    /**
     * 带状态放置：走 /setblock 命令。
     *
     * 为什么不用 NBT：原版方块的方块 NBT 状态键在 1.21 带命名空间
     * （`minecraft:torch_facing_direction` 一类），而 `buildBlockNbt` 写的是无前缀键
     * （`torch_facing_direction`），BDS 会忽略 → 放出来是默认状态。
     * 实测：墙火把被放成竖立火把 → 贴墙无支撑 → 立即破坏成掉落物 → 打印机循环重放。
     * 命令语法的状态键与原版 /setblock 一致（无命名空间），是最稳的带状态放置方式。
     *
     * @returns {boolean} 命令是否执行成功
     */
    _setBlockViaCommand(x, y, z, dimid, blockName, blockStates) {
        try {
            const dimName = ['overworld', 'nether', 'the_end'][Number(dimid)] || 'overworld';
            const parts = [];
            for (const [k, v] of Object.entries(blockStates || {})) {
                if (v === undefined || v === null) continue;
                const key = k.startsWith('minecraft:') ? k.slice('minecraft:'.length) : k;
                const sv = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
                parts.push(`"${key}"="${sv}"`);
            }
            const statesPart = parts.length ? ` [${parts.join(',')}]` : '';
            const cmd = `execute in ${dimName} run setblock ${x} ${y} ${z} ${blockName}${statesPart}`;
            const res = mc.runcmdEx(cmd);
            return !!(res && res.success);
        } catch (e) {
            return false;
        }
    }

    placeBlockAt(x, y, z, dimid, blockType, blockStates) {
        try {
            if (!blockType || typeof blockType !== 'string') {
                this.logDebug('PLACE_FAILED_INVALID_TYPE', { x, y, z, dimid, blockType });
                return false;
            }

            // 有状态：先走命令（NBT 的状态键在 1.21 上可能被忽略，见 _setBlockViaCommand）
            if (blockStates && Object.keys(blockStates).length > 0
                && this._setBlockViaCommand(x, y, z, dimid, blockType, blockStates)) {
                return true;
            }

            // 使用NBT对象方式放置方块
            // 这是基岩版最可靠的方块状态设置方式
            let success = false;
            
            try {
                // 构建方块NBT对象
                const blockNbt = bidirectionalConverter.buildBlockNbt(blockType, blockStates);
                success = mc.setBlock(x, y, z, dimid, blockNbt);
                
                this.logDebug('PLACE_ATTEMPT_NBT', {
                    x, y, z, dimid,
                    blockType,
                    blockStates,
                    success
                });
                
                if (success) {
                    return true;
                }
            } catch (nbtError) {
                this.logDebug('PLACE_NBT_FAILED', {
                    x, y, z, dimid,
                    blockType,
                    error: nbtError.message
                });
            }
            
            // 如果NBT方式失败，回退到简单放置（无状态）
            if (!success) {
                success = mc.setBlock(x, y, z, dimid, blockType, 0);
                this.logDebug('PLACE_ATTEMPT_SIMPLE', {
                    x, y, z, dimid,
                    blockType,
                    success
                });
            }
            
            return success;
        } catch (e) {
            this.logDebug('PLACE_EXCEPTION', {
                x, y, z, dimid,
                blockType,
                blockStates,
                error: e.message,
                stack: e.stack
            });
            logger.error(`[EasyPlace] Failed to place block: ${e.message}`);
            return false;
        }
    }

    fastPlaceBlockAt(x, y, z, dimid, blockName, blockStates) {
        try {
            if (!blockName || typeof blockName !== 'string') {
                return false;
            }

            // 有状态：先走命令（与 placeBlockAt 同一口径，见 _setBlockViaCommand）
            if (blockStates && Object.keys(blockStates).length > 0
                && this._setBlockViaCommand(x, y, z, dimid, blockName, blockStates)) {
                return true;
            }

            // 使用 NBT 方式放置方块（更可靠，支持颜色等状态）
            try {
                const blockNbt = bidirectionalConverter.buildBlockNbt(blockName, blockStates);
                const success = mc.setBlock(x, y, z, dimid, blockNbt);
                if (success) {
                    return true;
                }
                // NBT 方式失败，回退到简单放置
                return mc.setBlock(x, y, z, dimid, blockName, 0);
            } catch (nbtError) {
                // NBT 构建失败，回退到简单放置
                return mc.setBlock(x, y, z, dimid, blockName, 0);
            }
        } catch (e) {
            this.logDebug('FAST_PLACE_EXCEPTION', {
                x, y, z, dimid,
                blockName,
                blockStates,
                error: e.message
            });
            return false;
        }
    }

    getPlacementFailureStats() {
        return this.placementLogger.getSummary();
    }

    resetPlacementFailureStats() {
        this.placementLogger.reset();
    }

    setLogFailures(enabled) {
        this.logFailures = enabled;
    }

    /**
     * 扣掉 1 个材料。**返回是否真的扣掉了**——调用方必须据此决定要不要继续放。
     *
     * 历史 bug：清空最后一个时写 `inventory.setItem(slot, null)`。LSE 的
     * `Container.setItem(index, item)` 只接受 Item 对象，传 null 直接抛错（被 catch 吞掉）
     * 或静默返回 false，槽位原样保留 → 背包剩 1 个时物品永远不减少，
     * 而 `fastPlaceBlockAt` 已返回 true，打印机就成了无限复制材料。
     *
     * 正确接口是 `container.removeItem(index, count)`：
     * count ≥ 该格堆叠数时，整个物品堆会被清除。
     */
    consumeItem(player, itemType, foundSlot = -1, blockState = null) {
        try {
            const placeableItem = BlockConversions.getPlaceableItem(itemType);
            const consumeType = placeableItem || itemType;

            const inventory = player.getInventory();
            const searchNames = this.inventoryHelper._expandSearchNames(consumeType, blockState);

            // 确定要消耗的槽位
            let targetSlot = foundSlot;
            if (targetSlot === -1) {
                // 没指定，尝试当前选中槽位；若类型不匹配，则从背包找到匹配槽
                const selectedSlot = this.inventoryHelper.getSelectedSlot(player);
                const selectedItem = inventory.getItem(selectedSlot);
                if (selectedItem && !selectedItem.isNull() &&
                    this.inventoryHelper.matchBlockTypeMulti(selectedItem.type, searchNames)) {
                    targetSlot = selectedSlot;
                } else {
                    targetSlot = this.inventoryHelper.findBlockInInventory(inventory, consumeType, -1, blockState);
                }
            }

            if (targetSlot === -1) return false;
            const item = inventory.getItem(targetSlot);
            if (!item || item.isNull()) return false;

            const before = item.count > 0 ? item.count : 1;

            const readCount = () => {
                try {
                    const now = inventory.getItem(targetSlot);
                    return (now && !now.isNull()) ? (now.count || 0) : 0;
                } catch (e) {
                    return 0;
                }
            };

            // 1) 正路：整堆减 1（堆叠为 1 时 = 清除整堆）
            let ok = false;
            try {
                ok = inventory.removeItem(targetSlot, 1) === true;
            } catch (e) {
                ok = false;
            }

            // 2) removeItem 不可用 / 静默失败 → 按类型清 1 个（返回实际清除个数）
            if (!ok || readCount() >= before) {
                let cleared = 0;
                try {
                    cleared = Number(player.clearItem(item.type, 1)) || 0;
                } catch (e) {
                    cleared = 0;
                }
                ok = cleared > 0 || readCount() < before;
            }

            // 3) 最终仍以"背包里真的少了"为准：扣不掉就必须让调用方停下
            if (readCount() >= before && !ok) return false;

            if (ok) {
                // 玻璃瓶 / 空桶这类"用掉后返还容器"的方块
                const specialConversion = BlockConversions.getSpecialConversion(consumeType);
                if (specialConversion) {
                    const newItem = mc.newItem(specialConversion, 1);
                    if (newItem) player.giveItem(newItem);
                }
            }

            try {
                player.refreshItems();
            } catch (e) {
                /* 刷新失败不影响扣减结果 */
            }
            return ok;
        } catch (e) {
            logger.error(`[EasyPlace] Failed to consume item: ${e.message}`);
            return false;
        }
    }

    setDebugMode(enabled) {
        this.debugMode = enabled;
        logger.info(`[EasyPlace] Debug mode: ${enabled}`);
    }

    getStats(player) {
        const state = this.playerStates.get(player.xuid);
        if (!state) return null;
        return {
            enabled: state.enabled,
            placedCount: state.placedCount || 0
        };
    }
}

module.exports = { EasyPlaceManager };
