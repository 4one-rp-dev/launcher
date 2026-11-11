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
  let mode = 'login'; // login | register
  const reg = { login: '', email: '', promo: '' }; // введённое при регистрации (пароль не храним)

  function stage() { return S.auth && S.auth.mfa ? 'mfa' : S.auth && S.auth.pending ? 'wait' : 'form'; }

  function paint(force) {
    const key = stage() + (backup ? ':b' : '') + ':' + mode;
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
    if (st === 'form' && mode === 'register') return paintRegister();
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
      <p class="lg-foot">${t('Нет аккаунта?')} <button class="link" type="button" data-act="to-reg">${t('Зарегистрироваться')}</button></p>`;
    $('#pw-form', root).addEventListener('submit', (e) => { e.preventDefault(); submitPassword(); });
    const l = $('#lg-login', root); (l.value ? $('#lg-pass', root) : l).focus();
  }

  /** Регистрация игрового аккаунта: те же правила, что в игре; после неё вход выполнен сразу. */
  function paintRegister() {
    head.innerHTML = `<h1>${t('Регистрация')}</h1><p>${t('Один аккаунт для лаунчера и игры.')}</p>`;
    box.innerHTML = `<form class="lg-fields reg" id="reg-form" autocomplete="off" novalidate>
        <label class="fld"><span>${t('Логин')}</span><input class="inp" id="rg-login" name="username" autocomplete="username" spellcheck="false" maxlength="24" value="${esc(reg.login)}" aria-describedby="rg-login-h">
          <small class="fld-h" id="rg-login-h">${t('Латиница, цифры и «_», 3–24 символа, первая — буква')}</small></label>
        <label class="fld"><span>${t('Почта')}</span><input class="inp" id="rg-email" type="email" autocomplete="email" spellcheck="false" maxlength="64" value="${esc(reg.email)}"></label>
        <div class="fld-2">
        <label class="fld"><span>${t('Пароль')}</span><span class="pw"><input class="inp" id="rg-pass" type="password" autocomplete="new-password" maxlength="64" aria-describedby="rg-pass-h">
          <button class="ib" type="button" data-act="peek-reg" aria-label="${t('Показать пароль')}" title="${t('Показать пароль')}">${ic('eye')}</button></span>
          </label>
        <label class="fld"><span>${t('Пароль ещё раз')}</span><input class="inp" id="rg-pass2" type="password" autocomplete="new-password" maxlength="64"></label>
        </div>
        <small class="fld-h" id="rg-pass-h">${t('8–64 символа, латиница, цифры и знаки; нужны буквы и цифры')}</small>
        <label class="fld"><span>${t('Промокод')} <em>${t('необязательно')}</em></span><input class="inp" id="rg-promo" spellcheck="false" maxlength="16" value="${esc(reg.promo)}"></label>
        <p class="lg-err" id="lg-err" role="alert" hidden></p>
        <button class="bt xl wide" type="submit" id="rg-go">${t('Создать аккаунт')}</button>
      </form>
      <p class="lg-foot">${t('Уже есть аккаунт?')} <button class="link" type="button" data-act="to-login">${t('Войти')}</button></p>`;
    $('#reg-form', root).addEventListener('submit', (e) => { e.preventDefault(); submitRegister(); });
    $('#rg-promo', root).addEventListener('input', (e) => { const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16); if (e.target.value !== v) e.target.value = v; });
    $('#rg-login', root).focus();
  }

  async function submitRegister() {
    if (busy) return;
    const v = (id) => $(id, root).value;
    reg.login = v('#rg-login').trim(); reg.email = v('#rg-email').trim(); reg.promo = v('#rg-promo').trim();
    const pass = v('#rg-pass'); const pass2 = v('#rg-pass2');
    // проверки как в игре — чтобы ошибка была сразу у поля, а не после запроса
    if (!/^[A-Za-z][A-Za-z0-9_]{2,23}$/.test(reg.login)) return setErr(t('Логин: латиница, цифры и «_», от 3 до 24 символов, первая — буква.'));
    if (reg.email.length > 64 || !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(reg.email)) return setErr(t('Почта в формате name@mail.ru.'));
    if (pass.length < 8 || /[^!-~]/.test(pass) || !/[A-Za-z]/.test(pass) || !/[0-9]/.test(pass)) return setErr(t('Пароль: от 8 до 64 символов, латиница, цифры и знаки без пробелов; нужны и буквы, и цифры.'));
    if (pass !== pass2) return setErr(t('Пароли не совпадают.'));
    busy = true; const btn = $('#rg-go', root); setBusy(btn, true, t('Создаём…'));
    const r = await call('auth:register', { login: reg.login, email: reg.email, password: pass, promo: reg.promo });
    busy = false;
    if (!r.ok) { setBusy(btn, false, t('Создать аккаунт')); setErr(r.message); return; }
    toast('ok', t('Аккаунт создан. В игре войдите с этим логином и паролем.'));
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
    else if (act === 'to-reg') { mode = 'register'; paint(true); }
    else if (act === 'to-login') { mode = 'login'; paint(true); }
    else if (act === 'peek-reg') { const p1 = $('#rg-pass', root); const p2 = $('#rg-pass2', root); const show = p1.type === 'password'; p1.type = p2.type = show ? 'text' : 'password'; a.setAttribute('aria-pressed', String(show)); }
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
