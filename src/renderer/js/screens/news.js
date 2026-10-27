import { S } from '../state.js';
import { $, esc, ic, dateShort, catOf, CATS, HUE, coverSrc, delegate, empty } from '../ui.js';
import { openExt, setSetting } from '../actions.js';
import { t } from '../i18n.js';

let lastFilter = 'all';

export function mount(root) {
  let filter = lastFilter; let q = '';
  const seen = S.settings.lastSeenNews || ''; // что считалось прочитанным на момент открытия — по нему ставим точку «новое»
  root.innerHTML = `
    <header class="scr-head in" style="--i:0"><div><h1>${t('Новости')}</h1></div></header>
    <div class="nw-tools in" style="--i:1"><div class="chips" id="chips" role="group" aria-label="${t('Категории')}"></div>
      <label class="nw-find">${ic('search')}<input class="inp" id="q" type="search" maxlength="60" autocomplete="off" spellcheck="false" placeholder="${t('Поиск по новостям')}" aria-label="${t('Поиск по новостям')}"></label></div>
    <div class="news-grid" id="list"></div>`;
  const list = $('#list', root); const chips = $('#chips', root);
  const all = () => (S.data && S.data.news) || [];

  function renderChips() {
    const items = all(); const cats = Object.keys(CATS).filter((k) => items.some((n) => n.category === k));
    chips.innerHTML = [['all', t('Все')]].concat(cats.map((k) => [k, CATS[k].name]))
      .map(([k, n]) => `<button class="ch" aria-pressed="${filter === k}" data-f="${k}">${esc(n)}</button>`).join('');
  }
  /** Перерисовывает только карточки; поле поиска и фокус остаются на месте */
  function renderList() {
    if (!S.data) { list.innerHTML = [0, 1, 2].map(() => '<div class="sk" style="height:230px"></div>').join(''); return; }
    const needle = q.trim().toLowerCase();
    const shown = all().filter((n) => (filter === 'all' || n.category === filter) && (!needle || (n.title + ' ' + n.excerpt).toLowerCase().includes(needle)));
    if (!shown.length) { list.innerHTML = `<div style="grid-column:1/-1">${needle ? empty('search', t('Ничего не найдено'), t('Попробуйте другой запрос или категорию')) : empty('news', t('Пока ничего нет'), t('Новости появятся здесь, как только их опубликуют'))}</div>`; return; }
    list.innerHTML = shown.map((n, k) => {
      const c = catOf(n.category); const img = coverSrc(n.cover); const fresh = (n.date || '') > seen;
      return `<button class="ncd in${k === 0 && filter === 'all' && !needle ? ' big' : ''}${fresh ? ' new' : ''}" style="--i:${Math.min(k, 6) + 2};--cc:${HUE[n.category] || HUE.news}" data-id="${esc(n.id)}">
        <span class="ncd-pic">${img ? `<img src="${esc(img)}" alt="" draggable="false" loading="lazy">` : ic(c.icon)}<span class="bdg">${esc(c.name)}</span></span>
        <span class="ncd-b"><span class="nmeta">${esc(dateShort(n.date))}</span><b>${esc(n.title)}</b><span class="nr-x">${esc(n.excerpt)}</span></span></button>`;
    }).join('');
  }
  delegate(root, 'click', '[data-f]', (el) => { filter = lastFilter = el.dataset.f; renderChips(); renderList(); });
  delegate(root, 'click', '.ncd', (el) => { const n = all().find((x) => x.id === el.dataset.id); openExt(n && n.url ? n.url : 'news'); });
  $('#q', root).addEventListener('input', (e) => { q = e.target.value; renderList(); });
  renderChips(); renderList();
  // всё, что видно на этом экране, считается прочитанным
  const newest = all().map((n) => n.date || '').sort().pop();
  if (newest && newest > seen) setTimeout(() => setSetting({ lastSeenNews: newest }), 900);
  return { update(st, what) { if (what === 'data') { renderChips(); renderList(); } } };
}
