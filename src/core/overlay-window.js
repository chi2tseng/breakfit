'use strict';
// Break overlay geometry (pure; no Electron): where the overlay and the cover windows go for a view.
// Rectangles are Electron display coordinates (DIP): { x, y, width, height }. A display is
// { id, bounds, workArea } as screen.getAllDisplays() returns it.

const VIEWS = Object.freeze(['pip', 'window', 'full']); // UI order: 畫中畫 first (SPEC §5a)
const OVERLAY_MIN = Object.freeze({ width: 400, height: 400 }); // smallest windowed overlay (layout lint floor)
const PIP_MIN = Object.freeze({ width: 320, height: 300 }); // smallest PIP (layout lint floor)
const PIP_SIZE = Object.freeze({ width: 400, height: 580 }); // default PIP
const MARGIN = 16; // a default window keeps this much of the work area free on each side
const REACH = Object.freeze({ x: 96, y: 64 }); // a saved window must overlap a work area by this much to be grabbable

// Per view: the BrowserWindow flags the main overlay gets. regrab = re-focus it when it loses focus;
// keepOnTop = re-assert always-on-top (moveTop, never focus) every ~1.7 s; focusable false = mouse-only,
// the keyboard stays with the app underneath.
const VIEW_FLAGS = Object.freeze({
  pip: Object.freeze({ fullscreen: false, resizable: true, movable: true, minimizable: false, skipTaskbar: true, alwaysOnTop: true, regrab: false, focusable: false, keepOnTop: true }),
  window: Object.freeze({ fullscreen: false, resizable: true, movable: true, minimizable: true, skipTaskbar: false, alwaysOnTop: true, regrab: false, focusable: true, keepOnTop: false }),
  full: Object.freeze({ fullscreen: true, resizable: false, movable: false, minimizable: false, skipTaskbar: true, alwaysOnTop: true, regrab: true, focusable: true, keepOnTop: false }),
});

const normView = (v) => (VIEWS.includes(v) ? v : 'pip');
const minSize = (view) => (view === 'pip' ? PIP_MIN : OVERLAY_MIN);

// Windowed: centred on the work area, ~60 % of its width at 16:10, never below the minimum, never
// larger than the work area minus a margin (the minimum wins on a tiny screen).
function defaultWindowBounds(wa) {
  const width = Math.max(OVERLAY_MIN.width, Math.min(wa.width - 2 * MARGIN, Math.round(wa.width * 0.6)));
  const height = Math.max(OVERLAY_MIN.height, Math.min(wa.height - 2 * MARGIN, Math.round((width * 10) / 16)));
  return { x: Math.round(wa.x + (wa.width - width) / 2), y: Math.round(wa.y + (wa.height - height) / 2), width, height };
}

// PIP: 400×580 in the bottom-right corner of the work area, 16 px from its edges.
function defaultPipBounds(wa) {
  const width = Math.max(PIP_MIN.width, Math.min(wa.width - 2 * MARGIN, PIP_SIZE.width));
  const height = Math.max(PIP_MIN.height, Math.min(wa.height - 2 * MARGIN, PIP_SIZE.height));
  return { x: wa.x + wa.width - width - MARGIN, y: wa.y + wa.height - height - MARGIN, width, height };
}

const overlap = (a, b) => ({
  x: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  y: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
});

// The saved rectangle when it is still reachable on a connected display (its top strip — the drag
// header — overlaps a work area enough to grab it), grown to the minimum size and shrunk to fit that
// display's work area; otherwise the default rectangle on `fallbackWa`.
function pickSavedBounds(saved, displays, fallbackWa, { min = OVERLAY_MIN, fallback = defaultWindowBounds } = {}) {
  const ok = saved && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(saved[k])) && saved.width > 0 && saved.height > 0;
  if (ok) {
    const b = {
      x: Math.round(saved.x), y: Math.round(saved.y),
      width: Math.max(min.width, Math.round(saved.width)), height: Math.max(min.height, Math.round(saved.height)),
    };
    const head = { x: b.x, y: b.y, width: b.width, height: REACH.y };
    let best = null;
    for (const d of displays || []) {
      const o = overlap(head, d.workArea || d.bounds);
      if (o.x >= REACH.x && o.y >= REACH.y && (!best || o.x * o.y > best.area)) best = { d, area: o.x * o.y };
    }
    if (best) {
      const wa = best.d.workArea || best.d.bounds;
      b.width = Math.min(b.width, Math.max(min.width, wa.width));
      b.height = Math.min(b.height, Math.max(min.height, wa.height));
      return b;
    }
  }
  return fallback(fallbackWa);
}

// Which windows a break opens in `view`: the main overlay (display, rectangle, flags, minimum size)
// and the cover windows (full screen only: one per other display). For PIP, `mainDisplayId` is the
// display under the cursor; `saved` is that view's remembered rectangle.
function planOverlayWindows(displays, mainDisplayId, view, saved = null) {
  const v = normView(view);
  const main = (displays || []).find((d) => d.id === mainDisplayId) || displays[0];
  const wa = main.workArea || main.bounds;
  if (v === 'full') {
    return {
      view: v,
      main: { displayId: main.id, bounds: { ...main.bounds }, min: null, ...VIEW_FLAGS.full },
      covers: displays.filter((d) => d !== main).map((d) => ({ displayId: d.id, bounds: { ...d.bounds } })),
    };
  }
  const bounds = v === 'pip'
    ? pickSavedBounds(saved, displays, wa, { min: PIP_MIN, fallback: defaultPipBounds })
    : pickSavedBounds(saved, displays, wa);
  return { view: v, main: { displayId: main.id, bounds, min: minSize(v), ...VIEW_FLAGS[v] }, covers: [] };
}

module.exports = {
  VIEWS, OVERLAY_MIN, PIP_MIN, PIP_SIZE, VIEW_FLAGS, normView, minSize, defaultWindowBounds, defaultPipBounds, pickSavedBounds, planOverlayWindows,
};
