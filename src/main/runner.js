'use strict';
const { spawn, execFile } = require('child_process');
const net = require('net');
const config = require('./config');

/** Запуск GTA V и наблюдение за процессом (Windows). Для других ОС — заглушка, чтобы разработка шла в демо-режиме. */
function createRunner(deps) {
  const { shell, log } = deps;

  function isRunning(imageName) {
    return new Promise((resolve) => {
      if (process.platform !== 'win32') return resolve(false);
      execFile('tasklist', ['/FI', `IMAGENAME eq ${imageName}`, '/NH', '/FO', 'CSV'], { windowsHide: true, timeout: 6000 },
        (err, out) => resolve(!err && String(out).toLowerCase().includes(`"${imageName.toLowerCase()}"`)));
    });
  }

  /** Запуск по источнику установки: Steam/Epic через их URI, иначе напрямую GTA5.exe */
  async function launch(gta, args) {
    if (gta.source === 'steam') { await shell.openExternal(config.game.steamUri); return 'steam'; }
    if (gta.source === 'epic') { await shell.openExternal(config.game.epicUri); return 'epic'; }
    const child = spawn(gta.exe, args || [], { cwd: gta.dir, detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    return new Promise((resolve, reject) => { child.once('error', reject); child.once('spawn', () => resolve('direct')); });
  }

  /** Ждём появления процесса (до timeoutMs), затем возвращаем промис завершения */
  async function waitAppear(imageName, timeoutMs, signal) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (signal && signal.aborted) return false;
      if (await isRunning(imageName)) return true;
      await new Promise((r) => setTimeout(r, 1500));
    }
    return false;
  }
  async function waitExit(imageName, onTick) {
    while (await isRunning(imageName)) { if (onTick) onTick(); await new Promise((r) => setTimeout(r, 3000)); }
  }

  /** TCP-«пинг» до host:port (мс) или null */
  function tcpPing(address, timeoutMs) {
    return new Promise((resolve) => {
      const m = /^([^:\s]+):(\d{1,5})$/.exec(address || ''); if (!m) return resolve(null);
      const t0 = Date.now(); const s = net.connect({ host: m[1], port: Number(m[2]) });
      const done = (v) => { s.destroy(); resolve(v); };
      s.setTimeout(timeoutMs || 2500, () => done(null));
      s.once('connect', () => done(Date.now() - t0));
      s.once('error', () => done(null));
    });
  }

  /** Приоритет процесса (GTA5.exe): normal | abovenormal | high. Через PowerShell, без окон; ошибки не критичны. */
  function setPriority(imageName, level) {
    const cls = { normal: 'Normal', abovenormal: 'AboveNormal', high: 'High' }[level];
    if (process.platform !== 'win32' || !cls) return Promise.resolve(false);
    const name = String(imageName).replace(/\.exe$/i, '').replace(/[^A-Za-z0-9_.-]/g, '');
    const cmd = `Get-Process -Name '${name}' -ErrorAction SilentlyContinue | ForEach-Object { $_.PriorityClass = '${cls}' }`;
    return new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 15000 }, (err) => {
      if (err) log && log.warn('runner', `приоритет: ${err.message}`); else log && log.info('runner', `приоритет ${name}: ${cls}`);
      resolve(!err);
    }));
  }

  return { isRunning, launch, waitAppear, waitExit, tcpPing, setPriority };
}

module.exports = { createRunner };
