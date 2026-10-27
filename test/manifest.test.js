'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { validateManifest, planDownloads, safeJoin, cleanRelPath, DATA_EXT } = require('../src/main/client/manifest');

const H = (c) => c.repeat(64);
const ok = { format: 1, version: '1.0.0', digest: 'd', files: [{ path: 'mods/a.ytd', size: 10, sha256: H('a') }, { path: 'b.meta', size: 5, sha256: H('B') }] };

test('корректный манифест проходит, хэш приводится к нижнему регистру', () => {
  const m = validateManifest(ok, { allowExt: DATA_EXT });
  assert.strictEqual(m.totalBytes, 15); assert.strictEqual(m.files[1].sha256, H('b'));
});

test('опасные пути отклоняются', () => {
  for (const p of ['../x.ytd', '/abs.ytd', 'C:/x.ytd', 'a\\b.ytd', 'a//b.ytd', './a.ytd', 'a/../b.ytd', 'a/b.ytd.', 'a/b:s.ytd', '', 'con\x00.ytd']) {
    assert.throws(() => cleanRelPath(p), undefined, JSON.stringify(p));
  }
  assert.throws(() => safeJoin(path.resolve('/root/mods'), '../../etc/passwd'));
  assert.ok(safeJoin(path.resolve('/root/mods'), 'a/b.ytd').startsWith(path.resolve('/root/mods')));
});

test('манифест: дубликаты, размеры, хэши, расширения', () => {
  const f = (files, rules) => () => validateManifest({ files }, rules);
  assert.throws(f([ok.files[0], { path: 'MODS/A.ytd', size: 1, sha256: H('a') }]));
  assert.throws(f([{ path: 'a.ytd', size: -1, sha256: H('a') }]));
  assert.throws(f([{ path: 'a.ytd', size: 1.5, sha256: H('a') }]));
  assert.throws(f([{ path: 'a.ytd', size: 1, sha256: 'zz' }]));
  assert.throws(f([{ path: 'evil.exe', size: 1, sha256: H('a') }], { allowExt: DATA_EXT }));
  assert.throws(f([{ path: 'a.ytd', size: 1, sha256: H('a') }], { allowNames: ['x.asi'] }));
  assert.throws(() => validateManifest({ format: 2, files: [] }));
  assert.throws(() => validateManifest(null));
});

test('planDownloads: докачивает только изменившееся и удаляет лишнее', () => {
  const m = validateManifest(ok);
  const state = { files: { 'mods/a.ytd': { size: 10, sha256: H('a'), mtimeMs: 100 }, 'old.ytd': { size: 1, sha256: H('c'), mtimeMs: 1 } } };
  const stat = (p) => (p === 'mods/a.ytd' ? { size: 10, mtimeMs: 100 } : null);
  const plan = planDownloads(m, state, stat);
  assert.deepStrictEqual(plan.keep.map((f) => f.path), ['mods/a.ytd']);
  assert.deepStrictEqual(plan.todo.map((f) => f.path), ['b.meta']);
  assert.deepStrictEqual(plan.remove, ['old.ytd']); assert.strictEqual(plan.bytes, 5);
  // файл изменили на диске -> перекачать
  assert.strictEqual(planDownloads(m, state, () => ({ size: 11, mtimeMs: 100 })).todo.length, 2);
});
