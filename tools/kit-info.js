#!/usr/bin/env node
'use strict';
/**
 * Описание комплекта клиента для Core API (core_settings, ключ `client`).
 *   node tools/kit-info.js <комплект.zip> <версия> <https-ссылка на архив>
 * Печатает JSON и готовый SQL. Архив собирается из папки client-b3889 пакета сервера (там же server.txt с адресом);
 * при смене версии платформы или ключа проекта нужен новый комплект и новая запись.
 */
const fs = require('fs');
const crypto = require('crypto');

const [zip, version, url] = process.argv.slice(2);
if (!zip || !version || !/^https:\/\//i.test(url || '')) {
  console.error('Использование: node tools/kit-info.js <комплект.zip> <версия> <https-ссылка>');
  process.exit(2);
}
const size = fs.statSync(zip).size;
const h = crypto.createHash('sha256');
fs.createReadStream(zip).on('data', (d) => h.update(d)).on('end', () => {
  const info = { version, kitUrl: url, kitSha256: h.digest('hex'), kitSize: size, notes: '' };
  const json = JSON.stringify(info);
  console.log(json);
  console.log(`\nINSERT INTO core_settings (k, v) VALUES ('client', '${json.replace(/'/g, "''")}') ON DUPLICATE KEY UPDATE v = VALUES(v);`);
});
