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
function resolveExternal(key) {
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

module.exports = { isAllowedExternal, resolveExternal, CSP, senderAllowed };
