'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');
const { load } = require('../src/config');
const { hashPassword } = require('../src/passwords');
const { pkceChallenge, randomToken } = require('../src/tokens');
const { createMemoryStore } = require('../src/store');
const { createApp } = require('../src/server');

const SITE = 'https://www.4onerp.com';
const ENV = { CORE_STORE: 'memory', CORE_SITE_REDIRECTS: `${SITE}/auth/callback,http://localhost:3000/auth/callback` };
let HANDLER;
function call(method, url, { headers = {}, body, token } = {}) {
  const h = { ...headers }; if (token) h.authorization = `Bearer ${token}`;
  let raw; if (body !== undefined) { raw = typeof body === 'string' ? body : JSON.stringify(body); h['content-type'] = typeof body === 'string' ? 'application/x-www-form-urlencoded' : 'application/json'; }
  return new Promise((resolve) => {
    const req = Readable.from(raw ? [Buffer.from(raw)] : []);
    Object.assign(req, { method, url, headers: h, socket: { remoteAddress: '198.51.100.9' } });
    HANDLER(req, { headersSent: false, writeHead(s, hh) { this.status = s; this.h = Object.fromEntries(Object.entries(hh || {}).map(([k, v]) => [k.toLowerCase(), v])); this.headersSent = true; }, end(p) { let j = null; try { j = JSON.parse(p); } catch (_) { /* html */ } resolve({ status: this.status, h: this.h, text: p || '', json: j }); } });
  });
}
function boot(env = ENV) {
  const config = load(env);
  const store = createMemoryStore({ accounts: [{ login: 'marcus', email: 'm@x.io', passwordHash: hashPassword('Secret-1', 1000), socialClub: 'SC', alvl: 3 }] });
  HANDLER = createApp({ store, config }).handler;
  return config;
}

test('конфиг: сайт добавляется списком адресов возврата, CORS выводится из них', () => {
  const c = load(ENV);
  assert.deepEqual(c.clients['4one-site'].redirectUris, [`${SITE}/auth/callback`, 'http://localhost:3000/auth/callback']);
  assert.ok(c.clients['4one-launcher'], 'лаунчер остаётся');
  assert.deepEqual(c.corsOrigins.sort(), ['http://localhost:3000', SITE].sort());
  assert.deepEqual(load({ CORE_STORE: 'memory' }).corsOrigins, [], 'без сайта CORS закрыт');
  assert.ok(load({ ...ENV, CORE_CORS_ORIGINS: 'https://admin.4onerp.com/' }).corsOrigins.includes('https://admin.4onerp.com'));
  assert.throws(() => load({ ...ENV, CORE_SITE_REDIRECTS: 'not a url' }), /CORE_SITE_REDIRECTS/);
});

async function siteLogin(verifier, extra = {}) {
  const q = new URLSearchParams({ response_type: 'code', client_id: '4one-site', redirect_uri: `${SITE}/auth/callback`, state: 'site-state', code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256', ...extra });
  const page = await call('GET', `/oauth/authorize?${q}`);
  const tx = /name="tx" value="([^"]+)"/.exec(page.text)?.[1];
  return { page, tx };
}

test('сайт: страница входа разрешает переход на свой адрес (form-action), вход -> 302 на сайт с code и state', async () => {
  boot();
  const verifier = randomToken(48);
  const { page, tx } = await siteLogin(verifier);
  assert.equal(page.status, 200);
  assert.match(page.h['content-security-policy'], /form-action 'self' https:\/\/www\.4onerp\.com;/);
  const done = await call('POST', '/oauth/authorize', { body: new URLSearchParams({ tx, login: 'marcus', password: 'Secret-1' }).toString() });
  assert.equal(done.status, 302);
  const loc = new URL(done.h.location);
  assert.equal(loc.origin + loc.pathname, `${SITE}/auth/callback`); assert.equal(loc.searchParams.get('state'), 'site-state');
  const t = await call('POST', '/oauth/token', { headers: { origin: SITE }, body: { grant_type: 'authorization_code', client_id: '4one-site', code: loc.searchParams.get('code'), redirect_uri: `${SITE}/auth/callback`, code_verifier: verifier } });
  assert.equal(t.status, 200); assert.equal(t.h['access-control-allow-origin'], SITE);
  const me = await call('GET', '/v1/me', { token: t.json.access_token, headers: { origin: SITE } });
  assert.equal(me.status, 200); assert.equal(me.json.data.role.title, 'Администратор 3 уровня'); assert.equal(me.h['access-control-allow-origin'], SITE);
});

