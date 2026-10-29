'use strict';
/**
 * Все адреса и константы лаунчера. Значения взяты из старого WPF-лаунчера 4ONE
 * (v0.2.4), кроме помеченных TODO — их нужно подтвердить на стороне проекта.
 */
// Статические файлы (клиент игры по манифесту, обновления лаунчера) отдаёт обычный веб-сервер проекта, не API.
// TODO(cdn-url): боевой адрес — предположение. Для разработки: L4_CDN_URL=http://127.0.0.1:8080
const CDN = (process.env.L4_CDN_URL || 'https://cdn.4onerp.com').replace(/\/+$/, '');

module.exports = {
  appName: '4ONE Launcher',
  protocol: 'gta4one',                       // gta4one://auth/callback?code=…&state=… (возврат из браузера после входа)
  mock: process.env.L4_MOCK === '1' || process.argv.includes('--mock'),
  mockScenario: process.env.L4_MOCK_SCENARIO || 'ready',
  devtools: process.env.L4_DEVTOOLS === '1',

  site: {
    base: 'https://www.4onerp.com',
  },

  /**
   * Единый API 4ONE (backend/core-api): OAuth для лаунчера и сайта, профиль и роль из игровой БД.
   * Адрес API: пока бесплатное имя sslip.io (указывает на VDS игры, сертификат Let's Encrypt), когда появится DNS api.4onerp.com — сменить здесь и выпустить новую версию. Для разработки: L4_CORE_URL=http://127.0.0.1:8787
   */
  core: {
    url: (process.env.L4_CORE_URL || 'https://188-130-132-47.sslip.io').replace(/\/+$/, ''),
    clientId: '4one-launcher',
    redirectUri: 'gta4one://auth/callback',
    timeoutMs: 12000,
    loginTimeoutMs: 10 * 60 * 1000,          // сколько ждём возврата из браузера
    profileRefreshMs: 5 * 60 * 1000,         // как часто перечитываем роль (уровень админки мог измениться)
  },

  /** Статика: manifest.json + files/… клиента игры */
  cdn: {
    base: CDN,
    clientBase: `${CDN}/client`,
  },

  updates: {
    // релизы лаунчера (v*) на GitHub: latest.yml + Setup.exe; релиз с комплектом клиента (client-*) помечен prerelease и не мешает
    github: { owner: '4one-rp-dev', repo: 'launcher' },
  },

  game: {
    legacyVersion: '1.0.3889.0',
    steamAppId: '271590',
    epicAppId: '9d2d0eb64d5c44529cece33fe2a46482',
    exe: 'GTA5.exe',
    enhancedExe: 'GTA5_Enhanced.exe',
    /** Запуск через платформы */
    steamUri: 'steam://rungameid/271590',
    epicUri: 'com.epicgames.launcher://apps/9d2d0eb64d5c44529cece33fe2a46482?action=launch&silent=true',
    /** Серверный адрес по умолчанию, если в bootstrap нет серверов (dev) */
    fallbackServer: { id: 'dev', name: '4ONE RP', tag: 'DEV', address: '127.0.0.1:22005', max: 500 },
  },

  /** Куда разрешено уходить по внешним ссылкам из интерфейса (ключ -> URL) */
  links: {
    site: 'https://www.4onerp.com/',
    cabinet: 'https://www.4onerp.com/',          // TODO(links): точный путь личного кабинета
    news: 'https://www.4onerp.com/',             // TODO(links): раздел «Новости»
    kb: 'https://www.4onerp.com/',               // TODO(links): «База знаний»
    forum: 'https://www.4onerp.com/',            // TODO(links): «Форум»
    donate: 'https://www.4onerp.com/',           // TODO(links): «Донат»
    support: 'https://www.4onerp.com/',          // TODO(links): «Поддержка»
    discord: 'https://www.4onerp.com/',          // TODO(links): инвайт Discord
  },
  /** Хосты, на которые openExternal разрешён для http(s)-ссылок из данных сервера (новости) */
  externalHostAllowlist: ['www.4onerp.com', '4onerp.com', 'discord.gg', 'discord.com', 't.me'],
};
