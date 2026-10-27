'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createOAuthClient } = require('../src/main/api/oauth');
const { createBackend } = require('../src/main/api/backend');
const { createAuth } = require('../src/main/session');
const { parseDeepLink } = require('../src/main/protocol');

const { BASE, world, browserLogin } = require('./world');

test('сквозной вход: лаунчер -> страница входа -> ссылка -> токены -> профиль «Игрок»', async () => {
  const w = world();
  const r = await w.auth.login();
  assert.ok(r.ok && r.data.pending);
  assert.strictEqual(w.opened.length, 1);
  assert.match(w.opened[0], /\/oauth\/authorize\?.*code_challenge_method=S256/);
  assert.ok(!/password|verifier/i.test(w.opened[0]), 'verifier и пароль в адрес не попадают');
  assert.match(w.opened[0], /device_name=Test\+PC/);

  const link = await browserLogin(w, w.opened[0], 'marcus', 'Secret-1');
  assert.ok(link, 'после входа есть ссылка возврата');
  const parsed = parseDeepLink(link);
  assert.strictEqual(parsed.type, 'auth-callback');
  const s = await w.auth.handleCallback(parsed);
  assert.ok(s.ok, JSON.stringify(s));
  const st = w.auth.state();
  assert.strictEqual(st.authed, true); assert.strictEqual(st.pending, false);
  assert.strictEqual(st.profile.username, 'marcus'); assert.strictEqual(st.profile.gameName, 'Marcus Reed');
  assert.strictEqual(st.profile.role, 'Игрок'); assert.strictEqual(st.profile.roleInfo.alvl, 0);
  assert.strictEqual(st.profile.balance4c, 1200);
  assert.ok(w.auth.token(), 'access-токен доступен');
  const saved = w.vault();
  assert.ok(saved.refresh && saved.access, 'токены сохранены в vault');
  assert.ok(!JSON.stringify(saved).includes('Secret-1'), 'пароль нигде не хранится');
  assert.ok(w.events.some(([ev, p]) => ev === 'auth:changed' && p.authed));
});

test('администратор: роль «Администратор 5 уровня» и права из БД; смена уровня подхватывается', async () => {
  const w = world();
  await w.auth.login();
  const link = await browserLogin(w, w.opened[0], 'boss', 'Boss-pass');
  await w.auth.handleCallback(parseDeepLink(link));
  const p = w.auth.state().profile;
  assert.strictEqual(p.role, 'Администратор 5 уровня'); assert.strictEqual(p.roleInfo.rank, 'Старший администратор');
  assert.ok(p.permissions.includes('admin.panel') && p.permissions.includes('logs.view') && !p.permissions.includes('project.manage'));
  // уровень снят в игре (alvl = 0) -> следующая проверка профиля делает игроком
  await w.store.setAlvl('BossSC', 0);
  const before = w.events.length;
  await w.auth.revalidate();
  assert.strictEqual(w.auth.state().profile.role, 'Игрок'); assert.deepStrictEqual(w.auth.state().profile.permissions, []);
  assert.ok(w.events.length > before, 'интерфейс получил auth:changed');
  await w.store.setAlvl('BossSC', 8);
  await w.auth.revalidate();
  assert.strictEqual(w.auth.state().profile.role, 'Администратор 8 уровня');
});

test('чужая ссылка: неверный state и вход без ожидания отклоняются', async () => {
  const w = world();
  const stray = parseDeepLink(`gta4one://auth/callback?code=${'a'.repeat(30)}&state=${'b'.repeat(30)}`);
  assert.strictEqual((await w.auth.handleCallback(stray)).ok, false, 'без ожидающего входа');
  await w.auth.login();
  assert.strictEqual((await w.auth.handleCallback(stray)).ok, false, 'state не совпал');
  assert.strictEqual(w.auth.state().authed, false);
  // настоящий вход после неудачной чужой ссылки всё ещё возможен
  const link = await browserLogin(w, w.opened[0], 'marcus', 'Secret-1');
  assert.ok((await w.auth.handleCallback(parseDeepLink(link))).ok);
});

test('ссылка возврата одноразовая: повтор не даёт вход', async () => {
  const w = world();
  await w.auth.login();
  const link = await browserLogin(w, w.opened[0], 'marcus', 'Secret-1');
  assert.ok((await w.auth.handleCallback(parseDeepLink(link))).ok);
  assert.strictEqual((await w.auth.handleCallback(parseDeepLink(link))).ok, false);
});

test('неверный пароль: ссылки возврата нет', async () => {
  const w = world();
  await w.auth.login();
  assert.strictEqual(await browserLogin(w, w.opened[0], 'marcus', 'wrong'), null);
});

test('отмена входа сбрасывает ожидание, старая ссылка больше не принимается', async () => {
  const w = world();
  await w.auth.login();
  const link = await browserLogin(w, w.opened[0], 'marcus', 'Secret-1');
  await w.auth.cancel();
  assert.strictEqual(w.auth.state().pending, false);
  assert.strictEqual((await w.auth.handleCallback(parseDeepLink(link))).ok, false);
});

