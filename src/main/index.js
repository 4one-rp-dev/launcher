'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, Tray, Menu, nativeImage, clipboard, session, Notification } = require('electron');

const config = require('./config');
const { CHANNELS, ok, fail } = require('../core/contract');
const { createHandlers } = require('../core/handlers');
const { createLogger } = require('./logger');
const { createSettings } = require('./settings');
const { mt } = require('./i18n');
const security = require('./security');
const { parseDeepLink, findDeepLink } = require('./protocol');

// ---------- один экземпляр + deep link ----------
if (!app.requestSingleInstanceLock()) { app.quit(); return; }

if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient(config.protocol, process.execPath, [path.resolve(process.argv[1])]);
else app.setAsDefaultProtocolClient(config.protocol);

let win = null; let tray = null; let quitting = false; let pendingLink = null; let authHandler = null; let kitRef = null;
// автозапуск с Windows с флагом --hidden: окно не показываем, лаунчер живёт в трее
const startHidden = process.argv.includes('--hidden');
const RENDERER = path.join(__dirname, '..', 'renderer', 'index.html');
const RENDERER_URL_PREFIX = require('url').pathToFileURL(path.join(__dirname, '..', 'renderer')).href;

const userData = app.getPath('userData');
const log = createLogger(path.join(userData, 'logs'));
log.info('app', `старт ${app.getVersion()} mock=${config.mock} pkg=${app.isPackaged}`);

// ---------- шина событий main -> renderer ----------
const subs = {};
const bus = {
  emit(ev, payload) {
    (subs[ev] || []).forEach((f) => { try { f(payload); } catch (_) { /* ignore */ } });
    if (win && !win.isDestroyed() && ['auth:changed', 'game:state', 'update:state', 'net:state', 'deeplink', 'toast'].includes(ev)) win.webContents.send(ev, payload);
  },
  on(ev, f) { (subs[ev] = subs[ev] || []).push(f); },
};

function showWindow() { if (!win || win.isDestroyed()) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
function dispatchDeepLink(raw) {
  const link = typeof raw === 'string' ? parseDeepLink(raw) : raw;
  if (!link) return log.warn('deeplink', 'отклонена ссылка');
  showWindow();
  // возврат из браузера после входа обрабатывает main: renderer о коде и state не узнаёт
  if (link.type === 'auth-callback') { if (authHandler) authHandler(link); else pendingLink = link; return; }
  if (!win || win.webContents.isLoading()) { pendingLink = link; return; }
  bus.emit('deeplink', link);
}
app.on('second-instance', (_e, argv) => { const l = findDeepLink(argv); if (l) dispatchDeepLink(l); else showWindow(); });
app.on('open-url', (e, url) => { e.preventDefault(); dispatchDeepLink(url); });

// ---------- окно ----------
function createWindow(settings) {
  win = new BrowserWindow({
    width: 1280, height: 760, minWidth: 640, minHeight: 480,
    frame: false, show: false, backgroundColor: '#100e12', title: config.appName, autoHideMenuBar: true,
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
      spellcheck: false, devTools: !app.isPackaged || config.devtools,
    },
  });
  win.setMenu(null);
  win.once('ready-to-show', () => { if (startHidden && tray) return; win.show(); });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('close', (e) => {
    if (quitting) return;
    if (settings.get().minimizeToTray && tray) { e.preventDefault(); win.hide(); return; }
    quitting = true; // без трея закрытие окна = выход: иначе процесс остаётся и держит блокировку одного экземпляра
  });
  win.webContents.on('did-finish-load', () => { if (pendingLink && pendingLink.type !== 'auth-callback') { const l = pendingLink; pendingLink = null; bus.emit('deeplink', l); } });
  win.loadFile(RENDERER);
  if (config.devtools) win.webContents.openDevTools({ mode: 'detach' });
}

function destroyTray() { if (tray) { try { tray.destroy(); } catch (_) { /* ignore */ } tray = null; } }
function createTray(lang) {
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'build', 'icon.png')).resize({ width: 18, height: 18 });
    if (!tray) { tray = new Tray(img); tray.setToolTip(config.appName); tray.on('click', showWindow); }
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: mt(lang, 'Открыть лаунчер'), click: showWindow },
      { type: 'separator' },
      { label: mt(lang, 'Выход'), click: () => { quitting = true; app.quit(); } },
    ]));
  } catch (e) { log.warn('tray', e.message); }
}

