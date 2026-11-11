'use strict';
/**
 * Вывод консольных программ Windows (reg.exe и т. п.) в канал приходит в OEM-кодировке (в русской Windows — cp866),
 * а не в UTF-8: путь вида C:\Users\Иван\… иначе превращается в «кракозябры». Пробуем UTF-8, при ошибке — cp866.
 */
function decodeConsole(buf) {
  if (buf == null) return '';
  if (typeof buf === 'string') return buf;
  const b = Buffer.from(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (_) { /* не UTF-8 */ }
  try { return new TextDecoder('ibm866').decode(b); } catch (_) { return b.toString('latin1'); }
}

module.exports = { decodeConsole };
