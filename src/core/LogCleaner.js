// LogCleaner - 日志清理模块
// 自动扫描并清除渲染相关的日志条目，保留其他重要日志

const fs = require('fs');
const path = require('path');

class LogCleaner {
    constructor() {
        this.config = {
            logDir: './logs',
            scanInterval: 60000,
            patterns: [
                /litematica:block_/i,
                /Spawning particle/i,
                /litematica:.*particle/i,
                /execute in.*particle/i,
                /render/i
            ],
            backupEnabled: true,
            backupDir: './logs/backup',
            maxBackupFiles: 10
        };

        this.isRunning = false;
        this.lastScanTime = 0;
        this.stats = {
            totalScans: 0,
            totalLinesRemoved: 0,
            totalFilesProcessed: 0
        };

        this.startAutoClean();
    }

    /**
     * 配置日志清理器
     * @param {Object} newConfig 配置选项
     */
    configure(newConfig) {
        if (newConfig.logDir) this.config.logDir = newConfig.logDir;
        if (newConfig.scanInterval) this.config.scanInterval = newConfig.scanInterval;
        if (newConfig.patterns) this.config.patterns = newConfig.patterns;
        if (newConfig.backupEnabled !== undefined) this.config.backupEnabled = newConfig.backupEnabled;
        if (newConfig.backupDir) this.config.backupDir = newConfig.backupDir;
        if (newConfig.maxBackupFiles) this.config.maxBackupFiles = newConfig.maxBackupFiles;

        logger.info(`[LogCleaner] 配置已更新: 扫描间隔=${this.config.scanInterval}ms`);
    }

    /**
     * 启动自动清理循环
     */
    startAutoClean() {
        if (this.isRunning) return;

        this.isRunning = true;
        setInterval(() => {
            this.cleanRenderLogs();
        }, this.config.scanInterval);

        logger.info(`[LogCleaner] 自动清理已启动，扫描间隔: ${this.config.scanInterval}ms`);
    }

    /**
     * 停止自动清理
     */
    stopAutoClean() {
        this.isRunning = false;
        logger.info('[LogCleaner] 自动清理已停止');
    }

    /**
     * 手动触发清理
     * @returns {Promise<Object>} 清理结果统计
     */
    async manualClean() {
        logger.info('[LogCleaner] 手动触发日志清理...');
        return await this.cleanRenderLogs(true);
    }

    /**
     * 同步版本的手动清理（用于服务器关闭时）
     * @returns {Object} 清理结果
     */
    cleanRenderLogsSync() {
        const result = {
            success: true,
            filesProcessed: 0,
            linesRemoved: 0,
            errors: [],
            timestamp: new Date().toISOString()
        };

        try {
            // 确保备份目录存在
            if (this.config.backupEnabled) {
                this.ensureBackupDir();
            }

            // 获取日志目录
            const logDir = this.config.logDir;
            if (!fs.existsSync(logDir)) {
                logger.warn(`[LogCleaner] 日志目录不存在: ${logDir}`);
                result.success = false;
                result.errors.push(`日志目录不存在: ${logDir}`);
                return result;
            }

            // 获取所有日志文件
            const files = fs.readdirSync(logDir)
                .filter(f => f.endsWith('.log'))
                .map(f => path.join(logDir, f))
                .filter(f => {
                    try {
                        return fs.statSync(f).isFile();
                    } catch {
                        return false;
                    }
                });

            for (const filePath of files) {
                try {
                    const cleanResult = this.cleanFileSync(filePath);
                    result.filesProcessed++;
                    result.linesRemoved += cleanResult.linesRemoved;
                } catch (err) {
                    result.errors.push(`处理文件 ${path.basename(filePath)} 时出错: ${err.message}`);
                }
            }

            result.filesProcessed = files.length;
            this.stats.totalScans++;
            this.stats.totalLinesRemoved += result.linesRemoved;
            this.stats.totalFilesProcessed += result.filesProcessed;
            this.lastScanTime = Date.now();

            // 记录审计日志
            this.logAudit(result, false);

            // 清理旧备份
            if (this.config.backupEnabled) {
                this.cleanOldBackups();
            }

        } catch (err) {
            result.success = false;
            result.errors.push(`清理过程出错: ${err.message}`);
        }

        return result;
    }

