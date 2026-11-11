import { call } from '../api.js';
import { S, patch } from '../state.js';
import { $, $$, esc, ic, delegate, confirmBox, toast, bytes } from '../ui.js';
import { setSetting, check, openExt } from '../actions.js';
import { tabs } from '../tabs.js';
import { t } from '../i18n.js';
import { vkFromKey, vkFromMouse, vkName } from '../vk.js';

const ACC_DEF = [['violet', 'Лиловый', '#b9a3ff'], ['mint', 'Мята', '#9fd4b4'], ['rose', 'Роза', '#f0a0b4'], ['sky', 'Небо', '#9cc4f5']];
// ключи: t('Лиловый') t('Мята') t('Роза') t('Небо')
const SCALES = [['auto', 'Авто'], ['90', '90%'], ['100', '100%'], ['110', '110%'], ['125', '125%'], ['150', '150%']];
let lastTab = 'game';

const sw = (key, title, desc) => `<div class="srow"><div class="st"><b>${title}</b><small>${desc}</small></div><button class="sw" role="switch" aria-checked="false" aria-label="${esc(title)}" data-sw="${key}"><i></i></button></div>`;
const seg = (attr, label, items) => `<div class="seg" role="radiogroup" aria-label="${esc(label)}">${items.map(([k, n, l]) => `<button role="radio" aria-checked="false" ${attr}="${k}"${l ? ` lang="${l}"` : ''}>${esc(n)}</button>`).join('')}</div>`;
/** Выбор из нескольких значений настройки key: data-pick="key" data-v="значение" (синхронизирует sync()) */
const pick = (key, label, items) => `<div class="seg wrap" role="radiogroup" aria-label="${esc(label)}">${items.map(([v, n]) => `<button role="radio" aria-checked="false" data-pick="${key}" data-v="${v}">${esc(n)}</button>`).join('')}</div>`;
const row = (title, desc, ctrl) => `<div class="srow"><div class="st"><b>${title}</b><small>${desc}</small></div>${ctrl}</div>`;
const SRC = { rockstar: 'Rockstar', steam: 'Steam', epic: 'Epic Games', manual: '' };
// ---- настройки игры (меню F1 клиента): элементы с data-pref-*, значения выставляет syncPrefs()
const psw = (key, title, desc) => `<div class="srow"><div class="st"><b>${title}</b><small>${desc}</small></div><button class="sw" role="switch" aria-checked="false" aria-label="${esc(title)}" data-pref-sw="${key}"><i></i></button></div>`;
const ppick = (key, label, items) => `<div class="seg wrap" role="radiogroup" aria-label="${esc(label)}">${items.map(([v, n]) => `<button role="radio" aria-checked="false" data-pref-pick="${key}" data-v="${esc(String(v))}">${esc(n)}</button>`).join('')}</div>`;
const prange = (key, title, desc, min, max, step, unit) => `<div class="srow"><div class="st"><b>${title}</b><small>${desc}</small></div>
  <div class="rng"><input type="range" min="${min}" max="${max}" step="${step}" data-pref-range="${key}" aria-label="${esc(title)}"><output data-pref-out="${key}" data-unit="${unit || ''}"></output></div></div>`;
const pkey = (key, title, desc) => `<div class="srow"><div class="st"><b>${title}</b><small>${desc}</small></div><button class="bt g sm keycap" data-pref-key="${key}" aria-label="${esc(title)}"></button></div>`;
const ACCENTS = ['#FF3D8A', '#A855F7', '#6366F1', '#3B82F6', '#06B6D4', '#10B981', '#84CC16', '#F59E0B', '#F97316', '#EF4444']; // как в F1 клиента
const box = (icon, title, body, extra) => `<div class="gp flat"><div class="gh"><div class="ico">${ic(icon)}</div><h2>${title}</h2>${extra || ''}</div>${body}</div>`;

/**
 * Страница строится один раз. Любое изменение настроек только выставляет значения у уже существующих элементов (sync),
 * поэтому прокрутка и фокус не сбрасываются, а страница не мигает.
 */
