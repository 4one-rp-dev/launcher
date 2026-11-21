'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');
const { load } = require('../src/config');
const { hashPassword } = require('../src/passwords');
const { pkceChallenge, randomToken, sign } = require('../src/tokens');
const { createMemoryStore } = require('../src/store');
const { createApp } = require('../src/server');
const totp = require('../src/totp');

// ---------- обвязка: обработчик без сокетов, часы подменяются через now
let HANDLER = null;
function call(method, url, { headers = {}, body, token, form } = {}) {
  const h = { ...headers }; if (token) h.authorization = `Bearer ${token}`;
  let raw;
  if (form) { raw = new URLSearchParams(form).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
  else if (body !== undefined) { raw = JSON.stringify(body); h['content-type'] = 'application/json'; }
  return new Promise((resolve) => {
    const req = Readable.from(raw ? [Buffer.from(raw)] : []);
    Object.assign(req, { method, url, headers: h, socket: { remoteAddress: '203.0.113.7' } });
    HANDLER(req, { headersSent: false, writeHead(s, hh) { this.status = s; this.h = Object.fromEntries(Object.entries(hh || {}).map(([k, v]) => [k.toLowerCase(), v])); this.headersSent = true; }, end(p) { let j = null; try { j = JSON.parse(p); } catch (_) { /* html */ } resolve({ status: this.status, h: this.h, text: p || '', json: j }); } });
  });
}

const SITE = 'https://www.4onerp.com';
function boot(env = { CORE_STORE: 'memory' }) {
  const clock = { t: new Date('2026-11-11T10:00:00Z') };
  const config = load(env);
  const store = createMemoryStore({
    accounts: [
      { login: 'marcus', email: 'm@x.io', passwordHash: hashPassword('Secret-1', 1000), socialClub: 'SC' },
      { login: 'dante', email: 'd@x.io', passwordHash: hashPassword('Dante-pw1', 1000) },
    ],
  });
  HANDLER = createApp({ store, config, now: () => clock.t }).handler;
  return {
    store, config, clock,
    tick(sec) { clock.t = new Date(clock.t.getTime() + sec * 1000); },
  };
}
const LAUNCHER = '4one-launcher';
const direct = (login, password, extra = {}) => call('POST', '/v1/auth/login', { body: { client_id: LAUNCHER, login, password, device_name: 'DESKTOP-1 · Windows', ...extra } });
const mfaCall = (mfa_token, code, extra = {}) => call('POST', '/v1/auth/mfa', { body: { client_id: LAUNCHER, mfa_token, code, ...extra } });
const codeAt = (secret, env) => totp.totp(totp.base32Decode(secret), env.clock.t.getTime());

/** Включает 2FA marcus: возвращает секрет, резервные коды и токен доступа. */
async function enable2fa(env) {
  const t = await direct('marcus', 'Secret-1'); assert.equal(t.status, 200);
  const access = t.json.access_token;
  const s = await call('POST', '/v1/account/2fa/setup', { token: access });
  assert.equal(s.status, 200);
  const e = await call('POST', '/v1/account/2fa/enable', { token: access, body: { code: codeAt(s.json.data.secret, env) } });
  assert.equal(e.status, 200);
  env.tick(30); // код, которым включали, повторно не примут: следующий шаг
  return { secret: s.json.data.secret, backup: e.json.data.backupCodes, access };
}

// ---------- защита аккаунта и сброс пароля
const INTERNAL = { 'x-internal-token': 'internal-token-1234567890' };
const bootSec = () => boot({ CORE_STORE: 'memory', CORE_INTERNAL_TOKEN: 'internal-token-1234567890' });
const login = async (l = 'marcus', p = 'Secret-1') => { const t = await direct(l, p); assert.equal(t.status, 200); return t.json.access_token; };

test('защита по умолчанию включена, трейд-бана нет', async () => {
  bootSec();
  const a = await login();
  const r = await call('GET', '/v1/account/security', { token: a });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.data.protection, { enabled: true, offAt: null, tradeBanUntil: null, tradeBanReason: '' });
});

