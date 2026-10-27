'use strict';
/** Локальный предпросмотр в браузере (мок-данные): npm run preview -> http://localhost:4173/#ready */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const r = spawnSync(process.execPath, [path.join(__dirname, 'preview-bundle.js')], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status);
const file = path.join(__dirname, '..', 'dist-preview', 'index.html');
const port = Number(process.env.PORT) || 4173;
http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`http://localhost:${port}/#ready  (сценарии: #login #ready #not-installed #update #no-gta #downloading #ingame #offline)`));
