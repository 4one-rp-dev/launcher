// Браузерный предпросмотр: подменяет window.l4 мок-сервисами (без Electron). Только для демо и дизайна.
import { createHandlers } from '../src/core/handlers';
import { CHANNELS, EVENTS } from '../src/core/contract';
import { createMock } from '../src/mock';

const hash = (location.hash || '').replace('#', '');
const scenario = /^[a-z-]+$/.test(hash) ? hash : 'login';
const m = createMock({ scenario, frozen: scenario === 'downloading' });
const handlers = createHandlers(m.services);
const subs = {};
Object.values(EVENTS).forEach((ev) => m.bus.on(ev, (p) => (subs[ev] || []).slice().forEach((f) => f(p))));
const chans = Object.values(CHANNELS);

window.l4 = {
  platform: 'win32',
  call: (ch, ...a) => (chans.includes(ch) ? Promise.resolve(handlers[ch](...a)) : Promise.resolve({ ok: false, code: 'bad_request', message: 'Неизвестный канал' })),
  on: (ev, cb) => { (subs[ev] = subs[ev] || []).push(cb); return () => { subs[ev] = subs[ev].filter((f) => f !== cb); }; },
};

// Картинки лежат внутри страницы (data:) — подменяем assets/* на лету
const MAP = window.__ASSET_MAP || {};
const fix = (img) => { const s = img.getAttribute && img.getAttribute('src'); if (s && MAP[s]) img.setAttribute('src', MAP[s]); };
new MutationObserver((list) => list.forEach((r) => {
  r.addedNodes.forEach((n) => { if (n.nodeType !== 1) return; if (n.tagName === 'IMG') fix(n); n.querySelectorAll && n.querySelectorAll('img').forEach(fix); });
  if (r.type === 'attributes') fix(r.target);
})).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
