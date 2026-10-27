'use strict';
const config = require('./config');

/**
 * gta4one://auth/callback?code=…&state=…  ->  { type:'auth-callback', code, state } ; всё остальное отбрасываем.
 * Код и state — случайные base64url-строки Core API (OAuth), поэтому допускаем только их алфавит.
 */
function parseDeepLink(raw) {
  try {
    const u = new URL(String(raw));
    if (u.protocol !== `${config.protocol}:`) return null;
    const type = `${u.hostname}${u.pathname}`.replace(/\/+$/, '');
    if (type === 'auth/callback') {
      const code = u.searchParams.get('code') || ''; const state = u.searchParams.get('state') || '';
      const ok = /^[A-Za-z0-9\-_]{16,128}$/;
      return ok.test(code) && ok.test(state) ? { type: 'auth-callback', code, state } : null;
    }
    return null;
  } catch (_) { return null; }
}

/** Ссылка из argv второго экземпляра (Windows передаёт её последним аргументом) */
function findDeepLink(argv) {
  return (argv || []).find((a) => typeof a === 'string' && a.startsWith(`${config.protocol}://`)) || null;
}

module.exports = { parseDeepLink, findDeepLink };
