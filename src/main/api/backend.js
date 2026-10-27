'use strict';
const { fail, ok } = require('../../core/contract');

/**
 * Прикладной слой над Core API (/v1/*): приводит ответы к форме лаунчера. Вход — main/api/oauth.js, профиль — fromCore.
 * Контракт эндпоинтов — backend/core-api/README.md и docs/API.md.
 */
function createBackend(api, log) {

  function toProfile(d) {
    d = d || {};
    const p = d.profile || d;
    return {
      authUserId: p.authUserId || p.auth_user_id || p.userId || '',
      username: p.username || p.nickname || '',
      email: p.email || '',
      nickname: p.nickname || p.username || '',
      gameName: p.gameName || p.game_name || '',
      role: p.role || 'Игрок',
      accountId: p.accountId || p.account_id || '',
      accountStatus: p.accountStatus || p.account_status || 'active',
      authMethod: p.authMethod || p.auth_method || '',
      balance4c: Number(p.balance4c != null ? p.balance4c : (p.balance != null ? p.balance : 0)) || 0,
      level: p.level != null ? p.level : null,
      faction: p.faction || '',
      hours: p.hours != null ? p.hours : null,
      launcherAccess: p.launcherAccess !== false,
    };
  }

  /**
   * Профиль из Core API (/v1/me) -> профиль лаунчера.
   * role — текст для интерфейса («Игрок» / «Администратор n уровня»), roleInfo и permissions — для вкладки администрирования.
   */
  function fromCore(me) {
    me = me || {};
    const role = me.role || {};
    const chars = Array.isArray(me.characters) ? me.characters : [];
    const main = chars.slice().sort((a, b) => (b.level || 0) - (a.level || 0))[0];
    return {
      authUserId: String(me.login || ''),
      username: String(me.login || ''),
      email: String(me.email || ''),
      nickname: String(me.login || ''),
      gameName: main ? String(main.name || '') : '',
      role: role.alvl > 0 ? `Администратор ${role.alvl} уровня` : 'Игрок',
      roleInfo: { alvl: Number(role.alvl) || 0, title: String(role.title || 'Игрок'), rank: String(role.rank || 'Игрок'), isStaff: !!role.isStaff },
      permissions: Array.isArray(me.permissions) ? me.permissions.map(String) : [],
      accountId: String(me.login || ''),
      accountStatus: ['active', 'banned', 'pending'].includes(me.accountStatus) ? me.accountStatus : 'active',
      authMethod: String(me.authMethod || ''),
      balance4c: Number(me.balance4c) || 0,
      level: main ? main.level : null,
      faction: '',
      hours: null,
      launcherAccess: true,
    };
  }

  return {
    toProfile,
    fromCore,

    /** Серверы, новости, версия клиента, объявление, флаги: публичный запрос, токен не нужен. */
    async bootstrap() {
      const r = await api.get('/v1/bootstrap', { auth: false });
      if (!r.ok) return r;
      const d = r.data || {};
      return ok({
        profile: null, // профиль — отдельно, из /v1/me (сессия)
        servers: normalizeServers(d.servers),
        news: normalizeNews(d.news),
        client: d.client || null,
        flags: d.flags || {},
        notice: d.notice || null,
      });
    },

    async redeemCode(code) { return api.post('/v1/codes/redeem', { code }); },
    async codesHistory() {
      const r = await api.get('/v1/codes/history');
      if (!r.ok) return r;
      return ok(Array.isArray(r.data) ? r.data : (r.data && r.data.items) || []);
    },

    /** Раздел «Аккаунт»: операции из контракта лаунчера -> маршруты Core API */
    async account(op, extra) {
      switch (op) {
        case 'security': case 'sessions': case 'history': case 'wallet': case 'characters': return api.get(`/v1/account/${op}`);
        case 'revoke': return api.post('/v1/account/sessions/revoke', { id: extra && extra.id });
        case 'revokeOthers': return api.post('/v1/account/sessions/revoke-others');
        default: return fail('bad_request');
      }
    },
  };
}

function normalizeServers(list) {
  const out = (Array.isArray(list) ? list : []).map((s) => ({
    id: String(s.id || s.slug || s.name),
    name: String(s.name || 'Сервер'),
    tag: s.tag || '',
    status: ['online', 'offline', 'maintenance'].includes(s.status) ? s.status : 'offline',
    online: Number(s.online) || 0,
    max: Number(s.max || s.max_players) || 0,
    address: String(s.address || ''),
    version: s.version || '',
    description: s.description || '',
    recommended: !!s.recommended,
  })).filter((s) => /^[^:\s]+:\d{1,5}$/.test(s.address) || s.address === '');
  return out;
}

function normalizeNews(list) {
  return (Array.isArray(list) ? list : []).map((n) => ({
    id: String(n.id),
    title: String(n.title || ''),
    excerpt: String(n.excerpt || n.summary || ''),
    category: n.category || 'news',
    date: n.date || n.published_at || '',
    cover: n.cover || n.cover_url || '',
    url: n.url || '',
  })).filter((n) => n.title);
}

module.exports = { createBackend, normalizeServers, normalizeNews };
