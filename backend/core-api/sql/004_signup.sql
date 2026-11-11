-- 4ONE Core API: регистрация игрового аккаунта через API (POST /v1/auth/register). После 003_mfa.sql.
-- Схему не меняет: API добавляет в accounts новую строку в том же виде, что игра (Accounts/Registration/Repository.cs).
-- Уникальность логина и почты без учёта регистра обеспечивает API (GET_LOCK '4one_core_signup'), ключи accounts не трогаем.
-- Раннеру нужна хотя бы одна команда, иначе пустой запрос — ошибка:
DO 0;

-- Права пользователя БД для API (дополнение к 001–003, выполнить под root):
--   GRANT INSERT ON ra3main.accounts TO 'core_api'@'127.0.0.1';
-- Проверка: npm run doctor — строка «право INSERT на accounts».
-- Стартовые 4Coin и VIP нового аккаунта — переменные CORE_SIGNUP_REDBUCKS, CORE_SIGNUP_VIP_LVL, CORE_SIGNUP_VIP_DAYS (см. README).
