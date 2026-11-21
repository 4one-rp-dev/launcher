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

// ---------- прямой вход
test('прямой вход без 2FA: токены как у /oauth/token, сессия с устройством, событие launcher', async () => {
  const env = boot();
  const r = await direct('marcus', 'Secret-1');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json).sort(), ['access_token', 'expires_in', 'refresh_token', 'scope', 'token_type']);
  assert.equal(r.json.token_type, 'Bearer'); assert.equal(r.json.expires_in, 900); assert.equal(r.json.scope, 'profile');
  const me = await call('GET', '/v1/me', { token: r.json.access_token });
  assert.equal(me.status, 200); assert.equal(me.json.data.login, 'marcus');
  const sessions = [...env.store._dump().sessions.values()];
  assert.equal(sessions.length, 1); assert.equal(sessions[0].clientId, LAUNCHER); assert.equal(sessions[0].device, 'DESKTOP-1 · Windows');
  const h = await call('GET', '/v1/account/history', { token: r.json.access_token });
  assert.equal(h.json.data[0].method, 'launcher'); assert.equal(h.json.data[0].ok, true);
  const rf = await call('POST', '/oauth/token', { body: { grant_type: 'refresh_token', client_id: LAUNCHER, refresh_token: r.json.refresh_token } });
  assert.equal(rf.status, 200, 'refresh работает как обычно');
  assert.equal((await direct('m@x.io', 'Secret-1')).status, 200, 'вход по почте');
});

test('прямой вход: неверный пароль и неизвестный логин — 401 invalid_credentials, лимит — 429', async () => {
  const env = boot();
  const a = await direct('marcus', 'wrong'); const b = await direct('nobody', 'wrong');
  assert.equal(a.status, 401); assert.equal(a.json.error, 'invalid_credentials'); assert.ok(a.json.error_description);
  assert.deepEqual(a.json, b.json, 'ответы одинаковые');
  assert.equal((await direct('marcus', '')).status, 401);
  const h = env.store._content.events.filter((e) => e.login === 'marcus');
  assert.equal(h.length, 1); assert.equal(h[0].ok, false);
  for (let i = 0; i < 4; i++) await direct('marcus', 'nope');
  const blocked = await direct('marcus', 'Secret-1');
  assert.equal(blocked.status, 429); assert.equal(blocked.json.error, 'rate_limited');
});

test('прямой вход: только доверенные клиенты', async () => {
  boot();
  assert.equal((await direct('marcus', 'Secret-1', { client_id: 'nope' })).json.error, 'invalid_client');
  const config = load({ CORE_STORE: 'memory', CORE_CLIENTS: JSON.stringify({ ext: { name: 'Чужое', redirectUris: ['https://ext.example/cb'] } }) });
  HANDLER = createApp({ store: createMemoryStore({ accounts: [{ login: 'marcus', passwordHash: hashPassword('Secret-1', 1000) }] }), config }).handler;
  const r = await direct('marcus', 'Secret-1', { client_id: 'ext' });
  assert.equal(r.status, 400); assert.equal(r.json.error, 'invalid_client');
  assert.equal((await mfaCall('x.y', '123456', { client_id: 'ext' })).json.error, 'invalid_client');
});

