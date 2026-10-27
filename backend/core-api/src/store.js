'use strict';
/**
 * Хранилище. Два варианта с одним интерфейсом:
 *  - memory: для разработки и тестов (данные из seed);
 *  - mysql: игровая MariaDB, одна база. Читаем accounts (в т.ч. alvl — уровень администрации), characters, banned;
 *    пишем только в свои таблицы core_* (sql/001_core_api.sql, 002_content.sql).
 * Время — Date (UTC), хеши токенов — hex sha256.
 */

const { createMemoryContent, createMysqlContent } = require('./content');

function normAccount(a) {
  return {
    login: String(a.login),
    email: String(a.email || ''),
    passwordHash: String(a.passwordHash || ''),
    socialClub: String(a.socialClub || ''),
    redbucks: Number(a.redbucks) || 0,
    vipLvl: Number(a.vipLvl) || 0,
    vipDate: a.vipDate ? new Date(a.vipDate) : null,
    alvl: Number(a.alvl) || 0,   // уровень администрации 0–8: accounts.alvl
  };
}

// ---------------------------------------------------------------- память
function createMemoryStore(seed = {}) {
  const accounts = (seed.accounts || []).map((a) => ({ ...normAccount(a), characters: a.characters || [], banned: !!a.banned, lastAt: a.lastAt || null }));
  const codes = new Map(); const sessions = new Map(); const tokens = new Map();
  const find = (id) => accounts.find((a) => a.login === id) || accounts.find((a) => a.email && a.email.toLowerCase() === String(id).toLowerCase()) || null;

  return {
    ...createMemoryContent(seed),
    kind: 'memory',
    async findAccount(identifier) { return find(identifier); },
    async getAccount(login) { return accounts.find((a) => a.login === login) || null; },
    async listCharacters(account) { return (account.characters || []).map((c) => ({ ...c })); },
    async isBanned(account) { return !!account.banned; },
    async lastSeen(account) { return account.lastAt ? new Date(account.lastAt) : null; },

    async putCode(rec) { codes.set(rec.hash, { ...rec, usedAt: null }); },
    /** Атомарно: код можно взять один раз и пока не истёк. */
    async takeCode(hash, now) {
      const c = codes.get(hash);
      if (!c || c.usedAt || c.expiresAt <= now) return null;
      c.usedAt = now; return { ...c };
    },

    async createSession(rec) { sessions.set(rec.id, { ...rec, revokedAt: null, prevRefreshHash: null }); },
    async getSession(id) { const s = sessions.get(id); return s ? { ...s } : null; },
    async findSessionByRefresh(hash) {
      for (const s of sessions.values()) {
        if (s.refreshHash === hash) return { session: { ...s }, reused: false };
        if (s.prevRefreshHash === hash) return { session: { ...s }, reused: true };
      }
      return null;
    },
    async rotateRefresh(id, newHash, now) {
      const s = sessions.get(id); if (!s) return;
      s.prevRefreshHash = s.refreshHash; s.refreshHash = newHash; s.lastSeenAt = now;
    },
    async touchSession(id, now) { const s = sessions.get(id); if (s) s.lastSeenAt = now; },
    async revokeSession(id, now) {
      const s = sessions.get(id); if (s && !s.revokedAt) s.revokedAt = now;
      for (const [h, t] of tokens) if (t.sessionId === id) tokens.delete(h);
    },
    async listSessions(login) { return [...sessions.values()].filter((s) => s.login === login && !s.revokedAt).map((s) => ({ ...s })); },

    async putToken(rec) { tokens.set(rec.hash, { ...rec }); },
    async getToken(hash) { const t = tokens.get(hash); return t ? { ...t } : null; },
    async deleteTokensOfSession(id) { for (const [h, t] of tokens) if (t.sessionId === id) tokens.delete(h); },
    async purgeExpired(now) {
      for (const [h, c] of codes) if (c.expiresAt <= now) codes.delete(h);
      for (const [h, t] of tokens) if (t.expiresAt <= now) tokens.delete(h);
    },
    _dump: () => ({ accounts, codes, sessions, tokens }),
  };
}

