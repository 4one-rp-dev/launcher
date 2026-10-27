'use strict';
/**
 * Набор иконок — Lucide (ISC, https://lucide.dev): тонкий контур 24×24, цвет и толщину задаёт CSS (svg.i).
 * Ключ — имя в коде (ic('имя')), значение — имя иконки Lucide (папка node_modules/lucide-static/icons).
 * Логотипов брендов в Lucide нет — они помечены 'ph:' и берутся из Phosphor (MIT), вес regular.
 * Новая иконка = строка здесь + `npm run icons`.
 */
module.exports = {
  // действия
  max: 'square', restore: 'copy',
  play: 'play', pause: 'pause', stop: 'square', check: 'check', x: 'x', plus: 'plus', minus: 'minus',
  'chev-r': 'chevron-right', 'chev-d': 'chevron-down', 'chev-l': 'chevron-left', 'chev-u': 'chevron-up',
  copy: 'copy', down2: 'download', logout: 'log-out', refresh: 'refresh-cw', hist: 'history',
  search: 'search', trash: 'trash-2', link: 'link', ext: 'external-link', dots: 'ellipsis', sort: 'list-filter',
  'check-c': 'circle-check', 'x-c': 'circle-x', 'alert-c': 'circle-alert',
  // статусы
  info: 'info', alert: 'triangle-alert', eye: 'eye', 'eye-off': 'eye-off', lock: 'lock', key: 'key-round', signal: 'signal',
  wifi: 'wifi', 'wifi-off': 'wifi-off', gauge: 'gauge', bolt: 'zap', star: 'star', clock: 'clock', calendar: 'calendar',
  // разделы
  user: 'user', userc: 'circle-user-round', users: 'users', home: 'house', gear: 'settings', sliders: 'sliders-horizontal',
  shield: 'shield-check', coin: 'coins', coins: 'coins', wallet: 'wallet', receipt: 'receipt-text', gift: 'gift', globe: 'globe',
  folder: 'folder-open', doc: 'file-text', news: 'newspaper', flag: 'flag', scale: 'scale', mega: 'megaphone',
  chat: 'message-circle', server: 'server', car: 'car', box: 'package', grid: 'layout-grid',
  gamepad: 'gamepad-2', rocket: 'rocket', crown: 'crown', sparkle: 'sparkles', trophy: 'trophy', pin: 'map-pin',
  // аккаунт
  mail: 'mail', fingerprint: 'fingerprint', qr: 'qr-code', id: 'id-card', device: 'monitor', devices: 'monitor-smartphone',
  bell: 'bell', palette: 'palette', translate: 'languages', disk: 'hard-drive', cloud: 'cloud-download', broadcast: 'radio',
  // соцсети (нет в Lucide)
  discord: 'ph:discord-logo', telegram: 'ph:telegram-logo', youtube: 'ph:youtube-logo', steam: 'ph:steam-logo', google: 'ph:google-logo',
};
