'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readFileVersion } = require('../src/main/gta/pe-version');

test('не-PE и отсутствующие файлы дают null', () => {
  const f = path.join(os.tmpdir(), 'l4-notpe.bin'); fs.writeFileSync(f, Buffer.from('hello world'.repeat(500)));
  assert.strictEqual(readFileVersion(f), null);
  assert.strictEqual(readFileVersion(path.join(os.tmpdir(), 'нет-такого.exe')), null);
});

test('настоящий PE: версия читается из ресурсов (если есть образец)', (t) => {
  const sample = process.env.L4_PE_SAMPLE;
  if (!sample || !fs.existsSync(sample)) return t.skip('задайте L4_PE_SAMPLE=путь к exe (например GTA5.exe)');
  assert.match(readFileVersion(sample) || '', /^\d+\.\d+\.\d+\.\d+$/);
});
