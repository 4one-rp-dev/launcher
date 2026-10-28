const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { createPlatform, PlatformError, brand, stageOf } = require('../src/main/client/platform');
const { ERRORS } = require('../src/core/contract');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'l4-plat-'));
const log = { warn() {}, info() {}, error() {} };

/** Поддельный установщик: пишет статусы в play-status.json и завершается с заданным кодом. */
function fakeSpawn(dataDir, script, exitCode) {
  const calls = [];
  const fn = (exe, args, opts) => {
    calls.push({ exe, args, env: opts.env });
    const ch = new EventEmitter(); ch.stdout = new EventEmitter(); ch.stderr = new EventEmitter(); ch.pid = 4242;
    (async () => {
      for (const s of script) {
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(path.join(dataDir, 'play-status.json'), JSON.stringify(Object.assign({ format: 1, time: Math.floor(Date.now() / 1000) + 1 }, s)));
        await new Promise((r) => setTimeout(r, 30));
      }
      ch.emit('close', exitCode);
    })();
    return ch;
  };
  fn.calls = calls; return fn;
}

test('connect: аргументы, окружение и ход работы из play-status.json', async () => {
  const dataDir = tmp();
  const sp = fakeSpawn(dataDir, [
    { stage: 'update', state: 'running', done: 10, total: 100, percent: 10 },
    { stage: 'mods', state: 'running', done: 50, total: 100, percent: 50, detail: 'stream/car.ytd' },
    { stage: 'launch', state: 'done', exitCode: 0 },
  ], 0);
  const p = createPlatform({ log, dataDir, spawn: sp, pollMs: 10, platform: 'win32' });
  const seen = [];
  const r = await p.connect('C:/k/FloVMP.exe', '1.2.3.4:7788', 'Ivan_Petrov', { gtaDir: 'D:/GTA', onProgress: (s) => seen.push(s.stage) });
  assert.strictEqual(r.exitCode, 0);
  assert.deepStrictEqual(sp.calls[0].args, ['connect', '1.2.3.4:7788', '--name', 'Ivan_Petrov', '--silent']);
  assert.strictEqual(sp.calls[0].env.FLOVMP_NONINTERACTIVE, '1');
  assert.strictEqual(sp.calls[0].env.FLOVMP_GTA_PATH, 'D:/GTA');
  assert.ok(seen.includes('mods') && seen.includes('update'), 'ход работы доходит до лаунчера');
});

test('ошибки: код выхода и код каталога -> код лаунчера, все коды есть в ERRORS', async () => {
  const dataDir = tmp();
  const cases = [[7, '', 'no_write_access'], [8, '', 'disk_full'], [3, 'FLV-3002', 'gta_wrong_version'], [5, 'FLV-6009', 'client_no_connection'],
    [5, 'FLV-6002', 'client_corrupted'], [10, 'FLV-2009', 'client_signature'], [4, 'FLV-6003', 'scripthook_failed'], [11, 'FLV-6008', 'launch_failed'], [1, '', 'client_install_failed']];
  for (const [exit, flv, want] of cases) {
    const p = createPlatform({ log, dataDir, spawn: fakeSpawn(dataDir, [{ stage: 'check', state: 'error', code: flv, detail: 'FloV:MP сообщил', exitCode: exit }], exit), pollMs: 10, platform: 'win32' });
    await assert.rejects(p.install('C:/k/FloVMP.exe', {}), (e) => { assert.ok(e instanceof PlatformError); assert.strictEqual(e.code, want); assert.ok(ERRORS[e.code], e.code); assert.ok(!/flov/i.test(e.detail), 'имя платформы не утекает'); return true; });
  }
});

test('отказ игрока от ссылки (cancelled) — не ошибка', async () => {
  const dataDir = tmp();
  const p = createPlatform({ log, dataDir, spawn: fakeSpawn(dataDir, [{ stage: 'check', state: 'cancelled' }], 0), pollMs: 10, platform: 'win32' });
  const r = await p.connect('x', '1.2.3.4:7788', '', {});
  assert.strictEqual(r.status.state, 'cancelled');
});

