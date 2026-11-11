'use strict';
const path = require('path');
const os = require('os');

/**
 * Раскладка файлов у игрока — как у RMRP: всё в одной папке, которую выбирает установщик лаунчера.
 *
 *   <корень>\                 по умолчанию C:\4ONE RP
 *     Launcher\               лаунчер (сюда ставит установщик NSIS)
 *     Game\                   клиент платформы: FloVMP.exe install --dir <корень>\Game
 *     Game\data\              моды серверов, кэш, журналы, настройки F1: --data-dir (на старом месте
 *                             %LOCALAPPDATA%\FloVMP платформа оставляет junction — клиент в игре находит всё как раньше)
 *     Game\.4one\kit\         скачанный лаунчером комплект клиента
 *
 * Корень — родитель папки «Launcher». Если лаунчер стоит не в «…\Launcher» (старые установки, разработка), корень —
 * %LOCALAPPDATA%\4ONE RP: игру НЕЛЬЗЯ класть внутрь папки программы — обновление лаунчера её очищает.
 */
function resolveLayout(opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const p = o.path || path.win32;
  const exeDir = p.dirname(o.execPath || process.execPath);
  const local = env.LOCALAPPDATA || p.join(os.homedir(), 'AppData', 'Local');
  const own = !!o.packaged && p.basename(exeDir).toLowerCase() === 'launcher';
  const root = env.L4_ROOT || (own ? p.dirname(exeDir) : p.join(local, '4ONE RP'));
  const game = p.join(root, 'Game');
  return { root, own, launcher: own ? exeDir : '', game, data: p.join(game, 'data'), kit: p.join(game, '.4one', 'kit') };
}

/** Клиент установлен в нашей раскладке? (сравнение путей без учёта регистра и хвостовых «\») */
function sameDir(a, b) {
  const n = (s) => String(s || '').replace(/[\\/]+$/, '').toLowerCase();
  return !!a && !!b && n(a) === n(b);
}

module.exports = { resolveLayout, sameDir };
