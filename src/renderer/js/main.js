import { call, on } from './api.js';
import { S, patch, subscribe } from './state.js';
import { $, $$, ic, esc, toast, setBanner, num, delegate, modal } from './ui.js';
import * as login from './screens/login.js';
import * as home from './screens/home.js';
import * as news from './screens/news.js';
import * as codes from './screens/codes.js';
import * as account from './screens/account.js';
import * as settings from './screens/settings.js';
import * as admin from './screens/admin.js';
import { roleLabel, rankLabel, canAdmin, alvlOf } from './role.js';
import { t, setLang, getLang } from './i18n.js';
import { applyScale, zoomNow } from './scale.js';

// Разделы. Выбор сервера — не отдельный экран, он на главной.
const ROUTES = {
  home: { tip: 'Играть', icon: 'gamepad', mod: home },
  news: { tip: 'Новости', icon: 'news', mod: news },
  codes: { tip: 'Коды', icon: 'gift', mod: codes },
  admin: { tip: 'Администрирование', icon: 'shield', mod: admin },
  account: { tip: 'Аккаунт', icon: 'userc', mod: account },
  settings: { tip: 'Настройки', icon: 'gear', mod: settings },
};
const KEYS = ['home', 'news', 'codes', 'account', 'settings'];
const allowed = (r) => r !== 'admin' || canAdmin(S.auth.profile); // вкладка администрирования — только по праву admin.panel
const view = $('#view');
let cur = null; let curName = '';

/** go('home') | go('account', { tab: 'wallet' }) | go(route, true) — перерисовать принудительно */
export function go(route, opt) {
  const target = S.auth.authed ? (ROUTES[route] && allowed(route) ? route : 'home') : 'login';
  const force = opt === true; const arg = opt && typeof opt === 'object' ? opt : {};
  if (target === curName && !force && !arg.tab) return;
  if (cur && cur.destroy) cur.destroy();
  const mod = target === 'login' ? login : ROUTES[target].mod;
  view.innerHTML = '';
  const root = document.createElement('section');
  root.className = 'screen enter';
  view.appendChild(root);
  curName = target;
  $('#app').dataset.screen = target === 'login' ? 'login' : 'main';
  patch({ route: target });
  cur = mod.mount(root, { go, arg, refresh: loadData });
  syncRail();
}