export function mount(root, ctx) {
  root.innerHTML = `<header class="scr-head in" style="--i:0"><div><h1>${t('Настройки')}</h1></div></header><div id="host"></div>`;
  const TABS = [
    { k: 'game', name: t('Игра'), icon: 'folder' }, { k: 'gfx', name: t('Графика'), icon: 'gauge' },
    { k: 'voice', name: t('Голос'), icon: 'mega' }, { k: 'keys', name: t('Клавиши'), icon: 'grid' },
    { k: 'ingame', name: t('В игре'), icon: 'gamepad' }, { k: 'download', name: t('Загрузка'), icon: 'down2' },
    { k: 'app', name: t('Лаунчер'), icon: 'sliders' }, { k: 'look', name: t('Интерфейс'), icon: 'palette' }, { k: 'about', name: t('О программе'), icon: 'info' },
  ];
  const PREF_TABS = ['game', 'gfx', 'voice', 'keys', 'ingame'];
  let booted = false; // onShow вызывается уже внутри tabs(), до объявления состояния ниже — первую загрузку делаем в конце mount
  const view = tabs($('#host', root), TABS, { initial: (ctx.arg && ctx.arg.tab) || lastTab, label: t('Настройки'), onShow: (k) => { lastTab = k; if (!booted) return; if (k === 'download') loadCache(); if (PREF_TABS.includes(k)) loadPrefs(); if (k !== 'voice') micStop(); } });
  const P = (k) => view.pane(k);

  P('game').innerHTML = `<div class="stack">
    ${box('folder', t('GTA V'), `
      <div class="srow"><div class="st"><b>${t('Папка GTA V')}</b><small class="path" data-f="path"></small></div>
        <div class="sact"><button class="bt g sm" data-act="detect">${ic('search')}${t('Найти автоматически')}</button><button class="bt g sm" data-act="browse">${t('Выбрать…')}</button></div></div>
      <div class="srow"><div class="st"><b>${t('Версия игры')}</b><small data-f="gver"></small></div></div>
      <div class="found" data-f="found"></div>`)}
    ${box('shield', t('Клиент 4ONE'), `
      <div class="srow"><div class="st"><b>${t('Файлы клиента')}</b><small data-f="client"></small></div>
        <div class="sact"><button class="bt g sm" data-act="verify" data-f="inst">${ic('refresh')}${t('Проверить')}</button><button class="bt g dng sm" data-act="uninstall" data-f="inst">${t('Удалить')}</button></div></div>`)}
  </div>`;
  P('game').insertAdjacentHTML('beforeend', `<div class="stack">${box('rocket', t('Запуск игры'),
    row(t('После запуска игры'), t('Что сделать с окном лаунчера, когда GTA V запустилась'), pick('afterStart', t('После запуска игры'), [['minimize', t('Свернуть')], ['tray', t('В трей')], ['close', t('Закрыть')], ['none', t('Ничего')]]))
    + row(t('Приоритет процесса игры'), t('«Высокий» может дать немного больше FPS на слабых ПК'), pick('gamePriority', t('Приоритет процесса игры'), [['normal', t('Обычный')], ['abovenormal', t('Выше среднего')], ['high', t('Высокий')]]))
    + row(t('Режим окна GTA V'), t('Меняется в настройках самой игры (settings.xml)'), ppick('windowMode', t('Режим окна GTA V'), [['fullscreen', t('Полный экран')], ['borderless', t('Без рамки')], ['windowed', t('В окне')]]))
    + psw('vsync', t('Вертикальная синхронизация'), t('Без разрывов кадра, но с небольшой задержкой ввода')))}</div>`);
  P('download').innerHTML = `<div class="stack">
    ${box('folder', t('Папка 4ONE RP'), `
      <div class="srow"><div class="st"><b>${t('Всё для игры в одной папке')}</b><small class="path" data-f="root"></small></div>
        <div class="sact"><button class="bt g sm" data-act="rootOpen">${t('Открыть папку')}</button></div></div>
      <div class="srow"><div class="st"><b>${t('Клиент и файлы серверов')}</b><small data-f="where"></small></div>
        <div class="sact"><button class="bt sm" data-act="relocate" data-f="move" hidden>${t('Перенести сюда')}</button></div></div>
      <p class="snote">${t('Launcher — лаунчер, Game — клиент игры, data внутри Game — моды и файлы серверов, журналы, настройки F1. В папке GTA V лежат только три файла для запуска.')}</p>`)}
    ${box('down2', t('Загрузка клиента'),
    row(t('Ограничение скорости'), t('Чтобы загрузка не мешала другим программам. Меняется сразу, даже во время загрузки'), pick('dlLimit', t('Ограничение скорости'), [['0', t('Без ограничения')], ['50', '50 МБ/с'], ['20', '20 МБ/с'], ['10', '10 МБ/с'], ['5', '5 МБ/с']])))}
    ${box('disk', t('Скачанные файлы'), `
      <div class="srow"><div class="st"><b>${t('Комплект клиента')}</b><small class="path" data-f="cache"></small></div>
        <div class="sact"><button class="bt g sm" data-act="cacheOpen">${t('Открыть папку')}</button><button class="bt g dng sm" data-act="cacheClear">${t('Очистить')}</button></div></div>
      <p class="snote">${t('Установленный клиент это не затрагивает. Если комплект понадобится снова, лаунчер скачает его сам.')}</p>`)}
  </div>`;
  const NOTIF = `<div class="stack">
    ${box('bell', t('Системные уведомления'),
    sw('notifyNews', t('Новые новости'), t('Уведомление Windows, когда лаунчер свёрнут или в трее'))
    + sw('notifyServer', t('Сервер снова доступен'), t('После технических работ или перезапуска сервера')))}
    ${box('mega', t('В лаунчере'),
    sw('toasts', t('Всплывающие уведомления'), t('Ошибки и предупреждения показываются всегда'))
    + sw('newsBadge', t('Счётчик новых новостей'), t('Число на значке «Новости» в левой панели')))}
  </div>`;
  const lockNote = `<div class="pref-lock" data-f="lock" hidden>${ic('alert')}<span>${t('GTA V запущена — эти настройки можно менять после выхода из игры или в самой игре через F1.')}</span></div>`;
  P('gfx').innerHTML = `<div class="stack">${lockNote}${box('gauge', t('Графика'),
    prange('drawDistance', t('Дальность прорисовки'), t('Больше — дальше видно, ниже FPS'), 50, 200, 5, '%')
    + `<div class="srow"><div class="st"><b>${t('Ограничение FPS')}</b><small>${t('Ровный темп кадров, меньше рывков. «Как у сервера» — значение сервера')}</small></div>${ppick('fpsLimit', t('Ограничение FPS'), [[-1, t('Как у сервера')], [0, t('Без ограничения')], [30, '30'], [60, '60'], [120, '120'], [144, '144'], [165, '165'], [240, '240']])}</div>`
    + psw('cefGpu', t('Страницы на видеокарте'), t('Интерфейс сервера плавнее, меньше нагрузка на процессор. Применится при следующем запуске игры')))}
    <p class="snote">${t('Эти настройки — те же, что в меню F1 в игре. Изменения применятся при следующем запуске.')}</p></div>`;
  P('voice').innerHTML = `<div class="stack">${lockNote}${box('mega', t('Звук и голос'),
    psw('voiceEnabled', t('Голосовой чат'), t('Выключен — микрофон закрыт, других не слышно'))
    + `<div class="srow"><div class="st"><b>${t('Микрофон')}</b><small>${t('Для голосового чата')}</small></div><select class="sel" data-pref-sel="micDevice" aria-label="${t('Микрофон')}"></select></div>`
    + `<div class="srow"><div class="st"><b>${t('Динамики')}</b><small>${t('Где слышны другие игроки')}</small></div><select class="sel" data-pref-sel="outDevice" aria-label="${t('Динамики')}"></select></div>`
    + prange('micVolume', t('Громкость микрофона'), t('Как громко вас слышат'), 0, 200, 5, '%')
    + prange('voiceVolume', t('Громкость голосов'), t('Как громко вы слышите других'), 0, 200, 5, '%'))}
    ${box('fingerprint', t('Режим голоса'),
    `<div class="srow"><div class="st"><b>${t('Как включается микрофон')}</b><small>${t('По кнопке или голосом')}</small></div>${ppick('voiceMode', t('Режим голоса'), [['key', t('По кнопке')], ['voice', t('Голосом')]])}</div>`
    + prange('voiceThreshold', t('Порог голоса'), t('Для режима «голосом»: тише — не слышно'), 5, 90, 5, '%')
    + psw('voiceAutoGain', t('Авто-громкость микрофона'), t('Тихий и громкий микрофон звучат ровно'))
    + psw('voiceNoise', t('Подавление фона'), t('Убирает гул и тихий шум между словами'))
    + `<div class="srow"><div class="st"><b>${t('Проверка микрофона')}</b><small>${t('Говорите — полоска покажет уровень. Звук никуда не отправляется')}</small></div>
        <div class="mic"><div class="pb thick mic-pb"><i data-f="mic"></i></div><button class="bt g sm" data-act="mic">${ic('mega')}<span data-f="micLabel">${t('Проверить')}</span></button></div></div>`)}</div>`;
  P('keys').innerHTML = `<div class="stack">${lockNote}${box('grid', t('Клавиши'),
    pkey('voiceKey', t('Голос'), t('Удерживайте, чтобы говорить'))
    + pkey('radioKey', t('Рация'), t('Голос в каналах сервера'))
    + pkey('chatKey', t('Чат'), t('Открыть строку чата'))
    + pkey('consoleKey', t('Консоль'), t('Открыть консоль клиента'))
    + `<div class="srow"><div class="st"><b>${t('Как на сервере')}</b><small>${t('Вернуть клавиши, которые задал сервер')}</small></div><button class="bt g sm" data-act="prefReset" data-g="keys">${t('Сбросить')}</button></div>`)}
    <p class="snote">${t('Нажмите на клавишу и затем нужную кнопку клавиатуры или мыши. Esc — отмена, Backspace — как на сервере.')}</p></div>`;
  P('ingame').innerHTML = `<div class="stack">${lockNote}${box('palette', t('Внешний вид в игре'),
    `<div class="srow"><div class="st"><b>${t('Акцентный цвет')}</b><small>${t('Ники, консоль, уведомления, чат и меню F1')}</small></div>
      <div class="acc" role="radiogroup" aria-label="${t('Акцентный цвет')}"><button role="radio" aria-checked="false" data-pref-pick="accent" data-v="" class="acc-srv" title="${t('Как на сервере')}" aria-label="${t('Как на сервере')}">${ic('server')}</button>${ACCENTS.map((c) => `<button role="radio" aria-checked="false" data-pref-pick="accent" data-v="${c}" style="--c:${c}" aria-label="${c}" title="${c}"></button>`).join('')}</div></div>`
    + `<div class="srow"><div class="st"><b>${t('Уведомления')}</b><small>${t('Вид карточек уведомлений')}</small></div>${ppick('alerts', t('Уведомления'), [['', t('Как на сервере')], ['card', t('Карточка')], ['pill', t('Капсула')], ['strip', t('Полоса')]])}</div>`
    + `<div class="srow"><div class="st"><b>${t('Консоль')}</b><small>${t('Оформление консоли F8')}</small></div>${ppick('consoleSkin', t('Консоль'), [['', t('Как на сервере')], ['obsidian', 'Obsidian'], ['slate', 'Slate'], ['glass', 'Glass']])}</div>`
    + `<div class="srow"><div class="st"><b>${t('Как на сервере')}</b><small>${t('Цвет, уведомления и консоль сервера')}</small></div><button class="bt g sm" data-act="prefReset" data-g="look">${t('Сбросить')}</button></div>`)}
    ${box('sliders', t('Интерфейс в игре'),
    psw('netgraph', t('FPS и пинг на экране'), t('В правом верхнем углу'))
    + psw('streamerMode', t('Режим стримера'), t('Адрес сервера на экране скрыт'))
    + psw('discord', t('Статус в Discord'), t('«Играет» и название сервера в профиле Discord')))}
    ${box('disk', t('Файлы серверов'),
    `<div class="srow"><div class="st"><b>${t('Хранить ненужные файлы')}</b><small>${t('Моды и ресурсы серверов, которые больше не используются, удаляются сами')}</small></div>${ppick('keepDays', t('Хранить ненужные файлы'), [['', t('30 дней')], ['7', t('7 дней')], ['90', t('90 дней')], ['-1', t('Всегда')]])}</div>`)}
  </div>`;
  P('look').innerHTML = `<div class="stack">${box('palette', t('Внешний вид'), `
      <div class="srow"><div class="st"><b>${t('Язык')}</b><small>${t('Язык интерфейса лаунчера')}</small></div>${seg('data-lang', t('Язык'), [['ru', 'Русский', 'ru'], ['en', 'English', 'en']])}</div>
      <div class="srow"><div class="st"><b>${t('Цвет интерфейса')}</b><small>${t('Как в игре: меняется только акцент')}</small></div>
        <div class="acc" role="radiogroup" aria-label="${t('Цвет интерфейса')}">${ACC_DEF.map(([k, n, c]) => `<button role="radio" aria-checked="false" aria-label="${esc(t(n))}" title="${esc(t(n))}" data-acc="${k}" style="--c:${c}"></button>`).join('')}</div></div>
      <div class="srow"><div class="st"><b>${t('Масштаб')}</b><small>${t('«Авто» подстраивает интерфейс под размер окна')}</small></div>${seg('data-scale', t('Масштаб'), SCALES.map(([k, n]) => [k, k === 'auto' ? t(n) : n]))}</div>`)}
    ${box('sliders', t('Поведение'),
    sw('animations', t('Анимации'), t('Выключите, если интерфейс тормозит или анимации мешают'))
    + sw('rememberRoute', t('Открывать последний раздел'), t('При запуске лаунчер вернётся туда, где вы были')))}
  </div>`;
  P('app').innerHTML = `<div class="stack">${box('sliders', t('Лаунчер'),
    sw('minimizeToTray', t('Сворачивать в трей'), t('Крестик скроет окно, а не закроет лаунчер'))
    + sw('autostart', t('Запускать вместе с Windows'), t('Лаунчер будет готов к игре сразу после входа в систему'))
    + sw('startHidden', t('Запускать свёрнутым'), t('При автозапуске окно не открывается — лаунчер ждёт в трее'))
    + sw('autoUpdates', t('Обновлять автоматически'), t('Новая версия скачивается в фоне')))}
    ${box('refresh', t('Сброс'), `<div class="srow"><div class="st"><b>${t('Сбросить настройки')}</b><small>${t('Вернёт язык, цвет, масштаб и переключатели. Папка игры и выбранный сервер останутся.')}</small></div>
      <div class="sact"><button class="bt g dng sm" data-act="reset">${t('Сбросить')}</button></div></div>`)}</div>` + NOTIF;
  P('about').innerHTML = `<div class="stack">${box('info', t('О программе'), `
      <div class="srow"><div class="st"><b data-f="ver"></b><small data-f="verSub"></small></div><div class="sact"><button class="bt g sm" data-act="update">${t('Проверить обновления')}</button></div></div>
      <div class="srow"><div class="st"><b>${t('Клиент 4ONE')}</b><small data-f="client2"></small></div></div>
      <div class="srow"><div class="st"><b>${t('Диагностика')}</b><small>${t('Скопируйте сведения о системе и лог — приложите к обращению в поддержку')}</small></div>
        <div class="sact"><button class="bt g sm" data-act="diag">${ic('copy')}${t('Скопировать')}</button><button class="bt g sm" data-act="logs">${t('Папка логов')}</button></div></div>
      <div class="srow"><div class="st"><b>${t('Помощь')}</b><small>${t('Сайт проекта, правила и поддержка')}</small></div>
        <div class="sact"><button class="bt g sm" data-act="site">${ic('globe')}${t('Сайт')}</button><button class="bt g sm" data-act="support">${t('Поддержка')}</button></div></div>`)}</div>`;

  let cache = null;
  let prefs = null; let prefsLoading = false; let waitKey = ''; let saveT = null;
  async function loadPrefs(force) {
    if (prefsLoading) return; prefsLoading = true;
    const r = await call('prefs:get', !!force); prefsLoading = false;
    if (r.ok) { prefs = r.data; syncPrefs(); }
  }
  const prefVal = (k) => (prefs ? (k === 'windowMode' || k === 'vsync' ? prefs.gta[k] : prefs.cfg[k]) : undefined);
  function syncPrefs() {
    if (!prefs) return;
    const lock = !!prefs.running;
    $$('[data-f="lock"]', root).forEach((e) => { e.hidden = !lock; });
    $$('[data-pref-sw]', root).forEach((b) => { b.setAttribute('aria-checked', String(!!prefVal(b.dataset.prefSw))); b.disabled = lock || (b.dataset.prefSw === 'vsync' && !prefs.gta.exists); });
    $$('[data-pref-pick]', root).forEach((b) => {
      const k = b.dataset.prefPick; let v = prefVal(k); if (k === 'keepDays') v = v == null ? '' : String(v);
      b.setAttribute('aria-checked', String(String(v == null ? '' : v) === b.dataset.v)); b.disabled = lock || (k === 'windowMode' && !prefs.gta.exists);
    });
    $$('[data-pref-range]', root).forEach((i) => { const k = i.dataset.prefRange; if (document.activeElement !== i) i.value = prefVal(k); i.disabled = lock; const o = $(`[data-pref-out="${k}"]`, root); if (o) o.textContent = `${Math.round(i.value)}${o.dataset.unit}`; });
    $$('[data-pref-sel]', root).forEach((sel) => {
      const k = sel.dataset.prefSel; const list = k === 'micDevice' ? prefs.devices.inputs : prefs.devices.outputs;
      const want = [t('Как в Windows'), ...list].join('\n');
      if (sel.dataset.k !== want) { sel.dataset.k = want; sel.innerHTML = [t('Как в Windows'), ...list].map((n, i) => `<option value="${i}">${esc(n)}</option>`).join(''); }
      sel.value = String(Math.min(prefVal(k) || 0, list.length)); sel.disabled = lock;
    });
    $$('[data-pref-key]', root).forEach((b) => {
      const k = b.dataset.prefKey; const vk = prefVal(k);
      b.textContent = waitKey === k ? t('Нажмите клавишу…') : (vk ? vkName(vk) : t('Как на сервере'));
      b.classList.toggle('wait', waitKey === k); b.disabled = lock;
    });
  }
  async function setPref(patch) {
    const r = await call('prefs:set', patch);
    if (!check(r)) { loadPrefs(); return; }
    prefs = r.data; syncPrefs();
  }
  // ---- проверка микрофона: тот же микрофон, что выбран для игры (по имени устройства Windows)
  let mic = null;
  async function micStart() {
    try {
      const idx = prefVal('micDevice') || 0; const name = idx ? (prefs.devices.inputs[idx - 1] || '') : '';
      let deviceId;
      if (name) { const list = await navigator.mediaDevices.enumerateDevices(); const d = list.find((x) => x.kind === 'audioinput' && x.label && x.label.startsWith(name.slice(0, 28))); if (d) deviceId = { exact: d.deviceId }; }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId } : true });
      const ctxA = new AudioContext(); const an = ctxA.createAnalyser(); an.fftSize = 512; ctxA.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize); const bar = F('mic');
      mic = { stream, ctxA, raf: 0 };
      const tick = () => { an.getByteTimeDomainData(buf); let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128)); bar.style.setProperty('--p', Math.min(1, peak / 90)); mic.raf = requestAnimationFrame(tick); };
      tick(); F('micLabel').textContent = t('Остановить');
    } catch (_) { toast('err', t('Не удалось открыть микрофон. Проверьте, что он подключён и разрешён в Windows.')); micStop(); }
  }
  function micStop() {
    if (!mic) return; cancelAnimationFrame(mic.raf); mic.stream.getTracks().forEach((x) => x.stop()); mic.ctxA.close(); mic = null;
    const bar = F('mic'); if (bar) bar.style.setProperty('--p', 0); const l = F('micLabel'); if (l) l.textContent = t('Проверить');
  }

  async function loadCache() { const r = await call('app:cacheInfo'); if (r.ok) { cache = r.data; sync(); } }

  const F = (n) => $(`[data-f="${n}"]`, root);
  /** Выставить значения у существующих элементов. Ничего не создаёт и не удаляет. */
  function sync() {
    const s = S.settings || {}; const g = S.game || {}; const cl = g.client || {}; const i = S.info || {};
    $$('[data-sw]', root).forEach((b) => { const on = s[b.dataset.sw] !== false && !!s[b.dataset.sw]; if (b.getAttribute('aria-checked') !== String(on)) b.setAttribute('aria-checked', String(on)); });
    $$('[data-lang]', root).forEach((b) => b.setAttribute('aria-checked', String((s.lang || 'ru') === b.dataset.lang)));
    $$('[data-acc]', root).forEach((b) => b.setAttribute('aria-checked', String((s.accent || 'violet') === b.dataset.acc)));
    $$('[data-scale]', root).forEach((b) => b.setAttribute('aria-checked', String((s.scale || 'auto') === b.dataset.scale)));
    $$('[data-pick]', root).forEach((b) => b.setAttribute('aria-checked', String(String(s[b.dataset.pick]) === b.dataset.v)));
    const hid = $('[data-sw=startHidden]', root); if (hid) hid.disabled = !s.autostart;
    const setT = (n, v) => { const e = F(n); if (e && e.textContent !== v) e.textContent = v; };
    setT('path', g.gta ? g.gta.dir : t('Не найдена'));
    setT('client', cl.installed ? `${t('Установлен')} ${cl.version || ''}`.trim() : t('Не установлен'));
    setT('client2', cl.installed ? `${t('Установлен')} ${cl.version || ''}`.trim() : t('Не установлен'));
    setT('gver', g.gta ? [g.gta.version ? 'Legacy ' + g.gta.version : t('Версия не определена'), SRC[g.gta.source] || ''].filter(Boolean).join(' · ') : '—');
    const L = g.layout;
    setT('root', L ? L.root : '—');
    setT('where', !L ? '—' : L.inLayout ? (cl.installed ? t('Установлены в папке 4ONE RP') : t('Будут установлены в папку 4ONE RP')) : t('Сейчас в другой папке: {d}', { d: L.installedDir }));
    const mv = F('move'); if (mv) { mv.hidden = !L || L.inLayout; mv.disabled = !g.gta || ['installing', 'verifying', 'launching', 'ingame'].includes(g.phase); }
    setT('cache', cache ? (cache.bytes ? `${bytes(cache.bytes)} · ${cache.dir}` : t('Пусто')) : '…');
    // найденные копии игры: список меняется редко — перестраиваем только этот блок и только при изменении
    const found = (g.found || []).filter((x) => !g.gta || x.dir.toLowerCase() !== g.gta.dir.toLowerCase());
    const key = JSON.stringify(found);
    const fb = F('found');
    if (fb && fb.dataset.k !== key) {
      fb.dataset.k = key;
      fb.innerHTML = found.length ? `<p class="snote">${t('Найдены ещё копии GTA V:')}</p>` + found.map((x) => `<div class="srow"><div class="st"><b class="path">${esc(x.dir)}</b><small>${esc([x.version ? 'Legacy ' + x.version : (x.enhancedOnly ? 'Enhanced' : ''), SRC[x.source] || ''].filter(Boolean).join(' · '))}${x.supported ? '' : ' · ' + esc(t('не подходит'))}</small></div>
        <div class="sact"><button class="bt g sm" data-act="use" data-dir="${esc(x.dir)}"${x.supported ? '' : ' disabled'}>${t('Использовать')}</button></div></div>`).join('') : '';
    }
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
  delegate(root, 'click', '[data-pick]', async (el) => {
    $$(`[data-pick="${el.dataset.pick}"]`, root).forEach((b) => b.setAttribute('aria-checked', String(b === el)));
    if (!check(await setSetting({ [el.dataset.pick]: el.dataset.v }))) sync();
  });
  delegate(root, 'click', '[data-pref-sw]', (el) => { const on = el.getAttribute('aria-checked') !== 'true'; el.setAttribute('aria-checked', String(on)); setPref({ [el.dataset.prefSw]: on }); });
  delegate(root, 'click', '[data-pref-pick]', (el) => {
    const k = el.dataset.prefPick; const raw = el.dataset.v;
    $$(`[data-pref-pick="${k}"]`, root).forEach((b) => b.setAttribute('aria-checked', String(b === el)));
    const v = k === 'fpsLimit' ? Number(raw) : k === 'keepDays' ? (raw === '' ? null : Number(raw)) : raw;
    setPref({ [k]: v });
  });
  root.addEventListener('input', (e) => { const i = e.target.closest && e.target.closest('[data-pref-range]'); if (!i) return; const o = $(`[data-pref-out="${i.dataset.prefRange}"]`, root); if (o) o.textContent = `${Math.round(i.value)}${o.dataset.unit}`; });
  root.addEventListener('change', (e) => {
    const i = e.target.closest && e.target.closest('[data-pref-range]');
    if (i) { clearTimeout(saveT); saveT = setTimeout(() => setPref({ [i.dataset.prefRange]: Number(i.value) }), 120); return; }
    const sel = e.target.closest && e.target.closest('[data-pref-sel]');
    if (sel) setPref({ [sel.dataset.prefSel]: Number(sel.value) });
  });
  // назначение клавиши: ждём нажатие клавиатуры или боковой/средней кнопки мыши
  delegate(root, 'click', '[data-pref-key]', (el) => { waitKey = waitKey === el.dataset.prefKey ? '' : el.dataset.prefKey; syncPrefs(); });
  const onKey = (e) => {
    if (!waitKey) return;
    e.preventDefault(); e.stopPropagation();
    const k = waitKey; waitKey = '';
    if (e.key === 'Escape') return syncPrefs();
    if (e.key === 'Backspace' || e.key === 'Delete') return setPref({ [k]: 0 });
    const vk = vkFromKey(e); if (!vk) { toast('warn', t('Эту клавишу назначить нельзя')); return syncPrefs(); }
    setPref({ [k]: vk });
  };
  const onMouse = (e) => { if (!waitKey) return; const vk = vkFromMouse(e.button); if (!vk) return; e.preventDefault(); const k = waitKey; waitKey = ''; setPref({ [k]: vk }); };
  document.addEventListener('keydown', onKey, true); document.addEventListener('mousedown', onMouse, true);
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
    else if (a === 'use') { if (check(await call('game:setPath', el.dataset.dir))) toast('ok', t('Папка игры выбрана')); }
    else if (a === 'cacheOpen') check(await call('app:openPath', 'cache'));
    else if (a === 'rootOpen') check(await call('app:openPath', 'root'));
    else if (a === 'relocate') {
      const L = S.game && S.game.layout; if (!L) return;
      if (!await confirmBox(t('Перенести клиент в папку 4ONE RP?'), t('Клиент и файлы серверов переедут в {d}. Это может занять несколько минут; ключ игрока, настройки F1 и скачанные моды сохранятся.', { d: L.game }), t('Перенести'), false)) return;
      check(await call('game:relocate'));
    }
    else if (a === 'cacheClear') {
      if (!await confirmBox(t('Удалить скачанный комплект?'), t('Установленный клиент останется. Если комплект понадобится снова, лаунчер скачает его сам.'), t('Удалить'), true)) return;
      const r = await call('app:clearCache'); if (check(r)) { cache = Object.assign({}, cache || {}, r.data); sync(); toast('ok', t('Скачанные файлы удалены')); }
    } else if (a === 'prefReset') { const r = await call('prefs:reset', el.dataset.g); if (check(r)) { prefs = r.data; syncPrefs(); toast('ok', t('Вернули настройки сервера')); } }
    else if (a === 'mic') { if (mic) micStop(); else await micStart(); }
    else if (a === 'site') openExt('site');
    else if (a === 'support') openExt('support');
  });
  sync();
  booted = true;
  if (view.current() === 'download') loadCache();
  if (PREF_TABS.includes(view.current())) loadPrefs();
  return {
    update(st, what) { if (['game', 'settings', 'update'].includes(what)) sync(); if (what === 'game' && prefs && prefs.running !== !!(S.game && S.game.running)) loadPrefs(); },
    destroy() { micStop(); document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onMouse, true); },
  };
}