// ---------- настройки игры (F1 и settings.xml) ----------
function createPrefs({ runner, log }) {
  const { createPlayerCfg, DEFAULTS } = require('./player-cfg');
  const { createGtaSettings } = require('./gta-settings');
  const cfg = createPlayerCfg({ log });
  const gta = createGtaSettings({ documents: app.getPath('documents') });
  const GTA_KEYS = ['windowMode', 'vsync'];
  async function get(force) {
    const [devices, running] = await Promise.all([cfg.devices(force), runner.isRunning(config.game.exe)]);
    return ok({ cfg: cfg.read(), gta: gta.read(), devices, running, file: cfg.file });
  }
  return {
    get,
    async set(patch) {
      if (await runner.isRunning(config.game.exe)) return fail('game_running'); // игра перезапишет файл своими значениями
      const g = {}; const c = {};
      for (const [k, v] of Object.entries(patch)) { if (GTA_KEYS.includes(k)) g[k] = v; else if (k in DEFAULTS) c[k] = v; }
      try {
        if (Object.keys(c).length) cfg.write(c);
        if (Object.keys(g).length) { const st = gta.read(); if (!st.exists) return fail('gta_settings_missing'); gta.write(g); }
      } catch (e) { log.warn('prefs', e.message); return fail('no_write_access'); }
      return get(false);
    },
    async reset(group) {
      if (await runner.isRunning(config.game.exe)) return fail('game_running');
      try {
        if (group === 'all') { const p = {}; for (const k of Object.keys(DEFAULTS)) p[k] = DEFAULTS[k]; cfg.write(p); } else cfg.reset(group);
      } catch (e) { log.warn('prefs', e.message); return fail('no_write_access'); }
      return get(false);
    },
  };
}

