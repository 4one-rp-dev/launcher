'use strict';
/** Скриншоты всех экранов и состояний в демо-режиме: npm run shots (нужен xvfb на Linux). */
const { spawnSync } = require('child_process');
const path = require('path');
const root = path.join(__dirname, '..');
const out = process.env.L4_SHOT_OUT || path.join(root, 'shots');
const electron = require('electron');

const EN_JS = "window.dispatchEvent(new CustomEvent('l4:lang',{detail:'en'}))";
const MAIN = ['home', 'news', 'codes', 'account', 'settings'].map((r) => ({ name: 'ready-' + r, route: r }));
const RUNS = [
  { scenario: 'login', plan: [
    { name: 'login' },
    { name: 'login-error', js: "(()=>{const i=document.querySelector('#code');i.value='WRONG123';i.dispatchEvent(new Event('input'));document.querySelector('#go').click()})()", wait: 1400 },
  ] },
  { scenario: 'ready', plan: MAIN.concat([
    { name: 'codes-redeemed', route: 'codes', js: "(()=>{const i=document.querySelector('#code');i.value='WELCOME4';document.querySelector('#go').click()})()", wait: 1600 },
    { name: 'settings-confirm', route: 'settings', js: "document.querySelector('[data-act=uninstall]').click()", wait: 600 },
  ]) },
  // английский: язык переключается тем же событием, что и кнопка в интерфейсе
  { scenario: 'login', plan: [{ name: 'en-login', js: EN_JS, wait: 500 }] },
  { scenario: 'ready', plan: [{ name: 'en-home', route: 'home', js: EN_JS, wait: 700 }].concat(['news', 'codes', 'account', 'settings'].map((r) => ({ name: 'en-' + r, route: r }))) },
  { scenario: 'not-installed', plan: [{ name: 'home-not-installed', route: 'home' }] },
  { scenario: 'update', plan: [{ name: 'home-update', route: 'home' }] },
  { scenario: 'no-gta', plan: [{ name: 'home-no-gta', route: 'home' }] },
  { scenario: 'enhanced', plan: [{ name: 'home-enhanced', route: 'home' }] },
  { scenario: 'downloading', frozen: true, plan: [{ name: 'home-downloading', route: 'home' }] },
  { scenario: 'ingame', plan: [{ name: 'home-ingame', route: 'home' }] },
  { scenario: 'offline', plan: [{ name: 'home-offline', route: 'home' }] },
];
const only = process.argv[2];
let bad = 0;
for (const run of RUNS) {
  if (only && run.scenario !== only) continue;
  const args = [electron, '--no-sandbox', path.join(__dirname, 'shot-run.js')];
  const isLinux = process.platform === 'linux';
  const cmd = isLinux ? 'xvfb-run' : args.shift();
  const argv = isLinux ? ['-a', '-s', '-screen 0 1400x900x24'].concat(args) : args;
  const r = spawnSync(cmd, argv, {
    stdio: 'inherit', timeout: 90000,
    env: Object.assign({}, process.env, { L4_MOCK_SCENARIO: run.scenario, L4_MOCK_FROZEN: run.frozen ? '1' : '', L4_SHOT_OUT: out, L4_SHOT_PLAN: JSON.stringify(run.plan) }),
  });
  if (r.status !== 0) { bad++; console.error('сценарий не снят:', run.scenario, r.status); }
}
process.exit(bad ? 1 : 0);
