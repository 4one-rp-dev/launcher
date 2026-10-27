'use strict';
/** Проверка настроек и живой БД одной командой: npm run doctor. Ничего не меняет. */
const { load } = require('./config');

async function main() {
  require('./dotenv').loadDotEnv();
  const out = []; let bad = 0;
  const line = (ok, text) => { out.push(`${ok ? '✔' : '✖'} ${text}`); if (!ok) bad++; };
  let config;
  try { config = load(); line(true, `настройки: БД ${config.db.name} на ${config.db.host}:${config.db.port}, пользователь ${config.db.user || '(не задан)'}`); }
  catch (e) { console.log(`✖ настройки: ${e.message}`); process.exit(1); }
  line(true, config.pepper === config.secret ? 'CORE_PEPPER не задан отдельно (используется CORE_SECRET) — лучше задать свой' : 'CORE_PEPPER задан');
  line(Object.keys(config.clients).length > 0, `OAuth-клиенты: ${Object.keys(config.clients).join(', ')}`);
  line(true, `CORS-источники сайта: ${config.corsOrigins.join(', ') || '— (сайт без запросов из браузера)'}`);
  line(config.internalToken.length >= 16 || !config.internalToken, config.internalToken ? 'CORE_INTERNAL_TOKEN задан' : 'CORE_INTERNAL_TOKEN не задан: онлайн серверов обновлять нечем');

  let conn;
  try {
    conn = await require('mysql2/promise').createConnection({ host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password, database: config.db.name });
    line(true, 'подключение к MariaDB');
    const [tables] = await conn.query('SHOW TABLES');
    const have = new Set(tables.map((r) => Object.values(r)[0]));
    for (const t of ['accounts', 'characters', 'banned']) line(have.has(t), `таблица игры ${t}`);
    for (const t of ['core_oauth_codes', 'core_oauth_sessions', 'core_oauth_tokens', 'core_servers', 'core_news', 'core_settings', 'core_promos', 'core_promo_redeems', 'core_wallet_tx', 'core_login_events']) line(have.has(t), `таблица ${t}${have.has(t) ? '' : ' — выполните npm run migrate'}`);
    if (have.has('accounts')) {
      const [col] = await conn.query("SHOW COLUMNS FROM accounts LIKE 'alvl'");
      line(col.length > 0, 'колонка accounts.alvl (уровень администрации)' + (col.length ? '' : ' — нет: npm run migrate или gamemod/database/migrations/009'));
      const [[n]] = await conn.query('SELECT COUNT(*) AS n FROM accounts');
      line(true, `аккаунтов в игре: ${n.n}`);
      if (col.length) { const [[a]] = await conn.query('SELECT COUNT(*) AS n FROM accounts WHERE alvl > 0'); line(true, `администраторов (alvl > 0): ${a.n}`); }
    }
    if (have.has('core_servers')) { const [[s]] = await conn.query('SELECT COUNT(*) AS n FROM core_servers WHERE published = 1'); line(s.n > 0, `серверов в каталоге: ${s.n}${s.n ? '' : ' — добавьте (sql/seed.example.sql)'}`); }
  } catch (e) { line(false, `подключение к БД: ${e.code || e.message}`); }
  finally { if (conn) await conn.end(); }
  console.log(out.join('\n')); console.log(bad ? `\nПроблем: ${bad}` : '\nВсё в порядке');
  process.exit(bad ? 1 : 0);
}
if (require.main === module) main();
