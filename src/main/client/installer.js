'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { validateManifest, planDownloads, safeJoin, DATA_EXT } = require('./manifest');
const { downloadFile, sha256File, DlError } = require('./download');

const MARKER = '.4one-install.json';
const BACKUP_CMD = 'commandline.4one-backup.txt';

/** Скользящая скорость (EMA) и оценка времени */
function createMeter() {
  let last = Date.now(); let bytes = 0; let speed = 0;
  return {
    add(n) {
      bytes += n; const now = Date.now(); const dt = now - last;
      if (dt >= 400) { const inst = (bytes / dt) * 1000; speed = speed ? speed * 0.7 + inst * 0.3 : inst; bytes = 0; last = now; }
    },
    get speed() { return speed; },
  };
}

function createInstaller(deps) {
  const { log, resourcesDir } = deps;
  const doFetch = deps.fetch || globalThis.fetch;

  function readMarker(dir) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, MARKER), 'utf8')); } catch (_) { return { files: {} }; }
  }
  function writeMarker(dir, m) {
    const f = path.join(dir, MARKER); fs.writeFileSync(f + '.tmp', JSON.stringify(m, null, 2)); fs.renameSync(f + '.tmp', f);
  }

  /** Можно ли писать в папку игры (Program Files без прав — частый случай) */
  function canWrite(dir) {
    try { const f = path.join(dir, `.4one-write-${process.pid}`); fs.writeFileSync(f, 'x'); fs.unlinkSync(f); return true; } catch (_) { return false; }
  }

  async function fetchManifest(url, rules, signal) {
    let res;
    try { res = await doFetch(url, { headers: { Accept: 'application/json' }, signal, cache: 'no-store' }); }
    catch (e) { throw new DlError(e && e.name === 'AbortError' ? 'cancelled' : 'download_failed', e && e.message); }
    if (!res.ok) throw new DlError('download_failed', `manifest HTTP ${res.status}`);
    try { return validateManifest(await res.json(), rules); }
    catch (e) { throw new DlError('manifest_invalid', e.message); }
  }

  /** Лёгкий запрос: версия/digest/размер удалённого клиента (без скачивания файлов) */
  async function remoteInfo(baseUrl, rules, signal) {
    const m = await fetchManifest(`${baseUrl}/manifest.json`, rules, signal);
    return { version: m.version, digest: m.digest, totalBytes: m.totalBytes, manifest: m };
  }

  /**
   * Синхронизация набора файлов с манифестом в папку dest.
   * opts: { baseUrl, destDir, rules, verify, signal, onProgress({done,total,file,speed}), markerKey, concurrency }
   */
  async function syncSet(opts) {
    const { baseUrl, destDir, rules, verify, signal, onProgress, markerKey } = opts;
    const manifest = opts.manifest || await fetchManifest(`${baseUrl}/manifest.json`, rules, signal);
    const marker = readMarker(opts.markerDir || destDir);
    const set = (marker[markerKey] = marker[markerKey] || { files: {} });
    const stat = (rel) => { try { const s = fs.statSync(safeJoin(destDir, rel)); return { size: s.size, mtimeMs: s.mtimeMs }; } catch (_) { return null; } };

    if (verify) { // полная перепроверка: хэшируем всё, что есть, и сверяем
      for (const f of manifest.files) {
        const st = stat(f.path);
        if (!st) continue;
        const h = await sha256File(safeJoin(destDir, f.path));
        set.files[f.path] = { size: st.size, sha256: h, mtimeMs: st.mtimeMs };
      }
    }
    const plan = planDownloads(manifest, set, stat);
    const total = plan.bytes; let done = 0; const meter = createMeter(); let cur = '';
    const tick = () => onProgress && onProgress({ done, total, file: cur, speed: meter.speed, files: plan.todo.length });
    tick();

    const queue = plan.todo.slice();
    const workers = Array.from({ length: Math.min(opts.concurrency || 3, queue.length || 1) }, async () => {
      while (queue.length) {
        if (signal && signal.aborted) throw new DlError('cancelled');
        const f = queue.shift(); cur = f.path;
        const dest = safeJoin(destDir, f.path);
        const r = await downloadFile({
          url: `${baseUrl}/files/${f.path.split('/').map(encodeURIComponent).join('/')}`,
          dest, size: f.size, sha256: f.sha256, signal, fetch: doFetch,
          onBytes: (n) => { done += n; meter.add(n); tick(); },
        });
        const st = fs.statSync(dest);
        set.files[f.path] = { size: r.size, sha256: r.sha256, mtimeMs: st.mtimeMs };
        writeMarker(opts.markerDir || destDir, marker);
      }
    });
    await Promise.all(workers);

    for (const rel of plan.remove) { // удаляем только то, что поставили мы
      try { fs.unlinkSync(safeJoin(destDir, rel)); } catch (_) { /* уже нет */ }
      delete set.files[rel];
    }
    set.version = manifest.version; set.digest = manifest.digest; set.at = Date.now();
    writeMarker(opts.markerDir || destDir, marker);
    return { downloaded: plan.todo.length, removed: plan.remove.length, bytes: plan.bytes, manifest };
  }

  /** ScriptHookV + ASI-загрузчик: скачиваем архив с dev-c.com, сверяем SHA-256 архива, достаём два файла */
  async function installScriptHook(dir, opts) {
    const o = opts || {}; const sh = config.game.scriptHook;
    if (sh.files.every((n) => fs.existsSync(path.join(dir, n))) && !o.force) return { skipped: true };
    const tmp = path.join(dir, `.4one-scripthook-${Date.now()}.zip`);
    const meter = createMeter(); let done = 0;
    try {
      await downloadFile({
        url: sh.url, dest: tmp, size: null, sha256: sh.zipSha256, signal: o.signal, fetch: doFetch,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) 4ONE-Launcher', Referer: sh.referer },
        onBytes: (n) => { done += n; meter.add(n); o.onProgress && o.onProgress({ done, total: 0, file: 'ScriptHookV', speed: meter.speed }); },
      });
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(tmp);
      for (const name of sh.files) {
        const entry = zip.getEntries().find((e) => !e.isDirectory && path.posix.basename(e.entryName).toLowerCase() === name.toLowerCase());
        if (!entry) throw new DlError('manifest_invalid', `в архиве нет ${name}`);
        const target = path.join(dir, name);
        if (fs.existsSync(target)) { try { fs.copyFileSync(target, `${target}.4one-backup`); } catch (_) { /* ignore */ } }
        fs.writeFileSync(target, entry.getData());
      }
      return { installed: true };
    } finally { try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ } try { fs.unlinkSync(tmp + '.part'); } catch (_) { /* ignore */ } }
  }

  /** Клиентский ASI: с CDN по манифесту; если CDN недоступен — копия из resources/client (если положили в сборку) */
  async function installClientFiles(dir, opts) {
    const o = opts || {};
    const rules = { allowNames: [config.game.asi] };
    try {
      return await syncSet({
        baseUrl: o.baseUrl || config.cdn.clientBase, destDir: dir, rules, verify: o.verify,
        signal: o.signal, onProgress: o.onProgress, markerKey: 'client', manifest: o.manifest,
      });
    } catch (e) {
      const bundled = resourcesDir && path.join(resourcesDir, 'client', config.game.asi);
      if (e.code === 'download_failed' && bundled && fs.existsSync(bundled) && !o.signal?.aborted) {
        log.warn('installer', 'CDN недоступен, ставлю ASI из комплекта лаунчера');
        fs.copyFileSync(bundled, path.join(dir, config.game.asi));
        return { downloaded: 1, bundled: true };
      }
      throw e;
    }
  }

  /** commandline.txt: сохраняем оригинал один раз и добавляем нужные ключи, не трогая чужие */
  function patchCommandLine(dir, o) {
    const f = path.join(dir, 'commandline.txt'); const bk = path.join(dir, BACKUP_CMD);
    let cur = ''; try { cur = fs.readFileSync(f, 'utf8'); } catch (_) { /* нет файла */ }
    if (!fs.existsSync(bk)) fs.writeFileSync(bk, cur);
    const want = ['-scOfflineOnly']; if (o && o.noBattleye) want.push('-nobattleye');
    let next = cur;
    for (const t of want) if (!new RegExp(`(^|\\s)${t}(\\s|$)`, 'i').test(next)) next = (next.trim() ? next.trimEnd() + '\n' : '') + t + '\n';
    if (next !== cur) fs.writeFileSync(f, next);
  }
  function restoreCommandLine(dir) {
    const f = path.join(dir, 'commandline.txt'); const bk = path.join(dir, BACKUP_CMD);
    if (!fs.existsSync(bk)) return;
    const orig = fs.readFileSync(bk, 'utf8');
    if (orig.trim()) fs.writeFileSync(f, orig); else { try { fs.unlinkSync(f); } catch (_) { /* ignore */ } }
    fs.unlinkSync(bk);
  }

  /** Файл подключения для ASI (формат старого лаунчера: address / name / created) */
  function writeConnect(dir, o) {
    const lines = [`address=${o.address}`, `name=${o.name}`, `created=${Date.now()}`];
    if (o.ticket) lines.push(`ticket=${o.ticket}`);
    fs.writeFileSync(path.join(dir, 'connect.txt'), lines.join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'last-server.txt'), `${o.address}\n`);
  }

  function status(dir) {
    const m = readMarker(dir);
    const hasAsi = fs.existsSync(path.join(dir, config.game.asi));
    const hasHook = config.game.scriptHook.files.every((n) => fs.existsSync(path.join(dir, n)));
    const c = m.client || {};
    return { installed: hasAsi && hasHook, hasAsi, hasHook, version: c.version || '', digest: c.digest || '', at: c.at || 0 };
  }

  function uninstall(dir) {
    const m = readMarker(dir);
    for (const key of ['client', 'mods']) {
      const set = m[key]; if (!set) continue;
      for (const rel of Object.keys(set.files || {})) { try { fs.unlinkSync(safeJoin(key === 'mods' ? path.join(dir, 'mods', 'FloVMP-mods') : dir, rel)); } catch (_) { /* ignore */ } }
    }
    for (const f of [config.game.asi, 'connect.txt', 'last-server.txt', MARKER]) { try { fs.unlinkSync(path.join(dir, f)); } catch (_) { /* ignore */ } }
    restoreCommandLine(dir);
  }

  return { MARKER, canWrite, remoteInfo, fetchManifest, syncSet, installScriptHook, installClientFiles, patchCommandLine, restoreCommandLine, writeConnect, status, uninstall, readMarker, DATA_EXT };
}

module.exports = { createInstaller, MARKER };
