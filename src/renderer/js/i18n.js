import { EN } from './i18n-en.js';

// Ключ перевода — русская строка как есть. Нет записи в EN → показываем ключ (русский).
let lang = 'ru';
export const getLang = () => lang;
export const locale = () => (lang === 'en' ? 'en-US' : 'ru-RU');
export function setLang(l) {
  lang = l === 'en' ? 'en' : 'ru';
  try { document.documentElement.lang = lang; } catch (_) {}
}
/** t('Hello, {name}', { name }) — подстановка по {имени}, значения не экранируются (esc делает вызывающий) */
export function t(key, vars) {
  let s = lang === 'en' && Object.prototype.hasOwnProperty.call(EN, key) ? EN[key] : key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}
