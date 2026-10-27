import { t, locale, getLang } from './i18n.js';
import { S } from './state.js';
// Общие помощники интерфейса: шаблоны, иконки, тосты, модальные окна, форматирование.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
export const ic = (name, cls) => `<svg class="i${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
export const html = (el, markup) => { el.innerHTML = markup; return el; };

// ---------- форматирование (русский, табличные цифры) ----------
const nfs = {};
export const num = (n) => (nfs[locale()] || (nfs[locale()] = new Intl.NumberFormat(locale()))).format(Math.round(n || 0));
const dec = (x) => (getLang() === 'en' ? x : x.replace('.', ','));
export function bytes(n) {
  n = Number(n) || 0;
  if (n >= 1024 ** 3) return dec((n / 1024 ** 3).toFixed(2)) + t(' ГБ');
  if (n >= 1024 ** 2) return dec((n / 1024 ** 2).toFixed(n >= 100 * 1024 ** 2 ? 0 : 1)) + t(' МБ');
  if (n >= 1024) return Math.round(n / 1024) + t(' КБ');
  return Math.round(n) + t(' Б');
}
export const speed = (n) => (n > 0 ? bytes(n) + t('/с') : '—');
export function eta(sec) {
  sec = Math.round(sec || 0);
  if (sec <= 0) return '—';
  if (sec < 60) return sec + t(' с');
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m < 60) return m + t(' мин ') + (s ? s + t(' с') : '').trim();
  return Math.floor(m / 60) + t(' ч ') + (m % 60) + t(' мин');
}
const MON = () => [t('янв'), t('фев'), t('мар'), t('апр'), t('мая'), t('июн'), t('июл'), t('авг'), t('сен'), t('окт'), t('ноя'), t('дек')];
export function dateShort(iso) {
  const d = new Date(iso); if (isNaN(d)) return '';
  return d.getDate() + ' ' + MON()[d.getMonth()] + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '');
}
/** «5 мин назад», «вчера», «12 окт» — для списков устройств и входов */
export function ago(iso) {
  const d = new Date(iso); if (isNaN(d)) return '';
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 2) return t('только что');
  if (m < 60) return t('{n} мин назад', { n: m });
  if (m < 60 * 24) return t('{n} ч назад', { n: Math.floor(m / 60) });
  if (m < 60 * 48) return t('вчера');
  return dateShort(iso);
}
export function hours(min) { const h = Math.floor((min || 0) / 60); return h ? h + t(' ч ') + ((min || 0) % 60) + t(' мин') : (min || 0) + t(' мин'); }
/** 4Coin: всегда шампань и всегда с подписью */
export const c4 = (n, short) => `<span class="c4 num">${num(n)}${short ? '' : ' 4Coin'}</span>`;

const CAT_DEF = { news: ['Новости', 'news'], events: ['Ивенты', 'flag'], updates: ['Обновления', 'refresh'], laws: ['Законы', 'scale'], rules: ['Правила', 'doc'], announce: ['Объявления', 'mega'] };
export const CATS = {};
for (const k of Object.keys(CAT_DEF)) CATS[k] = { get name() { return t(CAT_DEF[k][0]); }, icon: CAT_DEF[k][1] };
// ключи для проверки перевода: t('Новости') t('Ивенты') t('Обновления') t('Законы') t('Правила') t('Объявления')
export const HUE = { news: '#b9a3ff', events: '#f0a0b4', updates: '#9fd4b4', laws: '#9cc4f5', rules: '#dcc49c', announce: '#e8b07a' };
export const catOf = (k) => CATS[k] || CATS.news;
export const coverSrc = (c) => (c && /^[a-z0-9_]+$/i.test(c) ? `assets/news/${c}.webp` : (c && /^https:\/\//.test(c) ? c : ''));

// ---------- уведомления ----------
const TICON = { ok: 'check', err: 'alert', warn: 'alert', info: 'info' };
export function toast(kind, text, ms) {
  const root = $('#toasts'); if (!root || !text) return;
  if (S.settings && S.settings.toasts === false && (kind === 'ok' || kind === 'info')) return; // ошибки и предупреждения показываем всегда
  const el = document.createElement('div');
  el.className = 'toast ' + (kind === 'error' ? 'err' : kind);
  el.innerHTML = `<span class="ti">${ic(TICON[kind] || 'info')}</span><span>${esc(text)}</span>`;
  root.appendChild(el);
  while (root.children.length > 3) root.firstChild.remove();
  const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 150); };
  setTimeout(kill, ms || (kind === 'err' || kind === 'error' ? 6000 : 3600));
  el.addEventListener('click', kill);
}

// ---------- модальные окна ----------
let closeCur = null;
/**
 * modal({ title, icon, body, buttons:[{label, value, cls}] }) -> Promise<value|null>
 * body — HTML (экранируйте пользовательские данные сами). Esc/клик по фону — null.
 */
export function modal(o) {
  return new Promise((resolve) => {
    if (closeCur) closeCur(null);
    const root = $('#modal-root');
    const btns = (o.buttons || [{ label: t('Понятно'), value: true }]).map((b, i) =>
      `<button class="bt ${esc(b.cls || '')}" data-v="${i}">${esc(b.label)}</button>`).join('');
    root.innerHTML = `<div class="gp mdl" role="dialog" aria-modal="true" aria-label="${esc(o.title)}"><div class="gh"><div class="ico">${ic(o.icon || 'info')}</div><h2>${esc(o.title)}</h2><span class="sp"></span><button class="ib" data-v="x" aria-label="${t('Закрыть')}">${ic('x')}</button></div><div class="mb">${o.body || ''}</div><div class="mf">${btns}</div></div>`;
    root.classList.remove('out'); root.classList.add('on');
    const prevFocus = document.activeElement;
    const done = (val) => {
      if (!closeCur) return; closeCur = null;
      document.removeEventListener('keydown', onKey);
      root.classList.add('out');
      setTimeout(() => { root.classList.remove('on', 'out'); root.innerHTML = ''; try { prevFocus && prevFocus.focus && prevFocus.focus(); } catch (_) { /* ignore */ } resolve(val); }, 140);
    };
    closeCur = done;
    const onKey = (e) => { if (e.key === 'Escape') done(null); };
    document.addEventListener('keydown', onKey);
    root.onclick = (e) => {
      if (e.target === root) return done(null);
      const b = e.target.closest('[data-v]'); if (!b) return;
      if (b.dataset.v === 'x') return done(null);
      done((o.buttons || [{ value: true }])[Number(b.dataset.v)].value);
    };
    const first = root.querySelector('.mf .bt:last-child') || root.querySelector('[data-v]');
    first && first.focus();
  });
}
export const confirmBox = (title, body, okLabel, danger) => modal({
  title, icon: danger ? 'alert' : 'info', body,
  buttons: [{ label: t('Отмена'), value: false, cls: 'g' }, { label: okLabel || t('Продолжить'), value: true, cls: danger ? 'dng' : '' }],
}).then((v) => v === true);

// ---------- баннеры ----------
export function setBanner(id, o) {
  const slot = $('#banners'); if (!slot) return;
  let el = slot.querySelector(`[data-b="${id}"]`);
  if (!o) { el && el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.dataset.b = id; slot.appendChild(el); }
  el.className = 'banner ' + (o.kind || '');
  el.innerHTML = `${ic(o.icon || 'info')}<div class="grow">${esc(o.text)}${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</div>${(o.actions || []).map((a, i) => `<button class="bt sm ${a.cls || ''}" data-a="${i}">${esc(a.label)}</button>`).join('')}`;
  el.onclick = (e) => { const b = e.target.closest('[data-a]'); if (b && o.actions) o.actions[Number(b.dataset.a)].run(); };
}

/** Делегирование: on(root, 'click', '[data-act]', (el, e) => …) */
export function delegate(root, type, sel, fn) {
  root.addEventListener(type, (e) => { const el = e.target.closest(sel); if (el && root.contains(el)) fn(el, e); });
}

export const empty = (icon, title, sub) => `<div class="empty"><div class="ei">${ic(icon)}</div><div><b>${esc(title)}</b>${sub ? `<br>${esc(sub)}` : ''}</div></div>`;
