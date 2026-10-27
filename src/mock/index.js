'use strict';
/**
 * Мок-сервисы для демо-режима (L4_MOCK=1) и браузерного предпросмотра. Чистый JS: без electron и node.
 * Данные демонстрационные (названия серверов, новости, балансы) — не продакшен.
 * Сценарии: login | ready | admin (администратор 5 уровня) | not-installed | update | no-gta | enhanced | offline | downloading | ingame
 */
const { ok, fail } = require('../core/contract');

const PROFILE = {
  authUserId: 'demo-0001', username: 'dante.rivera', email: 'dante@example.com', nickname: 'dante.rivera',
  gameName: 'Dante Rivera', role: 'Игрок', accountId: '482', accountStatus: 'active', authMethod: 'discord',
  balance4c: 1250, level: 7, faction: '', hours: 36, launcherAccess: true, createdAt: '2026-08-14',
};

// роль как в Core API (backend/core-api/src/roles.js): уровень -> права; для демо продублировано
const PERMS = [['admin.panel', 1], ['players.view', 2], ['players.moderate', 3], ['logs.view', 5], ['logs.export', 6], ['project.manage', 6], ['staff.manage', 7], ['owner', 8]];
const RANKS = ['Игрок', 'Модератор', 'Хелпер', 'Администратор', 'Курирующий администратор', 'Старший администратор', 'Главный администратор', 'PR Manager / Developer', 'Руководство проекта'];
const roleOf = (alvl) => ({
  role: alvl > 0 ? `Администратор ${alvl} уровня` : 'Игрок',
  roleInfo: { alvl, title: alvl > 0 ? `Администратор ${alvl} уровня` : 'Игрок', rank: RANKS[alvl], isStaff: alvl > 0 },
  permissions: PERMS.filter(([, min]) => alvl >= min).map(([n]) => n),
});

const SERVERS = [
  { id: 'main', name: '4ONE RP', tag: 'DEV', status: 'online', online: 37, max: 500, address: '127.0.0.1:22005', version: '1.0.3889.0', description: 'Основной сервер. Тестовый период.', recommended: true },
  { id: 'test', name: '4ONE RP · Тест', tag: 'TEST', status: 'maintenance', online: 0, max: 100, address: '127.0.0.1:22006', version: '1.0.3889.0', description: 'Технические работы.' },
  { id: 'hard', name: '4ONE · Хардкор', tag: 'HARD', status: 'online', online: 112, max: 300, address: '127.0.0.1:22007', version: '1.0.3889.0', description: 'Строгие правила, перманентная смерть персонажа.' },
  { id: 'start', name: '4ONE · Старт', tag: 'NEW', status: 'online', online: 64, max: 200, address: '127.0.0.1:22008', version: '1.0.3889.0', description: 'Мягкий вход: подсказки, наставники и стартовый набор.' },
];

const NEWS = [
  { id: 'n1', title: 'Обновление 1.4: семьи и особняки', excerpt: 'Регистрация семей в планшете, первые особняки на карте и новое круговое меню на G.', category: 'updates', date: '2026-10-18', cover: 'sultan', url: '' },
  { id: 'n2', title: 'Ночные гонки: Дель-Перро', excerpt: 'Пятница, 22:00. Запись в лобби, призовой фонд в 4Coin.', category: 'events', date: '2026-10-10', cover: 'comet2', url: '' },
  { id: 'n3', title: 'Осенний сезонный пропуск', excerpt: '20 уровней наград: транспорт, одежда, 4Coin.', category: 'news', date: '2026-10-01', cover: 'kuruma', url: '' },
  { id: 'n4', title: 'Изменения в законодательной базе', excerpt: 'Обновлён Уголовный кодекс, правила розыска и штрафов.', category: 'laws', date: '2026-09-27', cover: '', url: '' },
  { id: 'n5', title: 'Правила проекта: общие положения', excerpt: 'Что нового в разделах ГОСС и КРАЙМ.', category: 'rules', date: '2026-09-20', cover: '', url: '' },
];

const MB = 1024 * 1024;
const TOTAL = 1180 * MB;

function createBus() {
  const subs = {};
  return {
    emit(ev, payload) { (subs[ev] || []).slice().forEach((f) => { try { f(payload); } catch (_) { /* ignore */ } }); },
    on(ev, f) { (subs[ev] = subs[ev] || []).push(f); return () => { subs[ev] = (subs[ev] || []).filter((x) => x !== f); }; },
  };
}

