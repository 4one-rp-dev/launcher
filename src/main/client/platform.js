'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');

/**
 * Драйвер клиента игры. Установку клиента, ScriptHookV, режим без BattlEye, обновление клиента и модов сервера,
 * вход на сервер и запуск GTA V выполняет установщик платформы (FloVMP.exe) — лаунчер вызывает его тихо
 * (`--silent`) и рисует ход работы по %LOCALAPPDATA%\FloVMP\play-status.json (контракт: docs/customer-launcher-integration.md
 * платформы). Игрок видит только интерфейс 4ONE: имена платформы в текстах заменяет brand().
 */

class PlatformError extends Error {
  constructor(code, detail, flv) { super(detail || code); this.code = code; this.flv = flv || ''; this.detail = detail || ''; }
}

/** Код выхода установщика -> код ошибки лаунчера (см. таблицу кодов выхода в контракте платформы). */
const EXIT = {
  1: 'client_install_failed', 2: 'gta_not_found', 3: 'gta_wrong_version', 4: 'scripthook_failed', 5: 'client_corrupted',
  6: 'game_running', 7: 'no_write_access', 8: 'disk_full', 9: 'download_failed', 10: 'client_signature', 11: 'launch_failed',
};
/** Коды каталога ошибок, для которых код выхода неоднозначен. */
const FLV = { 'FLV-6009': 'client_no_connection', 'FLV-6001': 'gta_not_found', 'FLV-3002': 'gta_wrong_version', 'FLV-4004': 'game_running' };

