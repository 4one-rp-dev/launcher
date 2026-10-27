'use strict';
const { fail, ok } = require('../core/contract');
const config = require('./config');

/** Серверы, новости, клиент: bootstrap с кэшем и запасным вариантом, если сети нет */
function createData(deps) {
  const { backend, auth, settings, log } = deps;
  let cache = null; let at = 0;
  const TTL = 60 * 1000;

  function view(d, stale) {
    const servers = d.servers && d.servers.length ? d.servers : [Object.assign({ status: 'offline', online: 0, version: '', description: '' }, config.game.fallbackServer)];
    let sel = settings.get().selectedServerId;
    if (!servers.find((s) => s.id === sel)) sel = servers[0].id;
    return {
      servers, news: d.news || [], client: d.client || null, flags: d.flags || {},
      notice: d.notice || null, selectedServerId: sel, fetchedAt: at, stale: !!stale,
    };
  }

  return {
    async bootstrap(force) {
      if (!force && cache && Date.now() - at < TTL) return ok(view(cache, false));
      const r = await backend.bootstrap();
      if (!r.ok) {
        auth.onFatal(r.code);
        if (cache) return ok(view(cache, true));
        return r.code === 'network_error' || r.code === 'timeout' ? r : ok(view({}, true));
      }
      cache = r.data; at = Date.now();
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

module.exports = { createData, createCodes, createAccount };
