'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');
const { load } = require('../src/config');
const { hashPassword, verifyPassword } = require('../src/passwords');
const { createMemoryStore } = require('../src/store');
const { createApp } = require('../src/server');

// ---------- обвязка: обработчик без сокетов, IP и часы подменяются
let HANDLER = null;
function call(method, url, { body, token, ip = '203.0.113.9' } = {}) {
  const h = {}; if (token) h.authorization = `Bearer ${token}`;
  let raw; if (body !== undefined) { raw = JSON.stringify(body); h['content-type'] = 'application/json'; }
  return new Promise((resolve) => {
    const req = Readable.from(raw ? [Buffer.from(raw)] : []);
    Object.assign(req, { method, url, headers: h, socket: { remoteAddress: ip } });
    HANDLER(req, { headersSent: false, writeHead(s) { this.status = s; this.headersSent = true; }, end(p) { let j = null; try { j = JSON.parse(p); } catch (_) { /* не json */ } resolve({ status: this.status, json: j }); } });
  });
}
function boot(env = {}) {
  const clock = { t: new Date('2026-11-11T10:00:00Z') };
  const config = load({ CORE_STORE: 'memory', ...env });
  const store = createMemoryStore({ accounts: [{ login: 'marcus', email: 'Marcus@X.io', passwordHash: hashPassword('Secret-1', 1000), socialClub: 'SC' }] });
  HANDLER = createApp({ store, config, now: () => clock.t }).handler;
  return { store, config, clock, tick(sec) { clock.t = new Date(clock.t.getTime() + sec * 1000); } };
}
const LAUNCHER = '4one-launcher';
const reg = (extra = {}, opts) => call('POST', '/v1/auth/register', { ...opts, body: { client_id: LAUNCHER, login: 'Newbie_1', email: 'New@Mail.ru', password: 'Passw0rd!', device_name: 'DESKTOP-1 · Windows', ...extra } });

