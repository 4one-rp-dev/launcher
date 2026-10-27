import { call } from '../api.js';
import { S, patch } from '../state.js';
import { $, $$, esc, ic, delegate, confirmBox, toast } from '../ui.js';
import { setSetting, check } from '../actions.js';
import { tabs } from '../tabs.js';
import { t } from '../i18n.js';

const ACC_DEF = [['violet', 'Лиловый', '#b9a3ff'], ['mint', 'Мята', '#9fd4b4'], ['rose', 'Роза', '#f0a0b4'], ['sky', 'Небо', '#9cc4f5']];
// ключи: t('Лиловый') t('Мята') t('Роза') t('Небо')
const SCALES = [['auto', 'Авто'], ['90', '90%'], ['100', '100%'], ['110', '110%'], ['125', '125%'], ['150', '150%']];
let lastTab = 'game';

const sw = (key, title, desc) => `<div class="srow"><div class="st"><b>${title}</b><small>${desc}</small></div><button class="sw" role="switch" aria-checked="false" aria-label="${esc(title)}" data-sw="${key}"><i></i></button></div>`;
const seg = (attr, label, items) => `<div class="seg" role="radiogroup" aria-label="${esc(label)}">${items.map(([k, n, l]) => `<button role="radio" aria-checked="false" ${attr}="${k}"${l ? ` lang="${l}"` : ''}>${esc(n)}</button>`).join('')}</div>`;
const box = (icon, title, body, extra) => `<div class="gp flat"><div class="gh"><div class="ico">${ic(icon)}</div><h2>${title}</h2>${extra || ''}</div>${body}</div>`;

/**
 * Страница строится один раз. Любое изменение настроек только выставляет значения у уже существующих элементов (sync),
 * поэтому прокрутка и фокус не сбрасываются, а страница не мигает.
 */
