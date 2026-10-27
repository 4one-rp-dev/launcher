import { bytes, speed, eta, esc } from './ui.js';
import { t } from './i18n.js';

const stage = (k) => ({ scripthook: 'ScriptHookV', client: t('Файлы клиента'), mods: t('Моды') })[k];

/**
 * Что показывать на главной кнопке и в строке статуса для текущей фазы игры.
 * Единственное место, где фаза переводится в текст и действие — так кнопка всегда честная.
 * action: browse | install | play | retry | none
 */
export function phaseView(g, srv, net) {
  const base = { label: t('Играть'), action: 'play', disabled: false, cls: '', status: '', pct: null, busy: false, cancel: false, tone: '' };
  if (!g) return Object.assign(base, { label: t('Загрузка…'), action: 'none', disabled: true, status: t('Проверяем игру…') });
  const p = g.progress;
  switch (g.phase) {
    case 'init': case 'checking':
      return Object.assign(base, { label: t('Проверка…'), action: 'none', disabled: true, status: t('Проверяем файлы игры…') });
    case 'no-gta':
      return Object.assign(base, { label: t('Указать GTA V'), action: 'browse', cls: '', status: t('GTA V не найдена — укажите папку с игрой'), tone: 'warn' });
    case 'unsupported':
      return Object.assign(base, { label: t('Нужна GTA V Legacy'), action: 'none', disabled: true, status: (g.error && t(g.error.message)) || t('Версия GTA V не поддерживается'), tone: 'err' });
    case 'not-installed':
      return Object.assign(base, { label: t('Установить'), action: 'install', status: t('Клиент 4ONE не установлен') });
    case 'needs-update':
      return Object.assign(base, { label: t('Обновить'), action: 'install', status: t('Доступно обновление клиента') + (g.client.updateBytes ? ' · ' + bytes(g.client.updateBytes) : ''), tone: 'warn' });
    case 'installing': case 'verifying': {
      const verb = g.phase === 'verifying' ? t('Проверка файлов') : t('Установка');
      const pct = p ? p.percent : 0;
      const st = p ? `${stage(p.stage) || t('Файлы')}${p.total ? ' · ' + t('{a} из {b}', { a: bytes(p.done), b: bytes(p.total) }) : ''}${p.speed ? ` · ${speed(p.speed)}` : ''}${p.eta ? ' · ' + t('осталось {x}', { x: eta(p.eta) }) : ''}` : t('Подготовка…');
      return Object.assign(base, { label: `${verb} ${pct}%`, action: 'none', disabled: true, status: st, pct: pct / 100, busy: true, cancel: true });
    }
    case 'launching':
      return Object.assign(base, { label: t('Запуск…'), action: 'none', disabled: true, status: t('Запускаем GTA V и подключаемся к серверу…'), pct: 1, busy: true });
    case 'ingame':
      return Object.assign(base, { label: t('В игре'), action: 'none', disabled: true, status: t('GTA V запущена'), tone: 'ok' });
    case 'error':
      return Object.assign(base, { label: t('Повторить'), action: 'retry', status: (g.error && t(g.error.message)) || t('Ошибка'), tone: 'err' });
    default: {
      let label = t('Играть'); let dis = false; let status = ''; // когда всё в порядке, текста нет — достаточно кнопки
      if (!net) { dis = true; status = t('Нет связи с сервером 4ONE'); }
      else if (srv && srv.status === 'maintenance') { dis = true; status = t('На сервере технические работы'); label = t('Недоступно'); }
      else if (srv && srv.status === 'offline') { dis = true; status = t('Сервер сейчас недоступен'); label = t('Недоступно'); }
      return Object.assign(base, { label, disabled: dis, status, tone: dis ? 'warn' : 'ok' });
    }
  }
}
export const statusHtml = (v) => `<span class="${v.tone ? 'tone-' + v.tone : ''}">${esc(v.status)}</span>`;
