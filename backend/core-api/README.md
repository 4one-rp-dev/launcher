# 4ONE Core API

Единый API проекта для **лаунчера и сайта**: вход (OAuth 2.0), профиль и роль, каталог (серверы, новости), промокоды, данные аккаунта.
Node 20+, одна зависимость (`mysql2`). Supabase и БД платформы FloV:MP **не используются**.

## Одна БД
Всё лежит в **одной базе — игровой MariaDB `ra3_main`**:

| Что | Где |
|---|---|
| логин, почта, хеш пароля, Social Club, 4Coin (`redbucks`), VIP | `accounts` (таблица игры) |
| **уровень администрации `alvl` (0–8)** | `accounts.alvl` — колонка той же таблицы; её читает и пишет игра (`Core/AdminAuth.cs`, миграция gamemod `009`) |
| персонажи, баны | `characters`, `banned` (только чтение) |
| OAuth-сессии, серверы, новости, промокоды, кошелёк, история входов | свои таблицы `core_*` (`sql/`) |

БД платформы FloV:MP (`flovmp_server`) — это отдельный продукт со своими правами; API с ней не работает, уровни не синхронизируются.
API **не пишет** в таблицы игры (пароли, уровни, баланс): только в свои `core_*`.

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
Пользователь БД для работы API (права только на нужное) — в конце `sql/001_core_api.sql` и `sql/002_content.sql`. Первый владелец: `UPDATE accounts SET alvl = 8 WHERE login = '…';` (или `scripts/db/make-owner.sql` в gamemod).

## Роли
`role.title`: «Игрок» (alvl 0) или «Администратор n уровня»; `role.rank` — ранг из игры (`Core/AdminRanks.cs`). `permissions[]` — права по уровню (`src/roles.js`):
`admin.panel` ≥1, `players.view` ≥2, `players.moderate` ≥3, `logs.view` ≥5, `logs.export` ≥6, `project.manage` ≥6, `staff.manage` ≥7, `owner` 8. Пороги — предложение, меняются в одном месте.
Уровень читается из БД при каждом `GET /v1/me`: смена уровня видна без перелогина.

## Эндпоинты
| | |
|---|---|
| `GET /oauth/authorize` | страница входа (HTML) в браузере. Параметры: `response_type=code`, `client_id`, `redirect_uri`, `state`, `code_challenge`, `code_challenge_method=S256`, необязательно `device_name` |
| `POST /oauth/authorize` | форма; успех → возврат на `redirect_uri?code=…&state=…` |
| `POST /oauth/token` | `authorization_code` (+`code_verifier`) или `refresh_token` → `{ access_token, refresh_token, expires_in:900 }` |
| `POST /oauth/revoke` | отзыв по access- или refresh-токену |
| `GET /v1/me` | профиль и роль (`Authorization: Bearer`) |
| `GET /v1/bootstrap` | **без токена**: `{ servers[], news[], client{version,manifestUrl,notes}, notice, flags }` |
| `POST /v1/codes/redeem` `{code}` · `GET /v1/codes/history` | промокоды; ошибки `promo_not_found` 404, `promo_expired` 410, `promo_used`/`promo_limit` 409, `busy` 429 |
| `GET /v1/account/security\|sessions\|history\|wallet\|characters` | раздел «Аккаунт» |
| `POST /v1/account/sessions/revoke` `{id}` · `/sessions/revoke-others` | завершить чужую сессию / все остальные |
| `GET /v1/admin/capabilities` | каталог прав; только с `admin.panel` |
| `POST /v1/internal/servers/<id>/stats` | `{ online, max, status }` от игры или cron, заголовок `X-Internal-Token` (= `CORE_INTERNAL_TOKEN`, от 16 знаков) |
| `GET /healthz` | живость |

Короткий гайд (подключение, правка данных) — **`DEV_GUIDE.md`**. Подключение сайта — **`INTEGRATION.md`**.

## Как зачисляются 4Coin
API **не меняет `accounts.redbucks`**: онлайн-игрок хранит баланс в памяти сервера, и запись в БД он перезатёр бы. Промокод кладёт строку в `core_wallet_tx` (`applied_at IS NULL`), игровой сервер раз в 15 секунд применяет её (gamemod, `Core/CoreRewards.cs`): в сети — через `UpdateData.RedBucks`, не в сети — `redbucks += сумма`. До применения баланс в профиле уже показывается с этой суммой. **Без `CoreRewards` в игре промокоды 4Coin в игру не дойдут.**

## Что не из игры
Серверы, новости, версия клиента и объявление — в `core_*`, сейчас заполняются SQL (`sql/seed.example.sql`), позже — вкладкой «Администрирование». Онлайн обновляет `POST /v1/internal/servers/<id>/stats`.
История кошелька — только операции через Core API; внутриигровые списания в `mainlogs`. В `accounts` нет подтверждения почты и 2FA — в «Безопасности» показываются как «нет».
Статику (файлы клиента, обновления лаунчера) отдаёт обычный веб-сервер (nginx), не API.

## Безопасность
Authorization Code + PKCE (S256 обязателен), `state`; форма входа подписана (HMAC); код одноразовый (условный UPDATE), 2 минуты; токены 256 бит, в БД только sha256 с перцем; access 15 минут; refresh 60 дней, **вращается**, повтор старого отзывает сессию; перебор: 5 неудач на логин+IP и 30 на IP за 10 минут, ответы одинаковы для «нет логина» и «неверный пароль»; `no-store`, CSP на странице входа; тело до 8 КБ; CORS только для адресов возврата сайта и `CORE_CORS_ORIGINS`. Лимитер в памяти процесса — при нескольких экземплярах API вынести в общее хранилище.

## Не проверено
Работа с живой MariaDB: все запросы проверены только парсером синтаксиса MariaDB и тестами на памяти (песочница не даёт запустить БД). Перед боем: `npm run migrate`, `npm run doctor`, вход тестовым аккаунтом. Также: боевой адрес и TLS, `Core/CoreRewards.cs` в игре (не компилировался).