// ---------- сервисы ----------
function buildServices(settings) {
  const realWin = {
    minimize: () => win && win.minimize(),
    toggleMaximize: () => { if (!win) return false; if (win.isMaximized()) win.unmaximize(); else win.maximize(); return win.isMaximized(); },
    close: () => win && win.close(),
  };
  const pick = async () => {
    const r = await dialog.showOpenDialog(win, { title: mt(settings.get().lang, 'Папка с GTA V'), properties: ['openDirectory'] });
    return r.canceled ? '' : r.filePaths[0];
  };
  let game; // для app.openPath

  const appSvc = {
    async info() {
      return { version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform,
        mock: config.mock, scenario: config.mockScenario, packaged: app.isPackaged, userData, canEncrypt: safeStorage.isEncryptionAvailable() };
    },
    async openExternal(key) {
      const url = security.resolveExternal(key);
      if (!url) return fail('bad_request');
      await shell.openExternal(url); return ok();
    },
    /** Страница входа Core API: только наш хост и путь /oauth/authorize (https; http — только localhost для разработки). */
    async openAuth(url) {
      try {
        const u = new URL(String(url)); const core = new URL(config.core.url);
        const local = ['127.0.0.1', 'localhost'].includes(core.hostname);
        if (u.origin !== core.origin || u.pathname !== '/oauth/authorize' || (u.protocol !== 'https:' && !local)) return fail('bad_request');
      } catch (_) { return fail('bad_request'); }
      await shell.openExternal(String(url)); return ok();
    },
    async copyText(text) { clipboard.writeText(String(text)); return ok(); },
    async cacheInfo() {
      if (!kitRef) return ok({ dir: '', bytes: 0 });
      return ok({ dir: kitRef.dir, bytes: kitRef.size() });
    },
    async clearCache() {
      if (!kitRef) return ok({ bytes: 0 });
      const g = game && game.getState();
      if (g && ['installing', 'verifying', 'launching'].includes(g.phase)) return fail('busy');
      try { kitRef.clear(); } catch (e) { log.warn('cache', e.message); return fail('no_write_access'); }
      log.info('cache', 'скачанный комплект клиента удалён');
      return ok({ bytes: kitRef.size() });
    },
    async openPath(kind) {
      if (kind === 'root') { const g = game && game.getState(); const d = g && g.layout && g.layout.root; if (!d) return fail('unknown'); fs.mkdirSync(d, { recursive: true }); const err = await shell.openPath(d); return err ? fail('unknown') : ok(); }
      if (kind === 'cache') { const d = kitRef && kitRef.dir; if (!d) return fail('unknown'); fs.mkdirSync(d, { recursive: true }); const err = await shell.openPath(d); return err ? fail('unknown') : ok(); }
      const p = kind === 'logs' ? log.dir : kind === 'game' ? (game && game.getState().gta && game.getState().gta.dir) : userData;
      if (!p) return fail('gta_not_found');
      const err = await shell.openPath(p); return err ? fail('unknown') : ok();
    },
    async copyDiagnostics() {
      const g = game ? game.getState() : {};
      let tail = ''; try { tail = fs.readFileSync(log.file, 'utf8').split('\n').slice(-40).join('\n'); } catch (_) { /* нет лога */ }
      const text = [`4ONE Launcher ${app.getVersion()} (${process.platform}, electron ${process.versions.electron})`,
        `GTA: ${g.gta ? `${g.gta.source} ${g.gta.version || '?'} ${g.gta.dir}` : 'не найдена'}`,
        `Фаза: ${g.phase}  Клиент: ${g.client ? g.client.version || '—' : '—'}`, '--- лог ---', tail].join('\n');
      clipboard.writeText(text); return ok();
    },
  };

  if (config.mock) {
    const { createMock } = require('../mock');
    const m = createMock({ bus, scenario: config.mockScenario, frozen: process.env.L4_MOCK_FROZEN === '1' });
    game = m.services.game;
    return Object.assign({}, m.services, { win: realWin, app: Object.assign({}, m.services.app, { openExternal: appSvc.openExternal, openPath: appSvc.openPath, copyDiagnostics: appSvc.copyDiagnostics, copyText: appSvc.copyText, info: appSvc.info }), log, settings });
  }

  const { createCoreApi } = require('./api/core');
  const { createBackend } = require('./api/backend');
  const { createOAuthClient } = require('./api/oauth');
  const { createVault, createAuth } = require('./session');
  const { createData, createCodes, createAccount } = require('./data');
  const { createPlatform } = require('./client/platform');
  const { createKit } = require('./client/kit');
  const { createRunner } = require('./runner');
  const { createGame } = require('./game');
  const { createUpdater } = require('./updater');

  let authRef = null; // токен берётся у сессии при каждом запросе
  const backend = createBackend(createCoreApi({ log, getToken: () => (authRef ? authRef.freshToken() : null) }), log);
  const vault = createVault(userData, safeStorage);
  const oauth = createOAuthClient({ log });
  const auth = createAuth({
    oauth, backend, vault, bus, log, openAuth: appSvc.openAuth, loginTimeoutMs: config.core.loginTimeoutMs,
    guestStore: { get: () => settings.get().guest, set: (v) => { settings.set({ guest: v }); } },
    deviceName: `${require('os').hostname()} · ${process.platform === 'win32' ? 'Windows' : process.platform}`,
  });
  authRef = auth;
  authHandler = (link) => { auth.handleCallback(link).catch((e) => log.error('auth', e.stack || e)); };
  const runner = createRunner({ shell, log });
  const data = createData({ backend, auth, settings, log, tcpPing: runner.tcpPing, onLinks: security.setLinks, linkKeys: security.configuredLinks });
  const codes = createCodes({ backend, auth, log });
  const account = createAccount({ backend, auth });
  const platform = createPlatform({ log });
  // раскладка как у RMRP: <корень>\Launcher, \Game, \Game\data; комплект клиента — в Game\.4one\kit
  const layout = require('./layout').resolveLayout({ packaged: app.isPackaged });
  log.info('layout', `корень ${layout.root}${layout.own ? '' : ' (лаунчер вне …\\Launcher)'}`);
  const kitDir = layout.kit;
  const kit = createKit({ dir: kitDir, log, devDir: process.env.L4_KIT_DIR || '', maxBps: () => (Number(settings.get().dlLimit) || 0) * 1024 * 1024 });
  kitRef = kit;
  let guestName = ''; try { guestName = require('os').userInfo().username; } catch (_) { /* нет имени */ }
  game = createGame({ settings, data, auth, platform, kit, runner, bus, log, guestName, layout, dialog: { pickFolder: pick } });
  const updater = createUpdater({ bus, log, app, settings });
  const prefs = createPrefs({ runner, log });
  return { app: appSvc, win: realWin, auth, data, game, codes, account, settings, updater, log, prefs };
}

