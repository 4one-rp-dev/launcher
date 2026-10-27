'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sanitize, defaults, createSettings } = require('../src/main/settings');
const { parseDeepLink, findDeepLink } = require('../src/main/protocol');
const { isAllowedExternal, resolveExternal } = require('../src/main/security');

test('settings.sanitize отбрасывает чужие ключи и неверные типы', () => {
  const s = sanitize({ closeAfterStart: true, minimizeToTray: 'yes', hack: 1, playMinutes: NaN, gamePath: 'C:\\GTA' });
  assert.strictEqual(s.closeAfterStart, true);
  assert.strictEqual(s.minimizeToTray, defaults().minimizeToTray);
  assert.strictEqual(s.playMinutes, 0);
  assert.strictEqual(s.gamePath, 'C:\\GTA');
  assert.ok(!('hack' in s));
  assert.strictEqual(sanitize({ gamePath: 'x'.repeat(2000) }).gamePath, '');
});

test('settings: запись на диск и чтение обратно', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l4set-'));
  const a = createSettings(dir); await a.set({ selectedServerId: 'main', accent: 'mint' });
  if (a.flush) a.flush();
  const b = createSettings(dir);
  assert.strictEqual(b.get().selectedServerId, 'main'); assert.strictEqual(b.get().accent, 'mint');
});

test('deep-link gta4one://auth/callback (OAuth)', () => {
  const code = 'A'.repeat(20) + '-_9'; const state = 'b'.repeat(24);
  assert.deepStrictEqual(parseDeepLink(`gta4one://auth/callback?code=${code}&state=${state}`), { type: 'auth-callback', code, state });
  assert.strictEqual(parseDeepLink('gta4one://auth/callback?code=short&state=short'), null);
  assert.strictEqual(parseDeepLink(`gta4one://auth/callback?code=${code}`), null, 'без state нельзя');
  assert.strictEqual(parseDeepLink(`gta4one://auth/callback?code=%3Cscript%3E${code}&state=${state}`), null);
  assert.strictEqual(parseDeepLink(`gta4one://auth?code=${code}&state=${state}`), null, 'старый формат больше не принимается');
  assert.strictEqual(parseDeepLink(`https://evil.example/auth/callback?code=${code}&state=${state}`), null);
  assert.strictEqual(parseDeepLink('gta4one://run?cmd=calc'), null);
  const link = `gta4one://auth/callback?code=${code}&state=${state}`;
  assert.strictEqual(findDeepLink(['app.exe', '--x', link]), link);
});

test('внешние ссылки: только https и хосты из allowlist', () => {
  assert.ok(isAllowedExternal('https://www.4onerp.com/news'));
  assert.ok(!isAllowedExternal('http://www.4onerp.com/'));
  assert.ok(!isAllowedExternal('https://evil.example/'));
  assert.ok(!isAllowedExternal('file:///C:/Windows/System32/calc.exe'));
  assert.ok(!isAllowedExternal('javascript:alert(1)'));
  assert.ok(resolveExternal('discord'));
  assert.strictEqual(resolveExternal('toString'), null);
});

test('settings: язык только ru|en', () => {
  assert.strictEqual(sanitize({ lang: 'en' }).lang, 'en');
  assert.strictEqual(sanitize({ lang: 'de' }).lang, 'ru');
  assert.strictEqual(sanitize({}).lang, 'ru');
});

test('settings: новые ключи (масштаб, анимации, уведомления) и сброс', async () => {
  const s = sanitize({ scale: '125', animations: false, toasts: false, newsBadge: false });
  assert.strictEqual(s.scale, '125'); assert.strictEqual(s.animations, false);
  assert.strictEqual(sanitize({ scale: '999' }).scale, 'auto');            // не из списка — отбрасываем
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l4set-'));
  const a = createSettings(dir); await a.set({ gamePath: 'C:\\GTA', scale: '150', accent: 'rose', animations: false });
  const r = await a.reset();
  assert.strictEqual(r.scale, 'auto'); assert.strictEqual(r.accent, 'violet'); assert.strictEqual(r.animations, true);
  assert.strictEqual(r.gamePath, 'C:\\GTA');                                // папка игры при сбросе остаётся
});
