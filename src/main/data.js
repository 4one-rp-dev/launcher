'use strict';
const { fail, ok } = require('../core/contract');
const config = require('./config');

/** Адрес host:port -> { host, port } */
function splitAddr(a) { const m = /^([^:\s]+):(\d{1,5})$/.exec(String(a || '')); return m ? { host: m[1], port: Number(m[2]) } : null; }

/**
 * Живой статус игрового сервера: онлайн и максимум — из /info платформы (порт +20), пинг — время ответа.
 * Если /info молчит, пробуем вход (порт +10): открыт — сервер жив, но без счётчика; закрыт — «недоступен».
 */
async function probeServer(server, deps) {
  const a = splitAddr(server.address); if (!a) return server;
  const G = config.game; const doFetch = deps.fetch || globalThis.fetch;
  const t0 = Date.now();
  try {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 3500);
    const r = await doFetch(`http://${a.host}:${a.port + G.infoPortOffset}/info`, { signal: ctl.signal, headers: { Accept: 'application/json' } }).finally(() => clearTimeout(timer));
    if (r.ok) {
      const j = await r.json();
      const live = { ping: Date.now() - t0, live: true };
      if (Number.isFinite(j.players)) live.online = j.players;
      if (Number.isFinite(j.maxPlayers) && j.maxPlayers > 0) live.max = j.maxPlayers;
      if (server.status !== 'maintenance') live.status = 'online';
      return Object.assign({}, server, live);
    }
  } catch (_) { /* нет ответа — проверим вход */ }
  const ping = deps.tcpPing ? await deps.tcpPing(`${a.host}:${a.port + G.gatePortOffset}`, 3000) : null;
  if (ping != null) return Object.assign({}, server, { ping, live: true, status: server.status === 'maintenance' ? 'maintenance' : 'online' });
  return Object.assign({}, server, { ping: null, live: true, online: 0, status: server.status === 'maintenance' ? 'maintenance' : 'offline' });
}

/** Серверы, новости, клиент: bootstrap с кэшем и запасным вариантом, если сети нет */
function createData(deps) {
  const { backend, auth, settings, log } = deps;
  let cache = null; let at = 0; let live = {}; // live — последний опрос серверов по id
  const TTL = 60 * 1000;

  async function probeAll(servers) {
    const probe = deps.probe || probeServer;
    const res = await Promise.all(servers.map((s) => probe(s, deps).catch(() => s)));
    live = {}; for (const s of res) live[s.id] = s;
  }

  function view(d, stale) {
    const base = d.servers && d.servers.length ? d.servers : [Object.assign({ status: 'offline', online: 0, version: '', description: '' }, config.game.fallbackServer)];
    const servers = base.map((s) => (live[s.id] ? Object.assign({}, s, pick(live[s.id])) : s));
    let sel = settings.get().selectedServerId;
    if (!servers.find((s) => s.id === sel)) sel = servers[0].id;
    const flags = d.flags || {};
    if (deps.onLinks) deps.onLinks(flags.links);
    return {
      servers, news: d.news || [], client: d.client || null, flags, links: deps.linkKeys ? Object.keys(deps.linkKeys()) : null,
      notice: d.notice || null, selectedServerId: sel, fetchedAt: at, stale: !!stale,
    };
  }

  return {
    async bootstrap(force) {
      if (!force && cache && Date.now() - at < TTL) return ok(view(cache, false));
      const r = await backend.bootstrap();
      if (!r.ok) {
        auth.onFatal(r.code);
        await probeAll((cache && cache.servers && cache.servers.length) ? cache.servers : [config.game.fallbackServer]);
        if (cache) return ok(view(cache, true));
        return ok(view({}, true)); // Core API недоступен: сервер по умолчанию с живым статусом, играть можно
      }
      cache = r.data; at = Date.now();
      await probeAll(r.data.servers || []);
      if (r.data.profile) auth.setProfile(r.data.profile);
      log.info('data', `bootstrap: серверов ${r.data.servers.length}, новостей ${r.data.news.length}`);
      return ok(view(cache, false));
    },
    async selectServer(id) {
      await settings.set({ selectedServerId: id });
      return ok({ selectedServerId: id });
    },
    selected() {
      const v = view(cache || {}, false);
      return v.servers.find((s) => s.id === v.selectedServerId) || null;
    },
    clientInfo() { return cache && cache.client || null; },
  };
}

const pick = (s) => ({ status: s.status, online: s.online, max: s.max, ping: s.ping, live: s.live });

function createCodes(deps) {
  const { backend, auth, log } = deps;
  return {
    async redeem(code) {
      if (!auth.token()) return fail('invalid_session');
      const r = await backend.redeemCode(code);
      if (!r.ok) { auth.onFatal(r.code); return r; }
      log.info('codes', 'код активирован');
      return ok(r.data);
    },
    async history() {
      if (!auth.token()) return fail('invalid_session');
      const r = await backend.codesHistory();
      if (!r.ok) auth.onFatal(r.code);
      return r;
    },
  };
}

/** Раздел «Аккаунт»: сессии, история входов, кошелёк, персонажи — всё из Core API. */
function createAccount(deps) {
  const { backend, auth } = deps;
  const EMPTY = { security: { emailVerified: false, twoFactor: false, passwordSet: false, links: [] }, wallet: { balance: 0, items: [] } };
  async function op(name, extra, fallback) {
    if (!auth.token()) return fail('invalid_session');
    const r = await backend.account(name, extra);
    if (!r.ok) { auth.onFatal(r.code); return r; }
    return ok(r.data == null ? fallback : (Array.isArray(fallback) && !Array.isArray(r.data) ? (r.data.items || fallback) : r.data));
  }
  return {
    security: () => op('security', null, EMPTY.security),
    sessions: () => op('sessions', null, []),
    revokeSession: (id) => op('revoke', { id }, {}),
    revokeOthers: () => op('revokeOthers', null, {}),
    history: () => op('history', null, []),
    wallet: () => op('wallet', null, EMPTY.wallet),
    characters: () => op('characters', null, []),
  };
}

module.exports = { createData, createCodes, createAccount, probeServer, splitAddr };
