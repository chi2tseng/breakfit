'use strict';

const DEFAULT_SETTINGS = Object.freeze({
  start: '10:00',
  end: '21:00',
  interval: 60,
  activeWeekdays: [1, 2, 3, 4, 5], // 0 = 週日 … 6 = 週六
  demoSec: 8,
  showDemo: true, // false: the break skips every demo countdown + circuit preview (video still loops)
  theme: 'dark', // 'dark' (green accent) | 'light' (orange accent)
  notifyEmptySlots: true,
  autoLaunch: true, // SPEC 2026-09-24: default ON (registered only in packaged builds)
  cycleAnchor: null, // { date: 'YYYY-MM-DD', index: 0..3 }
  overrides: {}, // { unitId: { sets, reps: [a, b] } }
  installedDate: null,
});

function clampInt(v, lo, hi, dflt) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

function normalizeSettings(raw = {}) {
  const s = { ...DEFAULT_SETTINGS, ...raw };
  s.activeWeekdays = Array.isArray(s.activeWeekdays)
    ? [...new Set(s.activeWeekdays.map(Number).filter((d) => d >= 0 && d <= 6))].sort()
    : [...DEFAULT_SETTINGS.activeWeekdays];
  s.interval = clampInt(s.interval, 5, 600, 60);
  s.demoSec = clampInt(s.demoSec, 5, 10, 8);
  if (!/^\d{1,2}:\d{2}$/.test(s.start)) s.start = DEFAULT_SETTINGS.start;
  if (!/^\d{1,2}:\d{2}$/.test(s.end)) s.end = DEFAULT_SETTINGS.end;
  s.notifyEmptySlots = !!s.notifyEmptySlots;
  s.autoLaunch = !!s.autoLaunch;
  s.showDemo = s.showDemo == null ? DEFAULT_SETTINGS.showDemo : !!s.showDemo;
  s.theme = s.theme === 'light' ? 'light' : 'dark';
  s.overrides = s.overrides && typeof s.overrides === 'object' ? { ...s.overrides } : {};
  return s;
}

module.exports = { DEFAULT_SETTINGS, normalizeSettings };
