import { t } from './i18n.js';

/** Роль в проекте приходит из Core API в профиле: roleInfo { alvl, rank } и permissions[]. Уровень 0 — «Игрок». */
export const alvlOf = (p) => (p && p.roleInfo && Number(p.roleInfo.alvl)) || 0;
export const roleLabel = (p) => { const n = alvlOf(p); return n > 0 ? t('Администратор {n} уровня', { n }) : t('Игрок'); };
export const rankLabel = (p) => t((p && p.roleInfo && p.roleInfo.rank) || 'Игрок');
export const can = (p, perm) => !!(p && Array.isArray(p.permissions) && p.permissions.includes(perm));
export const canAdmin = (p) => can(p, 'admin.panel');
