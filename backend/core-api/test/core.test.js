'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { Readable } = require('stream');
const { load, isAllowedRedirect } = require('../src/config');
const roles = require('../src/roles');
const { hashPassword, verifyPassword, legacySha256 } = require('../src/passwords');
const { pkceChallenge, verifyPkce, randomToken, sign, unsign } = require('../src/tokens');
const { createMemoryStore } = require('../src/store');
const { createApp } = require('../src/server');

// ---------- роли
test('роль: игрок и администратор n уровня', () => {
  assert.equal(roles.describe(0).title, 'Игрок');
  assert.equal(roles.describe(0).isStaff, false);
  const a = roles.describe(3);
  assert.equal(a.title, 'Администратор 3 уровня');
  assert.equal(a.rank, 'Администратор');
  assert.equal(roles.describe(8).rank, 'Руководство проекта');
});
test('роль: значения вне диапазона и мусор', () => {
  assert.equal(roles.clamp(99), 8); assert.equal(roles.clamp(-5), 0); assert.equal(roles.clamp('x'), 0); assert.equal(roles.clamp(2.9), 2);
});
test('права растут с уровнем, логи — с 5 уровня', () => {
  assert.deepEqual(roles.permissionsFor(0), []);
  assert.ok(roles.can(1, 'admin.panel')); assert.ok(!roles.can(4, 'logs.view')); assert.ok(roles.can(5, 'logs.view'));
  assert.ok(roles.permissionsFor(8).includes('owner'));
});

// ---------- пароли (формат игры)
test('пароль: новый формат p2$ круг туда-обратно', () => {
  const h = hashPassword('Секрет123', 1000);
  assert.ok(h.startsWith('p2$1000$'));
  assert.ok(verifyPassword('Секрет123', h)); assert.ok(!verifyPassword('секрет123', h)); assert.ok(!verifyPassword('', h));
});
test('пароль: старый SHA-256 по ASCII (русские буквы -> «?»)', () => {
  const sha = crypto.createHash('sha256').update('password').digest('hex');
  assert.equal(sha, '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8');
  assert.ok(verifyPassword('password', sha));
  assert.equal(legacySha256('пароль'), crypto.createHash('sha256').update('??????').digest('hex'));
  assert.ok(verifyPassword('ПАРОЛЬ', legacySha256('пароль')), 'как в игре: русские пароли одной длины совпадают');
});
test('пароль: битые хеши не падают', () => {
  for (const bad of ['', 'p2$', 'p2$x$y$z', 'p2$0$AA==$AA==', 'p2$100000$$']) assert.equal(verifyPassword('a', bad), false);
});

