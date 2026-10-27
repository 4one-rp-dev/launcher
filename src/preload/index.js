'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Sandboxed-preload не может require() соседние файлы — списки продублированы.
// Синхронность с core/contract.js проверяет test/preload.test.js.
const CHANNELS = [
  'app:info', 'app:openExternal', 'app:openPath', 'app:copyDiagnostics',
  'win:minimize', 'win:toggleMaximize', 'win:close',
  'auth:status', 'auth:login', 'auth:cancel', 'auth:logout',
  'data:bootstrap',
  'servers:select',
  'game:state', 'game:detect', 'game:browse', 'game:setPath',
  'game:install', 'game:verify', 'game:play', 'game:cancel', 'game:uninstall',
  'codes:redeem', 'codes:history',
  'account:security', 'account:sessions', 'account:revokeSession', 'account:revokeOthers', 'account:history', 'account:wallet', 'account:characters',
  'settings:get', 'settings:set', 'settings:reset',
  'update:check', 'update:download', 'update:install',
];
const EVENTS = ['auth:changed', 'game:state', 'update:state', 'net:state', 'deeplink', 'toast'];

/**
 * Единственный мост между интерфейсом и main. Наружу — только allowlist каналов из core/contract.js.
 * В интерфейсе: await window.l4.call('auth:status'); const off = window.l4.on('game:state', fn);
 */
contextBridge.exposeInMainWorld('l4', {
  platform: process.platform,
  call: (channel, ...args) => {
    if (!CHANNELS.includes(channel)) return Promise.resolve({ ok: false, code: 'bad_request', message: 'Неизвестный канал' });
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (event, cb) => {
    if (!EVENTS.includes(event) || typeof cb !== 'function') return () => {};
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on(event, fn);
    return () => ipcRenderer.removeListener(event, fn);
  },
});
