// DebugLogger - 调试日志管理器
// 将调试信息写入文件，便于后续分析

const fs = require('fs');
const path = require('path');

class DebugLogger {
    constructor(options = {}) {
        this.enabled = options.enabled !== false;
        this.logDir = options.logDir || './plugins/LitematicaBE/logs/';
        this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB
        this.maxFiles = options.maxFiles || 5;
        this.bufferSize = options.bufferSize || 100;
        
        this.buffer = [];
        this.currentFile = null;
        this.fileIndex = 0;
        this.writeCount = 0;
        
        if (this.enabled) {
            this.ensureDir();
            this.openNewFile();
            // 定期自动刷新缓冲区（每5秒），防止插件崩溃时丢失日志
            this._flushTimer = setInterval(() => {
                if (this.buffer.length > 0) {
                    this.flush();
                }
            }, 5000);
        }
    }

    ensureDir() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    getLogFilePath(index) {
        const date = new Date().toISOString().split('T')[0];
        return path.join(this.logDir, `debug_${date}_${index}.log`);
    }

    openNewFile() {
        this.currentFile = this.getLogFilePath(this.fileIndex);
        this.writeCount = 0;
        
        // 写入文件头
        const header = `[${new Date().toISOString()}] === Debug Log Started ===\n`;
        fs.writeFileSync(this.currentFile, header);
    }

    rotateFile() {
        this.fileIndex++;
        if (this.fileIndex >= this.maxFiles) {
            this.fileIndex = 0;
        }
        this.openNewFile();
    }

    checkRotation() {
        try {
            if (fs.existsSync(this.currentFile)) {
                const stats = fs.statSync(this.currentFile);
                if (stats.size > this.maxFileSize) {
                    this.rotateFile();
                }
            }
        } catch (e) {
            // 忽略错误
        }
    }

    log(level, category, message, data = null) {
        if (!this.enabled) return;

        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            category,
            message,
            data
        };

        // 格式化为字符串
        let logLine = `[${timestamp}] [${level}] [${category}] ${message}`;
        if (data) {
            logLine += ' | ' + JSON.stringify(data);
        }
        logLine += '\n';

        this.buffer.push(logLine);

        // 缓冲区满或达到一定数量时写入
        if (this.buffer.length >= this.bufferSize) {
            this.flush();
        }
    }

    flush() {
        if (this.buffer.length === 0) return;

        this.checkRotation();

        try {
            const content = this.buffer.join('');
            fs.appendFileSync(this.currentFile, content);
            this.writeCount += this.buffer.length;
            this.buffer = [];
        } catch (e) {
            // 如果写入失败，保留缓冲区
            logger.error(`[DebugLogger] Failed to write: ${e.message}`);
        }
    }

    // 快捷方法
    debug(category, message, data) {
        this.log('DEBUG', category, message, data);
    }

    info(category, message, data) {
        this.log('INFO', category, message, data);
    }

    warn(category, message, data) {
        this.log('WARN', category, message, data);
    }

    error(category, message, data) {
        this.log('ERROR', category, message, data);
    }

    // 性能计时
    startTimer(name) {
        return {
            name,
            startTime: Date.now()
        };
    }

    endTimer(timer) {
        const duration = Date.now() - timer.startTime;
        this.debug('PERF', `${timer.name} took ${duration}ms`);
        return duration;
    }

    // 记录统计信息
    stats(category, stats) {
        this.info('STATS', category, stats);
    }

    // 关闭日志
    close() {
        if (this._flushTimer) {
            clearInterval(this._flushTimer);
            this._flushTimer = null;
        }
        this.flush();
        this.enabled = false;
    }

    // 获取当前日志文件路径
    getCurrentFile() {
        return this.currentFile;
    }

    // 获取所有日志文件
    getAllLogFiles() {
        try {
            if (!fs.existsSync(this.logDir)) return [];
            return fs.readdirSync(this.logDir)
                .filter(f => f.startsWith('debug_') && f.endsWith('.log'))
                .map(f => path.join(this.logDir, f));
        } catch (e) {
            return [];
        }
    }

    // 清空所有日志
    clearAll() {
        try {
            const files = this.getAllLogFiles();
            for (const file of files) {
                fs.unlinkSync(file);
            }
            this.buffer = [];
            this.openNewFile();
        } catch (e) {
            logger.error(`[DebugLogger] Failed to clear logs: ${e.message}`);
        }
    }
}

module.exports = { DebugLogger };