test('статус от прошлого запуска игнорируется', async () => {
  const dataDir = tmp();
  fs.writeFileSync(path.join(dataDir, 'play-status.json'), JSON.stringify({ format: 1, stage: 'mods', state: 'running', time: 1000 }));
  const sp = (exe, args, opts) => { const ch = new EventEmitter(); ch.stdout = new EventEmitter(); ch.stderr = new EventEmitter(); setTimeout(() => ch.emit('close', 0), 60); return ch; };
  const p = createPlatform({ log, dataDir, spawn: sp, pollMs: 10, platform: 'win32' });
  const seen = []; await p.verify('x', { onProgress: (s) => seen.push(s) });
  assert.strictEqual(seen.length, 0);
});

test('отмена через signal останавливает установщик', async () => {
  const dataDir = tmp(); const killed = [];
  const sp = () => { const ch = new EventEmitter(); ch.stdout = new EventEmitter(); ch.stderr = new EventEmitter(); ch.pid = 7; ch.kill = () => { killed.push(1); setTimeout(() => ch.emit('close', 1), 5); }; return ch; };
  const p = createPlatform({ log, dataDir, spawn: sp, pollMs: 10, platform: 'linux' });
  const ac = new AbortController(); setTimeout(() => ac.abort(), 30);
  await assert.rejects(p.install('x', { signal: ac.signal }), (e) => e.code === 'cancelled');
  assert.strictEqual(killed.length, 1);
});

test('status: JSON установщика; installedExe читает реестр', async () => {
  const dir = tmp(); fs.writeFileSync(path.join(dir, 'FloVMP.exe'), 'x');
  const execFile = (cmd, args, o, cb) => {
    if (cmd === 'reg') return cb(null, `\r\nHKEY_CURRENT_USER\\Software\\FloVMP\r\n    InstallDir    REG_SZ    ${dir}\r\n`);
    return cb(null, JSON.stringify({ installed: true, clientVersion: '1.1.1', gtaDir: 'D:/GTA' }));
  };
  const p = createPlatform({ log, dataDir: tmp(), execFile, platform: 'win32' });
  assert.strictEqual(await p.installedExe(), path.join(dir, 'FloVMP.exe'));
  const s = await p.status(path.join(dir, 'FloVMP.exe'));
  assert.strictEqual(s.clientVersion, '1.1.1');
});

test('describe: тексты каталога ошибок без имени платформы', () => {
  const dir = tmp(); fs.writeFileSync(path.join(dir, 'FloVMP.exe'), 'x');
  fs.writeFileSync(path.join(dir, 'error-catalog.json'), JSON.stringify({ errors: [{ code: 'FLV-6009', title: 'FloV:MP не скачался', text: 'Запустите FloVMP.exe снова', steps: ['Проверьте FloV:MP'] }] }));
  const p = createPlatform({ log, dataDir: tmp(), platform: 'win32' });
  const d = p.describe(path.join(dir, 'FloVMP.exe'), 'FLV-6009');
  assert.strictEqual(d.title, '4ONE не скачался'); assert.strictEqual(d.text, 'Запустите 4ONE снова'); assert.deepStrictEqual(d.steps, ['Проверьте 4ONE']);
  assert.strictEqual(p.describe(path.join(dir, 'FloVMP.exe'), 'FLV-0000'), null);
});

test('brand и stageOf', () => {
  assert.strictEqual(brand('FloV:MP, flovmp://x и FloVMP.exe'), '4ONE, 4one://x и 4ONE');
  assert.strictEqual(stageOf('update'), 'client'); assert.strictEqual(stageOf('mods'), 'mods'); assert.strictEqual(stageOf('switch'), 'launch'); assert.strictEqual(stageOf('zzz'), 'client');
});
