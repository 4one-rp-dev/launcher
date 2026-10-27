# Бэкенд лаунчера (Supabase)

Предложение для проекта 4ONE: таблицы и Edge Functions, которых ждёт лаунчер (`docs/API.md`). **Не развёртывалось и не запускалось** — проверьте на тестовом проекте.

## Развёртывание
```bash
supabase link --project-ref <ref>
supabase db push                                    # migrations/20261026000000_launcher.sql
supabase secrets set LAUNCHER_PEPPER="$(openssl rand -hex 32)"
supabase functions deploy exchange-launcher-code validate-launcher-session revoke-launcher-session \
  launcher-bootstrap redeem-launcher-code launcher-codes-history issue-launcher-code
```
`config.toml` — фрагмент настроек `verify_jwt` (перенесите в ваш `supabase/config.toml`). `LAUNCHER_PEPPER` менять нельзя без сброса всех сессий и кодов: хэши зависят от него.

## Подгонка под БД сайта (`TODO(site-db)`)
1. `launcher_profile_v` — вид, из которого берётся профиль. Сейчас: `auth.users` + `launcher_accounts`. Замените на таблицы сайта (ник, роль, баланс, статус аккаунта, доступ к лаунчеру).
2. `launcher_credit_4coin(user, amount, reason)` — как начислять 4Coin. Сейчас пишет в `launcher_accounts.balance4c`; подключите вашу транзакционную таблицу.
3. Выдача `vehicle/item` из промокодов — в `launcher_redeem_promo`.

## Сайт
Кнопка «Получить код для лаунчера» в личном кабинете: `supabase.functions.invoke('issue-launcher-code')` → показать `data.code` и ссылку `gta4one://auth?code=<код>` (код живёт 10 минут, один раз).

## Админка (минимум)
Серверы — `launcher_servers`; новости — `launcher_news`; версия клиента — `launcher_client_releases` (одна активная на канал); объявление — `launcher_config.notice` (строка или `null`); промокоды — `promo_codes`. Онлайн серверов обновляйте из игрового сервера (`update launcher_servers set online=…, status=…`).

## Проверка после развёртывания
1. `exchange-launcher-code` с неверным кодом → `{"error":"invalid_code"}`; повторный обмен того же кода → `code_already_used`.
2. 11 запросов подряд → `busy` (HTTP 429).
3. Отозванная сессия → `session_revoked` при `validate-launcher-session`.
4. Два одновременных `redeem` одного кода одним игроком при `per_user=1` → один успех, один `promo_used`.
