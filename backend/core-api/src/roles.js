'use strict';
/**
 * Роли проекта. Уровень администратора — одно число alvl (0–8) на аккаунте, его же читает игровой сервер
 * (Core/AdminAuth.cs, колонка accounts.alvl в игровой БД ra3_main; БД платформы FloV:MP не участвует). Названия рангов совпадают с Core/AdminRanks.cs.
 */
const MAX = 8;

const RANKS = [
  'Игрок', 'Модератор', 'Хелпер', 'Администратор', 'Курирующий администратор',
  'Старший администратор', 'Главный администратор', 'PR Manager / Developer', 'Руководство проекта',
];

/**
 * Права по минимальному уровню. Пороги — предложение (не из игры): логи для старшей администрации (5+),
 * управление проектом с 6. Меняются здесь, лаунчер и сайт читают готовый список прав из /v1/me.
 */
const PERMISSIONS = [
  ['admin.panel', 1],       // вкладка «Администрирование» в лаунчере и на сайте
  ['players.view', 2],      // просмотр карточки игрока
  ['players.moderate', 3],  // муты, кики, блокировки
  ['logs.view', 5],         // журнал действий администрации
  ['logs.export', 6],
  ['project.manage', 6],    // управление функциями проекта (новости, объявления, флаги)
  ['staff.manage', 7],      // выдача и снятие уровней администрации
  ['owner', 8],
];

function clamp(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.min(MAX, Math.trunc(v))) : 0;
}

/** «Игрок» или «Администратор n уровня» (текст для профиля) + название ранга из игры. */
function describe(alvl) {
  const level = clamp(alvl);
  return {
    alvl: level,
    isStaff: level > 0,
    title: level > 0 ? `Администратор ${level} уровня` : 'Игрок',
    rank: RANKS[level],
  };
}

function permissionsFor(alvl) {
  const level = clamp(alvl);
  return PERMISSIONS.filter(([, min]) => level >= min).map(([name]) => name);
}

function can(alvl, permission) {
  return permissionsFor(alvl).includes(permission);
}

module.exports = { MAX, RANKS, PERMISSIONS, clamp, describe, permissionsFor, can };
