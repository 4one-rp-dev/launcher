'use strict';
/**
 * Данные проекта, которых нет в игре: серверы, новости, настройки, промокоды лаунчера, кошелёк (журнал), история входов.
 * Два варианта с одним интерфейсом: память (разработка, тесты) и MariaDB (таблицы core_*, sql/002_content.sql).
 * 4Coin в аккаунт зачисляет не API, а игровой сервер из журнала core_wallet_tx (Core/CoreRewards.cs):
 * только он знает, в сети ли игрок, и не затрёт баланс из памяти.
 */

const lim = (n) => Math.max(1, Math.min(200, Math.trunc(Number(n)) || 20)); // LIMIT подставляем числом: плейсхолдер в LIMIT капризен у prepared statements
const CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,23}$/;

const toIso = (d) => (d instanceof Date ? d.toISOString() : d ? new Date(d).toISOString() : null);
const server = (r) => ({
  id: r.id, name: r.name, tag: r.tag || '', status: r.status, online: Number(r.online) || 0, max: Number(r.max_players ?? r.max) || 0,
  address: r.address || '', version: r.version || '', description: r.description || '', recommended: !!r.recommended,
});
const news = (r) => ({
  id: String(r.id), title: r.title, excerpt: r.excerpt || '', category: r.category || 'news',
  date: typeof r.published_at === 'string' ? r.published_at.slice(0, 10) : toIso(r.published_at || r.date).slice(0, 10), cover: r.cover || '', url: r.url || '',
});
const tx = (r) => ({ id: String(r.id), at: toIso(r.at), title: r.title, amount: Number(r.amount) || 0 });

// ---------------------------------------------------------------- память
function createMemoryContent(seed = {}) {
  const servers = (seed.servers || []).map((s) => ({ published: true, sort: 0, ...s }));
  const newsList = (seed.news || []).map((n, i) => ({ id: i + 1, published: true, ...n }));
  const settings = new Map(Object.entries(seed.settings || {}));
  const promos = new Map((seed.promos || []).map((p) => [p.code, { usedCount: 0, enabled: true, maxUses: null, expiresAt: null, ...p }]));
  const redeems = []; const wallet = []; const events = [];
  let seq = 1;

  return {
    async listServers() { return servers.filter((s) => s.published).sort((a, b) => a.sort - b.sort).map(server); },
    async updateServerStats(id, st) {
      const s = servers.find((x) => x.id === id); if (!s) return false;
      if (st.online != null) s.online = st.online;
      if (st.max != null) s.max_players = s.max = st.max;
      if (st.status) s.status = st.status;
      return true;
    },
    async listNews(limit) { return newsList.filter((n) => n.published).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, limit).map(news); },
    async getSetting(k) { return settings.has(k) ? settings.get(k) : null; },

    /** Атомарно: код можно применить один раз на аккаунт, пока он включён, не истёк и не исчерпан. */
    async redeemPromo({ login, code, now }) {
      const p = promos.get(code);
      if (!p) return { ok: false, error: 'promo_not_found' };
      if (redeems.some((r) => r.code === code && r.login === login)) return { ok: false, error: 'promo_used' };
      if (!p.enabled) return { ok: false, error: 'promo_not_found' };
      if (p.expiresAt && new Date(p.expiresAt) <= now) return { ok: false, error: 'promo_expired' };
      if (p.maxUses != null && p.usedCount >= p.maxUses) return { ok: false, error: 'promo_limit' };
      p.usedCount += 1;
      const row = { id: seq++, login, at: now, title: p.title, amount: p.amount, source: 'promo', ref: code, appliedAt: null };
      wallet.push(row); redeems.push({ id: row.id, login, code, at: now });
      return { ok: true, tx: tx(row), promo: { code, title: p.title, reward: { kind: 'coins', amount: p.amount } } };
    },
    async listRedeems(login, limit) {
      return redeems.filter((r) => r.login === login).sort((a, b) => b.at - a.at).slice(0, limit).map((r) => {
        const p = promos.get(r.code);
        return { id: String(r.id), code: r.code, title: p ? p.title : r.code, at: toIso(r.at), reward: { kind: 'coins', amount: p ? p.amount : 0 } };
      });
    },
    async pendingCoins(login) { return wallet.filter((w) => w.login === login && !w.appliedAt && w.amount > 0).reduce((s, w) => s + w.amount, 0); },
    async listWallet(login, limit) { return wallet.filter((w) => w.login === login).sort((a, b) => b.at - a.at).slice(0, limit).map(tx); },
    async markApplied(id, now) { const w = wallet.find((x) => x.id === Number(id)); if (w) w.appliedAt = now; },

    async addLoginEvent(e) { events.push({ id: seq++, ...e }); },
    async listLoginEvents(login, limit) {
      return events.filter((e) => e.login === login).sort((a, b) => b.at - a.at).slice(0, limit)
        .map((e) => ({ id: String(e.id), at: toIso(e.at), device: e.device || '', ip: e.ipMask || '', place: '', method: e.method, ok: !!e.ok }));
    },
    _content: { servers, newsList, settings, promos, redeems, wallet, events },
  };
}

