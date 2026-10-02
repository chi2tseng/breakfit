'use strict';
// Main-process controller: scheduler loop, break sessions, windows, tray, IPC.
const {
  app, BrowserWindow, ipcMain, screen, powerMonitor, Notification, Tray, Menu, dialog,
} = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const plan = require('../../plan.json');
const T = require('../core/time');
const D = require('../core/day');
const C = require('../core/cycle');
const S = require('../core/stats');
const PK = require('../core/pick');
const { normalizeSettings } = require('../core/settings');
const { computeSlots } = require('../core/slots');
const W = require('../core/overlay-window');
const I18N = require('../i18n');
const store = require('./store');
const { trayIcon, trayPausedIcon, windowIcon, notifyIcon } = require('./icon');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const CLIPS = path.join(ROOT, 'assets', 'clips');
const PRELOAD = path.join(__dirname, 'preload.js');
const WEB = !!app.isWeb; // the browser build (src/web): breaks always open full, it has no windows to shrink
const BG = { dark: '#000000', light: '#f5f5f7' }; // = --bg of each theme (base.css)
const STAGE_BG = { dark: '#000000', light: '#f5f5f7' }; // = --stage / --cover-bg (overlay, covers)

function createClock({ base = null, rate = 1 } = {}) {
  let b = base ? base.getTime() : Date.now();
  let t0 = Date.now();
  let r = rate;
  return {
    now: () => new Date(b + (Date.now() - t0) * r),
    set(d) { b = d.getTime(); t0 = Date.now(); },
    rate: () => r,
  };
}

// Plan text in one language (plan.json *_en fields), cached per language.
const planCache = {};
const planIn = (lang) => planCache[I18N.norm(lang)] || (planCache[I18N.norm(lang)] = I18N.localizePlan(plan, lang));
// Display name for a unit / circuit move id (day records store the 繁中 name at creation time).
function nameIn(lang, id, fallback) {
  if (id === D.STRETCH_ID) return I18N.t(lang, 'stretch');
  const lp = planIn(lang);
  for (const d of Object.values(lp.days)) {
    const u = d.units.find((x) => x.id === id);
    if (u) return u.name;
  }
  const m = Object.values(lp.circuits).flat().find((x) => x.id === id);
  return m ? m.name : fallback;
}

function planUnit(id, lang) {
  for (const d of Object.values(planIn(lang).days)) {
    const u = d.units.find((x) => x.id === id);
    if (u) return u;
  }
  return {};
}

function clipFile(clip, ext) {
  if (!clip) return null;
  const f = path.join(CLIPS, `${clip}.${ext}`);
  return fs.existsSync(f) ? pathToFileURL(f).href : null;
}
const clipUrl = (clip) => clipFile(clip, 'mp4');
const posterUrl = (clip) => clipFile(clip, 'jpg');

// End-of-day stretch list (plan.stretches ids) → moves with text in `lang` and their clips.
function stretchMoves(ids, lang) {
  const cat = planIn(lang).stretches || {};
  return (ids || []).filter((id) => cat[id]).map((id) => {
    const m = cat[id];
    return { id, name: m.name, sides: !!m.sides, clipUrl: clipUrl(m.clip), posterUrl: posterUrl(m.clip), tips: (m.tips || []).slice(0, 2) };
  });
}

function toItem(u, carried, lang) {
  if (u.type === 'stretch') {
    return {
      type: 'stretch', unitId: u.id, name: nameIn(lang, u.id, u.name), carried: false, stretches: u.stretches,
      holdSec: plan.stretchHoldSec || 30, moves: stretchMoves(u.stretches, lang),
    };
  }
  if (u.type === 'circuit') {
    return {
      type: 'circuit', unitId: u.id, name: nameIn(lang, u.id, u.name), carried, circuit: u.moves,
      moves: planIn(lang).circuits[u.moves].map((m) => ({
        id: m.id, name: m.name, sec: m.sec, clipUrl: clipUrl(m.clip), posterUrl: posterUrl(m.clip), tips: (m.tips || []).slice(0, 3),
      })),
    };
  }
  const src = planUnit(u.id, lang);
  return {
    type: 'reps', unitId: u.id, name: src.name || u.name, muscle: src.muscle || '', carried,
    setNo: u.doneSets + 1, setsLeft: u.targetSets - u.doneSets, targetSets: u.targetSets,
    target: u.target, perSide: !!src.perSide, clipUrl: clipUrl(src.clip), posterUrl: posterUrl(src.clip), tips: (src.tips || []).slice(0, 3),
  };
}

// Re-texts an already built payload in another language (switching language mid-break).
function localizeItems(items, lang) {
  for (const it of items) {
    if (it.type === 'stretch') {
      it.name = nameIn(lang, it.unitId, it.name);
      const src = stretchMoves(it.stretches, lang);
      it.moves.forEach((m, j) => { if (src[j]) { m.name = src[j].name; m.tips = src[j].tips; } });
    } else if (it.type === 'circuit') {
      it.name = nameIn(lang, it.unitId, it.name);
      const src = planIn(lang).circuits[it.circuit] || [];
      it.moves.forEach((m, j) => { if (src[j]) { m.name = src[j].name; m.tips = (src[j].tips || []).slice(0, 3); } });
    } else {
      const src = planUnit(it.unitId, lang);
      if (src.name) { it.name = src.name; it.muscle = src.muscle || ''; it.tips = (src.tips || []).slice(0, 3); }
    }
  }
  return items;
}

// planDay: today's plan day — the 拉伸 filter shows its stretches (every stretch on a rest/off day).
function library(lang, planDay) {
  const lp = planIn(lang);
  const out = [];
  for (const pd of ['d1', 'd2']) {
    for (const u of lp.days[pd].units) {
      out.push({ id: u.id, name: u.name, muscle: u.muscle, day: pd, tips: u.tips, perSide: !!u.perSide, clipUrl: clipUrl(u.clip), posterUrl: posterUrl(u.clip) });
    }
  }
  const seen = new Set();
  for (const m of lp.circuits.core) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push({ id: m.id, name: m.name, muscle: lp.days.d3.title, day: 'd3', tips: m.tips, sec: m.sec, clipUrl: clipUrl(m.clip), posterUrl: posterUrl(m.clip) });
  }
  const ids = lp.days[planDay] && lp.days[planDay].stretch
    ? lp.days[planDay].stretch
    : [...new Set(['d1', 'd2', 'd3'].flatMap((pd) => lp.days[pd].stretch || []))];
  for (const m of stretchMoves(ids, lang)) {
    out.push({ id: `stretch_${m.id}`, name: m.name, day: 'stretch', tips: m.tips, sec: plan.stretchHoldSec || 30, sides: m.sides, clipUrl: m.clipUrl, posterUrl: m.posterUrl });
  }
  return out;
}