// ---------- управление 2FA
test('2FA: setup -> enable -> статус и security.twoFactor -> disable', async () => {
  const env = boot();
  const t = (await direct('marcus', 'Secret-1')).json.access_token;
  let st = await call('GET', '/v1/account/2fa', { token: t });
  assert.deepEqual(st.json.data, { enabled: false, pending: false, backupLeft: 0, enabledAt: null });
  assert.equal((await call('GET', '/v1/account/security', { token: t })).json.data.twoFactor, false);
  assert.equal((await call('POST', '/v1/account/2fa/enable', { token: t, body: { code: '123456' } })).json.error, 'mfa_not_pending');
  assert.equal((await call('POST', '/v1/account/2fa/disable', { token: t, body: { code: '123456' } })).json.error, 'mfa_not_enabled');
  assert.equal((await call('GET', '/v1/account/2fa')).status, 401, 'без токена');

  const s1 = await call('POST', '/v1/account/2fa/setup', { token: t });
  const s = await call('POST', '/v1/account/2fa/setup', { token: t }); // повторный setup заменяет ожидающий секрет
  assert.notEqual(s.json.data.secret, s1.json.data.secret);
  assert.match(s.json.data.secret, /^[A-Z2-7]{32}$/);
  assert.equal(s.json.data.otpauth, `otpauth://totp/4ONE%20RP:marcus?secret=${s.json.data.secret}&issuer=4ONE%20RP&algorithm=SHA1&digits=6&period=30`);
  st = await call('GET', '/v1/account/2fa', { token: t });
  assert.equal(st.json.data.pending, true); assert.equal(st.json.data.enabled, false);

  const wrong = await call('POST', '/v1/account/2fa/enable', { token: t, body: { code: codeAt(s1.json.data.secret, env) } });
  assert.equal(wrong.status, 401); assert.equal(wrong.json.error, 'invalid_mfa_code', 'код старого секрета не подходит');
  const en = await call('POST', '/v1/account/2fa/enable', { token: t, body: { code: codeAt(s.json.data.secret, env) } });
  assert.equal(en.status, 200); assert.equal(en.json.data.enabled, true);
  assert.equal(en.json.data.backupCodes.length, 10);
  for (const c of en.json.data.backupCodes) assert.match(c, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);

  // в хранилище: секрет зашифрован, коды — только хеши
  const row = env.store._dump().mfa.get('marcus');
  assert.ok(row.secretEnc.startsWith('v1.') && !row.secretEnc.includes(s.json.data.secret));
  const stored = JSON.stringify(env.store._dump().backup.get('marcus'));
  for (const c of en.json.data.backupCodes) assert.ok(!stored.includes(c) && !stored.includes(c.replace('-', '')));

  st = await call('GET', '/v1/account/2fa', { token: t });
  assert.deepEqual(st.json.data, { enabled: true, pending: false, backupLeft: 10, enabledAt: env.clock.t.toISOString() });
  assert.equal((await call('GET', '/v1/account/security', { token: t })).json.data.twoFactor, true);
  assert.equal((await call('POST', '/v1/account/2fa/setup', { token: t })).json.error, 'mfa_already_enabled');
  assert.equal((await call('POST', '/v1/account/2fa/setup', { token: t })).status, 409);

  env.tick(30);
  const bad = await call('POST', '/v1/account/2fa/disable', { token: t, body: { code: '000000' } });
  assert.equal(bad.status, 401); assert.equal(bad.json.error, 'invalid_mfa_code');
  const off = await call('POST', '/v1/account/2fa/disable', { token: t, body: { code: codeAt(s.json.data.secret, env) } });
  assert.equal(off.status, 200); assert.deepEqual(off.json.data, { enabled: false });
  assert.equal((await call('GET', '/v1/account/security', { token: t })).json.data.twoFactor, false);
  assert.equal((await direct('marcus', 'Secret-1')).json.access_token.length > 20, true, 'снова вход без кода');
});

test('2FA: отключение резервным кодом, новые резервные коды гасят старые', async () => {
  const env = boot();
  const { secret, backup, access } = await enable2fa(env);
  assert.equal((await call('POST', '/v1/account/2fa/backup', { token: access, body: { code: backup[0] } })).status, 401, 'перевыпуск — только TOTP');
  const nb = await call('POST', '/v1/account/2fa/backup', { token: access, body: { code: codeAt(secret, env) } });
  assert.equal(nb.status, 200); assert.equal(nb.json.data.backupCodes.length, 10);
  assert.ok(!nb.json.data.backupCodes.some((c) => backup.includes(c)));
  assert.equal((await call('POST', '/v1/account/2fa/disable', { token: access, body: { code: backup[1] } })).status, 401, 'старый код сгорел');
  const off = await call('POST', '/v1/account/2fa/disable', { token: access, body: { code: nb.json.data.backupCodes[0].toLowerCase() } });
  assert.equal(off.status, 200);
  assert.equal(env.store._dump().backup.has('marcus'), false);
});

// ---------- вход с 2FA
test('прямой вход с 2FA: mfa_token без сессии, затем код -> токены; повтор кода не проходит', async () => {
  const env = boot();
  const { secret } = await enable2fa(env);
  const before = env.store._dump().sessions.size;
  const r = await direct('marcus', 'Secret-1');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json).sort(), ['methods', 'mfa_required', 'mfa_token']);
  assert.equal(r.json.mfa_required, true); assert.deepEqual(r.json.methods, ['totp', 'backup']);
  assert.equal(env.store._dump().sessions.size, before, 'сессия не создаётся до кода');

  const bad = await mfaCall(r.json.mfa_token, '000000');
  assert.equal(bad.status, 401); assert.equal(bad.json.error, 'invalid_mfa_code');
  const code = codeAt(secret, env);
  const ok = await mfaCall(r.json.mfa_token, code);
  assert.equal(ok.status, 200); assert.equal(ok.json.token_type, 'Bearer');
  assert.equal((await call('GET', '/v1/me', { token: ok.json.access_token })).status, 200);
  const sess = [...env.store._dump().sessions.values()].pop();
  assert.equal(sess.clientId, LAUNCHER); assert.equal(sess.device, 'DESKTOP-1 · Windows');
  const ev = env.store._content.events.filter((e) => e.login === 'marcus');
  assert.equal(ev[ev.length - 1].method, 'launcher'); assert.equal(ev[ev.length - 1].ok, true);

  assert.equal((await mfaCall(r.json.mfa_token, codeAt(secret, env))).json.error, 'mfa_expired', 'токен после успеха одноразовый');
  const r2 = await direct('marcus', 'Secret-1');
  const replay = await mfaCall(r2.json.mfa_token, code);
  assert.equal(replay.status, 401); assert.equal(replay.json.error, 'invalid_mfa_code', 'тот же код второй раз');
  env.tick(30);
  assert.equal((await mfaCall(r2.json.mfa_token, codeAt(secret, env))).status, 200, 'код следующего шага подходит');
});

