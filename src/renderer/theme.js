'use strict';
// Theme before first paint (from the ?theme= the window was loaded with), then live updates.
(function theme() {
  const set = (t) => { document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark'; };
  set(new URLSearchParams(location.search).get('theme'));
  if (window.bf && window.bf.onTheme) window.bf.onTheme(set);
}());
