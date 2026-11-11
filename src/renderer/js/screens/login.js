import { call } from '../api.js';
import { S } from '../state.js';
import { $, esc, ic, toast } from '../ui.js';
import { t, getLang } from '../i18n.js';

// причины выхода: тексты те же, что у ошибок сессии в core/contract.js (перевод уже есть)
const REASONS = {
  invalid_session: 'Сессия недействительна. Войдите заново.',
  session_revoked: 'Сессия отозвана. Войдите заново.',
  session_expired: 'Сессия истекла. Войдите заново.',
  launcher_access_denied: 'Доступ к лаунчеру не выдан. Обратитесь к администрации.',
};
const LOGIN_MAX = 64; const PASS_MAX = 128;

/**
 * Вход в аккаунт 4ONE RP. Три пути:
 *  1) логин и пароль прямо здесь (как в игре); если включена двухфакторная защита — второй шаг с кодом из приложения;
 *  2) «Войти через сайт» — страница входа в браузере (OAuth), возврат по gta4one://auth/callback;
 *  3) «Играть без входа» — регистрация в игре, вход в лаунчер потом.
 * Пароль уходит в main и оттуда только в Core API по https; в интерфейсе и на диске не остаётся.
 */
export function mount(root) {
  const reason = S.auth && S.auth.reason;
  root.innerHTML = `
  <div class="login">
    <div class="seg lg-lang" role="radiogroup" aria-label="${t('Язык')}">${[['ru', 'Русский'], ['en', 'English']].map(([k, n]) => `<button role="radio" aria-checked="${getLang() === k}" data-lang="${k}" lang="${k}">${n}</button>`).join('')}</div>
    <div class="login-card gp spk">
      <div class="lg-logo in" style="--i:0"><img src="assets/logo/lockup.png" alt="4ONE RP" draggable="false"></div>
      <div class="lg-head in" style="--i:1" id="lg-head"></div>
      ${reason && REASONS[reason] ? `<div class="lg-note in" style="--i:1">${ic('alert')}<span>${esc(t(REASONS[reason]))}</span></div>` : ''}
      <div class="lg-form in" style="--i:2" id="lg-box"></div>
      ${S.info && S.info.mock ? `<p class="lg-demo">${t('Демо: любой логин и пароль от 4 знаков; логин с «2fa» спросит код 123456')}</p>` : ''}
    </div>
  </div>`;

  const box = $('#lg-box', root); const head = $('#lg-head', root);
  let busy = false; let shown = ''; let backup = false; let lastLogin = ''; let userBack = false;

  function stage() { return S.auth && S.auth.mfa ? 'mfa' : S.auth && S.auth.pending ? 'wait' : 'form'; }

  function paint(force) {
    const key = stage() + (backup ? ':b' : '');
    if (key === shown && !force) return; shown = key;
    const st = stage();
    if (st === 'mfa') {
      head.innerHTML = `<h1>${t('Подтвердите вход')}</h1><p>${backup ? t('Введите один из резервных кодов. Каждый работает один раз.') : t('Введите 6-значный код из приложения-аутентификатора.')}</p>`;
      box.innerHTML = `<form class="lg-fields" id="mfa-form" autocomplete="off" novalidate>
          <input class="inp code" id="mfa-code" inputmode="${backup ? 'text' : 'numeric'}" autocomplete="one-time-code" spellcheck="false"
            maxlength="${backup ? 9 : 6}" placeholder="${backup ? 'XXXX-XXXX' : '000000'}" aria-label="${t('Код подтверждения')}">
          <p class="lg-err" id="lg-err" role="alert" hidden></p>
          <button class="bt xl wide" type="submit" id="mfa-go">${ic('shield')}${t('Подтвердить')}</button>
        </form>
        <div class="lg-row"><button class="bt g wide" data-act="backup">${backup ? t('Код из приложения') : t('Резервный код')}</button><button class="bt g wide" data-act="mfa-back">${t('Назад')}</button></div>`;
      const inp = $('#mfa-code', root);
      inp.addEventListener('input', () => {
        const v = backup ? inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8).replace(/^(.{4})(?=.)/, '$1-') : inp.value.replace(/\D/g, '').slice(0, 6);
        if (inp.value !== v) inp.value = v;
        setErr('');
        if (!backup && v.length === 6) submitMfa(); // код из приложения отправляем сразу, как набран
      });
      $('#mfa-form', root).addEventListener('submit', (e) => { e.preventDefault(); submitMfa(); });
      inp.focus();
      return;
    }
    head.innerHTML = `<h1>${t('Вход в аккаунт')}</h1><p>${t('Логин и пароль — те же, что в игре.')}</p>`;
    if (st === 'wait') {
      box.innerHTML = `<div class="lg-wait" role="status"><div class="pb thick"><i class="ind"></i></div><b>${t('Ждём вход в браузере…')}</b><small>${t('Завершите вход на сайте — лаунчер продолжит сам.')}</small></div>
         <div class="lg-row"><button class="bt g wide" data-act="again">${t('Открыть снова')}</button><button class="bt g wide" data-act="cancel">${t('Отмена')}</button></div>`;
      return;
    }
    box.innerHTML = `<form class="lg-fields" id="pw-form" autocomplete="on" novalidate>
        <label class="fld"><span>${t('Логин')}</span><input class="inp" id="lg-login" name="username" autocomplete="username" spellcheck="false" maxlength="${LOGIN_MAX}" value="${esc(lastLogin)}"></label>
        <label class="fld"><span>${t('Пароль')}</span><span class="pw"><input class="inp" id="lg-pass" name="password" type="password" autocomplete="current-password" maxlength="${PASS_MAX}">
          <button class="ib" type="button" data-act="peek" aria-label="${t('Показать пароль')}" title="${t('Показать пароль')}">${ic('eye')}</button></span></label>
        <p class="lg-err" id="lg-err" role="alert" hidden></p>
        <button class="bt xl wide" type="submit" id="pw-go">${t('Войти')}</button>
      </form>
      <div class="lg-or"><span>${t('или')}</span></div>
      <div class="lg-row"><button class="bt g wide" data-act="site">${ic('globe')}${t('Через сайт')}</button><button class="bt g wide" data-act="guest">${ic('gamepad')}${t('Играть без входа')}</button></div>
      <p class="lg-foot">${t('Нет аккаунта? Регистрация — в самой игре: нажмите «Играть без входа», затем войдите с тем же логином и паролем.')}</p>`;
    $('#pw-form', root).addEventListener('submit', (e) => { e.preventDefault(); submitPassword(); });
    const l = $('#lg-login', root); (l.value ? $('#lg-pass', root) : l).focus();
  }

  function setErr(text) { const e = $('#lg-err', root); if (!e) return; e.hidden = !text; e.textContent = text || ''; }
  function setBusy(btn, on, label) { if (!btn) return; btn.disabled = on; btn.classList.toggle('busy', on); if (label) btn.lastChild.textContent = label; }

  async function submitPassword() {
    if (busy) return;
    const login = $('#lg-login', root).value.trim(); const pass = $('#lg-pass', root).value;
    if (!login || !pass) { setErr(t('Введите логин и пароль.')); return; }
    lastLogin = login; busy = true;
    const btn = $('#pw-go', root); setBusy(btn, true, t('Входим…'));
    const r = await call('auth:password', login, pass);
    busy = false;
    if (!r.ok) { setBusy(btn, false, t('Войти')); setErr(r.message); const p = $('#lg-pass', root); if (p) { p.value = ''; p.focus(); } return; }
    // дальше интерфейс ведёт auth:changed: либо вход выполнен, либо шаг с кодом (mfa)
  }

  async function submitMfa() {
    if (busy) return;
    const inp = $('#mfa-code', root); const code = inp.value;
    if (backup ? code.replace('-', '').length !== 8 : code.length !== 6) { setErr(t('Введите код полностью.')); return; }
    busy = true; const btn = $('#mfa-go', root); setBusy(btn, true, t('Проверяем…'));
    const r = await call('auth:mfa', code);
    busy = false;
    if (!r.ok) {
      if (stage() !== 'mfa') return; // код устарел — main вернул к форме, тост ниже
      setBusy(btn, false, t('Подтвердить')); setErr(r.message); inp.value = ''; inp.focus();
    }
  }

  root.addEventListener('click', async (e) => {
    const lg = e.target.closest('[data-lang]');
    if (lg) { call('settings:set', { lang: lg.dataset.lang }).then(() => window.dispatchEvent(new CustomEvent('l4:lang', { detail: lg.dataset.lang }))); return; }
    const a = e.target.closest('[data-act]'); if (!a) return;
    const act = a.dataset.act;
    if (act === 'peek') { const p = $('#lg-pass', root); const show = p.type === 'password'; p.type = show ? 'text' : 'password'; a.setAttribute('aria-pressed', String(show)); p.focus(); }
    else if (act === 'site') { const r = await call('auth:login'); if (!r.ok) toast('err', r.message); }
    else if (act === 'guest') { const r = await call('auth:guest', true); if (!r.ok) toast('err', r.message); }
    else if (act === 'cancel') await call('auth:cancel');
    else if (act === 'again') { const r = await call('auth:login'); if (!r.ok) toast('err', r.message); }
    else if (act === 'backup') { backup = !backup; paint(true); }
    else if (act === 'mfa-back') { backup = false; userBack = true; await call('auth:mfaCancel'); }
  });

  paint();
  return {
    update(_st, what) {
      if (what !== 'auth') return;
      if (stage() !== 'mfa') backup = false;
      if (S.auth && !S.auth.mfa && !S.auth.authed && shown.startsWith('mfa') && !S.auth.pending && !userBack) toast('warn', t('Время на ввод кода вышло. Войдите заново.'));
      userBack = false;
      paint();
    },
  };
}
