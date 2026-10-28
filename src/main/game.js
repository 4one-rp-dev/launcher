'use strict';
const config = require('./config');
const { fail, ok, ERRORS, message } = require('../core/contract');
const { detectGta, inspectDir } = require('./gta/detect');
const { stageOf } = require('./client/platform');

/**
 * Игровой контроллер: единственный источник правды о том, что показывать на кнопке «Играть».
 * phase: init | no-gta | unsupported | not-installed | needs-update | ready | checking | installing |
 *        verifying | launching | ingame | error
 *
 * Установку, обновление клиента, моды сервера и вход ведёт платформа (client/platform.js, тихий установщик);
 * комплект с установщиком лаунчер скачивает сам (client/kit.js). Игрок ничего не ставит руками.
 */
function createGame(deps) {
  const { settings, data, auth, platform, kit, runner, bus, log, dialog } = deps;
  const detectFn = deps.detect || detectGta;

  const st = {
    phase: 'init', gta: null, client: { installed: false, version: '', remoteVersion: '', needsUpdate: false, updateBytes: 0 },
    progress: null, error: null, running: false,
  };
  let abort = null; let busy = false; let sessionStart = 0; let lastExe = null;

  function publish() { bus.emit('game:state', getState()); }
  function getState() { return JSON.parse(JSON.stringify(st)); }
  function setPhase(p, extra) { st.phase = p; if (extra) Object.assign(st, extra); publish(); }
  function setError(code, detail) {
    st.error = { code, message: message(code), detail: detail || '' };
    st.phase = 'error'; st.progress = null; publish();
  }

  /** Установщик платформы: уже стоящий на ПК или из комплекта лаунчера. */
  async function findExe() {
    const inst = await platform.installedExe();
    if (inst) return (lastExe = inst);
    const k = kit.current();
    return (lastExe = k ? k.exe : null);
  }

  async function refresh() {
    const manual = settings.get().gamePath;
    const d = await detectFn({ manualPath: manual });
    st.gta = d.best ? { dir: d.best.dir, source: d.best.source, version: d.best.version, exe: d.best.exe, isSupported: d.best.isSupported, hasLegacy: d.best.hasLegacy, hasEnhanced: d.best.hasEnhanced } : null;
    st.error = null;
    if (!d.best) { st.client.installed = false; return setPhase('no-gta'); }
    if (d.best.enhancedOnly) return setPhase('unsupported', { error: { code: 'gta_unsupported', message: message('gta_unsupported') } });
    if (d.best.versionMismatch) return setPhase('unsupported', { error: { code: 'gta_wrong_version', message: message('gta_wrong_version') } });

    st.client.needsUpdate = false; st.client.updateBytes = 0; st.client.remoteVersion = '';
    st.client.installed = false; st.client.version = '';
    const exe = await findExe();
    if (exe) {
      try {
        const s = await platform.status(exe);
        st.client.installed = !!s.installed; st.client.version = s.clientVersion || '';
      } catch (e) { log.warn('game', `состояние клиента: ${e.message}`); }
    }
    // обновление клиента выполняет сам вход (перед запуском игры), отдельного «needs-update» нет
    return setPhase(st.client.installed ? 'ready' : 'not-installed');
  }

  /** Ход работы -> progress для интерфейса (скорость считаем сами: платформа отдаёт только байты). */
  function progressSink() {
    let lastT = 0; let lastDone = 0; let speed = 0;
    return (p) => {
      const now = Date.now();
      const done = Number(p.done) || 0; const total = Number(p.total) || 0;
      if (p.speed != null) speed = p.speed;
      else if (lastT && done >= lastDone && now > lastT) { const inst = ((done - lastDone) / (now - lastT)) * 1000; speed = speed ? speed * 0.7 + inst * 0.3 : inst; }
      lastT = now; lastDone = done;
      const percent = p.percent != null ? Math.min(100, Math.max(0, Math.floor(p.percent))) : (total ? Math.min(100, Math.floor((done / total) * 100)) : 0);
      const eta = speed > 0 && total ? Math.max(0, Math.round((total - done) / speed)) : 0;
      st.progress = { stage: p.stage || 'client', file: p.file || p.detail || '', done, total, speed: Math.round(speed), eta, percent };
      publish();
    };
  }
  const fromPlatform = (sink) => (s) => sink({ stage: stageOf(s.stage), detail: s.detail, done: s.done, total: s.total, percent: s.percent });

  /** Клиент установлен? Если нет — получить комплект и поставить. Возвращает путь к установщику платформы. */
  async function ensureClient(sig, sink) {
    let exe = await findExe();
    let ready = false;
    if (exe) { try { ready = !!(await platform.status(exe)).installed; } catch (_) { ready = false; } }
    if (ready) return exe;
    if (!exe || kit.needed(data.clientInfo(), await platform.installedExe())) {
      const k = await kit.ensure(data.clientInfo(), { signal: sig, onProgress: sink });
      exe = k.exe; lastExe = exe;
    }
    await platform.install(exe, { gtaDir: st.gta.dir, signal: sig, onProgress: fromPlatform(sink) });
    return (await platform.installedExe()) || exe;
  }

  async function guarded(fn) {
    if (busy) return fail('busy');
    busy = true; abort = new AbortController();
    try { return await fn(); }
    catch (e) {
      const code = e && e.code && typeof e.code === 'string' && ERRORS[e.code] ? e.code : (e && e.code === 'ENOSPC' ? 'disk_full' : (e && (e.code === 'EPERM' || e.code === 'EACCES') ? 'no_write_access' : 'unknown'));
      if (code === 'cancelled') { st.progress = null; await refresh(); return fail('cancelled'); }
      log.error('game', `${code}${e && e.flv ? ' ' + e.flv : ''}: ${e && e.message}`);
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

  const progress0 = (stage) => ({ stage, file: '', done: 0, total: 0, speed: 0, eta: 0, percent: 0 });

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
      setPhase('installing', { error: null, progress: progress0('kit') });
      await ensureClient(abort.signal, progressSink());
      await refresh(); bus.emit('toast', { kind: 'ok', text: 'Клиент установлен' }); return ok(getState());
    }),
    /** «Проверить файлы»: платформа сверяет клиент и чинит его; без клиента — обычная установка. */
    verify: () => guarded(async () => {
      if (!st.gta) return fail('gta_not_found');
      setPhase('verifying', { error: null, progress: progress0('check') });
      const sink = progressSink();
      const exe = await findExe();
      if (exe && st.client.installed) await platform.repair(exe, { gtaDir: st.gta.dir, signal: abort.signal, onProgress: fromPlatform(sink) });
      else await ensureClient(abort.signal, sink);
      await refresh(); bus.emit('toast', { kind: 'ok', text: 'Файлы проверены' }); return ok(getState());
    }),
    cancel: async () => { if (abort) abort.abort(); return ok(); },
    uninstall: () => guarded(async () => {
      if (!st.gta) return fail('gta_not_found');
      if (await runner.isRunning(config.game.exe)) return fail('game_running');
      const exe = await findExe();
      if (exe) await platform.uninstall(exe, { gtaDir: st.gta.dir, signal: abort.signal });
      await refresh(); return ok(getState());
    }),

    /** Играть: при необходимости ставит клиент, затем платформа обновляет его и моды, запускает игру и подключает к серверу */
    play: () => guarded(async () => {
      if (!auth.state().authed) return fail('invalid_session');
      if (!st.gta) return fail('gta_not_found');
      if (st.phase === 'unsupported') return fail(st.error && st.error.code || 'gta_unsupported');
      const server = data.selected();
      if (!server || !server.address) return fail('server_offline');
      if (await runner.isRunning(config.game.exe)) return fail('game_running');

      const sink = progressSink();
      let exe;
      if (st.phase !== 'ready') { setPhase('installing', { error: null, progress: progress0('kit') }); exe = await ensureClient(abort.signal, sink); }
      else exe = (await findExe());
      if (!exe) throw Object.assign(new Error('нет установщика клиента'), { code: 'client_kit_missing' });
      setPhase('launching', { progress: progress0('check'), error: null });

      const profile = auth.state().profile || {};
      const nick = profile.gameName || profile.nickname || profile.username || 'Player';
      await platform.connect(exe, server.address, nick, { gtaDir: st.gta.dir, signal: abort.signal, onProgress: fromPlatform(sink) });
      const appeared = await runner.waitAppear(config.game.exe, 20000, abort.signal);
      if (!appeared) throw Object.assign(new Error('GTA5.exe не появился'), { code: 'launch_failed' });
      st.progress = null;

      const s = settings.get();
      if (s.closeAfterStart) bus.emit('quit-after-start', {});
      else if (s.minimizeToTray) bus.emit('minimize-to-tray', {});
      watch().catch((e) => log.error('game', `watch: ${e.message}`));
      return ok(getState());
    }),
  };
}

module.exports = { createGame };