// ---------- левая панель (строится один раз, потом только обновляется) ----------
const railItem = (k) => `<button class="nv" data-go="${k}" data-tip="" aria-label="">${ic(ROUTES[k].icon)}<span class="lb"></span><span class="bd" hidden></span></button>`;
function buildRail() {
  const rail = $('#rail');
  rail.innerHTML = `
    <img class="brand w" src="assets/logo/lockup.png" alt="4ONE RP" draggable="false">
    <img class="brand m" src="assets/logo/mark.png" alt="4ONE RP" draggable="false">
    <i class="rail-ind" id="rail-ind"></i>
    ${['home', 'news', 'codes', 'admin'].map(railItem).join('')}
    <div class="grow"></div>
    <div class="me">
      <button class="acct" data-act="profile" data-tip="" aria-label="" aria-haspopup="dialog"><span class="avatar" id="rail-av">?</span><span class="mt"><b id="me-name"></b><small id="me-sub"></small></span></button>
      <button class="nv gear" data-go="settings" data-tip="" aria-label="">${ic('gear')}</button>
    </div>`;
}
function syncRail() {
  const rail = $('#rail'); if (!rail.firstChild) buildRail();
  const login = S.route === 'login';
  rail.hidden = login; if (login) return;
  const p = S.auth.profile; const name = p ? (p.gameName || p.nickname || p.username || '') : '';
  $('[data-go=admin]', rail).hidden = !canAdmin(p);
  $$('[data-go], .acct', rail).forEach((b) => {
    const k = b.dataset.go || 'account'; const label = b.classList.contains('acct') ? (name || t('Аккаунт')) : t(ROUTES[k].tip);
    b.dataset.tip = label; b.setAttribute('aria-label', label);
    const lb = $('.lb', b); if (lb) lb.textContent = label;
    if (S.route === k) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('#rail-av', rail).textContent = (name || '?').trim().charAt(0).toUpperCase() || '?';
  $('#me-name', rail).textContent = name || t('Аккаунт');
  $('#me-sub', rail).innerHTML = p ? `<span class="n">${num(p.balance4c)}</span><span class="u"> 4Coin</span>` : '';
  const unread = S.settings.newsBadge === false ? 0 : (S.data && S.data.news || []).filter((n) => (n.date || '') > (S.settings.lastSeenNews || '')).length;
  const nb = $('[data-go=news] .bd', rail); nb.hidden = !unread || S.route === 'news'; nb.textContent = String(unread);
  moveInd();
}
function moveInd() {
  const rail = $('#rail'); const ind = $('#rail-ind', rail); if (!ind) return;
  const a = $('[aria-current=page]', rail);
  if (!a) { ind.classList.remove('on'); return; }
  const z = zoomNow(); const rr = rail.getBoundingClientRect(); const ar = a.getBoundingClientRect();
  if (rr.width > rr.height) ind.style.setProperty('--x', ((ar.left - rr.left) / z + (ar.width / z - 26) / 2) + 'px');
  else ind.style.setProperty('--y', ((ar.top - rr.top) / z + (ar.height / z - ind.offsetHeight) / 2) + 'px');
  ind.classList.add('on');
}
delegate($('#rail'), 'click', '[data-go]', (el) => go(el.dataset.go));
delegate($('#rail'), 'click', '[data-act=profile]', () => openProfile());

/** Профиль: имя, роль в проекте («Игрок» / «Администратор n уровня»), баланс; переходы в аккаунт, администрирование, выход. */
async function openProfile() {
  const p = S.auth.profile; if (!p) return;
  const name = p.gameName || p.nickname || p.username || '';
  const buttons = [{ label: t('Выйти'), value: 'logout', cls: 'g' }];
  if (canAdmin(p)) buttons.push({ label: t('Администрирование'), value: 'admin', cls: 'g' });
  buttons.push({ label: t('Открыть аккаунт'), value: 'account' });
  const v = await modal({
    title: t('Профиль'), icon: 'userc',
    body: `<div class="pm"><span class="avatar lg">${esc((name || '?').trim().charAt(0).toUpperCase() || '?')}</span>
      <div class="pm-t"><b>${esc(name || t('Аккаунт'))}</b><small>@${esc(p.username || '')}</small></div></div>
      <div class="pm-role"><span class="bdg" id="pm-role">${esc(roleLabel(p))}</span>${alvlOf(p) > 0 ? `<small>${esc(rankLabel(p))}</small>` : ''}</div>
      <div class="pm-bal"><span>${t('Баланс')}</span><span class="c4"><span class="n">${num(p.balance4c)}</span> <span class="u">4Coin</span></span></div>`,
    buttons,
  });
  if (v === 'logout') call('auth:logout');
  else if (v === 'account' || v === 'admin') go(v);
}

// ---------- загрузка данных ----------
export async function loadData(force) {
  const r = await call('data:bootstrap', !!force);
  if (r.ok) {
    patch({ data: r.data, net: true }, 'data');
    setBanner('offline', r.data.stale ? { kind: 'warn', icon: 'signal', text: t('Показаны сохранённые данные'), sub: t('Нет связи с сервером 4ONE'), actions: [{ label: t('Повторить'), cls: 'g', run: () => loadData(true) }] } : null);
    setBanner('notice', r.data.notice ? { icon: 'info', text: r.data.notice } : null);
  } else if (r.code === 'network_error' || r.code === 'timeout') {
    patch({ net: false }, 'net');
    setBanner('offline', { kind: 'warn', icon: 'signal', text: t('Нет связи с сервером 4ONE'), sub: t('Проверьте интернет — вход и запуск игры временно недоступны'), actions: [{ label: t('Повторить'), cls: 'g', run: () => loadData(true) }] });
  } else {
    toast('err', r.message);
  }
  return r;
}

// ---------- подписки на состояние ----------
subscribe((st, what) => {
  const net = $('#net'); net.dataset.state = st.net ? 'on' : 'off'; $('#net-text').textContent = st.net ? t('Онлайн') : t('Нет связи');
  if (['auth', 'data', 'settings', 'lang', 'route'].includes(what)) syncRail();
  if (what === 'auth' && st.auth.authed && st.route === 'admin' && !canAdmin(st.auth.profile)) go('home', true); // право отозвали, пока вкладка открыта
  if (what === 'settings' || what === 'boot') applyLook(st.settings);
  if (cur && cur.update) cur.update(st, what);
});

/** Внешний вид из настроек: акцент, масштаб, анимации. Вызывается на каждое изменение настроек, DOM экранов не трогает. */
function applyLook(s) {
  const a = s.accent;
  if (!a || a === 'violet') delete document.documentElement.dataset.accent; else document.documentElement.dataset.accent = a;
  document.documentElement.dataset.motion = s.animations === false ? 'off' : 'on';
  applyScale(s.scale); requestAnimationFrame(moveInd);
}
window.addEventListener('resize', () => { applyScale(S.settings.scale); requestAnimationFrame(moveInd); });

on('auth:changed', (a) => {
  const was = S.auth.authed;
  patch({ auth: a }, 'auth');
  if (!a.authed) {
    if (a.reason && a.reason !== 'logout') toast('warn', { invalid_session: t('Сессия недействительна. Войдите заново.'), session_revoked: t('Сессия отозвана. Войдите заново.'), session_expired: t('Сессия истекла. Войдите заново.'), launcher_access_denied: t('Доступ к лаунчеру не выдан.') }[a.reason] || t('Войдите заново.'));
    go('login', true);
  } else if (!was) { loadData(true).then(() => go('home', true)); }
  else if (cur && cur.update) cur.update(S, 'auth');
});
on('game:state', (g) => patch({ game: g }, 'game'));
on('net:state', (n) => { patch({ net: !!n.online }, 'net'); if (n.online) { setBanner('offline', null); loadData(true); } });
on('update:state', (u) => { patch({ update: u }, 'update'); renderUpdateBanner(u); });
on('toast', (m) => { if (m && m.text) toast(m.kind || 'info', t(m.text)); });
// вход возвращается ссылкой прямо в main (см. main/index.js), других ссылок для интерфейса пока нет
on('deeplink', () => {});

// ---------- язык ----------
function applyStatic() {
  $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $$('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
}
function renderVer() { const i = S.info || {}; $('#ver').textContent = 'v' + (i.version || '') + (i.mock ? t(' · демо') : ''); }
/** Сменить язык на лету: статика, панель, текущий экран, баннеры, строка версии */
export function applyLang(l) {
  if (l === getLang() && S.booted) return;
  setLang(l); applyStatic(); renderVer(); renderUpdateBanner(S.update || { state: 'idle' });
  if (S.booted) { patch({}, 'lang'); if (S.auth.authed) loadData(false); go(S.route, true); }
}
window.addEventListener('l4:lang', (e) => applyLang(e.detail));

function renderUpdateBanner(u) {
  if (u.state === 'available') setBanner('update', { icon: 'down2', text: t('Доступно обновление лаунчера {v}', { v: u.version }), actions: [{ label: t('Скачать'), run: () => call('update:download') }] });
  else if (u.state === 'downloading') setBanner('update', { icon: 'down2', text: t('Загрузка обновления… {p}%', { p: u.percent }) });
  else if (u.state === 'ready') setBanner('update', { kind: '', icon: 'check', text: t('Обновление {v} готово', { v: u.version }), actions: [{ label: t('Перезапустить'), run: () => call('update:install') }] });
  else setBanner('update', null);
}

// ---------- подсветка кнопок под курсором (--mx/--my для .bt:before) ----------
document.addEventListener('pointermove', (e) => {
  const b = e.target.closest && e.target.closest('.bt,.ib.lg'); if (!b) return;
  const r = b.getBoundingClientRect(); const z = zoomNow();
  b.style.setProperty('--mx', (e.clientX - r.left) / z + 'px'); b.style.setProperty('--my', (e.clientY - r.top) / z + 'px');
}, { passive: true });

// ---------- окно ----------
$('#wb-min').addEventListener('click', () => call('win:minimize'));
$('#wb-max').addEventListener('click', async () => {
  const r = await call('win:toggleMaximize');
  if (r.ok) setMax(!!r.data);
});
/** Иконка «развернуть» ↔ «восстановить» */
function setMax(on) {
  $('#wb-max use').setAttribute('href', on ? '#i-restore' : '#i-max');
  const l = t(on ? 'Восстановить' : 'Развернуть'); $('#wb-max').setAttribute('aria-label', l); $('#wb-max').title = l;
}
$('#wb-close').addEventListener('click', () => call('win:close'));
$('#titlebar').addEventListener('dblclick', (e) => { if (!e.target.closest('.tb-win')) call('win:toggleMaximize'); });
document.addEventListener('contextmenu', (e) => { if (!e.target.closest('input,textarea')) e.preventDefault(); });
document.addEventListener('keydown', (e) => {
  if (!e.ctrlKey || e.altKey || e.shiftKey || !S.auth.authed) return;
  const k = KEYS[Number(e.key) - 1];
  if (k) { e.preventDefault(); go(k); }
});

// ---------- старт ----------
(async function boot() {
  const [info, auth, st, game] = await Promise.all([call('app:info'), call('auth:status'), call('settings:get'), call('game:state')]);
  patch({
    info: info.data, auth: auth.data, settings: st.data || {}, game: game.data, booted: true,
  }, 'boot');
  setLang(S.settings.lang); applyStatic(); renderVer();
  if (S.auth.authed) { await loadData(false); if (S.auth.offline) patch({ net: false }); go('home'); } else go('login');
})();

window.__l4 = { S, go }; // для отладки и скриншотов
