const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ERRORS } = require('../src/core/contract');

const R = path.join(__dirname, '..', 'src', 'renderer');
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js') && !p.endsWith('i18n-en.js')) files.push(p); } })(path.join(R, 'js'));
const CY = /[А-Яа-яЁё]/;
const T_RE = /\bt\('((?:[^'\\\n]|\\.)*)'/g;

// import() принимает только file:// URL: на Windows путь «C:\…» читается как схема «c:»
const esm = (...p) => import(require('url').pathToFileURL(path.join(R, ...p)).href);
const loadEN = () => esm('js', 'i18n-en.js').then((m) => m.EN);

test('i18n: у каждого t(…) в рендерере есть английский перевод', async () => {
  const EN = await loadEN(); const miss = [];
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(T_RE)) { const k = m[1].replace(/\\'/g, "'"); if (CY.test(k) && !(k in EN)) miss.push(path.basename(f) + ': ' + k); }
  }
  assert.deepStrictEqual(miss, []);
});

test('i18n: переведены сообщения об ошибках, тосты main/mock и статика index.html', async () => {
  const EN = await loadEN(); const miss = [];
  for (const m of Object.values(ERRORS)) if (!(m in EN)) miss.push('ERRORS: ' + m);
  for (const f of ['src/main/game.js', 'src/mock/index.js']) {
    const s = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    for (const m of s.matchAll(/emit\('toast', \{ kind: '\w+', text: '((?:[^'\\]|\\.)*)' \}/g)) if (!(m[1] in EN)) miss.push(f + ': ' + m[1]);
  }
  const html = fs.readFileSync(path.join(R, 'index.html'), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)) if (!(m[1] in EN)) miss.push('index.html: ' + m[1]);
  assert.deepStrictEqual(miss, []);
});

test('i18n: подстановки {имя} в переводе те же, что в ключе', async () => {
  const EN = await loadEN(); const bad = [];
  const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  for (const [k, v] of Object.entries(EN)) if (ph(k) !== ph(v)) bad.push(k);
  assert.deepStrictEqual(bad, []);
});

test('i18n: каждая русская строка-литерал в рендерере есть в словаре (в т.ч. словари вроде ST/STATUS, которые переводятся при показе)', async () => {
  const EN = await loadEN(); const left = [];
  for (const f of files) {
    if (f.endsWith('codefmt.js')) continue; // карта раскладки, не текст интерфейса
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => { // CRLF на Windows ломал отсечение «// комментария»
      const s = line.trim(); if (s.startsWith('//') || s.startsWith('/*') || s.startsWith('*')) return;
      const l = line.replace(/\s\/\/\s.*$/, '');
      for (const m of l.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) { const k = m[1].replace(/\\'/g, "'"); if (CY.test(k) && !(k in EN)) left.push(path.basename(f) + ':' + (i + 1) + ' ' + k.slice(0, 60)); }
      // русский текст вне кавычек (в шаблонах и разметке) — не переведётся
      const rest = l.replace(/'(?:[^'\\\n]|\\.)*'/g, '');
      if (CY.test(rest.replace(/<!--.*?-->/g, ''))) left.push(path.basename(f) + ':' + (i + 1) + ' (вне t) ' + s.slice(0, 80));
    });
  }
  assert.deepStrictEqual(left, []);
});

test('codefmt: латиница, цифры, лимит; кириллица → клавиша', async () => {
  const { cleanCode, groupLogin } = await esm('js', 'codefmt.js');
  assert.strictEqual(cleanCode('kt7m-4xpq', { max: 8 }).text, 'KT7M4XPQ');
  assert.strictEqual(cleanCode('Привет, как дела? Это очень длинный текст', { max: 8 }).dropped, true);
  assert.strictEqual(cleanCode('привет', { max: 8, keys: true }).text, 'GHBDTN');
  assert.strictEqual(cleanCode('привет', { max: 8 }).text, '');
  const c = cleanCode('ABCDEFGHIJKL', { max: 8 }); assert.strictEqual(c.text, 'ABCDEFGH'); assert.strictEqual(c.over, true);
  assert.strictEqual(groupLogin('KT7M4XPQ'), 'KT7M-4XPQ');
  assert.strictEqual(cleanCode('A-b_c d', { max: 16, dash: true }).text, 'A-BC' + 'D');
});
