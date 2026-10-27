import { S } from '../state.js';
import { esc, ic, empty } from '../ui.js';
import { t } from '../i18n.js';
import { alvlOf, roleLabel, rankLabel, can } from '../role.js';

// Разделы администрирования и право, которое их открывает (пороги уровней задаёт Core API, backend/core-api/src/roles.js).
// Сами разделы появятся по мере готовности: здесь — каркас вкладки и видимость по уровню.
const SECTIONS = () => [
  { perm: 'players.view', icon: 'users', name: t('Игроки'), sub: t('Карточка игрока, персонажи, история наказаний') },
  { perm: 'players.moderate', icon: 'shield', name: t('Модерация'), sub: t('Муты, кики и блокировки с сайта и лаунчера') },
  { perm: 'logs.view', icon: 'doc', name: t('Журнал действий'), sub: t('Действия администрации: кто, что и когда') },
  { perm: 'project.manage', icon: 'sliders', name: t('Управление проектом'), sub: t('Новости, объявления, флаги и техработы') },
  { perm: 'staff.manage', icon: 'crown', name: t('Администрация'), sub: t('Выдача и снятие уровней') },
];
const MIN = { 'players.view': 2, 'players.moderate': 3, 'logs.view': 5, 'project.manage': 6, 'staff.manage': 7 };

export function mount(root) {
  function paint() {
    const p = S.auth.profile;
    if (!p) { root.innerHTML = ''; return; }
    root.innerHTML = `
    <div class="pg in" style="--i:1">
      <div class="gp spk"><div class="pad prof-h">
        <span class="avatar lg">${ic('shield')}</span>
        <div class="ph-t"><h2>${t('Администрирование')}</h2><div class="ph-s"><span class="bdg">${esc(roleLabel(p))}</span><span>${esc(rankLabel(p))}</span></div></div>
      </div></div>
      <div class="adm-grid">${SECTIONS().map((s) => {
        const on = can(p, s.perm);
        return `<div class="gp flat adm-card${on ? '' : ' lock'}" data-perm="${s.perm}">
          <div class="gh"><div class="ico">${ic(on ? s.icon : 'lock')}</div><h2>${esc(s.name)}</h2></div>
          <div class="pad"><p>${esc(s.sub)}</p>
          <span class="bdg ${on ? 'ok' : 'mute'}">${on ? t('Доступно') : t('С {n} уровня', { n: MIN[s.perm] })}</span>
          ${on ? `<small class="soon">${t('Раздел появится в одном из ближайших обновлений')}</small>` : ''}</div>
        </div>`;
      }).join('')}</div>
      ${alvlOf(p) < 2 ? empty('shield', t('Доступно немного'), t('Остальные разделы откроются с повышением уровня.')) : ''}
    </div>`;
  }
  paint();
  return { update(_st, what) { if (what === 'auth') paint(); } };
}
