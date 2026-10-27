'use strict';
/**
 * Заливает сборку лаунчера в Supabase Storage (бакет launcher-updates, папка launcher-electron/):
 *   npm run dist && SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npm run publish:feed
 * Файлы: latest.yml, *.exe, *.blockmap из dist/. Ключ service_role держите только у себя, в репозиторий не кладите.
 */
const fs = require('fs');
const path = require('path');
const dist = path.join(__dirname, '..', 'dist');
const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_KEY;
const bucket = process.env.UPDATES_BUCKET || 'launcher-updates';
const prefix = process.env.UPDATES_PREFIX || 'launcher-electron';
if (!url || !key) { console.error('Нужны SUPABASE_URL и SUPABASE_SERVICE_KEY'); process.exit(1); }
const files = fs.existsSync(dist) ? fs.readdirSync(dist).filter((f) => /^latest\.yml$|\.exe$|\.blockmap$/.test(f)) : [];
if (!files.some((f) => f === 'latest.yml')) { console.error('В dist/ нет latest.yml — сначала npm run dist'); process.exit(1); }

(async () => {
  // latest.yml заливаем последним: клиент увидит новую версию, только когда все файлы уже на месте
  const ordered = files.filter((f) => f !== 'latest.yml').concat('latest.yml');
  for (const f of ordered) {
    const body = fs.readFileSync(path.join(dist, f));
    const res = await fetch(`${url}/storage/v1/object/${bucket}/${prefix}/${encodeURIComponent(f)}`, {
      method: 'POST', headers: { authorization: `Bearer ${key}`, 'x-upsert': 'true', 'content-type': 'application/octet-stream', 'cache-control': 'max-age=60' }, body,
    });
    if (!res.ok) { console.error('ошибка', f, res.status, await res.text()); process.exit(1); }
    console.log('загружено', f, (body.length / 1048576).toFixed(1) + ' МБ');
  }
})();
