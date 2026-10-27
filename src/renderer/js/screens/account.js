import { call } from '../api.js';
import { S } from '../state.js';
import { $, esc, ic, num, c4, hours, ago, dateShort, confirmBox, delegate, empty } from '../ui.js';
import { check, openExt } from '../actions.js';
import { tabs } from '../tabs.js';
import { roleLabel } from '../role.js';
import { t } from '../i18n.js';

const METHOD = () => ({ discord: 'Discord', email: t('Почта'), google: 'Google', vk: 'VK', telegram: 'Telegram', steam: 'Steam' });
const STATUS = () => ({ active: [t('Активен'), 'ok'], banned: [t('Заблокирован'), 'no'], pending: [t('Ожидает подтверждения'), 'warn'] });
const LOGIN_VIA = () => ({ launcher: t('Лаунчер'), site: t('Сайт'), game: t('Игра') });
const PROV_ICON = { discord: 'discord', telegram: 'telegram', steam: 'steam', google: 'google', email: 'mail' };
let lastTab = 'profile'; // вкладка переживает смену языка и возврат на страницу

const skel = (n, h) => Array.from({ length: n }, () => `<div class="sk" style="height:${h}px"></div>`).join('');
const failBox = (key) => `<div class="empty"><div class="ei">${ic('signal')}</div><div><b>${t('Не удалось загрузить')}</b><br>${t('Проверьте интернет и попробуйте ещё раз')}</div><button class="bt g sm" data-retry="${key}">${ic('refresh')}${t('Повторить')}</button></div>`;
const usd = (n) => `<span class="usd num">$${num(n)}</span>`;

