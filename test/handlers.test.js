'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createHandlers, normalizeCode, isValidCodeFormat } = require('../src/core/handlers');
const { createMock } = require('../src/mock');

test('normalizeCode: регистр, пробелы, дефисы', () => {
  assert.strictEqual(normalizeCode(' ab12-cd34 '), 'AB12CD34');
  assert.strictEqual(normalizeCode(null), '');
  assert.ok(isValidCodeFormat('abcd-1234'));
  assert.ok(!isValidCodeFormat('ab'));
  assert.ok(!isValidCodeFormat('ab$$cd12'));
});

test('вход через сайт: login -> ожидание -> вход; cancel и logout', async () => {
  const m = createMock({ scenario: 'login' }); const h = createHandlers(m.services);
  assert.strictEqual((await h['auth:status']()).data.authed, false);
  const r = await h['auth:login']();
  assert.ok(r.ok && r.data.pending === true, JSON.stringify(r));
  assert.strictEqual((await h['auth:cancel']()).data.pending, false);
  assert.strictEqual((await h['auth:status']()).data.authed, false);
  await h['auth:login']();
  await new Promise((res) => setTimeout(res, 1100));
  const s = (await h['auth:status']()).data;
  assert.strictEqual(s.authed, true); assert.strictEqual(s.pending, false);
  assert.strictEqual((await h['auth:logout']()).data.authed, false);
});

test('роль в профиле: игрок и администратор n уровня', async () => {
  const p = (await createHandlers(createMock({ scenario: 'ready' }).services)['auth:status']()).data.profile;
  assert.strictEqual(p.role, 'Игрок'); assert.strictEqual(p.roleInfo.alvl, 0); assert.deepStrictEqual(p.permissions, []);
  const a = (await createHandlers(createMock({ scenario: 'admin' }).services)['auth:status']()).data.profile;
  assert.strictEqual(a.role, 'Администратор 5 уровня'); assert.strictEqual(a.roleInfo.rank, 'Старший администратор');
  assert.ok(a.permissions.includes('admin.panel') && a.permissions.includes('logs.view'));
});

test('неверные аргументы не роняют обработчики', async () => {
  const h = createHandlers(createMock({}).services);
  assert.strictEqual((await h['app:openPath']('/etc')).code, 'bad_request');
  assert.strictEqual((await h['app:openExternal'](42)).code, 'bad_request');
  assert.strictEqual((await h['settings:set']([1])).code, 'bad_request');
  assert.strictEqual((await h['game:setPath'](null)).code, 'bad_request');
});

test('промокод: награда зачисляется, повтор и мусор отклоняются', async () => {
  const m = createMock({}); const h = createHandlers(m.services);
  const before = m.services.auth.state().profile.balance4c;
  const r = await h['codes:redeem']('welcome4');
  assert.ok(r.ok); assert.strictEqual(m.services.auth.state().profile.balance4c, before + 100);
  assert.strictEqual((await h['codes:redeem']('???')).code, 'promo_not_found');
  assert.strictEqual((await h['codes:redeem']('EXPIRED0')).code, 'promo_expired');
  assert.ok((await h['codes:history']()).data.length >= 3);
});

test('исключение в сервисе превращается в ошибку unknown', async () => {
  const s = createMock({}).services; s.codes.history = async () => { throw new Error('boom'); };
  const r = await createHandlers(s)['codes:history']();
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'unknown');
});

test('аккаунт: сессии, история, кошелёк, персонажи отдаются и валидируются', async () => {
  const h = createHandlers(createMock({}).services);
  const sec = await h['account:security'](); assert.ok(sec.ok && Array.isArray(sec.data.links));
  const ses = await h['account:sessions'](); assert.ok(ses.ok && ses.data.some((x) => x.current));
  assert.ok((await h['account:history']()).ok);
  const w = await h['account:wallet'](); assert.ok(w.ok && typeof w.data.balance === 'number' && Array.isArray(w.data.items));
  assert.ok((await h['account:characters']()).ok);
});

test('аккаунт: завершить можно чужую сессию, но не текущую; без id — ошибка', async () => {
  const h = createHandlers(createMock({}).services);
  assert.strictEqual((await h['account:revokeSession']('')).ok, false);
  assert.strictEqual((await h['account:revokeSession']('s1')).ok, false);   // s1 — текущая
  assert.strictEqual((await h['account:revokeSession']('s2')).ok, true);
  assert.strictEqual((await h['account:revokeOthers']()).ok, true);
  const left = (await h['account:sessions']()).data; assert.strictEqual(left.length, 1);
});
