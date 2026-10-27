-- Пример начального наполнения (после 002_content.sql). Значения — образцы, подставьте свои.

INSERT INTO core_servers (id, name, tag, `status`, `online`, max_players, address, version, description, recommended, sort) VALUES
  ('main', '4ONE RP', 'MAIN', 'online', 0, 500, 'play.4onerp.com:22005', '1.0.3889.0', 'Основной сервер.', 1, 1);

INSERT INTO core_news (title, excerpt, category, cover, url, published_at) VALUES
  ('Открытие проекта', 'Первые шаги на сервере 4ONE RP.', 'news', '', 'https://www.4onerp.com/', CURDATE());

-- версия клиента игры и манифест (файлы раздаёт веб-сервер, не API): {"version","manifestUrl","notes"}
INSERT INTO core_settings (k, v) VALUES
  ('client', '{"version":"1.0.0","manifestUrl":"https://cdn.4onerp.com/client/manifest.json","notes":""}'),
  ('notice', ''),
  ('flags', '{}')
ON DUPLICATE KEY UPDATE v = VALUES(v);

-- промокоды лаунчера: 4Coin на аккаунт, один раз
INSERT INTO core_promos (code, title, amount, max_uses, expires_at) VALUES
  ('WELCOME4', 'Приветственный бонус', 100, NULL, NULL);
