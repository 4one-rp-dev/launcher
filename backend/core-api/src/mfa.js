'use strict';
/**
 * Двухфакторная защита: TOTP из приложения-аутентификатора и одноразовые резервные коды.
 * Секрет в БД зашифрован (AES-256-GCM, ключ из CORE_SECRET, логин — AAD: строку нельзя переставить другому аккаунту),
 * резервные коды — только хеши с перцем. Таблица accounts не трогается.
 */
const crypto = require('crypto');
const totp = require('./totp');
const { hashToken, b64url } = require('./tokens');
const { createLimiter } = require('./limiter');

const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function createMfa({ store, config, now = () => new Date() }) {
  const key = crypto.createHash('sha256').update('4one-core-api:mfa-secret:v1\0').update(String(config.secret)).digest();
  // 10 неверных кодов за 10 минут на логин — общий для входа и управления 2FA
  const limiter = createLimiter({ max: 10, windowMs: 10 * 60 * 1000, now: () => now().getTime() });

  function encrypt(login, secret) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    c.setAAD(Buffer.from(String(login), 'utf8'));
    const ct = Buffer.concat([c.update(secret), c.final()]);
    return `v1.${b64url(iv)}.${b64url(c.getAuthTag())}.${b64url(ct)}`;
  }
  function decrypt(login, value) {
    const [v, iv, tag, ct] = String(value || '').split('.');
    if (v !== 'v1' || !iv || !tag || !ct) return null;
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', key, fromB64url(iv));
      d.setAAD(Buffer.from(String(login), 'utf8')); d.setAuthTag(fromB64url(tag));
      return Buffer.concat([d.update(fromB64url(ct)), d.final()]);
    } catch (_) { return null; } // другой CORE_SECRET или порча строки
  }
  const backupHash = (login, code) => hashToken(config.pepper, `mfa-backup\0${login}\0${totp.normalizeCode(code)}`);

  const enabledRow = (r) => !!(r && r.enabledAt && r.secretEnc);
  async function isEnabled(login) { return enabledRow(await store.getMfa(login)); }

  async function status(login) {
    const r = await store.getMfa(login);
    const enabled = enabledRow(r);
    return {
      enabled, pending: !enabled && !!(r && r.pendingEnc),
      backupLeft: enabled ? await store.countBackupCodes(login) : 0,
      enabledAt: enabled ? new Date(r.enabledAt).toISOString() : null,
    };
  }

  /** TOTP по включённому секрету; шаг сдвигается атомарно — повтор того же кода не пройдёт даже в гонке. */
  async function checkTotp(login, row, code) {
    const secret = decrypt(login, row.secretEnc);
    if (!secret) return false;
    const step = totp.verifyTotp(secret, code, now().getTime(), { lastStep: row.lastStep || 0 });
    return step !== null && store.advanceMfaStep(login, step);
  }

  /** Проверка второго фактора: true, если код подошёл (резервный при этом гасится). */
  async function check(login, rawCode, { backup = true } = {}) {
    const row = await store.getMfa(login);
    if (!enabledRow(row)) return false;
    const kind = totp.codeKind(rawCode);
    if (kind === 'totp') return checkTotp(login, row, totp.normalizeCode(rawCode));
    if (kind === 'backup' && backup) return store.useBackupCode(login, backupHash(login, rawCode), now());
    return false;
  }

  /** Обёртка с лимитом для маршрутов аккаунта: { error } или null. */
  async function guarded(login, fn) {
    if (limiter.blocked(login)) return { error: 'rate_limited' };
    const ok = await fn();
    if (!ok) { limiter.fail(login); return { error: 'invalid_mfa_code' }; }
    return null;
  }

  async function newBackupCodes(login) {
    const codes = totp.generateBackupCodes(10);
    await store.replaceBackupCodes(login, codes.map((c) => backupHash(login, c)), now());
    return codes;
  }

  async function setup(account) {
    const row = await store.getMfa(account.login);
    if (enabledRow(row)) return { error: 'mfa_already_enabled' };
    const secret = totp.generateSecret();
    await store.setMfaPending(account.login, encrypt(account.login, secret), now());
    const b32 = totp.base32Encode(secret);
    return { data: { secret: b32, otpauth: totp.otpauthUri({ secret: b32, account: account.login }) } };
  }

  async function enable(account, code) {
    const login = account.login;
    const row = await store.getMfa(login);
    if (enabledRow(row)) return { error: 'mfa_already_enabled' };
    if (!row || !row.pendingEnc) return { error: 'mfa_not_pending' };
    let step = null;
    const err = await guarded(login, async () => {
      const secret = decrypt(login, row.pendingEnc);
      step = secret && totp.verifyTotp(secret, totp.normalizeCode(code), now().getTime());
      return step !== null && step !== undefined;
    });
    if (err) return err;
    // условно: только тот секрет, который проверяли (параллельный setup его бы заменил)
    if (!(await store.enableMfa(login, { pendingEnc: row.pendingEnc, lastStep: step, now: now() }))) return { error: 'mfa_not_pending' };
    return { data: { enabled: true, backupCodes: await newBackupCodes(login) } };
  }

  async function disable(account, code) {
    if (!(await isEnabled(account.login))) return { error: 'mfa_not_enabled' };
    const err = await guarded(account.login, () => check(account.login, code));
    if (err) return err;
    await store.disableMfa(account.login);
    return { data: { enabled: false } };
  }

  async function regenerate(account, code) {
    if (!(await isEnabled(account.login))) return { error: 'mfa_not_enabled' };
    const err = await guarded(account.login, () => check(account.login, code, { backup: false }));
    if (err) return err;
    return { data: { backupCodes: await newBackupCodes(account.login) } };
  }

  return { isEnabled, status, check, setup, enable, disable, regenerate, limiter, _crypto: { encrypt, decrypt } };
}

module.exports = { createMfa };
