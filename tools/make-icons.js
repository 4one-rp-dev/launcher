'use strict';
/**
 * Собирает спрайт из Lucide (контур) и Phosphor (логотипы брендов) по карте tools/icons-map.js -> assets/icons/sprite.svg
 * и вставляет его в index.html между <!-- ICONS:BEGIN --> и <!-- ICONS:END -->. (Инлайн из-за CSP: fetch из рендерера запрещён.)
 * Проверяет, что все иконки, используемые в рендерере (ic('имя'), icon: 'имя'), есть в карте. Запуск: npm run icons
 */
const fs = require('fs');
const path = require('path');
const MAP = require('./icons-map');
const R = path.join(__dirname, '..', 'src', 'renderer');
const NM = path.join(__dirname, '..', 'node_modules');
const LUCIDE = path.join(NM, 'lucide-static', 'icons');
const PHOS = path.join(NM, '@phosphor-icons', 'core', 'assets', 'regular');
const names = Object.keys(MAP);
const inner = (file) => fs.readFileSync(file, 'utf8').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<!--[\s\S]*?-->/g, '').trim();

function symbol(name) {
  const v = MAP[name];
  if (v.startsWith('ph:')) {
    const file = path.join(PHOS, `${v.slice(3)}.svg`);
    if (!fs.existsSync(file)) throw new Error(`нет иконки Phosphor «${v}» для «${name}»`);
    // логотипы — заливка, а не контур: перекрываем общий stroke из CSS
    return `<symbol id="i-${name}" viewBox="0 0 256 256" fill="currentColor" stroke="none">${inner(file)}</symbol>`;
  }
  const file = path.join(LUCIDE, `${v}.svg`);
  if (!fs.existsSync(file)) throw new Error(`нет иконки Lucide «${v}» для «${name}»`);
  return `<symbol id="i-${name}" viewBox="0 0 24 24">${inner(file)}</symbol>`;
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n${names.map(symbol).join('\n')}\n</svg>\n`;
fs.mkdirSync(path.join(R, 'assets', 'icons'), { recursive: true });
fs.writeFileSync(path.join(R, 'assets', 'icons', 'sprite.svg'), svg);
const f = path.join(R, 'index.html');
const html = fs.readFileSync(f, 'utf8');
const re = /(<!-- ICONS:BEGIN[^>]*-->)[\s\S]*?(<!-- ICONS:END -->)/;
if (!re.test(html)) { console.error('В index.html нет маркеров ICONS:BEGIN/END'); process.exit(1); }
fs.writeFileSync(f, html.replace(re, (_, a, b) => `${a}\n${svg.trim()}\n${b}`));

const used = new Set();
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'assets') walk(p); continue; }
    if (!/\.(js|html)$/.test(e.name)) continue;
    const s = fs.readFileSync(p, 'utf8').replace(/<!-- ICONS:BEGIN[\s\S]*?ICONS:END -->/, '');
    for (const m of s.matchAll(/\bic\('([a-z0-9-]+)'/g)) used.add(m[1]);
    for (const m of s.matchAll(/icon: '([a-z0-9-]+)'/g)) used.add(m[1]);
    for (const m of s.matchAll(/#i-([a-z0-9-]+)/g)) used.add(m[1]);
    for (const m of s.matchAll(/\[\s*'[a-z]+',\s*'([a-z0-9-]+)',\s*'[A-ZА-Я][^']*',/g)) used.add(m[1]);
  }
})(R);
const missing = [...used].filter((n) => !names.includes(n));
console.log(`спрайт: ${names.length} иконок (Lucide)`);
if (missing.length) { console.error('нет иконок:', missing.join(', ')); process.exit(1); }
