// Масштаб интерфейса. «Авто»: окно подгоняет масштаб так, чтобы вёрстка 1160×700 всегда помещалась и росла на больших экранах.
let z = 1;
export const zoomNow = () => z;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export function applyScale(mode) {
  const w = window.innerWidth || 1280; const h = window.innerHeight || 760;
  z = mode && mode !== 'auto' ? Number(mode) / 100 : clamp(Math.min(w / 1160, h / 700), 0.72, 1.6);
  z = Math.round(z * 100) / 100;
  document.documentElement.style.setProperty('--z', String(z));
  return z;
}
