import { call } from '../api.js';
import { S } from '../state.js';
import { $, esc, ic, toast } from '../ui.js';
import { openExt } from '../actions.js';
import { t, getLang } from '../i18n.js';

// причины выхода: тексты те же, что у ошибок сессии в core/contract.js (перевод уже есть)
const REASONS = {
  invalid_session: 'Сессия недействительна. Войдите заново.',
  session_revoked: 'Сессия отозвана. Войдите заново.',
  session_expired: 'Сессия истекла. Войдите заново.',
  launcher_access_denied: 'Доступ к лаунчеру не выдан. Обратитесь к администрации.',
};

/**
 * Вход через сайт (OAuth): лаунчер открывает страницу входа в браузере, пароль вводится только там.
 * Возврат приходит ссылкой gta4one://auth/callback — её принимает main, интерфейс видит лишь auth:changed.
 */
export function mount(root) {
  const reason = S.auth && S.auth.reason;
  root.innerHTML = `
  <div class="login">
    <div class="seg lg-lang" role="radiogroup" aria-label="${t('Язык')}">${[['ru', 'Русский'], ['en', 'English']].map(([k, n]) => `<button role="radio" aria-checked="${getLang() === k}" data-lang="${k}" lang="${k}">${n}</button>`).join('')}</div>
    <div class="login-card gp spk">
      <div class="lg-logo in" style="--i:0"><img src="assets/logo/lockup.png" alt="4ONE RP" draggable="false"></div>
      <div class="lg-head in" style="--i:1">
        <h1>${t('Вход через сайт')}</h1>
        <p>${t('Откроется страница входа 4ONE RP в браузере. Логин и пароль — те же, что в игре.')}</p>
      </div>
      ${reason && REASONS[reason] ? `<div class="lg-note in" style="--i:1">${ic('alert')}<span>${esc(t(REASONS[reason]))}</span></div>` : ''}
      <div class="lg-form in" style="--i:2" id="lg-box"></div>
      <p class="lg-foot in" style="--i:3">${t('Нет аккаунта? ')}<button class="link" data-act="reg">${t('Зарегистрироваться на сайте')}</button></p>
      ${S.info && S.info.mock ? `<p class="lg-demo">${t('Демо-режим: вход произойдёт сам')}</p>` : ''}
    </div>
  </div>`;

  const box = $('#lg-box', root);
  let busy = false; let shown = '';

  function paint() {
    const waiting = !!(S.auth && S.auth.pending);
    const key = waiting ? 'wait' : 'idle';
    if (key === shown) return; shown = key;
    box.innerHTML = waiting
      ? `<div class="lg-wait" role="status"><div class="pb thick"><i class="ind"></i></div><b>${t('Ждём вход в браузере…')}</b><small>${t('Завершите вход на сайте — лаунчер продолжит сам.')}</small></div>
         <div class="lg-row"><button class="bt g wide" data-act="again">${t('Открыть снова')}</button><button class="bt g wide" data-act="cancel">${t('Отмена')}</button></div>`
      : `<button class="bt xl wide" id="go">${ic('globe')}${t('Войти через сайт')}</button>`;
    if (!waiting) { const b = $('#go', root); if (b) b.focus(); }
  }

  async function start() {
    if (busy) return; busy = true;
    const b = $('#go', root); if (b) { b.classList.add('busy'); b.textContent = t('Открываем…'); }
    const r = await call('auth:login');
    busy = false;
    if (!r.ok) { shown = ''; paint(); toast('err', r.message); }
    // дальше интерфейс ждёт auth:changed: сначала pending, потом authed
  }

  root.addEventListener('click', async (e) => {
    const lg = e.target.closest('[data-lang]');
    if (lg) { call('settings:set', { lang: lg.dataset.lang }).then(() => window.dispatchEvent(new CustomEvent('l4:lang', { detail: lg.dataset.lang }))); return; }
    if (e.target.closest('#go')) return start();
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'reg') openExt('site');
    if (a.dataset.act === 'cancel') await call('auth:cancel');
    if (a.dataset.act === 'again') { const r = await call('auth:login'); if (!r.ok) toast('err', r.message); }
  });

  paint();
  return { update(_st, what) { if (what === 'auth') paint(); } };
}
