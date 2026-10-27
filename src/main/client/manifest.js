'use strict';
const path = require('path');

/**
 * Формат манифеста (совместим со старым лаунчером):
 *   { "format": 1, "digest": "<строка>", "version": "1.2.3", "files": [ { "path": "a/b.ytd", "size": 123, "sha256": "<64 hex>" } ] }
 * Файл скачивается из <base>/files/<path>.
 */
const SHA_RE = /^[0-9a-f]{64}$/i;
const BAD_CHARS = /[\x00-\x1f\\:*?"<>|]/;   // как в старом лаунчере (разделитель — только «/»)

/** Расширения игровых данных (из старого лаунчера) — для синхронизации модов */
const DATA_EXT = new Set(['.rpf', '.ytd', '.ydr', '.ydd', '.yft', '.ybn', '.ymap', '.ytyp', '.ymt', '.ymf', '.ycd', '.ynv', '.ynd',
  '.ypt', '.ypdb', '.yld', '.ysc', '.awc', '.rel', '.gxt2', '.meta', '.xml', '.dat', '.dat151', '.dat54', '.dat4', '.dat22',
  '.dat10', '.nametable', '.txt', '.json', '.ide', '.ipl', '.cut', '.png', '.jpg']);

class ManifestError extends Error { constructor(msg) { super(msg); this.code = 'manifest_invalid'; } }

/** Безопасный относительный путь внутри корня или ошибка */
function cleanRelPath(rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 260) throw new ManifestError(`путь: ${rel}`);
  if (BAD_CHARS.test(rel) || rel.startsWith('/') || /^[a-z]:/i.test(rel)) throw new ManifestError(`путь: ${rel}`);
  const parts = rel.split('/');
  if (parts.some((p) => !p || p === '.' || p === '..' || /[. ]$/.test(p))) throw new ManifestError(`путь: ${rel}`);
  return parts.join('/');
}

function safeJoin(root, rel) {
  const clean = cleanRelPath(rel);
  const full = path.resolve(root, ...clean.split('/'));
  const rootR = path.resolve(root);
  if (full !== rootR && !full.startsWith(rootR + path.sep)) throw new ManifestError(`выход за корень: ${rel}`);
  return full;
}

/**
 * @param {object} m  разобранный JSON
 * @param {{allowExt?:Set<string>, allowNames?:string[], maxFiles?:number, maxBytes?:number}} rules
 */
function validateManifest(m, rules) {
  const r = rules || {};
  if (!m || typeof m !== 'object' || !Array.isArray(m.files)) throw new ManifestError('нет files');
  if (m.format != null && m.format !== 1 && m.format !== '1') throw new ManifestError('формат');
  const maxFiles = r.maxFiles || 20000; const maxBytes = r.maxBytes || 8 * 1024 ** 3;
  if (m.files.length > maxFiles) throw new ManifestError('слишком много файлов');
  const seen = new Set(); let total = 0; const files = [];
  for (const f of m.files) {
    const p = cleanRelPath(f && f.path);
    const key = p.toLowerCase();
    if (seen.has(key)) throw new ManifestError(`дубликат: ${p}`);
    seen.add(key);
    if (!Number.isSafeInteger(f.size) || f.size < 0) throw new ManifestError(`размер: ${p}`);
    if (!SHA_RE.test(String(f.sha256 || ''))) throw new ManifestError(`sha256: ${p}`);
    if (r.allowNames && !r.allowNames.includes(p)) throw new ManifestError(`имя не разрешено: ${p}`);
    if (r.allowExt && !r.allowExt.has(path.posix.extname(p).toLowerCase())) throw new ManifestError(`расширение не разрешено: ${p}`);
    total += f.size; files.push({ path: p, size: f.size, sha256: f.sha256.toLowerCase() });
  }
  if (total > maxBytes) throw new ManifestError('слишком большой');
  return { format: 1, version: String(m.version || ''), digest: String(m.digest || ''), files, totalBytes: total };
}

/**
 * Что нужно скачать: нет файла / не тот размер / не тот хэш в маркере.
 * state.files[path] = { size, sha256, mtimeMs }; stat(path) -> { size, mtimeMs } | null
 * При verify=true хэш каждого файла проверяется заново (вызывающий обновляет state).
 */
function planDownloads(manifest, state, stat) {
  const todo = []; const keep = [];
  for (const f of manifest.files) {
    const local = state && state.files && state.files[f.path];
    const st = stat(f.path);
    const same = local && st && st.size === f.size && local.size === f.size && local.sha256 === f.sha256 && Math.abs(st.mtimeMs - local.mtimeMs) < 2;
    (same ? keep : todo).push(f);
  }
  const remove = [];
  if (state && state.files) {
    const want = new Set(manifest.files.map((f) => f.path));
    for (const p of Object.keys(state.files)) if (!want.has(p)) remove.push(p);
  }
  return { todo, keep, remove, bytes: todo.reduce((a, f) => a + f.size, 0) };
}

module.exports = { validateManifest, planDownloads, safeJoin, cleanRelPath, ManifestError, DATA_EXT, SHA_RE };
