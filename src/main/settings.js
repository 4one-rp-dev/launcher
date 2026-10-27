'use strict';
const fs = require('fs');
const path = require('path');

/** Описание настроек: тип и значение по умолчанию. Всё, чего нет в схеме, отбрасывается. */
const SCHEMA = {
  gamePath: { type: 'string', def: '' },
  selectedServerId: { type: 'string', def: '' },
  closeAfterStart: { type: 'boolean', def: false },
  minimizeToTray: { type: 'boolean', def: true },
  autostart: { type: 'boolean', def: false },
  autoUpdates: { type: 'boolean', def: true },
  noBattleye: { type: 'boolean', def: true },   // запись -nobattleye в commandline.txt (как в старом лаунчере); TODO: подтвердить необходимость
  syncMods: { type: 'boolean', def: true },
  playMinutes: { type: 'number', def: 0 },
  lastSeenNews: { type: 'string', def: '' },
  lang: { type: 'string', def: 'ru', enum: ['ru', 'en'] },  // язык интерфейса
  accent: { type: 'string', def: 'violet' },
  scale: { type: 'string', def: 'auto', enum: ['auto', '90', '100', '110', '125', '150'] }, // масштаб интерфейса
  animations: { type: 'boolean', def: true },    // выключить — без анимаций и переходов
  toasts: { type: 'boolean', def: true },        // информационные всплывашки (ошибки показываются всегда)
  newsBadge: { type: 'boolean', def: true },     // счётчик непрочитанных новостей     // violet | mint | rose | sky — акцент интерфейса
};

function defaults() { const o = {}; for (const k of Object.keys(SCHEMA)) o[k] = SCHEMA[k].def; return o; }

function sanitize(input, base) {
  const out = Object.assign({}, base || defaults());
  for (const k of Object.keys(SCHEMA)) {
    if (!input || !(k in input)) continue;
    const v = input[k];
    if (typeof v === SCHEMA[k].type && (SCHEMA[k].type !== 'string' || v.length < 1024)
        && (SCHEMA[k].type !== 'number' || Number.isFinite(v))
        && (!SCHEMA[k].enum || SCHEMA[k].enum.includes(v))) out[k] = v;
  }
  return out;
}

/** Хранилище настроек: JSON в userData, запись атомарная (tmp + rename). */
function createSettings(dir, hooks) {
  const file = path.join(dir, 'settings.json');
  let cur = defaults();
  try { cur = sanitize(JSON.parse(fs.readFileSync(file, 'utf8')), cur); } catch (_) { /* первый запуск */ }
  let timer = null;

  function flush() {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(cur, null, 2));
      fs.renameSync(tmp, file);
    } catch (_) { /* ignore */ }
  }
  return {
    file,
    get: () => Object.assign({}, cur),
    async set(patch) {
      const before = cur;
      cur = sanitize(patch, cur);
      clearTimeout(timer); timer = setTimeout(flush, 150);
      if (hooks && hooks.onChange) hooks.onChange(cur, before);
      return Object.assign({}, cur);
    },
    /** Сброс интерфейсных и игровых настроек; путь к GTA, выбранный сервер и счётчики остаются */
    async reset() {
      const keep = {}; for (const k of ['gamePath', 'selectedServerId', 'lastSeenNews', 'playMinutes']) keep[k] = cur[k];
      const before = cur; cur = Object.assign(defaults(), keep);
      clearTimeout(timer); timer = setTimeout(flush, 150);
      if (hooks && hooks.onChange) hooks.onChange(cur, before);
      return Object.assign({}, cur);
    },
    flush,
  };
}

module.exports = { createSettings, sanitize, defaults, SCHEMA };
