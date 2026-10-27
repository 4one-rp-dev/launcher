'use strict';
const { execFile } = require('child_process');

/**
 * Если GTA V стоит в Program Files, запись туда без прав недоступна. Один раз (с запросом UAC)
 * выдаём текущему пользователю право «Изменение» на папку игры через icacls — дальше всё без прав администратора.
 * Так было в старом лаунчере (icacls /grant <user>:(OI)(CI)M).
 */
function grantModify(dir) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(false);
    const user = `${process.env.USERDOMAIN || ''}\\${process.env.USERNAME || ''}`.replace(/^\\/, '');
    const esc = (s) => String(s).replace(/'/g, "''");
    const argList = `'\"${esc(dir)}\"','/grant','\"${esc(user)}:(OI)(CI)M\"','/T','/C'`;
    const ps = `Start-Process -FilePath icacls.exe -ArgumentList ${argList} -Verb RunAs -WindowStyle Hidden -Wait`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 120000 }, (err) => resolve(!err));
  });
}

module.exports = { grantModify };
