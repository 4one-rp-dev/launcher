import { call } from '../api.js';
import { $, esc, ic, num, dateShort, empty, toast } from '../ui.js';
import { t } from '../i18n.js';
import { cleanCode, PROMO_LEN } from '../codefmt.js';

const rewardText = (r) => !r ? '' : r.kind === 'coins' ? `+${num(r.amount)} 4Coin` : r.kind === 'vehicle' ? `${t('Автомобиль')} ${r.name || ''}`.trim() : r.kind === 'item' ? `${t('Предмет')} ${r.name || ''}`.trim() : (r.name || t('Награда'));
const rewardIcon = (r) => !r ? 'gift' : r.kind === 'coins' ? 'coin' : r.kind === 'vehicle' ? 'car' : 'box';

export function mount(root) {
  root.innerHTML = `
    <header class="scr-head in" style="--i:0"><div><h1>${t('Коды')}</h1></div></header>
    <div class="scr-body codes">
      <section class="gp in" style="--i:1"><div class="gh"><div class="ico">${ic('gift')}</div><h2>${t('Активировать код')}</h2></div>
        <div class="pad cd-form">
          <input class="inp code" id="code" autocomplete="off" spellcheck="false" maxlength="16" autocapitalize="characters" lang="en" placeholder="${t('Введите промокод')}" aria-label="${t('Промокод')}">
          <button class="bt" id="go">${t('Активировать')}</button>
        </div>
        <div class="field-msg pad-x" id="msg" role="alert"></div>
        <p class="hint pad">${t('Один код — одна активация. Награда придёт сразу.')}</p>
      </section>
      <section class="gp in" style="--i:2"><div class="gh"><div class="ico">${ic('hist')}</div><h2>${t('История')}</h2></div><div class="hist" id="hist"></div></section>
    </div>`;
  const inp = $('#code', root); const msg = $('#msg', root); const go = $('#go', root); const hist = $('#hist', root);
  let items = null;

  function renderHist() {
    if (!items) { hist.innerHTML = '<div class="sk" style="height:56px;margin:12px"></div>'; return; }
    hist.innerHTML = items.length ? items.map((h) => `<div class="hrow"><span class="hi">${ic(rewardIcon(h.reward))}</span>
      <span class="ht"><b>${esc(h.title || h.code)}</b><small>${esc(h.code)} · ${esc(dateShort(h.at))}</small></span>
      <span class="hr ${h.reward && h.reward.kind === 'coins' ? 'c4' : ''}">${esc(rewardText(h.reward))}</span></div>`).join('')
      : empty('gift', t('Кодов пока нет'), t('Промокоды публикуются на сайте и в Discord'));
  }
  async function load() { const r = await call('codes:history'); items = r.ok ? r.data : []; renderHist(); }

  async function redeem() {
    const v = inp.value.trim(); msg.textContent = ''; msg.className = 'field-msg pad-x'; inp.classList.remove('err');
    if (!v) { msg.textContent = t('Введите код'); msg.classList.add('err'); inp.classList.add('err'); inp.focus(); return; }
    go.disabled = true; go.classList.add('busy');
    const r = await call('codes:redeem', v);
    go.disabled = false; go.classList.remove('busy');
    if (r.ok) {
      inp.value = ''; toast('ok', t('Код активирован: {r}', { r: rewardText(r.data.reward) }));
      if (items) { items.unshift(r.data); renderHist(); } else load();
    } else { msg.textContent = r.message; msg.classList.add('err'); inp.classList.add('err'); inp.select(); }
  }
  const hint = () => { msg.textContent = t('Код вводится латиницей и цифрами'); msg.className = 'field-msg pad-x'; };
  const fill = (text, typed, caretSig) => {
    const c = cleanCode(text, { max: PROMO_LEN, dash: true, keys: typed });
    inp.value = c.text; inp.classList.remove('err'); msg.textContent = ''; msg.className = 'field-msg pad-x';
    if (c.dropped) hint(); else if (c.over) { msg.textContent = t('Максимум {n} знаков', { n: PROMO_LEN }); msg.className = 'field-msg pad-x'; }
    const p = caretSig == null ? c.text.length : Math.min(caretSig, c.text.length);
    try { inp.setSelectionRange(p, p); } catch (_) { /* ignore */ }
  };
  inp.addEventListener('input', (e) => {
    const typed = e.inputType === 'insertText'; const p = inp.selectionStart == null ? inp.value.length : inp.selectionStart;
    fill(inp.value, typed, cleanCode(inp.value.slice(0, p), { max: 99, dash: true, keys: typed }).text.length);
  });
  inp.addEventListener('paste', (e) => {
    e.preventDefault();
    const txt = (e.clipboardData && e.clipboardData.getData('text')) || '';
    const a = inp.selectionStart || 0, b = inp.selectionEnd || 0;
    const before = inp.value.slice(0, a), after = inp.value.slice(b);
    const mid = cleanCode(txt, { max: 99, dash: true }); const merged = before + mid.text + after;
    fill(merged, false, (before + mid.text).length);
    if (mid.dropped) hint(); else if (merged.length > PROMO_LEN) { msg.textContent = t('Максимум {n} знаков', { n: PROMO_LEN }); msg.className = 'field-msg pad-x'; }
  });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') redeem(); });
  go.addEventListener('click', redeem);
  load();
  return { update() {} };
}
