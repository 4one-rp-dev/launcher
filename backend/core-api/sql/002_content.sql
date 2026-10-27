-- 4ONE Core API: серверы, новости, настройки, промокоды лаунчера, кошелёк, история входов. После 001_core_api.sql.
-- Заменяет таблицы Supabase (launcher_servers, launcher_news, launcher_promos…): Supabase больше не нужен.

CREATE TABLE IF NOT EXISTS `core_servers` (
  `id`          VARCHAR(40)  NOT NULL,
  `name`        VARCHAR(80)  NOT NULL,
  `tag`         VARCHAR(16)  NOT NULL DEFAULT '',
  `status`      ENUM('online','offline','maintenance') NOT NULL DEFAULT 'offline',
  `online`      INT          NOT NULL DEFAULT 0,
  `max_players` INT          NOT NULL DEFAULT 0,
  `address`     VARCHAR(80)  NOT NULL DEFAULT '',          -- host:port для подключения лаунчера
  `version`     VARCHAR(24)  NOT NULL DEFAULT '',
  `description` VARCHAR(300) NOT NULL DEFAULT '',
  `recommended` TINYINT(1)   NOT NULL DEFAULT 0,           -- блок «Рекомендуем новичкам»
  `sort`        INT          NOT NULL DEFAULT 0,
  `published`   TINYINT(1)   NOT NULL DEFAULT 1,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `core_news` (
  `id`           BIGINT       NOT NULL AUTO_INCREMENT,
  `title`        VARCHAR(160) NOT NULL,
  `excerpt`      VARCHAR(400) NOT NULL DEFAULT '',
  `category`     ENUM('news','events','updates','laws','rules','announce') NOT NULL DEFAULT 'news',
  `cover`        VARCHAR(200) NOT NULL DEFAULT '',        -- имя из assets/news лаунчера или https-ссылка
  `url`          VARCHAR(300) NOT NULL DEFAULT '',        -- только https и хосты из allowlist лаунчера
  `published_at` DATE         NOT NULL,
  `published`    TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `idx_news_date` (`published`, `published_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ключи: client = {"version","manifestUrl","notes"}, notice = текст объявления, flags = {"имя":true}
CREATE TABLE IF NOT EXISTS `core_settings` (
  `k` VARCHAR(40) NOT NULL,
  `v` TEXT        NOT NULL,
  PRIMARY KEY (`k`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Промокоды лаунчера (не путать с promocodes_new/bonuscodes игры: те погашаются внутри игры). Награда — 4Coin.
CREATE TABLE IF NOT EXISTS `core_promos` (
  `code`       VARCHAR(24)  NOT NULL,                      -- A–Z, 0–9 и «-»
  `title`      VARCHAR(120) NOT NULL,
  `amount`     INT UNSIGNED NOT NULL,                      -- 4Coin
  `enabled`    TINYINT(1)   NOT NULL DEFAULT 1,
  `expires_at` DATETIME     NULL,
  `max_uses`   INT UNSIGNED NULL,
  `used_count` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Журнал кошелька. Строка с applied_at IS NULL и amount > 0 — зачисление, которое ещё не применила игра:
-- 4Coin в accounts.redbucks зачисляет игровой сервер (Core/CoreRewards.cs), API баланс не трогает.
CREATE TABLE IF NOT EXISTS `core_wallet_tx` (
  `id`         BIGINT       NOT NULL AUTO_INCREMENT,
  `login`      VARCHAR(50)  CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `at`         DATETIME     NOT NULL,
  `title`      VARCHAR(120) NOT NULL,
  `amount`     INT          NOT NULL,
  `source`     VARCHAR(16)  NOT NULL DEFAULT 'promo',
  `ref`        VARCHAR(48)  NOT NULL DEFAULT '',
  `applied_at` DATETIME     NULL,
  PRIMARY KEY (`id`),
  KEY `idx_wallet_login` (`login`, `at`),
  KEY `idx_wallet_pending` (`applied_at`, `amount`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `core_promo_redeems` (
  `code`  VARCHAR(24) NOT NULL,
  `login` VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `at`    DATETIME    NOT NULL,
  `tx_id` BIGINT      NOT NULL,
  PRIMARY KEY (`code`, `login`),                           -- один код на аккаунт: гонка двух запросов упирается в ключ
  KEY `idx_redeems_login` (`login`, `at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- История входов: IP хранится уже маскированным (203.0.113.x)
CREATE TABLE IF NOT EXISTS `core_login_events` (
  `id`      BIGINT      NOT NULL AUTO_INCREMENT,
  `login`   VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `at`      DATETIME    NOT NULL,
  `device`  VARCHAR(80) NOT NULL DEFAULT '',
  `ip_mask` VARCHAR(45) NOT NULL DEFAULT '',
  `method`  VARCHAR(16) NOT NULL DEFAULT 'launcher',
  `ok`      TINYINT(1)  NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_events_login` (`login`, `at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Права пользователя БД для API (дополнение к 001, под root):
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ra3_main.core_servers TO 'core_api'@'127.0.0.1';
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ra3_main.core_news TO 'core_api'@'127.0.0.1';
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ra3_main.core_settings TO 'core_api'@'127.0.0.1';
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ra3_main.core_promos TO 'core_api'@'127.0.0.1';
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ra3_main.core_promo_redeems TO 'core_api'@'127.0.0.1';
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ra3_main.core_login_events TO 'core_api'@'127.0.0.1';
--   GRANT SELECT, INSERT ON ra3_main.core_wallet_tx TO 'core_api'@'127.0.0.1';
-- Игровому пользователю БД (redage): SELECT и UPDATE (applied_at) на core_wallet_tx — для Core/CoreRewards.cs.
