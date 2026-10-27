# Гайд для разработчика: как подключиться и что где править

Коротко и без воды. Подробности для сайта — в [INTEGRATION.md](INTEGRATION.md).

## Как всё устроено

```
Игрок ──► сайт / лаунчер ──► Core API ──► БД игры (ra3_main) ◄── игровой сервер
```

- **БД одна** — игровая MariaDB `ra3_main`. Своей базы у сайта и лаунчера нет.
- **Сайт и лаунчер в БД не ходят.** Они общаются только с Core API (вход через OAuth, дальше запросы `/v1/...`).
- **Логин и пароль** те же, что в игре (`accounts.login`, `accounts.password`).
- **Роль** берётся из `accounts.alvl`: `0` — «Игрок», `1–8` — «Администратор n уровня».
- БД платформы FloV:MP (`flovmp_server`) в 4ONE **не используется**.

## 1. Попробовать за 1 минуту (без БД)

Нужен Node.js 20+.

```bash
cd backend/core-api
npm install
npm run dev
```

API запустится на `http://127.0.0.1:8787` с тестовыми данными. Тестовые аккаунты:

| логин | пароль | роль |
|---|---|---|
| `player` | `player123` | Игрок |
| `admin` | `admin123` | Администратор |
| `owner` | `owner123` | Владелец (8 уровень) |

Данные в этом режиме живут в памяти и пропадают при перезапуске.

## 2. Подключить сайт

1. Запускайте API (`npm run dev`) и задайте адрес возврата сайта:
   `CORE_SITE_REDIRECTS=http://localhost:3000/auth/callback npm run dev`
2. Клиент OAuth для сайта называется `4one-site`.
3. Дальше — по [INTEGRATION.md](INTEGRATION.md): `/oauth/authorize` → `/oauth/token` → `/v1/me`.
4. Проверять права на сайте нужно по полю `permissions` из `/v1/me`, а не по числу `alvl`.

## 3. Подключиться к живой БД

Заводим отдельного пользователя БД `core_api` (не root). Права для него — в конце файлов `sql/001_core_api.sql` и `sql/002_content.sql`.

БД слушает только на самом сервере, поэтому с компьютера ходим через SSH-туннель:

```bash
ssh -N -L 3307:127.0.0.1:3306 <пользователь>@<адрес сервера>
```

Файл `.env` (образец — `.env.example`, **в git его не коммитим**):

```
CORE_SECRET=<случайная строка от 32 знаков>
CORE_PEPPER=<другая случайная строка>
CORE_DB_USER=core_api
CORE_DB_PASSWORD=<пароль>
CORE_DB_HOST=127.0.0.1
CORE_DB_PORT=3307          # порт туннеля; на самом сервере 3306
CORE_DB_NAME=ra3_main
CORE_STORE=mysql
```

Дальше три команды:

```bash
npm run migrate   # создаёт таблицы core_* и колонку accounts.alvl (повторно безопасно)
npm run doctor    # проверяет настройки и БД, пишет что не так
npm start         # запускает API
```

`migrate` запускайте пользователем с правами на создание таблиц (например, root), обычному `core_api` их не хватит. Применённые миграции запоминаются в таблице `core_migrations`.

Для разработки лучше брать копию БД, а не боевую.

## 4. Как редактировать данные

Всё обычным SQL. API читает БД при каждом запросе, ничего перезапускать не нужно.

**Выдать роль (уровень администрации):**
```sql
UPDATE accounts SET alvl = 8 WHERE login = 'ваш_логин';   -- 0 = игрок, 1–8 = админ
```
Игра подхватит уровень при следующем входе игрока на сервер, лаунчер и сайт — при следующем запросе.

**Сервер в списке лаунчера:**
```sql
UPDATE core_servers SET status = 'maintenance', description = 'Технические работы' WHERE id = 'main';
```
`status`: `online` / `offline` / `maintenance`. Онлайн игроков может присылать сам игровой сервер (маршрут за `CORE_INTERNAL_TOKEN`).

**Новость:**
```sql
INSERT INTO core_news (title, excerpt, category, url, published_at)
VALUES ('Обновление 1.1', 'Что нового', 'updates', 'https://www.4onerp.com/news/1', CURDATE());
UPDATE core_news SET published = 0 WHERE id = 5;   -- скрыть
```
`category`: `news`, `events`, `updates`, `laws`, `rules`, `announce`. Ссылки только `https`.

**Промокод (4Coin):**
```sql
INSERT INTO core_promos (code, title, amount, max_uses, expires_at)
VALUES ('SUMMER24', 'Летний бонус', 200, 100, '2026-12-31 23:59:59');
UPDATE core_promos SET enabled = 0 WHERE code = 'SUMMER24';   -- выключить
```
Код: A–Z, 0–9 и «-». Один игрок активирует код один раз.

**Версия клиента игры и объявление:**
```sql
UPDATE core_settings SET v = '{"version":"1.0.1","manifestUrl":"https://cdn.4onerp.com/client/manifest.json","notes":""}' WHERE k = 'client';
UPDATE core_settings SET v = 'Сегодня в 20:00 перезагрузка' WHERE k = 'notice';
```

## 5. Чего нельзя делать

- **Не меняйте `accounts.redbucks` (4Coin) напрямую из API или сайта.** Для начисления добавляйте строку в `core_wallet_tx` (поле `applied_at` оставьте `NULL`). Игровой сервер сам зачислит монеты в течение ~15 секунд: ему известно, в сети ли игрок, и так не затрутся данные из памяти сервера.
- **Не трогайте `accounts.password`** и не пишите пароли в логи. API проверяет пароль так же, как игра (`PasswordHash.cs`).
- **Не коммитьте `.env`**, пароли БД, `CORE_SECRET` и `CORE_PEPPER`.
- **Не открывайте порт БД (3306) наружу.** Только туннель или локальное подключение.

## Если что-то не работает

| Симптом | Что делать |
|---|---|
| Ошибка про колонку `alvl` | выполнить `npm run migrate` |
| Вход пишет «неверный пароль» при верном | запустить `npm run doctor`, проверить `CORE_DB_NAME` и что используется БД игры |
| Сайт получает ошибку CORS | добавить его адрес в `CORE_SITE_REDIRECTS` или `CORE_CORS_ORIGINS` |
| Промокод не пришёл в игру | проверить, запущен ли игровой сервер с `CoreRewards.cs`: в `core_wallet_tx` у строки должен появиться `applied_at` |
