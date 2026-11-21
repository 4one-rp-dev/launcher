'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Настройки самой GTA V (Документы\Rockstar Games\GTA V\settings.xml): режим окна и вертикальная синхронизация.
 * Меняем только значение нужного атрибута, остальной файл (графика, кодировка, BOM) остаётся байт в байт.
 * Пока игра запущена, не пишем: GTA перезапишет файл при выходе.
 */
const WINDOWED = { fullscreen: '0', windowed: '1', borderless: '2' };
const BY_VALUE = { 0: 'fullscreen', 1: 'windowed', 2: 'borderless' };

function getAttr(xml, tag) { const m = new RegExp(`<${tag}\\s+value="([^"]*)"\\s*/>`).exec(xml); return m ? m[1] : null; }
function setAttr(xml, tag, value) {
  const re = new RegExp(`(<${tag}\\s+value=")([^"]*)("\\s*/>)`);
  return re.test(xml) ? xml.replace(re, `$1${value}$3`) : null;
}

function createGtaSettings(deps) {
  const file = path.join(deps.documents, 'Rockstar Games', 'GTA V', 'settings.xml');
  function read() {
    let xml; try { xml = fs.readFileSync(file, 'latin1'); } catch (_) { return { exists: false, file }; }
    const w = getAttr(xml, 'Windowed'); const v = getAttr(xml, 'VSync');
    const sw = getAttr(xml, 'ScreenWidth'); const sh = getAttr(xml, 'ScreenHeight');
    return { exists: true, file, windowMode: BY_VALUE[w] || '', vsync: v == null ? null : v !== '0', resolution: sw && sh ? `${sw}×${sh}` : '' };
  }
  /** patch: { windowMode?: fullscreen|windowed|borderless, vsync?: boolean } */
  function write(patch) {
    let xml = fs.readFileSync(file, 'latin1'); // latin1 — побайтно: файл пишем ровно тем же, кроме значения
    if (patch.windowMode && WINDOWED[patch.windowMode]) { const n = setAttr(xml, 'Windowed', WINDOWED[patch.windowMode]); if (n) xml = n; }
    if (typeof patch.vsync === 'boolean') { const n = setAttr(xml, 'VSync', patch.vsync ? '1' : '0'); if (n) xml = n; }
    fs.copyFileSync(file, file + '.4one-backup');
    fs.writeFileSync(file, xml, 'latin1');
    return read();
  }
  return { file, read, write };
}

module.exports = { createGtaSettings, getAttr, setAttr };
