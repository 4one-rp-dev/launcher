'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { resolveLayout, sameDir } = require('../src/main/layout');
const { createPlatform } = require('../src/main/client/platform');

const env = { LOCALAPPDATA: 'C:\\Users\\Ivan\\AppData\\Local' };

test('раскладка как у RMRP: корень — родитель папки Launcher', () => {
  const L = resolveLayout({ packaged: true, execPath: 'D:\\4ONE RP\\Launcher\\4ONE Launcher.exe', env });
  assert.deepStrictEqual([L.root, L.game, L.data, L.kit, L.own],
    ['D:\\4ONE RP', 'D:\\4ONE RP\\Game', 'D:\\4ONE RP\\Game\\data', 'D:\\4ONE RP\\Game\\.4one\\kit', true]);
});

test('раскладка: лаунчер не в «…\\Launcher» — игра не внутри папки программы (её очищает обновление)', () => {
  const L = resolveLayout({ packaged: true, execPath: 'C:\\Users\\Ivan\\AppData\\Local\\Programs\\4ONE Launcher\\4ONE Launcher.exe', env });
  assert.strictEqual(L.root, 'C:\\Users\\Ivan\\AppData\\Local\\4ONE RP');
  assert.ok(!L.game.toLowerCase().startsWith('c:\\users\\ivan\\appdata\\local\\programs'));
  assert.strictEqual(resolveLayout({ packaged: false, execPath: 'D:\\4ONE RP\\Launcher\\electron.exe', env }).own, false, 'разработка — не своя раскладка');
  assert.strictEqual(resolveLayout({ packaged: true, execPath: 'X:\\a\\Launcher\\b.exe', env: Object.assign({ L4_ROOT: 'E:\\Test' }, env) }).root, 'E:\\Test');
});

test('sameDir: без учёта регистра и хвостового «\\»', () => {
  assert.ok(sameDir('D:\\4ONE RP\\Game\\', 'd:\\4one rp\\game'));
  assert.ok(!sameDir('D:\\4ONE RP\\Game', 'C:\\Users\\Ivan\\AppData\\Local\\Programs\\FloVMP'));
  assert.ok(!sameDir('', ''));
});

test('platform.install передаёт --dir и --data-dir', async () => {
  const calls = [];
  const fakeSpawn = (exe, args) => {
    calls.push(args);
    const { EventEmitter } = require('events'); const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
    setImmediate(() => c.emit('close', 0)); return c;
  };
  const p = createPlatform({ log: { warn() {}, info() {} }, spawn: fakeSpawn, platform: 'win32', env, dataDir: 'C:\\nonexistent-l4', pollMs: 5 });
  await p.install('X:\\k\\FloVMP.exe', { gtaDir: 'G:\\GTA', installDir: 'D:\\4ONE RP\\Game', dataDir: 'D:\\4ONE RP\\Game\\data' });
  assert.deepStrictEqual(calls[0], ['install', '--gta-dir', 'G:\\GTA', '--dir', 'D:\\4ONE RP\\Game', '--data-dir', 'D:\\4ONE RP\\Game\\data', '--silent']);
  await p.install('X:\\k\\FloVMP.exe', { gtaDir: 'G:\\GTA' });
  assert.deepStrictEqual(calls[1], ['install', '--gta-dir', 'G:\\GTA', '--silent'], 'без раскладки — как раньше');
});
