-- 4ONE Core API: двухфакторная защита (TOTP и резервные коды). После 002_content.sql.
-- Таблицу accounts не меняет. Секрет хранится зашифрованным (AES-256-GCM, ключ из CORE_SECRET):
-- смена CORE_SECRET делает включённую 2FA нерабочей — её придётся отключить вручную (DELETE ниже) и включить заново.

CREATE TABLE IF NOT EXISTS `core_mfa` (
  `login`       VARCHAR(50)  CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `secret_enc`  VARCHAR(255) NULL,                           -- включённый секрет: v1.iv.tag.шифротекст (base64url)
  `pending_enc` VARCHAR(255) NULL,                           -- секрет после setup, ждёт подтверждения кодом
  `pending_at`  DATETIME     NULL,
  `enabled_at`  DATETIME     NULL,                           -- NULL — 2FA не включена
  `last_step`   BIGINT       NOT NULL DEFAULT 0,             -- последний принятый 30-секундный шаг: защита от повтора кода
  `updated_at`  DATETIME     NOT NULL,
  PRIMARY KEY (`login`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Резервные коды: только sha256 с перцем, каждый одноразовый (used_at)
CREATE TABLE IF NOT EXISTS `core_mfa_backup` (
  `login`      VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `code_hash`  CHAR(64)    NOT NULL,
  `created_at` DATETIME    NOT NULL,
  `used_at`    DATETIME    NULL,
  PRIMARY KEY (`login`, `code_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Права пользователя БД для API (дополнение к 001 и 002, под root):
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ra3_main.core_mfa TO 'core_api'@'127.0.0.1';
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ra3_main.core_mfa_backup TO 'core_api'@'127.0.0.1';
-- Отключить 2FA игроку вручную (потерял телефон и коды):
--   DELETE FROM ra3_main.core_mfa_backup WHERE login = '…'; DELETE FROM ra3_main.core_mfa WHERE login = '…';
