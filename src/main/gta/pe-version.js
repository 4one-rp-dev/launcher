'use strict';
const fs = require('fs');

/**
 * Версия файла из PE-ресурса (VS_FIXEDFILEINFO) без нативных модулей и без PowerShell.
 * Читает только заголовки и секцию ресурсов — GTA5.exe весит десятки МБ.
 * Возвращает строку вида "1.0.3889.0" или null.
 */
function readFileVersion(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(4096);
    const n = fs.readSync(fd, head, 0, head.length, 0);
    if (n < 0x40 || head.readUInt16LE(0) !== 0x5a4d) return null;     // MZ
    const pe = head.readUInt32LE(0x3c);
    if (pe + 24 > n || head.readUInt32LE(pe) !== 0x00004550) return null; // PE\0\0
    const numSections = head.readUInt16LE(pe + 6);
    const optSize = head.readUInt16LE(pe + 20);
    const opt = pe + 24;
    const magic = head.readUInt16LE(opt);
    const ddOff = opt + (magic === 0x20b ? 112 : 96);
    if (ddOff + 24 > n) return null;
    const rsrcRva = head.readUInt32LE(ddOff + 16);
    if (!rsrcRva) return null;
    const secOff = opt + optSize;
    const sections = [];
    for (let i = 0; i < numSections && secOff + (i + 1) * 40 <= n; i++) {
      const o = secOff + i * 40;
      sections.push({
        vsize: head.readUInt32LE(o + 8), vaddr: head.readUInt32LE(o + 12),
        rawSize: head.readUInt32LE(o + 16), rawPtr: head.readUInt32LE(o + 20),
      });
    }
    const sec = sections.find((s) => rsrcRva >= s.vaddr && rsrcRva < s.vaddr + Math.max(s.vsize, s.rawSize));
    if (!sec || sec.rawSize > 64 * 1024 * 1024) return null;
    const buf = Buffer.alloc(sec.rawSize);
    fs.readSync(fd, buf, 0, buf.length, sec.rawPtr);
    const base = rsrcRva - sec.vaddr;                                   // смещение каталога внутри buf

    const entries = (off) => {
      const named = buf.readUInt16LE(off + 12); const ids = buf.readUInt16LE(off + 14);
      const list = [];
      for (let i = 0; i < named + ids; i++) {
        const e = off + 16 + i * 8;
        list.push({ id: buf.readUInt32LE(e), off: buf.readUInt32LE(e + 4) });
      }
      return list;
    };
    const L1 = entries(base);
    const ver = L1.find((e) => (e.id & 0x80000000) === 0 && e.id === 16);   // RT_VERSION
    if (!ver || !(ver.off & 0x80000000)) return null;
    const L2 = entries(base + (ver.off & 0x7fffffff));
    if (!L2.length || !(L2[0].off & 0x80000000)) return null;
    const L3 = entries(base + (L2[0].off & 0x7fffffff));
    if (!L3.length) return null;
    const de = base + (L3[0].off & 0x7fffffff);
    const dataRva = buf.readUInt32LE(de); const dataSize = buf.readUInt32LE(de + 4);
    const dataOff = dataRva - sec.vaddr;
    if (dataOff < 0 || dataOff + dataSize > buf.length) return null;
    const data = buf.subarray(dataOff, dataOff + dataSize);
    for (let i = 0; i + 16 <= data.length; i += 4) {
      if (data.readUInt32LE(i) === 0xfeef04bd) {
        const ms = data.readUInt32LE(i + 8); const ls = data.readUInt32LE(i + 12);
        return `${ms >>> 16}.${ms & 0xffff}.${ls >>> 16}.${ls & 0xffff}`;
      }
    }
    return null;
  } catch (_) {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* ignore */ }
  }
}

module.exports = { readFileVersion };
