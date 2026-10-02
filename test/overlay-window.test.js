'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const W = require('../src/core/overlay-window');
const { normalizeSettings } = require('../src/core/settings');

// Primary 1920×1080 at 100 % (taskbar 40 px); right: a 2560×1440 monitor at 150 % = 1707×960 DIP
// (work area 1707×920); left: 1366×768 at 100 %.
const PRIMARY = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const RIGHT150 = { id: 2, bounds: { x: 1920, y: 0, width: 1707, height: 960 }, workArea: { x: 1920, y: 0, width: 1707, height: 920 } };
const LEFT = { id: 3, bounds: { x: -1366, y: 200, width: 1366, height: 768 }, workArea: { x: -1366, y: 200, width: 1366, height: 728 } };
const ALL = [PRIMARY, RIGHT150, LEFT];
const inside = (b, wa) => b.x >= wa.x && b.y >= wa.y && b.x + b.width <= wa.x + wa.width && b.y + b.height <= wa.y + wa.height;

test('settings: breakView defaults to pip; pip | window | full, anything else → pip', () => {
  assert.equal(normalizeSettings({}).breakView, 'pip'); // an old data.json without the field
  assert.equal(normalizeSettings({ breakView: undefined }).breakView, 'pip');
  assert.equal(normalizeSettings({ breakView: 'zoom' }).breakView, 'pip');
  for (const v of ['pip', 'window', 'full']) assert.equal(normalizeSettings({ breakView: v }).breakView, v);
  // a saved choice survives a later patch
  assert.equal(normalizeSettings({ ...normalizeSettings({ breakView: 'full' }), theme: 'light' }).breakView, 'full');
  assert.deepEqual(W.VIEWS, ['pip', 'window', 'full']); // UI order: PIP first
});

test('settings: pipBounds normalised like windowBounds', () => {
  assert.equal(normalizeSettings({}).pipBounds, null);
  assert.deepEqual(normalizeSettings({ pipBounds: { x: 1500.6, y: 400, width: 400, height: 580 } }).pipBounds, { x: 1501, y: 400, width: 400, height: 580 });
  assert.equal(normalizeSettings({ pipBounds: { x: 1, y: 2, width: -5, height: 3 } }).pipBounds, null);
});

test('settings: windowBounds = four finite numbers with a positive size, else null', () => {
  assert.equal(normalizeSettings({}).windowBounds, null);
  assert.deepEqual(normalizeSettings({ windowBounds: { x: 10.4, y: -20, width: '800', height: 600 } }).windowBounds, { x: 10, y: -20, width: 800, height: 600 });
  for (const bad of [{ x: 1, y: 2, width: 3 }, { x: 'a', y: 0, width: 800, height: 600 }, { x: 0, y: 0, width: 0, height: 600 }, { x: null, y: 0, width: 800, height: 600 }, 'x', 5]) {
    assert.equal(normalizeSettings({ windowBounds: bad }).windowBounds, null, JSON.stringify(bad));
  }
});

test('defaultWindowBounds: centred, ~60 % wide at 16:10, inside the work area', () => {
  const b = W.defaultWindowBounds(PRIMARY.workArea);
  assert.deepEqual(b, { x: 384, y: 160, width: 1152, height: 720 });
  // DPI-scaled secondary: computed in its own DIP work area
  const r = W.defaultWindowBounds(RIGHT150.workArea);
  assert.equal(r.width, Math.round(1707 * 0.6));
  assert.ok(inside(r, RIGHT150.workArea));
  assert.equal(r.x, 1920 + Math.round((1707 - r.width) / 2));
  // tiny work area: the minimum size wins
  const t = W.defaultWindowBounds({ x: 0, y: 0, width: 640, height: 480 });
  assert.equal(t.width, W.OVERLAY_MIN.width);
  assert.equal(t.height, W.OVERLAY_MIN.height);
});

