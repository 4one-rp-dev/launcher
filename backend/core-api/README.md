# 4ONE Core API

Единый API проекта для **лаунчера и сайта**: вход (OAuth 2.0), профиль и роль, каталог (серверы, новости), промокоды, данные аккаунта.
Node 20+, одна зависимость (`mysql2`). Supabase и БД платформы FloV:MP **не используются**.

## Одна БД
Всё лежит в **одной базе — игровой MariaDB `ra3main`**:

| Что | Где |
|---|---|
| логин, почта, хеш пароля, Social Club, 4Coin (`redbucks`), VIP | `accounts` (таблица игры) |
| **уровень администрации `alvl` (0–8)** | `accounts.alvl` — колонка той же таблицы; её читает и пишет игра (`Core/AdminAuth.cs`, миграция gamemod `009`) |
| персонажи, баны | `characters`, `banned` (только чтение) |
| OAuth-сессии, серверы, новости, промокоды, кошелёк, история входов | свои таблицы `core_*` (`sql/`) |

БД платформы FloV:MP (`flovmp_server`) — это отдельный продукт со своими правами; API с ней не работает, уровни не синхронизируются.
API **не меняет** строки игры (пароли, уровни, баланс): пишет в свои `core_*`. Единственное исключение — регистрация: `INSERT` новой строки `accounts` в том же виде, что делает игра (`sql/004_signup.sql`).

## Запуск за 5 минут
**Без БД (для разработки сайта и лаунчера):**
```bash
npm i && npm run dev        # http://127.0.0.1:8787, данные из dev-seed.json
```
Тестовые аккаунты: `player / player123` (игрок), `admin / admin123` (администратор 5 ур.), `owner / owner123` (8 ур.); промокод `WELCOME4`.

**На живой БД:**
```bash
cp .env.example .env   # заполнить; затем:
npm run migrate        # создаёт core_* и колонку accounts.alvl (учётка с правами DDL, например root)
npm run doctor         # проверка настроек и БД: ✔/✖ по каждому пункту
npm start
```
Пользователь БД для работы API (права только на нужное) — в конце `sql/001_core_api.sql`, `002_content.sql`, `003_mfa.sql` и `004_signup.sql` (для регистрации: `GRANT INSERT ON ra3main.accounts`).
Стартовые значения нового аккаунта (как `MoneySettings` игры): `CORE_SIGNUP_REDBUCKS` — 4Coin, `CORE_SIGNUP_VIP_LVL` — уровень VIP, `CORE_SIGNUP_VIP_DAYS` — дней VIP; по умолчанию 0. Первый владелец: `UPDATE accounts SET alvl = 8 WHERE login = '…';` (или `scripts/db/make-owner.sql` в gamemod).

## Роли
`role.title`: «Игрок» (alvl 0) или «Администратор n уровня»; `role.rank` — ранг из игры (`Core/AdminRanks.cs`). `permissions[]` — права по уровню (`src/roles.js`):
`admin.panel` ≥1, `players.view` ≥2, `players.moderate` ≥3, `logs.view` ≥5, `logs.export` ≥6, `project.manage` ≥6, `staff.manage` ≥7, `owner` 8. Пороги — предложение, меняются в одном месте.
Уровень читается из БД при каждом `GET /v1/me`: смена уровня видна без перелогина.

