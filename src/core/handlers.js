'use strict';
/**
 * Чистый слой обработчиков IPC: без electron и node-модулей, получает сервисы снаружи.
 * В приложении сервисы настоящие (src/main/*), в демо-режиме и в браузерном
 * предпросмотре — мок (src/mock/*). Любой вызов возвращает { ok, data } или { ok:false, code, message }.
 */
const { ok, fail } = require('./contract');

// промокод ≤ 24 знака; клиент ограничивает строже (см. renderer/js/codefmt.js)
const CODE_RE = /^[A-Z0-9]{4,24}$/;

/** Промокод: убираем пробелы и дефисы, приводим к верхнему регистру. */
function normalizeCode(raw) {
  return String(raw == null ? '' : raw).toUpperCase().replace(/[\s-]+/g, '');
}
function isValidCodeFormat(raw) { return CODE_RE.test(normalizeCode(raw)); }

function str(v, max) { return typeof v === 'string' && v.length > 0 && v.length <= (max || 512); }

/**
 * @param {object} s  сервисы: app, win, auth, data, game, codes, account, settings, updater
 */
function createHandlers(s) {
  const guard = (fn) => async (...a) => {
    try { return await fn(...a); }
    catch (e) {
      if (s.log) s.log.error('handler', e && e.stack || e);
      return fail('unknown', { detail: String(e && e.message || e) });
    }
  };

  const h = {
    'app:info': async () => ok(await s.app.info()),
    'app:openExternal': async (key) => {
      if (!str(key, 300)) return fail('bad_request');
      return s.app.openExternal(key);
    },
    'app:openPath': async (kind) => {
      if (!['logs', 'game', 'userdata'].includes(kind)) return fail('bad_request');
      return s.app.openPath(kind);
    },
    'app:copyDiagnostics': async () => s.app.copyDiagnostics(),

    'win:minimize': async () => { s.win.minimize(); return ok(); },
    'win:toggleMaximize': async () => ok(s.win.toggleMaximize()),
    'win:close': async () => { s.win.close(); return ok(); },

    'auth:status': async () => ok(await s.auth.status()),
    // вход через сайт: OAuth в системном браузере, пароль в лаунчер не попадает
    'auth:login': async () => s.auth.login(),
    'auth:cancel': async () => s.auth.cancel(),
    'auth:logout': async () => s.auth.logout(),

    'data:bootstrap': async (force) => s.data.bootstrap(!!force),

    'servers:select': async (id) => {
      if (!str(id, 80)) return fail('bad_request');
      return s.data.selectServer(id);
    },

    'game:state': async () => ok(s.game.getState()),
    'game:detect': async () => s.game.detect(),
    'game:browse': async () => s.game.browse(),
    'game:setPath': async (p) => (str(p, 1024) ? s.game.setPath(p) : fail('bad_request')),
    'game:install': async () => s.game.install(),
    'game:verify': async () => s.game.verify(),
    'game:play': async () => s.game.play(),
    'game:cancel': async () => s.game.cancel(),
    'game:uninstall': async () => s.game.uninstall(),

    'codes:redeem': async (raw) => {
      const code = normalizeCode(raw);
      if (!CODE_RE.test(code)) return fail('promo_not_found');
      return s.codes.redeem(code);
    },
    'codes:history': async () => s.codes.history(),

    // аккаунт: данные живут на сайте, лаунчер их показывает; пароль/почта/2FA здесь не меняются
    'account:security': async () => s.account.security(),
    'account:sessions': async () => s.account.sessions(),
    'account:revokeSession': async (id) => (str(id, 80) ? s.account.revokeSession(id) : fail('bad_request')),
    'account:revokeOthers': async () => s.account.revokeOthers(),
    'account:history': async () => s.account.history(),
    'account:wallet': async () => s.account.wallet(),
    'account:characters': async () => s.account.characters(),

    'settings:get': async () => ok(s.settings.get()),
    'settings:reset': async () => ok(await s.settings.reset()),
    'settings:set': async (patch) => {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return fail('bad_request');
      return ok(await s.settings.set(patch));
    },

    'update:check': async () => s.updater.check(),
    'update:download': async () => s.updater.download(),
    'update:install': async () => s.updater.install(),
  };

  const wrapped = {};
  for (const k of Object.keys(h)) wrapped[k] = guard(h[k]);
  return wrapped;
}

module.exports = { createHandlers, normalizeCode, isValidCodeFormat };
