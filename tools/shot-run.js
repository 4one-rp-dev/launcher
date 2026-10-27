'use strict';
/**
 * Электрон-процесс для скриншотов (запускается из tools/shots.js).
 * env: L4_SHOT_OUT (папка), L4_SHOT_PLAN (JSON: [{name, route?, js?, wait?}]), L4_MOCK_SCENARIO.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow } = require('electron');

process.env.L4_MOCK = '1';
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'l4shot-')));
app.getVersion = () => require('../package.json').version;
require('../src/main/index.js');

const out = process.env.L4_SHOT_OUT || path.join(__dirname, '..', 'shots');
const plan = JSON.parse(process.env.L4_SHOT_PLAN || '[]');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  let win = null;
  for (let i = 0; i < 100 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; await sleep(100); }
  if (!win) { console.error('нет окна'); app.exit(2); return; }
  fs.mkdirSync(out, { recursive: true });
  const wc = win.webContents;
  await new Promise((r) => (wc.isLoading() ? wc.once('did-finish-load', r) : r()));
  await sleep(1400);
  for (const step of plan) {
    try {
      if (step.route) await wc.executeJavaScript(`window.__l4.go(${JSON.stringify(step.route)}, true)`);
      if (step.js) await wc.executeJavaScript(step.js);
      await sleep(step.wait || 1000);
      const img = await wc.capturePage();
      fs.writeFileSync(path.join(out, step.name + '.png'), img.toPNG());
      console.log('shot', step.name);
    } catch (e) { console.error('fail', step.name, e.message); }
  }
  app.exit(0);
});
