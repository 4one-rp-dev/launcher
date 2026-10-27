'use strict';
/**
 * Применяет sql/*.sql по порядку и помнит применённые в таблице core_migrations.
 * Запуск (учётка с правами DDL, например root): CORE_DB_USER=root CORE_DB_PASSWORD=… CORE_STORE=mysql CORE_SECRET=x… npm run migrate
 */
const fs = require('fs');
const path = require('path');
const { load } = require('./config');

async function migrate({ conn, dir = path.join(__dirname, '..', 'sql'), log = console.log }) {
  await conn.query('CREATE TABLE IF NOT EXISTS `core_migrations` (`name` VARCHAR(80) NOT NULL, `applied_at` DATETIME NOT NULL, PRIMARY KEY (`name`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
  const [done] = await conn.query('SELECT name FROM core_migrations');
  const have = new Set(done.map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  const applied = [];
  for (const f of files) {
    if (have.has(f)) { log(`= ${f} (уже применена)`); continue; }
    await conn.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    await conn.query('INSERT INTO core_migrations (name, applied_at) VALUES (?, NOW())', [f]);
    log(`+ ${f}`); applied.push(f);
  }
  return applied;
}

async function main() {
  require('./dotenv').loadDotEnv();
  const config = load();
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password,
    database: config.db.name, multipleStatements: true, charset: 'utf8mb4',
  });
  try { const a = await migrate({ conn }); console.log(a.length ? `Готово: применено ${a.length}` : 'Новых миграций нет'); }
  finally { await conn.end(); }
}

if (require.main === module) main().catch((e) => { console.error('Ошибка миграции:', e.message); process.exit(1); });
module.exports = { migrate };
