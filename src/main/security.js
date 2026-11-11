'use strict';
const config = require('./config');

/** Разрешён ли переход по внешней ссылке (только https и только известные хосты) */
function isAllowedExternal(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return config.externalHostAllowlist.includes(u.hostname);
  } catch (_) { return false; }
}

/** key — ключ из config.links или полный URL из данных сервера (новости) */
/**
 * Ссылки разделов (Discord, донат, правила…) можно задать на сервере без новой версии лаунчера:
 * core_settings.flags = {"links": {"discord": "https://discord.gg/…"}}. Принимаем только https и только известные ключи.
 */
let dynamicLinks = {};
function setLinks(obj) {
  const out = {};
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(config.links)) {
      const v = obj[k];
      try { if (typeof v === 'string' && v.length < 512 && new URL(v).protocol === 'https:') out[k] = v; } catch (_) { /* не URL */ }
    }
  }
  dynamicLinks = out;
}
/** Какие ссылки действительно настроены (сайт есть всегда) — интерфейс прячет остальные кнопки. */
function configuredLinks() { return Object.assign({ site: config.links.site }, dynamicLinks); }

function resolveExternal(key) {
  if (Object.prototype.hasOwnProperty.call(dynamicLinks, key)) return dynamicLinks[key];
  if (Object.prototype.hasOwnProperty.call(config.links, key)) return config.links[key];
  return isAllowedExternal(key) ? key : null;
}

/** Содержимое CSP для renderer/index.html дублируется в <meta>, здесь — для заголовков (на случай loadURL) */
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'";

/** Принимаем IPC только от нашего окна и нашего файла */
function senderAllowed(event, win, rendererUrlPrefix) {
  if (!win || win.isDestroyed()) return false;
  if (event.sender !== win.webContents) return false;
  const url = event.senderFrame && event.senderFrame.url || '';
  return url.startsWith(rendererUrlPrefix);
}

module.exports = { isAllowedExternal, resolveExternal, setLinks, configuredLinks, CSP, senderAllowed };
