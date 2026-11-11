'use strict';
const crypto = require('crypto');
const { isAllowedRedirect } = require('./config');
const { verifyPassword, hashPassword } = require('./passwords');
const { randomToken, hashToken, verifyPkce, sign, unsign } = require('./tokens');
const { createLimiter } = require('./limiter');
const roles = require('./roles');
const { maskIp } = require('./services');
const { createMfa } = require('./mfa');

// фиктивный хеш: при неизвестном логине тратим столько же времени, сколько на проверку настоящего пароля
const DUMMY_HASH = 'p2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const TX_TTL_MS = 10 * 60 * 1000;
const STATE_RE = /^[\x21-\x7e]{1,256}$/;
const CHALLENGE_RE = /^[A-Za-z0-9\-_]{43}$/;
const MFA_TTL_MS = 5 * 60 * 1000;
const MFA_TRIES = 5;
const cleanDevice = (s) => String(s || '').replace(/[^\p{L}\p{N} ._\-·]/gu, '').slice(0, 80);
const methodOf = (cid) => (cid === '4one-launcher' ? 'launcher' : 'site');

const oauthError = (status, error, description) => ({ status, body: { error, error_description: description } });

// Проверки регистрации — те же, что в игре (Accounts/Registration/Repository.cs, Validate), с теми же текстами
const LOGIN_RE = /^[A-Za-z][A-Za-z0-9_]{2,23}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const PROMO_RE = /^[A-Za-z0-9_-]{1,16}$/;  // как PromoRegex игры (там допускаются ещё «_» и «-»)
function validateSignup(b) {
  const str = (x) => (typeof x === 'string' ? x : '');
  const login = str(b.login); const password = str(b.password); const email = str(b.email); const promo = str(b.promo);
  if (!LOGIN_RE.test(login)) return { error: 'invalid_login', message: 'Логин: латиница, цифры и «_», от 3 до 24 символов, первая — буква.' };
  if (password.length < 8 || password.length > 64 || !/^[\x21-\x7e]+$/.test(password)) return { error: 'invalid_password', message: 'Пароль: от 8 до 64 символов, латиница, цифры и знаки без пробелов.' };
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return { error: 'invalid_password', message: 'Пароль должен содержать буквы и цифры.' };
  if (email.length > 64 || !EMAIL_RE.test(email)) return { error: 'invalid_email', message: 'Почта в формате name@mail.ru.' };
  if (promo && !PROMO_RE.test(promo)) return { error: 'invalid_promo', message: 'Промокод: латиница и цифры, до 16 символов.' };
  return { login, password, email, promo };
}

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
  const mfa = createMfa({ store, config, now });
  const tries = createLimiter({ max: MFA_TRIES, windowMs: MFA_TTL_MS, now: () => now().getTime() });

  function parseAuthorize(q) {
    const client = config.clients[String(q.client_id || '')];
    if (!client) return { ok: false, message: 'Неизвестное приложение.' };
    const redirectUri = String(q.redirect_uri || '');
    if (!isAllowedRedirect(client, redirectUri)) return { ok: false, message: 'Адрес возврата не разрешён для этого приложения.' };
    if (q.response_type !== 'code') return { ok: false, message: 'Неподдерживаемый тип ответа.' };
    if (q.code_challenge_method !== 'S256' || !CHALLENGE_RE.test(String(q.code_challenge || ''))) return { ok: false, message: 'Нужен PKCE (S256).' };
    if (!STATE_RE.test(String(q.state || ''))) return { ok: false, message: 'Некорректный параметр state.' };
    const device = cleanDevice(q.device_name);
    return {
      ok: true, client,
      params: { cid: String(q.client_id), ru: redirectUri, st: String(q.state), ch: String(q.code_challenge), dv: device },
    };
  }

  const beginTx = (params) => sign(config.secret, { ...params, exp: now().getTime() + TX_TTL_MS });
  const logEvent = (login, meta, ip, ok) => store.addLoginEvent({ login, at: now(), device: meta.dv || '', ipMask: maskIp(ip), method: methodOf(meta.cid), ok }).catch(() => {});

  /** Проверка пароля для формы и прямого входа: одни лимиты и одна задержка для неизвестного логина (DUMMY_HASH). */
  async function checkPassword({ login, password, ip, meta }) {
    const id = String(login || '').trim().slice(0, 100);
    const ipKey = `ip:${ip || '-'}`; const userKey = `u:${id.toLowerCase()}|${ip || '-'}`;
    if (!id || typeof password !== 'string' || !password || password.length > 200) return { error: 'invalid_credentials' };
    if (ipLimiter.blocked(ipKey) || loginLimiter.blocked(userKey)) return { error: 'rate_limited' };
    const account = await store.findAccount(id);
    const good = verifyPassword(password, account ? account.passwordHash : DUMMY_HASH) && !!account;
    if (!good) { ipLimiter.fail(ipKey); loginLimiter.fail(userKey); if (account) logEvent(account.login, meta, ip, false); return { error: 'invalid_credentials' }; }
    loginLimiter.reset(userKey);
    return { account };
  }

  // ---- второй шаг (2FA): подписанный токен на 5 минут, 5 попыток на токен (по одноразовому номеру n)
  const beginMfa = (t, payload) => sign(config.secret, { ...payload, t, n: randomToken(12), exp: now().getTime() + MFA_TTL_MS });
  const burnNonce = (n) => { for (let i = 0; i < MFA_TRIES; i++) tries.fail(n); }; // после успеха токен больше не принимается

  /** Проверка кода по токену шага 2: { account, p } или { error, p? }. */
  async function passMfa(t, token, code, ip, cid) {
    const p = unsign(config.secret, token, now().getTime());
    if (!p || p.t !== t || typeof p.n !== 'string' || (cid && p.cid !== cid) || tries.blocked(p.n)) return { error: 'mfa_expired' };
    const account = await store.getAccount(p.lg);
    if (!account || !(await mfa.isEnabled(account.login))) return { error: 'mfa_expired' };
    if (mfa.limiter.blocked(account.login)) return { error: 'rate_limited', p };
    if (!(await mfa.check(account.login, code))) {
      tries.fail(p.n); mfa.limiter.fail(account.login); logEvent(account.login, p, ip, false);
      return { error: 'invalid_mfa_code', p };
    }
    burnNonce(p.n); mfa.limiter.reset(account.login); logEvent(account.login, p, ip, true);
    return { account, p };
  }

  const originOf = (ru) => { try { const u = new URL(ru); return /^https?:$/.test(u.protocol) ? u.origin : ''; } catch (_) { return ''; } };
  const nameOf = (cid) => (config.clients[cid] && config.clients[cid].name) || '4ONE';

  async function submitLogin({ tx, login, password, ip }) {
    const p = unsign(config.secret, tx, now().getTime());
    if (!p || p.t) return { ok: false, error: 'tx_expired' }; // токен шага 2 вместо tx не подходит
    const view = { formOrigin: originOf(p.ru), clientName: nameOf(p.cid) };
    const r = await checkPassword({ login, password, ip, meta: p });
    if (r.error) return { ok: false, error: r.error, ...view };
    if (await mfa.isEnabled(r.account.login)) {
      const mtx = beginMfa('mtx', { cid: p.cid, ru: p.ru, st: p.st, ch: p.ch, dv: p.dv, lg: r.account.login });
      return { ok: true, mfa: true, mtx, ...view };
    }
    logEvent(r.account.login, p, ip, true);
    return issueCode(p, r.account.login);
  }

  /** POST формы со вторым шагом: mtx + code. */
  async function submitMfa({ mtx, code, ip }) {
    const r = await passMfa('mtx', mtx, code, ip);
    if (r.error) return { ok: false, error: r.error, mtx, ...(r.p ? { formOrigin: originOf(r.p.ru), clientName: nameOf(r.p.cid) } : {}) };
    return issueCode(r.p, r.account.login);
  }

  async function issueCode(p, login) {
    const code = randomToken(32);
    await store.putCode({
      hash: h(code), login, clientId: p.cid, redirectUri: p.ru, challenge: p.ch,
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

  /** Новая сессия и первая пара токенов: общая для authorization_code и прямого входа. */
  async function startSession(login, clientId, device) {
    const session = {
      id: crypto.randomBytes(16).toString('hex'), login, clientId,
      device: device || '', refreshHash: h(randomToken(8)), createdAt: now(), expiresAt: add(now(), config.refreshTtlSec),
    };
    await store.createSession(session);
    return issue(session, login);
  }

  // ---- прямой вход лаунчера: POST /v1/auth/login и /v1/auth/mfa (только доверенные клиенты)
  const trustedClient = (cid) => { const c = config.clients[cid]; return c && c.trusted ? c : null; };

  async function directLogin(body, meta = {}) {
    const cid = String(body.client_id || '');
    if (!trustedClient(cid)) return oauthError(400, 'invalid_client', 'Прямой вход для этого приложения недоступен.');
    const m = { cid, dv: cleanDevice(body.device_name) };
    const r = await checkPassword({ login: body.login, password: body.password, ip: meta.ip, meta: m });
    if (r.error === 'rate_limited') return oauthError(429, 'rate_limited', 'Слишком много попыток. Подождите несколько минут.');
    if (r.error) return oauthError(401, 'invalid_credentials', 'Неверный логин или пароль.');
    if (await mfa.isEnabled(r.account.login)) {
      // сессии пока нет: она появится после кода
      return { status: 200, body: { mfa_required: true, mfa_token: beginMfa('mfa', { ...m, lg: r.account.login }), methods: ['totp', 'backup'] } };
    }
    logEvent(r.account.login, m, meta.ip, true);
    return { status: 200, body: await startSession(r.account.login, cid, m.dv) };
  }

  async function directMfa(body, meta = {}) {
    const cid = String(body.client_id || '');
    if (!trustedClient(cid)) return oauthError(400, 'invalid_client', 'Прямой вход для этого приложения недоступен.');
    const r = await passMfa('mfa', body.mfa_token, body.code, meta.ip, cid);
    if (r.error === 'mfa_expired') return oauthError(400, 'mfa_expired', 'Время на ввод кода вышло. Войдите заново.');
    if (r.error === 'rate_limited') return oauthError(429, 'rate_limited', 'Слишком много попыток. Подождите несколько минут.');
    if (r.error) return oauthError(401, 'invalid_mfa_code', 'Неверный код.');
    return { status: 200, body: await startSession(r.account.login, cid, r.p.dv) };
  }

  // ---- регистрация: POST /v1/auth/register (только доверенные клиенты), успех — сразу токены, как у directLogin без 2FA
  const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
  const signupTries = createLimiter({ max: 20, windowMs: SIGNUP_WINDOW_MS, now: () => now().getTime() });
  const signupDone = createLimiter({ max: 3, windowMs: SIGNUP_WINDOW_MS, now: () => now().getTime() });

  async function register(body, meta = {}) {
    const cid = String(body.client_id || '');
    if (!trustedClient(cid)) return oauthError(400, 'invalid_client', 'Регистрация для этого приложения недоступна.');
    const key = `ip:${meta.ip || '-'}`;
    if (signupTries.blocked(key) || signupDone.blocked(key)) return oauthError(429, 'rate_limited', 'Слишком много регистраций. Попробуйте позже.');
    signupTries.fail(key); // считается каждая попытка, в том числе удачная
    const v = validateSignup(body);
    if (v.error) return oauthError(400, v.error, v.message);
    // как игра: логин, почта и промокод в нижнем регистре, пустой промокод — "noref" (по нему игра решает про реферальный бонус)
    const r = await store.createAccount({
      login: v.login.toLowerCase(), email: v.email.toLowerCase(), passwordHash: hashPassword(v.password),
      promo: v.promo ? v.promo.toLowerCase() : 'noref', ip: meta.ip || '', now: now(),
      redbucks: config.signup.redbucks, vipLvl: config.signup.vipLvl, vipDays: config.signup.vipDays,
    });
    if (r.error === 'login_taken') return oauthError(409, 'login_taken', 'Этот логин уже занят.');
    if (r.error === 'email_taken') return oauthError(409, 'email_taken', 'Эта почта уже используется.');
    if (r.error === 'busy') return oauthError(429, 'busy', 'Слишком много запросов. Попробуйте ещё раз.');
    if (r.error || !r.account) throw new Error(`register: ${r.error || 'нет аккаунта после вставки'}`);
    signupDone.fail(key);
    const m = { cid, dv: cleanDevice(body.device_name) };
    logEvent(r.account.login, m, meta.ip, true);
    return { status: 201, body: await startSession(r.account.login, cid, m.dv) };
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
      return { status: 200, body: await startSession(account.login, rec.clientId, rec.device) };
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
    const [characters, banned, pending] = await Promise.all([store.listCharacters(account), store.isBanned(account), store.pendingCoins(account.login)]);
    const role = roles.describe(account.alvl); // alvl — колонка accounts, ту же читает игра
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

  return {
    parseAuthorize, beginTx, submitLogin, submitMfa, directLogin, directMfa, register, exchange, revoke, authenticate, profile, mfa,
    _limiters: { loginLimiter, ipLimiter, tokenLimiter, mfaLimiter: mfa.limiter, tries, signupTries, signupDone },
  };
}

module.exports = { createOAuth };
