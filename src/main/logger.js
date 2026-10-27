'use strict';
const fs = require('fs');
const path = require('path');

/** Файловый логгер с ротацией (1 МБ, 3 файла). Секреты (token, code) вырезаются. */
function createLogger(dir) {
  const file = path.join(dir, 'launcher.log');
  const MAX = 1024 * 1024;
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* ignore */ }

  function scrub(s) {
    return String(s)
      .replace(/("?(?:token|sessionToken|code|password|apikey|authorization)"?\s*[:=]\s*"?)[^"\s,}]+/gi, '$1***')
      .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***');
  }
  function rotate() {
    try {
      if (fs.statSync(file).size < MAX) return;
      try { fs.unlinkSync(`${file}.2`); } catch (_) { /* нет */ }
      try { fs.renameSync(`${file}.1`, `${file}.2`); } catch (_) { /* нет */ }
      fs.renameSync(file, `${file}.1`);
    } catch (_) { /* нет файла */ }
  }
  function write(level, scope, msg) {
    const line = `${new Date().toISOString().replace('T', ' ').slice(0, 19)} [${level}] ${scope ? scope + ': ' : ''}${scrub(msg)}\n`;
    try { rotate(); fs.appendFileSync(file, line); } catch (_) { /* ignore */ }
    if (process.env.L4_LOG_STDOUT === '1') process.stdout.write(line);
  }
  return {
    file, dir,
    info: (scope, m) => write('info', scope, m),
    warn: (scope, m) => write('warn', scope, m),
    error: (scope, m) => write('error', scope, m),
  };
}

module.exports = { createLogger };
