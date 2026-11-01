// ConfigManager - 配置管理模块
// 负责加载、解析和管理插件配置文件

class ConfigManager {
    constructor() {
        this.configPath = './plugins/LitematicaBE/config.json';
        this.config = null;
        this.defaultConfig = this.getDefaultConfig();
        this.load();
    }

    /**
     * 获取默认配置
     */
    getDefaultConfig() {
        return {
            render: {
                // 只保留 ghost 一条渲染路径（粒子显示已整体移除）。
                // 老配置文件里若写着 "particle"，加载时会被强制改成 ghost 并打一条日志。
                mode: "ghost",
                // 每个 tick 最多写多少格 ghost。1 万方块 ≈ 34 tick ≈ 1.7 秒
                ghostWritesPerTick: 300,
                // 单个投影最多写多少格（外壳提取后仍然超限就直接拒绝，防止写爆存档）
                ghostMaxBlocks: 60000,
                // 是否允许覆盖花草/水/雪这类"可替换"方块（玩家放的方块永远不覆盖）
                ghostOverwriteReplaceable: true,
                // 统一调度器单 tick 给周期任务的总预算（毫秒）
                tickBudgetMs: 8,
                // 超大投影（MEGA / LOD）默认关闭
                enableMega: false
            },
            easyPlace: {
                enabled: true,
                // 投影打印机（自动把半径内的 ghost 格填成真方块）
                printer: {
                    radius: 5,              // 搜索半径（格）
                    maxPerCycle: 12,        // 每轮（200ms）最多放多少格，防一次铺满半个投影卡服
                    budgetMs: 6,            // 单轮时间预算（毫秒），超了就留到下轮
                    placeDelayMs: 0,        // >0 = 每格之间等待（模拟手工节奏）
                    overwriteReplaceable: true,  // 是否顶掉花草/雪/水（玩家建筑永远不覆盖）
                    debug: false            // true = 写 logs/LitematicaBE/easyplace_debug.log（5s 一条）
                }
            },
            logCleaner: {
                enabled: true,
                scanInterval: 60000,
                backupEnabled: true,
                maxBackupFiles: 10,
                patterns: [
                    "litematica:block_",
                    "Spawning particle",
                    "litematica:.*particle",
                    "execute in.*particle",
                    "render"
                ]
            },
            projection: {
                showBounds: true,
                boundsColor: "#00FF00",
                mirrorX: false,
                mirrorZ: false,
                rotation: 0
            },
            megaSchematic: {
                threshold: 30000,
                enabled: true,
                // 实际分块大小由 BinaryChunkStorage.CHUNK_SIZE 固定（32），此处仅作说明
                chunkSize: 32,
                storagePath: "./plugins/LitematicaBE/mega_schematics/"
            },
            // 全量注入模式无可调渲染参数：注入速度跟随 render.ghostWritesPerTick，
            // 分块读取固定 1 块/tick。这两个键仅控制调试输出。
            megaRender: {
                debug: false,
                fileDebug: false
            }
        };
    }

    /**
     * 加载配置文件
     */
    load() {
        try {
            if (!File.exists(this.configPath)) {
                logger.info(`[ConfigManager] 配置文件不存在，创建默认配置: ${this.configPath}`);
                this.config = this.defaultConfig;
                this.save();
                return;
            }

            const content = File.readFrom(this.configPath);
            if (!content) {
                logger.warn(`[ConfigManager] 配置文件为空，使用默认配置`);
                this.config = this.defaultConfig;
                return;
            }

            // 解析JSON（移除注释）
            const cleanJson = this.removeComments(content);
            this.config = JSON.parse(cleanJson);

            // 合并默认配置（确保新参数有值）
            this.config = this.mergeConfig(this.defaultConfig, this.config);

            // 一次性迁移：老配置里的 particle/hybrid 落回 ghost 并立刻写回文件，
            // 这样下次启动不再重复提示（不再作为常态逻辑）。
            if (this.enforceGhostMode()) this.save();

            logger.info(`[ConfigManager] 配置文件加载成功: ${this.configPath}`);
        } catch (e) {
            logger.error(`[ConfigManager] 加载配置文件失败: ${e.message}`);
            logger.warn(`[ConfigManager] 使用默认配置`);
            this.config = this.defaultConfig;
        }
    }

    /**
     * 一次性迁移：粒子渲染已整体删除，配置里残留的 "particle"/"hybrid" 落回 ghost。
     * 返回 true 表示发生过迁移，调用方（load）会立刻写回文件 —— 之后启动不再重复提示。
     * 不抛错、不删用户的其它键，只在启动日志里说一句，避免"改了配置没反应"。
     */
    enforceGhostMode() {
        if (!this.config || !this.config.render) return false;
        const mode = this.config.render.mode;
        if (mode === 'ghost') return false;
        logger.info(`[ConfigManager] render.mode="${mode}" 已废弃（粒子渲染已整体移除），已迁移为 ghost 并写回配置`);
        this.config.render.mode = 'ghost';
        return true;
    }

    /**
     * 移除JSON中的注释
     */
    removeComments(jsonString) {
        // 移除单行注释 (//...)
        let result = jsonString.replace(/\/\/.*$/gm, '');
        // 移除多行注释 (/*...*/)
        result = result.replace(/\/\*[\s\S]*?\*\//g, '');
        return result;
    }

    /**
     * 深度合并配置
     */
    mergeConfig(defaultObj, userObj) {
        const result = { ...defaultObj };

        for (const key in userObj) {
            if (userObj.hasOwnProperty(key)) {
                if (typeof userObj[key] === 'object' && userObj[key] !== null && !Array.isArray(userObj[key])) {
                    result[key] = this.mergeConfig(defaultObj[key] || {}, userObj[key]);
                } else {
                    result[key] = userObj[key];
                }
            }
        }

        return result;
    }

    /**
     * 保存配置文件
     */
    save() {
        try {
            const content = JSON.stringify(this.config, null, 4);
            File.writeTo(this.configPath, content);
            logger.info(`[ConfigManager] 配置文件已保存: ${this.configPath}`);
        } catch (e) {
            logger.error(`[ConfigManager] 保存配置文件失败: ${e.message}`);
        }
    }

    /**
     * 获取配置值
     * @param {string} key 配置路径，如 "render.ghostWritesPerTick"
     * @param {*} defaultValue 默认值
     * @returns {*} 配置值
     */
    get(key, defaultValue = null) {
        const keys = key.split('.');
        let value = this.config;

        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                return defaultValue;
            }
        }

        return value !== undefined ? value : defaultValue;
    }

    /**
     * 设置配置值
     * @param {string} key 配置路径
     * @param {*} value 配置值
     */
    set(key, value) {
        const keys = key.split('.');
        let obj = this.config;

        for (let i = 0; i < keys.length - 1; i++) {
            const k = keys[i];
            if (!(k in obj) || typeof obj[k] !== 'object') {
                obj[k] = {};
            }
            obj = obj[k];
        }

        obj[keys[keys.length - 1]] = value;
    }

    /**
     * 获取所有配置
     */
    getAll() {
        return { ...this.config };
    }

    /**
     * 重置为默认配置
     */
    reset() {
        this.config = { ...this.defaultConfig };
        this.save();
        logger.info('[ConfigManager] 配置已重置为默认值');
    }

    /**
     * 重新加载配置
     */
    reload() {
        this.load();
        logger.info('[ConfigManager] 配置已重新加载');
    }

    /**
     * 获取配置路径
     */
    getPath() {
        return this.configPath;
    }
}

// 导出单例
module.exports = { ConfigManager };