test('pickSavedBounds: reachable saved rectangle is kept (any display, DPI-scaled too)', () => {
  const s = { x: 200, y: 100, width: 900, height: 640 };
  assert.deepEqual(W.pickSavedBounds(s, ALL, PRIMARY.workArea), s);
  const onRight = { x: 2100, y: 120, width: 1000, height: 700 };
  assert.deepEqual(W.pickSavedBounds(onRight, ALL, PRIMARY.workArea), onRight);
  const onLeft = { x: -1200, y: 260, width: 800, height: 600 };
  assert.deepEqual(W.pickSavedBounds(onLeft, ALL, PRIMARY.workArea), onLeft);
  // straddling two displays is fine
  const across = { x: 1700, y: 100, width: 800, height: 600 };
  assert.deepEqual(W.pickSavedBounds(across, ALL, PRIMARY.workArea), across);
});

test('pickSavedBounds: monitor unplugged / off-screen / no saved → default on the fallback work area', () => {
  const onRight = { x: 2100, y: 120, width: 1000, height: 700 };
  assert.deepEqual(W.pickSavedBounds(onRight, [PRIMARY], PRIMARY.workArea), W.defaultWindowBounds(PRIMARY.workArea));
  // only a 40 px sliver left on screen: not grabbable
  assert.deepEqual(W.pickSavedBounds({ x: 1880, y: 100, width: 800, height: 600 }, [PRIMARY], PRIMARY.workArea), W.defaultWindowBounds(PRIMARY.workArea));
  // header above the top of every screen (only the bottom of the window visible): not grabbable
  assert.deepEqual(W.pickSavedBounds({ x: 100, y: -560, width: 800, height: 600 }, [PRIMARY], PRIMARY.workArea), W.defaultWindowBounds(PRIMARY.workArea));
  assert.deepEqual(W.pickSavedBounds(null, ALL, RIGHT150.workArea), W.defaultWindowBounds(RIGHT150.workArea));
  assert.deepEqual(W.pickSavedBounds({ x: NaN, y: 0, width: 800, height: 600 }, ALL, PRIMARY.workArea), W.defaultWindowBounds(PRIMARY.workArea));
});

test('pickSavedBounds: clamps to the minimum size and to the work area it sits on', () => {
  const small = W.pickSavedBounds({ x: 100, y: 100, width: 300, height: 200 }, ALL, PRIMARY.workArea);
  assert.deepEqual(small, { x: 100, y: 100, width: 400, height: 400 });
  // saved on a big monitor, now shown on the 150 % one: no larger than its work area
  const big = W.pickSavedBounds({ x: 1950, y: 0, width: 2400, height: 1300 }, ALL, PRIMARY.workArea);
  assert.equal(big.width, 1707);
  assert.equal(big.height, 920);
  // only the header strip still on screen (dragged low): kept, the user can pull it back up
  const low = { x: 100, y: 960, width: 800, height: 600 };
  assert.deepEqual(W.pickSavedBounds(low, [PRIMARY], PRIMARY.workArea), low);
  assert.deepEqual(W.pickSavedBounds({ ...low, y: 1000 }, [PRIMARY], PRIMARY.workArea), W.defaultWindowBounds(PRIMARY.workArea));
});

test('planOverlayWindows: full = main display full screen + a cover on every other display', () => {
  const p = W.planOverlayWindows(ALL, 1, 'full', { x: 100, y: 100, width: 800, height: 600 });
  assert.equal(p.view, 'full');
  assert.equal(p.main.displayId, 1);
  assert.deepEqual(p.main.bounds, PRIMARY.bounds);
  assert.equal(p.main.fullscreen, true);
  assert.equal(p.main.regrab, true);
  assert.equal(p.main.skipTaskbar, true);
  assert.deepEqual(p.covers.map((c) => c.displayId), [2, 3]);
  assert.deepEqual(p.covers[0].bounds, RIGHT150.bounds);
  // unknown view → pip; single display → no covers
  assert.equal(W.planOverlayWindows([PRIMARY], 1, 'zoom').view, 'pip');
  assert.deepEqual(W.planOverlayWindows([PRIMARY], 1, 'full').covers, []);
});