test('перезапуск: сессия восстанавливается из vault, access обновляется через refresh', async () => {
  let clock = Date.now();
  const w = world({ clock: () => clock, now: () => new Date(clock) });
  await w.auth.login();
  await w.auth.handleCallback(parseDeepLink(await browserLogin(w, w.opened[0], 'boss', 'Boss-pass')));
  const saved = w.vault();
  clock += 20 * 60 * 1000; // access (15 минут) истёк
  const again = world({ clock: () => clock, now: () => new Date(clock) });
  // тот же «сервер»: берём хранилище и обработчик первого мира
  const oauth2 = createOAuthClient({ url: BASE, fetch: w.fetch, log: { info() {}, warn() {}, error() {} } });
  let vd = JSON.parse(JSON.stringify(saved));
  const auth2 = createAuth({ oauth: oauth2, backend: createBackend({ fns: {}, call: async () => ({ ok: false }) }), vault: { load: () => vd, save: (o) => { vd = o; }, clear: () => { vd = null; } }, bus: { emit() {} }, log: { info() {}, warn() {}, error() {} }, openAuth: async () => ({ ok: true }), now: () => clock });
  const st = await auth2.restore();
  assert.strictEqual(st.authed, true); assert.strictEqual(st.offline, false);
  assert.strictEqual(st.profile.role, 'Администратор 5 уровня');
  assert.notStrictEqual(vd.refresh, saved.refresh, 'refresh вращается');
  assert.ok(again);
});

test('нет сети при старте: показываем кэш как непроверенный (offline), потом revalidate', async () => {
  const w = world();
  await w.auth.login();
  await w.auth.handleCallback(parseDeepLink(await browserLogin(w, w.opened[0], 'boss', 'Boss-pass')));
  const saved = w.vault();
  const down = createOAuthClient({ url: BASE, fetch: async () => { throw new Error('offline'); }, log: { info() {}, warn() {}, error() {} } });
  let vd = { ...saved, expiresAt: 0 };
  const backend = createBackend({ fns: {}, call: async () => ({ ok: false }) });
  const auth2 = createAuth({ oauth: down, backend, vault: { load: () => vd, save: (o) => { vd = o; }, clear: () => { vd = null; } }, bus: { emit() {} }, log: { info() {}, warn() {}, error() {} }, openAuth: async () => ({ ok: true }) });
  const st = await auth2.restore();
  assert.strictEqual(st.authed, true); assert.strictEqual(st.offline, true);
  assert.strictEqual(st.profile.role, 'Администратор 5 уровня', 'кэш роли показан');
  assert.ok(vd, 'при обрыве сети сессия не сбрасывается');
});

test('отозванная сессия: restore сбрасывает вход', async () => {
  const w = world();
  await w.auth.login();
  await w.auth.handleCallback(parseDeepLink(await browserLogin(w, w.opened[0], 'marcus', 'Secret-1')));
  const refresh = w.vault().refresh;
  await w.oauth.revoke(refresh);
  const st = await w.auth.restore();
  assert.strictEqual(st.authed, false); assert.strictEqual(st.reason, 'invalid_session');
  assert.strictEqual(w.vault(), null);
});

test('выход: токены стираются, сессия отзывается на сервере', async () => {
  const w = world();
  await w.auth.login();
  await w.auth.handleCallback(parseDeepLink(await browserLogin(w, w.opened[0], 'marcus', 'Secret-1')));
  const refresh = w.vault().refresh;
  await w.auth.logout();
  assert.strictEqual(w.auth.state().authed, false); assert.strictEqual(w.vault(), null); assert.strictEqual(w.auth.token(), null);
  await new Promise((r) => setTimeout(r, 20));
  const r = await w.oauth.refresh(refresh);
  assert.strictEqual(r.ok, false, 'старый refresh на сервере уже не работает');
});

test('ошибка страницы входа: openAuth не смог открыть браузер -> ожидание не включается', async () => {
  const w = world();
  const bad = createAuth({ oauth: w.oauth, backend: createBackend({ fns: {}, call: async () => ({ ok: false }) }), vault: { load: () => null, save() {}, clear() {} }, bus: { emit() {} }, log: { info() {}, warn() {}, error() {} }, openAuth: async () => ({ ok: false, code: 'bad_request' }) });
  const r = await bad.login();
  assert.strictEqual(r.ok, false); assert.strictEqual(bad.state().pending, false);
});

test('OAuth-клиент: PKCE-пара согласована с сервером, адрес входа без секретов', () => {
  const { verifyPkce } = require('../backend/core-api/src/tokens');
  const c = createOAuthClient({ url: BASE, fetch: async () => { throw new Error('no'); } });
  const f = c.newFlow('PC');
  const q = new URL(f.url).searchParams;
  assert.strictEqual(q.get('client_id'), '4one-launcher'); assert.strictEqual(q.get('redirect_uri'), 'gta4one://auth/callback');
  assert.strictEqual(q.get('state'), f.state);
  assert.ok(verifyPkce(f.verifier, q.get('code_challenge')));
  assert.notStrictEqual(c.newFlow().state, f.state, 'каждый вход — новый state');
});

test('OAuth-клиент: ошибки сервера и сети -> коды лаунчера', async () => {
  const mk = (status, body) => createOAuthClient({ url: BASE, fetch: async () => ({ ok: status < 300, status, json: async () => body }) });
  assert.strictEqual((await mk(400, { error: 'invalid_grant' }).refresh('x')).code, 'invalid_session');
  assert.strictEqual((await mk(401, { error: 'invalid_token' }).me('x')).code, 'invalid_session');
  assert.strictEqual((await mk(500, {}).me('x')).code, 'network_error');
  assert.strictEqual((await mk(404, {}).me('x')).code, 'network_error');
  assert.strictEqual((await mk(429, {}).refresh('x')).code, 'busy');
  assert.strictEqual((await mk(200, {}).refresh('x')).code, 'login_failed', 'ответ без токенов — ошибка');
  const aborted = createOAuthClient({ url: BASE, fetch: async () => { const e = new Error('t'); e.name = 'AbortError'; throw e; } });
  assert.strictEqual((await aborted.me('x')).code, 'timeout');
});