/** Игроку не показываем имя платформы: заменяем на «4ONE». */
function brand(s) {
  return String(s == null ? '' : s).replace(/flovmp:\/\//gi, '4one://').replace(/FloVMP\.exe/gi, '4ONE').replace(/FloV\s?:?\s?MP/gi, '4ONE');
}

function createPlatform(deps) {
  const { log } = deps;
  const env = deps.env || process.env;
  const platformName = deps.platform || process.platform;
  const spawnFn = deps.spawn || spawn;
  const execFn = deps.execFile || execFile;
  const dataDir = deps.dataDir || path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'FloVMP');
  const statusFile = path.join(dataDir, 'play-status.json');
  const pollMs = deps.pollMs || 400;

  /** Путь установленного установщика (HKCU\Software\FloVMP\InstallDir), если клиент уже стоял на ПК. */
  function installedExe() {
    return new Promise((resolve) => {
      if (platformName !== 'win32' && !deps.execFile) return resolve(null);
      execFn('reg', ['query', 'HKCU\\Software\\FloVMP', '/v', 'InstallDir'], { windowsHide: true, timeout: 5000 }, (err, out) => {
        if (err) return resolve(null);
        const m = /InstallDir\s+REG_SZ\s+(.+)/i.exec(String(out)); if (!m) return resolve(null);
        const exe = path.join(m[1].trim(), 'FloVMP.exe');
        resolve(fs.existsSync(exe) ? exe : null);
      });
    });
  }

  /** Состояние: `FloVMP.exe status` (ничего не меняет, окон нет). */
  function status(exe) {
    return new Promise((resolve, reject) => {
      execFn(exe, ['status'], { windowsHide: true, timeout: 45000, cwd: path.dirname(exe), maxBuffer: 1 << 20 }, (err, out) => {
        if (err && !out) return reject(new PlatformError('client_install_failed', err.message));
        try { resolve(JSON.parse(String(out))); } catch (e) { reject(new PlatformError('client_install_failed', 'status: ' + e.message)); }
      });
    });
  }

  function readStatusFile(sinceSec) {
    try {
      const j = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
      if (j && typeof j.time === 'number' && j.time + 2 < sinceSec) return null; // файл от прошлого запуска
      return j;
    } catch (_) { return null; }
  }

  /** Тексты каталога ошибок установщика (по коду FLV-xxxx) без имени платформы. */
  function describe(exe, code) {
    if (!code) return null;
    for (const base of [path.dirname(exe || ''), dataDir]) {
      try {
        const cat = JSON.parse(fs.readFileSync(path.join(base, 'error-catalog.json'), 'utf8'));
        const e = (cat.errors || []).find((x) => x.code === code);
        if (e) return { title: brand(e.title), text: brand(e.text), steps: (e.steps || []).map(brand) };
      } catch (_) { /* нет каталога */ }
    }
    return null;
  }

  /**
   * Запуск команды установщика. opts: { gtaDir, onProgress(status), signal }.
   * Возвращает { exitCode, status }; при ненулевом коде выхода бросает PlatformError.
   */
  function run(exe, args, opts) {
    const o = opts || {};
    return new Promise((resolve, reject) => {
      const childEnv = Object.assign({}, env, { FLOVMP_NONINTERACTIVE: '1' });
      if (o.gtaDir) childEnv.FLOVMP_GTA_PATH = o.gtaDir;
      const startSec = Math.floor(Date.now() / 1000);
      let child;
      try { child = spawnFn(exe, args.concat('--silent'), { cwd: path.dirname(exe), env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (e) { return reject(new PlatformError('client_install_failed', e.message)); }
      let tail = ''; let last = null; let finished = false;
      const keep = (d) => { tail = (tail + String(d)).slice(-4000); };
      child.stdout && child.stdout.on('data', keep); child.stderr && child.stderr.on('data', keep);
      const tick = () => {
        const s = readStatusFile(startSec); if (!s) return;
        last = s; if (o.onProgress) { try { o.onProgress(s); } catch (_) { /* не роняем драйвер из-за интерфейса */ } }
      };
      const timer = setInterval(tick, pollMs);
      const onAbort = () => { try { if (platformName === 'win32' && child.pid) execFn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {}); else child.kill(); } catch (_) { /* ignore */ } };
      if (o.signal) { if (o.signal.aborted) onAbort(); else o.signal.addEventListener('abort', onAbort, { once: true }); }
      const end = (fn) => { if (finished) return; finished = true; clearInterval(timer); if (o.signal) o.signal.removeEventListener('abort', onAbort); fn(); };
      child.once('error', (e) => end(() => reject(new PlatformError('client_install_failed', e.message))));
      child.once('close', (code) => end(() => {
        tick();
        if (o.signal && o.signal.aborted) return reject(new PlatformError('cancelled'));
        const st = last || {};
        if (code === 0 || st.state === 'cancelled') return resolve({ exitCode: code, status: st });
        const flv = st.code || '';
        const mapped = FLV[flv] || EXIT[code] || 'client_install_failed';
        log && log.warn('platform', `${args[0]} → код ${code} ${flv} ${st.detail || ''}`);
        reject(new PlatformError(mapped, brand(st.detail || tail.trim().split(/\r?\n/).pop() || ''), flv));
      }));
    });
  }

  const install = (exe, o) => run(exe, ['install'].concat(o && o.gtaDir ? ['--gta-dir', o.gtaDir] : []), o);
  const connect = (exe, address, name, o) => run(exe, ['connect', address].concat(name ? ['--name', name] : []), o);
  const repair = (exe, o) => run(exe, ['repair'], o);
  const verify = (exe, o) => run(exe, ['verify'], o);
  const uninstall = (exe, o) => run(exe, ['uninstall'], o);

  return { installedExe, status, run, install, connect, repair, verify, uninstall, describe, statusFile };
}

/** Состояние платформы (stage из play-status.json) -> этап лаунчера для подписи на кнопке. */
const STAGE = { check: 'check', install: 'client', update: 'client', mods: 'mods', launch: 'launch', switch: 'launch' };
function stageOf(s) { return STAGE[s] || 'client'; }

module.exports = { createPlatform, PlatformError, brand, stageOf, EXIT, FLV };
