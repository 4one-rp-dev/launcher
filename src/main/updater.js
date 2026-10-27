'use strict';
const config = require('./config');
const { ok, fail } = require('../core/contract');

/** Автообновление самого лаунчера (electron-updater, generic-лента в Supabase Storage). */
function createUpdater(deps) {
  const { bus, log, app, settings } = deps;
  const st = { state: 'idle', version: '', percent: 0, error: '' };
  let au = null;

  function push(patch) { Object.assign(st, patch); bus.emit('update:state', Object.assign({}, st)); }

  function lib() {
    if (au) return au;
    if (!app.isPackaged && process.env.L4_UPDATER_DEV !== '1') return null;  // в разработке не проверяем
    try { au = require('electron-updater').autoUpdater; } catch (e) { log.warn('updater', e.message); return null; }
    au.setFeedURL({ provider: 'generic', url: config.updates.feed });
    au.autoDownload = false; au.autoInstallOnAppQuit = true; au.logger = null;
    au.on('checking-for-update', () => push({ state: 'checking' }));
    au.on('update-available', (i) => push({ state: 'available', version: i.version, error: '' }));
    au.on('update-not-available', () => push({ state: 'none' }));
    au.on('download-progress', (p) => push({ state: 'downloading', percent: Math.round(p.percent) }));
    au.on('update-downloaded', (i) => push({ state: 'ready', version: i.version, percent: 100 }));
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
    autoCheck() { if (settings.get().autoUpdates) this.check(); },
  };
}

module.exports = { createUpdater };
