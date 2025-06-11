// logger.js
const fs = require('fs');
const path = require('path');

const startTime = new Date();
function getDaySuffix(day) {
    if (day >= 11 && day <= 13) return 'th';
    switch (day % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
    }
}
function formatTimestamp(date) {
    const pad = n => n < 10 ? '0' + n : n;
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const month = monthNames[date.getMonth()];
    const day = date.getDate();
    const suffix = getDaySuffix(day);
    const year = date.getFullYear();
    return `${hours}:${minutes}, ${month} ${day}${suffix} ${year}`;
}

const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
const formattedStart = [
    startTime.getFullYear(),
    String(startTime.getMonth() + 1).padStart(2, '0'),
    String(startTime.getDate()).padStart(2, '0')
].join('-') + '_' + [
    String(startTime.getHours()).padStart(2, '0'),
    String(startTime.getMinutes()).padStart(2, '0'),
    String(startTime.getSeconds()).padStart(2, '0')
].join('-');
const logFile = path.join(logDir, `${formattedStart}.log`);
const latestLogFile = path.join(logDir, '0_latest.log');
fs.writeFileSync(latestLogFile, '');
const logStream = fs.createWriteStream(logFile, { flags: 'a' });
// Ensure _latest.log is also appended

function logToFile(level, ...args) {
    const now = new Date();
    const timestamp = formatTimestamp(now);
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
    // Mirror to _latest.log
    fs.appendFileSync(latestLogFile, `[${timestamp}] [${level}] ${message}\n`);
}

module.exports = {
    info: (...args) => {
        console.log(...args);
        logToFile('INFO', ...args);
    },
    error: (...args) => {
        console.error(...args);
        logToFile('ERROR', ...args);
    },
    warn: (...args) => {
        console.warn(...args);
        logToFile('WARN', ...args);
    },
    warning: (...args) => {
        console.warn(...args);
        logToFile('WARN', ...args);
    }
};