'use strict';
const { fail } = require('../../core/contract');
const { createHttp } = require('./http');

/**
 * Клиент API данных (Core API, /v1/*): каталог, промокоды, аккаунт. Токен берёт у сессии при каждом вызове
 * (getToken возвращает свежий access или null), поэтому устаревший токен обновляется до запроса.
 */
function createCoreApi(opts) {
  const o = opts || {};
  const http = createHttp(o);
  const getToken = o.getToken || (async () => null);

  async function call(method, path, body, { auth = true } = {}) {
    const headers = { Accept: 'application/json' };
    if (auth) {
      const token = await getToken();
      if (!token) return fail('invalid_session');
      headers.Authorization = `Bearer ${token}`;
    }
    const init = { method, headers };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    const r = await http.request(path, init);
    return r.ok ? { ok: true, data: r.data && r.data.data !== undefined ? r.data.data : r.data } : r;
  }

  return {
    get: (path, opt) => call('GET', path, undefined, opt),
    post: (path, body) => call('POST', path, body || {}),
  };
}

module.exports = { createCoreApi };
