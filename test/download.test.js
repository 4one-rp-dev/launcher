'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { downloadFile, DlError } = require('../src/main/client/download');

const data = crypto.randomBytes(300000);
const sha = crypto.createHash('sha256').update(data).digest('hex');
const serve = (ranges) => new Promise((res) => {
  const s = http.createServer((req, rs) => {
    const m = /bytes=(\d+)-/.exec(req.headers.range || '');
    if (m && ranges) { const from = Number(m[1]); rs.writeHead(206); rs.end(data.subarray(from)); } else { rs.writeHead(200); rs.end(data); }
  }).listen(0, '127.0.0.1', () => res({ url: `http://127.0.0.1:${s.address().port}/f`, close: () => s.close() }));
});
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'l4dl-')), 'sub', 'f.bin');

test('скачивание: размер и SHA-256 сходятся, файл появляется атомарно', async () => {
  const s = await serve(true); const dest = tmp(); let got = 0;
  const r = await downloadFile({ url: s.url, dest, size: data.length, sha256: sha, onBytes: (n) => (got += n) });
  assert.strictEqual(r.sha256, sha); assert.strictEqual(got, data.length);
  assert.ok(fs.existsSync(dest) && !fs.existsSync(dest + '.part')); s.close();
});

test('докачка с места обрыва (Range)', async () => {
  const s = await serve(true); const dest = tmp(); fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest + '.part', data.subarray(0, 100000)); let got = 0;
  await downloadFile({ url: s.url, dest, size: data.length, sha256: sha, onBytes: (n) => (got += n) });
  assert.strictEqual(got, data.length - 100000); assert.ok(fs.readFileSync(dest).equals(data)); s.close();
});

test('сервер без Range: качаем заново, результат тот же', async () => {
  const s = await serve(false); const dest = tmp(); fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest + '.part', data.subarray(0, 50000));
  await downloadFile({ url: s.url, dest, size: data.length, sha256: sha });
  assert.ok(fs.readFileSync(dest).equals(data)); s.close();
});

test('неверный хэш: файл не создаётся, ошибка hash_mismatch', async () => {
  const s = await serve(true); const dest = tmp();
  await assert.rejects(downloadFile({ url: s.url, dest, size: data.length, sha256: 'a'.repeat(64) }), (e) => e instanceof DlError && e.code === 'hash_mismatch');
  assert.ok(!fs.existsSync(dest) && !fs.existsSync(dest + '.part')); s.close();
});