// ---------------------------------------------------------------- MariaDB
function createMysqlStore(pool, cfg) {
  const q = async (sql, params) => (await pool.execute(sql, params))[0];
  const toAccount = (r) => ({
    ...normAccount({
      login: r.login, email: r.email, passwordHash: r.password, socialClub: r.socialclub,
      redbucks: r.redbucks, vipLvl: r.viplvl, vipDate: r.vipdate, alvl: r.alvl,
    }),
    lastAt: r.ExitDate || null,
    charIds: [r.character1, r.character2, r.character3].map(Number).filter((n) => n > 0),
    charactersJson: r.characters,
  });
  const COLS = 'login, email, `password`, socialclub, redbucks, viplvl, vipdate, character1, character2, character3, `characters`, ExitDate, alvl';

  return {
    ...createMysqlContent(pool),
    kind: 'mysql',
    async findAccount(identifier) {
      const rows = await q(`SELECT ${COLS} FROM accounts WHERE login = ? OR LOWER(email) = LOWER(?) LIMIT 1`, [identifier, identifier]);
      return rows[0] ? toAccount(rows[0]) : null;
    },
    async getAccount(login) {
      const rows = await q(`SELECT ${COLS} FROM accounts WHERE login = ? LIMIT 1`, [login]);
      return rows[0] ? toAccount(rows[0]) : null;
    },
    async listCharacters(account) {
      const ids = new Set(account.charIds || []);
      try { for (const n of JSON.parse(account.charactersJson || '[]')) if (Number(n) > 0) ids.add(Number(n)); } catch (_) { /* битое поле */ }
      if (!ids.size) return [];
      const list = [...ids].slice(0, 12);
      const rows = await q(`SELECT uuid, firstname, lastname, lvl, money, bank FROM characters WHERE IsDelete = 0 AND uuid IN (${list.map(() => '?').join(',')})`, list);
      return rows.map((r) => ({ id: r.uuid, name: `${r.firstname || ''} ${r.lastname || ''}`.trim(), level: Number(r.lvl) || 0, cash: Number(r.money) || 0, bank: Number(r.bank) || 0 }));
    },
    async lastSeen(account) { return account.lastAt ? new Date(account.lastAt) : null; },
    async isBanned(account) {
      const rows = await q('SELECT 1 AS x FROM banned WHERE (account = ? OR (socialclub <> \'\' AND socialclub = ?)) AND `until` > NOW() LIMIT 1', [account.login, account.socialClub]);
      return rows.length > 0;
    },

    async putCode(r) {
      await q('INSERT INTO core_oauth_codes (code_hash, login, client_id, redirect_uri, challenge, device, expires_at) VALUES (?,?,?,?,?,?,?)',
        [r.hash, r.login, r.clientId, r.redirectUri, r.challenge, r.device || '', r.expiresAt]);
    },
    async takeCode(hash, now) {
      // условный UPDATE: код гасится один раз, гонка двух обменов невозможна
      const res = await q('UPDATE core_oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?', [now, hash, now]);
      if (!res.affectedRows) return null;
      const rows = await q('SELECT login, client_id, redirect_uri, challenge, device FROM core_oauth_codes WHERE code_hash = ?', [hash]);
      const r = rows[0]; return r ? { login: r.login, clientId: r.client_id, redirectUri: r.redirect_uri, challenge: r.challenge, device: r.device } : null;
    },

    async createSession(r) {
      await q('INSERT INTO core_oauth_sessions (id, login, client_id, device, refresh_hash, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?,?,?,?)',
        [r.id, r.login, r.clientId, r.device || '', r.refreshHash, r.createdAt, r.createdAt, r.expiresAt]);
    },
    async getSession(id) {
      const rows = await q('SELECT * FROM core_oauth_sessions WHERE id = ?', [id]);
      return rows[0] ? sess(rows[0]) : null;
    },
    async findSessionByRefresh(hash) {
      const rows = await q('SELECT * FROM core_oauth_sessions WHERE refresh_hash = ? OR prev_refresh_hash = ? LIMIT 1', [hash, hash]);
      if (!rows[0]) return null;
      return { session: sess(rows[0]), reused: rows[0].refresh_hash !== hash };
    },
    async rotateRefresh(id, newHash, now) {
      await q('UPDATE core_oauth_sessions SET prev_refresh_hash = refresh_hash, refresh_hash = ?, last_seen_at = ? WHERE id = ?', [newHash, now, id]);
    },
    async touchSession(id, now) { await q('UPDATE core_oauth_sessions SET last_seen_at = ? WHERE id = ?', [now, id]); },
    async revokeSession(id, now) {
      await q('UPDATE core_oauth_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?', [now, id]);
      await q('DELETE FROM core_oauth_tokens WHERE session_id = ?', [id]);
    },
    async listSessions(login) {
      return (await q('SELECT * FROM core_oauth_sessions WHERE login = ? AND revoked_at IS NULL', [login])).map(sess);
    },

    async putToken(r) { await q('INSERT INTO core_oauth_tokens (token_hash, session_id, login, expires_at) VALUES (?,?,?,?)', [r.hash, r.sessionId, r.login, r.expiresAt]); },
    async getToken(hash) {
      const rows = await q('SELECT session_id, login, expires_at FROM core_oauth_tokens WHERE token_hash = ?', [hash]);
      return rows[0] ? { sessionId: rows[0].session_id, login: rows[0].login, expiresAt: new Date(rows[0].expires_at) } : null;
    },
    async deleteTokensOfSession(id) { await q('DELETE FROM core_oauth_tokens WHERE session_id = ?', [id]); },
    async purgeExpired(now) {
      await q('DELETE FROM core_oauth_codes WHERE expires_at <= ?', [now]);
      await q('DELETE FROM core_oauth_tokens WHERE expires_at <= ?', [now]);
    },
  };

  function sess(r) {
    return {
      id: r.id, login: r.login, clientId: r.client_id, device: r.device,
      refreshHash: r.refresh_hash, prevRefreshHash: r.prev_refresh_hash,
      createdAt: new Date(r.created_at), lastSeenAt: new Date(r.last_seen_at), expiresAt: new Date(r.expires_at),
      revokedAt: r.revoked_at ? new Date(r.revoked_at) : null,
    };
  }
}

module.exports = { createMemoryStore, createMysqlStore };
