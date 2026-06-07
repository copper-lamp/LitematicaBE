const fs = require('fs');
const path = require('path');

class PlacementLogger {
    constructor(logDir = './plugins/LitematicaBE/logs/') {
        this.logDir = logDir;
        this.failedBlocks = new Map();
        this.totalAttempts = 0;
        this.totalFailures = 0;
        this.sessionStart = Date.now();
        this.ensureDir();
    }

    ensureDir() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    getLogPath() {
        const date = new Date().toISOString().split('T')[0];
        return path.join(this.logDir, `placement_failures_${date}.log`);
    }

    logFailure(playerName, javaName, beName, javaStates, beStates, cmd, errorMsg) {
        this.totalAttempts++;
        this.totalFailures++;

        const key = javaName;
        if (!this.failedBlocks.has(key)) {
            this.failedBlocks.set(key, { count: 0, javaName, beName, lastJavaStates: null, lastBeStates: null, lastCmd: null, lastError: null });
        }
        const entry = this.failedBlocks.get(key);
        entry.count++;
        entry.lastJavaStates = javaStates;
        entry.lastBeStates = beStates;
        entry.lastCmd = cmd;
        entry.lastError = errorMsg;

        const timestamp = new Date().toISOString();
        const line = [
            `[${timestamp}]`,
            `Player=${playerName}`,
            `Java=${javaName}`,
            `BE=${beName}`,
            `JavaStates=${JSON.stringify(javaStates)}`,
            `BEStates=${JSON.stringify(beStates)}`,
            `Command=${cmd}`,
            `Error=${errorMsg}`
        ].join(' | ') + '\n';

        try {
            fs.appendFileSync(this.getLogPath(), line);
        } catch (e) {
            // silently fail
        }
    }

    logSuccess() {
        this.totalAttempts++;
    }

    getSummary() {
        const byCount = [...this.failedBlocks.entries()]
            .sort((a, b) => b[1].count - a[0].count);
        return {
            sessionDuration: Math.floor((Date.now() - this.sessionStart) / 1000),
            totalAttempts: this.totalAttempts,
            totalFailures: this.totalFailures,
            failureRate: this.totalAttempts > 0
                ? ((this.totalFailures / this.totalAttempts) * 100).toFixed(1) + '%'
                : '0%',
            topFailures: byCount.slice(0, 20).map(([name, info]) => ({
                javaName: name,
                beName: info.beName,
                count: info.count,
                lastError: info.lastError
            }))
        };
    }

    getDetailedFailures() {
        return [...this.failedBlocks.entries()].map(([name, info]) => ({
            javaName: name,
            beName: info.beName,
            count: info.count,
            lastJavaStates: info.lastJavaStates,
            lastBeStates: info.lastBeStates,
            lastCmd: info.lastCmd,
            lastError: info.lastError
        }));
    }

    reset() {
        this.failedBlocks.clear();
        this.totalAttempts = 0;
        this.totalFailures = 0;
        this.sessionStart = Date.now();
    }
}

module.exports = { PlacementLogger };
