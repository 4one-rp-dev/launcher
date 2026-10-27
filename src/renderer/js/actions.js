import { call } from './api.js';
import { S, patch } from './state.js';
import { toast } from './ui.js';
import { t } from './i18n.js';

export async function setSetting(p) {
  const r = await call('settings:set', p);
  if (r.ok) patch({ settings: r.data }, 'settings');
  return r;
}
/** Показать ошибку результата (кроме отмены) и вернуть ok */
export function check(r) {
  if (!r.ok && r.code !== 'cancelled') toast('err', r.message || t('Что-то пошло не так'));
  return !!r.ok;
}
export const openExt = (key) => call('app:openExternal', key).then(check);
