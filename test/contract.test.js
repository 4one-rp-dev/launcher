'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { CHANNELS, EVENTS, ERRORS, message } = require('../src/core/contract');

const arr = (src, name) => { const m = src.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`)); return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null; };

test('preload дублирует каналы и события из contract.js', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'index.js'), 'utf8');
  assert.deepStrictEqual(arr(src, 'CHANNELS'), [...CHANNELS]);
  assert.deepStrictEqual(arr(src, 'EVENTS'), [...EVENTS]);
});

test('у каждой ошибки есть русский текст', () => {
  for (const code of Object.keys(ERRORS)) assert.ok(message(code) && /[а-яё]/i.test(message(code)), code);
});

test('каждый канал имеет обработчик', () => {
  const { createHandlers } = require('../src/core/handlers');
  const { createMock } = require('../src/mock');
  const h = createHandlers(createMock({}).services);
  for (const ch of CHANNELS) assert.strictEqual(typeof h[ch], 'function', ch);
});

test('в рендерере вызываются только каналы из контракта', () => {
  const dir = path.join(__dirname, '..', 'src', 'renderer', 'js');
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))); })(dir);
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/call\('([a-z]+:[A-Za-z]+)'/g)) assert.ok(CHANNELS.includes(m[1]), `${path.basename(f)}: ${m[1]}`);
    for (const m of s.matchAll(/\bon\('([a-z]+:[A-Za-z]+)'/g)) assert.ok(EVENTS.includes(m[1]), `${path.basename(f)}: ${m[1]}`);
  }
});
