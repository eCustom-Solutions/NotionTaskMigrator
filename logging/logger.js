// logger.js
const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, 'migration.log');
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

function logToFile(level, ...args) {
    const timestamp = new Date().toISOString();
    const message = args.map(arg => {
        if (typeof arg === 'object') {
            try {
                return JSON.stringify(arg);
            } catch {
                return '[Unserializable object]';
            }
        }
        return String(arg);
    }).join(' ');

    logStream.write(`[${timestamp}] [${level}] ${message}\n`);
}

module.exports = {
    info: (...args) => {
        console.log(...args);
        logToFile('INFO', ...args);
    },
    error: (...args) => {
        console.error(...args);
        logToFile('ERROR', ...args);
    }
};