# Контракт с бэкендом

Лаунчер работает **только с Core API** (`backend/core-api`, его README — полный список эндпоинтов и безопасность) и статикой (`config.cdn`).
Supabase не используется. Ответ API: успех `{ "data": … }`, ошибка `{ "error": "<код>", "error_description": "…" }` (HTTP 4xx/5xx). Заголовок `Authorization: Bearer <access>` для всего, кроме `/v1/bootstrap` и OAuth.
Коды ошибок из `src/core/contract.js` (`ERRORS`) лаунчер показывает своим русским текстом; неизвестный код → `login_failed`; 404/5xx → «нет связи».

## Вход (OAuth 2.0, Authorization Code + PKCE)
`GET /oauth/authorize` (страница входа в браузере) → ссылка `gta4one://auth/callback?code&state` → `POST /oauth/token` (`authorization_code` + `code_verifier`, затем `refresh_token`) → `GET /v1/me`. Выход — `POST /oauth/revoke`. Подробности — `docs/ARCHITECTURE.md`.

| Эндпоинт | `data` в ответе | Ошибки |
|---|---|---|
| `GET /v1/me` | `{ login, email, socialClub, balance4c, vip, accountStatus, role{alvl,title,rank,isStaff}, permissions[], characters[] }` | `invalid_token` 401 |
| `GET /v1/bootstrap` (без токена) | `{ servers[], news[], client, notice, flags }` | — |
| `POST /v1/codes/redeem` `{ code }` | `{ id, code, title, at, reward:{ kind:'coins', amount } }` | `promo_not_found`, `promo_expired`, `promo_used`, `promo_limit`, `busy` |
| `GET /v1/codes/history` | `[ { id, code, title, at, reward } ]` | сессия |
| `GET /v1/account/security` | `{ emailVerified, twoFactor, passwordSet, links:[{ provider, linked, label }] }` | сессия |
| `GET /v1/account/sessions` | `[ { id, device, os, ip, place, lastAt, current } ]` | сессия |
| `POST /v1/account/sessions/revoke` `{ id }` · `/revoke-others` | `{}` | `bad_request` (своя или чужая сессия) |
| `GET /v1/account/history` | `[ { id, at, device, ip(маскирован), place, method("launcher|site|game"), ok } ]` | сессия |
| `GET /v1/account/wallet` | `{ balance, items:[ { id, at, title, amount } ] }` | сессия |
| `GET /v1/account/characters` | `[ { id, name, level, job, cash, bank, lastAt } ]` | сессия |

Соответствие вызовов лаунчера: `data:bootstrap` → `/v1/bootstrap`, `codes:redeem|history` → `/v1/codes/*`, `account:*` → `/v1/account/*` (`src/main/api/backend.js`).
Токен лаунчер берёт у сессии при каждом запросе (`auth.freshToken()`): устаревший access обновляется заранее, отозванная сессия → `invalid_session` → выход.

## Профиль
Из `GET /v1/me`, приводится `backend.fromCore`. Профиль лаунчера: `{ authUserId, username, email, nickname, gameName, role, roleInfo{alvl,title,rank,isStaff}, permissions[], accountId, accountStatus("active|banned|pending"), authMethod, balance4c, level, faction, hours, launcherAccess }`; `role` — «Игрок» / «Администратор n уровня». `balance4c` включает зачисления, которые игра ещё не применила (промокоды).

## Сервер
`{ id, name, tag, status("online|offline|maintenance"), online, max, address("host:port"), version, description, recommended }`. Адрес вне формата `host:port` лаунчер отбрасывает. Онлайн обновляет игра или cron: `POST /v1/internal/servers/<id>/stats`.

## Новость
`{ id, title, excerpt, category("news|events|updates|laws|rules|announce"), date("YYYY-MM-DD"), cover, url }`. `cover` — имя из `assets/news/` (например `sultan`) или https-ссылка; `url` — только https и хост из `externalHostAllowlist`, иначе открывается раздел «Новости» сайта.

## Клиент
`client: { version, kitUrl, kitSha256, kitSize, notes }` (таблица `core_settings`, ключ `client`). `kitUrl` — **https**-ссылка на комплект клиента (zip с установщиком платформы и подписанным клиентом, собирается `pack_server.py` при сборке пакета сервера), `kitSha256` — SHA-256 архива (64 hex), `kitSize` — размер в байтах, `version` — версия клиента (1.1.1). Лаунчер скачивает комплект сам, сверяет хэш, распаковывает в свою папку и запускает установщик тихо; **игрок ничего не скачивает руками**. Дальше клиент обновляется с игрового сервера при каждом входе (подписано ключом проекта), поэтому поле нужно менять только при смене установщика платформы или ключа проекта. Нет `client` или нет `kitUrl`/`kitSha256` — установка недоступна (ошибка «Не удалось получить файлы клиента»), уже установленный клиент работает как раньше.
Обновления лаунчера (`latest.yml`, `Setup.exe`) и комплект клиента — обычная статика на веб-сервере проекта (`L4_CDN_URL`).

## Диплинк
Только `gta4one://auth/callback?code=…&state=…` — возврат из браузера после входа; принимает main, `state` должен совпасть с ожидающим входом.

## Безопасность
Подробно — `backend/core-api/README.md`: PKCE, одноразовый код (2 минуты), токены 256 бит и только хеши в БД, access 15 минут, refresh с ротацией и отзывом при повторном использовании, ограничение перебора, IP в истории маскирован, 4Coin зачисляет игровой сервер (API баланс не меняет).
