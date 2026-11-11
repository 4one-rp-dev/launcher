'use strict';
/**
 * Выпуск новой версии лаунчера: npm run release -- [--notes "что нового"]
 *  1) тесты; 2) сборка установщика (dist/); 3) релиз v<версия> на GitHub 4one-rp-dev/launcher с latest.yml,
 *     установщиком и .blockmap. Установленные лаунчеры увидят его сами (проверка при старте и каждые 30 минут),
 *     скачают в фоне и поставят при закрытии.
 * Версию поднимайте в package.json заранее (npm version patch --no-git-tag-version): тот же номер второй раз не выйдет.
 * Нужен gh (GitHub CLI) с доступом к репозиторию.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const { owner, repo } = { owner: '4one-rp-dev', repo: 'launcher' };
const ver = pkg.version; const tag = `v${ver}`;
const argNotes = process.argv.indexOf('--notes');
const notes = argNotes > 0 ? process.argv[argNotes + 1] : `4ONE Launcher ${ver}`;
const run = (cmd, args, opts) => execFileSync(cmd, args, Object.assign({ cwd: root, stdio: 'inherit', shell: process.platform === 'win32' }, opts || {}));

// тот же тег уже выпущен — останавливаемся до сборки
try { execFileSync('gh', ['release', 'view', tag, '--repo', `${owner}/${repo}`], { cwd: root, stdio: 'ignore', shell: process.platform === 'win32' }); console.error(`Релиз ${tag} уже есть. Поднимите версию в package.json.`); process.exit(1); } catch (_) { /* релиза нет — продолжаем */ }

run('npm', ['test']);
run('npx', ['electron-builder', '--win', 'nsis', '--publish', 'never']);
const exe = `4ONE-Launcher-Setup-${ver}.exe`;
const files = ['latest.yml', exe, `${exe}.blockmap`].map((f) => path.join(root, 'dist', f));
for (const f of files) if (!fs.existsSync(f)) { console.error(`Нет файла ${f}`); process.exit(1); }
run('gh', ['release', 'create', tag, ...files, '--repo', `${owner}/${repo}`, '--title', `4ONE Launcher ${ver}`, '--notes', notes, '--latest']);
console.log(`Готово: ${tag}. Лаунчеры игроков обновятся сами.`);
