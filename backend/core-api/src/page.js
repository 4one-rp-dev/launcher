'use strict';
/** Страница входа (HTML без скриптов). Показывается в системном браузере при входе из лаунчера. */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MESSAGES = {
  invalid_credentials: 'Неверный логин или пароль.',
  rate_limited: 'Слишком много попыток. Подождите несколько минут и повторите.',
  tx_expired: 'Страница входа устарела. Вернитесь в лаунчер и нажмите «Войти» ещё раз.',
};

const CSS = `
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e0c12;color:#ece8f4;font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{width:min(400px,calc(100vw - 32px));padding:28px;border:1px solid #2a2533;border-radius:16px;background:#16131c}
h1{margin:0 0 4px;font-size:22px;font-weight:700}
p{margin:0 0 20px;color:#a39bb3}
label{display:block;margin:14px 0 6px;font-size:13px;color:#a39bb3}
input{width:100%;height:44px;padding:0 12px;border:1px solid #2f2a3a;border-radius:10px;background:#0f0d14;color:inherit;font:inherit}
input:focus{outline:2px solid #8b6cf0;outline-offset:1px}
button{width:100%;height:46px;margin-top:20px;border:0;border-radius:10px;background:#8b6cf0;color:#fff;font:inherit;font-weight:700;cursor:pointer}
button:hover{background:#7c5be6}
.err{margin:0 0 14px;padding:10px 12px;border-radius:10px;background:#3a1620;color:#ffb4c0;font-size:14px}
small{display:block;margin-top:16px;color:#7d7590;font-size:12px}
`;

function loginPage({ clientName, tx, error, login }) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Вход в 4ONE RP</title><style>${CSS}</style></head><body><main>
<h1>Вход в 4ONE RP</h1>
<p>Войдите, чтобы продолжить в «${esc(clientName)}». Логин и пароль — те же, что в игре.</p>
${error ? `<div class="err" role="alert">${esc(MESSAGES[error] || 'Не удалось войти. Повторите позже.')}</div>` : ''}
<form method="post" action="/oauth/authorize" autocomplete="on">
<input type="hidden" name="tx" value="${esc(tx)}">
<label for="l">Логин или почта</label><input id="l" name="login" value="${esc(login || '')}" maxlength="100" autocomplete="username" required autofocus>
<label for="p">Пароль</label><input id="p" name="password" type="password" maxlength="200" autocomplete="current-password" required>
<button type="submit">Войти</button>
</form>
<small>Пароль вводится только на этой странице и в лаунчер не передаётся.</small>
</main></body></html>`;
}

function errorPage(message) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Вход в 4ONE RP</title><style>${CSS}</style></head><body><main><h1>Не удалось открыть вход</h1><p>${esc(message)}</p></main></body></html>`;
}

/** После успешного входа редирект на gta4one:// браузер может не показать: даём ссылку и пояснение. */
function doneHtml(redirect) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Вход выполнен</title><meta http-equiv="refresh" content="0;url=${esc(redirect)}"><style>${CSS}</style></head><body><main><h1>Вход выполнен</h1>
<p>Вернитесь в лаунчер. Если он не открылся сам, нажмите кнопку.</p>
<a href="${esc(redirect)}"><button type="button">Открыть лаунчер</button></a></main></body></html>`;
}

module.exports = { loginPage, errorPage, doneHtml, esc };
