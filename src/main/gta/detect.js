'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const config = require('../config');
const { readFileVersion } = require('./pe-version');

const G = config.game;

function defaultExec(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 8000 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

/** Значение из вывода `reg query KEY /v NAME` */
function parseRegValue(out, name) {
  const m = new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+?)\\s*$`, 'mi').exec(out || '');
  return m ? m[1] : '';
}

/** Пути библиотек Steam из libraryfolders.vdf */
function parseLibraryFolders(text) {
  const out = [];
  const re = /"path"\s+"([^"]+)"/g; let m;
  while ((m = re.exec(text || ''))) out.push(m[1].replace(/\\\\/g, '\\'));
  return out;
}

/** Каталоги Epic: *.item манифесты с AppName GTA V */
function parseEpicItem(text) {
  try {
    const j = JSON.parse(text);
    if (j && j.AppName === G.epicAppId && j.InstallLocation) return j.InstallLocation;
  } catch (_) { /* не JSON */ }
  return '';
}

/** Проверка папки: есть ли GTA5.exe (Legacy) или GTA5_Enhanced.exe, какая версия */
function inspectDir(dir, source, deps) {
  const d = deps || {};
  const exists = d.exists || fs.existsSync;
  const ver = d.version || readFileVersion;
  if (!dir) return null;
  const legacyExe = path.join(dir, G.exe);
  const enhExe = path.join(dir, G.enhancedExe);
  const hasLegacy = exists(legacyExe);
  const hasEnh = exists(enhExe);
  if (!hasLegacy && !hasEnh) return null;
  const version = hasLegacy ? (ver(legacyExe) || '') : '';
  return {
    dir, source: source || 'manual',
    exe: hasLegacy ? legacyExe : enhExe,
    hasLegacy, hasEnhanced: hasEnh,
    version,
    // Legacy нужной версии; если версию прочитать не удалось — считаем «неизвестной», не блокируем
    isSupported: hasLegacy && (version === G.legacyVersion),
    versionMismatch: hasLegacy && !!version && version !== G.legacyVersion,
    enhancedOnly: !hasLegacy && hasEnh,
  };
}

/** Поиск установленной GTA V: реестр Rockstar, Steam, Epic, типовые папки. Первый поддерживаемый побеждает. */
async function detectGta(opts) {
  const o = opts || {};
  const platform = o.platform || process.platform;
  const exec = o.exec || defaultExec;
  const readFile = o.readFile || ((f) => { try { return fs.readFileSync(f, 'utf8'); } catch (_) { return ''; } });
  const readdir = o.readdir || ((d) => { try { return fs.readdirSync(d); } catch (_) { return []; } });
  const env = o.env || process.env;
  const cands = [];

  if (o.manualPath) cands.push({ dir: o.manualPath, source: 'manual' });

  if (platform === 'win32') {
    const regKeys = [
      ['HKLM\\SOFTWARE\\WOW6432Node\\Rockstar Games\\Grand Theft Auto V', 'InstallFolder', 'rockstar'],
      ['HKLM\\SOFTWARE\\WOW6432Node\\Rockstar Games\\Grand Theft Auto V', 'InstallFolderSteam', 'steam'],
      ['HKLM\\SOFTWARE\\WOW6432Node\\Rockstar Games\\Grand Theft Auto V', 'InstallFolderEpic', 'epic'],
      ['HKLM\\SOFTWARE\\Rockstar Games\\Grand Theft Auto V', 'InstallFolder', 'rockstar'],
    ];
    for (const [key, name, src] of regKeys) {
      const v = parseRegValue(await exec('reg', ['query', key, '/v', name]), name);
      if (v) cands.push({ dir: v.replace(/[\\/]+$/, ''), source: src });
    }
    // Steam: путь клиента -> libraryfolders.vdf
    const steam = parseRegValue(await exec('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath']), 'SteamPath');
    if (steam) {
      const base = steam.replace(/\//g, '\\');
      const libs = [base, ...parseLibraryFolders(readFile(path.win32.join(base, 'steamapps', 'libraryfolders.vdf')))];
      for (const lib of libs) cands.push({ dir: path.win32.join(lib, 'steamapps', 'common', 'Grand Theft Auto V'), source: 'steam' });
    }
    // Epic
    const pd = env.ProgramData || 'C:\\ProgramData';
    const mdir = path.win32.join(pd, 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
    for (const f of readdir(mdir)) {
      if (!f.endsWith('.item')) continue;
      const loc = parseEpicItem(readFile(path.win32.join(mdir, f)));
      if (loc) cands.push({ dir: loc, source: 'epic' });
    }
    // Типовые папки
    for (const p of ['C:\\Program Files\\Rockstar Games\\Grand Theft Auto V', 'C:\\Program Files (x86)\\Rockstar Games\\Grand Theft Auto V',
      'D:\\Games\\Grand Theft Auto V', 'D:\\Rockstar Games\\Grand Theft Auto V']) cands.push({ dir: p, source: 'rockstar' });
  }

  const seen = new Set(); const found = [];
  for (const c of cands) {
    const key = String(c.dir).toLowerCase();
    if (seen.has(key)) continue; seen.add(key);
    const r = inspectDir(c.dir, c.source, o);
    if (r) found.push(r);
  }
  const best = found.find((f) => f.isSupported) || found.find((f) => f.hasLegacy) || found[0] || null;
  return { best, all: found };
}

module.exports = { detectGta, inspectDir, parseRegValue, parseLibraryFolders, parseEpicItem };
