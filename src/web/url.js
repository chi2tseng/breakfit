'use strict';
// pathToFileURL for the web bundle: a virtual "/x/y" path → an absolute URL under the site root.
const siteUrl = (p) => new URL(String(p).replace(/^\/+/, ''), window.__bfRoot || document.baseURI).href;
module.exports = { pathToFileURL: (p) => ({ href: siteUrl(p), toString: () => siteUrl(p) }), siteUrl };
