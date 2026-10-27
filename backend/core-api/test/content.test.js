'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');
const { load } = require('../src/config');
const { hashPassword } = require('../src/passwords');
const { pkceChallenge, randomToken } = require('../src/tokens');
const { createMemoryStore } = require('../src/store');
const { createApp } = require('../src/server');
const { maskIp } = require('../src/services');

let HANDLER = null;
function inject({ method, url, headers, body, ip }) {
  return new Promise((resolve) => {
    const req = Readable.from(body ? [Buffer.from(body)] : []);
    Object.assign(req, { method, url, headers, socket: { remoteAddress: ip || '203.0.113.45' } });
    HANDLER(req, { headersSent: false, writeHead(s, h) { this.status = s; this.h = h; this.headersSent = true; }, end(p) { resolve({ status: this.status, text: p || '' }); } });
  });
}
async function call(method, path, { token, body, headers, ip } = {}) {
  const h = { ...(headers || {}) };
  if (token) h.authorization = `Bearer ${token}`;
  let raw; if (body !== undefined) { raw = typeof body === 'string' ? body : JSON.stringify(body); h['content-type'] = typeof body === 'string' ? 'application/x-www-form-urlencoded' : 'application/json'; }
  const r = await inject({ method, url: path, headers: h, body: raw, ip });
  let json = null; try { json = JSON.parse(r.text); } catch (_) { /* html */ }
  return { status: r.status, json, text: r.text };
}

