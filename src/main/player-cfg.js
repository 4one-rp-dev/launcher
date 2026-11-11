'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

/**
 * Настройки игры из меню F1 клиента: %LOCALAPPDATA%\FloVMP\player.cfg, строки «ключ = значение».
 * Формат и пределы — как у клиента (native/legacy-3889/client/src/prefs.cpp: Load/Save), поэтому то, что выставил
 * лаунчер, игра видит так же, как выставленное в F1, и наоборот. Пока игра запущена, файл не трогаем: клиент
 * перезапишет его своими значениями при следующем сохранении в F1.
 */

const DEFAULTS = {
  drawDistance: 100,     // graphics.draw_distance, % (50..200)
  fpsLimit: -1,          // graphics.fps_limit: -1 как у сервера, 0 без ограничения
  cefGpu: true,          // cef.gpu_frames
  micDevice: 0,          // voice.input_device: номер устройства Windows + 1, 0 — как в Windows
  outDevice: 0,          // voice.output_device
  micVolume: 100,        // voice.mic_volume, % (0..200)
  voiceVolume: 100,      // voice.volume, % (0..200)
  netgraph: false,       // hud.netgraph
  voiceKey: 0,           // voice.key — код клавиши Windows; 0 — клавиша сервера
  radioKey: 0,           // voice.radio_key
  chatKey: 0,            // keys.chat
  consoleKey: 0,         // keys.console
  voiceMode: 'key',      // voice.mode: key | voice
  voiceThreshold: 35,    // voice.threshold, % (5..90)
  streamerMode: false,   // ui.streamer_mode
  discord: true,         // ui.discord
  voiceEnabled: true,    // voice.enabled
  voiceAutoGain: true,   // voice.auto_gain
  voiceNoise: true,      // voice.noise_suppression
  accent: '',            // ui.accent '#RRGGBB'; '' — как на сервере
  alerts: '',            // ui.alerts: card | pill | strip; '' — как на сервере
  consoleSkin: '',       // ui.console_skin: obsidian | slate | glass; '' — как на сервере
  keepDays: null,        // downloads.keep_days: null — по умолчанию (30), -1 — хранить всегда, иначе дней
};
const FPS = [-1, 0, 30, 60, 120, 144, 165, 240];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isOn = (v) => v === 'on' || v === '1' || v === 'true';
const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

/** Разбор файла: неизвестные ключи и мусор отбрасываются, как в клиенте. */
function parse(text) {
  const p = Object.assign({}, DEFAULTS);
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (!raw || raw[0] === '#') continue;
    const eq = raw.indexOf('='); if (eq < 0) continue;
    const key = raw.slice(0, eq).trim(); const v = raw.slice(eq + 1).trim();
    switch (key) {
      case 'graphics.draw_distance': p.drawDistance = clamp(num(v, 100), 50, 200); break;
      case 'cef.gpu_frames': p.cefGpu = isOn(v); break;
      case 'graphics.fps_limit': p.fpsLimit = clamp(int(v, -1), -1, 1000); break;
      case 'voice.input_device': p.micDevice = Math.max(0, int(v, 0)); break;
      case 'voice.output_device': p.outDevice = Math.max(0, int(v, 0)); break;
      case 'voice.mic_volume': p.micVolume = clamp(num(v, 100), 0, 200); break;
      case 'voice.volume': p.voiceVolume = clamp(num(v, 100), 0, 200); break;
      case 'hud.netgraph': p.netgraph = isOn(v); break;
      case 'voice.key': p.voiceKey = clamp(int(v, 0), 0, 255); break;
      case 'voice.radio_key': p.radioKey = clamp(int(v, 0), 0, 255); break;
      case 'keys.chat': p.chatKey = clamp(int(v, 0), 0, 255); break;
      case 'keys.console': p.consoleKey = clamp(int(v, 0), 0, 255); break;
      case 'voice.mode': p.voiceMode = v === 'voice' ? 'voice' : 'key'; break;
      case 'voice.threshold': p.voiceThreshold = clamp(num(v, 35), 5, 90); break;
      case 'ui.streamer_mode': p.streamerMode = isOn(v); break;
      case 'ui.discord': p.discord = isOn(v); break;
      case 'voice.enabled': p.voiceEnabled = isOn(v); break;
      case 'voice.auto_gain': p.voiceAutoGain = isOn(v); break;
      case 'voice.noise_suppression': p.voiceNoise = isOn(v); break;
      case 'ui.accent': p.accent = /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : ''; break;
      case 'ui.alerts': p.alerts = ['card', 'pill', 'strip'].includes(v) ? v : ''; break;
      case 'ui.console_skin': p.consoleSkin = ['obsidian', 'slate', 'glass'].includes(v) ? v : ''; break;
      case 'downloads.keep_days': { const s = v.toLowerCase(); p.keepDays = s === 'off' || s === '-1' ? -1 : (/^\d+$/.test(s) ? Math.min(3650, int(s, 30)) : null); break; }
      default: break;
    }
  }
  return p;
}