// ---------- запуск ----------
app.whenReady().then(async () => {
  // разрешаем только микрофон и только окну лаунчера — для «Проверить микрофон» в настройках голоса
  const ourWin = (wc) => !!(win && !win.isDestroyed() && wc === win.webContents);
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => cb(perm === 'media' && ourWin(wc) && (details.mediaTypes || []).every((m) => m === 'audio')));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => perm === 'media' && ourWin(wc));
  const settings = createSettings(userData, {
    onChange: (cur, prev) => {
      if (cur.minimizeToTray !== prev.minimizeToTray) { if (cur.minimizeToTray) createTray(cur.lang); else destroyTray(); }
      else if (cur.lang !== prev.lang && tray) createTray(cur.lang);
      if ((cur.autostart !== prev.autostart || cur.startHidden !== prev.startHidden) && app.isPackaged) app.setLoginItemSettings({ openAtLogin: cur.autostart, args: cur.startHidden ? ['--hidden'] : [] });
    },
  });
  const services = buildServices(settings);
  const handlers = createHandlers(services);

  for (const ch of CHANNELS) {
    ipcMain.handle(ch, (event, ...args) => {
      if (!security.senderAllowed(event, win, RENDERER_URL_PREFIX)) { log.warn('ipc', `отклонён вызов ${ch}`); return fail('bad_request'); }
      return handlers[ch](...args);
    });
  }

  bus.on('quit-after-start', () => { quitting = true; app.quit(); });
  bus.on('minimize-to-tray', () => { if (!win || win.isDestroyed()) return; if (tray) win.hide(); else win.minimize(); });
  bus.on('minimize-window', () => { if (win && !win.isDestroyed()) win.minimize(); });

  if (settings.get().minimizeToTray || startHidden) createTray(settings.get().lang); // трей до окна: скрытый старт проверяет его в ready-to-show
  createWindow(settings);
  const first = findDeepLink(process.argv); if (first) pendingLink = parseDeepLink(first);
  if (pendingLink && pendingLink.type === 'auth-callback' && authHandler) { const l = pendingLink; pendingLink = null; authHandler(l); }

  // последовательность запуска: сессия -> данные -> игра -> обновления
  const boot = async () => {
    if (!config.mock) await services.auth.restore();
    // каталог публичный: нужен и гостю (сервер, клиент), и до входа
    const r = await services.data.bootstrap(true);
    bus.emit('net:state', { online: r.ok || (r.code !== 'network_error' && r.code !== 'timeout') });
    if (services.game.init) await services.game.init();
    if (!config.mock) services.updater.autoCheck();
  };
  win.webContents.once('did-finish-load', () => { boot().catch((e) => log.error('boot', e.stack || e)); });

  // периодически: повторная проверка при потере связи
  setInterval(async () => {
    if (config.mock) return;
    const s = services.auth.state();
    if (s.offline) { const r = await services.auth.revalidate(); if (!r.offline) bus.emit('net:state', { online: true }); }
  }, 30000);
  // роль и баланс перечитываем из БД: уровень админки могли изменить, пока лаунчер открыт
  setInterval(() => { if (!config.mock && services.auth.state().authed && !services.auth.state().offline) services.auth.revalidate().catch(() => {}); }, config.core.profileRefreshMs);

  // системные уведомления, пока окно свёрнуто или скрыто: новая новость, сервер снова доступен
  let seenNews = null; let lastStatus = {};
  const notify = (title, body) => {
    try {
      if (!Notification.isSupported()) return;
      const n = new Notification({ title, body, icon: path.join(__dirname, '..', '..', 'build', 'icon.png'), silent: false });
      n.on('click', showWindow); n.show();
    } catch (e) { log.warn('notify', e.message); }
  };
  const watchFeed = async () => {
    if (config.mock) return;
    const s = settings.get(); if (!s.notifyNews && !s.notifyServer) { seenNews = null; return; }
    const r = await services.data.bootstrap(false); if (!r.ok || r.data.stale) return;
    const away = !win || win.isDestroyed() || !win.isVisible() || win.isMinimized() || !win.isFocused();
    const ids = new Set((r.data.news || []).map((n) => n.id));
    if (seenNews && s.notifyNews && away) {
      const fresh = (r.data.news || []).filter((n) => !seenNews.has(n.id));
      if (fresh.length) notify(mt(s.lang, 'Новость 4ONE RP'), fresh[0].title || '');
    }
    seenNews = ids;
    for (const srv of r.data.servers || []) {
      const was = lastStatus[srv.id];
      if (was && was !== 'online' && srv.status === 'online' && s.notifyServer && away) notify(srv.name, mt(s.lang, 'Сервер снова доступен — можно заходить'));
      lastStatus[srv.id] = srv.status;
    }
  };
  setTimeout(() => { watchFeed().catch(() => {}); setInterval(() => watchFeed().catch(() => {}), 2 * 60 * 1000); }, 15000);
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
