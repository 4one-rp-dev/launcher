'use strict';
const fs = require('fs');
const path = require('path');
const { fail, ok } = require('../core/contract');

const crypto = require('crypto');

const FATAL = new Set(['invalid_session', 'session_revoked', 'session_expired', 'launcher_access_denied']);

/** Хранилище токена: шифруется средствами ОС (DPAPI) через electron.safeStorage; без шифрования — только в памяти. */
function createVault(dir, safeStorage) {
  const file = path.join(dir, 'session.bin');
  let mem = null;
  const canEncrypt = () => !!(safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable());
  return {
    canEncrypt,
    load() {
      if (mem) return mem;
      try {
        if (!canEncrypt()) return null;
        const buf = fs.readFileSync(file);
        return JSON.parse(safeStorage.decryptString(buf));
      } catch (_) { return null; }
    },
    save(obj) {
      mem = obj;
      if (!canEncrypt()) return;
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(obj)));
      } catch (_) { /* ignore */ }
    },
    clear() { mem = null; try { fs.unlinkSync(file); } catch (_) { /* нет файла */ } },
  };
}

/**
 * Сессия лаунчера = OAuth к Core API (единый вход сайта, лаунчера и игры): пароль вводится в браузере на странице входа,
 * лаунчер получает одноразовый код по gta4one://auth/callback (PKCE) и меняет его на токены.
 * Токены лежат в safeStorage вместе с кэшем профиля; access живёт 15 минут и обновляется сам, refresh вращается.
 * Роль («Игрок» / «Администратор n уровня») приходит в профиле из игровой БД и перечитывается периодически.
 */
function createAuth(deps) {
  const { oauth, backend, vault, bus, log, openAuth, deviceName, loginTimeoutMs = 10 * 60 * 1000, now = Date.now } = deps;
  const st = { authed: false, profile: null, offline: false, reason: '', pending: false };
  let tokens = null;     // { access, refresh, expiresAt }
  let pending = null;    // { state, verifier, timer }

  const publicState = () => ({ authed: st.authed, profile: st.profile, offline: st.offline, reason: st.reason, pending: st.pending });
  const emit = () => bus.emit('auth:changed', publicState());
  const persist = () => { if (tokens) vault.save({ ...tokens, profile: st.profile, at: now() }); };
  const toast = (kind, text) => bus.emit('toast', { kind, text });

  function clearPending() {
    if (pending && pending.timer) clearTimeout(pending.timer);
    pending = null; st.pending = false;
  }
  function drop(reason) {
    clearPending(); tokens = null; vault.clear();
    st.authed = false; st.profile = null; st.offline = false; st.reason = reason || ''; emit();
  }
  const sameState = (a, b) => {
    const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };

  /** Свежий access: обновляем заранее, за минуту до конца. */
  async function ensureAccess() {
    if (!tokens) return fail('invalid_session');
    if (tokens.expiresAt - now() > 60 * 1000) return ok(tokens.access);
    const r = await oauth.refresh(tokens.refresh);
    if (!r.ok) return r;
    tokens = r.data; persist();
    return ok(tokens.access);
  }

  async function loadProfile() {
    const a = await ensureAccess();
    if (!a.ok) return a;
    const r = await oauth.me(a.data);
    if (!r.ok) return r;
    return ok(backend.fromCore(r.data));
  }

  return {
    state: publicState,
    token() { return tokens && tokens.access || null; },
    /** Свежий access для запросов к API: обновляется заранее; null — входа нет или обновить не удалось. */
    async freshToken() { const a = await ensureAccess(); return a.ok ? a.data : null; },
    setProfile(p) { if (p) { st.profile = p; emit(); } },
    async status() { return publicState(); },

    /** При старте: сохранённая сессия -> проверка и свежий профиль с ролью. */
    async restore() {
      const v = vault.load();
      if (!v || !v.refresh) return publicState();
      tokens = { access: v.access || '', refresh: v.refresh, expiresAt: Number(v.expiresAt) || 0 };
      const r = await loadProfile();
      if (r.ok) {
        st.authed = true; st.profile = r.data; st.offline = false; st.reason = ''; persist();
        log.info('auth', `сессия восстановлена: ${st.profile.username} (${st.profile.role})`);
      } else if (FATAL.has(r.code)) {
        log.info('auth', `сессия отклонена: ${r.code}`);
        tokens = null; vault.clear(); st.authed = false; st.profile = null; st.reason = r.code;
      } else {
        // сети нет: показываем кэш, но как непроверенный
        st.authed = true; st.offline = true; st.profile = v.profile || null;
        log.warn('auth', `нет связи при проверке сессии: ${r.code}`);
      }
      emit();
      return publicState();
    },

    /** Повторная проверка (после появления сети и по таймеру): заодно подхватывает смену роли и баланса. */
    async revalidate() {
      if (!tokens) return publicState();
      const r = await loadProfile();
      if (r.ok) {
        const changed = JSON.stringify(r.data) !== JSON.stringify(st.profile) || st.offline;
        st.authed = true; st.offline = false; st.reason = ''; st.profile = r.data; persist();
        if (changed) emit();
      } else if (FATAL.has(r.code)) drop(r.code);
      return publicState();
    },

    /** «Войти»: открываем страницу входа в браузере; результат придёт ссылкой gta4one://auth/callback. */
    async login() {
      clearPending();
      const flow = oauth.newFlow(deviceName);
      pending = { state: flow.state, verifier: flow.verifier, timer: setTimeout(() => { if (pending && pending.state === flow.state) { clearPending(); emit(); toast('warn', 'Вход не завершён. Нажмите «Войти» и повторите.'); } }, loginTimeoutMs) };
      if (pending.timer.unref) pending.timer.unref();
      const r = await openAuth(flow.url);
      if (r && r.ok === false) { clearPending(); return r; }
      st.pending = true; st.reason = '';
      log.info('auth', 'вход: открыта страница авторизации');
      emit();
      return ok(publicState());
    },

    async cancel() { clearPending(); emit(); return ok(publicState()); },

    /** Возврат из браузера. Чужие и устаревшие ссылки отбрасываются по state. */
    async handleCallback(link) {
      if (!pending || !link || !sameState(link.state, pending.state)) {
        log.warn('auth', 'ссылка входа отклонена: нет ожидающего входа или state не совпал');
        return fail('login_failed');
      }
      const { verifier } = pending; clearPending(); emit();
      const t = await oauth.exchangeCode(link.code, verifier);
      if (!t.ok) { toast('err', t.message); return t; }
      tokens = t.data;
      const me = await oauth.me(tokens.access);
      if (!me.ok) { tokens = null; toast('err', me.message); return me; }
      st.authed = true; st.offline = false; st.reason = ''; st.profile = backend.fromCore(me.data);
      persist();
      log.info('auth', `вход через сайт: ${st.profile.username} (${st.profile.role})`);
      emit();
      return ok(publicState());
    },

    async logout() {
      const refresh = tokens && tokens.refresh;
      drop('logout');
      if (refresh) oauth.revoke(refresh).catch(() => {}); // в фоне: выход не должен ждать сеть
      return ok(publicState());
    },

    onFatal(code) { if (FATAL.has(code)) drop(code); },
  };
}

module.exports = { createVault, createAuth, FATAL };
