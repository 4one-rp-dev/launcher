'use strict';
const config = require('./config');
const { ok, fail } = require('../core/contract');

/**
 * Автообновление самого лаунчера (electron-updater, релизы GitHub 4one-rp-dev/launcher, теги v*).
 * Включено «Обновлять автоматически»: новая версия качается в фоне сама и ставится при закрытии лаунчера
 * (или сразу — кнопкой «Перезапустить» в баннере). Проверка при старте и каждые 30 минут. Выключено — только сообщаем.
 */
function createUpdater(deps) {
  const { bus, log, app, settings } = deps;
  const st = { state: 'idle', version: '', percent: 0, error: '' };
  let au = null; let timer = null;

  function push(patch) { Object.assign(st, patch); bus.emit('update:state', Object.assign({}, st)); }

  function lib() {
    if (au) return au;
    if (!app.isPackaged && process.env.L4_UPDATER_DEV !== '1') return null;  // в разработке не проверяем
    try { au = require('electron-updater').autoUpdater; } catch (e) { log.warn('updater', e.message); return null; }
    au.setFeedURL(Object.assign({ provider: 'github' }, config.updates.github));
    au.autoDownload = !!settings.get().autoUpdates; au.autoInstallOnAppQuit = true; au.logger = null;
    au.allowPrerelease = false; // client-* — prerelease с комплектом клиента, не обновление лаунчера
    au.on('checking-for-update', () => push({ state: 'checking' }));
    au.on('update-available', (i) => push({ state: 'available', version: i.version, error: '' }));
    au.on('update-not-available', () => push({ state: 'none' }));
    au.on('download-progress', (p) => push({ state: 'downloading', percent: Math.round(p.percent) }));
    au.on('update-downloaded', (i) => { push({ state: 'ready', version: i.version, percent: 100 }); log.info('updater', `обновление ${i.version} скачано, установится при закрытии`); });
    au.on('error', (e) => { log.warn('updater', e && e.message); push({ state: 'error', error: String(e && e.message || e) }); });
    return au;
  }

  return {
    state: () => Object.assign({}, st),
    async check() {
      const u = lib(); if (!u) { push({ state: 'none' }); return ok(st); }
      try { await u.checkForUpdates(); } catch (e) { push({ state: 'error', error: e.message }); return fail('network_error'); }
      return ok(st);
    },
    async download() { const u = lib(); if (!u) return fail('unknown'); try { await u.downloadUpdate(); return ok(); } catch (_) { return fail('download_failed'); } },
    async install() { const u = lib(); if (!u) return fail('unknown'); u.quitAndInstall(false, true); return ok(); },
    autoCheck() {
      const tick = () => { const u = lib(); if (u) u.autoDownload = !!settings.get().autoUpdates; if (['idle', 'none', 'error', 'available'].includes(st.state)) this.check(); };
      tick();
      if (!timer) { timer = setInterval(tick, 30 * 60 * 1000); if (timer.unref) timer.unref(); } // выкатили правку — подхватим без перезапуска лаунчера
    },
  };
}

module.exports = { createUpdater };
