'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createCoreApi } = require('../src/main/api/core');
const { createBackend } = require('../src/main/api/backend');

/** fetch-заглушка: без сети и сокетов */
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => { if (body === undefined) throw new Error('empty'); return body; } });
const api = (fetch, token = 'tok') => createCoreApi({ url: 'http://core.test', fetch, getToken: async () => token, timeoutMs: 200 });

test('Core-клиент: Bearer-токен, JSON-тело, разворот { data }, публичный запрос без токена', async () => {
  const seen = [];
  const f = async (url, init) => { seen.push({ url, init }); return resp(200, { data: { x: 5 } }); };
  const c = api(f);
  assert.deepStrictEqual(await c.post('/v1/codes/redeem', { code: 'A' }), { ok: true, data: { x: 5 } });
  assert.strictEqual(seen[0].url, 'http://core.test/v1/codes/redeem');
  assert.strictEqual(seen[0].init.headers.Authorization, 'Bearer tok');
  assert.strictEqual(seen[0].init.body, '{"code":"A"}');
  await c.get('/v1/bootstrap', { auth: false });
  assert.ok(!('Authorization' in seen[1].init.headers), 'каталог — без токена');
  assert.strictEqual((await api(f, null).get('/v1/account/wallet')).code, 'invalid_session', 'нет токена — запрос не уходит');
  assert.strictEqual(seen.length, 2);
});

test('Core-клиент: коды ошибок сервера, 401, 404/5xx, 429, сеть, таймаут', async () => {
  const code = async (fetch) => (await api(fetch).get('/v1/x')).code;
  assert.strictEqual(await code(async () => resp(409, { error: 'promo_used' })), 'promo_used');
  assert.strictEqual(await code(async () => resp(410, { error: 'promo_expired' })), 'promo_expired');
  assert.strictEqual(await code(async () => resp(401, { error: 'invalid_token' })), 'invalid_session');
  assert.strictEqual(await code(async () => resp(404, {})), 'network_error', 'нет маршрута — API недоступен, не «неверная сессия»');
  assert.strictEqual(await code(async () => resp(502, undefined)), 'network_error');
  assert.strictEqual(await code(async () => resp(429, {})), 'busy');
  assert.strictEqual(await code(async () => resp(400, { error: 'какой-то_неизвестный' })), 'login_failed');
  assert.strictEqual(await code(async () => { throw new Error('offline'); }), 'network_error');
  assert.strictEqual(await code(async (_u, init) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => { const e = new Error('t'); e.name = 'AbortError'; rej(e); }))), 'timeout');
});

test('backend: bootstrap нормализует серверы и новости, отбрасывает битые адреса', async () => {
  const f = async () => resp(200, { data: { servers: [{ id: 'a', name: 'A', status: 'online', address: '1.2.3.4:22005', online: 3, max: 10 }, { id: 'b', name: 'B', address: 'no-port' }], news: [{ id: 1, title: 'T', date: '2026-10-01' }, { id: 2 }], client: { version: '1' }, notice: 'N', flags: { a: true } } });
  const r = await createBackend(api(f)).bootstrap();
  assert.ok(r.ok);
  assert.deepStrictEqual(r.data.servers.map((s) => s.id), ['a']);
  assert.deepStrictEqual(r.data.news.map((n) => n.title), ['T']);
  assert.deepStrictEqual([r.data.client, r.data.notice, r.data.flags], [{ version: '1' }, 'N', { a: true }]);
});

test('backend: операции раздела «Аккаунт» -> маршруты Core API', async () => {
  const seen = [];
  const f = async (url, init) => { seen.push(`${init.method} ${url.replace('http://core.test', '')}${init.body ? ' ' + init.body : ''}`); return resp(200, { data: {} }); };
  const b = createBackend(api(f));
  for (const op of ['security', 'sessions', 'history', 'wallet', 'characters']) await b.account(op);
  await b.account('revoke', { id: 'abc' }); await b.account('revokeOthers');
  assert.deepStrictEqual(seen, ['GET /v1/account/security', 'GET /v1/account/sessions', 'GET /v1/account/history', 'GET /v1/account/wallet', 'GET /v1/account/characters',
    'POST /v1/account/sessions/revoke {"id":"abc"}', 'POST /v1/account/sessions/revoke-others {}']);
  assert.strictEqual((await b.account('drop-database')).code, 'bad_request');
});

test('backend.fromCore: профиль Core API -> профиль лаунчера (роль, права, основной персонаж)', () => {
  const b = createBackend({ fns: {}, call: async () => ({ ok: false }) });
  const p = b.fromCore({ login: 'dante', email: 'd@x.io', balance4c: 40, accountStatus: 'banned', role: { alvl: 3, title: 'Администратор 3 уровня', rank: 'Администратор', isStaff: true }, permissions: ['admin.panel', 'players.view'], characters: [{ name: 'Low One', level: 1 }, { name: 'Dante R', level: 9 }] });
  assert.strictEqual(p.username, 'dante'); assert.strictEqual(p.gameName, 'Dante R'); assert.strictEqual(p.level, 9); assert.strictEqual(p.balance4c, 40);
  assert.strictEqual(p.role, 'Администратор 3 уровня'); assert.strictEqual(p.roleInfo.alvl, 3); assert.deepStrictEqual(p.permissions, ['admin.panel', 'players.view']);
  assert.strictEqual(p.accountStatus, 'banned');
  const g = b.fromCore({ login: 'x' });
  assert.strictEqual(g.role, 'Игрок'); assert.strictEqual(g.roleInfo.alvl, 0); assert.deepStrictEqual(g.permissions, []); assert.strictEqual(g.gameName, '');
  assert.strictEqual(b.fromCore(null).role, 'Игрок');
});
