'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../src/totp');

const RFC_KEY = Buffer.from('12345678901234567890', 'ascii'); // секрет SHA1 из RFC 4226 и RFC 6238

test('HOTP: векторы RFC 4226 (приложение D)', () => {
  const want = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  want.forEach((code, i) => assert.equal(t.hotp(RFC_KEY, i), code, `счётчик ${i}`));
});

test('TOTP: векторы RFC 6238 (SHA1), 8 цифр и последние 6', () => {
  const vectors = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
  for (const [sec, code8] of vectors) {
    assert.equal(t.totp(RFC_KEY, sec * 1000, 8), code8, `T=${sec}`);
    assert.equal(t.totp(RFC_KEY, sec * 1000), code8.slice(-6), `T=${sec}, 6 цифр`);
  }
});

test('base32: векторы RFC 4648 без «=», декодер терпит регистр и пробелы', () => {
  const v = [['', ''], ['f', 'MY'], ['fo', 'MZXQ'], ['foo', 'MZXW6'], ['foob', 'MZXW6YQ'], ['fooba', 'MZXW6YTB'], ['foobar', 'MZXW6YTBOI']];
  for (const [plain, enc] of v) {
    assert.equal(t.base32Encode(Buffer.from(plain)), enc);
    assert.equal(t.base32Decode(enc).toString(), plain);
  }
  assert.equal(t.base32Decode('mzxw 6ytb oi======').toString(), 'foobar');
  assert.equal(t.base32Decode('MZ1W'), null, '1 не входит в алфавит');
  assert.equal(t.base32Encode(RFC_KEY), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  const s = t.generateSecret(); assert.equal(s.length, 20);
  assert.match(t.base32Encode(s), /^[A-Z2-7]{32}$/);
});

test('verifyTotp: окно ±1 шаг, повтор шага ≤ last_step не принимается', () => {
  const at = 1111111111 * 1000; const step = t.stepAt(at);
  const prev = t.hotp(RFC_KEY, step - 1); const cur = t.hotp(RFC_KEY, step); const next = t.hotp(RFC_KEY, step + 1);
  assert.equal(t.verifyTotp(RFC_KEY, cur, at), step);
  assert.equal(t.verifyTotp(RFC_KEY, prev, at), step - 1);
  assert.equal(t.verifyTotp(RFC_KEY, next, at), step + 1);
  assert.equal(t.verifyTotp(RFC_KEY, t.hotp(RFC_KEY, step - 2), at), null, 'за окном');
  assert.equal(t.verifyTotp(RFC_KEY, t.hotp(RFC_KEY, step + 2), at), null, 'за окном');
  assert.equal(t.verifyTotp(RFC_KEY, cur, at, { lastStep: step }), null, 'тот же шаг второй раз');
  assert.equal(t.verifyTotp(RFC_KEY, next, at, { lastStep: step }), step + 1, 'следующий шаг можно');
  for (const bad of ['', '12345', '1234567', 'abcdef', null, undefined]) assert.equal(t.verifyTotp(RFC_KEY, bad, at), null);
});

test('резервные коды: 10 разных, XXXX-XXXX, алфавит без O, I, 0, 1', () => {
  const list = t.generateBackupCodes(10);
  assert.equal(list.length, 10); assert.equal(new Set(list).size, 10);
  for (const c of list) { assert.match(c, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/); assert.equal(t.codeKind(c), 'backup'); }
  assert.equal(t.BACKUP_ALPHABET.length, 32);
  assert.ok(!/[OI01]/.test(t.BACKUP_ALPHABET));
  assert.equal(t.normalizeCode(' abcd-ef23 '), 'ABCDEF23');
  assert.equal(t.codeKind('abcdef23'), 'backup');
  assert.equal(t.codeKind('123 456'), 'totp');
  assert.equal(t.codeKind('ABCD-EF2O'), null, 'O не бывает в коде');
  assert.equal(t.codeKind('12345'), null);
});

test('otpauth: ссылка для приложения-аутентификатора', () => {
  assert.equal(t.otpauthUri({ secret: 'JBSWY3DPEHPK3PXP', account: 'marcus' }),
    'otpauth://totp/4ONE%20RP:marcus?secret=JBSWY3DPEHPK3PXP&issuer=4ONE%20RP&algorithm=SHA1&digits=6&period=30');
  assert.match(t.otpauthUri({ secret: 'A', account: 'a b/c' }), /4ONE%20RP:a%20b%2Fc\?/);
});
