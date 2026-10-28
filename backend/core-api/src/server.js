'use strict';
const http = require('http');
const { URL } = require('url');
const { load } = require('./config');
const { createOAuth } = require('./oauth');
const { loginPage, errorPage, doneHtml } = require('./page');
const { createMemoryStore, createMysqlStore } = require('./store');
const roles = require('./roles');
const crypto = require('crypto');
const { createServices } = require('./services');

const MAX_BODY = 8 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('too_large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseBody(req, raw) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type === 'application/json') { try { const o = JSON.parse(raw || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (_) { return null; } }
  if (type === 'application/x-www-form-urlencoded') return Object.fromEntries(new URLSearchParams(raw));
  return raw ? null : {};
}

/** Собирает обработчик запросов. Используется и сервером, и тестами. */
function createApp({ store, config, now }) {
  const oauth = createOAuth({ store, config, now });
  const svc = createServices({ store, now });
  const STATUS = { promo_not_found: 404, promo_expired: 410, promo_used: 409, promo_limit: 409, busy: 429, bad_request: 400, not_found: 404 };
  const MESSAGES = { promo_not_found: 'Такого кода не существует.', promo_expired: 'Срок действия кода истёк.', promo_used: 'Вы уже активировали этот код.', promo_limit: 'Лимит активаций кода исчерпан.', busy: 'Слишком много запросов.', bad_request: 'Некорректный запрос.', not_found: 'Не найдено.' };
  const result = (res, r) => (r.error ? apiError(res, STATUS[r.error] || 400, r.error, MESSAGES[r.error] || 'Ошибка.') : send(res, 200, { data: r.data }));
  const internalOk = (req) => {
    const want = Buffer.from(config.internalToken || ''); const got = Buffer.from(String(req.headers['x-internal-token'] || ''));
    return want.length >= 16 && want.length === got.length && crypto.timingSafeEqual(want, got);
  };

  const ipOf = (req) => (config.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '-';
  const baseHeaders = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' };

  function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, { ...baseHeaders, ...(res.corsHeaders || {}), 'Content-Type': type, ...extra });
    res.end(payload);
  }
  // formAction: после входа браузер уходит на адрес возврата сайта (https), CSP страницы должен это разрешать
  const html = (res, status, body, formOrigin) => send(res, status, body, 'text/html; charset=utf-8', {
    'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${formOrigin ? ' ' + formOrigin : ''}; frame-ancestors 'none'; base-uri 'none'`,
    'X-Frame-Options': 'DENY',
  });
  const apiError = (res, status, code, message) => send(res, status, { error: code, error_description: message });

  async function authed(req, res, permission) {
    const a = await oauth.authenticate(req.headers.authorization);
    if (!a) { apiError(res, 401, 'invalid_token', 'Токен недействителен или истёк.'); return null; }
    if (permission) {
      const p = await oauth.profile(a.account);
      if (!p.permissions.includes(permission)) { apiError(res, 403, 'forbidden', 'Недостаточно прав.'); return null; }
      return { ...a, profile: p };
    }
    return a;
  }

  /** CORS для страниц сайта: только разрешённые источники, без cookie (токен — в заголовке Authorization). */
  function cors(req, res) {
    const origin = req.headers.origin;
    if (!origin || !config.corsOrigins.includes(origin)) return false;
    res.corsHeaders = {
      'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '600',
    };
    return true;
  }

  async function route(req, res) {
    const url = new URL(req.url, config.publicUrl);
    if (req.url.startsWith('/v1/') || req.url.startsWith('/oauth/token') || req.url.startsWith('/oauth/revoke')) {
      const allowed = cors(req, res);
      if (req.method === 'OPTIONS') { res.writeHead(allowed ? 204 : 403, { ...baseHeaders, ...(res.corsHeaders || {}) }); return res.end(); }
    }
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method;

    if (path === '/healthz' && method === 'GET') return send(res, 200, { ok: true, store: store.kind });

    // ---- страница входа (для системного браузера)
    if (path === '/oauth/authorize' && method === 'GET') {
      const r = oauth.parseAuthorize(Object.fromEntries(url.searchParams));
      if (!r.ok) return html(res, 400, errorPage(r.message));
      const ru = new URL(r.params.ru);
      return html(res, 200, loginPage({ clientName: r.client.name, tx: oauth.beginTx(r.params) }), /^https?:$/.test(ru.protocol) ? ru.origin : '');
    }
    if (path === '/oauth/authorize' && method === 'POST') {
      const body = parseBody(req, await readBody(req));
      if (!body) return html(res, 400, errorPage('Некорректный запрос.'));
      const r = await oauth.submitLogin({ tx: body.tx, login: body.login, password: body.password, ip: ipOf(req) });
      if (!r.ok) {
        if (r.error === 'tx_expired') return html(res, 400, errorPage('Страница входа устарела. Вернитесь в лаунчер и нажмите «Войти» ещё раз.'));
        return html(res, r.error === 'rate_limited' ? 429 : 401, loginPage({ clientName: '4ONE', tx: body.tx, error: r.error, login: body.login }));
      }
      // кастомная схема: 200 со ссылкой, а не 302 (браузеры не всегда отдают такой редирект приложению)
      if (/^https?:/.test(r.redirect)) return send(res, 302, '', 'text/plain', { Location: r.redirect });
      return html(res, 200, doneHtml(r.redirect));
    }

    // ---- токены
    if (path === '/oauth/token' && method === 'POST') {
      const body = parseBody(req, await readBody(req));
      if (!body) return apiError(res, 400, 'invalid_request', 'Некорректное тело запроса.');
      const r = await oauth.exchange(body, { ip: ipOf(req) });
      return send(res, r.status, r.body);
    }
    if (path === '/oauth/revoke' && method === 'POST') {
      const body = parseBody(req, await readBody(req));
      if (!body) return apiError(res, 400, 'invalid_request', 'Некорректное тело запроса.');
      const r = await oauth.revoke(body);
      return send(res, r.status, r.body);
    }

    // ---- профиль и роль (единый источник для лаунчера и сайта)
    if (path === '/v1/me' && method === 'GET') {
      const a = await authed(req, res);
      if (!a) return;
      return send(res, 200, { data: await oauth.profile(a.account) });
    }

    // ---- каталог для лаунчера: серверы, новости, версия клиента, объявление, флаги (публично)
    if (path === '/v1/bootstrap' && method === 'GET') return send(res, 200, { data: await svc.bootstrap() });

    // ---- промокоды лаунчера (4Coin зачисляет игровой сервер из журнала кошелька)
    if (path === '/v1/codes/redeem' && method === 'POST') {
      const a = await authed(req, res); if (!a) return;
      const body = parseBody(req, await readBody(req)); if (!body) return apiError(res, 400, 'bad_request', MESSAGES.bad_request);
      return result(res, await svc.redeem(a.account.login, body.code));
    }
    if (path === '/v1/codes/history' && method === 'GET') {
      const a = await authed(req, res); if (!a) return;
      return send(res, 200, { data: await svc.codesHistory(a.account.login) });
    }

    // ---- раздел «Аккаунт»
    if (path.startsWith('/v1/account/')) {
      const a = await authed(req, res); if (!a) return;
      const op = path.slice('/v1/account/'.length);
      if (method === 'GET' && op === 'security') return send(res, 200, { data: await svc.security(a.account) });
      if (method === 'GET' && op === 'sessions') return send(res, 200, { data: await svc.sessions(a.account, a.session) });
      if (method === 'GET' && op === 'history') return send(res, 200, { data: await svc.history(a.account) });
      if (method === 'GET' && op === 'wallet') return send(res, 200, { data: await svc.wallet(a.account) });
      if (method === 'GET' && op === 'characters') return send(res, 200, { data: await svc.characters(a.account) });
      if (method === 'POST' && op === 'sessions/revoke') {
        const body = parseBody(req, await readBody(req)); if (!body) return apiError(res, 400, 'bad_request', MESSAGES.bad_request);
        return result(res, await svc.revokeSession(a.account, a.session, body.id));
      }
      if (method === 'POST' && op === 'sessions/revoke-others') return result(res, await svc.revokeOthers(a.account, a.session));
      return apiError(res, 404, 'not_found', MESSAGES.not_found);
    }

    // ---- служебное: игровой сервер или cron присылает онлайн (по общему секрету, не из лаунчера)
    const m = /^\/v1\/internal\/servers\/([A-Za-z0-9_-]{1,40})\/stats$/.exec(path);
    if (m && method === 'POST') {
      if (!internalOk(req)) return apiError(res, 404, 'not_found', MESSAGES.not_found); // без секрета маршрута «нет»
      const body = parseBody(req, await readBody(req)); if (!body) return apiError(res, 400, 'bad_request', MESSAGES.bad_request);
      return result(res, await svc.updateServerStats(m[1], body));
    }

    // ---- вкладка «Администрирование»: какие разделы доступны уровню
    if (path === '/v1/admin/capabilities' && method === 'GET') {
      const a = await authed(req, res, 'admin.panel');
      if (!a) return;
      return send(res, 200, { data: { alvl: a.profile.role.alvl, permissions: a.profile.permissions, catalog: roles.PERMISSIONS.map(([name, min]) => ({ name, minLevel: min, granted: a.profile.role.alvl >= min })) } });
    }
    return apiError(res, 404, 'not_found', 'Не найдено.');
  }

  const handler = (req, res) => {
    route(req, res).catch((e) => {
      if (e && e.status === 413) return apiError(res, 413, 'too_large', 'Слишком большой запрос.');
      console.error('[core-api]', e && e.stack || e); // пароли и токены в логи не попадают: их нет в сообщениях ошибок
      if (!res.headersSent) apiError(res, 500, 'server_error', 'Внутренняя ошибка.');
    });
  };
  return { handler, oauth };
}

async function main() {
  require('./dotenv').loadDotEnv();
  const config = load();
  let store;
  if (config.store === 'memory') {
    const seed = config.seedFile ? JSON.parse(require('fs').readFileSync(config.seedFile, 'utf8')) : {};
    store = createMemoryStore(seed);
  } else {
    const mysql = require('mysql2/promise');
    const pool = mysql.createPool({
      host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password,
      database: config.db.name, waitForConnections: true, connectionLimit: 8, timezone: 'Z', charset: 'utf8mb4',
    });
    store = createMysqlStore(pool, config);
  }
  const { handler } = createApp({ store, config });
  const server = http.createServer(handler);
  server.requestTimeout = 15000;
  server.listen(config.port, config.host, () => console.log(`[core-api] ${config.host}:${config.port} store=${store.kind}`));
  setInterval(() => store.purgeExpired(new Date()).catch(() => {}), 10 * 60 * 1000).unref();
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });

module.exports = { createApp };