test('прямой вход с 2FA: резервный код одноразовый, регистр и дефис не важны', async () => {
  const env = boot();
  const { backup, access } = await enable2fa(env);
  const r = await direct('marcus', 'Secret-1');
  const ok = await mfaCall(r.json.mfa_token, backup[3].toLowerCase().replace('-', ''));
  assert.equal(ok.status, 200);
  const r2 = await direct('marcus', 'Secret-1');
  const again = await mfaCall(r2.json.mfa_token, backup[3]);
  assert.equal(again.status, 401); assert.equal(again.json.error, 'invalid_mfa_code');
  assert.equal((await call('GET', '/v1/account/2fa', { token: access })).json.data.backupLeft, 9);
});

test('mfa_token: истёк, подделан, чужой клиент, 5 попыток — mfa_expired; 10 ошибок на логин — 429', async () => {
  const env = boot({ CORE_STORE: 'memory', CORE_SITE_REDIRECTS: `${SITE}/auth/callback` });
  const { secret } = await enable2fa(env);
  let r = await direct('marcus', 'Secret-1');
  env.tick(5 * 60 + 1);
  let x = await mfaCall(r.json.mfa_token, codeAt(secret, env));
  assert.equal(x.status, 400); assert.equal(x.json.error, 'mfa_expired');

  const forged = sign('x'.repeat(40), { t: 'mfa', cid: LAUNCHER, lg: 'marcus', n: 'abc', exp: env.clock.t.getTime() + 60000 });
  assert.equal((await mfaCall(forged, codeAt(secret, env))).json.error, 'mfa_expired', 'чужая подпись');
  assert.equal((await mfaCall('мусор', '123456')).json.error, 'mfa_expired');
  r = await direct('marcus', 'Secret-1');
  assert.equal((await mfaCall(r.json.mfa_token, codeAt(secret, env), { client_id: '4one-site' })).json.error, 'mfa_expired', 'токен другого клиента');

  // 5 неверных попыток на один токен — дальше токен не принимается даже с верным кодом
  r = await direct('marcus', 'Secret-1');
  for (let i = 0; i < 5; i++) assert.equal((await mfaCall(r.json.mfa_token, '000000')).status, 401);
  x = await mfaCall(r.json.mfa_token, codeAt(secret, env));
  assert.equal(x.status, 400); assert.equal(x.json.error, 'mfa_expired');

  // лимит по логину: всего 10 ошибок за 10 минут, даже с новыми токенами
  r = await direct('marcus', 'Secret-1');
  for (let i = 0; i < 5; i++) assert.equal((await mfaCall(r.json.mfa_token, 'AAAA-AAAA')).status, 401);
  r = await direct('marcus', 'Secret-1');
  x = await mfaCall(r.json.mfa_token, codeAt(secret, env));
  assert.equal(x.status, 429); assert.equal(x.json.error, 'rate_limited');
  env.tick(10 * 60 + 1);
  r = await direct('marcus', 'Secret-1');
  assert.equal((await mfaCall(r.json.mfa_token, codeAt(secret, env))).status, 200, 'после окна снова можно');
});

test('mfa_token нельзя подсунуть вместо tx формы и наоборот', async () => {
  const env = boot();
  await enable2fa(env);
  const r = await direct('marcus', 'Secret-1');
  const form = await call('POST', '/oauth/authorize', { form: { tx: r.json.mfa_token, login: 'marcus', password: 'Secret-1' } });
  assert.equal(form.status, 400); assert.ok(!form.text.includes('code='));
  const wrongKind = await call('POST', '/oauth/authorize', { form: { mtx: r.json.mfa_token, code: '123456' } });
  assert.equal(wrongKind.status, 400);
});

