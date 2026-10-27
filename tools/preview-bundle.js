'use strict';
/**
 * Собирает ОДИН html-файл с демо-лаунчером (мок-сервисы, без Electron): npm run preview:bundle
 * Результат: dist-preview/index.html. Сценарий выбирается хэшем: #login (по умолчанию) | #ready | #not-installed | #update | #no-gta | #downloading | #ingame | #offline
 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const root = path.join(__dirname, '..');
const R = path.join(root, 'src', 'renderer');
const out = path.join(root, 'dist-preview');
const MIME = { '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const dataUri = (f) => `data:${MIME[path.extname(f)]};base64,${fs.readFileSync(f).toString('base64')}`;

function walk(dir, base) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  });
}

(async () => {
  const js = await esbuild.build({ entryPoints: [path.join(__dirname, 'preview-entry.js')], bundle: true, write: false, format: 'iife', minify: true, target: 'chrome120', platform: 'browser' });
  const code = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const assets = {};
  for (const f of walk(path.join(R, 'assets'), R)) if (/\.(png|webp)$/.test(f)) assets[f] = dataUri(path.join(R, f));

  // список стилей берём из index.html — порядок и состав всегда совпадают с приложением
  const cssNames = Array.from(fs.readFileSync(path.join(R, 'index.html'), 'utf8').matchAll(/<link rel="stylesheet" href="css\/([^"]+)\.css">/g)).map((m) => m[1]);
  const css = cssNames.map((n) => {
    let c = fs.readFileSync(path.join(R, 'css', n + '.css'), 'utf8');
    return c.replace(/url\(\s*['"]?(\.\.\/assets\/[^'")]+)['"]?\s*\)/g, (_, p) => `url(${dataUri(path.join(R, 'css', p))})`);
  }).join('\n');

  let html = fs.readFileSync(path.join(R, 'index.html'), 'utf8');
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/, '')
    .replace(/<link rel="stylesheet" href="css\/[^"]+">\s*/g, '')
    .replace(/<script type="module" src="js\/main.js"><\/script>/, '')
    .replace('</head>', () => `<style>${css}</style></head>`)  // функция, а не строка: в коде бывает `$&`
    .replace('</body>', () => `<script>window.__ASSET_MAP=${JSON.stringify(assets)};</script><script>${code}</script></body>`);
  html = html.replace(/src="(assets\/[^"]+)"/g, (m, p) => (assets[p] ? `src="${assets[p]}"` : m));
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'index.html'), html);
  console.log('dist-preview/index.html', (html.length / 1024).toFixed(0) + ' КБ');
})().catch((e) => { console.error(e); process.exit(1); });
