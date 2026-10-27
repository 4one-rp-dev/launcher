'use strict';
const { CODE_RE } = require('./content');
const { createLimiter } = require('./limiter');

const iso = (d) => (d ? new Date(d).toISOString() : null);

/** 203.0.113.45 -> 203.0.113.x ; IPv6 — первые три группы. Полный адрес нигде не хранится и не отдаётся. */
function maskIp(ip) {
  const s = String(ip || '').replace(/^::ffff:/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return s.replace(/\.\d{1,3}$/, '.x');
  if (s.includes(':')) return `${s.split(':').slice(0, 3).join(':')}::x`;
  return '';
}

/** «DESKTOP-1 · Windows» -> { device, os } для списка сессий */
function splitDevice(label) {
  const [device, os] = String(label || '').split('·').map((x) => x.trim());
  return { device: device || 'Лаунчер', os: os || '' };
}

/**
 * Прикладные операции поверх хранилища: каталог для лаунчера, промокоды, данные аккаунта.
 * Каждая возвращает { status, body } или { data }, ошибки — коды из контракта лаунчера (promo_*, bad_request).
 */
function createServices({ store, now = () => new Date() }) {
  const redeemLimiter = createLimiter({ max: 10, windowMs: 60 * 1000 });
  const MIN_STATUS = ['online', 'offline', 'maintenance'];

  async function bootstrap() {
    const [servers, news, client, notice, flags] = await Promise.all([
      store.listServers(), store.listNews(10), store.getSetting('client'), store.getSetting('notice'), store.getSetting('flags'),
    ]);
    const json = (s) => { try { const v = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch (_) { return null; } };
    return { servers, news, client: json(client), notice: notice || null, flags: json(flags) || {} };
  }

  async function redeem(login, rawCode) {
    const code = String(rawCode == null ? '' : rawCode).toUpperCase().replace(/\s+/g, '');
    if (!CODE_RE.test(code)) return { error: 'promo_not_found' };
    if (redeemLimiter.blocked(login)) return { error: 'busy' };
    redeemLimiter.fail(login); // считаем каждую попытку: перебор кодов упирается в лимит
    const r = await store.redeemPromo({ login, code, now: now() });
    if (!r.ok) return { error: r.error };
    return { data: { id: r.tx.id, code, title: r.promo.title, at: r.tx.at, reward: r.promo.reward } };
  }

  const codesHistory = (login) => store.listRedeems(login, 50);

  async function wallet(account) {
    const [pending, items] = await Promise.all([store.pendingCoins(account.login), store.listWallet(account.login, 50)]);
    return { balance: account.redbucks + pending, items };
  }

  async function security(account) {
    // в таблице accounts нет подтверждения почты и 2FA: показываем то, что есть, остальное — как «нет»
    return {
      emailVerified: false, twoFactor: false, passwordSet: !!account.passwordHash,
      links: [{ provider: 'socialclub', linked: !!account.socialClub, label: account.socialClub || '' }],
    };
  }

  async function sessions(account, current) {
    const list = await store.listSessions(account.login);
    return list.sort((a, b) => b.lastSeenAt - a.lastSeenAt).map((s) => ({
      id: s.id, ...splitDevice(s.device), ip: '', place: '', lastAt: iso(s.lastSeenAt), current: s.id === current.id,
    }));
  }

  async function revokeSession(account, current, id) {
    if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id)) return { error: 'bad_request' };
    if (id === current.id) return { error: 'bad_request' };              // текущую завершают выходом, а не из списка
    const s = await store.getSession(id);
    if (!s || s.login !== account.login) return { error: 'bad_request' }; // чужую сессию не отозвать
    await store.revokeSession(id, now());
    return { data: {} };
  }

  async function revokeOthers(account, current) {
    for (const s of await store.listSessions(account.login)) if (s.id !== current.id) await store.revokeSession(s.id, now());
    return { data: {} };
  }

  const history = (account) => store.listLoginEvents(account.login, 50);

  async function characters(account) {
    const [list, seen] = await Promise.all([store.listCharacters(account), store.lastSeen(account)]);
    return list.map((c) => ({ id: String(c.id), name: c.name, level: c.level, job: '', cash: c.cash || 0, bank: c.bank || 0, lastAt: iso(seen) }));
  }

  async function updateServerStats(id, body) {
    const st = {};
    if (body.online != null) { const n = Number(body.online); if (!Number.isInteger(n) || n < 0 || n > 100000) return { error: 'bad_request' }; st.online = n; }
    if (body.max != null) { const n = Number(body.max); if (!Number.isInteger(n) || n < 0 || n > 100000) return { error: 'bad_request' }; st.max = n; }
    if (body.status != null) { if (!MIN_STATUS.includes(body.status)) return { error: 'bad_request' }; st.status = body.status; }
    return (await store.updateServerStats(String(id), st)) ? { data: {} } : { error: 'not_found' };
  }

  return { bootstrap, redeem, codesHistory, wallet, security, sessions, revokeSession, revokeOthers, history, characters, updateServerStats, maskIp };
}

module.exports = { createServices, maskIp };
