-- Пример начального наполнения (после 002_content.sql). Значения — образцы, подставьте свои.

INSERT INTO core_servers (id, name, tag, `status`, `online`, max_players, address, version, description, recommended, sort) VALUES
  ('main', '4ONE RP', 'MAIN', 'online', 0, 500, '188.130.132.47:7788', '1.0.3889.0', 'Основной сервер.', 1, 1);

INSERT INTO core_news (title, excerpt, category, cover, url, published_at) VALUES
  ('Открытие проекта', 'Первые шаги на сервере 4ONE RP.', 'news', '', 'https://www.4onerp.com/', CURDATE());

-- комплект клиента игры (zip раздаёт веб-сервер по https, не API): {"version","kitUrl","kitSha256","kitSize","notes"}; sha256 — `sha256sum` архива
INSERT INTO core_settings (k, v) VALUES
  ('client', '{"version":"1.1.1","kitUrl":"https://cdn.4onerp.com/client/4ONE-client-1.1.1.zip","kitSha256":"<sha256 архива>","kitSize":0,"notes":""}'),
  ('notice', ''),
  ('flags', '{}')
ON DUPLICATE KEY UPDATE v = VALUES(v);

-- промокоды лаунчера: 4Coin на аккаунт, один раз
INSERT INTO core_promos (code, title, amount, max_uses, expires_at) VALUES
  ('WELCOME4', 'Приветственный бонус', 100, NULL, NULL);
