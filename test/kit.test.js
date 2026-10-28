const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { createKit, cmpVer } = require('../src/main/client/kit');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'l4-kit-'));
const log = { warn() {}, info() {}, error() {} };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** Архив как у Compress-Archive в Windows: имена с обратной косой чертой. */
function makeZip(entries) {
  const z = new AdmZip();
  for (const [name, data] of Object.entries(entries)) z.addFile(name, Buffer.from(data));
  return z.toBuffer();
}
const serve = (buf) => async () => new Response(buf, { status: 200, headers: { 'content-length': String(buf.length) } });

test('ensure: скачивает, сверяет SHA-256, распаковывает имена с «\\» и готовит FloVMP.exe', async () => {
  const dir = tmp();
  const zip = makeZip({ 'FloVMP.exe': 'EXE', 'FloVMP\\cef\\libcef.dll': 'DLL', 'VERSION': '1.1.1' });
  const kit = createKit({ dir, log, fetch: serve(zip) });
  const info = { version: '1.1.1', kitUrl: 'https://cdn.example/kit.zip', kitSha256: sha(zip), kitSize: zip.length };
  assert.strictEqual(kit.current(), null);
  const prog = [];
  const k = await kit.ensure(info, { onProgress: (p) => prog.push(p) });
  assert.strictEqual(fs.readFileSync(k.exe, 'utf8'), 'EXE');
  assert.strictEqual(fs.readFileSync(path.join(k.dir, 'FloVMP', 'cef', 'libcef.dll'), 'utf8'), 'DLL');
  assert.ok(prog.length && prog[prog.length - 1].stage === 'kit');
  assert.strictEqual(kit.current().version, '1.1.1');
  assert.ok(!fs.readdirSync(dir).some((n) => n.endsWith('.zip') || n.endsWith('.tmp')), 'временные файлы убраны');
});

test('ensure: неверный SHA-256 — ошибка и ничего не распаковано', async () => {
  const dir = tmp(); const zip = makeZip({ 'FloVMP.exe': 'EXE' });
  const kit = createKit({ dir, log, fetch: serve(zip) });
  await assert.rejects(kit.ensure({ version: '1.1.1', kitUrl: 'https://cdn.example/kit.zip', kitSha256: 'a'.repeat(64) }), (e) => e.code === 'hash_mismatch');
  assert.strictEqual(kit.current(), null);
});

test('ensure: выход из папки в архиве (..\\) отклоняется', async () => {
  const dir = tmp();
  // AdmZip чистит «..» при добавлении записи, поэтому имя подменяем в готовом архиве: та же длина (8 знаков),
  // и в локальном заголовке, и в каталоге архива
  const zip = makeZip({ 'FloVMP.exe': 'EXE', AAAAAAAA: 'x' });
  const from = Buffer.from('AAAAAAAA'); const to = Buffer.from('..\\evil.');
  for (let i = zip.indexOf(from); i >= 0; i = zip.indexOf(from, i + 1)) to.copy(zip, i);
  const kit = createKit({ dir, log, fetch: serve(zip) });
  await assert.rejects(kit.ensure({ version: '1.1.1', kitUrl: 'https://cdn.example/kit.zip', kitSha256: sha(zip) }));
  assert.ok(!fs.existsSync(path.join(dir, 'evil.txt')) && !fs.existsSync(path.join(path.dirname(dir), 'evil.txt')));
  assert.strictEqual(kit.current(), null);
});

test('ensure: без https-ссылки и хэша не качает', async () => {
  const kit = createKit({ dir: tmp(), log, fetch: async () => { throw new Error('сеть не должна вызываться'); } });
  await assert.rejects(kit.ensure({ version: '1.1.1', kitUrl: 'http://cdn.example/kit.zip', kitSha256: 'a'.repeat(64) }), (e) => e.code === 'client_kit_missing');
  await assert.rejects(kit.ensure({ version: '1.1.1', kitUrl: 'https://cdn.example/kit.zip' }), (e) => e.code === 'client_kit_missing');
  await assert.rejects(kit.ensure(null), (e) => e.code === 'client_kit_missing');
});

test('новая версия заменяет старую; готовый комплект не качается повторно', async () => {
  const dir = tmp(); let hits = 0;
  const z1 = makeZip({ 'FloVMP.exe': 'v1' }); const z2 = makeZip({ 'FloVMP.exe': 'v2' });
  let cur = z1; const kit = createKit({ dir, log, fetch: async () => { hits++; return new Response(cur, { status: 200 }); } });
  await kit.ensure({ version: '1.1.1', kitUrl: 'https://c/k.zip', kitSha256: sha(z1) });
  await kit.ensure({ version: '1.1.1', kitUrl: 'https://c/k.zip', kitSha256: sha(z1) });
  assert.strictEqual(hits, 1);
  cur = z2; const k2 = await kit.ensure({ version: '1.1.2', kitUrl: 'https://c/k.zip', kitSha256: sha(z2) });
  assert.strictEqual(fs.readFileSync(k2.exe, 'utf8'), 'v2'); assert.strictEqual(k2.version, '1.1.2');
  assert.strictEqual(fs.readdirSync(dir).filter((n) => !n.startsWith('.')).length, 1, 'старая версия убрана');
});

test('needed: не нужен, если установщик платформы уже стоит на ПК', () => {
  const kit = createKit({ dir: tmp(), log });
  assert.strictEqual(kit.needed({}, 'C:/x/FloVMP.exe'), false);
  assert.strictEqual(kit.needed({}, null), true);
});

test('devDir (L4_KIT_DIR): берёт готовую папку и ничего не качает', async () => {
  const d = tmp(); fs.writeFileSync(path.join(d, 'FloVMP.exe'), 'x');
  const kit = createKit({ dir: tmp(), log, devDir: d, fetch: async () => { throw new Error('нет сети'); } });
  assert.strictEqual((await kit.ensure(null)).exe, path.join(d, 'FloVMP.exe'));
});

test('cmpVer', () => { assert.strictEqual(cmpVer('1.1.2', '1.1.10'), -1); assert.strictEqual(cmpVer('1.2', '1.2.0'), 0); assert.strictEqual(cmpVer('2', '1.9.9'), 1); });
