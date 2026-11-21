'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { world, signIn } = require('./world');
const { base32Decode, totp } = require('../backend/core-api/src/totp');

// Сквозной путь лаунчер → настоящий Core API (в памяти): вход по паролю, подключение 2FA, вход с кодом.
test('вход по логину и паролю прямо в лаунчере, без 2FA', async () => {
  const w = world();
  const bad = await w.auth.passwordLogin('marcus', 'wrong');
  assert.strictEqual(bad.code, 'invalid_credentials');
  const r = await w.auth.passwordLogin('marcus', 'Secret-1');
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(w.auth.state().authed, true);
  assert.strictEqual(w.auth.state().profile.username, 'marcus');
  assert.ok(w.vault() && w.vault().refresh, 'сессия сохранена');
});

test('2FA: подключение в аккаунте, затем вход с кодом из приложения и резервным кодом', async () => {
  let clock = Date.parse('2026-11-11T12:00:00Z');
  const w = world({ now: () => new Date(clock) });
  await signIn(w, 'marcus', 'Secret-1');

  const setup = await w.account.mfaSetup();
  assert.ok(setup.ok, JSON.stringify(setup));
  assert.match(setup.data.otpauth, /^otpauth:\/\/totp\//);
  assert.match(setup.data.qr, /^data:image\/png;base64,/, 'QR нарисован в main');
  const key = base32Decode(setup.data.secret);

  assert.strictEqual((await w.account.mfaEnable('000000')).code, 'invalid_mfa_code');
  const en = await w.account.mfaEnable(totp(key, clock));
  assert.ok(en.ok, JSON.stringify(en));
  assert.strictEqual(en.data.backupCodes.length, 10);
  assert.strictEqual((await w.account.security()).data.twoFactor, true);

  await w.auth.logout();
  clock += 60 * 1000; // новый шаг TOTP: тот же код повторно не примут
  const step1 = await w.auth.passwordLogin('marcus', 'Secret-1');
  assert.ok(step1.ok); assert.strictEqual(w.auth.state().mfa, true); assert.strictEqual(w.auth.state().authed, false);
  assert.strictEqual((await w.auth.submitMfa('123456')).code, 'invalid_mfa_code');
  const ok2 = await w.auth.submitMfa(totp(key, clock));
  assert.ok(ok2.ok, JSON.stringify(ok2)); assert.strictEqual(w.auth.state().authed, true); assert.strictEqual(w.auth.state().mfa, false);

  // резервный код работает один раз
  await w.auth.logout();
  await w.auth.passwordLogin('marcus', 'Secret-1');
  const backup = en.data.backupCodes[0];
  assert.ok((await w.auth.submitMfa(backup)).ok);
  await w.auth.logout();
  await w.auth.passwordLogin('marcus', 'Secret-1');
  assert.strictEqual((await w.auth.submitMfa(backup)).code, 'invalid_mfa_code');
  await w.auth.cancelMfa(); assert.strictEqual(w.auth.state().mfa, false);
});

test('регистрация из лаунчера: аккаунт в игровой базе, вход сразу; повтор логина — занят', async () => {
  const w = world();
  const r = await w.auth.register({ login: 'Newbie_1', email: 'new@mail.ru', password: 'Qwerty123', promo: '' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(w.auth.state().authed, true);
  assert.strictEqual(w.auth.state().profile.username.toLowerCase(), 'newbie_1');
  const acc = await w.store.findAccount('newbie_1');
  assert.ok(acc && acc.passwordHash.startsWith('p2$'), 'хеш в формате игры');
  await w.auth.logout();
  assert.strictEqual((await w.auth.register({ login: 'NEWBIE_1', email: 'other@mail.ru', password: 'Qwerty123' })).code, 'login_taken');
  assert.strictEqual((await w.auth.register({ login: 'Other_2', email: 'NEW@mail.ru', password: 'Qwerty123' })).code, 'email_taken');
  assert.ok((await w.auth.passwordLogin('Newbie_1', 'Qwerty123')).ok, 'вход тем же паролем');
});