test('выключение защиты: нужен верный пароль, срабатывает через 24 часа, повторное включение отменяет', async () => {
  const env = bootSec();
  const a = await login();
  const noPw = await call('POST', '/v1/account/protection', { token: a, body: { enabled: false } });
  assert.equal(noPw.status, 400); assert.equal(noPw.json.error, 'password_required');
  const bad = await call('POST', '/v1/account/protection', { token: a, body: { enabled: false, password: 'wrong' } });
  assert.equal(bad.status, 401); assert.equal(bad.json.error, 'invalid_credentials');

  const ok = await call('POST', '/v1/account/protection', { token: a, body: { enabled: false, password: 'Secret-1' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.data.enabled, true);            // сутки защита ещё действует
  assert.equal(ok.json.data.offAt, new Date(env.clock.t.getTime() + 24 * 3600 * 1000).toISOString());

  env.tick(23 * 3600);                                  // токен доступа живёт 15 минут — берём новый
  const still = await call('GET', '/v1/account/security', { token: await login() });
  assert.equal(still.json.data.protection.enabled, true);
  env.tick(2 * 3600);                                   // прошло больше суток
  const off = await call('GET', '/v1/account/security', { token: await login() });
  assert.equal(off.json.data.protection.enabled, false);

  const on = await call('POST', '/v1/account/protection', { token: await login(), body: { enabled: true } });
  assert.equal(on.status, 200); assert.equal(on.json.data.enabled, true); assert.equal(on.json.data.offAt, null);
});

test('повторный запрос на выключение не сдвигает срок', async () => {
  const env = bootSec();
  const a = await login();
  const first = await call('POST', '/v1/account/protection', { token: a, body: { enabled: false, password: 'Secret-1' } });
  env.tick(600);
  const second = await call('POST', '/v1/account/protection', { token: a, body: { enabled: false, password: 'Secret-1' } });
  assert.equal(second.json.data.offAt, first.json.data.offAt);
});

test('выключение защиты при включённой 2FA требует код', async () => {
  const env = bootSec();
  const m = await enable2fa(env);
  const noCode = await call('POST', '/v1/account/protection', { token: m.access, body: { enabled: false, password: 'Secret-1' } });
  assert.equal(noCode.status, 400); assert.equal(noCode.json.error, 'mfa_required');
  const wrong = await call('POST', '/v1/account/protection', { token: m.access, body: { enabled: false, password: 'Secret-1', code: '000000' } });
  assert.equal(wrong.status, 401); assert.equal(wrong.json.error, 'invalid_mfa_code');
  const ok = await call('POST', '/v1/account/protection', { token: m.access, body: { enabled: false, password: 'Secret-1', code: codeAt(m.secret, env) } });
  assert.equal(ok.status, 200); assert.ok(ok.json.data.offAt);
});

test('перебор пароля при выключении защиты упирается в лимит', async () => {
  bootSec();
  const a = await login();
  for (let i = 0; i < 5; i++) await call('POST', '/v1/account/protection', { token: a, body: { enabled: false, password: 'wrong' } });
  const r = await call('POST', '/v1/account/protection', { token: a, body: { enabled: false, password: 'Secret-1' } });
  assert.equal(r.status, 429);
});

test('бан на обмен и устройства из мода видны в аккаунте, HWID наружу не отдаётся', async () => {
  const env = bootSec();
  const d = env.store._dump();
  d.security.set('marcus', { login: 'marcus', disableAfter: null, tradeBanUntil: new Date(env.clock.t.getTime() + 3600e3), tradeBanReason: 'new_device', forceLogoutAt: null });
  d.devices.set('marcus', [{ hwid: 'SECRET-HWID-1', ip: '203.0.113.45', socialClub: 'SC', firstSeen: env.clock.t, lastSeen: env.clock.t, logins: 3, trusted: false }]);
  d.gameLogins.set('marcus', [{ at: env.clock.t, ip: '203.0.113.45', hwid: 'SECRET-HWID-1', ok: true, reason: 'new_device', newDevice: true }]);
  const a = await login();
  const s = await call('GET', '/v1/account/security', { token: a });
  assert.equal(s.json.data.protection.tradeBanUntil, new Date(env.clock.t.getTime() + 3600e3).toISOString());
  const dev = await call('GET', '/v1/account/devices', { token: a });
  assert.equal(dev.json.data.length, 1);
  assert.equal(dev.json.data[0].ip, '203.0.113.x');
  assert.ok(!JSON.stringify(dev.json).includes('SECRET-HWID-1'));
  const h = await call('GET', '/v1/account/history', { token: a });
  const g = h.json.data.find((x) => x.method === 'game');
  assert.ok(g && g.newDevice && g.ip === '203.0.113.x');
  assert.ok(!JSON.stringify(h.json).includes('SECRET-HWID-1'));
});

test('сброс пароля: токен выдаёт только сайт по секрету, пароль меняется, сессии отзываются, защита включается', async () => {
  const env = bootSec();
  const old = await login();
  const d = env.store._dump();
  d.devices.set('marcus', [{ hwid: 'H1', ip: '1.2.3.4', firstSeen: env.clock.t, lastSeen: env.clock.t, logins: 9, trusted: true }]);
  d.security.set('marcus', { login: 'marcus', disableAfter: new Date(env.clock.t.getTime() - 1000), tradeBanUntil: null, tradeBanReason: '', forceLogoutAt: null });

  const denied = await call('POST', '/v1/internal/password/token', { body: { identifier: 'marcus' } });
  assert.equal(denied.status, 404);
  const issued = await call('POST', '/v1/internal/password/token', { headers: INTERNAL, body: { identifier: 'M@X.io' } });
  assert.equal(issued.status, 200);
  assert.equal(issued.json.data.login, 'marcus');
  const token = issued.json.data.token;

  const chk = await call('GET', `/v1/password/reset?token=${encodeURIComponent(token)}`);
  assert.equal(chk.status, 200); assert.equal(chk.json.data.mfaRequired, false);

  const weak = await call('POST', '/v1/password/reset', { body: { token, password: 'short' } });
  assert.equal(weak.status, 400); assert.equal(weak.json.error, 'invalid_password');

  const done = await call('POST', '/v1/password/reset', { body: { token, password: 'Brand-New-9' } });
  assert.equal(done.status, 200);

  assert.equal((await direct('marcus', 'Secret-1')).status, 401);           // старый пароль не подходит
  assert.equal((await direct('marcus', 'Brand-New-9')).status, 200);        // новый подходит
  assert.equal((await call('GET', '/v1/me', { token: old })).status, 401);  // старая сессия отозвана
  const again = await call('POST', '/v1/password/reset', { body: { token, password: 'Another-pw-1' } });
  assert.equal(again.status, 400); assert.equal(again.json.error, 'invalid_token'); // токен одноразовый

  assert.equal(d.devices.get('marcus')[0].trusted, false);                  // доверие к устройствам сброшено
  assert.equal(d.devices.get('marcus')[0].distrustAt.getTime(), env.clock.t.getTime()); // срок бана отсчитывается от сброса
  assert.equal(d.security.get('marcus').disableAfter, null);                // защита включена обратно
  assert.ok(d.security.get('marcus').forceLogoutAt);                        // игрока выкинет мод
});

test('сброс пароля: истёкший и выдуманный токены не работают', async () => {
  const env = bootSec();
  const issued = await call('POST', '/v1/internal/password/token', { headers: INTERNAL, body: { identifier: 'dante' } });
  const token = issued.json.data.token;
  env.tick(31 * 60);
  const late = await call('POST', '/v1/password/reset', { body: { token, password: 'Brand-New-9' } });
  assert.equal(late.status, 400); assert.equal(late.json.error, 'invalid_token');
  const fake = await call('POST', '/v1/password/reset', { body: { token: 'x'.repeat(43), password: 'Brand-New-9' } });
  assert.equal(fake.json.error, 'invalid_token');
});

test('сброс пароля при включённой 2FA требует код', async () => {
  const env = bootSec();
  const m = await enable2fa(env);
  const token = (await call('POST', '/v1/internal/password/token', { headers: INTERNAL, body: { identifier: 'marcus' } })).json.data.token;
  assert.equal((await call('GET', `/v1/password/reset?token=${encodeURIComponent(token)}`)).json.data.mfaRequired, true);
  const noCode = await call('POST', '/v1/password/reset', { body: { token, password: 'Brand-New-9' } });
  assert.equal(noCode.status, 400); assert.equal(noCode.json.error, 'mfa_required');
  const ok = await call('POST', '/v1/password/reset', { body: { token, password: 'Brand-New-9', code: m.backup[0] } });
  assert.equal(ok.status, 200);
});

test('токены сброса: не больше 3 в час на аккаунт; без аккаунта — not_found', async () => {
  bootSec();
  for (let i = 0; i < 3; i++) assert.equal((await call('POST', '/v1/internal/password/token', { headers: INTERNAL, body: { identifier: 'dante' } })).status, 200);
  assert.equal((await call('POST', '/v1/internal/password/token', { headers: INTERNAL, body: { identifier: 'dante' } })).status, 429);
  assert.equal((await call('POST', '/v1/internal/password/token', { headers: INTERNAL, body: { identifier: 'nobody' } })).status, 404);
});
