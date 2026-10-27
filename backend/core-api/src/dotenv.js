'use strict';
const fs = require('fs');
const path = require('path');

/** Читает .env из папки сервиса (KEY=value, # комментарии, кавычки). Уже заданные переменные окружения не перезаписывает. */
function loadDotEnv(file = path.join(__dirname, '..', '.env')) {
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return false; }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line); if (!m) continue;
    let v = m[2].trim();
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1); else v = v.replace(/\s+#.*$/, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
  return true;
}
module.exports = { loadDotEnv };
