'use strict';
/**
 * Контракт между рендерером и main-процессом. Единственное место, где перечислены
 * каналы IPC. Preload пропускает только эти имена; браузерный предпросмотр
 * (tools/preview-*.js) подставляет мок-реализации за тем же контрактом.
 */

/** Запросы (invoke): рендерер -> main, ответ всегда { ok, data?, code?, message? } */
const CHANNELS = [
  'app:info', 'app:openExternal', 'app:openPath', 'app:copyDiagnostics',
  'win:minimize', 'win:toggleMaximize', 'win:close',
  'auth:status', 'auth:login', 'auth:cancel', 'auth:logout',
  'data:bootstrap',
  'servers:select',
  'game:state', 'game:detect', 'game:browse', 'game:setPath',
  'game:install', 'game:verify', 'game:play', 'game:cancel', 'game:uninstall',
  'codes:redeem', 'codes:history',
  'account:security', 'account:sessions', 'account:revokeSession', 'account:revokeOthers', 'account:history', 'account:wallet', 'account:characters',
  'settings:get', 'settings:set', 'settings:reset',
  'update:check', 'update:download', 'update:install',
];

/** События: main -> рендерер */
const EVENTS = [
  'auth:changed', 'game:state', 'update:state', 'net:state', 'deeplink', 'toast',
];

/** Коды ошибок и тексты для пользователя (русский, коротко, без воды) */
const ERRORS = {
  // вход через сайт (OAuth, Core API)
  login_failed: 'Не удалось войти. Нажмите «Войти» и повторите.',
  forbidden: 'Недостаточно прав.',
  profile_not_found: 'Для аккаунта не найден игровой профиль.',
  profile_lookup_failed: 'Не удалось загрузить профиль. Повторите позже.',
  launcher_access_denied: 'Доступ к лаунчеру не выдан. Обратитесь к администрации.',
  // сессия
  invalid_session: 'Сессия недействительна. Войдите заново.',
  session_revoked: 'Сессия отозвана. Войдите заново.',
  session_expired: 'Сессия истекла. Войдите заново.',
  // сеть
  network_error: 'Нет связи с сервером 4ONE. Проверьте интернет.',
  timeout: 'Сервер не ответил вовремя. Повторите позже.',
  unknown: 'Что-то пошло не так. Повторите позже.',
  // промокоды (предложение, см. docs/API.md)
  promo_not_found: 'Такого кода не существует.',
  promo_expired: 'Срок действия кода истёк.',
  promo_used: 'Вы уже активировали этот код.',
  promo_limit: 'Лимит активаций кода исчерпан.',
  promo_forbidden: 'Этот код вам недоступен.',
  // игра и файлы
  gta_not_found: 'GTA V не найдена. Укажите папку с игрой.',
  gta_unsupported: 'Нужна GTA V Legacy (1.0.3889.0). Версия Enhanced не поддерживается.',
  gta_wrong_version: 'Версия GTA V не подходит. Нужна 1.0.3889.0.',
  no_write_access: 'Нет прав на запись в папку игры.',
  disk_full: 'Недостаточно места на диске.',
  hash_mismatch: 'Файл повреждён при загрузке. Повторите установку.',
  manifest_invalid: 'Список файлов клиента повреждён. Повторите позже.',
  download_failed: 'Не удалось скачать файлы. Проверьте интернет.',
  game_running: 'GTA V уже запущена.',
  launch_failed: 'Не удалось запустить игру.',
  cancelled: 'Отменено.',
  server_offline: 'Сервер сейчас недоступен.',
  busy: 'Подождите, операция ещё выполняется.',
  bad_request: 'Некорректный запрос.',
};

function message(code) { return ERRORS[code] || ERRORS.unknown; }
function fail(code, extra) { return Object.assign({ ok: false, code, message: message(code) }, extra || {}); }
function ok(data) { return { ok: true, data }; }

module.exports = { CHANNELS, EVENTS, ERRORS, message, fail, ok };