// ---------- браузерный вход
async function browserStart(clientId, redirectUri, verifier) {
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state: 'st-9', code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256', device_name: 'PC' });
  const page = await call('GET', `/oauth/authorize?${q}`);
  return /name="tx" value="([^"]+)"/.exec(page.text)[1];
}
const mtxOf = (html) => { const m = /name="mtx" value="([^"]+)"/.exec(html); return m && m[1]; };

test('браузерный вход с 2FA: шаг с кодом, неверный код на той же странице, затем код авторизации', async () => {
  const env = boot();
  const { secret } = await enable2fa(env);
  const verifier = randomToken(48);
  const tx = await browserStart(LAUNCHER, 'gta4one://auth/callback', verifier);
  const step = await call('POST', '/oauth/authorize', { form: { tx, login: 'marcus', password: 'Secret-1' } });
  assert.equal(step.status, 200);
  assert.ok(!step.text.includes('code=') && step.text.includes('name="code"'), 'вместо кода — второй шаг');
  const mtx = mtxOf(step.text); assert.ok(mtx);

  const bad = await call('POST', '/oauth/authorize', { form: { mtx, code: '000000' } });
  assert.equal(bad.status, 401); assert.ok(bad.text.includes('Неверный код.')); assert.ok(!bad.text.includes('code='));
  assert.equal(mtxOf(bad.text), mtx, 'тот же шаг можно повторить');

  const done = await call('POST', '/oauth/authorize', { form: { mtx, code: codeAt(secret, env) } });
  assert.equal(done.status, 200);
  const code = decodeURIComponent(/code=([^&"]+)&amp;state=st-9/.exec(done.text)[1]);
  const t = await call('POST', '/oauth/token', { body: { grant_type: 'authorization_code', client_id: LAUNCHER, code, redirect_uri: 'gta4one://auth/callback', code_verifier: verifier } });
  assert.equal(t.status, 200);
  assert.equal((await call('POST', '/oauth/authorize', { form: { mtx, code: codeAt(secret, env) } })).status, 400, 'шаг одноразовый');
});

test('браузерный вход с 2FA на сайте: CSP шага разрешает возврат на сайт, затем 302 с кодом', async () => {
  const env = boot({ CORE_STORE: 'memory', CORE_SITE_REDIRECTS: `${SITE}/auth/callback` });
  const { backup } = await enable2fa(env);
  const tx = await browserStart('4one-site', `${SITE}/auth/callback`, randomToken(48));
  const step = await call('POST', '/oauth/authorize', { form: { tx, login: 'marcus', password: 'Secret-1' } });
  assert.match(step.h['content-security-policy'], /form-action 'self' https:\/\/www\.4onerp\.com;/);
  const done = await call('POST', '/oauth/authorize', { form: { mtx: mtxOf(step.text), code: backup[0] } });
  assert.equal(done.status, 302);
  const loc = new URL(done.h.location);
  assert.equal(loc.searchParams.get('state'), 'st-9'); assert.ok(loc.searchParams.get('code'));
  const ev = env.store._content.events.filter((e) => e.login === 'marcus');
  assert.equal(ev[ev.length - 1].method, 'site');
});

test('браузерный вход: просроченный шаг и лимит попыток', async () => {
  const env = boot();
  const { secret } = await enable2fa(env);
  const step = async () => mtxOf((await call('POST', '/oauth/authorize', { form: { tx: await browserStart(LAUNCHER, 'gta4one://auth/callback', randomToken(48)), login: 'marcus', password: 'Secret-1' } })).text);
  const old = await step();
  env.tick(5 * 60 + 1);
  assert.equal((await call('POST', '/oauth/authorize', { form: { mtx: old, code: codeAt(secret, env) } })).status, 400, 'шаг истёк через 5 минут');
  const mtx = await step();
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/oauth/authorize', { form: { mtx, code: '000000' } })).status, 401);
  const exp = await call('POST', '/oauth/authorize', { form: { mtx, code: codeAt(secret, env) } });
  assert.equal(exp.status, 400); assert.ok(exp.text.includes('Время на ввод кода вышло'));
});

test('без 2FA браузерный вход не меняется: сразу код авторизации', async () => {
  boot();
  const tx = await browserStart(LAUNCHER, 'gta4one://auth/callback', randomToken(48));
  const done = await call('POST', '/oauth/authorize', { form: { tx, login: 'dante', password: 'Dante-pw1' } });
  assert.equal(done.status, 200); assert.ok(/code=[^&"]+&amp;state=st-9/.test(done.text));
});
