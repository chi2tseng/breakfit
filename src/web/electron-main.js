'use strict';
// The slice of Electron's main-process API that src/main/app.js uses, implemented in one page:
// - the main window IS this page; other windows (break overlay, covers) are full-viewport iframes
// - ipcMain.handle ↔ each page's preload (src/main/preload.js, run with electron-renderer.js)
// - Tray keeps its menu template; host.js renders the parts that make sense on the web
// - Notification → Web Notifications (only when the user granted permission)
const { siteUrl } = require('./url');
const { DATA } = require('./fs');

const listeners = new Set(); // generic change hooks for host.js: (what) => void
const emit = (what) => { for (const f of listeners) { try { f(what); } catch (e) { console.error(e); } } };

// ---------- ipc ----------
const handlers = new Map();
// Structured clone both ways, like real IPC: pages can't mutate the controller's objects.
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
async function invoke(win, channel, arg) {
  await ready;
  const h = handlers.get(channel);
  if (!h) throw new Error(`No handler registered for '${channel}'`);
  return clone(await h({ sender: win && win.webContents }, clone(arg)));
}
const ipcMain = { handle: (ch, fn) => { handlers.set(ch, fn); }, on() {}, removeHandler: (ch) => handlers.delete(ch) };
let markReady;
const ready = new Promise((r) => { markReady = r; });

// ---------- windows ----------
const windows = [];
let mainWin = null;

// Page-side listeners (ipcRenderer.on), keyed by page: 'main' or the iframe element.
const pageSubs = new Map();
const subsOf = (key) => { if (!pageSubs.has(key)) pageSubs.set(key, []); return pageSubs.get(key); };

class WebContents {
  constructor(win) { this.win = win; this.once_ = {}; }
  send(channel, ...args) {
    const key = this.win.frame || (this.win === mainWin ? 'main' : null);
    for (const s of pageSubs.get(key) || []) if (s.channel === channel) s.cb({ sender: null }, ...clone(args));
  }
  once(ev, cb) { (this.once_[ev] = this.once_[ev] || []).push(cb); }
  fire(ev) { const l = this.once_[ev] || []; this.once_[ev] = []; for (const f of l) f(); }
  on(ev, cb) { this.once(ev, cb); }
  executeJavaScript() { return Promise.resolve(); }
}

class BrowserWindow {
  constructor(opts = {}) {
    this.opts = opts;
    this.destroyed = false;
    this.webContents = new WebContents(this);
    this.events = {};
    this.frame = null;
    windows.push(this);
  }
  static getAllWindows() { return windows.filter((w) => !w.destroyed); }
  loadFile(file, { query } = {}) {
    const q = query ? '?' + new URLSearchParams(query) : '';
    if (/\/main\.html$/.test(file)) {
      // the main window is the page itself: sync its ?theme= before theme.js reads it
      mainWin = this;
      const u = new URL(location.href);
      for (const [k, v] of Object.entries(query || {})) u.searchParams.set(k, v);
      history.replaceState(history.state, '', u);
      const done = () => { this.webContents.fire('did-finish-load'); this.emitEv('ready-to-show'); };
      if (document.readyState === 'complete') setTimeout(done); else addEventListener('load', done, { once: true });
      return Promise.resolve();
    }
    const f = document.createElement('iframe');
    f.className = 'bf-window';
    f.setAttribute('allow', 'fullscreen; autoplay');
    f.tabIndex = -1;
    f.src = siteUrl(file) + q;
    this.frame = f;
    f.addEventListener('load', () => {
      this.webContents.fire('did-finish-load');
      this.emitEv('ready-to-show');
      emit({ type: 'window-loaded', win: this });
    });
    document.body.appendChild(f);
    emit({ type: 'window-open', win: this });
    return Promise.resolve();
  }
  emitEv(ev) { const l = this.events[ev] || []; for (const f of l.slice()) f(); }
  on(ev, cb) { (this.events[ev] = this.events[ev] || []).push(cb); return this; }
  once(ev, cb) { const w = () => { this.events[ev] = this.events[ev].filter((x) => x !== w); cb(); }; return this.on(ev, w); }
  isDestroyed() { return this.destroyed; }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.frame) {
      if (document.fullscreenElement === this.frame) document.exitFullscreen().catch(() => {});
      this.frame.remove();
      pageSubs.delete(this.frame);
    }
    windows.splice(windows.indexOf(this), 1);
    emit({ type: 'window-closed', win: this });
    this.emitEv('closed');
  }
  close() { this.destroy(); }
  show() { if (this.frame) this.frame.style.visibility = ''; }
  hide() {}
  focus() {
    if (this.frame) { try { this.frame.focus(); this.frame.contentWindow.focus(); } catch (_) { /* not loaded */ } } else window.focus();
  }
  moveTop() {}
  removeMenu() {}
  setAlwaysOnTop() {}
  setVisibleOnAllWorkspaces() {}
  setBackgroundColor() {}
  isVisible() { return !this.destroyed; }
}

