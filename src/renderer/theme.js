'use strict';
// Theme before first paint (from the ?theme= the window was loaded with), then live updates.
(function theme() {
  const set = (t) => { document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark'; };
  set(new URLSearchParams(location.search).get('theme'));
  if (window.bf && window.bf.onTheme) window.bf.onTheme(set);
  // Last input device, for the keyboard-only focus ring (base.css). Tab / arrows show it again.
  const root = document.documentElement;
  root.dataset.input = 'pointer';
  addEventListener('pointerdown', () => { root.dataset.input = 'pointer'; }, true);
  addEventListener('keydown', (e) => { if (!e.repeat && /^(Tab|Arrow)/.test(e.key)) root.dataset.input = 'keyboard'; }, true);
}());
