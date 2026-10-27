'use strict';
/** Общий стенд для тестов: настоящий Core API (память) + fetch, вызывающий его обработчик напрямую, без сокетов. */
const { Readable } = require('stream');
const { createOAuthClient } = require('../src/main/api/oauth');
const { createBackend } = require('../src/main/api/backend');
const { createCoreApi } = require('../src/main/api/core');
const { createAuth } = require('../src/main/session');
const { createData, createCodes, createAccount } = require('../src/main/data');
const { load } = require('../backend/core-api/src/config');
const { createMemoryStore } = require('../backend/core-api/src/store');
const { createApp } = require('../backend/core-api/src/server');
const { hashPassword } = require('../backend/core-api/src/passwords');
const assert = require('node:assert');

const BASE = 'http://core.test';

/** fetch, который вызывает обработчик Core API напрямую: без сокетов и сети. */
function coreFetch(handler) {
  return async (url, init = {}) => {
    const u = new URL(url); const headers = {};
    for (const [k, v] of Object.entries(init.headers || {})) headers[k.toLowerCase()] = v;
    const body = init.body instanceof URLSearchParams ? init.body.toString() : init.body;
    const r = await new Promise((resolve) => {
      const req = Readable.from(body ? [Buffer.from(body)] : []);
      Object.assign(req, { method: init.method || 'GET', url: u.pathname + u.search, headers, socket: { remoteAddress: '127.0.0.1' } });
      handler(req, { headersSent: false, writeHead(s, h) { this.status = s; this.h = h; this.headersSent = true; }, end(p) { resolve({ status: this.status, text: p || '' }); } });
    });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => JSON.parse(r.text), text: async () => r.text };
  };
}

function seed() {
  return {
    accounts: [
      { login: 'marcus', email: 'm@x.io', passwordHash: hashPassword('Secret-1', 1000), socialClub: 'MarcusSC', redbucks: 1200, lastAt: '2026-10-26T20:00:00Z', characters: [{ id: 1, name: 'Marcus Reed', level: 7, cash: 4800, bank: 31000 }] },
      { login: 'boss', email: 'b@x.io', passwordHash: hashPassword('Boss-pass', 1000), socialClub: 'BossSC', redbucks: 50 },
    ],
    alvl: { BossSC: 5 },
    servers: [
      { id: 'main', name: '4ONE RP', tag: 'MAIN', status: 'online', online: 37, max_players: 500, address: '127.0.0.1:22005', version: '1.0.3889.0', description: 'Основной', recommended: true, sort: 1 },
      { id: 'bad', name: 'Битый адрес', status: 'online', address: 'no port here', sort: 2 },
    ],
    news: [{ title: 'Обновление 1.4', excerpt: 'Семьи и особняки', category: 'updates', date: '2026-10-18' }],
    settings: { client: JSON.stringify({ version: '1.0.7', manifestUrl: 'https://cdn.example/client/manifest.json' }), notice: 'Техработы в 04:00' },
    promos: [{ code: 'WELCOME4', title: 'Приветственный бонус', amount: 100 }, { code: 'OLD00000', title: 'Старый', amount: 5, expiresAt: '2026-01-01T00:00:00Z' }],
  };
}

function world(opts = {}) {
  const config = { ...load({ CORE_STORE: 'memory', CORE_PUBLIC_URL: BASE }) };
  const store = createMemoryStore(seed());
  const { handler } = createApp({ store, config, now: opts.now });
  const fetch = opts.fetch ? opts.fetch(coreFetch(handler)) : coreFetch(handler);
  const log = { info() {}, warn() {}, error() {} };
  const oauth = createOAuthClient({ url: BASE, fetch, log });
  let authRef = null;
  const core = createCoreApi({ url: BASE, fetch, log, getToken: () => (authRef ? authRef.freshToken() : null) });
  const backend = createBackend(core, log);
  const events = []; const bus = { emit: (ev, p) => events.push([ev, p]) };
  let vaultData = null;
  const vault = { load: () => vaultData, save: (o) => { vaultData = JSON.parse(JSON.stringify(o)); }, clear: () => { vaultData = null; }, canEncrypt: () => true };
  const opened = [];
  const auth = createAuth({ oauth, backend, vault, bus, log, openAuth: async (url) => { opened.push(url); return { ok: true }; }, deviceName: 'Test PC', now: opts.clock });
  authRef = auth;
  const settings = { get: () => ({ selectedServerId: '' }), set: async () => ({}) };
  const data = createData({ backend, auth, settings, log });
  const codes = createCodes({ backend, auth, log });
  const account = createAccount({ backend, auth });
  return { auth, store, events, opened, vault: () => vaultData, setVault: (v) => { vaultData = v; }, fetch, oauth, handler, config, backend, core, data, codes, account };
}

/** Вход «как игрок»: открыть страницу, ввести пароль, вернуть ссылку в лаунчер. */
async function signIn(w, login, password) {
  const { parseDeepLink } = require('../src/main/protocol');
  await w.auth.login();
  const link = await browserLogin(w, w.opened[w.opened.length - 1], login, password);
  const r = await w.auth.handleCallback(parseDeepLink(link));
  assert.ok(r.ok, JSON.stringify(r));
  return w;
}

/** «Браузер»: открывает адрес из лаунчера, вводит логин и пароль на странице входа, возвращает ссылку gta4one://. */
async function browserLogin(w, url, login, password) {
  const u = new URL(url);
  const page = await w.fetch(`${BASE}${u.pathname}${u.search}`);
  assert.strictEqual(page.status, 200, 'страница входа открылась');
  const tx = /name="tx" value="([^"]+)"/.exec(await page.text())[1];
  const res = await w.fetch(`${BASE}/oauth/authorize`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ tx, login, password }) });
  const html = await res.text();
  const m = /href="(gta4one:\/\/[^"]+)"/.exec(html);
  return m ? m[1].replace(/&amp;/g, '&') : null;
}


module.exports = { BASE, coreFetch, world, browserLogin, signIn };