// ---------------------------------------------------------------- MariaDB
function createMysqlContent(pool) {
  const q = async (sql, params) => (await pool.execute(sql, params))[0];
  return {
    async listServers() {
      return (await q('SELECT id, name, tag, status, online, max_players, address, version, description, recommended FROM core_servers WHERE published = 1 ORDER BY sort, id', [])).map(server);
    },
    async updateServerStats(id, st) {
      const res = await q('UPDATE core_servers SET online = COALESCE(?, online), max_players = COALESCE(?, max_players), status = COALESCE(?, status) WHERE id = ?',
        [st.online ?? null, st.max ?? null, st.status ?? null, id]);
      return res.affectedRows > 0;
    },
    async listNews(limit) {
      return (await q('SELECT id, title, excerpt, category, cover, url, published_at FROM core_news WHERE published = 1 ORDER BY published_at DESC, id DESC LIMIT ' + lim(limit), [])).map(news);
    },
    async getSetting(k) {
      const rows = await q('SELECT v FROM core_settings WHERE k = ?', [k]);
      return rows[0] ? rows[0].v : null;
    },

    async redeemPromo({ login, code, now }) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [pr] = await conn.execute('SELECT code, title, amount, enabled, expires_at, max_uses, used_count FROM core_promos WHERE code = ? FOR UPDATE', [code]);
        const p = pr[0];
        const fail = async (error) => { await conn.rollback(); return { ok: false, error }; };
        if (!p || !p.enabled) return await fail('promo_not_found');
        const [used] = await conn.execute('SELECT 1 FROM core_promo_redeems WHERE code = ? AND login = ? LIMIT 1', [code, login]);
        if (used.length) return await fail('promo_used');
        if (p.expires_at && new Date(p.expires_at) <= now) return await fail('promo_expired');
        if (p.max_uses != null && p.used_count >= p.max_uses) return await fail('promo_limit');
        await conn.execute('UPDATE core_promos SET used_count = used_count + 1 WHERE code = ?', [code]);
        const [ins] = await conn.execute('INSERT INTO core_wallet_tx (login, at, title, amount, source, ref) VALUES (?,?,?,?,?,?)', [login, now, p.title, p.amount, 'promo', code]);
        await conn.execute('INSERT INTO core_promo_redeems (code, login, at, tx_id) VALUES (?,?,?,?)', [code, login, now, ins.insertId]);
        await conn.commit();
        return { ok: true, tx: tx({ id: ins.insertId, at: now, title: p.title, amount: p.amount }), promo: { code, title: p.title, reward: { kind: 'coins', amount: p.amount } } };
      } catch (e) {
        try { await conn.rollback(); } catch (_) { /* соединение уже закрыто */ }
        if (e && e.code === 'ER_DUP_ENTRY') return { ok: false, error: 'promo_used' };
        throw e;
      } finally { conn.release(); }
    },
    async listRedeems(login, limit) {
      const rows = await q('SELECT r.tx_id AS id, r.code, p.title, r.at, p.amount FROM core_promo_redeems r JOIN core_promos p ON p.code = r.code WHERE r.login = ? ORDER BY r.at DESC LIMIT ' + lim(limit), [login]);
      return rows.map((r) => ({ id: String(r.id), code: r.code, title: r.title, at: toIso(r.at), reward: { kind: 'coins', amount: Number(r.amount) || 0 } }));
    },
    async pendingCoins(login) {
      const rows = await q('SELECT COALESCE(SUM(amount), 0) AS s FROM core_wallet_tx WHERE login = ? AND applied_at IS NULL AND amount > 0', [login]);
      return Number(rows[0].s) || 0;
    },
    async listWallet(login, limit) {
      return (await q('SELECT id, at, title, amount FROM core_wallet_tx WHERE login = ? ORDER BY at DESC, id DESC LIMIT ' + lim(limit), [login])).map(tx);
    },

    async addLoginEvent(e) {
      await q('INSERT INTO core_login_events (login, at, device, ip_mask, method, ok) VALUES (?,?,?,?,?,?)', [e.login, e.at, (e.device || '').slice(0, 80), (e.ipMask || '').slice(0, 45), e.method, e.ok ? 1 : 0]);
    },
    async listLoginEvents(login, limit) {
      return (await q('SELECT id, at, device, ip_mask, method, ok FROM core_login_events WHERE login = ? ORDER BY at DESC, id DESC LIMIT ' + lim(limit), [login]))
        .map((e) => ({ id: String(e.id), at: toIso(e.at), device: e.device || '', ip: e.ip_mask || '', place: '', method: e.method, ok: !!e.ok }));
    },
  };
}

module.exports = { createMemoryContent, createMysqlContent, CODE_RE };