test('регистрация: 201 и сразу токены, профиль, хеш как в игре, строка accounts как у игры', async () => {
  const env = boot({ CORE_SIGNUP_REDBUCKS: '100', CORE_SIGNUP_VIP_LVL: '1', CORE_SIGNUP_VIP_DAYS: '3' });
  const r = await reg({ promo: 'Start-4' });
  assert.equal(r.status, 201);
  assert.deepEqual(Object.keys(r.json).sort(), ['access_token', 'expires_in', 'refresh_token', 'scope', 'token_type']);
  assert.equal(r.json.token_type, 'Bearer'); assert.equal(r.json.expires_in, 900); assert.equal(r.json.scope, 'profile');
  const me = await call('GET', '/v1/me', { token: r.json.access_token });
  assert.equal(me.status, 200);
  assert.equal(me.json.data.login, 'newbie_1', 'как игра: логин в нижнем регистре');
  assert.equal(me.json.data.email, 'new@mail.ru');
  assert.equal(me.json.data.socialClub, '');
  assert.equal(me.json.data.balance4c, 100);
  assert.equal(me.json.data.vip.level, 1);
  assert.equal(me.json.data.vip.until, '2026-11-14T10:00:00.000Z');
  assert.equal(me.json.data.role.alvl, 0); assert.deepEqual(me.json.data.characters, []);
  const a = await env.store.getAccount('newbie_1');
  assert.match(a.passwordHash, /^p2\$100000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.ok(verifyPassword('Passw0rd!', a.passwordHash)); assert.ok(!verifyPassword('passw0rd!', a.passwordHash));
  assert.equal(a.game.promocodes, '["start-4"]'); assert.equal(a.game.bonuscodes, '[]');
  assert.deepEqual([a.game.character1, a.game.character2, a.game.character3], [-1, -1, -1]);
  assert.equal(a.game.ip, '203.0.113.9');
  const sessions = [...env.store._dump().sessions.values()];
  assert.equal(sessions.length, 1); assert.equal(sessions[0].clientId, LAUNCHER); assert.equal(sessions[0].device, 'DESKTOP-1 · Windows');
  const h = await call('GET', '/v1/account/history', { token: r.json.access_token });
  assert.equal(h.json.data.length, 1); assert.equal(h.json.data[0].method, 'launcher'); assert.equal(h.json.data[0].ok, true);
});

test('регистрация: по умолчанию 0 4Coin, без VIP, промокод noref', async () => {
  const env = boot();
  const r = await reg(); assert.equal(r.status, 201);
  const a = await env.store.getAccount('newbie_1');
  assert.equal(a.redbucks, 0); assert.equal(a.vipLvl, 0); assert.equal(a.vipDate.getTime(), env.clock.t.getTime());
  assert.equal(a.game.promocodes, '["noref"]');
});

test('регистрация: после неё работает /v1/auth/login тем же паролем (логин в любом регистре и почта)', async () => {
  boot();
  assert.equal((await reg()).status, 201);
  for (const id of ['newbie_1', 'Newbie_1', 'NEW@mail.ru']) {
    const l = await call('POST', '/v1/auth/login', { body: { client_id: LAUNCHER, login: id, password: 'Passw0rd!' } });
    assert.equal(l.status, 200, id); assert.ok(l.json.access_token);
  }
  assert.equal((await call('POST', '/v1/auth/login', { body: { client_id: LAUNCHER, login: 'newbie_1', password: 'Passw0rd' } })).status, 401);
});

test('регистрация: ошибки проверки — коды и тексты игры', async () => {
  const cases = [
    [{ login: 'ab' }, 'invalid_login', 'Логин: латиница, цифры и «_», от 3 до 24 символов, первая — буква.'],
    [{ login: '1abc' }, 'invalid_login'], [{ login: 'a'.repeat(25) }, 'invalid_login'], [{ login: 'Иван' }, 'invalid_login'], [{ login: 'ab-c' }, 'invalid_login'], [{ login: undefined }, 'invalid_login'],
    [{ password: 'Pass1' }, 'invalid_password', 'Пароль: от 8 до 64 символов, латиница, цифры и знаки без пробелов.'],
    [{ password: 'Pass word1' }, 'invalid_password'], [{ password: 'Пароль12345' }, 'invalid_password'], [{ password: 'A1' + 'x'.repeat(63) }, 'invalid_password'], [{ password: 12345678 }, 'invalid_password'],
    [{ password: 'onlyletters' }, 'invalid_password', 'Пароль должен содержать буквы и цифры.'], [{ password: '12345678!' }, 'invalid_password', 'Пароль должен содержать буквы и цифры.'],
    [{ email: 'bad' }, 'invalid_email', 'Почта в формате name@mail.ru.'], [{ email: 'a@b.c' }, 'invalid_email'], [{ email: 'a b@c.ru' }, 'invalid_email'], [{ email: `${'a'.repeat(58)}@mail.ru` }, 'invalid_email'],
    [{ promo: 'bad code' }, 'invalid_promo', 'Промокод: латиница и цифры, до 16 символов.'], [{ promo: 'A'.repeat(17) }, 'invalid_promo'], [{ promo: 'КОД' }, 'invalid_promo'],
  ];
  for (const [extra, code, text] of cases) {
    boot(); // свежий лимит на каждый случай
    const r = await reg(extra);
    assert.equal(r.status, 400, JSON.stringify(extra)); assert.equal(r.json.error, code, JSON.stringify(extra));
    if (text) assert.equal(r.json.error_description, text);
  }
  const env = boot();
  assert.equal((await reg({ password: 'A1' + 'x'.repeat(62), email: `${'a'.repeat(56)}@mail.ru`, promo: 'A'.repeat(16) })).status, 201, 'границы: 64 знака пароля, 64 почты, 16 промокода');
  assert.equal(env.store._dump().accounts.length, 2);
});

test('регистрация: логин и почта заняты без учёта регистра — 409', async () => {
  const env = boot();
  const a = await reg({ login: 'MARCUS' });
  assert.equal(a.status, 409); assert.equal(a.json.error, 'login_taken');
  const b = await reg({ email: 'marcus@x.IO' });
  assert.equal(b.status, 409); assert.equal(b.json.error, 'email_taken');
  assert.equal((await reg()).status, 201);
  assert.equal((await reg({ login: 'NEWBIE_1', email: 'other@mail.ru' })).json.error, 'login_taken');
  assert.equal((await reg({ login: 'other1', email: 'NEW@MAIL.RU' })).json.error, 'email_taken');
  assert.equal(env.store._dump().accounts.length, 2);
});

test('регистрация: две одновременные одинаковые — один аккаунт', async () => {
  const env = boot();
  const rs = await Promise.all([reg(), reg({ login: 'NEWBIE_1', email: 'x2@mail.ru' })]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
  assert.equal(env.store._dump().accounts.filter((a) => a.login === 'newbie_1').length, 1);
});

test('регистрация: лимит — 3 успешных и 20 попыток с IP за час', async () => {
  const env = boot();
  for (let i = 0; i < 3; i++) assert.equal((await reg({ login: `user${i}x`, email: `u${i}@mail.ru` })).status, 201);
  const r = await reg({ login: 'user9x', email: 'u9@mail.ru' });
  assert.equal(r.status, 429); assert.equal(r.json.error, 'rate_limited');
  assert.equal((await reg({ login: 'user9x', email: 'u9@mail.ru' }, { ip: '198.51.100.1' })).status, 201, 'другой IP не задет');
  env.tick(3601);
  assert.equal((await reg({ login: 'user8x', email: 'u8@mail.ru' })).status, 201, 'через час снова можно');

  boot();
  for (let i = 0; i < 20; i++) assert.equal((await reg({ login: 'ab' })).status, 400);
  const blocked = await reg();
  assert.equal(blocked.status, 429); assert.equal(blocked.json.error, 'rate_limited');
});

test('регистрация: только доверенные клиенты', async () => {
  const env = boot();
  const r = await reg({ client_id: 'nope' });
  assert.equal(r.status, 400); assert.equal(r.json.error, 'invalid_client');
  const config = load({ CORE_STORE: 'memory', CORE_CLIENTS: JSON.stringify({ ext: { name: 'Чужое', redirectUris: ['https://ext.example/cb'] } }) });
  const store = createMemoryStore({});
  HANDLER = createApp({ store, config }).handler;
  const e = await reg({ client_id: 'ext' });
  assert.equal(e.status, 400); assert.equal(e.json.error, 'invalid_client');
  assert.equal(store._dump().accounts.length, 0); assert.equal(env.store._dump().accounts.length, 1);
});

test('регистрация с сайта: событие входа site; конфиг стартовых значений', async () => {
  const env = boot({ CORE_SITE_REDIRECTS: 'https://www.4onerp.com/auth/callback' });
  const r = await reg({ client_id: '4one-site' });
  assert.equal(r.status, 201);
  assert.equal(env.store._content.events[0].method, 'site');
  assert.deepEqual(load({ CORE_STORE: 'memory' }).signup, { redbucks: 0, vipLvl: 0, vipDays: 0 });
  assert.throws(() => load({ CORE_STORE: 'memory', CORE_SIGNUP_VIP_DAYS: '-1' }), /CORE_SIGNUP_VIP_DAYS/);
  assert.throws(() => load({ CORE_STORE: 'memory', CORE_SIGNUP_REDBUCKS: 'x' }), /CORE_SIGNUP_REDBUCKS/);
});
