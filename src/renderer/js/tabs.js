import { $, $$, ic, esc, delegate } from './ui.js';

/**
 * Страница с боковым меню и панелями. Панели строятся один раз и только скрываются,
 * поэтому переключение вкладки и любые обновления внутри не сбрасывают прокрутку и не перерисовывают страницу.
 * defs: [{ k, name, icon }]. Возвращает { show, pane, current }.
 */
export function tabs(root, defs, { initial, onShow, label } = {}) {
  root.innerHTML = `
    <div class="pg in" style="--i:1">
      <nav class="sub" role="tablist" aria-label="${esc(label || '')}">${defs.map((d) => `<button class="sb" role="tab" data-tab="${d.k}" aria-label="${esc(d.name)}" aria-selected="false">${ic(d.icon)}<span>${esc(d.name)}</span></button>`).join('')}</nav>
      <div class="panes">${defs.map((d) => `<section class="pane" role="tabpanel" data-pane="${d.k}" hidden></section>`).join('')}</div>
    </div>`;
  const scroller = root.closest('.screen') || root;
  let cur = '';
  function show(k, keepScroll) {
    if (!defs.some((d) => d.k === k)) k = defs[0].k;
    if (k === cur) return;
    cur = k;
    $$('.sb', root).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === k)));
    $$('.pane', root).forEach((p) => {
      const on = p.dataset.pane === k;
      if (on && p.hidden) { p.hidden = false; p.classList.remove('pin'); void p.offsetWidth; p.classList.add('pin'); } else if (!on) p.hidden = true;
    });
    if (!keepScroll) scroller.scrollTop = 0;
    if (onShow) onShow(k);
  }
  delegate(root, 'click', '[data-tab]', (el) => show(el.dataset.tab));
  show(initial || defs[0].k, true);
  return { show, pane: (k) => $(`.pane[data-pane="${k}"]`, root), current: () => cur };
}
