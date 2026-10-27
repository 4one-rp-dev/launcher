'use strict';
/** Скользящее окно в памяти: не больше `max` неудачных попыток за `windowMs` на ключ. Один процесс API. */
function createLimiter({ max, windowMs, now = Date.now }) {
  const hits = new Map();
  const fresh = (key) => {
    const t = now() - windowMs;
    const list = (hits.get(key) || []).filter((x) => x > t);
    if (list.length) hits.set(key, list); else hits.delete(key);
    return list;
  };
  return {
    blocked: (key) => fresh(key).length >= max,
    fail(key) { const list = fresh(key); list.push(now()); hits.set(key, list); },
    reset(key) { hits.delete(key); },
    size: () => hits.size,
  };
}
module.exports = { createLimiter };
