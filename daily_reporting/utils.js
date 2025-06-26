// daily_reporting/utils.js
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');

const LOG_DIR = path.resolve(__dirname, '../logging/logs');
const LOG_LEVELS = ['debug', 'error', 'full', 'info', 'trace', 'warn'];

function getAllLogFilesForDate(date = new Date()) {
    const dateStr = dayjs(date).format('YYYY-MM-DD');
    const files = [];

    for (const level of LOG_LEVELS) {
        const dir = path.join(LOG_DIR, level);
        if (!fs.existsSync(dir)) continue;

        const levelFiles = fs.readdirSync(dir)
            .filter(f => (f.endsWith('.jsonl') || f.endsWith('.log')) && f.startsWith(dateStr))
            .map(f => path.join(dir, f));

        files.push(...levelFiles);
    }

    return files;
}

function getFullLogDir() {
    return path.join(LOG_DIR, 'full');
}

function flushTmpDir() {
    const tmpDir = path.resolve(__dirname, '../tmp');
    if (!fs.existsSync(tmpDir)) return;

    const entries = fs.readdirSync(tmpDir);
    for (const entry of entries) {
        const entryPath = path.join(tmpDir, entry);
        const stat = fs.statSync(entryPath);
        if (stat.isDirectory()) {
            fs.rmSync(entryPath, { recursive: true, force: true });
        } else {
            fs.unlinkSync(entryPath);
        }
    }
}

function formatTimestampForFilename(date = new Date()) {
    return dayjs(date).format('YYYY-MM-DD__HH-mm-ss');
}

module.exports = {
    getAllLogFilesForDate,
    getFullLogDir,
    LOG_DIR,
    flushTmpDir,
    formatTimestampForFilename
};