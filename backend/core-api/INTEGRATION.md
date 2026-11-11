# Подключение сайта (и любого клиента) к Core API

Сайт ничего не знает о БД: он входит через OAuth и получает профиль и роль из `/v1/me`. Логин и пароль вводятся на странице входа API (тот же логин и пароль, что в игре).

## 1. Поднять API локально
```bash
cd backend/core-api && npm i && npm run dev     # http://127.0.0.1:8787, тестовые данные
```
Аккаунты: `player/player123` (игрок), `admin/admin123` (админ 5 ур.), `owner/owner123` (8 ур.). Чтобы сайт на `http://localhost:3000` мог входить:
```bash
CORE_SITE_REDIRECTS=http://localhost:3000/auth/callback npm run dev
```
Это добавляет OAuth-клиент `4one-site` и открывает CORS для `http://localhost:3000`. На проде — `CORE_SITE_REDIRECTS=https://www.4onerp.com/auth/callback`.

## 2. Вход (Authorization Code + PKCE)
1. Сайт генерирует `code_verifier` (43–128 знаков `A-Za-z0-9-._~`), `state`, и `code_challenge = base64url(sha256(verifier))`. `verifier` и `state` хранит у себя (сессия или sessionStorage).
2. Отправляет браузер на  
   `GET {API}/oauth/authorize?response_type=code&client_id=4one-site&redirect_uri={SITE}/auth/callback&state={state}&code_challenge={challenge}&code_challenge_method=S256`
3. Игрок вводит логин и пароль на странице API. Браузер возвращается на `{SITE}/auth/callback?code=…&state=…`.
4. Сайт проверяет, что `state` тот же, и меняет код на токены:
```js
const r = await fetch(`${API}/oauth/token`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'authorization_code', client_id: '4one-site', code, redirect_uri: `${SITE}/auth/callback`, code_verifier: verifier }),
});
const { access_token, refresh_token, expires_in } = await r.json();   // access живёт 15 минут
```
5. Профиль и роль:
```js
const me = (await (await fetch(`${API}/v1/me`, { headers: { Authorization: `Bearer ${access_token}` } })).json()).data;
// me.role      → { alvl: 3, title: 'Администратор 3 уровня', rank: 'Администратор', isStaff: true }   (игрок: alvl 0, title 'Игрок')
// me.permissions → ['admin.panel', 'players.view', 'players.moderate'] — по ним показывать/прятать разделы
// me.balance4c, me.vip, me.characters, me.accountStatus ('active' | 'banned')
```
6. Обновление: `POST /oauth/token` `{ grant_type: 'refresh_token', client_id, refresh_token }` → новая пара (refresh **вращается**: старый перестаёт работать; повторное использование старого отзывает всю сессию — не отправляйте один refresh из двух мест).
7. Выход: `POST /oauth/revoke` `{ token: refresh_token }`.

**Где хранить токены.** Лучше на сервере сайта (cookie `HttpOnly; Secure; SameSite=Lax` с вашей собственной сессией), обмен кода делать на бэкенде. Если сайт — SPA без бэкенда, access держите в памяти, refresh — не в `localStorage` без нужды.

## 3. Роль и права на сайте
Не проверяйте `alvl` в коде сайта числами — используйте `permissions` (пороги задаёт API, `src/roles.js`): `admin.panel`, `players.view`, `players.moderate`, `logs.view`, `logs.export`, `project.manage`, `staff.manage`, `owner`. Проверку прав на сервере сайта делайте по свежему `/v1/me` (он читает БД при каждом запросе), а не по значению, сохранённому при входе.
`GET /v1/admin/capabilities` вернёт 403 без `admin.panel` — удобно для проверки доступа к админ-разделу.

## 4. Остальные данные
| Что | Запрос |
|---|---|
| серверы, новости, версия клиента, объявление | `GET /v1/bootstrap` (без токена) |
| промокод | `POST /v1/codes/redeem` `{ code }`, история `GET /v1/codes/history` |
| кошелёк, персонажи, сессии, история входов, безопасность | `GET /v1/account/wallet\|characters\|sessions\|history\|security` |
| завершить сессию | `POST /v1/account/sessions/revoke` `{ id }`, `/sessions/revoke-others` |

| двухфакторная защита | `GET /v1/account/2fa`, `POST /v1/account/2fa/setup\|enable\|disable\|backup` (см. README) |

Ответ: `{ "data": … }`, ошибка: `{ "error": "<код>", "error_description": "…" }` (коды: `invalid_token` 401, `forbidden` 403, `promo_*`, `busy` 429, `invalid_mfa_code` 401, `rate_limited` 429, `mfa_already_enabled`/`mfa_not_pending`/`mfa_not_enabled` 409).

**2FA на сайте.** Сайту ничего делать не нужно: если у игрока включена 2FA, страница `/oauth/authorize` сама покажет второй шаг (код из приложения или резервный) и только потом вернёт браузер на `redirect_uri` с кодом. Включение в личном кабинете: `setup` → показать QR из `otpauth` (и `secret` текстом) → `enable {code}` → показать `backupCodes` один раз.

## 5. Лаунчер
Использует тот же API: клиент `4one-launcher`, возврат `gta4one://auth/callback` (уже есть по умолчанию). Адрес API лаунчер берёт из `L4_CORE_URL` (`src/main/config.js`, `core.url`).
Прямой вход без браузера:
```js
let r = await post('/v1/auth/login', { client_id: '4one-launcher', login, password, device_name });
if (r.mfa_required) r = await post('/v1/auth/mfa', { client_id: '4one-launcher', mfa_token: r.mfa_token, code }); // 6 цифр или XXXX-XXXX
// r: { access_token, token_type, expires_in, refresh_token, scope } — дальше как после /oauth/token
```
`invalid_mfa_code` 401 — попросить код ещё раз с тем же `mfa_token`; `mfa_expired` 400 — вернуть на ввод пароля; `rate_limited` 429 — подождать.

## 6. Что на стороне игры (чтобы всё работало вместе)
- Колонка `accounts.alvl` и её чтение/запись в игре — gamemod, миграция `009_accounts_alvl.sql`, `Core/AdminAuth.cs`.
- Зачисление 4Coin за промокоды — gamemod `Core/CoreRewards.cs` (без него промокоды в игру не дойдут).
- Регистрацию нового аккаунта API не делает: аккаунты создаются в игре.

## 7. Чего пока нет
Регистрации и смены пароля на сайте, подтверждения почты, 2FA при входе в саму игру, экрана согласия для сторонних приложений (клиенты только свои), админ-разделов («Игроки», «Журнал», «Управление проектом» — право есть, страниц нет).
