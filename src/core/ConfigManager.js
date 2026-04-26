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
                mode: "particle",
                opacity: 0.6,
                particleSize: 0.5,
                particlesPerFrame: 500,
                renderFrameInterval: 16,
                layerRenderEnabled: false,
                defaultStartLayer: "max"
            },
            particleRespawn: {
                enabled: true,
                lifetime: 40,
                respawnBuffer: 2,
                checkInterval: 1000
            },
            easyPlace: {
                enabled: true,
                checkInterval: 500,
                successMessage: "✓ 方块放置正确",
                errorMessage: "✗ 方块类型错误"
            },
            layerSwitch: {
                cooldown: 200,
                lookUpThreshold: -10,
                lookDownThreshold: 10,
                defaultDirection: "down"
            },
            nearbyPrompt: {
                enabled: true,
                checkInterval: 30000,
                cooldown: 300000,
                range: 50
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
            gui: {
                titleColor: "§l§6",
                buttonColor: "§l",
                textColor: "§f",
                successColor: "§a",
                errorColor: "§c"
            },
            projection: {
                defaultLayer: -1,
                showBounds: true,
                boundsColor: "#00FF00",
                mirrorX: false,
                mirrorZ: false,
                rotation: 0
            },
            performance: {
                maxActiveProjections: 10,
                maxCachedBlocks: 100000,
                monitorEnabled: false,
                monitorInterval: 5000
            },
            megaSchematic: {
                threshold: 30000,
                enabled: true,
                chunkSize: 16,
                batchInsertSize: 5000,
                lruCacheSize: 200,
                storagePath: "./plugins/LitematicaBE/mega_schematics/"
            },
            megaRender: {
                maxParticlesPerTick: 2000,
                maxRenderDistance: 96,
                viewportUpdateInterval: 500,
                lodLevels: {
                    near: { distance: 32, skipRate: 0 },
                    medium: { distance: 80, skipRate: 2 },
                    far: { distance: 160, skipRate: 4 }
                }
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

            logger.info(`[ConfigManager] 配置文件加载成功: ${this.configPath}`);
        } catch (e) {
            logger.error(`[ConfigManager] 加载配置文件失败: ${e.message}`);
            logger.warn(`[ConfigManager] 使用默认配置`);
            this.config = this.defaultConfig;
        }
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
     * @param {string} key 配置路径，如 "render.opacity"
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