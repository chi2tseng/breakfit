'use strict';
// Theme before first paint (from the ?theme= the window was loaded with), then live updates.
(function theme() {
  const set = (t) => { document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark'; };
  set(new URLSearchParams(location.search).get('theme'));
  if (window.bf && window.bf.onTheme) window.bf.onTheme(set);
  // Language: static [data-i18n] markup once the DOM is parsed (before first paint), then live.
  // Pages with dynamic text re-render themselves on bf:lang.
  const lang = (l) => { window.LANG = I18N.norm(l); if (document.body) I18N.apply(document, window.LANG); dispatchEvent(new CustomEvent('bf:lang')); };
  window.LANG = I18N.norm(new URLSearchParams(location.search).get('lang'));
  document.documentElement.lang = I18N.htmlLang(window.LANG);
  addEventListener('DOMContentLoaded', () => I18N.apply(document, window.LANG));
  if (window.bf && window.bf.onLang) window.bf.onLang(lang);
  const root = document.documentElement;
  // Browser chrome colour (web build on phones) = the theme's --bg, however the theme gets set.
  const tint = () => {
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = getComputedStyle(root).getPropertyValue('--bg').trim() || m.content;
  };
  addEventListener('load', tint);
  new MutationObserver(tint).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  // Last input device, for the keyboard-only focus ring (base.css). Any key except a lone modifier
  // (Alt of Alt+Tab) or typing into a field hands the ring back to Chromium's own :focus-visible, so
  // focus a key moves by script (Esc → 離開休息？ focuses 繼續) is still shown.
  root.dataset.input = 'pointer';
  addEventListener('pointerdown', () => { root.dataset.input = 'pointer'; }, true);
  addEventListener('keydown', (e) => {
    if (e.repeat || /^(Alt|AltGraph|Control|Shift|Meta|CapsLock)$/.test(e.key)) return;
    if (/^(Tab|Arrow)/.test(e.key) || !(e.target instanceof Element && e.target.matches('input, textarea'))) root.dataset.input = 'keyboard';
  }, true);
}());