test('planOverlayWindows: window = one normal window, saved bounds, no covers, no re-grab', () => {
  const saved = { x: 2100, y: 120, width: 1000, height: 700 };
  const p = W.planOverlayWindows(ALL, 1, 'window', saved);
  assert.equal(p.view, 'window');
  assert.deepEqual(p.covers, []);
  assert.deepEqual(p.main.bounds, saved);
  assert.deepEqual(
    [p.main.fullscreen, p.main.resizable, p.main.movable, p.main.minimizable, p.main.skipTaskbar, p.main.alwaysOnTop, p.main.regrab],
    [false, true, true, true, false, true, false],
  );
  // that monitor unplugged: default on the main display
  assert.deepEqual(W.planOverlayWindows([PRIMARY], 1, 'window', saved).main.bounds, W.defaultWindowBounds(PRIMARY.workArea));
  // no saved bounds: default on the main display, even when it is not the first one listed
  assert.deepEqual(W.planOverlayWindows(ALL, 2, 'window', null).main.bounds, W.defaultWindowBounds(RIGHT150.workArea));
});

test('defaultPipBounds: 400×290 in the bottom-right corner, 16 px in (DPI-scaled display too)', () => {
  assert.deepEqual(W.defaultPipBounds(PRIMARY.workArea), { x: 1920 - 400 - 16, y: 1040 - 290 - 16, width: 400, height: 290 });
  const r = W.defaultPipBounds(RIGHT150.workArea);
  assert.deepEqual(r, { x: 1920 + 1707 - 400 - 16, y: 920 - 290 - 16, width: 400, height: 290 });
  assert.ok(inside(r, RIGHT150.workArea));
  // a short work area: shrinks to fit, never below the PIP minimum
  const t = W.defaultPipBounds({ x: 0, y: 0, width: 800, height: 260 });
  assert.deepEqual([t.width, t.height], [400, 260 - 32]);
  const tiny = W.defaultPipBounds({ x: 0, y: 0, width: 250, height: 150 });
  assert.deepEqual([tiny.width, tiny.height], [W.PIP_MIN.width, W.PIP_MIN.height]);
});

test('planOverlayWindows: pip = one small window on the given display, mouse-only, kept on top, no covers', () => {
  const p = W.planOverlayWindows(ALL, 2, 'pip', null); // display 2 = the one under the cursor
  assert.equal(p.view, 'pip');
  assert.deepEqual(p.covers, []);
  assert.deepEqual(p.main.bounds, W.defaultPipBounds(RIGHT150.workArea));
  assert.deepEqual(p.main.min, W.PIP_MIN);
  assert.deepEqual(
    [p.main.fullscreen, p.main.resizable, p.main.movable, p.main.focusable, p.main.keepOnTop, p.main.alwaysOnTop, p.main.regrab, p.main.skipTaskbar],
    [false, true, true, false, true, true, false, true],
  );
  // saved PIP rectangle kept (any display); smaller than the PIP minimum → grown; unplugged → default
  const saved = { x: -1300, y: 600, width: 360, height: 520 };
  assert.deepEqual(W.planOverlayWindows(ALL, 1, 'pip', saved).main.bounds, saved);
  assert.deepEqual(W.planOverlayWindows(ALL, 1, 'pip', { ...saved, width: 200, height: 100 }).main.bounds, { ...saved, width: 280, height: 158 });
  assert.deepEqual(W.planOverlayWindows([PRIMARY], 1, 'pip', saved).main.bounds, W.defaultPipBounds(PRIMARY.workArea));
  // window and full stay focusable and are never re-asserted on top by the timer
  for (const v of ['window', 'full']) {
    const m = W.planOverlayWindows(ALL, 1, v).main;
    assert.equal(m.focusable, true, v);
    assert.equal(m.keepOnTop, false, v);
  }
});