/** Изменения из интерфейса: только известные поля и только допустимые значения. */
function sanitize(patch, base) {
  const p = Object.assign({}, base || DEFAULTS);
  const o = patch || {};
  const b = (k) => { if (typeof o[k] === 'boolean') p[k] = o[k]; };
  const n = (k, a, z, step) => { if (typeof o[k] === 'number' && Number.isFinite(o[k])) p[k] = clamp(Math.round(o[k] / step) * step, a, z); };
  n('drawDistance', 50, 200, 5); n('micVolume', 0, 200, 5); n('voiceVolume', 0, 200, 5); n('voiceThreshold', 5, 90, 5);
  if (FPS.includes(o.fpsLimit)) p.fpsLimit = o.fpsLimit;
  for (const k of ['micDevice', 'outDevice']) if (Number.isInteger(o[k]) && o[k] >= 0 && o[k] < 64) p[k] = o[k];
  for (const k of ['voiceKey', 'radioKey', 'chatKey', 'consoleKey']) if (Number.isInteger(o[k]) && o[k] >= 0 && o[k] <= 255) p[k] = o[k];
  if (o.voiceMode === 'key' || o.voiceMode === 'voice') p.voiceMode = o.voiceMode;
  for (const k of ['cefGpu', 'netgraph', 'streamerMode', 'discord', 'voiceEnabled', 'voiceAutoGain', 'voiceNoise']) b(k);
  if (typeof o.accent === 'string' && (o.accent === '' || /^#[0-9a-f]{6}$/i.test(o.accent))) p.accent = o.accent.toUpperCase();
  if (typeof o.alerts === 'string' && ['', 'card', 'pill', 'strip'].includes(o.alerts)) p.alerts = o.alerts;
  if (typeof o.consoleSkin === 'string' && ['', 'obsidian', 'slate', 'glass'].includes(o.consoleSkin)) p.consoleSkin = o.consoleSkin;
  if (o.keepDays === null || o.keepDays === -1 || (Number.isInteger(o.keepDays) && o.keepDays >= 0 && o.keepDays <= 3650)) p.keepDays = o.keepDays;
  return p;
}

/** Текст файла — в том же порядке и виде, что пишет клиент (Save в prefs.cpp). */
function serialize(p) {
  const onoff = (v) => (v ? 'on' : 'off');
  const L = ['# Настройки игрока FloV:MP (меню F1). Меняются в игре; файл можно удалить — вернутся значения по умолчанию.',
    `graphics.draw_distance = ${Math.round(p.drawDistance)}`, `graphics.fps_limit = ${p.fpsLimit}`, `cef.gpu_frames = ${onoff(p.cefGpu)}`,
    `voice.input_device = ${p.micDevice}`, `voice.output_device = ${p.outDevice}`, `voice.mic_volume = ${Math.round(p.micVolume)}`,
    `voice.volume = ${Math.round(p.voiceVolume)}`, `hud.netgraph = ${onoff(p.netgraph)}`, `voice.key = ${p.voiceKey}`, `voice.radio_key = ${p.radioKey}`,
    `keys.chat = ${p.chatKey}`, `keys.console = ${p.consoleKey}`, `voice.mode = ${p.voiceMode}`, `voice.threshold = ${Math.round(p.voiceThreshold)}`,
    `ui.streamer_mode = ${onoff(p.streamerMode)}`, `ui.discord = ${onoff(p.discord)}`, `voice.enabled = ${onoff(p.voiceEnabled)}`,
    `voice.auto_gain = ${onoff(p.voiceAutoGain)}`, `voice.noise_suppression = ${onoff(p.voiceNoise)}`];
  if (p.accent) L.push(`ui.accent = ${p.accent}`);
  if (p.alerts) L.push(`ui.alerts = ${p.alerts}`);
  if (p.consoleSkin) L.push(`ui.console_skin = ${p.consoleSkin}`);
  if (p.keepDays === -1) L.push('downloads.keep_days = off'); else if (p.keepDays != null) L.push(`downloads.keep_days = ${p.keepDays}`);
  return L.join('\n') + '\n';
}

/**
 * Микрофоны и динамики Windows в той же нумерации, что у клиента (waveInGetDevCaps / waveOutGetDevCaps):
 * в player.cfg пишется номер + 1. Через PowerShell и winmm.dll, без окон; имена в UTF-8.
 */
const PS_DEVICES = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class L4Wave {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct InCaps { public ushort m; public ushort p; public uint v; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string name; public uint f; public ushort ch; public ushort r; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct OutCaps { public ushort m; public ushort p; public uint v; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string name; public uint f; public ushort ch; public ushort r; public uint s; }
  [DllImport("winmm.dll")] public static extern uint waveInGetNumDevs();
  [DllImport("winmm.dll")] public static extern uint waveOutGetNumDevs();
  [DllImport("winmm.dll", CharSet = CharSet.Unicode)] public static extern uint waveInGetDevCapsW(UIntPtr id, ref InCaps c, uint sz);
  [DllImport("winmm.dll", CharSet = CharSet.Unicode)] public static extern uint waveOutGetDevCapsW(UIntPtr id, ref OutCaps c, uint sz);
  public static string InName(int i) { var c = new InCaps(); return waveInGetDevCapsW(new UIntPtr((uint)i), ref c, (uint)Marshal.SizeOf(c)) == 0 ? c.name : ""; }
  public static string OutName(int i) { var c = new OutCaps(); return waveOutGetDevCapsW(new UIntPtr((uint)i), ref c, (uint)Marshal.SizeOf(c)) == 0 ? c.name : ""; }
}
'@
$in = @(); for ($i = 0; $i -lt [L4Wave]::waveInGetNumDevs(); $i++) { $in += [L4Wave]::InName($i) }
$out = @(); for ($i = 0; $i -lt [L4Wave]::waveOutGetNumDevs(); $i++) { $out += [L4Wave]::OutName($i) }
@{ inputs = $in; outputs = $out } | ConvertTo-Json -Compress
`;

function createPlayerCfg(deps) {
  const d = deps || {};
  const env = d.env || process.env;
  const dir = d.dir || path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'FloVMP');
  const file = path.join(dir, 'player.cfg');
  const log = d.log;
  let devCache = null;

  function read() {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch (_) { /* файла нет — значения по умолчанию */ }
    return Object.assign(parse(text), { exists: !!text });
  }
  function write(patch) {
    const cur = read();
    const next = sanitize(patch, cur);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, serialize(next), 'utf8');
    fs.renameSync(tmp, file);
    return Object.assign(next, { exists: true });
  }
  function reset(group) {
    const keys = {
      keys: ['voiceKey', 'radioKey', 'chatKey', 'consoleKey'],
      look: ['accent', 'alerts', 'consoleSkin'],
    }[group];
    if (!keys) return read();
    const patch = {}; for (const k of keys) patch[k] = DEFAULTS[k];
    return write(patch);
  }
  function devices(force) {
    if (devCache && !force) return Promise.resolve(devCache);
    if ((d.platform || process.platform) !== 'win32') return Promise.resolve({ inputs: [], outputs: [] });
    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_DEVICES], { windowsHide: true, timeout: 20000, maxBuffer: 1 << 20 }, (err, out) => {
        if (err) { log && log.warn('player-cfg', `устройства звука: ${err.message}`); return resolve({ inputs: [], outputs: [] }); }
        try {
          const j = JSON.parse(String(out).trim() || '{}');
          const arr = (v) => (Array.isArray(v) ? v : v != null ? [v] : []).map((s, i) => String(s || '').trim() || `Устройство ${i + 1}`); // без фильтра: номер = позиция, как у клиента
          devCache = { inputs: arr(j.inputs), outputs: arr(j.outputs) };
          resolve(devCache);
        } catch (e) { log && log.warn('player-cfg', `устройства звука: ${e.message}`); resolve({ inputs: [], outputs: [] }); }
      });
    });
  }
  return { file, read, write, reset, devices };
}

module.exports = { createPlayerCfg, parse, serialize, sanitize, DEFAULTS, FPS };
