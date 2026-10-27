'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');

class DlError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

/**
 * Скачивание в <dest>.part с докачкой (Range), проверкой размера и SHA-256, затем атомарное переименование.
 * onBytes(n) вызывается для каждого принятого куска.
 */
async function downloadFile(o) {
  const { url, dest, size, sha256, signal, onBytes, headers } = o;
  const doFetch = o.fetch || globalThis.fetch;
  const part = `${dest}.part`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  let have = 0;
  try { have = fs.statSync(part).size; } catch (_) { have = 0; }
  if (size != null && have > size) { fs.unlinkSync(part); have = 0; }

  const hash = crypto.createHash('sha256');
  if (have > 0) await new Promise((res, rej) => fs.createReadStream(part).on('data', (d) => hash.update(d)).on('error', rej).on('end', res));

  let res;
  try {
    res = await doFetch(url, { headers: Object.assign({}, headers || {}, have ? { Range: `bytes=${have}-` } : {}), signal, redirect: 'follow' });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new DlError('cancelled');
    throw new DlError('download_failed', e && e.message);
  }
  if (res.status === 416) { try { fs.unlinkSync(part); } catch (_) { /* ignore */ } return downloadFile(Object.assign({}, o)); }
  if (!res.ok) throw new DlError('download_failed', `HTTP ${res.status}`);
  if (have && res.status === 200) { // сервер игнорирует Range — начинаем сначала
    have = 0; hash.update(Buffer.alloc(0)); try { fs.unlinkSync(part); } catch (_) { /* ignore */ }
    return downloadFileNoRange(o, res);
  }
  return pipeToFile(res, part, dest, have, hash, o);
}

async function downloadFileNoRange(o, res) {
  return pipeToFile(res, `${o.dest}.part`, o.dest, 0, crypto.createHash('sha256'), o);
}

async function pipeToFile(res, part, dest, have, hash, o) {
  const { size, sha256, signal, onBytes } = o;
  const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
  let written = have;
  try {
    const body = Readable.fromWeb(res.body);
    for await (const chunk of body) {
      if (signal && signal.aborted) throw new DlError('cancelled');
      hash.update(chunk); written += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      if (onBytes) onBytes(chunk.length);
    }
  } catch (e) {
    out.destroy();
    if (e instanceof DlError) throw e;
    if (e && e.name === 'AbortError') throw new DlError('cancelled');
    throw new DlError('download_failed', e && e.message);
  }
  await new Promise((r, j) => out.end((err) => (err ? j(err) : r())));
  const digest = hash.digest('hex');
  if ((size != null && written !== size) || (sha256 && digest.toLowerCase() !== String(sha256).toLowerCase())) {
    try { fs.unlinkSync(part); } catch (_) { /* ignore */ }
    throw new DlError('hash_mismatch', `${path.basename(dest)}: ${digest}`);
  }
  fs.renameSync(part, dest);
  return { size: written, sha256: digest };
}

module.exports = { downloadFile, sha256File, DlError };
