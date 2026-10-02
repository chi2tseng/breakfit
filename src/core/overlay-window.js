'use strict';
// Break overlay geometry (pure; no Electron): where the overlay and the cover windows go for a view.
// Rectangles are Electron display coordinates (DIP): { x, y, width, height }. A display is
// { id, bounds, workArea } as screen.getAllDisplays() returns it.

const OVERLAY_MIN = Object.freeze({ width: 400, height: 400 }); // smallest windowed overlay (layout lint floor)
const MARGIN = 16; // a default window keeps this much of the work area free on each side
const REACH = Object.freeze({ x: 96, y: 64 }); // a saved window must overlap a work area by this much to be grabbable

// Per view: the BrowserWindow flags the main overlay gets ('regrab' = re-focus it when it loses focus).
const VIEW_FLAGS = Object.freeze({
  full: Object.freeze({ fullscreen: true, resizable: false, movable: false, minimizable: false, skipTaskbar: true, alwaysOnTop: true, regrab: true }),
  window: Object.freeze({ fullscreen: false, resizable: true, movable: true, minimizable: true, skipTaskbar: false, alwaysOnTop: true, regrab: false }),
});

const normView = (v) => (v === 'window' ? 'window' : 'full');

// Centred on the work area, ~60 % of its width at 16:10, never below the minimum, never larger than
// the work area minus a margin (the minimum wins on a tiny screen).
function defaultWindowBounds(wa) {
  const width = Math.max(OVERLAY_MIN.width, Math.min(wa.width - 2 * MARGIN, Math.round(wa.width * 0.6)));
  const height = Math.max(OVERLAY_MIN.height, Math.min(wa.height - 2 * MARGIN, Math.round((width * 10) / 16)));
  return { x: Math.round(wa.x + (wa.width - width) / 2), y: Math.round(wa.y + (wa.height - height) / 2), width, height };
}

const overlap = (a, b) => ({
  x: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  y: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
});

// The saved rectangle when it is still reachable on a connected display (its top strip — the drag
// header — overlaps a work area enough to grab it), grown to the minimum size and shrunk to fit that
// display's work area; otherwise the default rectangle on `fallbackWa`.
function pickSavedBounds(saved, displays, fallbackWa) {
  const ok = saved && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(saved[k])) && saved.width > 0 && saved.height > 0;
  if (ok) {
    const b = {
      x: Math.round(saved.x), y: Math.round(saved.y),
      width: Math.max(OVERLAY_MIN.width, Math.round(saved.width)), height: Math.max(OVERLAY_MIN.height, Math.round(saved.height)),
    };
    const head = { x: b.x, y: b.y, width: b.width, height: REACH.y };
    let best = null;
    for (const d of displays || []) {
      const o = overlap(head, d.workArea || d.bounds);
      if (o.x >= REACH.x && o.y >= REACH.y && (!best || o.x * o.y > best.area)) best = { d, area: o.x * o.y };
    }
    if (best) {
      const wa = best.d.workArea || best.d.bounds;
      b.width = Math.min(b.width, Math.max(OVERLAY_MIN.width, wa.width));
      b.height = Math.min(b.height, Math.max(OVERLAY_MIN.height, wa.height));
      return b;
    }
  }
  return defaultWindowBounds(fallbackWa);
}

// Which windows a break opens in `view`: the main overlay (display, rectangle, flags) and the cover
// windows (full screen only: one per other display; windowed: none).
function planOverlayWindows(displays, mainDisplayId, view, saved = null) {
  const v = normView(view);
  const main = (displays || []).find((d) => d.id === mainDisplayId) || displays[0];
  if (v === 'full') {
    return {
      view: v,
      main: { displayId: main.id, bounds: { ...main.bounds }, ...VIEW_FLAGS.full },
      covers: displays.filter((d) => d !== main).map((d) => ({ displayId: d.id, bounds: { ...d.bounds } })),
    };
  }
  return { view: v, main: { displayId: main.id, bounds: pickSavedBounds(saved, displays, main.workArea || main.bounds), ...VIEW_FLAGS.window }, covers: [] };
}

module.exports = { OVERLAY_MIN, VIEW_FLAGS, normView, defaultWindowBounds, pickSavedBounds, planOverlayWindows };
