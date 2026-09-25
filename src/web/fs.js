'use strict';
// `fs` for the web bundle: files under the userData dir live in localStorage (so src/main/store.js
// runs unchanged); site files (clips, icons) exist when build-web.js copied them (__bfSiteFiles).
const KEY = 'breakfit:';
const DATA = '/userData';

const isData = (p) => p.startsWith(DATA + '/');
const enoent = (p) => Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
const ls = () => {
  try { return window.localStorage; } catch (_) { return null; }
};
// Private mode / blocked storage: keep data in memory for this page's lifetime.
const mem = new Map();
const get = (p) => { const s = ls(); try { return s ? s.getItem(KEY + p) : mem.get(p) ?? null; } catch (_) { return mem.get(p) ?? null; } };
const set = (p, v) => { mem.set(p, v); const s = ls(); try { if (s) s.setItem(KEY + p, v); } catch (_) { /* quota: memory copy only */ } };
const del = (p) => { mem.delete(p); const s = ls(); try { if (s) s.removeItem(KEY + p); } catch (_) { /* ignore */ } };

module.exports = {
  // site files: the list build-web.js baked into the bundle (every copied clip / icon)
  existsSync: (p) => (isData(p) ? get(p) !== null : typeof __bfSiteFiles === 'undefined' || __bfSiteFiles.has(p)),
  readFileSync(p) {
    const v = isData(p) ? get(p) : null;
    if (v === null) throw enoent(p);
    return v;
  },
  writeFileSync(p, text) { if (isData(p)) set(p, String(text)); },
  renameSync(a, b) {
    const v = get(a);
    if (v === null) throw enoent(a);
    set(b, v);
    del(a);
  },
  copyFileSync(a, b) { const v = get(a); if (v !== null) set(b, v); },
  mkdirSync() {},
  readdirSync: () => [],
  rmSync(p) { del(p); },
  DATA,
};
