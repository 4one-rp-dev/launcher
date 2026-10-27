import { call } from '../api.js';
import { S, patch, selectedServer } from '../state.js';
import { $, $$, esc, ic, num, dateShort, catOf, HUE, coverSrc, delegate, modal, toast } from '../ui.js';
import { check, openExt } from '../actions.js';
import { phaseView, statusHtml } from '../gamephase.js';
import { t } from '../i18n.js';
import { zoomNow } from '../scale.js';

// Цвет сервера — его «личность»: подсвечивает карточку, главный экран и свечение. Стабильно по id.
const HUES = ['#b9a3ff', '#9fd4b4', '#f0a0b4', '#9cc4f5', '#dcc49c'];
export const hueOf = (id) => HUES[[...String(id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length];

const LINKS = () => [['discord', 'discord', 'Discord'], ['site', 'globe', t('Сайт')], ['donate', 'coin', t('Донат')], ['kb', 'doc', t('Правила')]];
const NOTICE = () => ({
  'no-gta': ['folder', t('Ещё нет GTA V?'), t('Нужна GTA V Legacy из Rockstar Games Launcher, Steam или Epic Games. Уже установлена — укажите её папку.')],
  unsupported: ['alert', t('Нужна GTA V Legacy'), t('Найдена другая версия игры. Проект работает на GTA V Legacy 1.0.3889.0 — укажите её папку.')],
  'not-installed': ['down2', t('Установите клиент 4ONE'), t('Один раз скачаем нужные файлы, потом будут докачиваться только изменения.')],
  'needs-update': ['refresh', t('Доступно обновление клиента'), t('Обновите файлы перед запуском — это быстрее, чем кажется.')],
});
const ST = { online: ['ok', 'Онлайн'], maintenance: ['warn', 'Технические работы'], offline: ['no', 'Недоступен'] };

export function mount(root, ctx) {
  root.innerHTML = `
  <div class="home">
    <section class="hm-main">
      <article class="hero in" style="--i:0" id="hero"></article>
      <section class="srv-sec in" style="--i:1">
        <header class="sec-h"><h2>${t('Серверы')}</h2><span class="cnt num" id="srv-cnt"></span><span class="sp"></span>
          <span class="tx3 sec-on" id="srv-on"></span>
          <button class="ib" data-act="reload" aria-label="${t('Обновить')}" title="${t('Обновить')}">${ic('refresh')}</button></header>
        <div class="srv-grid" id="srv-grid" role="radiogroup" aria-label="${t('Серверы')}"></div>
      </section>
    </section>
    <aside class="hm-side in" style="--i:2" id="side"></aside>
  </div>`;
  const hero = $('#hero', root); const grid = $('#srv-grid', root); const side = $('#side', root);
  let heroId = null; let glow = null;

  // ---------- главный блок выбранного сервера ----------
  function heroGlow(srv) {
    const el = document.createElement('div'); el.className = 'hero-glow'; el.style.setProperty('--sc', hueOf(srv ? srv.id : 'x'));
    el.innerHTML = '<i class="hg"></i>';
    const old = glow; glow = el; hero.prepend(el);
    if (old) { requestAnimationFrame(() => old.classList.add('out')); setTimeout(() => old.remove(), 600); }
  }
  function renderHero() {
    const srv = selectedServer(); const changed = (srv ? srv.id : null) !== heroId; heroId = srv ? srv.id : null;
    if (changed || !glow) heroGlow(srv);
    let box = $('.hero-in', hero);
    if (!box) { box = document.createElement('div'); box.className = 'hero-in'; hero.appendChild(box); }
    box.classList.remove('swap'); void box.offsetWidth; if (changed) box.classList.add('swap');
    if (!S.data) { box.innerHTML = `<div class="sk" style="width:40%;height:64px"></div><div class="sk" style="width:70%;height:20px"></div>`; return; }
    if (!srv) {
      box.innerHTML = `<div class="hero-mid"><h1 class="hero-name">4ONE RP</h1><p class="hero-desc">${t('Список появится, когда проект откроет сервер')}</p></div>`; return;
    }
    const [tone, label] = ST[srv.status] || ST.offline;
    const pct = srv.max ? Math.min(1, srv.online / srv.max) : 0;
    box.innerHTML = `
      <div class="hero-top">
        <span class="bdg ${tone}"><i class="dot ${tone === 'ok' ? 'on' : tone === 'no' ? 'off' : 'warn'}"></i>${esc(t(label))}</span>
        ${srv.tag ? `<span class="bdg mute">${esc(srv.tag)}</span>` : ''}
        ${srv.recommended ? `<span class="bdg">${ic('sparkle')}${t('Рекомендуем')}</span>` : ''}
        <span class="sp"></span>
        ${srv.address ? `<button class="chip-copy" data-act="copy" data-v="${esc(srv.address)}" title="${t('Скопировать адрес сервера')}">${esc(srv.address)}${ic('copy')}</button>` : ''}
      </div>
      <div class="hero-mid">
        <h1 class="hero-name">${esc(srv.name)}</h1>
        ${srv.description ? `<p class="hero-desc">${esc(srv.description)}</p>` : ''}
      </div>
      <div class="hero-stats">
        <div class="hs hs-on"><b class="num">${num(srv.online)}<small> / ${num(srv.max)}</small></b><span>${t('Сейчас играют')}</span><div class="pb"><i style="--p:${pct}"></i></div></div>
        ${srv.ping ? `<div class="hs"><b class="num">${srv.ping}<small> ${t('мс')}</small></b><span>${t('Пинг')}</span></div>` : ''}
      </div>
      <div class="hero-foot" id="hero-foot"></div>`;
    renderFoot();
  }

  // низ главного блока: подсказка по фазе, кнопка, прогресс. Обновляется на каждое событие игры — без пересборки верха.
  function renderFoot() {
    const foot = $('#hero-foot', hero); if (!foot) return;
    const srv = selectedServer(); const g = S.game; const v = phaseView(g, srv, S.net);
    const note = NOTICE()[g && g.phase];
    const key = (note ? 'n' : '') + (v.pct != null ? 'p' : '') + (v.cancel ? 'c' : '');
    if (foot.dataset.k !== key) {
      foot.dataset.k = key;
      foot.innerHTML = `
        ${note ? `<div class="notice"><span class="pi">${ic(note[0])}</span><div class="pt"><b>${esc(note[1])}</b><span>${esc(note[2])}</span></div></div>` : ''}
        <div class="hero-act">
          <button class="bt xl play" data-act="play"></button>
          ${v.cancel ? `<button class="bt g xl" data-act="cancel">${t('Отмена')}</button>` : `<button class="ib lg" data-act="verify" aria-label="${t('Проверить файлы')}" title="${t('Проверить файлы')}">${ic('shield')}</button><button class="ib lg" data-act="folder" aria-label="${t('Открыть папку игры')}" title="${t('Открыть папку игры')}">${ic('folder')}</button>`}
          <div class="hero-st"><div class="hs-text" id="hs-text"></div>${v.pct != null ? `<div class="pb thick" id="hs-pb" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div>` : ''}</div>
        </div>`;
    }
    const btn = $('.play', foot); btn.disabled = !!v.disabled; btn.classList.toggle('busy', !!v.busy); btn.classList.toggle('idle', !v.disabled && v.action === 'play');
    btn.innerHTML = (v.busy ? '' : ic(v.action === 'browse' ? 'folder' : v.action === 'install' ? 'down2' : 'play')) + esc(v.label);
    $('#hs-text', foot).innerHTML = statusHtml(v);
    const pb = $('#hs-pb', foot); if (pb) { pb.setAttribute('aria-valuenow', String(Math.round(v.pct * 100))); $('i', pb).style.setProperty('--p', v.pct); }
    const ver = $('[data-act=verify]', foot); if (ver) ver.disabled = !(g && ['ready', 'needs-update', 'error'].includes(g.phase));
  }

  // ---------- карточки серверов ----------
  function renderGrid() {
    const d = S.data; const list = (d && d.servers) || [];
    $('#srv-cnt', root).textContent = d ? String(list.length) : '';
    const total = list.reduce((a, s) => a + (s.status === 'online' ? s.online : 0), 0);
    $('#srv-on', root).textContent = d && total ? `${t('Сейчас играют')} ${num(total)}` : '';
    if (!d) { grid.innerHTML = [0, 1, 2].map(() => '<div class="sk" style="height:104px"></div>').join(''); return; }
    if (!list.length) { grid.innerHTML = `<div class="empty wide">${ic('server')}<b>${t('Серверов пока нет')}</b><span>${t('Список появится, когда проект откроет сервер')}</span></div>`; return; }
    grid.innerHTML = list.map((s, k) => {
      const [tone, label] = ST[s.status] || ST.offline; const pct = s.max ? Math.min(1, s.online / s.max) : 0;
      return `<button class="sc in" style="--i:${Math.min(k, 6) + 2};--sc:${hueOf(s.id)}" role="radio" aria-checked="${s.id === d.selectedServerId}" data-act="pick" data-id="${esc(s.id)}">
        <span class="sc-top"><i class="dot ${tone === 'ok' ? 'on' : tone === 'no' ? 'off' : 'warn'}"></i><b>${esc(s.name)}</b>${s.tag ? `<span class="bdg mute">${esc(s.tag)}</span>` : ''}</span>
        <span class="sc-mid">${s.status === 'online' ? `<b class="num">${num(s.online)}</b><small> / ${num(s.max)}</small>` : `<small class="tone-${tone === 'warn' ? 'warn' : 'err'}">${esc(t(label))}</small>`}</span>
        <span class="pb"><i style="--p:${s.status === 'online' ? pct : 0}"></i></span>
        ${s.recommended ? `<span class="sc-flag">${ic('sparkle')}</span>` : ''}
      </button>`;
    }).join('');
  }
  function markSelected() {
    const id = S.data && S.data.selectedServerId;
    $$('.sc', grid).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === id)));
  }

  // ---------- новости и ссылки ----------
  const news = () => (S.data && S.data.news) || [];
  function renderSide() {
    const list = news(); const f = list.find((n) => coverSrc(n.cover)) || list[0]; const rest = list.filter((n) => n !== f).slice(0, 4);
    const tile = (n, cls) => { const c = catOf(n.category); const img = coverSrc(n.cover); return `<button class="tl${cls || ''}" style="--cc:${HUE[n.category] || HUE.news}" data-act="read" data-id="${esc(n.id)}">
      <span class="tl-pic">${img ? `<img src="${esc(img)}" alt="" draggable="false" loading="lazy">` : ic(c.icon)}</span>
      <span class="tl-tag">${esc(c.name)}</span>
      <span class="tl-t"><small>${esc(dateShort(n.date))}</small><b>${esc(n.title)}</b></span></button>`; };
    side.innerHTML = `
      <header class="sec-h"><h2>${t('Новости')}</h2><span class="sp"></span><button class="link" data-act="allnews">${t('Все новости')}</button></header>
      ${!S.data ? '<div class="sk" style="height:170px"></div>' : !list.length ? `<div class="empty">${ic('news')}<b>${t('Новости проекта появятся здесь.')}</b></div>` : `
      <div class="tiles">${tile(f, ' big')}${rest.map((n) => tile(n)).join('')}</div>`}
      <div class="quick">${LINKS().map(([k, i, n]) => `<button class="qk" data-act="link" data-k="${k}" title="${esc(n)}">${ic(i)}<span>${esc(n)}</span></button>`).join('')}</div>`;
  }

  // ---------- действия ----------
  async function pick(id) {
    if (S.data && S.data.selectedServerId === id) return;
    const prev = S.data.selectedServerId;
    patch({ data: Object.assign({}, S.data, { selectedServerId: id }) }, 'srv');  // сразу, без ожидания main
    const r = await call('servers:select', id);
    if (!r.ok) { patch({ data: Object.assign({}, S.data, { selectedServerId: prev }) }, 'srv'); check(r); }
  }
  async function onPlay() {
    const v = phaseView(S.game, selectedServer(), S.net);
    if (v.disabled) return;
    if (v.action === 'browse') {
      const r = await call('game:browse'); if (!check(r)) return;
      if (S.game && S.game.phase === 'no-gta') modal({ title: t('GTA V не найдена'), icon: 'folder', body: t('В выбранной папке нет <b>GTA5.exe</b>. Укажите папку, где установлена GTA V Legacy (Rockstar, Steam или Epic Games).') });
    } else if (v.action === 'install') check(await call('game:install'));
    else if (v.action === 'play') check(await call('game:play'));
    else if (v.action === 'retry') check(await call('game:detect'));
  }
  delegate(root, 'click', '[data-act]', async (el) => {
    const a = el.dataset.act;
    if (a === 'play') onPlay();
    else if (a === 'pick') pick(el.dataset.id);
    else if (a === 'cancel') call('game:cancel');
    else if (a === 'verify') check(await call('game:verify'));
    else if (a === 'folder') check(await call('app:openPath', 'game'));
    else if (a === 'reload') { el.disabled = true; await ctx.refresh(true); el.disabled = false; }
    else if (a === 'copy') { try { await navigator.clipboard.writeText(el.dataset.v); toast('ok', t('Адрес скопирован')); } catch (_) { toast('err', t('Не удалось скопировать')); } }
    else if (a === 'allnews') ctx.go('news');
    else if (a === 'link') openExt(el.dataset.k);
    else if (a === 'read') { const n = news().find((x) => x.id === el.dataset.id); openExt(n && n.url ? n.url : 'news'); }
  });
  // стрелки переключают сервер, как в радиогруппе
  grid.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const items = $$('.sc', grid); const i = items.indexOf(document.activeElement); if (i < 0) return;
    e.preventDefault(); const n = items[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]; n.focus(); pick(n.dataset.id);
  });

  // подсветка за курсором: двигаем только transform псевдоэлемента (--mx/--my в пикселях карточки)
  let raf = 0; let last = null;
  const glowMove = (e) => {
    last = e; if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0; const z = zoomNow(); const ev = last;
      const sc = ev.target.closest && ev.target.closest('.sc');
      if (sc) { const r = sc.getBoundingClientRect(); sc.style.setProperty('--mx', ((ev.clientX - r.left) / z) + 'px'); sc.style.setProperty('--my', ((ev.clientY - r.top) / z) + 'px'); }
      const hg = glow && glow.firstChild;
      if (hg && hero.contains(ev.target)) { const r = hero.getBoundingClientRect(); hg.style.setProperty('--px', (((ev.clientX - r.left) / r.width - .5) * -36) + 'px'); hg.style.setProperty('--py', (((ev.clientY - r.top) / r.height - .5) * -24) + 'px'); }
    });
  };
  root.addEventListener('pointermove', glowMove);

  renderHero(); renderGrid(); renderSide();
  return {
    update(st, what) {
      if (what === 'game' || what === 'net') renderFoot();
      else if (what === 'srv') { markSelected(); renderHero(); }
      else if (what === 'data') { renderGrid(); renderHero(); renderSide(); }
    },
    destroy() { root.removeEventListener('pointermove', glowMove); cancelAnimationFrame(raf); },
  };
}
