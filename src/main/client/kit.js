'use strict';
const fs = require('fs');
const path = require('path');
const { safeJoin } = require('./manifest');
const { downloadFile, DlError } = require('./download');

/**
 * Комплект клиента игры (внутри — установщик платформы и подписанный клиент).
 * Игрок ничего не скачивает руками: лаунчер берёт комплект по ссылке из bootstrap Core API
 * (`client: { version, kitUrl, kitSha256, kitSize }`, https), сверяет SHA-256, распаковывает в свою папку
 * и дальше ведёт установку и вход сам (client/platform.js). Обновления клиента потом приходят с игрового сервера.
 */

const DONE = '.kit-ready.json';
const EXE = 'FloVMP.exe';

function createKit(deps) {
  const { dir, log } = deps; // dir — <userData>/client-kit
  const doFetch = deps.fetch || globalThis.fetch;

  const verDir = (v) => path.join(dir, String(v).replace(/[^0-9A-Za-z._-]/g, '_'));

  /** Готовый распакованный комплект: самый свежий из лежащих в папке (или заданный для разработки L4_KIT_DIR). */
  function current() {
    if (deps.devDir) return fs.existsSync(path.join(deps.devDir, EXE)) ? { dir: deps.devDir, version: 'dev', exe: path.join(deps.devDir, EXE) } : null;
    let best = null;
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { return null; }
    for (const n of names) {
      const d = path.join(dir, n);
      try {
        const m = JSON.parse(fs.readFileSync(path.join(d, DONE), 'utf8'));
        if (!fs.existsSync(path.join(d, EXE))) continue;
        if (!best || cmpVer(m.version, best.version) > 0) best = { dir: d, version: m.version, exe: path.join(d, EXE) };
      } catch (_) { /* не готов */ }
    }
    return best;
  }

  /** Нужно ли качать комплект: нет ни одного, или в bootstrap версия новее и установщика платформы на ПК ещё нет. */
  function needed(info, installedExe) {
    if (installedExe) return false;
    const have = current();
    if (!have) return true;
    return !!(info && info.version && have.version !== 'dev' && cmpVer(have.version, info.version) < 0);
  }

  function valid(info) {
    return !!(info && /^https:\/\//i.test(info.kitUrl || '') && /^[0-9a-f]{64}$/i.test(info.kitSha256 || ''));
  }

  /** Скачать и распаковать комплект. onProgress({done,total,file,speed,stage}). */
  async function ensure(info, opts) {
    const o = opts || {};
    if (deps.devDir) { const c = current(); if (c) return c; throw new DlError('download_failed', 'нет L4_KIT_DIR/FloVMP.exe'); }
    const have = current();
    if (have && (!info || !info.version || cmpVer(have.version, info.version) >= 0)) return have;
    if (!valid(info)) throw new DlError('client_kit_missing', 'в bootstrap нет ссылки на комплект клиента (kitUrl/kitSha256)');

    fs.mkdirSync(dir, { recursive: true });
    const zipPath = path.join(dir, `kit-${info.version}.zip`);
    let done = 0; const t0 = Date.now();
    await downloadFile({
      url: info.kitUrl, dest: zipPath, size: info.kitSize || null, sha256: info.kitSha256, signal: o.signal, fetch: doFetch,
      onBytes: (n) => { done += n; const dt = (Date.now() - t0) / 1000 || 1; o.onProgress && o.onProgress({ stage: 'kit', file: '', done, total: info.kitSize || 0, speed: done / dt }); },
    });
    if (o.signal && o.signal.aborted) throw new DlError('cancelled');
    const target = verDir(info.version);
    const tmp = `${target}.tmp`;
    fs.rmSync(tmp, { recursive: true, force: true });
    let unpacked = 0;
    await extract(zipPath, tmp, {
      signal: o.signal,
      onEntry: (n, total) => { unpacked = n; o.onProgress && o.onProgress({ stage: 'unpack', file: '', done: n, total, percent: total ? Math.floor((n / total) * 100) : 0 }); },
    });
    if (o.signal && o.signal.aborted) { fs.rmSync(tmp, { recursive: true, force: true }); throw new DlError('cancelled'); }
    log.info('kit', `распаковано файлов: ${unpacked}`);
    if (!fs.existsSync(path.join(tmp, EXE))) { fs.rmSync(tmp, { recursive: true, force: true }); throw new DlError('manifest_invalid', 'в комплекте нет установщика клиента'); }
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(tmp, target);
    fs.writeFileSync(path.join(target, DONE), JSON.stringify({ version: info.version, at: Date.now() }));
    try { fs.unlinkSync(zipPath); } catch (_) { /* ignore */ }
    prune(info.version);
    log.info('kit', `комплект ${info.version} распакован`);
    return current();
  }

  /**
   * Распаковка с проверкой путей, потоками и без блокировки main-процесса (в комплекте файлы по сотне МБ: синхронная
   * распаковка держала окно «Не отвечает»). Архив, собранный в Windows, хранит имена с «\» — приводим к «/».
   */
  function extract(zipPath, dest, opts) {
    const o = opts || {};
    const yauzl = require('yauzl');
    return new Promise((resolve, reject) => {
      yauzl.open(zipPath, { lazyEntries: true, decodeStrings: true, strictFileNames: false, validateEntrySizes: true }, (err, zip) => {
        if (err) return reject(err);
        const total = zip.entryCount; let n = 0; let failed = false;
        const bail = (e) => { if (failed) return; failed = true; try { zip.close(); } catch (_) { /* ignore */ } reject(e); };
        zip.on('error', bail);
        zip.on('end', () => { if (!failed) resolve(n); });
        zip.on('entry', (e) => {
          if (failed) return;
          if (o.signal && o.signal.aborted) { zip.close(); return resolve(n); }
          const rel = e.fileName.replace(/\\/g, '/');
          if (!rel || rel.endsWith('/')) { n++; return zip.readEntry(); }
          let target;
          try { target = safeJoin(dest, rel); fs.mkdirSync(path.dirname(target), { recursive: true }); } catch (x) { return bail(x); }
          zip.openReadStream(e, (e2, rs) => {
            if (e2) return bail(e2);
            const ws = fs.createWriteStream(target);
            rs.on('error', bail); ws.on('error', bail);
            ws.on('finish', () => { n++; if (o.onEntry) o.onEntry(n, total); zip.readEntry(); });
            rs.pipe(ws);
          });
        });
        zip.readEntry();
      });
    });
  }

  /** Старые версии комплекта не нужны: установленный клиент живёт отдельно. */
  function prune(keep) {
    let names = []; try { names = fs.readdirSync(dir); } catch (_) { return; }
    for (const n of names) { if (n === path.basename(verDir(keep))) continue; fs.rmSync(path.join(dir, n), { recursive: true, force: true }); }
  }

  return { current, needed, valid, ensure, extract, EXE };
}

/** Сравнение версий 1.2.3 (недостающие части — нули). */
function cmpVer(a, b) {
  const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0); const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d < 0 ? -1 : 1; }
  return 0;
}

module.exports = { createKit, cmpVer, DONE, EXE };
