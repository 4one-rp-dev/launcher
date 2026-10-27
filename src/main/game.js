'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { fail, ok } = require('../core/contract');
const { detectGta, inspectDir } = require('./gta/detect');
const { grantModify } = require('./client/elevate');

/**
 * Игровой контроллер: единственный источник правды о том, что показывать на кнопке «Играть».
 * phase: init | no-gta | unsupported | not-installed | needs-update | ready | checking | installing |
 *        verifying | launching | ingame | error
 */
function createGame(deps) {
  const { settings, data, auth, installer, runner, bus, log, dialog } = deps;
  const detectFn = deps.detect || detectGta;

  const st = {
    phase: 'init', gta: null, client: { installed: false, version: '', remoteVersion: '', needsUpdate: false, updateBytes: 0 },
    progress: null, error: null, running: false,
  };
  let abort = null; let busy = false; let sessionStart = 0;

  function publish() { bus.emit('game:state', getState()); }
  function getState() { return JSON.parse(JSON.stringify(st)); }
  function setPhase(p, extra) { st.phase = p; if (extra) Object.assign(st, extra); publish(); }
  function setError(code, detail) {
    st.error = { code, message: require('../core/contract').message(code), detail: detail || '' };
    st.phase = 'error'; st.progress = null; publish();
  }

  async function refresh() {
    const manual = settings.get().gamePath;
    const d = await detectFn({ manualPath: manual });
    st.gta = d.best ? { dir: d.best.dir, source: d.best.source, version: d.best.version, exe: d.best.exe, isSupported: d.best.isSupported, hasLegacy: d.best.hasLegacy, hasEnhanced: d.best.hasEnhanced } : null;
    st.error = null;
    if (!d.best) { st.client.installed = false; return setPhase('no-gta'); }
    if (d.best.enhancedOnly) return setPhase('unsupported', { error: { code: 'gta_unsupported', message: require('../core/contract').message('gta_unsupported') } });
    if (d.best.versionMismatch) return setPhase('unsupported', { error: { code: 'gta_wrong_version', message: require('../core/contract').message('gta_wrong_version') } });

    const s = installer.status(d.best.dir);
    st.client.installed = s.installed; st.client.version = s.version;
    st.client.needsUpdate = false; st.client.updateBytes = 0; st.client.remoteVersion = '';
    if (!s.installed) return setPhase('not-installed');
    // сравнение с удалённым манифестом (маленький запрос); без сети считаем клиент актуальным
    try {
      const info = await installer.remoteInfo(config.cdn.clientBase, { allowNames: [config.game.asi] });
      st.client.remoteVersion = info.version;
      if (info.digest && s.digest && info.digest !== s.digest) { st.client.needsUpdate = true; st.client.updateBytes = info.totalBytes; return setPhase('needs-update'); }
    } catch (e) { log.warn('game', `проверка клиента: ${e.code || e.message}`); }
    return setPhase('ready');
  }

  function progress(stage) {
    let last = 0;
    return (p) => {
      const now = Date.now(); if (now - last < 120) return; last = now;
      const percent = p.total ? Math.min(100, Math.floor((p.done / p.total) * 100)) : 0;
      const eta = p.speed > 0 && p.total ? Math.max(0, Math.round((p.total - p.done) / p.speed)) : 0;
      st.progress = { stage, file: p.file || '', done: p.done, total: p.total, speed: Math.round(p.speed || 0), eta, percent };
      publish();
    };
  }

  /** Установка/обновление/проверка клиента. verify=true — пересчитать хэши. */
  async function runSync(verify) {
    const dir = st.gta.dir; const sig = abort.signal;
    setPhase(verify ? 'verifying' : 'installing', { error: null, progress: { stage: 'scripthook', file: '', done: 0, total: 0, speed: 0, eta: 0, percent: 0 } });
    if (!installer.canWrite(dir)) {
      const granted = await grantModify(dir);
      if (!granted || !installer.canWrite(dir)) throw Object.assign(new Error('no write'), { code: 'no_write_access' });
    }
    await installer.installScriptHook(dir, { signal: sig, onProgress: progress('scripthook') });
    await installer.installClientFiles(dir, { verify, signal: sig, onProgress: progress('client') });
    installer.patchCommandLine(dir, { noBattleye: settings.get().noBattleye });
  }

  async function guarded(fn) {
    if (busy) return fail('busy');
    busy = true; abort = new AbortController();
    try { return await fn(); }
    catch (e) {
      const code = e && e.code && typeof e.code === 'string' && require('../core/contract').ERRORS[e.code] ? e.code : (e && e.code === 'ENOSPC' ? 'disk_full' : (e && (e.code === 'EPERM' || e.code === 'EACCES') ? 'no_write_access' : 'unknown'));
      if (code === 'cancelled') { st.progress = null; await refresh(); return fail('cancelled'); }
      log.error('game', `${code}: ${e && e.message}`);
      setError(code, e && e.message);
      return fail(code);
    } finally { busy = false; abort = null; }
  }

  async function watch() {
    st.running = true; sessionStart = Date.now(); setPhase('ingame');
    await runner.waitExit(config.game.exe);
    const minutes = Math.round((Date.now() - sessionStart) / 60000);
    st.running = false;
    await settings.set({ playMinutes: (settings.get().playMinutes || 0) + minutes });
    bus.emit('toast', { kind: 'info', text: 'GTA V закрыта' });
    await refresh();
    bus.emit('game:exited', {});
  }

  return {
    getState,
    init: refresh,
    refresh,
    async detect() { await refresh(); return ok(getState()); },

    async browse() {
      const p = await dialog.pickFolder();
      if (!p) return ok(getState());
      return this.setPath(p);
    },
    async setPath(p) {
      const r = inspectDir(p, 'manual');
      if (!r) return fail('gta_not_found');
      await settings.set({ gamePath: p });
      await refresh();
      return ok(getState());
    },

    install: () => guarded(async () => {
      if (!st.gta) return fail('gta_not_found');
      await runSync(false); await refresh(); bus.emit('toast', { kind: 'ok', text: 'Клиент установлен' }); return ok(getState());
    }),
    verify: () => guarded(async () => {
      if (!st.gta) return fail('gta_not_found');
      await runSync(true); await refresh(); bus.emit('toast', { kind: 'ok', text: 'Файлы проверены' }); return ok(getState());
    }),
    cancel: async () => { if (abort) abort.abort(); return ok(); },
    uninstall: () => guarded(async () => {
      if (!st.gta) return fail('gta_not_found');
      if (await runner.isRunning(config.game.exe)) return fail('game_running');
      installer.uninstall(st.gta.dir); await refresh(); return ok(getState());
    }),

    /** Играть: при необходимости ставит/обновляет клиент, затем запускает игру и подключает к выбранному серверу */
    play: () => guarded(async () => {
      if (!auth.state().authed) return fail('invalid_session');
      if (!st.gta) return fail('gta_not_found');
      if (st.phase === 'unsupported') return fail(st.error && st.error.code || 'gta_unsupported');
      const server = data.selected();
      if (!server || !server.address) return fail('server_offline');
      if (await runner.isRunning(config.game.exe)) return fail('game_running');

      if (st.phase !== 'ready') { await runSync(false); }
      setPhase('launching', { progress: null, error: null });

      const profile = auth.state().profile || {};
      installer.writeConnect(st.gta.dir, { address: server.address, name: profile.gameName || profile.nickname || profile.username || 'Player' });
      installer.patchCommandLine(st.gta.dir, { noBattleye: settings.get().noBattleye });
      const args = settings.get().noBattleye ? ['-nobattleye'] : [];
      await runner.launch(st.gta, args);
      const appeared = await runner.waitAppear(config.game.exe, 120000, abort.signal);
      if (!appeared) { throw Object.assign(new Error('GTA5.exe не появился'), { code: 'launch_failed' }); }

      const s = settings.get();
      if (s.closeAfterStart) bus.emit('quit-after-start', {});
      else if (s.minimizeToTray) bus.emit('minimize-to-tray', {});
      watch().catch((e) => log.error('game', `watch: ${e.message}`));
      return ok(getState());
    }),
  };
}

module.exports = { createGame };
