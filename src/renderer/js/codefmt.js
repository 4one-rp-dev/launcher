// Ввод кодов: только латиница и цифры, жёсткий лимит длины — в поле нельзя вписать текст.
// Русская раскладка: набранная кириллица превращается в ту же клавишу на латинице (ф→A), вставка кириллицы отбрасывается.
const KEYS = { й: 'Q', ц: 'W', у: 'E', к: 'R', е: 'T', н: 'Y', г: 'U', ш: 'I', щ: 'O', з: 'P', ф: 'A', ы: 'S', в: 'D', а: 'F', п: 'G', р: 'H', о: 'J', л: 'K', д: 'L', я: 'Z', ч: 'X', с: 'C', м: 'V', и: 'B', т: 'N', ь: 'M' };

export const LOGIN_LEN = 8;   // код входа: 8 знаков, показываем XXXX-XXXX (совпадает с issue-launcher-code)
export const PROMO_LEN = 16;  // промокод

/** Оставить допустимое. opts: { max, dash, keys } → { text, dropped: были запрещённые символы, over: не влезло по длине } */
export function cleanCode(raw, opts) {
  const { max, dash, keys } = opts;
  let out = ''; let dropped = false; let over = false;
  for (const ch of String(raw == null ? '' : raw)) {
    let c = ch;
    if (keys && KEYS[c.toLowerCase()]) c = KEYS[c.toLowerCase()];
    c = c.toUpperCase();
    if (/[A-Z0-9]/.test(c) || (dash && c === '-')) { if (out.length < max) out += c; else over = true; }
    else if (!/[\s-]/.test(c)) dropped = true;
  }
  return { text: out, dropped, over };
}
/** XXXX-XXXX из чистых знаков */
export const groupLogin = (s) => s.replace(/(.{4})(?=.)/g, '$1-');
