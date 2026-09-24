'use strict';
// Web host (GitHub Pages build). Runs first on every page, before the renderer's own scripts.
// Top page: starts the unchanged main-process controller (src/main/app.js) against the shims in
// src/web/, and gives the page the unchanged preload API (src/main/preload.js).
// Break overlay: a full-viewport iframe of overlay.html; its first click / key goes fullscreen.
// Web-only UI is built from the controller's own tray menu, so it carries no strings of its own
// except the ones below, which live in src/i18n.js with the rest.
const E = require('./electron-main');
const W = E.__web;
const I18N = require('../i18n');
const str = (k) => I18N.t(/^zh/i.test(document.documentElement.lang) ? 'zh' : 'en', k);

document.documentElement.dataset.host = 'web';

// A page's window.bf = src/main/preload.js run with a renderer-side electron bound to that page.
function expose(win, key) {
  const shim = {
    contextBridge: { exposeInMainWorld: (name, api) => { win[name] = api; } },
    ipcRenderer: {
      invoke: (channel, arg) => W.invoke(key === 'main' ? W.mainWin : W.windows.find((w) => w.frame === key), channel, arg),
      on: (channel, cb) => { W.subsOf(key).push({ channel, cb }); },
      send() {},
    },
  };
  window.__bfLoad('src/main/preload.js', { 'src/web/electron-main.js': { exports: shim } });
}

const inFrame = window.parent !== window && window.parent.__bfHost;
if (inFrame) {
  // overlay / cover page inside the host page
  window.parent.__bfHost.expose(window, window.frameElement);
  const goFull = () => {
    const f = window.frameElement;
    if (f && !window.parent.document.fullscreenElement && f.requestFullscreen) f.requestFullscreen().catch(() => {});
  };
  addEventListener('pointerup', goFull, { once: true, capture: true });
  addEventListener('keydown', goFull, { once: true, capture: true });
} else {
  bootTop();
}

function bootTop() {
  window.__bfRoot = new URL('.', location.href).href;
  window.__bfHost = { expose: (win, frame) => expose(win, frame) };
  expose(window, 'main');

  const store = require('../main/store');
  const fs = require('./fs');
  const path = require('./path');
  if (W.FAST) {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('breakfit:' + fs.DATA + '/fast/')) localStorage.removeItem(k);
    } catch (_) { /* storage blocked */ }
  }
  // Theme before first paint: theme.js reads ?theme=, the same way the desktop windows load.
  try {
    const theme = store.load(path.join(E.app.getPath('userData'), 'data.json')).settings.theme;
    const u = new URL(location.href);
    if (u.searchParams.get('theme') !== theme) { u.searchParams.set('theme', theme); history.replaceState(history.state, '', u); }
  } catch (_) { /* first run */ }

  const start = () => {
    require('../main/app').start({ fast: W.FAST });
    E.app.whenReady().then(() => W.markReady());
    initUi();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  // Scheduler catch-up: background tabs throttle setInterval, so re-check when the tab comes back.
  const resume = () => { if (!document.hidden) W.emit({ type: 'resume' }); };
  document.addEventListener('visibilitychange', resume);
  addEventListener('focus', resume);
  addEventListener('pageshow', resume);
}

// ---------- web-only UI ----------
function initUi() {
  const side = document.getElementById('side');
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
  const dock = el('div', 'bf-dock');
  side.appendChild(dock);
  const menu = el('div', 'bf-menu');
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  document.body.appendChild(menu);

  const closeMenu = () => { menu.hidden = true; };
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && !e.target.closest('.bf-dock')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  function navBtn(icon, label, onClick) {
    const b = el('button', 'nav-item', `<span class="ms">${icon}</span><span class="nav-label"></span>`);
    b.querySelector('.nav-label').textContent = label;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }

  function openMenu(anchor, items) {
    menu.textContent = '';
    for (const it of items) {
      if (it.type === 'separator') { menu.appendChild(el('hr')); continue; }
      const b = el('button', 'bf-mi');
      b.textContent = it.label;
      b.disabled = it.enabled === false;
      b.setAttribute('role', 'menuitem');
      b.addEventListener('click', () => { closeMenu(); if (it.click) it.click(it); });
      menu.appendChild(b);
    }
    menu.hidden = false;
    const r = anchor.getBoundingClientRect();
    menu.style.left = `${Math.round(r.right + 8)}px`;
    menu.style.top = `${Math.round(Math.max(8, Math.min(r.top, innerHeight - menu.offsetHeight - 8)))}px`;
  }

  // Submenus of the tray menu (= pause) become sidebar items; the rest of the tray menu is
  // desktop-only (window / autostart / quit) or already on the page.
  function render() {
    dock.textContent = '';
    const t = W.Tray.current;
    const tpl = t && t.menu ? t.menu.template : [];
    for (const it of tpl) {
      if (!it.submenu) continue;
      const paused = t.image && /paused/.test(t.image.path || '');
      const b = navBtn(paused ? 'pause_circle' : 'notifications_paused', it.label, () => (menu.hidden ? openMenu(b, it.submenu) : closeMenu()));
      b.classList.toggle('bf-on', !!paused);
      // nothing to pause (rest day, day done, break running): no control at all
      if (it.enabled === false || it.submenu.every((s) => s.type === 'separator' || s.enabled === false)) continue;
      dock.appendChild(b);
    }
    if ('Notification' in window && Notification.permission === 'default') {
      dock.appendChild(navBtn('notifications', str('enableNotify'), () => Notification.requestPermission().then(render, render)));
    }
  }
  W.listen((w) => {
    if (w.type === 'tray') render();
    if (w.type === 'window-open') {
      closeMenu();
      for (const c of document.body.children) if (c !== w.win.frame) c.inert = true;
    }
    if (w.type === 'window-closed' && !W.windows.some((x) => x.frame)) {
      for (const c of document.body.children) c.inert = false;
    }
    if (w.type === 'window-loaded' && document.hidden) {
      // the tab is in the background: the in-page overlay can't be seen, so ping the user
      let title = '';
      try { title = w.win.frame.contentDocument.title; } catch (_) { /* ignore */ }
      new E.Notification({ title, icon: E.nativeImage.createFromPath('/assets/icon/icon-256.png') }).show();
    }
  });
  render();
}