export function mount(root, ctx) {
  root.innerHTML = `<header class="scr-head in" style="--i:0"><div><h1>${t('Аккаунт')}</h1></div></header><div id="host"></div>`;
  const TABS = [
    { k: 'profile', name: t('Профиль'), icon: 'userc' }, { k: 'security', name: t('Безопасность'), icon: 'shield' },
    { k: 'devices', name: t('Устройства'), icon: 'devices' }, { k: 'history', name: t('Входы'), icon: 'hist' },
    { k: 'wallet', name: t('Кошелёк'), icon: 'wallet' }, { k: 'chars', name: t('Персонажи'), icon: 'users' },
  ];
  const cache = {}; const state = {}; // cache[k] — данные вкладки, state[k] — 'idle|load|ok|err'
  const LOADERS = {
    security: () => call('account:security'), devices: () => call('account:sessions'), history: () => call('account:history'),
    wallet: () => call('account:wallet'), chars: () => call('account:characters'),
  };
  let view = null; // onShow срабатывает уже внутри tabs(), поэтому view может быть ещё пуст
  view = tabs($('#host', root), TABS, { initial: (ctx.arg && ctx.arg.tab) || lastTab, label: t('Аккаунт'), onShow: (k) => { lastTab = k; if (view) load(k); } });
  load(view.current());

  async function load(k, force) {
    if (!LOADERS[k] || state[k] === 'load' || (state[k] === 'ok' && !force)) return;
    state[k] = 'load'; if (!cache[k]) paint(k);
    const r = await LOADERS[k]();
    state[k] = r.ok ? 'ok' : 'err'; if (r.ok) cache[k] = r.data;
    paint(k);
  }

  // ---- вкладки
  const PAINT = {
    profile() {
      const p = S.auth.profile; if (!p) return '';
      const name = p.gameName || p.nickname || p.username; const st = STATUS()[p.accountStatus] || [p.accountStatus || '—', 'mute'];
      return `
      <div class="gp spk"><div class="pad prof-h">
        <span class="avatar lg">${esc(name.trim().charAt(0).toUpperCase())}</span>
        <div class="ph-t"><h2>${esc(name)}</h2><div class="ph-s"><span>@${esc(p.username)}</span><span class="bdg">${esc(roleLabel(p))}</span><span class="bdg ${st[1]}">${esc(st[0])}</span></div></div>
        <button class="ph-bal" data-tab-go="wallet" title="${t('Кошелёк')}"><small>${t('Баланс')}</small>${c4(p.balance4c)}</button>
      </div></div>
      <div class="two">
        <div class="gp flat"><div class="gh"><div class="ico">${ic('id')}</div><h2>${t('Данные')}</h2></div><div class="pad kvs">
          <div class="kv"><span>${t('Номер аккаунта')}</span><b class="num">${esc(p.accountId || '—')}</b></div>
          <div class="kv"><span>${t('Почта')}</span><b>${esc(p.email || '—')}</b></div>
          <div class="kv"><span>${t('Способ входа на сайт')}</span><b>${esc(METHOD()[p.authMethod] || p.authMethod || '—')}</b></div>
          <div class="kv"><span>${t('Регистрация')}</span><b>${esc(dateShort(p.createdAt) || '—')}</b></div>
        </div></div>
        <div class="gp flat"><div class="gh"><div class="ico">${ic('gauge')}</div><h2>${t('Игра')}</h2></div><div class="pad kvs">
          <div class="kv"><span>${t('Уровень')}</span><b class="num">${num(p.level)}</b></div>
          <div class="kv"><span>${t('Фракция')}</span><b>${esc(p.faction || t('Нет'))}</b></div>
          <div class="kv"><span>${t('Время в игре')}</span><b>${esc(hours(p.hours * 60 || S.settings.playMinutes))}</b></div>
          <div class="kv"><span>${t('Доступ к лаунчеру')}</span><b class="${p.launcherAccess ? 'tone-ok' : 'tone-err'}">${p.launcherAccess ? t('Выдан') : t('Не выдан')}</b></div>
        </div></div>
      </div>
      <div class="acts">
        <button class="bt g" data-act="cabinet">${ic('globe')}${t('Личный кабинет на сайте')}</button>
        <button class="bt g" data-act="donate">${ic('coin')}${t('Пополнить 4Coin')}</button>
        <span class="sp"></span>
        <button class="bt dng g" data-act="logout">${ic('logout')}${t('Выйти')}</button>
      </div>
      `;
    },
    security(d) {
      const row = (icon, title, sub, ok, okText, noText) => `<div class="srow"><div class="ico-s">${ic(icon)}</div><div class="st"><b>${title}</b><small>${sub}</small></div><span class="bdg ${ok ? 'ok' : 'warn'}">${ok ? okText : noText}</span></div>`;
      const links = d.links || [];
      return `
      <div class="gp flat"><div class="gh"><div class="ico">${ic('shield')}</div><h2>${t('Защита аккаунта')}</h2></div>
        ${row('mail', t('Почта'), t('Нужна для восстановления доступа'), d.emailVerified, t('Подтверждена'), t('Не подтверждена'))}
        ${row('lock', t('Пароль'), t('Меняется на сайте'), d.passwordSet, t('Задан'), t('Не задан'))}
        ${row('fingerprint', t('Двухфакторная защита'), t('Код из приложения при входе на сайт'), d.twoFactor, t('Включена'), t('Выключена'))}
      </div>
      <div class="gp flat"><div class="gh"><div class="ico">${ic('link')}</div><h2>${t('Привязанные способы входа')}</h2></div>
        ${links.map((l) => `<div class="srow"><div class="ico-s">${PROV_ICON[l.provider] ? ic(PROV_ICON[l.provider]) : `<span class="txtb">${esc((METHOD()[l.provider] || l.provider).slice(0, 2).toUpperCase())}</span>`}</div>
          <div class="st"><b>${esc(METHOD()[l.provider] || l.provider)}</b><small>${l.linked ? esc(l.label || t('Привязан')) : t('Не привязан')}</small></div>
          <button class="bt g sm" data-act="cabinet">${l.linked ? t('Управлять') : t('Привязать')}</button></div>`).join('')}
      </div>
      `;
    },
    devices(list) {
      const others = list.filter((x) => !x.current).length;
      return `
      <div class="gp flat"><div class="gh"><div class="ico">${ic('devices')}</div><h2>${t('Активные сессии')}</h2><span class="sp"></span>
        ${others ? `<button class="bt g dng sm" data-act="revoke-others">${t('Завершить остальные')}</button>` : ''}</div>
        ${list.map((x) => `<div class="srow"><div class="ico-s">${ic(/chrome|android|firefox|safari|edge/i.test(x.os) ? 'globe' : 'device')}</div>
          <div class="st"><b>${esc(x.device)}${x.current ? ` <span class="bdg ok">${t('Это устройство')}</span>` : ''}</b><small>${esc(x.os)} · ${esc(x.place)} · ${esc(x.ip)} · ${esc(x.current ? t('сейчас') : ago(x.lastAt))}</small></div>
          ${x.current ? '' : `<button class="bt g sm" data-act="revoke" data-id="${esc(x.id)}">${t('Завершить')}</button>`}</div>`).join('')}
      </div>
      <p class="hint">${t('Если видите незнакомое устройство — завершите сессию и смените пароль на сайте.')}</p>`;
    },
    history(list) {
      if (!list.length) return empty('hist', t('Входов пока нет'), t('Здесь будут записи о входах в аккаунт'));
      return `<div class="gp flat"><div class="gh"><div class="ico">${ic('hist')}</div><h2>${t('История входов')}</h2></div>
        ${list.map((x) => `<div class="srow"><div class="ico-s ${x.ok ? '' : 'bad'}">${ic(x.ok ? 'check-c' : 'x-c')}</div>
          <div class="st"><b>${esc(x.device)}</b><small>${esc(x.place)} · ${esc(x.ip)} · ${esc(LOGIN_VIA()[x.method] || x.method)}</small></div>
          <div class="when"><span class="bdg ${x.ok ? 'ok' : 'no'}">${x.ok ? t('Успешно') : t('Отклонён')}</span><small>${esc(ago(x.at))}</small></div></div>`).join('')}</div>`;
    },
    wallet(d) {
      const inc = d.items.filter((x) => x.amount > 0).reduce((a, x) => a + x.amount, 0); const out = d.items.filter((x) => x.amount < 0).reduce((a, x) => a - x.amount, 0);
      return `
      <div class="gp spk"><div class="pad wal-h">
        <div><small>${t('Баланс')}</small><div class="wal-n">${c4(d.balance)}</div>
          <div class="wal-s"><span class="up">+${num(inc)}</span><span class="dn">−${num(out)}</span><small>${t('за последние операции')}</small></div></div>
        <div class="acts"><button class="bt" data-act="donate">${ic('plus')}${t('Пополнить')}</button><button class="bt g" data-act="promo">${ic('gift')}${t('Ввести промокод')}</button></div>
      </div></div>
      <div class="gp flat"><div class="gh"><div class="ico">${ic('receipt')}</div><h2>${t('Операции')}</h2></div>
        ${d.items.length ? d.items.map((x) => `<div class="srow"><div class="ico-s ${x.amount < 0 ? 'bad' : ''}">${ic(x.amount < 0 ? 'minus' : 'plus')}</div>
          <div class="st"><b>${esc(t(x.title))}</b><small>${esc(dateShort(x.at))}</small></div>
          <b class="amt ${x.amount < 0 ? 'dn' : 'up'} num">${x.amount < 0 ? '−' : '+'}${num(Math.abs(x.amount))} <small>4Coin</small></b></div>`).join('') : empty('receipt', t('Операций пока нет'), t('Пополнение и покупки появятся здесь'))}
      </div>`;
    },
    chars(list) {
      if (!list.length) return empty('users', t('Персонажей пока нет'), t('Создайте первого персонажа при входе на сервер'));
      return `<div class="chars">${list.map((c) => `
        <div class="gp flat ch-card"><div class="pad">
          <div class="ch-top"><span class="avatar">${esc(c.name.charAt(0).toUpperCase())}</span><div class="st"><b>${esc(c.name)}</b><small>${esc(t(c.job))}</small></div><span class="bdg">${t('Ур.')} ${num(c.level)}</span></div>
          <div class="kv"><span>${t('Наличные')}</span><b>${usd(c.cash)}</b></div>
          <div class="kv"><span>${t('Банк')}</span><b>${usd(c.bank)}</b></div>
          <div class="kv"><span>${t('Был в игре')}</span><b>${esc(ago(c.lastAt))}</b></div>
        </div></div>`).join('')}</div>`;
    },
  };

  function paint(k) {
    const p = view.pane(k); if (!p) return;
    let h;
    if (k === 'profile') h = PAINT.profile();
    else if (cache[k]) h = PAINT[k](cache[k]);
    else if (state[k] === 'err') h = failBox(k);
    else h = skel(3, 76);
    // обновляем только содержимое своей панели, прокрутку страницы не трогаем
    p.innerHTML = `<div class="stack">${h}</div>`;
  }

  delegate(root, 'click', '[data-retry]', (el) => { state[el.dataset.retry] = 'idle'; load(el.dataset.retry, true); });
  delegate(root, 'click', '[data-tab-go]', (el) => view.show(el.dataset.tabGo));
  delegate(root, 'click', '[data-act]', async (el) => {
    const a = el.dataset.act;
    if (a === 'cabinet') openExt('cabinet');
    else if (a === 'donate') openExt('donate');
    else if (a === 'promo') ctx.go('codes');
    else if (a === 'logout') {
      if (await confirmBox(t('Выйти из аккаунта?'), t('Чтобы войти снова, понадобится новый код с сайта.'), t('Выйти'), false)) check(await call('auth:logout'));
    } else if (a === 'revoke') {
      el.classList.add('busy'); if (check(await call('account:revokeSession', el.dataset.id))) { await load('devices', true); } else el.classList.remove('busy');
    } else if (a === 'revoke-others') {
      if (await confirmBox(t('Завершить остальные сессии?'), t('Все устройства, кроме этого, потребуют вход заново.'), t('Завершить'), true)) { if (check(await call('account:revokeOthers'))) await load('devices', true); }
    }
  });
  paint('profile');
  return {
    update(st, what) {
      // баланс и профиль обновились — перерисовываем только вкладки, где они есть
      if (what === 'auth' || what === 'data') { paint('profile'); if (cache.wallet) { cache.wallet.balance = S.auth.profile ? S.auth.profile.balance4c : cache.wallet.balance; if (view.current() === 'wallet') paint('wallet'); else state.wallet = 'idle'; } }
    },
  };
}