export function mount(root, ctx) {
  root.innerHTML = `<header class="scr-head in" style="--i:0"><div><h1>${t('Настройки')}</h1></div></header><div id="host"></div>`;
  const TABS = [
    { k: 'game', name: t('Игра'), icon: 'folder' }, { k: 'launch', name: t('Запуск'), icon: 'rocket' },
    { k: 'look', name: t('Интерфейс'), icon: 'palette' }, { k: 'app', name: t('Лаунчер'), icon: 'sliders' }, { k: 'about', name: t('О программе'), icon: 'info' },
  ];
  const view = tabs($('#host', root), TABS, { initial: (ctx.arg && ctx.arg.tab) || lastTab, label: t('Настройки'), onShow: (k) => { lastTab = k; } });
  const P = (k) => view.pane(k);

  P('game').innerHTML = `<div class="stack">
    ${box('folder', t('GTA V'), `
      <div class="srow"><div class="st"><b>${t('Папка GTA V')}</b><small class="path" data-f="path"></small></div>
        <div class="sact"><button class="bt g sm" data-act="detect">${t('Найти')}</button><button class="bt g sm" data-act="browse">${t('Выбрать…')}</button></div></div>
      <div class="srow"><div class="st"><b>${t('Файлы клиента')}</b><small data-f="client"></small></div>
        <div class="sact"><button class="bt g sm" data-act="verify" data-f="inst">${ic('refresh')}${t('Проверить')}</button><button class="bt g dng sm" data-act="uninstall" data-f="inst">${t('Удалить')}</button></div></div>`)}
  </div>`;
  P('launch').innerHTML = `<div class="stack">${box('rocket', t('Запуск'),
    sw('syncMods', t('Синхронизировать моды'), t('Перед стартом сверять файлы с сервером проекта'))
    + sw('noBattleye', t('Запускать без BattlEye'), t('Добавляет -nobattleye в commandline.txt, как в прежнем лаунчере'))
    + sw('closeAfterStart', t('Закрывать лаунчер после старта'), t('Окно закроется, когда запустится GTA V')))}</div>`;
  P('look').innerHTML = `<div class="stack">${box('palette', t('Внешний вид'), `
      <div class="srow"><div class="st"><b>${t('Язык')}</b><small>${t('Язык интерфейса лаунчера')}</small></div>${seg('data-lang', t('Язык'), [['ru', 'Русский', 'ru'], ['en', 'English', 'en']])}</div>
      <div class="srow"><div class="st"><b>${t('Цвет интерфейса')}</b><small>${t('Как в игре: меняется только акцент')}</small></div>
        <div class="acc" role="radiogroup" aria-label="${t('Цвет интерфейса')}">${ACC_DEF.map(([k, n, c]) => `<button role="radio" aria-checked="false" aria-label="${esc(t(n))}" title="${esc(t(n))}" data-acc="${k}" style="--c:${c}"></button>`).join('')}</div></div>
      <div class="srow"><div class="st"><b>${t('Масштаб')}</b><small>${t('«Авто» подстраивает интерфейс под размер окна')}</small></div>${seg('data-scale', t('Масштаб'), SCALES.map(([k, n]) => [k, k === 'auto' ? t(n) : n]))}</div>`)}
    ${box('bell', t('Поведение'),
    sw('animations', t('Анимации'), t('Выключите, если интерфейс тормозит или анимации мешают'))
    + sw('toasts', t('Всплывающие уведомления'), t('Ошибки и предупреждения показываются всегда'))
    + sw('newsBadge', t('Счётчик новых новостей'), t('Число на значке «Новости» в левой панели')))}
  </div>`;
  P('app').innerHTML = `<div class="stack">${box('sliders', t('Лаунчер'),
    sw('minimizeToTray', t('Сворачивать в трей'), t('Крестик скроет окно, а не закроет лаунчер'))
    + sw('autostart', t('Запускать вместе с Windows'), t('В свёрнутом виде'))
    + sw('autoUpdates', t('Обновлять автоматически'), t('Новая версия скачивается в фоне')))}
    ${box('refresh', t('Сброс'), `<div class="srow"><div class="st"><b>${t('Сбросить настройки')}</b><small>${t('Вернёт язык, цвет, масштаб и переключатели. Папка игры и выбранный сервер останутся.')}</small></div>
      <div class="sact"><button class="bt g dng sm" data-act="reset">${t('Сбросить')}</button></div></div>`)}</div>`;
  P('about').innerHTML = `<div class="stack">${box('info', t('О программе'), `
      <div class="srow"><div class="st"><b data-f="ver"></b><small data-f="verSub"></small></div><div class="sact"><button class="bt g sm" data-act="update">${t('Проверить обновления')}</button></div></div>
      <div class="srow"><div class="st"><b>${t('Диагностика')}</b><small>${t('Скопируйте сведения о системе и лог — приложите к обращению в поддержку')}</small></div>
        <div class="sact"><button class="bt g sm" data-act="diag">${ic('copy')}${t('Скопировать')}</button><button class="bt g sm" data-act="logs">${t('Папка логов')}</button></div></div>`)}</div>`;

  const F = (n) => $(`[data-f="${n}"]`, root);
  /** Выставить значения у существующих элементов. Ничего не создаёт и не удаляет. */
  function sync() {
    const s = S.settings || {}; const g = S.game || {}; const cl = g.client || {}; const i = S.info || {};
    $$('[data-sw]', root).forEach((b) => { const on = s[b.dataset.sw] !== false && !!s[b.dataset.sw]; if (b.getAttribute('aria-checked') !== String(on)) b.setAttribute('aria-checked', String(on)); });
    $$('[data-lang]', root).forEach((b) => b.setAttribute('aria-checked', String((s.lang || 'ru') === b.dataset.lang)));
    $$('[data-acc]', root).forEach((b) => b.setAttribute('aria-checked', String((s.accent || 'violet') === b.dataset.acc)));
    $$('[data-scale]', root).forEach((b) => b.setAttribute('aria-checked', String((s.scale || 'auto') === b.dataset.scale)));
    const setT = (n, v) => { const e = F(n); if (e && e.textContent !== v) e.textContent = v; };
    setT('path', g.gta ? g.gta.dir : t('Не найдена'));
    setT('client', cl.installed ? `${t('Установлен')} ${cl.version || ''}`.trim() : t('Не установлен'));
    $$('[data-f="inst"]', root).forEach((b) => { b.disabled = !cl.installed; });
    setT('ver', '4ONE Launcher ' + (i.version || ''));
    const u = S.update || {};
    setT('verSub', u.state === 'none' ? t('Установлена последняя версия') : u.state === 'available' ? t('Доступна версия {v}', { v: u.version }) : i.mock ? t('Демо-режим: данные не настоящие') : 'Electron ' + (i.electron || ''));
  }

  delegate(root, 'click', '[data-sw]', async (el) => {
    const on = el.getAttribute('aria-checked') !== 'true'; el.setAttribute('aria-checked', String(on));
    if (!check(await setSetting({ [el.dataset.sw]: on }))) sync();
  });
  delegate(root, 'click', '[data-lang]', async (el) => {
    if (el.dataset.lang === (S.settings.lang || 'ru')) return;
    if (check(await setSetting({ lang: el.dataset.lang }))) window.dispatchEvent(new CustomEvent('l4:lang', { detail: el.dataset.lang }));
  });
  delegate(root, 'click', '[data-acc]', async (el) => { $$('[data-acc]', root).forEach((b) => b.setAttribute('aria-checked', String(b === el))); check(await setSetting({ accent: el.dataset.acc })); });
  delegate(root, 'click', '[data-scale]', async (el) => { $$('[data-scale]', root).forEach((b) => b.setAttribute('aria-checked', String(b === el))); check(await setSetting({ scale: el.dataset.scale })); });
  delegate(root, 'click', '[data-act]', async (el) => {
    const a = el.dataset.act;
    if (a === 'detect') { const r = await call('game:detect'); if (check(r)) toast(r.data && r.data.gta ? 'ok' : 'warn', r.data && r.data.gta ? t('GTA V найдена') : t('GTA V не найдена — укажите папку вручную')); }
    else if (a === 'browse') check(await call('game:browse'));
    else if (a === 'verify') check(await call('game:verify'));
    else if (a === 'uninstall') {
      if (await confirmBox(t('Удалить файлы клиента?'), t('Будут удалены файлы 4ONE из папки GTA V. Сама игра останется нетронутой.'), t('Удалить'), true)) check(await call('game:uninstall'));
    } else if (a === 'reset') {
      if (!await confirmBox(t('Сбросить настройки?'), t('Язык, цвет, масштаб и переключатели вернутся к значениям по умолчанию. Папка игры и выбранный сервер сохранятся.'), t('Сбросить'), true)) return;
      const r = await call('settings:reset'); if (!check(r)) return;
      const lang = S.settings.lang; patch({ settings: r.data }, 'settings'); toast('ok', t('Настройки сброшены'));
      if (r.data.lang !== lang) window.dispatchEvent(new CustomEvent('l4:lang', { detail: r.data.lang }));
    } else if (a === 'update') {
      const r = await call('update:check'); if (!check(r)) return;
      const st = r.data && r.data.state;
      if (st === 'available') toast('info', t('Найдено обновление {v}', { v: r.data.version }));
      else if (st === 'unsupported') toast('info', t('Автообновление работает в установленной версии'));
      else toast('ok', t('Установлена последняя версия'));
    } else if (a === 'diag') { if (check(await call('app:copyDiagnostics'))) toast('ok', t('Скопировано в буфер обмена')); }
    else if (a === 'logs') check(await call('app:openPath', 'logs'));
  });
  sync();
  return { update(st, what) { if (['game', 'settings', 'update'].includes(what)) sync(); } };
}