test('сайт: адрес возврата лаунчера не подходит клиенту сайта и наоборот', async () => {
  boot();
  const v = randomToken(48);
  assert.equal((await siteLogin(v, { redirect_uri: 'gta4one://auth/callback' })).page.status, 400);
  const q = new URLSearchParams({ response_type: 'code', client_id: '4one-launcher', redirect_uri: `${SITE}/auth/callback`, state: 's', code_challenge: pkceChallenge(v), code_challenge_method: 'S256' });
  assert.equal((await call('GET', `/oauth/authorize?${q}`)).status, 400);
});

test('история входов: вход с сайта помечается method=site', async () => {
  boot();
  const v = randomToken(48); const { tx } = await siteLogin(v);
  const done = await call('POST', '/oauth/authorize', { body: new URLSearchParams({ tx, login: 'marcus', password: 'Secret-1' }).toString() });
  const code = new URL(done.h.location).searchParams.get('code');
  const t = await call('POST', '/oauth/token', { body: { grant_type: 'authorization_code', client_id: '4one-site', code, redirect_uri: `${SITE}/auth/callback`, code_verifier: v } });
  const h = await call('GET', '/v1/account/history', { token: t.json.access_token });
  assert.equal(h.json.data[0].method, 'site');
});

test('CORS: preflight только для разрешённых источников; чужой источник заголовков не получает', async () => {
  boot();
  const ok = await call('OPTIONS', '/v1/me', { headers: { origin: SITE, 'access-control-request-method': 'GET' } });
  assert.equal(ok.status, 204); assert.equal(ok.h['access-control-allow-origin'], SITE); assert.match(ok.h['access-control-allow-headers'], /Authorization/);
  assert.equal((await call('OPTIONS', '/v1/me', { headers: { origin: 'https://evil.example' } })).status, 403);
  const evil = await call('GET', '/v1/bootstrap', { headers: { origin: 'https://evil.example' } });
  assert.equal(evil.status, 200); assert.equal(evil.h['access-control-allow-origin'], undefined);
  assert.equal((await call('GET', '/oauth/authorize?x=1', { headers: { origin: SITE } })).h['access-control-allow-origin'], undefined, 'страница входа не отдаётся скриптам чужих страниц');
});

test('без настроек сайта: CORS выключен совсем', async () => {
  boot({ CORE_STORE: 'memory' });
  const r = await call('GET', '/v1/bootstrap', { headers: { origin: SITE } });
  assert.equal(r.h['access-control-allow-origin'], undefined);
});

test('.env: читается без зависимостей, окружение не перезаписывается', () => {
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const f = path.join(os.tmpdir(), `core-env-${process.pid}.env`);
  fs.writeFileSync(f, '# комментарий\nTEST_CORE_A=один\nTEST_CORE_B="два три"  \nTEST_CORE_C=x # хвост\nTEST_CORE_KEEP=из_файла\n');
  process.env.TEST_CORE_KEEP = 'из_окружения';
  assert.equal(require('../src/dotenv').loadDotEnv(f), true);
  assert.equal(process.env.TEST_CORE_A, 'один'); assert.equal(process.env.TEST_CORE_B, 'два три'); assert.equal(process.env.TEST_CORE_C, 'x');
  assert.equal(process.env.TEST_CORE_KEEP, 'из_окружения');
  assert.equal(require('../src/dotenv').loadDotEnv(f + '.нет'), false);
  fs.unlinkSync(f);
});
