// logger.js  – pino‑based structured logger with multi‑stream routing
const fs   = require('fs');
const path = require('path');
const pino = require('pino');

// ---------- directory & filename helpers ----------
const rootDir   = path.join(__dirname, 'logs');
const levelsDir = ['full', 'trace', 'debug', 'info', 'warn', 'error'];
levelsDir.forEach(dir => {
  const p = path.join(rootDir, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

function ts() {
  // e.g. 2025-06-24_13-00-00
  return new Date().toISOString().replace(/T/, '_').replace(/:/g, '-').replace(/\..+/, '');
}

// ---------- file destinations ----------
const filenameBase = `${ts()}`;
const destinations = {
  full:  path.join(rootDir, 'full',  `${filenameBase}.jsonl`),
  trace: path.join(rootDir, 'trace', `${filenameBase}.log`),
  debug: path.join(rootDir, 'debug', `${filenameBase}.log`),
  info:  path.join(rootDir, 'info',  `${filenameBase}.log`),
  warn:  path.join(rootDir, 'warn',  `${filenameBase}.log`),
  error: path.join(rootDir, 'error', `${filenameBase}.log`)
};

// ---------- transport configuration ----------
const transport = pino.transport({
  targets: [
    // canonical JSON stream (all levels)
    {
      level: 'trace',
      target: 'pino/file',
      options: { destination: destinations.full, mkdir: true }
    },
    // pretty streams per level
    ...['trace', 'debug', 'info', 'warn', 'error'].map(level => ({
      level,
      target: 'pino-pretty',
      options: {
        destination: destinations[level],
        mkdir: true,
        colorize: false,
        translateTime: 'SYS:HH:MM:ss, mmmm dd yyyy',
        ignore: 'pid,hostname'
      }
    })),
    // pretty console stream (only info level)
    {
      level: 'info',
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss, mmmm dd yyyy',
        ignore: 'pid,hostname'
      }
    }
  ]
});

// ---------- base logger ----------
const logger = pino({ level: 'trace' }, transport);

// helper – human‑readable seconds + stack trace
function secs(ms) {
  return (ms / 1000).toFixed(3) + 's';
}

logger.withTrace = function (msg, data = {}) {
  const err = new Error();
  this.trace({ ...data, trace: err.stack }, msg);
};

logger.duration = function (msg, ms, data = {}) {
  this.info({ ...data, durationMs: ms, duration: secs(ms) }, msg);
};

module.exports = logger;