// ---------- the rest of the surface app.js touches ----------
const viewport = () => ({ x: 0, y: 0, width: innerWidth, height: innerHeight });
const screen = {
  getPrimaryDisplay: () => ({ id: 1, bounds: viewport(), workAreaSize: { width: innerWidth, height: innerHeight } }),
  getAllDisplays: () => [screen.getPrimaryDisplay()],
};

const params = new URLSearchParams(location.search);
const FAST = params.has('fast');
const app = {
  isPackaged: false,
  getPath: (k) => (k === 'userData' ? DATA + (FAST ? '/fast' : '') : '/'),
  whenReady: () => Promise.resolve(),
  on() {},
  quit() {},
  exit() {},
  requestSingleInstanceLock: () => true,
  setAppUserModelId() {},
  getLoginItemSettings: () => ({ openAtLogin: false }),
  setLoginItemSettings() {},
  commandLine: { appendSwitch() {} },
};

const nativeImage = { createFromPath: (p) => ({ path: p, toURL: () => siteUrl(p) }) };

class Notification {
  constructor({ title = '', body = '', icon } = {}) { this.o = { title, body, icon }; }
  static isSupported() { return 'Notification' in window && window.Notification.permission === 'granted'; }
  show() {
    if (!Notification.isSupported()) return;
    // Electron ships a .ico/.png; browsers only take web images
    const icon = this.o.icon && this.o.icon.toURL ? this.o.icon.toURL().replace(/\.ico$/, '-256.png') : undefined;
    try {
      const n = new window.Notification(this.o.title, { body: this.o.body || undefined, icon, tag: 'breakfit' });
      n.onclick = () => { window.focus(); n.close(); };
    } catch (_) { /* Android Chrome: only via service worker */ }
  }
}

class Tray {
  constructor() { this.menu = null; this.tip = ''; Tray.current = this; }
  setToolTip(t) { this.tip = t; }
  setImage(img) { this.image = img; }
  setContextMenu(m) { this.menu = m; emit({ type: 'tray' }); }
  on() {}
  destroy() {}
}
const Menu = { buildFromTemplate: (template) => ({ template }) };

const dialog = {
  // native message box → the browser's confirm(); first button = OK
  showMessageBox: (opts) => Promise.resolve({ response: window.confirm([opts.message, opts.detail].filter(Boolean).join('\n\n')) ? 0 : 1 }),
  showErrorBox: (title, text) => window.alert(`${title}\n\n${text}`),
};

const listen = (fn) => listeners.add(fn);
module.exports = {
  app, BrowserWindow, ipcMain, screen, Notification, Tray, Menu, dialog, nativeImage,
  powerMonitor: { on: (ev, cb) => listen((w) => { if (w.type === ev) cb(); }) },
  __web: {
    invoke, markReady, emit, listen, windows, Tray, subsOf,
    get mainWin() { return mainWin; },
    FAST,
  },
};
