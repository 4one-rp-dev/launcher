'use strict';
const crypto = require('crypto');

/**
 * Проверка пароля по тем же правилам, что игровой сервер (Accounts/PasswordHash.cs):
 *  - новый формат «p2$итерации$соль$хеш» — PBKDF2-SHA256, соль и хеш в base64;
 *  - старый формат — SHA-256 hex от ASCII-строки (русские буквы превращались в «?»).
 * API только читает хеши и ничего не переписывает: старый хеш заменит сам игровой сервер при входе в игру.
 */
const PREFIX = 'p2$';

function legacySha256(password) {
  // Encoding.ASCII в .NET заменяет всё не-ASCII на '?'
  const ascii = Buffer.from(Array.from(String(password)).map((c) => (c.charCodeAt(0) < 128 ? c : '?')).join(''), 'latin1');
  return crypto.createHash('sha256').update(ascii).digest('hex');
}

function safeEqual(a, b) {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string' || !stored) return false;
  if (!stored.startsWith(PREFIX)) return safeEqual(legacySha256(password), stored.toLowerCase());
  const parts = stored.split('$');
  if (parts.length !== 4) return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 5000000) return false;
  try {
    const salt = Buffer.from(parts[2], 'base64');
    const expected = Buffer.from(parts[3], 'base64');
    if (!salt.length || !expected.length) return false;
    const actual = crypto.pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, expected.length, 'sha256');
    return crypto.timingSafeEqual(actual, expected);
  } catch (_) { return false; }
}

/** Для тестов и скриптов: тот же формат, что у игры. */
function hashPassword(password, iterations = 100000) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, 32, 'sha256');
  return `${PREFIX}${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

module.exports = { verifyPassword, hashPassword, legacySha256 };