    /**
     * 同步版本清理单个文件
     * @param {string} filePath 文件路径
     * @returns {Object} 清理结果
     */
    cleanFileSync(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n');
            const originalLineCount = lines.length;

            // 过滤掉匹配渲染日志模式的行
            const filteredLines = lines.filter(line => {
                return !this.shouldRemoveLine(line);
            });

            const linesRemoved = originalLineCount - filteredLines.length;

            if (linesRemoved > 0) {
                // 备份原文件
                if (this.config.backupEnabled) {
                    this.backupFile(filePath, content);
                }

                // 写入清理后的内容
                fs.writeFileSync(filePath, filteredLines.join('\n'), 'utf8');
            }

            return { linesRemoved, originalLineCount };

        } catch (err) {
            throw err;
        }
    }

    /**
     * 核心清理逻辑
     * @param {boolean} manual 是否为手动触发
     * @returns {Promise<Object>} 清理结果
     */
    async cleanRenderLogs(manual = false) {
        const result = {
            success: true,
            filesProcessed: 0,
            linesRemoved: 0,
            errors: [],
            timestamp: new Date().toISOString()
        };

        try {
            // 确保备份目录存在
            if (this.config.backupEnabled) {
                this.ensureBackupDir();
            }

            // 获取日志目录
            const logDir = this.config.logDir;
            if (!fs.existsSync(logDir)) {
                logger.warn(`[LogCleaner] 日志目录不存在: ${logDir}`);
                result.success = false;
                result.errors.push(`日志目录不存在: ${logDir}`);
                return result;
            }

            // 获取所有日志文件
            const files = fs.readdirSync(logDir)
                .filter(f => f.endsWith('.log'))
                .map(f => path.join(logDir, f))
                .filter(f => fs.statSync(f).isFile());

            for (const filePath of files) {
                try {
                    const cleanResult = await this.cleanFile(filePath);
                    result.filesProcessed++;
                    result.linesRemoved += cleanResult.linesRemoved;
                } catch (err) {
                    result.errors.push(`处理文件 ${path.basename(filePath)} 时出错: ${err.message}`);
                    logger.error(`[LogCleaner] 处理文件失败: ${filePath}`, err);
                }
            }

            result.filesProcessed = files.length;
            this.stats.totalScans++;
            this.stats.totalLinesRemoved += result.linesRemoved;
            this.stats.totalFilesProcessed += result.filesProcessed;
            this.lastScanTime = Date.now();

            // 记录审计日志
            this.logAudit(result, manual);

            // 清理旧备份
            if (this.config.backupEnabled) {
                this.cleanOldBackups();
            }

            if (manual) {
                logger.info(`[LogCleaner] 手动清理完成: 处理${result.filesProcessed}个文件，移除${result.linesRemoved}行渲染日志`);
            }

        } catch (err) {
            result.success = false;
            result.errors.push(`清理过程出错: ${err.message}`);
            logger.error('[LogCleaner] 清理过程出错', err);
        }

        return result;
    }

    /**
     * 清理单个文件
     * @param {string} filePath 文件路径
     * @returns {Promise<Object>} 清理结果
     */
    async cleanFile(filePath) {
        return new Promise((resolve, reject) => {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const lines = content.split('\n');
                const originalLineCount = lines.length;

                // 过滤掉匹配渲染日志模式的行
                const filteredLines = lines.filter(line => {
                    return !this.shouldRemoveLine(line);
                });

                const linesRemoved = originalLineCount - filteredLines.length;

                if (linesRemoved > 0) {
                    // 备份原文件
                    if (this.config.backupEnabled) {
                        this.backupFile(filePath, content);
                    }

                    // 写入清理后的内容
                    fs.writeFileSync(filePath, filteredLines.join('\n'), 'utf8');
                    logger.info(`[LogCleaner] 已清理 ${path.basename(filePath)}: 移除 ${linesRemoved}/${originalLineCount} 行`);
                }

                resolve({ linesRemoved, originalLineCount });

            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * 判断行是否应该被移除
     * @param {string} line 日志行
     * @returns {boolean} 是否应该移除
     */
    shouldRemoveLine(line) {
        // 跳过空行
        if (!line || line.trim() === '') {
            return false;
        }

        // 检查是否匹配任何渲染日志模式
        for (const pattern of this.config.patterns) {
            if (pattern.test(line)) {
                return true;
            }
        }

        return false;
    }

    /**
     * 备份文件
     * @param {string} originalPath 原文件路径
     * @param {string} content 文件内容
     */
    backupFile(originalPath, content) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = path.basename(originalPath, '.log');
            const backupFilename = `${filename}_${timestamp}.log`;
            const backupPath = path.join(this.config.backupDir, backupFilename);

            fs.writeFileSync(backupPath, content, 'utf8');
            logger.info(`[LogCleaner] 已备份: ${backupFilename}`);

        } catch (err) {
            logger.error(`[LogCleaner] 备份文件失败: ${err.message}`);
        }
    }

    /**
     * 确保备份目录存在
     */
    ensureBackupDir() {
        if (!fs.existsSync(this.config.backupDir)) {
            fs.mkdirSync(this.config.backupDir, { recursive: true });
        }
    }

    /**
     * 清理旧备份文件
     */
    cleanOldBackups() {
        try {
            if (!fs.existsSync(this.config.backupDir)) return;

            const files = fs.readdirSync(this.config.backupDir)
                .filter(f => f.endsWith('.log'))
                .map(f => ({
                    name: f,
                    path: path.join(this.config.backupDir, f),
                    time: fs.statSync(path.join(this.config.backupDir, f)).mtime.getTime()
                }))
                .sort((a, b) => b.time - a.time);

            // 删除超过限制的旧文件
            if (files.length > this.config.maxBackupFiles) {
                const toDelete = files.slice(this.config.maxBackupFiles);
                for (const file of toDelete) {
                    fs.unlinkSync(file.path);
                    logger.info(`[LogCleaner] 已删除旧备份: ${file.name}`);
                }
            }

        } catch (err) {
            logger.error(`[LogCleaner] 清理旧备份失败: ${err.message}`);
        }
    }

    /**
     * 记录审计日志
     * @param {Object} result 清理结果
     * @param {boolean} manual 是否手动触发
     */
    logAudit(result, manual) {
        const logEntry = {
            timestamp: result.timestamp,
            type: manual ? 'MANUAL' : 'AUTO',
            success: result.success,
            filesProcessed: result.filesProcessed,
            linesRemoved: result.linesRemoved,
            errors: result.errors
        };

        const auditLogPath = path.join(this.config.logDir, 'cleaner_audit.log');
        const logLine = `[${logEntry.timestamp}] ${logEntry.type} - 处理${logEntry.filesProcessed}个文件，移除${logEntry.linesRemoved}行` +
            (logEntry.errors.length > 0 ? ` | 错误: ${logEntry.errors.join('; ')}` : '');

        try {
            fs.appendFileSync(auditLogPath, logLine + '\n', 'utf8');
        } catch (err) {
            logger.error(`[LogCleaner] 写入审计日志失败: ${err.message}`);
        }
    }

    /**
     * 获取清理统计信息
     * @returns {Object} 统计信息
     */
    getStats() {
        return {
            ...this.stats,
            lastScanTime: this.lastScanTime > 0 ? new Date(this.lastScanTime).toISOString() : '从未扫描',
            config: {
                logDir: this.config.logDir,
                scanInterval: this.config.scanInterval,
                patternsCount: this.config.patterns.length,
                backupEnabled: this.config.backupEnabled
            }
        };
    }

    /**
     * 重置统计信息
     */
    resetStats() {
        this.stats = {
            totalScans: 0,
            totalLinesRemoved: 0,
            totalFilesProcessed: 0
        };
        logger.info('[LogCleaner] 统计信息已重置');
    }

    /**
     * 添加自定义清理模式
     * @param {string|RegExp} pattern 匹配模式
     */
    addPattern(pattern) {
        if (typeof pattern === 'string') {
            pattern = new RegExp(pattern, 'i');
        }
        this.config.patterns.push(pattern);
        logger.info(`[LogCleaner] 已添加清理模式: ${pattern}`);
    }

    /**
     * 移除清理模式
     * @param {RegExp} pattern 要移除的模式
     */
    removePattern(pattern) {
        const index = this.config.patterns.findIndex(p => p.toString() === pattern.toString());
        if (index !== -1) {
            this.config.patterns.splice(index, 1);
            logger.info(`[LogCleaner] 已移除清理模式: ${pattern}`);
        }
    }

    /**
     * 获取当前配置
     * @returns {Object} 配置对象
     */
    getConfig() {
        return { ...this.config };
    }
}

// 导出单例
module.exports = { LogCleaner };