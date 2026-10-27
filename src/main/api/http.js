'use strict';
const { fail, ok, ERRORS } = require('../../core/contract');
const config = require('../config');

/**
 * Общий транспорт к Core API: таймаут, JSON, разбор ошибок в коды лаунчера.
 * Ответ сервера { error: "<код>" }: если код есть в ERRORS (promo_used, bad_request…), он и возвращается как есть;
 * invalid_grant/invalid_token — «сессия недействительна»; 5xx и 404 — сервер недоступен (не «неверная сессия»).
 */
function createHttp(opts) {
  const o = opts || {};
  const base = (o.url || config.core.url).replace(/\/+$/, '');
  const timeoutMs = o.timeoutMs || config.core.timeoutMs;
  const doFetch = o.fetch || globalThis.fetch;
  const log = o.log;

  async function request(path, init) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try { res = await doFetch(`${base}${path}`, Object.assign({ signal: ctrl.signal, cache: 'no-store' }, init)); }
    catch (e) {
      clearTimeout(t);
      if (log) log.warn('core', `${path}: ${e && e.name === 'AbortError' ? 'timeout' : (e && e.message)}`);
      return fail(e && e.name === 'AbortError' ? 'timeout' : 'network_error');
    }
    clearTimeout(t);
    let json = null; try { json = await res.json(); } catch (_) { /* пустое тело */ }
    if (res.ok) return ok(json);
    const code = json && typeof json.error === 'string' ? json.error : '';
    if (log) log.warn('core', `${path}: HTTP ${res.status} ${code}`);
    if (code === 'invalid_grant' || code === 'invalid_token') return fail('invalid_session', { status: res.status });
    if (code && Object.prototype.hasOwnProperty.call(ERRORS, code)) return fail(code, { status: res.status });
    if (res.status >= 500 || res.status === 404) return fail('network_error', { status: res.status });
    if (res.status === 429) return fail('busy', { status: res.status });
    return fail('login_failed', { status: res.status });
  }

  return { request, base };
}

module.exports = { createHttp };
