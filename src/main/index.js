'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, Tray, Menu, nativeImage, clipboard, session } = require('electron');

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

let win = null; let tray = null; let quitting = false; let pendingLink = null; let authHandler = null;
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

function showWindow() { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
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
  win.once('ready-to-show', () => { win.show(); });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('close', (e) => {
    if (quitting) return;
    if (settings.get().minimizeToTray && tray) { e.preventDefault(); win.hide(); }
  });
  win.webContents.on('did-finish-load', () => { if (pendingLink && pendingLink.type !== 'auth-callback') { const l = pendingLink; pendingLink = null; bus.emit('deeplink', l); } });
  win.loadFile(RENDERER);
  if (config.devtools) win.webContents.openDevTools({ mode: 'detach' });
}

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
    async openPath(kind) {
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
    return Object.assign({}, m.services, { win: realWin, app: Object.assign({}, m.services.app, { openExternal: appSvc.openExternal, openPath: appSvc.openPath, copyDiagnostics: appSvc.copyDiagnostics, info: appSvc.info }), log, settings });
  }

  const { createCoreApi } = require('./api/core');
  const { createBackend } = require('./api/backend');
  const { createOAuthClient } = require('./api/oauth');
  const { createVault, createAuth } = require('./session');
  const { createData, createCodes, createAccount } = require('./data');
  const { createInstaller } = require('./client/installer');
  const { createRunner } = require('./runner');
  const { createGame } = require('./game');
  const { createUpdater } = require('./updater');

  let authRef = null; // токен берётся у сессии при каждом запросе
  const backend = createBackend(createCoreApi({ log, getToken: () => (authRef ? authRef.freshToken() : null) }), log);
  const vault = createVault(userData, safeStorage);
  const oauth = createOAuthClient({ log });
  const auth = createAuth({
    oauth, backend, vault, bus, log, openAuth: appSvc.openAuth, loginTimeoutMs: config.core.loginTimeoutMs,
    deviceName: `${require('os').hostname()} · ${process.platform === 'win32' ? 'Windows' : process.platform}`,
  });
  authRef = auth;
  authHandler = (link) => { auth.handleCallback(link).catch((e) => log.error('auth', e.stack || e)); };
  const data = createData({ backend, auth, settings, log });
  const codes = createCodes({ backend, auth, log });
  const account = createAccount({ backend, auth });
  const installer = createInstaller({ log, resourcesDir: process.resourcesPath });
  const runner = createRunner({ shell, log });
  game = createGame({ settings, data, auth, installer, runner, bus, log, dialog: { pickFolder: pick } });
  const updater = createUpdater({ bus, log, app, settings });
  return { app: appSvc, win: realWin, auth, data, game, codes, account, settings, updater, log };
}

// ---------- запуск ----------
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  const settings = createSettings(userData, {
    onChange: (cur, prev) => { if (cur.lang !== prev.lang && tray) createTray(cur.lang); if (cur.autostart !== prev.autostart && app.isPackaged) app.setLoginItemSettings({ openAtLogin: cur.autostart }); },
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
  bus.on('minimize-to-tray', () => { if (win) win.hide(); });

  createWindow(settings);
  if (settings.get().minimizeToTray) createTray(settings.get().lang);
  const first = findDeepLink(process.argv); if (first) pendingLink = parseDeepLink(first);
  if (pendingLink && pendingLink.type === 'auth-callback' && authHandler) { const l = pendingLink; pendingLink = null; authHandler(l); }

  // последовательность запуска: сессия -> данные -> игра -> обновления
  const boot = async () => {
    const st = config.mock ? services.auth.state() : await services.auth.restore();
    if (st.authed) {
      const r = await services.data.bootstrap(true);
      bus.emit('net:state', { online: r.ok || (r.code !== 'network_error' && r.code !== 'timeout') });
    }
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
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && quitting) app.quit(); });