const NOW = new Date('2026-10-27T12:00:00Z');
function seed() {
  return {
    accounts: [
      { login: 'marcus', email: 'm@x.io', passwordHash: hashPassword('Secret-1', 1000), socialClub: 'MarcusSC', redbucks: 1000, lastAt: '2026-10-26T20:00:00Z',
        characters: [{ id: 1, name: 'Marcus Reed', level: 7, cash: 4800, bank: 31000 }] },
      { login: 'dante', email: 'd@x.io', passwordHash: hashPassword('Dante-pw1', 1000), socialClub: 'DanteSC', redbucks: 5 },
    ],
    servers: [
      { id: 'main', name: '4ONE RP', tag: 'MAIN', status: 'online', online: 37, max_players: 500, address: '127.0.0.1:22005', version: '1.0.3889.0', description: 'Основной', recommended: true, sort: 1 },
      { id: 'test', name: 'Тест', tag: 'TEST', status: 'maintenance', online: 0, max_players: 50, address: '', sort: 2 },
      { id: 'hidden', name: 'Скрытый', status: 'online', published: false, sort: 0 },
    ],
    news: [
      { title: 'Старое', excerpt: 'a', category: 'news', date: '2026-09-01' },
      { title: 'Новое', excerpt: 'b', category: 'updates', date: '2026-10-18', cover: 'sultan', url: 'https://www.4onerp.com/news/1' },
    ],
    settings: { client: JSON.stringify({ version: '1.0.7', manifestUrl: 'https://cdn.example/client/manifest.json', notes: 'Исправления' }), notice: 'Техработы в 04:00', flags: JSON.stringify({ newsBadge: true }) },
    promos: [
      { code: 'WELCOME4', title: 'Приветственный бонус', amount: 100 },
      { code: 'OLD00000', title: 'Старый', amount: 50, expiresAt: '2026-01-01T00:00:00Z' },
      { code: 'ONLYONE1', title: 'Один на всех', amount: 10, maxUses: 1 },
      { code: 'OFF00000', title: 'Выключен', amount: 10, enabled: false },
    ],
  };
}
function boot(opts = {}) {
  const config = { ...load({ CORE_STORE: 'memory' }), ...(opts.config || {}) };
  const store = createMemoryStore(seed());
  HANDLER = createApp({ store, config, now: () => NOW }).handler;
  return { store, config };
}
async function login(user, pass, device, ip) {
  const verifier = randomToken(48); const base = '/oauth/authorize';
  const q = new URLSearchParams({ response_type: 'code', client_id: '4one-launcher', redirect_uri: 'gta4one://auth/callback', state: 'st-1', code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256', device_name: device || 'PC · Windows' });
  const page = await call('GET', `${base}?${q}`, { ip });
  const tx = /name="tx" value="([^"]+)"/.exec(page.text)[1];
  const done = await call('POST', base, { body: new URLSearchParams({ tx, login: user, password: pass }).toString(), ip });
  const m = /code=([^&"]+)&amp;state=st-1/.exec(done.text); if (!m) return null;
  const t = await call('POST', '/oauth/token', { body: { grant_type: 'authorization_code', client_id: '4one-launcher', code: decodeURIComponent(m[1]), redirect_uri: 'gta4one://auth/callback', code_verifier: verifier }, ip });
  return t.json;
}

test('bootstrap: серверы (без скрытых, по порядку), свежие новости, клиент, объявление, флаги — без токена', async () => {
  boot();
  const r = await call('GET', '/v1/bootstrap');
  assert.equal(r.status, 200);
  const d = r.json.data;
  assert.deepEqual(d.servers.map((s) => s.id), ['main', 'test']);
  assert.deepEqual(d.servers[0], { id: 'main', name: '4ONE RP', tag: 'MAIN', status: 'online', online: 37, max: 500, address: '127.0.0.1:22005', version: '1.0.3889.0', description: 'Основной', recommended: true });
  assert.deepEqual(d.news.map((n) => n.title), ['Новое', 'Старое']);
  assert.equal(d.news[0].date, '2026-10-18'); assert.equal(d.news[0].cover, 'sultan');
  assert.deepEqual(d.client, { version: '1.0.7', manifestUrl: 'https://cdn.example/client/manifest.json', notes: 'Исправления' });
  assert.equal(d.notice, 'Техработы в 04:00'); assert.deepEqual(d.flags, { newsBadge: true });
});
test('bootstrap: битые настройки не ломают ответ', async () => {
  const { store } = boot(); store._content.settings.set('client', '{oops'); store._content.settings.set('flags', '[1]');
  const d = (await call('GET', '/v1/bootstrap')).json.data;
  assert.equal(d.client, null); assert.deepEqual(d.flags, {}); // битый JSON и массив вместо объекта игнорируются
});

test('промокод: награда, повтор, срок, лимит, выключен, мусор', async () => {
  boot();
  const t = await login('marcus', 'Secret-1');
  const redeem = (code, tok = t.access_token) => call('POST', '/v1/codes/redeem', { token: tok, body: { code } });
  const ok = await redeem('welcome4');
  assert.equal(ok.status, 200);
  assert.equal(ok.json.data.code, 'WELCOME4'); assert.deepEqual(ok.json.data.reward, { kind: 'coins', amount: 100 }); assert.equal(ok.json.data.title, 'Приветственный бонус');
  assert.equal((await redeem('WELCOME4')).json.error, 'promo_used');
  assert.equal((await redeem('OLD00000')).json.error, 'promo_expired');
  assert.equal((await redeem('OFF00000')).json.error, 'promo_not_found');
  assert.equal((await redeem('NOSUCH12')).json.error, 'promo_not_found');
  for (const bad of ['', 'a', '<script>', 'A'.repeat(40), null, 42]) assert.equal((await redeem(bad)).json.error, 'promo_not_found', String(bad));
  // лимит: «ONLYONE1» заберёт первый, второй аккаунт получит promo_limit
  assert.equal((await redeem('ONLYONE1')).status, 200);
  const d = await login('dante', 'Dante-pw1');
  assert.equal((await redeem('ONLYONE1', d.access_token)).json.error, 'promo_limit');
  assert.equal((await redeem('WELCOME4', d.access_token)).status, 200, 'другому аккаунту тот же код доступен');
});
test('промокод: HTTP-статусы и тексты', async () => {
  boot(); const t = await login('marcus', 'Secret-1');
  const r = (c) => call('POST', '/v1/codes/redeem', { token: t.access_token, body: { code: c } });
  assert.equal((await r('OLD00000')).status, 410); assert.equal((await r('NOSUCH12')).status, 404);
  await r('WELCOME4'); const again = await r('WELCOME4'); assert.equal(again.status, 409); assert.equal(again.json.error_description, 'Вы уже активировали этот код.');
});
test('промокод: без токена 401; перебор упирается в лимит', async () => {
  boot();
  assert.equal((await call('POST', '/v1/codes/redeem', { body: { code: 'WELCOME4' } })).status, 401);
  const t = await login('marcus', 'Secret-1');
  let last; for (let i = 0; i < 12; i++) last = await call('POST', '/v1/codes/redeem', { token: t.access_token, body: { code: `NOSUCH${String(i).padStart(2, '0')}` } });
  assert.equal(last.status, 429); assert.equal(last.json.error, 'busy');
});
test('кошелёк: зачисление видно в балансе сразу (ожидает игру), в журнале и в истории кодов; баланс в профиле тот же', async () => {
  const { store } = boot(); const t = await login('marcus', 'Secret-1');
  await call('POST', '/v1/codes/redeem', { token: t.access_token, body: { code: 'WELCOME4' } });
  const w = (await call('GET', '/v1/account/wallet', { token: t.access_token })).json.data;
  assert.equal(w.balance, 1100); assert.equal(w.items.length, 1); assert.equal(w.items[0].amount, 100); assert.equal(w.items[0].title, 'Приветственный бонус');
  const me = (await call('GET', '/v1/me', { token: t.access_token })).json.data; assert.equal(me.balance4c, 1100);
  const h = (await call('GET', '/v1/codes/history', { token: t.access_token })).json.data;
  assert.deepEqual(h.map((x) => [x.code, x.reward.amount]), [['WELCOME4', 100]]);
  // игра применила зачисление: redbucks вырос, «ожидание» сняли — баланс не удваивается
  const acc = await store.getAccount('marcus'); acc.redbucks += 100; await store.markApplied(w.items[0].id, NOW);
  assert.equal((await call('GET', '/v1/account/wallet', { token: t.access_token })).json.data.balance, 1100);
});

test('аккаунт: безопасность, персонажи', async () => {
  boot(); const t = await login('marcus', 'Secret-1');
  const s = (await call('GET', '/v1/account/security', { token: t.access_token })).json.data;
  assert.equal(s.passwordSet, true); assert.deepEqual(s.links, [{ provider: 'socialclub', linked: true, label: 'MarcusSC' }]);
  assert.ok(!JSON.stringify(s).includes('Secret'));
  const c = (await call('GET', '/v1/account/characters', { token: t.access_token })).json.data;
  assert.deepEqual(c, [{ id: '1', name: 'Marcus Reed', level: 7, job: '', cash: 4800, bank: 31000, lastAt: '2026-10-26T20:00:00.000Z' }]);
});
test('аккаунт: сессии — список с текущей, отзыв чужой, нельзя текущую и сессию другого аккаунта', async () => {
  boot();
  const a = await login('marcus', 'Secret-1', 'HOME-PC · Windows'); const b = await login('marcus', 'Secret-1', 'LAPTOP · Windows'); const other = await login('dante', 'Dante-pw1');
  const list = (await call('GET', '/v1/account/sessions', { token: a.access_token })).json.data;
  assert.equal(list.length, 2); assert.equal(list.filter((x) => x.current).length, 1);
  assert.deepEqual(list.map((x) => x.device).sort(), ['HOME-PC', 'LAPTOP']); assert.equal(list[0].os, 'Windows');
  const mine = list.find((x) => x.current).id; const second = list.find((x) => !x.current).id;
  const dl = (await call('GET', '/v1/account/sessions', { token: other.access_token })).json.data[0].id;
  const rev = (id) => call('POST', '/v1/account/sessions/revoke', { token: a.access_token, body: { id } });
  assert.equal((await rev(mine)).status, 400, 'текущую нельзя');
  assert.equal((await rev(dl)).status, 400, 'чужую нельзя');
  assert.equal((await rev('zzz')).status, 400); assert.equal((await rev(undefined)).status, 400);
  assert.equal((await rev(second)).status, 200);
  assert.equal((await call('GET', '/v1/me', { token: b.access_token })).status, 401, 'отозванная сессия больше не работает');
  assert.equal((await call('GET', '/v1/me', { token: other.access_token })).status, 200, 'чужая цела');
});
test('аккаунт: завершить все остальные', async () => {
  boot();
  const a = await login('marcus', 'Secret-1'); const b = await login('marcus', 'Secret-1'); const c = await login('marcus', 'Secret-1');
  assert.equal((await call('POST', '/v1/account/sessions/revoke-others', { token: a.access_token })).status, 200);
  assert.equal((await call('GET', '/v1/me', { token: a.access_token })).status, 200);
  assert.equal((await call('GET', '/v1/me', { token: b.access_token })).status, 401); assert.equal((await call('GET', '/v1/me', { token: c.access_token })).status, 401);
});
test('аккаунт: история входов — успехи и неудачи, IP маскирован', async () => {
  boot();
  await login('marcus', 'wrong-pass', 'PC · Windows', '198.51.100.77');
  const t = await login('marcus', 'Secret-1', 'PC · Windows', '198.51.100.77');
  const h = (await call('GET', '/v1/account/history', { token: t.access_token })).json.data;
  assert.deepEqual(h.map((e) => e.ok).sort(), [false, true]);
  for (const e of h) { assert.equal(e.ip, '198.51.100.x'); assert.equal(e.method, 'launcher'); assert.equal(e.device, 'PC · Windows'); }
  assert.ok(!JSON.stringify(h).includes('198.51.100.77'));
  assert.equal(maskIp('::ffff:10.1.2.3'), '10.1.2.x'); assert.equal(maskIp('2001:db8:1:2::5'), '2001:db8:1::x'); assert.equal(maskIp('weird'), '');
});
test('аккаунт: без токена 401, неизвестный раздел 404, чужие данные недоступны', async () => {
  boot();
  for (const p of ['security', 'sessions', 'history', 'wallet', 'characters']) assert.equal((await call('GET', `/v1/account/${p}`)).status, 401, p);
  const t = await login('dante', 'Dante-pw1');
  assert.equal((await call('GET', '/v1/account/nope', { token: t.access_token })).status, 404);
  assert.equal((await call('GET', '/v1/account/characters', { token: t.access_token })).json.data.length, 0, 'у dante нет персонажей marcus');
  assert.equal((await call('GET', '/v1/account/wallet', { token: t.access_token })).json.data.balance, 5);
});

test('внутренний маршрут: онлайн сервера — только с секретом', async () => {
  boot({ config: { internalToken: 's'.repeat(32) } });
  const url = '/v1/internal/servers/main/stats';
  assert.equal((await call('POST', url, { body: { online: 99 } })).status, 404, 'без секрета маршрута нет');
  assert.equal((await call('POST', url, { body: { online: 99 }, headers: { 'x-internal-token': 'x'.repeat(32) } })).status, 404);
  const ok = await call('POST', url, { body: { online: 99, status: 'online', max: 600 }, headers: { 'x-internal-token': 's'.repeat(32) } });
  assert.equal(ok.status, 200);
  const main = (await call('GET', '/v1/bootstrap')).json.data.servers.find((s) => s.id === 'main');
  assert.equal(main.online, 99); assert.equal(main.max, 600);
  const bad = (body) => call('POST', url, { body, headers: { 'x-internal-token': 's'.repeat(32) } });
  assert.equal((await bad({ online: -1 })).status, 400); assert.equal((await bad({ status: 'weird' })).status, 400); assert.equal((await bad({ online: 'many' })).status, 400);
  assert.equal((await call('POST', '/v1/internal/servers/nope/stats', { body: { online: 1 }, headers: { 'x-internal-token': 's'.repeat(32) } })).status, 404);
});
test('внутренний маршрут выключен, пока CORE_INTERNAL_TOKEN не задан (или короче 16 знаков)', async () => {
  boot({ config: { internalToken: '' } });
  assert.equal((await call('POST', '/v1/internal/servers/main/stats', { body: { online: 1 }, headers: { 'x-internal-token': '' } })).status, 404);
  boot({ config: { internalToken: 'short' } });
  assert.equal((await call('POST', '/v1/internal/servers/main/stats', { body: { online: 1 }, headers: { 'x-internal-token': 'short' } })).status, 404);
});
