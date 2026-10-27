# 4ONE Core API

Единый API проекта: **вход (OAuth 2.0), профиль и роль, каталог (серверы, новости), промокоды, данные аккаунта** для лаунчера, сайта и, позже, игры. Источник данных — игровая MariaDB. **Supabase не нужен.**
Node 20+, одна зависимость (`mysql2`). Тесты без сети и без БД: `npm test`.

## Что читает из БД
| Данные | Откуда |
|---|---|
| логин, почта, хеш пароля, Social Club, 4Coin (`redbucks`), VIP, персонажи | `accounts`, `characters` БД геймода (`ra3_main`) |
| **уровень администратора `alvl` (0–8)** | `accounts.alvl` БД платформы FloV:MP (`flovmp_server`), связь по Social Club — тот же уровень читает игра (`Core/AdminAuth.cs`) |
| бан | `banned` |

API **ничего не пишет** в таблицы игры: ни пароли, ни уровни, ни баланс. Пишет только в свои `core_*`: OAuth (`sql/001_core_api.sql`), серверы, новости, настройки, промокоды, кошелёк, история входов (`sql/002_content.sql`, образец данных — `sql/seed.example.sql`).
Пароль проверяется тем же алгоритмом, что в игре (`Accounts/PasswordHash.cs`: PBKDF2-SHA256 `p2$…`, старый SHA-256 тоже принимается).

## Роли
`role.title`: «Игрок» (alvl 0) или «Администратор n уровня»; `role.rank` — название ранга из игры (`Core/AdminRanks.cs`). `permissions[]` — права по уровню (`src/roles.js`):
`admin.panel` ≥1, `players.view` ≥2, `players.moderate` ≥3, `logs.view` ≥5, `logs.export` ≥6, `project.manage` ≥6, `staff.manage` ≥7, `owner` 8.
Пороги — **предложение**, меняются в одном месте. Уровень читается из БД при каждом `GET /v1/me`: смена уровня видна без перелогина.

## Эндпоинты
| | |
|---|---|
| `GET /oauth/authorize` | страница входа (HTML) для системного браузера. Параметры: `response_type=code`, `client_id`, `redirect_uri`, `state`, `code_challenge`, `code_challenge_method=S256`, необязательно `device_name` |
| `POST /oauth/authorize` | отправка формы; успех → ссылка возврата `…?code=…&state=…` |
| `POST /oauth/token` | `authorization_code` (+`code_verifier`) или `refresh_token` → `{ access_token, refresh_token, expires_in:900 }` |
| `POST /oauth/revoke` | отзыв по access или refresh токену (RFC 7009) |
| `GET /v1/me` | профиль и роль (`Authorization: Bearer`) |
| `GET /v1/admin/capabilities` | каталог прав; только с `admin.panel` |
| `GET /v1/bootstrap` | **без токена**: `{ servers[], news[], client{version,manifestUrl,notes}, notice, flags }` |
| `POST /v1/codes/redeem` | `{ code }` → `{ id, code, title, at, reward:{kind:'coins',amount} }`; ошибки `promo_not_found` 404, `promo_expired` 410, `promo_used`/`promo_limit` 409, `busy` 429 |
| `GET /v1/codes/history` | активации кодов аккаунта |
| `GET /v1/account/security` `sessions` `history` `wallet` `characters` | раздел «Аккаунт» лаунчера |
| `POST /v1/account/sessions/revoke` `{id}` · `/sessions/revoke-others` | завершить чужую сессию / все остальные (свою — только выходом, чужого аккаунта — нельзя) |
| `POST /v1/internal/servers/<id>/stats` | `{ online, max, status }` от игрового сервера или cron; по заголовку `X-Internal-Token` = `CORE_INTERNAL_TOKEN` (от 16 знаков), без него маршрута «нет» |
| `GET /healthz` | живость |

### Как зачисляются 4Coin
API **не меняет `accounts.redbucks`**: игрок в сети хранит баланс в памяти сервера, и запись в БД он бы перезатёр. Промокод кладёт строку в `core_wallet_tx` (`applied_at IS NULL`), а игровой сервер раз в 15 секунд применяет её (`dotnet/…/Core/CoreRewards.cs`): в сети — через `UpdateData.RedBucks`, не в сети — `redbucks += сумма`; строку сначала «занимает» условный UPDATE, двойного зачисления нет. До применения баланс в профиле и кошельке показывается уже с этой суммой. **Без `CoreRewards` в игре промокоды 4Coin в игру не дойдут.**

### Что не из игры
Игра не хранит серверы, новости, версию клиента и объявление — они в `core_*`, сейчас заполняются SQL (позже — вкладкой «Администрирование», право `project.manage`). Онлайн серверов обновляет `POST /v1/internal/servers/<id>/stats`.
История кошелька — только операции через Core API (промокоды); списания и пополнения внутри игры в ней не видны (они в `mainlogs`). В `accounts` нет подтверждения почты и 2FA — в «Безопасности» они показываются как «нет». Должность/работа персонажа в списке персонажей пока пустая.
Статику (файлы клиента игры по `manifest.json`, обновления лаунчера) отдаёт обычный веб-сервер (nginx), не API; адреса — `L4_CDN_URL` лаунчера и `client.manifestUrl` в `core_settings`.

Клиенты: `4one-launcher` — `gta4one://auth/callback` и `http://127.0.0.1:<порт>/callback` (RFC 8252). Сайт добавляется записью в `CORE_CLIENTS` со своим `redirectUris`.

## Безопасность
Authorization Code + PKCE (S256 обязателен), `state`; форма входа подписана (HMAC), параметры не подменить; код одноразовый (условный UPDATE), живёт 2 минуты;
токены 256 бит, в БД только sha256 с перцем; access 15 минут; refresh 60 дней и **вращается**, повторное использование старого отзывает всю сессию;
перебор: 5 неудач на логин+IP и 30 на IP за 10 минут, в сообщениях нет различий «нет такого логина» / «неверный пароль»; ответы `no-store`, CSP на странице входа; тело запроса до 8 КБ.
Лимитер в памяти процесса: при нескольких экземплярах API его нужно вынести в общее хранилище.

## Запуск
```bash
# разработка без БД (тестовые аккаунты из JSON, формат — test/core.test.js, функция boot)
CORE_STORE=memory CORE_SEED=./seed.json npm run dev

# боевой режим (MariaDB игры); сервис слушает 127.0.0.1, наружу — через nginx с TLS
CORE_SECRET=<случайная строка от 32 знаков> CORE_PEPPER=<ещё одна> \
CORE_DB_USER=core_api CORE_DB_PASSWORD=<пароль> CORE_DB_GAME=ra3_main CORE_DB_PLATFORM=flovmp_server \
CORE_PUBLIC_URL=https://api.4onerp.com CORE_TRUST_PROXY=1 CORE_INTERNAL_TOKEN=<от 16 знаков> npm start
```
Перед первым запуском: выполнить `sql/001_core_api.sql`, `sql/002_content.sql` (и при желании `seed.example.sql`) и выдать права пользователю БД (инструкция в конце файла; права только на чтение чужих таблиц).

## Не проверено
Работа с живой MariaDB (запросы `createMysqlStore`/`createMysqlContent`, транзакция промокода написаны по схеме `database/main.sql`, но не запускались), боевой адрес и TLS, лимитер на нескольких экземплярах, `Core/CoreRewards.cs` в игре (не компилировался: сборка проекта в этой среде не завершилась), боевой CDN.
