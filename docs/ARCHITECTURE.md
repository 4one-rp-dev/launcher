# Архитектура

```
┌────────────── renderer (sandbox, CSP: сети нет) ──────────────┐
│ index.html · css/ · js/screens/*  ── window.l4.call/on ──┐     │
└───────────────────────────────────────────────────────────┼────┘
                                   preload (allowlist) ─────┘
┌────────────── main ───────────────────────────────────────────┐
│ ipcMain.handle(канал) → core/handlers.js (валидация) → сервисы │
│   auth(session.js)  data.js  game.js  codes  settings  updater │
│   api/oauth.js · api/core.js → Core API (backend/core-api)     │
│   client/platform.js · kit.js · download.js · manifest.js   │
│   gta/detect.js · pe-version.js · runner.js                    │
└────────────────────────────────────────────────────────────────┘
```
Тот же `handlers.js` с `mock/` работает без Electron: так устроены `npm run preview`, тесты и скриншоты.

## Контракт IPC
Все каналы и события перечислены в `src/core/contract.js`. Ответ всегда `{ ok:true, data }` или `{ ok:false, code, message }`. Каналы:
`app:*` (info, openExternal, openPath, copyDiagnostics) · `win:*` · `auth:*` (status, exchangeCode, logout, openConnect) · `data:bootstrap` · `servers:select` · `game:*` (state, detect, browse, setPath, install, verify, play, cancel, uninstall) · `codes:*` (redeem, history) · `settings:*` · `update:*`.
События main→renderer: `auth:changed`, `game:state`, `update:state`, `net:state`, `deeplink`, `toast`.

## Потоки
**Вход (OAuth, Authorization Code + PKCE).** «Войти» → `auth:login` → main создаёт `verifier`/`state`, открывает в системном браузере `…/oauth/authorize` (только наш хост, `openAuth`) → игрок вводит логин и пароль **на странице Core API** (в лаунчер пароль не попадает) → браузер отдаёт ссылку `gta4one://auth/callback?code&state` → `protocol.js` разбирает строго, `main` сверяет `state` и меняет код на токены (`api/oauth.js`) → `GET /v1/me` → профиль с ролью → токены и кэш профиля в `safeStorage` → `auth:changed`. Access живёт 15 минут и обновляется заранее, refresh вращается; при старте — `restore()`, без сети — кэш с пометкой `offline`. Роль («Игрок» / «Администратор n уровня») и права перечитываются раз в 5 минут и при появлении сети: смена уровня в игре видна без перелогина. Сквозной тест: `test/auth.test.js` (настоящий клиент против настоящего Core API без сокетов).
**Данные.** `data:bootstrap` одним запросом: профиль, серверы, новости, версия клиента, объявление, флаги. Кэш 60 с; без сети отдаём прошлые данные с пометкой `stale`. Нет функции — читаем публичный `bootstrap.json` из Storage.
**Установка/запуск** (`game.js`, фазы `init|no-gta|unsupported|not-installed|needs-update|ready|checking|installing|verifying|launching|ingame|error`): detect → проверка версии (PE-ресурс GTA5.exe, нужна 1.0.3889.0) → комплект клиента (`kit.js`, https из bootstrap, SHA-256) → `platform.js`: тихий установщик платформы ставит клиент, ScriptHookV и режим без BattlEye, `connect` обновляет клиент и моды сервера, подключает к серверу и запускает игру (Steam/Epic/exe) → ожидание процесса GTA5.exe.
**Промокод.** `codes:redeem` → нормализация (A–Z0–9) → `redeem-launcher-code` → атомарно в SQL → событие `auth:changed` с новым балансом.

## Безопасность
- `contextIsolation`, `sandbox`, `nodeIntegration:false`, CSP без сети, навигация и `window.open` запрещены.
- IPC принимается только от нашего окна и нашего файла (`security.senderAllowed`).
- Внешние ссылки по allowlist хостов; deep-link разбирается строго (`protocol.js`), принимается только `auth` с кодом `[A-Z0-9]{4,24}`.
- Манифест: запрет `..`, абсолютных путей, `:`/`\`, дубликатов (без учёта регистра), allowlist расширений; скачивание в `.part`, проверка размера и SHA-256, атомарное переименование.
- Токен не пишется в лог и в `settings.json`. Лог ротируется, секреты вырезаются.
- Одна копия приложения (`requestSingleInstanceLock`), второй запуск передаёт deep-link первому.

## Расширение
Новый экран: `js/screens/<имя>.js` (`mount(root, ctx) → { update(S, what), destroy? }`), маршрут в `js/main.js`, иконка в `tools/icons-map.js`; для страниц с вкладками — `js/tabs.js`, пункт в `docs/DESIGN.md`. Новая настройка: `main/settings.js` (SCHEMA) + дефолт в `mock/index.js` + тест. Новый канал: см. правило 1 в `CLAUDE.md`.
