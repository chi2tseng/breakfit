'use strict';
// Minimal POSIX `path` for the web bundle (virtual root "/" = the site root).
function normalize(p) {
  const out = [];
  for (const s of p.split('/')) {
    if (!s || s === '.') continue;
    if (s === '..') out.pop(); else out.push(s);
  }
  return '/' + out.join('/');
}
const join = (...parts) => normalize(parts.filter(Boolean).join('/'));
const dirname = (p) => normalize(p).replace(/\/[^/]*$/, '') || '/';
const basename = (p, ext) => {
  const b = normalize(p).split('/').pop();
  return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b;
};
module.exports = { join, dirname, basename, resolve: join, normalize, sep: '/' };