function createMock(opts) {
  const o = opts || {};
  const bus = o.bus || createBus();
  const scenario = o.scenario || 'ready';
  const frozen = !!o.frozen;               // для скриншотов: замереть на прогрессе
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const mem = {};
  const store = {
    get: (k, d) => { try { const v = globalThis.localStorage && globalThis.localStorage.getItem('l4mock:' + k); return v == null ? (k in mem ? mem[k] : d) : JSON.parse(v); } catch (_) { return k in mem ? mem[k] : d; } },
    set: (k, v) => { mem[k] = v; try { globalThis.localStorage && globalThis.localStorage.setItem('l4mock:' + k, JSON.stringify(v)); } catch (_) { /* ignore */ } },
  };

  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  const S = {
    sessions: [
      { id: 's1', device: 'Этот компьютер', os: 'Windows 11', ip: '185.23.•••.•••', place: 'Москва', lastAt: ago(0), current: true },
      { id: 's2', device: 'Ноутбук', os: 'Windows 10', ip: '94.45.•••.•••', place: 'Санкт-Петербург', lastAt: ago(60 * 26), current: false },
      { id: 's3', device: 'Браузер, сайт', os: 'Chrome на Android', ip: '178.66.•••.•••', place: 'Казань', lastAt: ago(60 * 24 * 5), current: false },
    ],
    tx: [
      { id: 't1', at: '2026-10-24T18:10:00Z', title: 'Пополнение на сайте', amount: 500 },
      { id: 't2', at: '2026-10-20T12:00:00Z', title: 'Покупка: набор «Осень»', amount: -350 },
      { id: 't3', at: '2026-10-14T09:05:00Z', title: 'Награда за Discord', amount: 25 },
      { id: 't4', at: '2026-10-12T14:20:00Z', title: 'Стартовый бонус', amount: 100 },
      { id: 't5', at: '2026-10-05T20:40:00Z', title: 'Пополнение на сайте', amount: 975 },
    ],
    authed: scenario !== 'login', offline: scenario === 'offline', balance: PROFILE.balance4c, alvl: scenario === 'admin' ? 5 : 0, pending: false,
    history: [
      { id: 'h1', code: 'START100', title: 'Стартовый бонус', reward: { kind: 'coins', amount: 100 }, at: '2026-10-12T14:20:00Z' },
      { id: 'h2', code: 'DISCORD25', title: 'Награда за Discord', reward: { kind: 'coins', amount: 25 }, at: '2026-10-14T09:05:00Z' },
    ],
  };
  const profile = () => Object.assign({}, PROFILE, roleOf(S.alvl), { balance4c: S.balance });
  const authState = () => ({ authed: S.authed, profile: S.authed ? profile() : null, offline: S.offline, reason: '', pending: S.pending });

  // ---- настройки
  const settingsDefaults = { gamePath: '', selectedServerId: 'main', closeAfterStart: false, minimizeToTray: true, autostart: false, autoUpdates: true, noBattleye: true, syncMods: true, playMinutes: 2160, lastSeenNews: '', accent: 'violet', lang: 'ru', scale: 'auto', animations: true, toasts: true, newsBadge: true };
  let settings = Object.assign({}, settingsDefaults, store.get('settings', {}));

  // ---- игра
  const gtaOk = { dir: 'C:\\Program Files\\Rockstar Games\\Grand Theft Auto V', source: 'rockstar', version: '1.0.3889.0', exe: 'C:\\Program Files\\Rockstar Games\\Grand Theft Auto V\\GTA5.exe', isSupported: true, hasLegacy: true, hasEnhanced: false };
  const G = { phase: 'ready', gta: gtaOk, client: { installed: true, version: '1.0.0', remoteVersion: '1.0.0', needsUpdate: false, updateBytes: 0 }, progress: null, error: null, running: false };
  const sc = {
    'not-installed': () => { G.phase = 'not-installed'; G.client = { installed: false, version: '', remoteVersion: '1.0.0', needsUpdate: false, updateBytes: 0 }; },
    update: () => { G.phase = 'needs-update'; G.client = { installed: true, version: '0.9.2', remoteVersion: '1.0.0', needsUpdate: true, updateBytes: 86 * MB }; },
    'no-gta': () => { G.phase = 'no-gta'; G.gta = null; G.client.installed = false; },
    enhanced: () => { G.phase = 'unsupported'; G.gta = Object.assign({}, gtaOk, { version: '', isSupported: false, hasLegacy: false, hasEnhanced: true, exe: gtaOk.dir + '\\GTA5_Enhanced.exe' }); G.error = { code: 'gta_unsupported', message: '' }; },
    downloading: () => { G.phase = 'installing'; G.client = { installed: false, version: '', remoteVersion: '1.0.0', needsUpdate: false, updateBytes: 0 }; G.progress = { stage: 'client', file: 'FloVMP.asi', done: Math.round(TOTAL * 0.43), total: TOTAL, speed: 24.6 * MB, eta: 27, percent: 43 }; },
    ingame: () => { G.phase = 'ingame'; G.running = true; },
  };
  if (scenario === 'ingame') sc.ingame(); else if (scenario === 'downloading') sc.downloading();
  else if (sc[scenario]) sc[scenario]();

  const pub = () => bus.emit('game:state', JSON.parse(JSON.stringify(G)));
  let timer = null; let cancelled = false;

  async function simulateInstall(total, verify) {
    cancelled = false; G.phase = verify ? 'verifying' : 'installing'; G.error = null;
    let done = 0; const speed = 24 * MB;
    return new Promise((resolve) => {
      timer = setInterval(() => {
        if (cancelled) { clearInterval(timer); G.progress = null; G.phase = G.client.installed ? 'ready' : 'not-installed'; pub(); return resolve(false); }
        done += speed / 5 * (0.85 + Math.random() * 0.3);
        const p = Math.min(done, total);
        G.progress = { stage: p < total * 0.06 ? 'scripthook' : 'client', file: p < total * 0.06 ? 'ScriptHookV' : 'FloVMP.asi', done: p, total, speed, eta: Math.round((total - p) / speed), percent: Math.floor(p / total * 100) };
        pub();
        if (p >= total) { clearInterval(timer); G.progress = null; G.client = { installed: true, version: '1.0.0', remoteVersion: '1.0.0', needsUpdate: false, updateBytes: 0 }; G.phase = 'ready'; pub(); resolve(true); }
      }, 200);
    });
  }
  if (scenario === 'downloading' && !frozen) { setTimeout(() => simulateInstall(TOTAL, false), 400); }

  const game = {
    getState: () => JSON.parse(JSON.stringify(G)),
    async detect() { return ok(game.getState()); },
    async browse() { return ok(game.getState()); },
    async setPath(p) { if (/enhanced/i.test(p)) { sc.enhanced(); } else { G.gta = Object.assign({}, gtaOk, { dir: p }); G.phase = G.client.installed ? 'ready' : 'not-installed'; G.error = null; } settings.gamePath = p; pub(); return ok(game.getState()); },
    async install() { if (frozen) return ok(game.getState()); await simulateInstall(G.phase === 'needs-update' ? 86 * MB : TOTAL, false); return ok(game.getState()); },
    async verify() { if (frozen) return ok(game.getState()); await simulateInstall(220 * MB, true); return ok(game.getState()); },
    async cancel() { cancelled = true; return ok(); },
    async uninstall() { G.client.installed = false; G.phase = 'not-installed'; pub(); return ok(game.getState()); },
    async play() {
      if (!S.authed) return fail('invalid_session');
      if (G.phase !== 'ready') { const r = await simulateInstall(G.phase === 'needs-update' ? 86 * MB : TOTAL, false); if (!r) return fail('cancelled'); }
      G.phase = 'launching'; G.progress = null; pub(); await delay(1600);
      G.phase = 'ingame'; G.running = true; pub();
      setTimeout(() => { G.running = false; G.phase = 'ready'; pub(); bus.emit('toast', { kind: 'info', text: 'GTA V закрыта' }); }, 12000);
      return ok(game.getState());
    },
  };

  // ---- сервисы
  const auth = {
    state: authState,
    async status() { return authState(); },
    /** Демо: «браузер» открывается и через секунду возвращает вход */
    async login() {
      S.pending = true; bus.emit('auth:changed', authState());
      setTimeout(() => { if (!S.pending) return; S.pending = false; S.authed = true; S.offline = false; bus.emit('auth:changed', authState()); }, 900);
      return ok(authState());
    },
    async cancel() { S.pending = false; bus.emit('auth:changed', authState()); return ok(authState()); },
    async logout() { S.authed = false; S.pending = false; bus.emit('auth:changed', authState()); return ok(authState()); },
  };
  const data = {
    async bootstrap() {
      await delay(120);
      if (scenario === 'offline') return Object.assign(fail('network_error'));
      return ok({ servers: SERVERS, news: NEWS, client: { version: '1.0.0' }, flags: {}, notice: scenario === 'update' ? null : null, selectedServerId: settings.selectedServerId, fetchedAt: Date.now(), stale: false });
    },
    async selectServer(id) { settings.selectedServerId = id; store.set('settings', settings); return ok({ selectedServerId: id }); },
  };
  const codes = {
    async redeem(code) {
      await delay(600);
      const bad = { USED0000: 'promo_used', EXPIRED0: 'promo_expired', LIMIT000: 'promo_limit' };
      if (bad[code]) return fail(bad[code]);
      const table = {
        WELCOME4: { title: 'Приветственный бонус', reward: { kind: 'coins', amount: 100 } },
        CARSET01: { title: 'Набор «Осень»', reward: { kind: 'vehicle', name: 'Sultan', image: 'sultan' } },
      };
      const hit = table[code];
      if (!hit) return fail('promo_not_found');
      if (hit.reward.kind === 'coins') S.balance += hit.reward.amount;
      const rec = { id: 'h' + (S.history.length + 1), code, title: hit.title, reward: hit.reward, at: new Date().toISOString() };
      S.history.unshift(rec); if (hit.reward.kind === 'coins') S.tx.unshift({ id: 't' + (S.tx.length + 1), at: rec.at, title: hit.title, amount: hit.reward.amount });
      bus.emit('auth:changed', authState());
      return ok(rec);
    },
    async history() { return ok(S.history.slice()); },
  };
  const account = {
    async security() { await delay(200); return ok({ emailVerified: true, twoFactor: false, passwordSet: true, links: [
      { provider: 'discord', linked: true, label: 'dante#2026' }, { provider: 'email', linked: true, label: PROFILE.email },
      { provider: 'google', linked: false, label: '' }, { provider: 'telegram', linked: false, label: '' }, { provider: 'steam', linked: false, label: '' }, { provider: 'vk', linked: false, label: '' }] }); },
    async sessions() { await delay(250); return ok(S.sessions.map((x) => Object.assign({}, x))); },
    async revokeSession(id) { await delay(300); const i = S.sessions.findIndex((x) => x.id === id && !x.current); if (i < 0) return fail('bad_request'); S.sessions.splice(i, 1); return ok({}); },
    async revokeOthers() { await delay(350); S.sessions = S.sessions.filter((x) => x.current); return ok({}); },
    async history() {
      await delay(250);
      return ok([
        { id: 'l1', at: ago(0), device: 'Этот компьютер · Windows 11', ip: '185.23.•••.•••', place: 'Москва', method: 'launcher', ok: true },
        { id: 'l2', at: ago(60 * 26), device: 'Ноутбук · Windows 10', ip: '94.45.•••.•••', place: 'Санкт-Петербург', method: 'launcher', ok: true },
        { id: 'l3', at: ago(60 * 27), device: 'Неизвестное устройство', ip: '45.12.•••.•••', place: 'Франкфурт', method: 'site', ok: false },
        { id: 'l4', at: ago(60 * 24 * 5), device: 'Браузер, сайт · Chrome на Android', ip: '178.66.•••.•••', place: 'Казань', method: 'site', ok: true },
        { id: 'l5', at: ago(60 * 24 * 12), device: 'Этот компьютер · Windows 11', ip: '185.23.•••.•••', place: 'Москва', method: 'launcher', ok: true },
      ]);
    },
    async wallet() { await delay(220); return ok({ balance: S.balance, items: S.tx.map((x) => Object.assign({}, x)) }); },
    async characters() { await delay(220); return ok([
      { id: 'c1', name: 'Dante Rivera', level: 7, job: 'Таксист', cash: 3420, bank: 18900, lastAt: ago(60 * 3) },
      { id: 'c2', name: 'Marco Bellini', level: 2, job: 'Безработный', cash: 150, bank: 0, lastAt: ago(60 * 24 * 9) },
    ]); },
  };
  const settingsSvc = {
    get: () => Object.assign({}, settings),
    async set(patch) { settings = Object.assign({}, settings, patch); store.set('settings', settings); return Object.assign({}, settings); },
    async reset() { const keep = { gamePath: settings.gamePath, selectedServerId: settings.selectedServerId, lastSeenNews: settings.lastSeenNews, playMinutes: settings.playMinutes }; settings = Object.assign({}, settingsDefaults, keep); store.set('settings', settings); return Object.assign({}, settings); },
  };
  const app = {
    async info() { return { version: '1.0.0', electron: 'demo', chrome: 'demo', platform: 'win32', mock: true, scenario, packaged: false, userData: 'C:\\Users\\demo\\AppData\\Roaming\\4ONE Launcher' }; },
    async openExternal() { bus.emit('toast', { kind: 'info', text: 'Откроется в браузере' }); return ok(); },
    async openPath() { bus.emit('toast', { kind: 'info', text: 'Откроется папка' }); return ok(); },
    async copyDiagnostics() { return ok({ text: '4ONE Launcher 1.0.0 (демо)' }); },
  };
  const win = { minimize() {}, toggleMaximize() { return false; }, close() {} };
  const updater = {
    async check() { return ok({ state: 'none' }); }, async download() { return ok(); }, async install() { return ok(); },
  };

  return { bus, services: { app, win, auth, data, game, codes, account, settings: settingsSvc, updater, log: { error() {}, warn() {}, info() {} } }, PROFILE, SERVERS, NEWS };
}

module.exports = { createMock, createBus };
