'use strict';
const crypto = require('crypto');
const { isAllowedRedirect } = require('./config');
const { verifyPassword } = require('./passwords');
const { randomToken, hashToken, verifyPkce, sign, unsign } = require('./tokens');
const { createLimiter } = require('./limiter');
const roles = require('./roles');
const { maskIp } = require('./services');

// фиктивный хеш: при неизвестном логине тратим столько же времени, сколько на проверку настоящего пароля
const DUMMY_HASH = 'p2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const TX_TTL_MS = 10 * 60 * 1000;
const STATE_RE = /^[\x21-\x7e]{1,256}$/;
const CHALLENGE_RE = /^[A-Za-z0-9\-_]{43}$/;

const oauthError = (status, error, description) => ({ status, body: { error, error_description: description } });

/**
 * OAuth 2.0: Authorization Code + PKCE (RFC 6749, 7636, 8252).
 * Вход проверяет логин и пароль по таблице accounts игры; токены доступа короткие (15 минут), обновление — ротацией.
 * Роль и права читаются из БД при каждом запросе профиля, поэтому смена уровня администратора видна почти сразу.
 */
function createOAuth({ store, config, now = () => new Date() }) {
  const pepper = config.pepper;
  const h = (v) => hashToken(pepper, v);
  const loginLimiter = createLimiter({ max: 5, windowMs: 10 * 60 * 1000 });
  const ipLimiter = createLimiter({ max: 30, windowMs: 10 * 60 * 1000 });
  const tokenLimiter = createLimiter({ max: 30, windowMs: 60 * 1000 });
  const add = (d, sec) => new Date(d.getTime() + sec * 1000);

  function parseAuthorize(q) {
    const client = config.clients[String(q.client_id || '')];
    if (!client) return { ok: false, message: 'Неизвестное приложение.' };
    const redirectUri = String(q.redirect_uri || '');
    if (!isAllowedRedirect(client, redirectUri)) return { ok: false, message: 'Адрес возврата не разрешён для этого приложения.' };
    if (q.response_type !== 'code') return { ok: false, message: 'Неподдерживаемый тип ответа.' };
    if (q.code_challenge_method !== 'S256' || !CHALLENGE_RE.test(String(q.code_challenge || ''))) return { ok: false, message: 'Нужен PKCE (S256).' };
    if (!STATE_RE.test(String(q.state || ''))) return { ok: false, message: 'Некорректный параметр state.' };
    const device = String(q.device_name || '').replace(/[^\p{L}\p{N} ._\-·]/gu, '').slice(0, 80);
    return {
      ok: true, client,
      params: { cid: String(q.client_id), ru: redirectUri, st: String(q.state), ch: String(q.code_challenge), dv: device },
    };
  }

  const beginTx = (params) => sign(config.secret, { ...params, exp: now().getTime() + TX_TTL_MS });

  async function submitLogin({ tx, login, password, ip }) {
    const p = unsign(config.secret, tx, now().getTime());
    if (!p) return { ok: false, error: 'tx_expired' };
    const id = String(login || '').trim().slice(0, 100);
    const ipKey = `ip:${ip || '-'}`; const userKey = `u:${id.toLowerCase()}|${ip || '-'}`;
    if (!id || typeof password !== 'string' || !password || password.length > 200) return { ok: false, error: 'invalid_credentials' };
    if (ipLimiter.blocked(ipKey) || loginLimiter.blocked(userKey)) return { ok: false, error: 'rate_limited' };

    const account = await store.findAccount(id);
    const good = verifyPassword(password, account ? account.passwordHash : DUMMY_HASH) && !!account;
    const event = (ok) => store.addLoginEvent({ login: account.login, at: now(), device: p.dv, ipMask: maskIp(ip), method: p.cid === '4one-launcher' ? 'launcher' : 'site', ok }).catch(() => {});
    if (!good) { ipLimiter.fail(ipKey); loginLimiter.fail(userKey); if (account) event(false); return { ok: false, error: 'invalid_credentials' }; }
    loginLimiter.reset(userKey);
    event(true);

    const code = randomToken(32);
    await store.putCode({
      hash: h(code), login: account.login, clientId: p.cid, redirectUri: p.ru, challenge: p.ch,
      expiresAt: add(now(), config.codeTtlSec), device: p.dv,
    });
    const sep = p.ru.includes('?') ? '&' : '?';
    return { ok: true, redirect: `${p.ru}${sep}code=${encodeURIComponent(code)}&state=${encodeURIComponent(p.st)}`, device: p.dv };
  }

  async function issue(session, account) {
    const refresh = randomToken(32); const access = randomToken(32);
    const t = now();
    await store.rotateRefresh(session.id, h(refresh), t);
    await store.putToken({ hash: h(access), sessionId: session.id, login: account, expiresAt: add(t, config.accessTtlSec) });
    return {
      access_token: access, token_type: 'Bearer', expires_in: config.accessTtlSec, refresh_token: refresh, scope: 'profile',
    };
  }

  async function exchange(body, meta = {}) {
    const key = `tok:${meta.ip || '-'}`;
    if (tokenLimiter.blocked(key)) return oauthError(429, 'slow_down', 'Слишком много запросов.');
    tokenLimiter.fail(key);
    const grant = body.grant_type;

    if (grant === 'authorization_code') {
      const client = config.clients[String(body.client_id || '')];
      if (!client) return oauthError(400, 'invalid_client', 'Неизвестное приложение.');
      const rec = await store.takeCode(h(String(body.code || '')), now());
      if (!rec || rec.clientId !== body.client_id || rec.redirectUri !== body.redirect_uri || !verifyPkce(body.code_verifier, rec.challenge)) {
        return oauthError(400, 'invalid_grant', 'Код недействителен или истёк.');
      }
      const account = await store.getAccount(rec.login);
      if (!account) return oauthError(400, 'invalid_grant', 'Аккаунт не найден.');
      const session = {
        id: crypto.randomBytes(16).toString('hex'), login: account.login, clientId: rec.clientId,
        device: rec.device || '', refreshHash: h(randomToken(8)), createdAt: now(), expiresAt: add(now(), config.refreshTtlSec),
      };
      await store.createSession(session);
      return { status: 200, body: await issue(session, account.login) };
    }

    if (grant === 'refresh_token') {
      const found = await store.findSessionByRefresh(h(String(body.refresh_token || '')));
      if (!found) return oauthError(400, 'invalid_grant', 'Сессия недействительна.');
      const { session, reused } = found;
      if (reused) { await store.revokeSession(session.id, now()); return oauthError(400, 'invalid_grant', 'Сессия отозвана.'); }
      if (session.revokedAt) return oauthError(400, 'invalid_grant', 'Сессия отозвана.');
      if (session.expiresAt <= now()) return oauthError(400, 'invalid_grant', 'Сессия истекла.');
      if (body.client_id && body.client_id !== session.clientId) return oauthError(400, 'invalid_grant', 'Сессия другого приложения.');
      if (!(await store.getAccount(session.login))) return oauthError(400, 'invalid_grant', 'Аккаунт не найден.');
      return { status: 200, body: await issue(session, session.login) };
    }
    return oauthError(400, 'unsupported_grant_type', 'Неподдерживаемый тип.');
  }

  /** RFC 7009: отзывает сессию по access- или refresh-токену; всегда отвечает 200. */
  async function revoke(body) {
    const token = String(body.token || '');
    if (token) {
      const t = await store.getToken(h(token));
      const r = t ? { session: { id: t.sessionId } } : await store.findSessionByRefresh(h(token));
      if (r) await store.revokeSession(r.session.id, now());
    }
    return { status: 200, body: {} };
  }

  async function authenticate(header) {
    const m = /^Bearer ([A-Za-z0-9\-_]{20,100})$/.exec(String(header || ''));
    if (!m) return null;
    const t = await store.getToken(h(m[1]));
    if (!t || t.expiresAt <= now()) return null;
    const session = await store.getSession(t.sessionId);
    if (!session || session.revokedAt || session.expiresAt <= now()) return null;
    const account = await store.getAccount(t.login);
    if (!account) return null;
    if (now() - session.lastSeenAt > 60000) store.touchSession(session.id, now()).catch(() => {});
    return { account, session };
  }

  async function profile(account) {
    const [alvl, characters, banned, pending] = await Promise.all([store.getAlvl(account.socialClub), store.listCharacters(account), store.isBanned(account), store.pendingCoins(account.login)]);
    const role = roles.describe(alvl);
    return {
      login: account.login,
      email: account.email,
      socialClub: account.socialClub,
      balance4c: account.redbucks + pending, // с зачислениями, которые игра ещё не применила (промокоды)
      vip: { level: account.vipLvl, until: account.vipDate && account.vipLvl > 0 ? account.vipDate.toISOString() : null },
      accountStatus: banned ? 'banned' : 'active',
      authMethod: 'password',
      role,
      permissions: roles.permissionsFor(role.alvl),
      characters,
    };
  }

  return { parseAuthorize, beginTx, submitLogin, exchange, revoke, authenticate, profile, _limiters: { loginLimiter, ipLimiter, tokenLimiter } };
}

module.exports = { createOAuth };