// ---------- PKCE и подпись
test('PKCE S256: эталон из RFC 7636', () => {
  const v = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  assert.equal(pkceChallenge(v), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  assert.ok(verifyPkce(v, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'));
  assert.ok(!verifyPkce(v + 'x', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'));
  assert.ok(!verifyPkce('short', pkceChallenge('short')));
});
test('подпись формы: подмена и срок', () => {
  const t = sign('s'.repeat(32), { a: 1, exp: 2000 });
  assert.deepEqual(unsign('s'.repeat(32), t, 1000), { a: 1, exp: 2000 });
  assert.equal(unsign('s'.repeat(32), t, 3000), null);
  assert.equal(unsign('x'.repeat(32), t, 1000), null);
  assert.equal(unsign('s'.repeat(32), t.replace(/^./, 'Z'), 1000), null);
});
test('адрес возврата: только разрешённые', () => {
  const c = load({ CORE_STORE: 'memory' }).clients['4one-launcher'];
  assert.ok(isAllowedRedirect(c, 'gta4one://auth/callback'));
  assert.ok(isAllowedRedirect(c, 'http://127.0.0.1:53211/callback'));
  for (const bad of ['gta4one://auth/callback?x=1', 'http://127.0.0.1/callback', 'http://evil.com/callback', 'https://127.0.0.1:1/callback', 'gta4one://other', '']) assert.ok(!isAllowedRedirect(c, bad), bad);
});
test('конфиг: боевой режим без CORE_SECRET не стартует', () => {
  assert.throws(() => load({ CORE_STORE: 'mysql' }), /CORE_SECRET/);
  assert.throws(() => load({ CORE_STORE: 'memory', CORE_DB_GAME: 'a;drop' }), /имя БД/);
});

// ---------- полный поток по HTTP (без сокетов: обработчик вызывается напрямую, тесты не требуют сети)
let HANDLER = null;
function inject({ method, url, headers, body }) {
  return new Promise((resolve) => {
    const req = Readable.from(body ? [Buffer.from(body)] : []);
    Object.assign(req, { method, url, headers, socket: { remoteAddress: '127.0.0.1' } });
    const res = { headersSent: false, writeHead(s, h) { this.status = s; this.h = h; this.headersSent = true; }, end(p) { resolve({ status: this.status, headers: this.h, text: p || '' }); } };
    HANDLER(req, res);
  });
}
async function fetch(url, init = {}) {
  const u = new URL(url); const headers = {};
  for (const [k, v] of Object.entries(init.headers || {})) headers[k.toLowerCase()] = v;
  const body = init.body instanceof URLSearchParams ? init.body.toString() : init.body;
  const r = await inject({ method: init.method || 'GET', url: u.pathname + u.search, headers, body });
  const lower = Object.fromEntries(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  return { status: r.status, headers: { get: (k) => lower[k.toLowerCase()] ?? null }, text: async () => r.text, json: async () => JSON.parse(r.text) };
}
async function boot(extra) {
  const config = { ...load({ CORE_STORE: 'memory' }), ...(extra || {}) };
  const store = createMemoryStore({
    accounts: [
      { login: 'marcus', email: 'marcus@example.com', passwordHash: hashPassword('Secret-1', 1000), socialClub: 'MarcusSC', redbucks: 1200, vipLvl: 2, vipDate: '2030-01-01T00:00:00Z', characters: [{ id: 1, name: 'Marcus Reed', level: 7 }] },
      { login: 'boss', email: 'boss@example.com', passwordHash: hashPassword('Boss-pass', 1000), socialClub: 'BossSC', redbucks: 0 },
      { login: 'bad', email: 'bad@example.com', passwordHash: hashPassword('x-pass-x', 1000), socialClub: 'BadSC', banned: true },
    ],
    alvl: { BossSC: 5 },
  });
  HANDLER = createApp({ store, config }).handler;
  return { base: 'http://core.test', store, config, close: async () => { HANDLER = null; } };
}
const REDIRECT = 'gta4one://auth/callback';
function pkce() { const verifier = randomToken(48); return { verifier, challenge: pkceChallenge(verifier) }; }
async function authorize(base, ch, extra) {
  const q = new URLSearchParams({ response_type: 'code', client_id: '4one-launcher', redirect_uri: REDIRECT, state: 'st-1', code_challenge: ch, code_challenge_method: 'S256', ...(extra || {}) });
  return fetch(`${base}/oauth/authorize?${q}`);
}
async function login(base, ch, user, pass, extra) {
  const page = await (await authorize(base, ch, extra)).text();
  const tx = /name="tx" value="([^"]+)"/.exec(page)[1];
  const res = await fetch(`${base}/oauth/authorize`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ tx, login: user, password: pass }) });
  return { res, text: await res.text(), tx };
}
function codeFrom(html) { const m = /code=([^&"]+)&amp;state=st-1/.exec(html); return m && decodeURIComponent(m[1]); }
async function tokenCall(base, body) {
  const r = await fetch(`${base}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}
async function fullLogin(env, user, pass) {
  const p = pkce(); const l = await login(env.base, p.challenge, user, pass);
  assert.equal(l.res.status, 200); const code = codeFrom(l.text); assert.ok(code, 'код во ссылке возврата');
  const t = await tokenCall(env.base, { grant_type: 'authorization_code', client_id: '4one-launcher', code, redirect_uri: REDIRECT, code_verifier: p.verifier });
  assert.equal(t.status, 200); return { ...t.json, p, code };
}
const me = (base, tok) => fetch(`${base}/v1/me`, { headers: { Authorization: `Bearer ${tok}` } });

test('поток: вход -> токен -> профиль игрока', async () => {
  const env = await boot();
  try {
    const t = await fullLogin(env, 'marcus', 'Secret-1');
    assert.equal(t.token_type, 'Bearer'); assert.equal(t.expires_in, 900);
    const r = await me(env.base, t.access_token); assert.equal(r.status, 200);
    const p = (await r.json()).data;
    assert.equal(p.login, 'marcus'); assert.equal(p.balance4c, 1200); assert.equal(p.vip.level, 2);
    assert.equal(p.role.title, 'Игрок'); assert.deepEqual(p.permissions, []); assert.equal(p.accountStatus, 'active');
    assert.deepEqual(p.characters, [{ id: 1, name: 'Marcus Reed', level: 7 }]);
    assert.ok(!('passwordHash' in p) && !JSON.stringify(p).includes('Secret'));
  } finally { await env.close(); }
});
test('вход по почте; администратор получает роль из alvl', async () => {
  const env = await boot();
  try {
    const t = await fullLogin(env, 'BOSS@example.com', 'Boss-pass');
    const p = (await (await me(env.base, t.access_token)).json()).data;
    assert.equal(p.role.title, 'Администратор 5 уровня'); assert.equal(p.role.rank, 'Старший администратор');
    assert.ok(p.permissions.includes('logs.view') && !p.permissions.includes('project.manage'));
    // уровень меняется в БД — профиль видит сразу, без перелогина
    await env.store.setAlvl('BossSC', 7);
    const p2 = (await (await me(env.base, t.access_token)).json()).data;
    assert.equal(p2.role.alvl, 7); assert.ok(p2.permissions.includes('staff.manage'));
  } finally { await env.close(); }
});
test('забаненный аккаунт входит, статус banned', async () => {
  const env = await boot();
  try {
    const t = await fullLogin(env, 'bad', 'x-pass-x');
    assert.equal((await (await me(env.base, t.access_token)).json()).data.accountStatus, 'banned');
  } finally { await env.close(); }
});
test('неверный пароль и неизвестный логин дают одинаковый ответ', async () => {
  const env = await boot();
  try {
    const p = pkce();
    const a = await login(env.base, p.challenge, 'marcus', 'wrong'); const b = await login(env.base, p.challenge, 'nobody', 'wrong');
    assert.equal(a.res.status, 401); assert.equal(b.res.status, 401);
    assert.ok(a.text.includes('Неверный логин или пароль.') && b.text.includes('Неверный логин или пароль.'));
    assert.ok(!a.text.includes('code='));
  } finally { await env.close(); }
});
test('подбор пароля: после 5 ошибок вход блокируется, даже с верным паролем', async () => {
  const env = await boot();
  try {
    const p = pkce();
    for (let i = 0; i < 5; i++) assert.equal((await login(env.base, p.challenge, 'marcus', 'nope')).res.status, 401);
    assert.equal((await login(env.base, p.challenge, 'marcus', 'Secret-1')).res.status, 429);
  } finally { await env.close(); }
});
test('код одноразовый и привязан к PKCE и адресу возврата', async () => {
  const env = await boot();
  try {
    const p = pkce(); const l = await login(env.base, p.challenge, 'marcus', 'Secret-1'); const code = codeFrom(l.text);
    const body = { grant_type: 'authorization_code', client_id: '4one-launcher', code, redirect_uri: REDIRECT };
    assert.equal((await tokenCall(env.base, { ...body, code_verifier: randomToken(48) })).json.error, 'invalid_grant', 'чужой verifier');
    // неудачная попытка уже погасила код
    assert.equal((await tokenCall(env.base, { ...body, code_verifier: p.verifier })).status, 400);
    const p2 = pkce(); const l2 = await login(env.base, p2.challenge, 'marcus', 'Secret-1'); const code2 = codeFrom(l2.text);
    assert.equal((await tokenCall(env.base, { ...body, code: code2, redirect_uri: 'gta4one://auth/other', code_verifier: p2.verifier })).status, 400);
    const l3 = await login(env.base, p2.challenge, 'marcus', 'Secret-1'); const code3 = codeFrom(l3.text);
    assert.equal((await tokenCall(env.base, { ...body, code: code3, code_verifier: p2.verifier })).status, 200);
    assert.equal((await tokenCall(env.base, { ...body, code: code3, code_verifier: p2.verifier })).status, 400, 'повторно нельзя');
  } finally { await env.close(); }
});
test('authorize: чужой redirect_uri, нет PKCE, неизвестный клиент — ошибка без редиректа', async () => {
  const env = await boot();
  try {
    const p = pkce();
    for (const extra of [{ redirect_uri: 'http://evil.com/cb' }, { client_id: 'x' }, { code_challenge_method: 'plain' }, { response_type: 'token' }, { state: '' }]) {
      const r = await authorize(env.base, p.challenge, extra); assert.equal(r.status, 400, JSON.stringify(extra));
    }
    const r = await authorize(env.base, 'short'); assert.equal(r.status, 400);
  } finally { await env.close(); }
});
test('форма: подделанный tx отвергается', async () => {
  const env = await boot();
  try {
    const res = await fetch(`${env.base}/oauth/authorize`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ tx: 'abc.def', login: 'marcus', password: 'Secret-1' }) });
    assert.equal(res.status, 400); assert.ok(!(await res.text()).includes('code='));
  } finally { await env.close(); }
});
test('refresh: ротация, повторное использование старого токена отзывает сессию', async () => {
  const env = await boot();
  try {
    const t = await fullLogin(env, 'marcus', 'Secret-1');
    const r1 = await tokenCall(env.base, { grant_type: 'refresh_token', client_id: '4one-launcher', refresh_token: t.refresh_token });
    assert.equal(r1.status, 200); assert.notEqual(r1.json.refresh_token, t.refresh_token);
    assert.equal((await me(env.base, r1.json.access_token)).status, 200);
    const replay = await tokenCall(env.base, { grant_type: 'refresh_token', client_id: '4one-launcher', refresh_token: t.refresh_token });
    assert.equal(replay.status, 400);
    assert.equal((await me(env.base, r1.json.access_token)).status, 401, 'сессия отозвана целиком');
    assert.equal((await tokenCall(env.base, { grant_type: 'refresh_token', refresh_token: r1.json.refresh_token })).status, 400);
  } finally { await env.close(); }
});
test('access-токен истекает', async () => {
  let clock = new Date('2026-01-01T00:00:00Z');
  const config = load({ CORE_STORE: 'memory' });
  const store = createMemoryStore({ accounts: [{ login: 'm', passwordHash: hashPassword('pw-pw-pw', 1000) }] });
  const { handler, oauth } = createApp({ store, config, now: () => clock });
  HANDLER = handler;
  const base = 'http://core.test';
  try {
    const env = { base, store };
    const t = await fullLogin(env, 'm', 'pw-pw-pw');
    assert.equal((await me(base, t.access_token)).status, 200);
    clock = new Date(clock.getTime() + 16 * 60 * 1000);
    assert.equal((await me(base, t.access_token)).status, 401);
    assert.equal((await tokenCall(base, { grant_type: 'refresh_token', refresh_token: t.refresh_token })).status, 200, 'refresh живёт дольше');
    assert.ok(oauth);
  } finally { HANDLER = null; }
});
test('revoke: access и refresh', async () => {
  const env = await boot();
  try {
    const t = await fullLogin(env, 'marcus', 'Secret-1');
    const rv = await fetch(`${env.base}/oauth/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t.access_token }) });
    assert.equal(rv.status, 200);
    assert.equal((await me(env.base, t.access_token)).status, 401);
    assert.equal((await tokenCall(env.base, { grant_type: 'refresh_token', refresh_token: t.refresh_token })).status, 400);
  } finally { await env.close(); }
});
test('/v1/me без токена и с мусором — 401', async () => {
  const env = await boot();
  try {
    assert.equal((await fetch(`${env.base}/v1/me`)).status, 401);
    assert.equal((await me(env.base, 'x'.repeat(30))).status, 401);
    assert.equal((await fetch(`${env.base}/v1/me`, { headers: { Authorization: 'Basic abc' } })).status, 401);
  } finally { await env.close(); }
});
test('админская вкладка: игроку 403, администратору — каталог прав', async () => {
  const env = await boot();
  try {
    const player = await fullLogin(env, 'marcus', 'Secret-1');
    assert.equal((await fetch(`${env.base}/v1/admin/capabilities`, { headers: { Authorization: `Bearer ${player.access_token}` } })).status, 403);
    const admin = await fullLogin(env, 'boss', 'Boss-pass');
    const r = await fetch(`${env.base}/v1/admin/capabilities`, { headers: { Authorization: `Bearer ${admin.access_token}` } });
    assert.equal(r.status, 200); const d = (await r.json()).data;
    assert.equal(d.alvl, 5); assert.ok(d.catalog.find((c) => c.name === 'logs.view').granted); assert.ok(!d.catalog.find((c) => c.name === 'project.manage').granted);
  } finally { await env.close(); }
});
test('большое тело и неизвестный маршрут', async () => {
  const env = await boot();
  try {
    const big = await fetch(`${env.base}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(20000) }) });
    assert.equal(big.status, 413);
    assert.equal((await fetch(`${env.base}/nope`)).status, 404);
    const page = await authorize(env.base, pkce().challenge);
    assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /form-action 'self'/);
    assert.equal(page.headers.get('cache-control'), 'no-store');
  } finally { await env.close(); }
});
