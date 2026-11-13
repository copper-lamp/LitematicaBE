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
                mode: "ghost",
                // 每 tick 最多写多少格 ghost
                ghostWritesPerTick: 300,
                // 单个投影最多写多少格
                ghostMaxBlocks: 60000,
                // 是否允许覆盖花草/水/雪这类"可替换"方块
                ghostOverwriteReplaceable: true,
                // 统一调度器单 tick 给周期任务的总预算（毫秒）
                tickBudgetMs: 8,
                // 超大投影（MEGA / LOD）默认开启
                enableMega: true
            },
            easyPlace: {
                enabled: true,
                // 投影打印机（自动打印范围内的 ghost 格）
                printer: {
                    radius: 6,              // 搜索半径（格）
                    maxPerCycle: 12,        // 每轮（200ms）最多放置格数
                    budgetMs: 6,            // 单轮时间预算（毫秒），溢出顺延
                    placeDelayMs: 0,        // >0 = 每格之间等待时间（毫秒）
                    overwriteReplaceable: true,  // 是否顶替花草/雪/水
                    debug: false            // logs/LitematicaBE/easyplace_debug.log（5s 一条）
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
            // 保存投影（选区 → 文件）。两种出口：
            //   litematic   = Java 版 Litematica 投影文件
            //   mcstructure = 基岩版结构文件
            //   mcstructure 单次导出受 maxVolume 限制；超限在「读方块之前」截停
            schematicSave: {
                defaultFormat: "litematic",   // 表单默认选中项：litematic | mcstructure | both
                maxVolume: 1000000,           // .mcstructure 单次导出格数上限（≈ 100×100×100）
                includeBlockEntities: true,   // 是否写入 box/漏斗等方块实体（block_position_data）
                writeLiquidLayer: true,       // 第二层 block_indices 整层 -1 占位（+体积 × 4 B）
                blockVersion: 18168865,       // 写进 block_palette[*].version（样本实测值 = 1.21.60.33）
                formatVersion: 1,             // root.format_version
                verboseScan: false            // 逐格扫描日志（排查用；默认只打汇总）
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
            // 分块读取固定 1 块/tick。这两个键仅控制调试输出
            megaRender: {
                debug: false,
                fileDebug: false
            },
            // 内置 HTTP 上传站
            web: {
                enabled: true,
                // 传输层：Node 原生 http
                engine: "node",
                host: "0.0.0.0",
                port: 8080,
                tokenRequired: true,      // 必须带令牌；本机(127.0.0.1)访问默认免令牌
                localhostNoToken: true,
                token: "",                // 留空 = 自动生成并写入 data/web_token.txt
                allowIps: [],             // 前缀匹配，如 ["192.168.", "10.0."]；空 = 不限制
                maxFileMB: 64,
                chunkKB: 512,
                allowExt: [".litematic", ".mcstructure"],
                overwrite: false,         // false = 同名自动加 -1/-2
                maxUploadsPerMinute: 10,
                targetDir: "./plugins/LitematicaBE/schematics/",
                publicUrl: ""             // 反向代理时填对外地址，仅用于日志/页面展示
            },
            // 版本更新检查（GitHub Release）。
            updateCheck: {
                enabled: true,
                repo: "copper-lamp/LitematicaBE",  // owner/name，与 tooth.json 的 tooth 字段一致
                mirror: "",                        // 镜像站（可选），支持 {repo} 占位；官方链路失败时启用
                timeoutMs: 8000                    // 单次请求超时（1000-30000）
            },
            // 杂项开关
            misc: {
                // 分层切换成功时的"当前层/方块数"提示（失败提示始终保留）
                showLayerInfo: false,
                // 命令注册成功日志（失败日志始终保留）
                verboseCommandLog: false,
                // 启动期信息日志总开关：LogCleaner 一次性 INFO（warn/error 始终保留）
                verboseStartupLog: false
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
     * 把配置文本清理成可 JSON.parse 的形式：
     *   · 去掉 `//` 行注释与 `/* *\/` 块注释
     *   · 去掉 `}` / `]` 前的尾随逗号
     *
     * **只在字符串外生效**：`"https://api.github.com"` 里的 `//` 不是注释。
     * 旧实现用 `/\/\/.*$/gm` 正则，会把 URL 的 `//` 之后整段吃掉 —— 用户把
     * `web.publicUrl`、`updateCheck.checkUrl` 填成 https 地址时，整份配置解析失败、
     * 静默回退默认值（表现就是"改了配置没反应"）。这里改成逐字符扫描。
     */
    removeComments(jsonString) {
        const s = String(jsonString === undefined || jsonString === null ? '' : jsonString);
        let out = '';
        let i = 0;
        let inString = false;
        let escaped = false;

        while (i < s.length) {
            const ch = s[i];
            const next = i + 1 < s.length ? s[i + 1] : '';

            // 字符串内：原样抄，只处理转义与结束引号
            if (inString) {
                out += ch;
                if (escaped) escaped = false;
                else if (ch === '\\') escaped = true;
                else if (ch === '"') inString = false;
                i++;
                continue;
            }

            if (ch === '"') {
                inString = true;
                out += ch;
                i++;
                continue;
            }

            // 行注释：吃到行尾（换行符本身保留）
            if (ch === '/' && next === '/') {
                while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++;
                continue;
            }

            // 块注释：吃到 */
            if (ch === '/' && next === '*') {
                i += 2;
                while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
                i = Math.min(s.length, i + 2);
                continue;
            }

            // 尾随逗号：逗号之后（跳过空白）只剩 } 或 ] 时丢掉这个逗号
            if (ch === ',') {
                let j = i + 1;
                while (j < s.length && /\s/.test(s[j])) j++;
                if (j < s.length && (s[j] === '}' || s[j] === ']')) {
                    i++;
                    continue;
                }
            }

            out += ch;
            i++;
        }

        return out;
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