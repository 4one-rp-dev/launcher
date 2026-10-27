-- 4ONE Core API: таблицы OAuth. Выполняется один раз под пользователем БД геймода (ra3_main).
-- По правилам проекта лежит и в gamemod/database/migrations (раннер scripts/db/migrate.sh) — номер подберите по порядку.
-- В таблицах только хеши (sha256 с перцем): сами коды и токены не хранятся.

CREATE TABLE IF NOT EXISTS `core_oauth_codes` (
  `code_hash`    CHAR(64)     NOT NULL,
  `login`        VARCHAR(50)  CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `client_id`    VARCHAR(64)  NOT NULL,
  `redirect_uri` VARCHAR(300) NOT NULL,
  `challenge`    VARCHAR(128) NOT NULL,
  `device`       VARCHAR(80)  NOT NULL DEFAULT '',
  `expires_at`   DATETIME     NOT NULL,
  `used_at`      DATETIME     NULL,
  PRIMARY KEY (`code_hash`),
  KEY `idx_codes_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS `core_oauth_sessions` (
  `id`                CHAR(32)    NOT NULL,
  `login`             VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `client_id`         VARCHAR(64) NOT NULL,
  `device`            VARCHAR(80) NOT NULL DEFAULT '',
  `refresh_hash`      CHAR(64)    NOT NULL,
  `prev_refresh_hash` CHAR(64)    NULL,
  `created_at`        DATETIME    NOT NULL,
  `last_seen_at`      DATETIME    NOT NULL,
  `expires_at`        DATETIME    NOT NULL,
  `revoked_at`        DATETIME    NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sessions_refresh` (`refresh_hash`),
  KEY `idx_sessions_prev` (`prev_refresh_hash`),
  KEY `idx_sessions_login` (`login`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS `core_oauth_tokens` (
  `token_hash` CHAR(64)    NOT NULL,
  `session_id` CHAR(32)    NOT NULL,
  `login`      VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `expires_at` DATETIME    NOT NULL,
  PRIMARY KEY (`token_hash`),
  KEY `idx_tokens_session` (`session_id`),
  KEY `idx_tokens_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Уровень администрации: колонка accounts.alvl (0–8). Её же читает и пишет игра (gamemod, миграция 009, Core/AdminAuth.cs).
-- БД платформы FloV:MP не используется. Команда идемпотентна: если колонка уже есть, ничего не меняется.
ALTER TABLE `accounts` ADD COLUMN IF NOT EXISTS `alvl` TINYINT UNSIGNED NOT NULL DEFAULT 0;

-- Права отдельного пользователя БД для API (под root, один раз; пароль подставьте свой). Одна база — ra3_main:
--   CREATE USER 'core_api'@'127.0.0.1' IDENTIFIED BY '<пароль>';
--   GRANT SELECT ON ra3_main.accounts TO 'core_api'@'127.0.0.1';
--   GRANT SELECT ON ra3_main.characters TO 'core_api'@'127.0.0.1';
--   GRANT SELECT ON ra3_main.banned TO 'core_api'@'127.0.0.1';
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ra3_main.core_oauth_codes TO 'core_api'@'127.0.0.1';
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ra3_main.core_oauth_sessions TO 'core_api'@'127.0.0.1';
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ra3_main.core_oauth_tokens TO 'core_api'@'127.0.0.1';
-- Остальные core_* — см. конец 002_content.sql. API ничего не пишет в accounts и не меняет пароли и уровни.
