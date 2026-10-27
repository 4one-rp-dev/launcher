'use strict';
/**
 * Настройки из переменных окружения. Секреты не имеют значений по умолчанию: без CORE_SECRET боевой режим не стартует.
 */
const LOOPBACK_RE = /^http:\/\/(127\.0\.0\.1|\[::1\]):\d{1,5}\/callback$/;

const DEFAULT_CLIENTS = {
  '4one-launcher': {
    name: '4ONE Launcher',
    redirectUris: ['gta4one://auth/callback'],
    loopback: true,       // RFC 8252: http://127.0.0.1:<порт>/callback
    trusted: true,        // собственное приложение проекта: без экрана согласия
  },
};

function load(env = process.env) {
  const store = (env.CORE_STORE || 'mysql').toLowerCase();
  const secret = env.CORE_SECRET || '';
  if (store === 'mysql' && secret.length < 32) throw new Error('CORE_SECRET: нужна случайная строка от 32 знаков');
  const ident = (v, d) => { const s = v || d; if (!/^[A-Za-z0-9_]{1,64}$/.test(s)) throw new Error(`Недопустимое имя БД: ${s}`); return s; };
  let clients = DEFAULT_CLIENTS;
  if (env.CORE_CLIENTS) { try { clients = JSON.parse(env.CORE_CLIENTS); } catch (_) { throw new Error('CORE_CLIENTS: некорректный JSON'); } }
  return {
    port: Number(env.CORE_PORT) || 8787,
    host: env.CORE_HOST || '127.0.0.1',
    publicUrl: (env.CORE_PUBLIC_URL || 'http://127.0.0.1:8787').replace(/\/+$/, ''),
    store,
    secret: secret || 'dev-only-secret-dev-only-secret-dev-only',
    pepper: env.CORE_PEPPER || secret || 'dev-pepper',
    db: {
      host: env.CORE_DB_HOST || '127.0.0.1',
      port: Number(env.CORE_DB_PORT) || 3306,
      user: env.CORE_DB_USER || '',
      password: env.CORE_DB_PASSWORD || '',
      game: ident(env.CORE_DB_GAME, 'ra3_main'),                 // БД геймода: accounts, characters, banned
      platform: ident(env.CORE_DB_PLATFORM, 'flovmp_server'),    // БД платформы FloV:MP: accounts.alvl
    },
    clients,
    accessTtlSec: 15 * 60,
    refreshTtlSec: 60 * 24 * 3600,
    codeTtlSec: 120,
    trustProxy: env.CORE_TRUST_PROXY === '1',
    seedFile: env.CORE_SEED || '',
    internalToken: env.CORE_INTERNAL_TOKEN || '',   // для POST /v1/internal/* (игровой сервер, cron); пусто — эти маршруты выключены
  };
}

function isAllowedRedirect(client, uri) {
  if (!client || typeof uri !== 'string' || uri.length > 300) return false;
  if ((client.redirectUris || []).includes(uri)) return true;
  return !!client.loopback && LOOPBACK_RE.test(uri);
}

module.exports = { load, isAllowedRedirect, DEFAULT_CLIENTS };
