'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { world, signIn } = require('./world');

test('каталог: серверы, новости, клиент, объявление — без входа; битый адрес отброшен', async () => {
  const w = world();
  const r = await w.data.bootstrap(true);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepStrictEqual(r.data.servers.map((s) => s.id), ['main']);
  assert.strictEqual(r.data.servers[0].online, 37); assert.strictEqual(r.data.servers[0].address, '127.0.0.1:22005');
  assert.strictEqual(r.data.news[0].title, 'Обновление 1.4');
  assert.strictEqual(r.data.client.version, '1.0.7'); assert.strictEqual(r.data.notice, 'Техработы в 04:00');
  assert.strictEqual(r.data.selectedServerId, 'main');
  assert.strictEqual(w.auth.state().authed, false, 'вход для каталога не нужен');
});

test('каталог: API недоступен — кэш с пометкой stale, потом ошибка сети без кэша', async () => {
  let down = false;
  const w = world({ fetch: (real) => async (u, i) => { if (down) throw new Error('offline'); return real(u, i); } });
  const ok1 = await w.data.bootstrap(true); assert.ok(ok1.ok && !ok1.data.stale);
  down = true;
  const cached = await w.data.bootstrap(true); assert.ok(cached.ok && cached.data.stale, 'показываем сохранённое');
  const fresh = world({ fetch: () => async () => { throw new Error('offline'); } });
  assert.strictEqual((await fresh.data.bootstrap(true)).code, 'network_error');
});

test('промокод: награда, история, баланс в профиле растёт; повтор, срок и мусор — понятные коды', async () => {
  const w = await signIn(world(), 'marcus', 'Secret-1');
  assert.strictEqual(w.auth.state().profile.balance4c, 1200);
  const r = await w.codes.redeem('welcome4');
  assert.ok(r.ok, JSON.stringify(r)); assert.deepStrictEqual(r.data.reward, { kind: 'coins', amount: 100 }); assert.strictEqual(r.data.title, 'Приветственный бонус');
  assert.strictEqual((await w.codes.redeem('WELCOME4')).code, 'promo_used');
  assert.strictEqual((await w.codes.redeem('OLD00000')).code, 'promo_expired');
  assert.strictEqual((await w.codes.redeem('NOSUCH12')).code, 'promo_not_found');
  assert.strictEqual((await w.codes.redeem('<x>')).code, 'promo_not_found');
  const h = await w.codes.history(); assert.ok(h.ok); assert.deepStrictEqual(h.data.map((x) => x.code), ['WELCOME4']);
  await w.auth.revalidate();
  assert.strictEqual(w.auth.state().profile.balance4c, 1300, 'баланс с зачислением, которое игра ещё применит');
});

test('промокод без входа: invalid_session, запрос не уходит', async () => {
  const w = world();
  assert.strictEqual((await w.codes.redeem('WELCOME4')).code, 'invalid_session');
  assert.strictEqual((await w.codes.history()).code, 'invalid_session');
});

test('аккаунт: кошелёк, персонажи, безопасность, история входов', async () => {
  const w = await signIn(world(), 'marcus', 'Secret-1');
  await w.codes.redeem('WELCOME4');
  const wal = await w.account.wallet(); assert.ok(wal.ok); assert.strictEqual(wal.data.balance, 1300); assert.strictEqual(wal.data.items[0].amount, 100);
  const ch = await w.account.characters(); assert.ok(ch.ok); assert.strictEqual(ch.data[0].name, 'Marcus Reed'); assert.strictEqual(ch.data[0].bank, 31000);
  const sec = await w.account.security(); assert.ok(sec.ok); assert.strictEqual(sec.data.passwordSet, true);
  const his = await w.account.history(); assert.ok(his.ok); assert.ok(his.data.length >= 1 && his.data.every((e) => e.ip === '127.0.0.x' || e.ip === ''), JSON.stringify(his.data));
});

test('аккаунт: сессии — завершить чужую и все остальные, текущую нельзя', async () => {
  const a = await signIn(world(), 'marcus', 'Secret-1');
  // вторая «установка лаунчера» на тот же сервер: второй вход тем же handler-ом
  const { parseDeepLink } = require('../src/main/protocol');
  const { browserLogin } = require('./world');
  const second = { ...a, opened: [] };
  const { createOAuthClient } = require('../src/main/api/oauth');
  const oauth2 = createOAuthClient({ url: 'http://core.test', fetch: a.fetch, log: { info() {}, warn() {}, error() {} } });
  const flow = oauth2.newFlow('LAPTOP · Windows');
  const link = await browserLogin(a, flow.url, 'marcus', 'Secret-1');
  const t = await oauth2.exchangeCode(parseDeepLink(link).code, flow.verifier);
  assert.ok(t.ok);
  const list = await a.account.sessions(); assert.ok(list.ok); assert.strictEqual(list.data.length, 2);
  const mine = list.data.find((s) => s.current); const other = list.data.find((s) => !s.current);
  assert.strictEqual(other.device, 'LAPTOP');
  assert.strictEqual((await a.account.revokeSession(mine.id)).code, 'bad_request', 'свою сессию из списка не завершить');
  assert.ok((await a.account.revokeSession(other.id)).ok);
  assert.strictEqual((await oauth2.me(t.data.access)).code, 'invalid_session', 'завершённая сессия отключена на сервере');
  assert.ok((await a.account.revokeOthers()).ok);
  assert.ok(second);
});

test('access истёк: запросы данных сами обновляют токен (refresh), пользователь ничего не замечает', async () => {
  let clock = Date.now();
  const w = await signIn(world({ clock: () => clock, now: () => new Date(clock) }), 'marcus', 'Secret-1');
  const before = w.vault().refresh;
  clock += 20 * 60 * 1000;
  const wal = await w.account.wallet();
  assert.ok(wal.ok, JSON.stringify(wal));
  assert.notStrictEqual(w.vault().refresh, before, 'refresh вращался');
  assert.strictEqual(w.auth.state().authed, true);
});

test('сессию отозвали на сервере: запрос данных -> выход из лаунчера с причиной', async () => {
  const w = await signIn(world(), 'marcus', 'Secret-1');
  await w.oauth.revoke(w.vault().refresh);
  const r = await w.account.wallet();
  assert.strictEqual(r.code, 'invalid_session');
  assert.strictEqual(w.auth.state().authed, false); assert.strictEqual(w.auth.state().reason, 'invalid_session');
});
