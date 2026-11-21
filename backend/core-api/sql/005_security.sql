-- 4ONE Core API: защита аккаунта (трекер входов, трейд-бан на новом устройстве) и сброс пароля через сайт. После 004_signup.sql.
--
-- Таблицы account_security, account_devices, account_logins принадлежат ИГРОВОМУ МОДУ (миграция мода database/migrations/018_login_tracker.sql,
-- мод создаёт их и при старте). Применить её раньше этого файла. Время во всех трёх таблицах — UTC.
--   account_security  : login (PK), disable_after (NULL — защита включена; в будущем — отключение отложено; в прошлом — выключена),
--                       trade_ban_until, trade_ban_reason, force_logout_at, updated_at, updated_by
--   account_devices   : (login, hwid) — известные устройства; trusted=1 — доверенное (прожило срок бана без сбросов)
--   account_logins    : журнал попыток входа в ИГРУ (ip, hwid, socialclub, ok, reason, new_device)
-- Core API: читает всё три, пишет в account_security (переключатель, force_logout_at) и сбрасывает доверие устройств при смене пароля.
--
-- Токены сброса пароля. В БД только sha256 токена с перцем; одноразовые, живут 30 минут.
CREATE TABLE IF NOT EXISTS `core_password_resets` (
  `token_hash` CHAR(64)    NOT NULL,
  `login`      VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `created_at` DATETIME    NOT NULL,
  `expires_at` DATETIME    NOT NULL,
  `used_at`    DATETIME    NULL,
  PRIMARY KEY (`token_hash`),
  KEY `idx_login` (`login`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Права пользователя БД для API (под root):
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ra3main.core_password_resets TO 'core_api'@'127.0.0.1';
--   GRANT SELECT, UPDATE ON ra3main.account_security TO 'core_api'@'127.0.0.1';
--   GRANT SELECT ON ra3main.account_devices TO 'core_api'@'127.0.0.1';
--   GRANT UPDATE (trusted, distrust_at) ON ra3main.account_devices TO 'core_api'@'127.0.0.1';
--   GRANT INSERT ON ra3main.account_security TO 'core_api'@'127.0.0.1';
--   GRANT SELECT ON ra3main.account_logins TO 'core_api'@'127.0.0.1';
--   GRANT UPDATE (`password`) ON ra3main.accounts TO 'core_api'@'127.0.0.1';   -- только колонка пароля: сброс через сайт
-- Смена пароля API — единственная запись в accounts, кроме регистрации. Игра при сохранении не должна затирать пароль старым
-- значением из памяти (мод пишет password только после собственной смены пароля).