## Эндпоинты
| | |
|---|---|
| `GET /oauth/authorize` | страница входа (HTML) в браузере. Параметры: `response_type=code`, `client_id`, `redirect_uri`, `state`, `code_challenge`, `code_challenge_method=S256`, необязательно `device_name` |
| `POST /oauth/authorize` | форма; успех → возврат на `redirect_uri?code=…&state=…`. Если у аккаунта включена 2FA — вместо возврата страница второго шага (поле кода, подписанный `mtx` на 5 минут); её POST `{mtx, code}` на тот же адрес → обычный возврат с кодом |
| `POST /v1/auth/login` `{client_id, login, password, device_name}` | прямой вход (только клиенты с `trusted: true`). Без 2FA → те же токены, что `/oauth/token`; с 2FA → `{mfa_required:true, mfa_token, methods:['totp','backup']}` (токен 5 минут, сессии ещё нет). Ошибки: `invalid_client` 400, `invalid_credentials` 401, `rate_limited` 429 |
| `POST /v1/auth/register` `{client_id, login, email, password, promo?, device_name}` | регистрация игрового аккаунта (только `trusted: true`). Проверки и тексты ошибок — как в игре (`Accounts/Registration/Repository.cs`): логин `^[A-Za-z][A-Za-z0-9_]{2,23}$`, пароль 8–64 печатных ASCII без пробелов с буквой и цифрой, почта до 64 знаков, промокод `^[A-Za-z0-9_-]{1,16}$`. Как игра, логин, почта и промокод сохраняются в нижнем регистре, пустой промокод — `noref`; SocialClub и HWID пустые (игра привяжет при первом входе). Успех — **201** и те же токены, что у `/v1/auth/login` (сессия, событие входа). Ошибки: `invalid_client` 400; `invalid_login`/`invalid_password`/`invalid_email`/`invalid_promo` 400; `login_taken`/`email_taken` 409 (без учёта регистра); `rate_limited` 429 (3 регистрации и 20 попыток с IP за час) |
| `POST /v1/auth/mfa` `{client_id, mfa_token, code}` | второй шаг: 6 цифр TOTP или резервный `XXXX-XXXX` (регистр и дефис не важны) → токены. Ошибки: `invalid_mfa_code` 401, `mfa_expired` 400 (истёк, подделан, другой клиент, 5 неверных попыток на токен), `rate_limited` 429 (10 неверных кодов на логин за 10 минут) |
| `POST /oauth/token` | `authorization_code` (+`code_verifier`) или `refresh_token` → `{ access_token, refresh_token, expires_in:900 }` |
| `POST /oauth/revoke` | отзыв по access- или refresh-токену |
| `GET /v1/me` | профиль и роль (`Authorization: Bearer`) |
| `GET /v1/bootstrap` | **без токена**: `{ servers[], news[], client{version,manifestUrl,notes}, notice, flags }` |
| `POST /v1/codes/redeem` `{code}` · `GET /v1/codes/history` | промокоды; ошибки `promo_not_found` 404, `promo_expired` 410, `promo_used`/`promo_limit` 409, `busy` 429 |
| `GET /v1/account/security\|sessions\|history\|wallet\|characters` | раздел «Аккаунт» |
| `POST /v1/account/sessions/revoke` `{id}` · `/sessions/revoke-others` | завершить чужую сессию / все остальные |
| `GET /v1/account/2fa` | `{data:{enabled, pending, backupLeft, enabledAt}}` |
| `POST /v1/account/2fa/setup` | `{data:{secret, otpauth}}` — новый ожидающий секрет (заменяет прежний); если 2FA включена — `mfa_already_enabled` 409 |
| `POST /v1/account/2fa/enable` `{code}` | код из приложения → `{data:{enabled:true, backupCodes:[10]}}` (коды показываются один раз); `invalid_mfa_code` 401, `mfa_not_pending` 409 |
| `POST /v1/account/2fa/disable` `{code}` | TOTP или резервный → `{data:{enabled:false}}`; `invalid_mfa_code` 401, `mfa_not_enabled` 409 |
| `POST /v1/account/2fa/backup` `{code}` | только TOTP → `{data:{backupCodes:[10]}}`, старые коды сгорают; `invalid_mfa_code` 401, `mfa_not_enabled` 409. У enable/disable/backup общий лимит с входом: `rate_limited` 429 |
| `GET /v1/admin/capabilities` | каталог прав; только с `admin.panel` |
| `POST /v1/internal/servers/<id>/stats` | `{ online, max, status }` от игры или cron, заголовок `X-Internal-Token` (= `CORE_INTERNAL_TOKEN`, от 16 знаков) |
| `GET /healthz` | живость |

Короткий гайд (подключение, правка данных) — **`DEV_GUIDE.md`**. Подключение сайта — **`INTEGRATION.md`**.

## Как зачисляются 4Coin
API **не меняет `accounts.redbucks`**: онлайн-игрок хранит баланс в памяти сервера, и запись в БД он перезатёр бы. Промокод кладёт строку в `core_wallet_tx` (`applied_at IS NULL`), игровой сервер раз в 15 секунд применяет её (gamemod, `Core/CoreRewards.cs`): в сети — через `UpdateData.RedBucks`, не в сети — `redbucks += сумма`. До применения баланс в профиле уже показывается с этой суммой. **Без `CoreRewards` в игре промокоды 4Coin в игру не дойдут.**

## Что не из игры
Серверы, новости, версия клиента и объявление — в `core_*`, сейчас заполняются SQL (`sql/seed.example.sql`), позже — вкладкой «Администрирование». Онлайн обновляет `POST /v1/internal/servers/<id>/stats`.
История кошелька — только операции через Core API; внутриигровые списания в `mainlogs`. В `accounts` нет подтверждения почты — в «Безопасности» показывается как «нет». 2FA хранится в своих таблицах `core_mfa`, `core_mfa_backup` (`sql/003_mfa.sql`), `security.twoFactor` — включена ли она на самом деле. **Игра 2FA не спрашивает**: вход в игру по-прежнему по паролю из `accounts`.
Статику (файлы клиента, обновления лаунчера) отдаёт обычный веб-сервер (nginx), не API.

## Безопасность
Authorization Code + PKCE (S256 обязателен), `state`; форма входа подписана (HMAC); код одноразовый (условный UPDATE), 2 минуты; токены 256 бит, в БД только sha256 с перцем; access 15 минут; refresh 60 дней, **вращается**, повтор старого отзывает сессию; перебор: 5 неудач на логин+IP и 30 на IP за 10 минут, ответы одинаковы для «нет логина» и «неверный пароль»; `no-store`, CSP на странице входа; тело до 8 КБ; CORS только для адресов возврата сайта и `CORE_CORS_ORIGINS`. 2FA: TOTP по RFC 6238 (SHA1, 6 цифр, 30 с, окно ±1 шаг), принятый шаг запоминается (`last_step`, условный UPDATE) — один код дважды не пройдёт; секрет 20 байт в БД зашифрован AES-256-GCM ключом из `CORE_SECRET` (**смена `CORE_SECRET` ломает включённую 2FA** — её придётся сбросить, см. конец `sql/003_mfa.sql`); резервные коды — 10 одноразовых, в БД только хеши с перцем. Лимитер в памяти процесса — при нескольких экземплярах API вынести в общее хранилище.

## Не проверено
Работа с живой MariaDB: все запросы проверены только парсером синтаксиса MariaDB и тестами на памяти (песочница не даёт запустить БД). Перед боем: `npm run migrate`, `npm run doctor`, вход тестовым аккаунтом. Также: боевой адрес и TLS, `Core/CoreRewards.cs` в игре (не компилировался).