function createController({ clock, selftest = false, fast = false }) {
  const file = path.join(app.getPath('userData'), 'data.json');
  const data = store.load(file);
  const icon = trayIcon();
  const iconPaused = trayPausedIcon();
  const winIcon = windowIcon();
  const toastIcon = notifyIcon();
  let currentBreak = null; // { mode, key, slot, sets, payload }
  let overlayWins = [];
  let overlayView = 'full'; // the open break's view: 'full' (full screen + covers) | 'window' (normal window)
  let allowOverlayClose = false;
  let mainWin = null;
  let tray = null;
  let lastKey = null;
  let quitting = false;
  let timer = null;

  // Never throws: a locked data.json (AV/OneDrive) must not break IPC handlers or leave the overlay stuck.
  let saveRetry = null;
  const save = () => {
    try {
      store.saveAtomic(file, data);
      if (saveRetry) { clearTimeout(saveRetry); saveRetry = null; }
    } catch (e) {
      console.error('save failed, retrying', e && e.code);
      if (!saveRetry) saveRetry = setTimeout(() => { saveRetry = null; save(); }, 2000);
    }
  };
  const nowInfo = () => {
    const d = clock.now();
    return { d, key: T.dateKey(d), min: T.minutesOf(d) };
  };
  const lang = () => data.settings.lang;
  const tr = (key, vars) => I18N.t(lang(), key, vars);
  const log = (day, type, detail) => day.events.push({ t: clock.now().toISOString(), type, detail });
  const regrade = (key) => {
    const day = data.days[key];
    if (day) day.status = D.gradeDay(day, key, nowInfo().key);
  };

  // Returns true on the very first run.
  function initSettings() {
    const { key, min } = nowInfo();
    const firstRun = !data.settings.installedDate;
    if (firstRun) data.settings.installedDate = key;
    if (!data.settings.cycleAnchor) {
      // Installed after today's last break (+5 min grace): start the cycle tomorrow so the install
      // day is not graded 'fail' before the user could do anything (today becomes a rest day).
      data.settings.cycleAnchor = firstRun && !data.days[key] ? D.initialAnchor(key, min, data.settings) : C.anchorFor(key, 0);
    }
    save();
    return firstRun;
  }

  // Creates today's record on first sight; on date change, grades every past day.
  function ensureToday() {
    const { key } = nowInfo();
    let changed = false;
    if (key !== lastKey) {
      // freeze past dates the app never ran on (graded once, with the settings in force now)
      if (D.fillMissedDays(data.days, data.settings, plan, key).length) changed = true;
      for (const [k, day] of Object.entries(data.days)) {
        const st = D.gradeDay(day, k, key);
        if (st !== day.status) { day.status = st; changed = true; }
      }
      lastKey = key;
    }
    if (!data.days[key]) {
      data.days[key] = D.createDay(key, data.settings, plan, nowInfo().min);
      changed = true;
    }
    if (changed) save();
    return data.days[key];
  }

  function nextBreak(day, key) {
    const k = D.nextSlotIndex(day);
    if (k < 0 || day.status !== 'pending') return null;
    const t = day.slots[k].time;
    return { index: k, time: t, at: T.toDate(key, T.parseHM(t)).toISOString(), isLast: k === D.lastSlot(day) };
  }

  // 今天 hero: the first stop ahead that owes sets (a stop that owes nothing only says "walk").
  function upNext(day, key) {
    if (day.status !== 'pending' || day.paused) return null;
    for (let k = Math.max(0, D.nextSlotIndex(day)); k < day.slots.length; k++) {
      if (day.slots[k].status !== 'pending') continue;
      const pend = D.pendingUnits(day, k);
      if (!pend.length) continue;
      const t = day.slots[k].time;
      return {
        index: k, time: t, at: T.toDate(key, T.parseHM(t)).toISOString(), isLast: k === D.lastSlot(day),
        items: pend.map((p) => toItem(p.unit, p.carried, lang())),
      };
    }
    return null;
  }

  // Rest day / done / over: the next training day, its first stop and its first move (for the hero clip).
  function nextTraining(key) {
    const lp = planIn(lang());
    for (let i = 1; i <= 14; i++) {
      const k = T.addDays(key, i);
      const pd = C.planDayFor(k, data.settings, plan.cycle);
      if (!lp.days[pd]) continue;
      const it = toItem(D.buildUnits(plan, pd, data.settings.overrides)[0], false, lang());
      const mv = it.type === 'reps' ? it : it.moves[0];
      return {
        key: k, tomorrow: i === 1, planDay: pd, label: lp.days[pd].label, title: lp.days[pd].title, time: computeSlots(data.settings)[0],
        name: mv.name, clipUrl: mv.clipUrl, posterUrl: mv.posterUrl, item: it,
      };
    }
    return null;
  }

  function buildPayload(key, day, mode, slot = null) {
    const pd = planIn(lang()).days[day.planDay];
    let k = slot;
    if (mode !== 'slot') {
      const n = D.nextSlotIndex(day);
      k = n < 0 ? Infinity : n;
    }
    let pend = day.units.length ? D.pendingUnits(day, k) : [];
    if (mode === 'test' && !pend.length) {
      pend = [{ unit: D.buildUnits(plan, 'd1', data.settings.overrides)[0], carried: false }];
    }
    const items = pend.map((p) => toItem(p.unit, p.carried, lang()));
    const nextIdx = day.slots.findIndex((s, j) => s.status === 'pending' && (mode !== 'slot' || j > slot));
    return {
      mode,
      lang: lang(),
      planDay: pd ? day.planDay : 'd1',
      isLast: mode === 'slot' && slot === D.lastSlot(day),
      slotTime: mode === 'slot' && day.slots[slot] ? day.slots[slot].time : T.fmtHM(Math.floor(T.minutesOf(clock.now()))),
      dayLabel: (pd || planIn(lang()).days.d1).label,
      dayTitle: (pd || planIn(lang()).days.d1).title,
      items,
      demoSec: data.settings.demoSec,
      showDemo: data.settings.showDemo,
      setRestSec: plan.setRestSec,
      roundRestSec: plan.days.d3.roundRestSec || 180,
      todayDone: D.doneSets(day),
      todayTotal: D.totalSets(day),
      stretchOwed: D.stretchDone(day) === false, // the day still owes its stretch (this break or a later one)
      nextBreak: nextIdx >= 0 ? day.slots[nextIdx].time : null,
      selftest,
    };
  }

  // 完整訓練 chooser default: today's plan day; rest / off day → the next training day.
  function sessionDefault(day, key) {
    if (plan.days[day.planDay]) return day.planDay;
    const nt = nextTraining(key);
    return nt ? nt.planDay : 'd1';
  }

  // 完整訓練 chooser: every move as a row (name, sets × reps, its own length), the day presets, the
  // default and today's remembered custom pick; the footer sums rows + rests (PK.estimatePick).
  function sessionChooser(day, key, lp) {
    const s = data.settings;
    const rows = PK.catalog(plan).map((r) => {
      const one = PK.buildSession(plan, day, [r.key], s);
      const u = one.units[0];
      let name;
      let meta;
      if (r.type === 'stretch') {
        const st = lp.stretches[r.id];
        name = st.name;
        meta = tr(st.sides ? 'perSideSecs' : 'secs', { n: plan.stretchHoldSec || 30 });
      } else if (r.type === 'circuit') {
        name = nameIn(lang(), r.id, u.name);
        meta = tr('timedMeta', { n: plan.circuits[u.moves].length, s: plan.circuits[u.moves][0].sec });
      } else {
        const left = u.targetSets - u.doneSets;
        name = nameIn(lang(), r.id, u.name);
        meta = `${tr(left === 1 ? 'setsN1' : 'setsN', { n: left })} × ${tr('repsN', { r: `${u.target[0]}–${u.target[1]}` })}`;
      }
      return { key: r.key, day: r.day, type: r.type, name, meta, sec: D.estimateSec(plan, one.units, s) };
    });
    const last = day.pick ? PK.ordered(plan, day.pick).map((r) => r.key) : [];
    const mine = day.units.find(D.isStretch);
    return {
      // keys that would count toward today (the stretch only as a whole)
      own: {
        units: day.units.filter((u) => !D.isStretch(u) && u.doneSets < u.targetSets).map((u) => u.id),
        stretches: mine && mine.doneSets < mine.targetSets ? mine.stretches.map(PK.stretchKey) : [],
      },
      def: sessionDefault(day, key),
      today: plan.days[day.planDay] ? day.planDay : null,
      presets: Object.fromEntries([...PK.DAYS, 'stretch'].map((pd) => [pd, PK.presetKeys(plan, day, pd)])),
      last: last.length ? last : null,
      titles: Object.fromEntries(PK.DAYS.map((pd) => [pd, lp.days[pd].title])),
      rows,
      restSec: plan.setRestSec,
      roundRestSec: plan.days.d3.roundRestSec || 180,
    };
  }

  // Full workout of a selection (src/core/pick.js): a plan day ('d1'…'d3', 'stretch' = a preset) or
  // a list of picked keys. Moves today still owes count toward today (remaining sets only); the rest
  // is 加練. A whole day's preset keeps that day's name; any other pick is 自選.
  function makeSession(day, sel) {
    const keys = Array.isArray(sel) ? sel.map(String) : PK.presetKeys(plan, day, String(sel));
    const sess = PK.buildSession(plan, day, keys, data.settings);
    if (!sess) return null;
    const lp = planIn(lang());
    const pd = PK.DAYS.find((d) => PK.sameKeys(sess.keys, PK.presetKeys(plan, day, d)));
    const days = PK.DAYS.filter((d) => PK.ordered(plan, sess.keys).some((r) => r.day === d));
    const units = sess.units;
    const own = !sess.extra;
    const trainSets = units.reduce((a, u) => a + (D.isStretch(u) ? 0 : u.targetSets - u.doneSets), 0);
    const onlyStretch = units.every(D.isStretch);
    const payload = {
      mode: 'session',
      extra: sess.extra,
      // a mixed pick: units whose sets are 加練, not today's (the finish screen counts only today's)
      ...(own && sess.extraIds.length ? { extraUnits: sess.extraIds } : {}),
      lang: lang(),
      planDay: pd || days[0] || day.planDay,
      isLast: false,
      slotTime: T.fmtHM(Math.floor(T.minutesOf(clock.now()))),
      dayLabel: pd ? lp.days[pd].label : days.map((d) => lp.days[d].label).join(lang() === 'en' ? ', ' : '、'),
      dayTitle: pd ? lp.days[pd].title : tr(onlyStretch ? 'stretch' : 'customWorkout'),
      items: units.map((u) => toItem(u, false, lang())),
      demoSec: data.settings.demoSec,
      showDemo: data.settings.showDemo,
      setRestSec: plan.setRestSec,
      roundRestSec: plan.days.d3.roundRestSec || 180,
      // today's progress when the session counts toward today; the session's own sets for an extra one
      todayDone: own ? D.doneSets(day) : 0,
      todayTotal: own ? D.totalSets(day) : trainSets,
      stretchOwed: own ? D.stretchDone(day) === false : units.some(D.isStretch),
      estSec: D.estimateSec(plan, units, data.settings),
      nextBreak: null,
      selftest,
    };
    return { sess, payload, planDay: payload.planDay, preset: !!pd || PK.sameKeys(sess.keys, PK.presetKeys(plan, day, 'stretch')) };
  }
  function buildSessionPayload(key, day, sel) {
    const m = makeSession(day, sel);
    return m ? m.payload : null;
  }

  function openSession(sel) {
    if (currentBreak) { focusOverlay(); return false; }
    const { key } = nowInfo();
    const day = ensureToday();
    const m = makeSession(day, sel);
    if (!m) return false;
    const { sess, payload } = m;
    // remember a custom pick for the rest of the day (the chooser opens on it)
    if (m.preset) delete day.pick;
    else day.pick = sess.keys;
    currentBreak = {
      mode: 'session', key, slot: null, sets: 0, payload, extra: sess.extra, planDay: m.planDay, startedAt: clock.now().getTime(), stretch: false,
      sess, tally: { sets: 0, xsets: 0, stretch: false },
    };
    log(day, 'session_start', { planDay: m.planDay, extra: sess.extra, units: payload.items.map((i) => i.unitId), keys: sess.keys });
    save();
    showOverlay();
    changed();
    return true;
  }

  // "現在就休息" has something to do: pending(next slot) — the stretch only when that is the last slot.
  function canBreakNow(day) {
    if (currentBreak || day.status !== 'pending') return false;
    const n = D.nextSlotIndex(day);
    return D.pendingUnits(day, n < 0 ? Infinity : n).length > 0;
  }

  // ---------- scheduler ----------
  function check({ startup = false } = {}) {
    const day = ensureToday();
    if (currentBreak) return;
    const { key, min } = nowInfo();
    const r = D.planCheck(day, min, { startup, notifyEmptySlots: data.settings.notifyEmptySlots });
    const marked = Object.keys(r.marks).length > 0;
    if (marked) {
      D.applyMarks(day, r.marks);
      regrade(key);
      save();
    }
    if (r.notify && !selftest && Notification.isSupported()) {
      new Notification({ title: tr('walkNotify'), body: '', icon: toastIcon }).show();
    }
    if (r.open !== null) openBreak('slot', r.open);
    else if (marked) changed();
    else updateTray(); // tooltip countdown only
  }

  function openBreak(mode, slot = null, payloadOverride = null) {
    if (currentBreak) {
      focusOverlay();
      return false;
    }
    const { key } = nowInfo();
    const day = ensureToday();
    const payload = payloadOverride || buildPayload(key, day, mode, slot);
    if (!payload.items.length) return false;
    currentBreak = { mode, key, slot, sets: 0, payload };
    if (mode === 'slot' || mode === 'manual') {
      log(day, mode === 'manual' ? 'manual' : 'break_start', { slot, units: payload.items.map((i) => i.unitId) });
      save();
    }
    showOverlay();
    changed();
    return true;
  }

  function endBreak(outcome) {
    if (!currentBreak) return null;
    const b = currentBreak;
    currentBreak = null;
    let status = null;
    try {
      if (b.mode === 'session') {
        const day = data.days[b.key];
        const { min } = nowInfo();
        const sec = (clock.now().getTime() - b.startedAt) / 1000;
        PK.logExtra(day, b.sess, b.tally, clock.now().toISOString(), sec); // the 加練 part (if any)
        if (!b.extra) D.endBreak(day, null, outcome, b.sets);
        log(day, 'session_end', { planDay: b.planDay, extra: b.extra, outcome, sets: b.sets, sec: Math.round(sec) });
        // stops that came due during the session were never opened: handle them (the last one still opens)
        if (b.key === nowInfo().key) D.absorbDueSlots(day, min);
        regrade(b.key);
        status = day.status;
        save();
      } else if (b.mode === 'slot' || b.mode === 'manual') {
        const day = data.days[b.key];
        D.endBreak(day, b.mode === 'slot' ? b.slot : null, outcome, b.sets);
        const type = outcome === 'skip' ? 'skip' : outcome === 'abort' ? 'abort' : 'break_end';
        log(day, type, { slot: b.slot, mode: b.mode, sets: b.sets });
        regrade(b.key);
        status = day.status;
        save();
      }
    } finally {
      closeOverlay();
      changed();
    }
    if (!selftest) setTimeout(() => check(), 1500);
    return status;
  }

  function pauseToday() {
    const { key } = nowInfo();
    const day = ensureToday();
    D.pauseDay(day);
    log(day, 'skip', { pause: true });
    regrade(key);
    save();
    changed();
  }

  // Timed pause (minutes) or cancel (null). Slots due meanwhile become missed; the last slot still opens.
  function pauseFor(minutes) {
    const { min } = nowInfo();
    const day = ensureToday();
    D.pauseUntil(day, minutes == null ? null : Math.ceil(min + minutes));
    log(day, 'pause', { until: day.pausedUntil == null ? null : T.fmtHM(day.pausedUntil) });
    save();
    changed();
  }
  const pausedNow = (day) => Number.isFinite(day.pausedUntil) && nowInfo().min < day.pausedUntil;

  // ---------- windows ----------
  // Theme: windows load with ?theme= (theme.js applies it before first paint); a change is pushed
  // live to every open window (main, overlay, covers).
  const themeQuery = () => ({ query: { theme: data.settings.theme, lang: lang() } });
  function applyTheme() {
    const t = data.settings.theme;
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue;
      w.setBackgroundColor((w === mainWin ? BG : STAGE_BG)[t]);
      w.webContents.send('theme', t);
    }
  }
  // Language: same path as the theme. An open break keeps its progress; only its text changes.
  function applyLang() {
    if (currentBreak) {
      const p = currentBreak.payload;
      const pd = planIn(lang()).days[p.planDay] || planIn(lang()).days.d1;
      Object.assign(p, { lang: lang(), dayLabel: pd.label, dayTitle: pd.title });
      localizeItems(p.items, lang());
    }
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('lang', lang());
  }

  const overlayCommon = () => ({
    frame: false,
    backgroundColor: STAGE_BG[data.settings.theme],
    show: false,
    skipTaskbar: true,
    icon: winIcon,
    webPreferences: { preload: PRELOAD, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  // selftest windows: hidden, never focusable, never full screen or on top (1280×720 at 0,0; a windowed
  // or PIP break gets its planned rectangle, still hidden, so the selftest can check where it would go)
  const hiddenTest = { focusable: false, paintWhenInitiallyHidden: true };
  function coverOptions(bounds) {
    if (selftest) return { ...overlayCommon(), width: 1280, height: 720, x: 0, y: 0, ...hiddenTest };
    return {
      ...overlayCommon(), ...bounds,
      fullscreen: true, resizable: false, movable: false, minimizable: false, maximizable: false, alwaysOnTop: true, focusable: false,
    };
  }
  // m = planOverlayWindows(...).main: rectangle + the view's flags (src/core/overlay-window.js).
  // maximizable stays false (no Aero Snap); fullscreenable stays true (the full view needs it).
  function mainOverlayOptions(m) {
    const flags = { resizable: m.resizable, movable: m.movable, minimizable: m.minimizable, maximizable: false };
    if (selftest) {
      const rect = m.fullscreen ? { width: 1280, height: 720, x: 0, y: 0 } : m.bounds;
      return { ...overlayCommon(), ...rect, ...flags, ...hiddenTest };
    }
    return {
      ...overlayCommon(), ...m.bounds, ...flags,
      ...(m.min ? { minWidth: m.min.width, minHeight: m.min.height } : {}),
      fullscreen: m.fullscreen, skipTaskbar: m.skipTaskbar, alwaysOnTop: m.alwaysOnTop, focusable: m.focusable,
    };
  }
  const mainOverlay = () => overlayWins.find((x) => x.isMainOverlay && !x.isDestroyed());
  const BOUNDS_KEY = { window: 'windowBounds', pip: 'pipBounds' };

  // The window / PIP rectangle is a setting (data.json), so it survives restarts.
  function storeBounds(win, view) {
    const key = BOUNDS_KEY[view];
    if (!key || win.isDestroyed() || win.isMinimized() || win.isFullScreen() || win.isMaximized()) return;
    const b = win.getBounds();
    const o = data.settings[key];
    if (o && o.x === b.x && o.y === b.y && o.width === b.width && o.height === b.height) return;
    data.settings[key] = { x: b.x, y: b.y, width: b.width, height: b.height };
    save();
  }

  // PIP stays above a video playing underneath: re-assert always-on-top every ~1.7 s, never focusing.
  // It also shows its window buttons while the cursor is over it: almost all of it is a drag region,
  // which gets no mouse events, so the cursor is polled here (5×/s) and the page told on enter / leave.
  function keepOnTop(win) {
    clearInterval(win.bfTopTimer);
    clearInterval(win.bfHoverTimer);
    win.bfTopTimer = null;
    win.bfHoverTimer = null;
    if (selftest || !win.bfView.keepOnTop) return;
    win.bfTopTimer = setInterval(() => {
      if (win.isDestroyed()) return;
      win.setAlwaysOnTop(true, 'screen-saver');
      win.moveTop();
    }, 1700);
    let inside = null;
    win.bfHoverTimer = setInterval(() => {
      if (win.isDestroyed()) return;
      const c = screen.getCursorScreenPoint();
      const r = win.getBounds();
      const now = c.x >= r.x && c.x < r.x + r.width && c.y >= r.y && c.y < r.y + r.height;
      if (now !== inside) { inside = now; win.webContents.send('pip-hover', now); }
    }, 200);
  }
  // PIP opens on the display under the cursor (the screen the user is working on).
  const pipDisplay = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const planFor = (view, mainDisplayId, displays) => W.planOverlayWindows(displays, mainDisplayId, view, data.settings[BOUNDS_KEY[view]] || null);

  // Every break opens in the saved view (settings.breakView): PIP (small, on top, mouse-only), one
  // normal window, or full screen with a cover on every other display.
  function showOverlay() {
    allowOverlayClose = false;
    const primary = screen.getPrimaryDisplay();
    const displays = selftest ? [primary] : screen.getAllDisplays();
    const view = WEB ? 'full' : W.normView(data.settings.breakView);
    const p = planFor(view, view === 'pip' && !selftest ? pipDisplay().id : primary.id, displays);
    overlayView = p.view;
    const win = new BrowserWindow(mainOverlayOptions(p.main));
    win.removeMenu();
    win.isMainOverlay = true;
    win.bfView = p.main; // the flags in force (the selftest reads them)
    win.on('close', (e) => {
      if (allowOverlayClose || quitting) return;
      e.preventDefault();
      // window / PIP: Alt+F4 / the taskbar's Close = 離開, which asks first (like Esc)
      if (currentBreak && overlayView !== 'full' && !win.isDestroyed()) {
        if (!selftest) {
          if (win.isMinimized()) win.restore();
          if (win.bfView.focusable) { win.show(); win.focus(); } else win.showInactive();
        }
        win.webContents.send('ask-leave');
      }
    });
    let boundsTimer = null;
    const remember = () => {
      clearTimeout(boundsTimer);
      boundsTimer = setTimeout(() => { if (currentBreak) storeBounds(win, overlayView); }, 500);
    };
    win.on('resize', remember);
    win.on('move', remember);
    win.on('closed', () => { clearInterval(win.bfTopTimer); clearInterval(win.bfHoverTimer); });
    if (!selftest) {
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true);
      win.once('ready-to-show', () => {
        if (win.bfView.focusable) { win.show(); win.focus(); } else win.showInactive(); // PIP never takes the keyboard
      });
      win.on('blur', () => setTimeout(() => {
        if (currentBreak && !win.isDestroyed() && win.bfView.regrab) { win.moveTop(); win.focus(); }
      }, 400));
    }
    keepOnTop(win);
    win.loadFile(path.join(RENDERER, 'overlay.html'), { query: { ...themeQuery().query, view: overlayView } });
    overlayWins.push(win);
    for (const c of p.covers) makeCover(c.bounds);
  }

  function focusOverlay() {
    const w = mainOverlay();
    if (!w || selftest) return;
    if (w.isMinimized()) w.restore();
    if (w.bfView.focusable) { w.show(); w.focus(); } else { w.showInactive(); w.moveTop(); }
  }

  // A cover window darkens one of the other displays while the break is full screen.
  function makeCover(bounds) {
    const win = new BrowserWindow(coverOptions(bounds));
    win.removeMenu();
    win.on('close', (e) => { if (!allowOverlayClose && !quitting) e.preventDefault(); });
    if (!selftest) {
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true);
      win.once('ready-to-show', () => win.show());
    }
    win.loadFile(path.join(RENDERER, 'cover.html'), themeQuery());
    win.isMainOverlay = false;
    overlayWins.push(win);
  }

  // PIP ⇄ window ⇄ full screen, live (overlay buttons / F key / tray). Same BrowserWindow throughout, so
  // the page keeps its phase, timers and sets. The choice is saved: the next break opens the same way.
  function setOverlayView(view) {
    const win = mainOverlay();
    const v = W.normView(view);
    if (!win || !currentBreak || WEB) return overlayView;
    if (data.settings.breakView !== v) { data.settings.breakView = v; save(); changed(); }
    if (overlayView === v) return overlayView;
    storeBounds(win, overlayView); // leaving a window / PIP: keep where it was (the debounce may not have fired)
    overlayView = v;
    const disp = selftest ? screen.getPrimaryDisplay() : screen.getDisplayMatching(win.getBounds());
    const p = planFor(v, disp.id, selftest ? [disp] : screen.getAllDisplays());
    const m = p.main;
    win.bfView = m;
    // safe on a hidden selftest window too; everything that shows / moves / focuses a window is skipped there
    win.setResizable(m.resizable);
    win.setMovable(m.movable);
    win.setMinimizable(m.minimizable);
    keepOnTop(win);
    if (!selftest) {
      win.setFocusable(m.focusable);
      if (v !== 'full') {
        for (const w of overlayWins.slice()) if (w !== win && !w.isDestroyed()) w.destroy();
        overlayWins = [win];
        win.setSkipTaskbar(m.skipTaskbar); // a minimized window must be findable in the taskbar; PIP is not in it
        win.setMinimumSize(m.min.width, m.min.height);
        const place = () => {
          if (win.isDestroyed() || overlayView !== v) return;
          if (win.isMinimized()) win.restore();
          win.setBounds(m.bounds);
          if (m.focusable) { win.show(); win.focus(); } else { win.showInactive(); win.moveTop(); }
        };
        if (win.isFullScreen()) {
          win.once('leave-full-screen', place);
          win.setFullScreen(false);
          setTimeout(place, 400); // in case the event never comes; placing twice is harmless
        } else place();
      } else {
        if (win.isMinimized()) win.restore();
        win.setMinimumSize(0, 0);
        win.setFullScreen(true);
        win.setSkipTaskbar(m.skipTaskbar);
        for (const c of p.covers) makeCover(c.bounds);
        win.show();
        win.focus();
      }
    }
    win.webContents.send('view', v);
    return overlayView;
  }

  // 休息顯示 from the tray or settings while no break is open: just the setting; during a break: live.
  function setBreakView(v) {
    if (currentBreak && mainOverlay()) return setOverlayView(v);
    data.settings.breakView = W.normView(v);
    save();
    changed();
    return data.settings.breakView;
  }

  function closeOverlay() {
    const main = mainOverlay();
    if (main) { storeBounds(main, overlayView); clearInterval(main.bfTopTimer); }
    allowOverlayClose = true;
    for (const w of overlayWins) if (!w.isDestroyed()) w.destroy();
    overlayWins = [];
  }

  function openCoverForTest() {
    const win = new BrowserWindow(coverOptions(screen.getPrimaryDisplay().bounds));
    win.loadFile(path.join(RENDERER, 'cover.html'), themeQuery());
    return win;
  }

  function openMain(tab = null) {
    if (mainWin && !mainWin.isDestroyed()) {
      if (tab) mainWin.webContents.send('nav:tab', tab);
      if (!selftest) { mainWin.show(); mainWin.focus(); }
      return mainWin;
    }
    const wa = screen.getPrimaryDisplay().workAreaSize;
    mainWin = new BrowserWindow({
      // content size (CSS px). Default fits a 1366×768 screen (work area ≈ 1366×728 incl. frame);
      // minimum = the smallest size the size-matrix lint passes at (DESIGN.md §5).
      useContentSize: true,
      width: selftest ? 1280 : Math.min(1180, wa.width - 80),
      height: selftest ? 800 : Math.min(760, wa.height - 60),
      minWidth: 800,
      minHeight: 600,
      title: 'BreakFit',
      icon: winIcon,
      backgroundColor: BG[data.settings.theme],
      autoHideMenuBar: true,
      show: false,
      paintWhenInitiallyHidden: true,
      webPreferences: { preload: PRELOAD, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
    });
    mainWin.removeMenu();
    mainWin.on('close', (e) => {
      if (!quitting && !selftest) { e.preventDefault(); mainWin.hide(); }
    });
    mainWin.on('closed', () => { mainWin = null; });
    if (!selftest) mainWin.once('ready-to-show', () => mainWin.show());
    if (tab) mainWin.webContents.once('did-finish-load', () => mainWin.webContents.send('nav:tab', tab));
    mainWin.loadFile(path.join(RENDERER, 'main.html'), themeQuery());
    return mainWin;
  }

  // ---------- state for main window / tray ----------
  function getState() {
    const { d, key } = nowInfo();
    const day = ensureToday();
    const history = S.buildHistory(data.days, data.settings, plan, key);
    history[key] = S.summarizeDay(key, day, key);
    const monthSets = {};
    for (const h of Object.values(history)) {
      const m = h.date.slice(0, 7);
      monthSets[m] = (monthSets[m] || 0) + h.done;
    }
    const lp = planIn(lang());
    const pd = lp.days[day.planDay];
    return {
      now: d.toISOString(),
      rate: clock.rate(),
      today: key,
      day,
      dayLabel: pd ? pd.label : null,
      dayTitle: pd ? pd.title : null,
      after: pd ? pd.after : '',
      slotsView: day.slots.map((s, k) => ({
        time: s.time,
        status: s.status,
        isLast: k === D.lastSlot(day),
        units: day.units.filter((u) => u.slot === k).map((u) => ({ name: nameIn(lang(), u.id, u.name), done: u.doneSets, target: u.targetSets, stretch: D.isStretch(u) })),
        // the last stop also owes sets carried from earlier stops (shown as 補做 next to 拉伸)
        catchUp: k === D.lastSlot(day) && day.units.some((u) => !D.isStretch(u) && u.slot < k && u.doneSets < u.targetSets),
        // sets actually done in this stop's break (it may have done sets carried from earlier stops)
        sets: (day.events || []).filter((e) => (e.type === 'break_end' || e.type === 'abort') && e.detail && e.detail.mode === 'slot' && e.detail.slot === k)
          .reduce((n, e) => n + (e.detail.sets || 0), 0),
      })),
      next: nextBreak(day, key),
      upNext: upNext(day, key),
      nextTraining: nextTraining(key),
      done: D.doneSets(day),
      total: D.totalSets(day),
      canBreakNow: canBreakNow(day),
      session: sessionChooser(day, key, lp),
      breakActive: !!currentBreak,
      history,
      stats: S.computeStats(history, key.slice(0, 7)),
      monthSets,
      recent: S.recentTraining(history, 30),
      settings: data.settings,
      plan: lp,
      library: library(lang(), day.planDay),
      loginItem: selftest ? false : app.getLoginItemSettings().openAtLogin,
      selftest,
      fast,
    };
  }

  function dayDetail(key) {
    const day = data.days[key];
    const today = nowInfo().key;
    const history = S.buildHistory(data.days, data.settings, plan, today);
    const summary = day ? S.summarizeDay(key, day, today) : history[key] || null;
    const pdKey = day ? day.planDay : summary ? summary.planDay : null;
    const lp = planIn(lang());
    return {
      date: key,
      summary,
      day: day ? { ...day, units: day.units.map((u) => ({ ...u, name: nameIn(lang(), u.id, u.name) })) } : null,
      title: pdKey && lp.days[pdKey] ? lp.days[pdKey].title : null,
      implied: !day || !!day.implied,
      impliedUnits: !day && pdKey && lp.days[pdKey] ? D.buildUnits(lp, pdKey, data.settings.overrides).map((u) => ({ ...u, name: nameIn(lang(), u.id, u.name) })) : [],
    };
  }

  // Tray tooltip: one fact per line (no ASCII '·' / '+' in CJK text, DESIGN.md §6).
  function trayText(st) {
    const lines = (...l) => ['BreakFit', ...l.filter(Boolean)].join('\n');
    const sets = tr('traySets', { a: st.done, b: st.total });
    if (st.day.planDay === 'off') return lines(tr('noTraining'));
    if (st.day.planDay === 'rest') return lines(tr('restToday'));
    if (st.day.paused) return lines(sets, tr('pausedToday'));
    if (st.day.status === 'pass') return lines(sets, tr('completed'));
    if (st.day.status === 'fail') return lines(sets, tr('failed'));
    if (st.paused) return lines(tr('pausedUntil', { t: T.fmtHM(st.day.pausedUntil) }));
    return lines(sets, st.next ? tr('trayNext', { t: st.next.time }) : '');
  }

  const DAY_LABEL = { rest: 'restDay', off: 'noTraining' };
  const VIEW_LABEL = { pip: 'viewPipMenu', window: 'viewWindow', full: 'viewFull' }; // tray: the long PIP name

  function updateTray() {
    if (!tray) return;
    const { tip, paused, template } = trayModel();
    tray.setToolTip(tip);
    tray.setImage(paused ? iconPaused : icon);
    tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  // Tray tooltip + menu template (plain data, so the selftest can read every label).
  function trayModel() {
    const day = ensureToday();
    const lp = planIn(lang());
    const training = !!lp.days[day.planDay];
    const done = D.doneSets(day);
    const total = D.totalSets(day);
    const paused = pausedNow(day);
    const st = { day, done, total, paused, next: nextBreak(day, nowInfo().key) };
    const pending = training && day.status === 'pending' && !currentBreak;
    const pauseItems = [
      { label: tr('m30'), enabled: pending, click: () => pauseFor(30) },
      { label: tr('h1'), enabled: pending, click: () => pauseFor(60) },
      { label: tr('h2'), enabled: pending, click: () => pauseFor(120) },
      { label: tr('tillTomorrow'), enabled: pending, click: confirmPause },
    ];
    if (paused) pauseItems.push({ type: 'separator' }, { label: tr('cancelPause'), click: () => pauseFor(null) });
    const sep = lang() === 'en' ? ': ' : '　'; // "Day 1: Chest & Triceps" / 「第 1 天　胸與三頭」, never a '·'
    const template = [
      { label: training ? `${lp.days[day.planDay].label}${sep}${lp.days[day.planDay].title}` : DAY_LABEL[day.planDay] ? tr(DAY_LABEL[day.planDay]) : 'BreakFit', enabled: false },
      ...(training ? [{ label: tr('traySets', { a: done, b: total }), enabled: false }] : []),
      { label: st.next ? tr('trayNextBreak', { t: st.next.time }) : tr('noMoreBreaks'), enabled: false },
      { type: 'separator' },
      { label: tr('breakNow'), enabled: canBreakNow(day), click: () => openBreak('manual') },
      { label: tr('fullWorkoutMenu'), enabled: !currentBreak, click: () => openMain('workout') },
      { label: paused ? tr('pauseRemindersUntil', { t: T.fmtHM(day.pausedUntil) }) : tr('pauseReminders'), submenu: pauseItems },
      {
        label: tr('breakView'),
        submenu: W.VIEWS.map((v) => ({ label: tr(VIEW_LABEL[v]), type: 'radio', checked: (currentBreak ? overlayView : data.settings.breakView) === v, click: () => setBreakView(v) })),
      },
      { type: 'separator' },
      { label: tr('openMain'), click: () => openMain('today') },
      { label: tr('navHistory'), click: () => openMain('history') },
      { label: tr('navSettings'), click: () => openMain('settings') },
      {
        label: tr('launchAtLoginMenu'), type: 'checkbox', checked: !!data.settings.autoLaunch,
        click: (item) => { data.settings.autoLaunch = item.checked; applyLoginItem(item.checked); save(); changed(); },
      },
      { type: 'separator' },
      { label: tr('quit'), click: () => { quitting = true; app.quit(); } },
    ];
    return { tip: trayText(st), paused: paused || day.paused, template };
  }

  async function confirmPause() {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: 'BreakFit',
      message: tr('pauseQ'),
      detail: tr('pauseDetail'),
      buttons: [tr('pauseOk'), tr('cancel')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (response === 0) pauseToday();
  }

  function changed() {
    updateTray();
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('state:changed');
  }

  // Only packaged builds register (SPEC: never put electron.exe into startup in dev mode).
  function applyLoginItem(on) {
    if (!app.isPackaged || selftest) return;
    app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath, args: ['--hidden'] });
  }

  // ---------- IPC ----------
  function registerIpc() {
    ipcMain.handle('state:get', () => getState());
    ipcMain.handle('day:get', (_e, key) => dayDetail(key));
    ipcMain.handle('day:note', (_e, { date, note }) => {
      const day = data.days[date];
      if (!day) return false;
      day.note = String(note || '').slice(0, 2000);
      save();
      return true;
    });
    ipcMain.handle('settings:save', (_e, patch) => {
      const { key, min } = nowInfo();
      const prev = data.settings;
      data.settings = normalizeSettings({ ...prev, ...patch });
      // New weekdays apply from tomorrow on: re-anchor so today and the past keep their cycle position.
      if ('activeWeekdays' in patch && !('cycleAnchor' in patch)
        && data.settings.activeWeekdays.join() !== prev.activeWeekdays.join()) {
        data.settings.cycleAnchor = C.reanchorForWeekdays(key, prev);
      }
      if ('autoLaunch' in patch) applyLoginItem(data.settings.autoLaunch);
      if ('theme' in patch && data.settings.theme !== prev.theme) applyTheme();
      if ('lang' in patch && data.settings.lang !== prev.lang) applyLang();
      if ('breakView' in patch && currentBreak) setOverlayView(data.settings.breakView); // an open break follows live
      const sched = ['start', 'end', 'interval'];
      if (sched.some((k) => k in patch) && !currentBreak) {
        D.rebuildDay(ensureToday(), key, data.settings, plan, min);
      }
      save();
      changed();
      return data.settings;
    });
    ipcMain.handle('cycle:today', (_e, index) => {
      const { key, min } = nowInfo();
      data.settings.cycleAnchor = C.anchorFor(key, Number(index) || 0);
      if (!currentBreak) D.rebuildDay(ensureToday(), key, data.settings, plan, min, { replan: true });
      save();
      changed();
      return true;
    });
    ipcMain.handle('break:now', () => openBreak('manual'));
    ipcMain.handle('break:test', () => openBreak('test'));
    // a plan day (preset) or the chooser's picked keys
    ipcMain.handle('session:start', (_e, sel) => openSession(Array.isArray(sel) ? sel : String(sel)));
    ipcMain.handle('break:payload', () => (currentBreak ? currentBreak.payload : null));
    // no argument = the F key: full screen ⇄ window
    ipcMain.handle('break:view', (_e, v) => setOverlayView(v || (overlayView === 'window' ? 'full' : 'window')));
    ipcMain.handle('break:minimize', () => {
      const w = mainOverlay();
      if (w && overlayView === 'window' && !selftest) w.minimize();
      return true;
    });
    ipcMain.handle('break:set', (_e, { unitId, reps }) => {
      if (!currentBreak) return -1;
      const b = currentBreak;
      if (b.mode === 'session') {
        // today's moves are recorded into the day; 加練 ones only counted for the log (pick.js)
        const day = data.days[b.key];
        const idx = PK.recordPicked(day, b.sess, b.tally, unitId, reps);
        b.sets = b.tally.sets;
        if (!b.sess.ownIds.includes(unitId)) return -1;
        log(day, 'set_done', { unitId, reps });
        regrade(b.key);
        save();
        changed();
        return idx;
      }
      currentBreak.sets += 1;
      if (currentBreak.mode === 'test') return currentBreak.sets - 1;
      const day = data.days[currentBreak.key];
      const idx = D.recordSet(day, unitId, reps);
      log(day, 'set_done', { unitId, reps });
      regrade(currentBreak.key);
      save();
      changed();
      return idx;
    });
    ipcMain.handle('break:reps', (_e, { unitId, index, reps }) => {
      if (!currentBreak || currentBreak.mode === 'test' || (currentBreak.sess && !currentBreak.sess.ownIds.includes(unitId))) return false;
      const ok = D.setReps(data.days[currentBreak.key], unitId, index, reps);
      if (ok) save();
      return ok;
    });
    ipcMain.handle('break:end', (_e, { outcome }) => endBreak(outcome));
  }

  // ---------- lifecycle ----------
  function createTray() {
    tray = new Tray(icon);
    tray.on('click', () => openMain('today'));
    tray.on('double-click', () => openMain());
    updateTray();
  }

  function startLoop() {
    check({ startup: true });
    timer = setInterval(() => check(), fast ? 250 : 15000);
    powerMonitor.on('resume', () => check());
    powerMonitor.on('unlock-screen', () => check());
  }

  function setQuitting() { quitting = true; }

  return {
    data, file, clock, plan,
    initSettings, ensureToday, applyTheme, setBreakView, applyLang, trayModel, check, openBreak, openSession, endBreak, buildPayload, buildSessionPayload, pauseToday, pauseFor, applyLoginItem,
    openMain, openCoverForTest, createTray, registerIpc, startLoop, getState, dayDetail, setQuitting,
    get currentBreak() { return currentBreak; },
    get overlayWins() { return overlayWins; },
    get overlayView() { return overlayView; },
    get mainWin() { return mainWin; },
    stop() { if (timer) clearInterval(timer); },
    icon,
  };
}

function start({ fast = false, hidden = false } = {}) {
  let clock;
  if (fast) {
    // 1 minute = 1 second, starting just before today's window opens
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 59, 0);
    clock = createClock({ base, rate: 60 });
  } else {
    clock = createClock();
  }
  app.on('window-all-closed', () => { /* stay in tray */ });
  app.whenReady().then(() => {
    let ctl;
    try {
      ctl = createController({ clock, fast });
    } catch (e) {
      // data.json unreadable (locked / unmovable): never start on empty data, never overwrite it
      // settings are unreadable too: pick the language from the OS
      const osLang = /^zh/i.test((app.getPreferredSystemLanguages() || [])[0] || '') ? 'zh' : 'en';
      dialog.showErrorBox('BreakFit', `${I18N.t(osLang, 'dataError', { file: path.join(app.getPath('userData'), 'data.json') })}\n${e && e.message}`);
      app.exit(1);
      return;
    }
    if (fast) {
      // test run: every weekday active, today = 第 1 天, schedule window starts at 10:00
      const key = T.dateKey(clock.now());
      ctl.data.settings = normalizeSettings({ ...ctl.data.settings, activeWeekdays: [0, 1, 2, 3, 4, 5, 6], cycleAnchor: C.anchorFor(key, 0), start: '10:00' });
    }
    const firstRun = ctl.initSettings();
    ctl.applyLoginItem(ctl.data.settings.autoLaunch); // keep the OS login item in sync (packaged only)
    ctl.registerIpc();
    ctl.createTray();
    if (firstRun && Notification.isSupported()) {
      const l = ctl.data.settings.lang;
      new Notification({ title: I18N.t(l, 'runningTitle'), body: I18N.t(l, 'runningBody'), icon: notifyIcon() }).show();
    }
    app.on('second-instance', () => ctl.openMain());
    app.on('before-quit', () => ctl.setQuitting());
    if (!hidden) ctl.openMain();
    ctl.startLoop();
  });
}

module.exports = { start, createController, createClock };
