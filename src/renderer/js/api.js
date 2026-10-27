import { t } from './i18n.js';
// Тонкая обёртка над window.l4 (preload). В браузерном предпросмотре window.l4 подставляет tools/preview-shim.
export const l4 = window.l4;
/** Тексты ошибок приходят из main по-русски (contract.js ERRORS) — переводим здесь, по месту показа */
export const call = async (channel, ...args) => {
  const r = await l4.call(channel, ...args);
  if (r && r.ok === false && r.message) r.message = t(r.message);
  return r;
};
export const on = (ev, cb) => l4.on(ev, cb);
