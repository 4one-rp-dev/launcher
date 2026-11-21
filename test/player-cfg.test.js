'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPlayerCfg, parse, serialize, sanitize, DEFAULTS } = require('../src/main/player-cfg');
const { createGtaSettings } = require('../src/main/gta-settings');

// файл в том виде, как его пишет клиент (prefs.cpp Save)
const CLIENT = `# Настройки игрока FloV:MP (меню F1). Меняются в игре; файл можно удалить — вернутся значения по умолчанию.
graphics.draw_distance = 200
graphics.fps_limit = -1
cef.gpu_frames = on
voice.input_device = 2
voice.output_device = 1
voice.mic_volume = 100
voice.volume = 100
hud.netgraph = off
voice.key = 81
voice.radio_key = 0
keys.chat = 0
keys.console = 0
voice.mode = key
voice.threshold = 35
ui.streamer_mode = off
ui.discord = on
voice.enabled = on
voice.auto_gain = on
voice.noise_suppression = on
ui.accent = #FF3D8A
ui.alerts = pill
ui.console_skin = obsidian
`;

test('player.cfg: разбор и запись — байт в байт как у клиента', () => {
  const p = parse(CLIENT);
  assert.strictEqual(p.drawDistance, 200); assert.strictEqual(p.voiceKey, 81); assert.strictEqual(p.accent, '#FF3D8A'); assert.strictEqual(p.alerts, 'pill');
  assert.strictEqual(serialize(p), CLIENT);
});

test('player.cfg: пределы как в клиенте, мусор отбрасывается', () => {
  const p = parse('graphics.draw_distance = 999\nvoice.threshold = 1\nvoice.key = 300\nui.accent = red\nui.alerts = big\nvoice.mode = shout\ndownloads.keep_days = OFF\n');
  assert.strictEqual(p.drawDistance, 200); assert.strictEqual(p.voiceThreshold, 5); assert.strictEqual(p.voiceKey, 255);
  assert.strictEqual(p.accent, ''); assert.strictEqual(p.alerts, ''); assert.strictEqual(p.voiceMode, 'key'); assert.strictEqual(p.keepDays, -1);
  const s = sanitize({ fpsLimit: 77, micVolume: 999, accent: '#abcdef', bogus: 1, consoleSkin: 'neon', keepDays: 7 }, DEFAULTS);
  assert.strictEqual(s.fpsLimit, -1, 'только значения из списка F1'); assert.strictEqual(s.micVolume, 200); assert.strictEqual(s.accent, '#ABCDEF');
  assert.strictEqual(s.consoleSkin, ''); assert.strictEqual(s.keepDays, 7); assert.ok(!('bogus' in s));
});

test('player.cfg: запись в папку и сброс групп', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l4cfg-'));
  const c = createPlayerCfg({ dir });
  assert.strictEqual(c.read().exists, false);
  c.write({ voiceKey: 66, chatKey: 84, accent: '#10B981', discord: false });
  const r = c.read(); assert.strictEqual(r.voiceKey, 66); assert.strictEqual(r.discord, false); assert.strictEqual(r.exists, true);
  assert.match(fs.readFileSync(path.join(dir, 'player.cfg'), 'utf8'), /voice\.key = 66\n/);
  const k = c.reset('keys'); assert.strictEqual(k.voiceKey, 0); assert.strictEqual(k.chatKey, 0); assert.strictEqual(k.accent, '#10B981');
  const l = c.reset('look'); assert.strictEqual(l.accent, ''); assert.strictEqual(l.discord, false, 'сброс внешнего вида не трогает остальное');
});

test('settings.xml GTA V: меняется только значение атрибута', () => {
  const docs = fs.mkdtempSync(path.join(os.tmpdir(), 'l4gta-'));
  const dir = path.join(docs, 'Rockstar Games', 'GTA V'); fs.mkdirSync(dir, { recursive: true });
  const xml = '﻿<?xml version="1.0" encoding="UTF-8"?>\r\n<Settings>\r\n  <video>\r\n    <ScreenWidth value="1920" />\r\n    <ScreenHeight value="1080" />\r\n    <Windowed value="0" />\r\n    <VSync value="1" />\r\n  </video>\r\n</Settings>\r\n';
  fs.writeFileSync(path.join(dir, 'settings.xml'), xml, 'utf8');
  const g = createGtaSettings({ documents: docs });
  assert.deepStrictEqual([g.read().windowMode, g.read().vsync, g.read().resolution], ['fullscreen', true, '1920×1080']);
  g.write({ windowMode: 'borderless', vsync: false });
  const after = fs.readFileSync(path.join(dir, 'settings.xml'), 'utf8');
  assert.strictEqual(after, xml.replace('<Windowed value="0" />', '<Windowed value="2" />').replace('<VSync value="1" />', '<VSync value="0" />'));
  assert.ok(fs.existsSync(path.join(dir, 'settings.xml.4one-backup')));
});
