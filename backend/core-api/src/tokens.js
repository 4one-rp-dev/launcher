'use strict';
const crypto = require('crypto');

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Случайный непрозрачный токен: 256 бит. */
function randomToken(bytes = 32) { return b64url(crypto.randomBytes(bytes)); }

/** В БД лежит только хеш с перцем: утечка таблицы не даёт рабочих токенов. */
function hashToken(pepper, value) {
  return crypto.createHash('sha256').update(String(pepper)).update('\0').update(String(value)).digest('hex');
}

/** PKCE S256: base64url(sha256(verifier)). */
function pkceChallenge(verifier) { return b64url(crypto.createHash('sha256').update(String(verifier)).digest()); }

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE_RE = /^[A-Za-z0-9\-_]{43}$/;

function verifyPkce(verifier, challenge) {
  if (!VERIFIER_RE.test(String(verifier || '')) || !CHALLENGE_RE.test(String(challenge || ''))) return false;
  const a = Buffer.from(pkceChallenge(verifier)); const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Подпись параметров формы входа: параметры нельзя подменить между показом формы и отправкой. */
function sign(secret, payload) {
  const body = b64url(JSON.stringify(payload));
  const mac = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  return `${body}.${mac}`;
}
function unsign(secret, token, now) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const want = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  const x = Buffer.from(mac); const y = Buffer.from(want);
  if (x.length !== y.length || !crypto.timingSafeEqual(x, y)) return null;
  try {
    const p = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return p && p.exp > now ? p : null;
  } catch (_) { return null; }
}

module.exports = { randomToken, hashToken, pkceChallenge, verifyPkce, sign, unsign, b64url };
