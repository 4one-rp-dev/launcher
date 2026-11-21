'use strict';
/**
 * Защита аккаунта: вход с нового устройства в игре даёт трейд-бан (мод, 3 суток). Здесь — настройка «защита включена»,
 * список устройств и журнал входов в игру. Таблицы account_* ведёт игровой мод (sql/005_security.sql).
 *
 * Правила переключателя (чтобы тот, кто узнал пароль, не выключил защиту и сразу не вывел имущество):
 *  - включить можно мгновенно и без подтверждения;
 *  - выключить — только с паролем и (если подключена) кодом 2FA, а действует отключение через 24 часа:
 *    все сутки защита ещё работает, владелец успевает заметить и отменить (повторно включить).
 */
const { verifyPassword } = require('./passwords');
const { createLimiter } = require('./limiter');
const crypto = require('crypto');

const DISABLE_DELAY_MS = 24 * 3600 * 1000;
const iso = (d) => (d ? new Date(d).toISOString() : null);

/** Короткий отпечаток устройства для показа: сам HWID наружу не отдаём. */
const deviceId = (hwid) => crypto.createHash('sha256').update(`4one-device\0${hwid}`).digest('hex').slice(0, 10).toUpperCase();

function createProtect({ store, mfa, maskIp, now = () => new Date() }) {
  // 5 неверных паролей за 10 минут на логин; общий счётчик с остальными попытками подтвердить пароль в защите
  const limiter = createLimiter({ max: 5, windowMs: 10 * 60 * 1000, now: () => now().getTime() });

  function view(sec) {
    const t = now().getTime();
    const da = sec && sec.disableAfter ? sec.disableAfter.getTime() : null;
    const ban = sec && sec.tradeBanUntil && sec.tradeBanUntil.getTime() > t ? sec.tradeBanUntil : null;
    return {
      enabled: da === null || da > t,                       // защита действует сейчас
      offAt: da !== null && da > t ? iso(da) : null,        // отключение запрошено и сработает в это время
      tradeBanUntil: iso(ban),
      tradeBanReason: ban ? (sec.tradeBanReason || '') : '',
    };
  }

  async function status(login) { return view(await store.getSecurity(login)); }

  async function set(account, body) {
    const login = account.login;
    if (typeof body.enabled !== 'boolean') return { error: 'bad_request' };
    if (body.enabled) {
      await store.setDisableAfter(login, null, now());
      return { data: await status(login) };
    }
    if (limiter.blocked(login)) return { error: 'rate_limited' };
    if (typeof body.password !== 'string' || !body.password || body.password.length > 200) return { error: 'password_required' };
    if (!verifyPassword(body.password, account.passwordHash)) { limiter.fail(login); return { error: 'invalid_credentials' }; }
    if (await mfa.isEnabled(login)) {
      if (typeof body.code !== 'string' || !body.code.trim()) return { error: 'mfa_required' };
      if (!(await mfa.check(login, body.code))) { limiter.fail(login); return { error: 'invalid_mfa_code' }; }
    }
    limiter.reset(login);
    const sec = await store.getSecurity(login);
    // уже выключена или отключение уже запланировано — срок не сдвигаем
    if (!(sec && sec.disableAfter)) await store.setDisableAfter(login, new Date(now().getTime() + DISABLE_DELAY_MS), now());
    return { data: await status(login) };
  }

  async function devices(account) {
    const list = await store.listDevices(account.login);
    return list.map((d) => ({
      id: deviceId(d.hwid), firstAt: iso(d.firstSeen), lastAt: iso(d.lastSeen), logins: d.logins,
      trusted: !!d.trusted, ip: maskIp(d.ip),
    }));
  }

  /** Журнал входов в игру в формате общей истории (method=game). */
  async function gameHistory(account, limit = 50) {
    const list = await store.listGameLogins(account.login, limit);
    return list.map((x) => ({
      id: `g${x.at.getTime()}`, at: iso(x.at), device: x.hwid ? `Игра · ${deviceId(x.hwid)}` : 'Игра',
      ip: maskIp(x.ip), place: '', method: 'game', ok: !!x.ok, newDevice: !!x.newDevice, reason: x.reason || '',
    }));
  }

  return { status, set, devices, gameHistory, limiter, deviceId, DISABLE_DELAY_MS };
}

module.exports = { createProtect, deviceId, DISABLE_DELAY_MS };
