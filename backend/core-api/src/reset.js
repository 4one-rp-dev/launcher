'use strict';
/**
 * Сброс пароля через сайт. Почту отправляет сайт (в Core API нет SMTP), API хранит и проверяет токены:
 *   1) сайт по запросу «забыл пароль» зовёт POST /v1/internal/password/token (X-Internal-Token) с логином или почтой —
 *      получает одноразовый токен, почту и логин, отправляет письмо со ссылкой на свою страницу сброса;
 *   2) страница сайта проверяет ссылку (GET /v1/password/reset?token=…) и отправляет POST /v1/password/reset
 *      {token, password, code?}. Если у аккаунта включена 2FA, нужен её код.
 * После смены пароля: все сессии лаунчера/сайта отозваны, игрок в игре будет выброшен (force_logout_at), все устройства
 * перестают быть доверенными (вход с любого — «новое устройство» и трейд-бан), защита включается обратно.
 * Токен живёт 30 минут, одноразовый; в БД только хеш с перцем.
 */
const { hashPassword } = require('./passwords');
const { randomToken, hashToken } = require('./tokens');
const { createLimiter } = require('./limiter');

const TTL_MS = 30 * 60 * 1000;

/** Те же правила пароля, что при регистрации (Accounts/Registration в игре). */
function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 64 || !/^[\x21-\x7e]+$/.test(password)) return 'Пароль: от 8 до 64 символов, латиница, цифры и знаки без пробелов.';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Пароль должен содержать буквы и цифры.';
  return '';
}

function createReset({ store, mfa, config, now = () => new Date() }) {
  const h = (v) => hashToken(config.pepper, v);
  // не больше 3 токенов в час на аккаунт: почтой нельзя засыпать владельца; 10 неверных проверок токена в минуту на IP
  const issueLimiter = createLimiter({ max: 3, windowMs: 60 * 60 * 1000, now: () => now().getTime() });
  const tryLimiter = createLimiter({ max: 10, windowMs: 60 * 1000, now: () => now().getTime() });

  /** Для сайта (внутренний маршрут): токен для аккаунта по логину или почте. Не найден — { error: 'not_found' }. */
  async function issue(identifier) {
    const id = String(identifier || '').trim().slice(0, 100);
    if (!id) return { error: 'bad_request' };
    const account = await store.findAccount(id);
    if (!account || !account.email) return { error: 'not_found' };
    if (issueLimiter.blocked(account.login)) return { error: 'rate_limited' };
    issueLimiter.fail(account.login);
    const token = randomToken(32);
    const expiresAt = new Date(now().getTime() + TTL_MS);
    await store.putReset({ hash: h(token), login: account.login, createdAt: now(), expiresAt });
    return { data: { token, login: account.login, email: account.email, expiresAt: expiresAt.toISOString() } };
  }

  /** Страница сайта проверяет ссылку до показа формы. */
  async function check(token, ip) {
    const key = `ip:${ip || '-'}`;
    if (tryLimiter.blocked(key)) return { error: 'rate_limited' };
    const r = await store.peekReset(h(String(token || '')), now());
    if (!r) { tryLimiter.fail(key); return { error: 'invalid_token' }; }
    return { data: { valid: true, mfaRequired: await mfa.isEnabled(r.login) } };
  }

  async function confirm(body, ip) {
    const key = `ip:${ip || '-'}`;
    if (tryLimiter.blocked(key)) return { error: 'rate_limited' };
    const token = String(body.token || '');
    const bad = passwordProblem(body.password);
    if (bad) return { error: 'invalid_password', message: bad };
    const tokenHash = h(token);
    const peek = await store.peekReset(tokenHash, now());
    if (!peek) { tryLimiter.fail(key); return { error: 'invalid_token' }; }
    const login = peek.login;
    if (await mfa.isEnabled(login)) {
      if (typeof body.code !== 'string' || !body.code.trim()) return { error: 'mfa_required' };
      if (mfa.limiter.blocked(login)) return { error: 'rate_limited' };
      if (!(await mfa.check(login, body.code))) { mfa.limiter.fail(login); return { error: 'invalid_mfa_code' }; }
      mfa.limiter.reset(login);
    }
    // токен гасится один раз: из двух одновременных запросов пройдёт один
    const taken = await store.takeReset(tokenHash, now());
    if (!taken) { tryLimiter.fail(key); return { error: 'invalid_token' }; }
    if (!(await store.setPassword(login, hashPassword(body.password)))) return { error: 'not_found' };
    await store.deleteResets(login);
    await store.revokeAllSessions(login, now());
    await store.untrustDevices(login, now());
    await store.markForceLogout(login, now());
    await store.setDisableAfter(login, null, now());
    return { data: { reset: true } };
  }

  return { issue, check, confirm, issueLimiter, tryLimiter };
}

module.exports = { createReset, passwordProblem, TTL_MS };
