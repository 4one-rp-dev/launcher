'use strict';
/**
 * Чистые функции одноразовых паролей: HOTP (RFC 4226), TOTP (RFC 6238, SHA1, 6 цифр, шаг 30 с), base32 (RFC 4648),
 * резервные коды. Без хранилища и без состояния: защиту от повтора (last_step) делает вызывающий код.
 */
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SEC = 30;
const DIGITS = 6;

/** base32 без «=» в конце. */
function base32Encode(buf) {
  let bits = 0; let value = 0; let out = '';
  for (const byte of Buffer.from(buf)) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Терпит строчные буквы, пробелы и «=»; на чужой символ — null. */
function base32Decode(str) {
  const s = String(str || '').toUpperCase().replace(/[\s=]/g, '');
  let bits = 0; let value = 0; const out = [];
  for (const ch of s) {
    const i = B32.indexOf(ch);
    if (i < 0) return null;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** HOTP: HMAC-SHA1 от 8-байтового счётчика, динамическое усечение. */
function hotp(key, counter, digits = DIGITS) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', key).update(msg).digest();
  const off = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** Номер 30-секундного шага для момента времени (мс). */
const stepAt = (timeMs) => Math.floor(timeMs / 1000 / STEP_SEC);

function totp(key, timeMs, digits = DIGITS) { return hotp(key, stepAt(timeMs), digits); }

const sameStr = (a, b) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/**
 * Проверка кода в окне ±window шагов. Возвращает номер совпавшего шага или null.
 * Шаги ≤ lastStep не принимаются: один и тот же код второй раз не пройдёт.
 */
function verifyTotp(key, code, timeMs, { window = 1, lastStep = 0 } = {}) {
  const c = String(code == null ? '' : code);
  if (!/^\d{6}$/.test(c)) return null;
  const now = stepAt(timeMs);
  let found = null;
  for (let d = -window; d <= window; d++) {
    const step = now + d;
    if (step <= lastStep || step < 0) continue;
    if (sameStr(hotp(key, step), c) && found === null) found = step; // без раннего выхода: время не зависит от позиции
  }
  return found;
}

/** Секрет 20 байт (160 бит, как рекомендует RFC 4226). */
const generateSecret = () => crypto.randomBytes(20);

/** Ссылка для QR-кода приложения-аутентификатора. */
function otpauthUri({ secret, account, issuer = '4ONE RP' }) {
  const iss = encodeURIComponent(issuer);
  return `otpauth://totp/${iss}:${encodeURIComponent(account)}?secret=${secret}&issuer=${iss}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SEC}`;
}

// ---- резервные коды: 8 знаков из 32-символьного алфавита без O, I, 0, 1 (40 бит), показываются как XXXX-XXXX
const BACKUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BACKUP_RE = /^[A-HJ-NP-Z2-9]{8}$/;

function generateBackupCodes(n = 10) {
  const list = new Set();
  while (list.size < n) {
    const raw = Array.from(crypto.randomBytes(8), (b) => BACKUP_ALPHABET[b & 31]).join(''); // 256 делится на 32: без перекоса
    list.add(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return [...list];
}

/** Приводит ввод к виду для хеширования: верхний регистр, без дефисов и пробелов. */
const normalizeCode = (s) => String(s == null ? '' : s).toUpperCase().replace(/[\s-]/g, '');

/** 'totp' | 'backup' | null — что за код ввёл человек. */
function codeKind(s) {
  const c = normalizeCode(s);
  if (/^\d{6}$/.test(c)) return 'totp';
  if (BACKUP_RE.test(c)) return 'backup';
  return null;
}

module.exports = {
  base32Encode, base32Decode, hotp, totp, verifyTotp, stepAt, generateSecret, otpauthUri,
  generateBackupCodes, normalizeCode, codeKind, BACKUP_ALPHABET, STEP_SEC,
};
