import { t } from './i18n.js';
// Клавиши меню F1 клиента хранятся кодами Windows (Virtual-Key). Здесь — перевод из событий браузера и обратно в подпись.
const CODE = {
  Backspace: 8, Tab: 9, Enter: 13, ShiftLeft: 16, ShiftRight: 16, ControlLeft: 17, ControlRight: 17, AltLeft: 18, AltRight: 18,
  Pause: 19, CapsLock: 20, Space: 32, PageUp: 33, PageDown: 34, End: 35, Home: 36,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Insert: 45, Delete: 46,
  NumpadMultiply: 106, NumpadAdd: 107, NumpadSubtract: 109, NumpadDecimal: 110, NumpadDivide: 111,
  Semicolon: 186, Equal: 187, Comma: 188, Minus: 189, Period: 190, Slash: 191, Backquote: 192,
  BracketLeft: 219, Backslash: 220, BracketRight: 221, Quote: 222,
};
for (let i = 0; i < 26; i++) CODE['Key' + String.fromCharCode(65 + i)] = 65 + i;
for (let i = 0; i < 10; i++) { CODE['Digit' + i] = 48 + i; CODE['Numpad' + i] = 96 + i; }
for (let i = 1; i <= 24; i++) CODE['F' + i] = 111 + i;

const NAME = {
  1: 'ЛКМ', 2: 'ПКМ', 4: 'Колесо мыши', 5: 'Мышь 4', 6: 'Мышь 5', 8: 'Backspace', 9: 'Tab', 13: 'Enter', 16: 'Shift', 17: 'Ctrl', 18: 'Alt',
  19: 'Pause', 20: 'Caps Lock', 32: 'Пробел', 33: 'Page Up', 34: 'Page Down', 35: 'End', 36: 'Home', 37: '←', 38: '↑', 39: '→', 40: '↓',
  45: 'Insert', 46: 'Delete', 106: 'Num *', 107: 'Num +', 109: 'Num −', 110: 'Num .', 111: 'Num /',
  186: ';', 187: '=', 188: ',', 189: '−', 190: '.', 191: '/', 192: '`', 219: '[', 220: '\\', 221: ']', 222: "'",
};
for (let i = 0; i < 26; i++) NAME[65 + i] = String.fromCharCode(65 + i);
for (let i = 0; i < 10; i++) { NAME[48 + i] = String(i); NAME[96 + i] = 'Num ' + i; }
for (let i = 1; i <= 24; i++) NAME[111 + i] = 'F' + i;

/** KeyboardEvent → код Windows (0 — клавиша не поддерживается) */
export const vkFromKey = (e) => CODE[e.code] || 0;
/** Кнопка мыши (MouseEvent.button) → код Windows: средняя, боковые. ЛКМ и ПКМ не назначаем — ими играют. */
export const vkFromMouse = (b) => ({ 1: 4, 3: 5, 4: 6 })[b] || 0;
/** Подпись клавиши */
export const vkName = (vk) => (NAME[vk] ? t(NAME[vk]) : (vk ? `#${vk}` : ''));
