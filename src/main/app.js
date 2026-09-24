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
const { normalizeSettings } = require('../core/settings');
const store = require('./store');
const { trayIcon, trayPausedIcon, windowIcon, notifyIcon } = require('./icon');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const CLIPS = path.join(ROOT, 'assets', 'clips');
const PRELOAD = path.join(__dirname, 'preload.js');
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

function planUnit(id) {
  for (const d of Object.values(plan.days)) {
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

function toItem(u, carried) {
  if (u.type === 'circuit') {
    return {
      type: 'circuit', unitId: u.id, name: u.name, carried,
      moves: plan.circuits[u.moves].map((m) => ({
        id: m.id, name: m.name, sec: m.sec, clipUrl: clipUrl(m.clip), posterUrl: posterUrl(m.clip), tips: (m.tips || []).slice(0, 3),
      })),
    };
  }
  const src = planUnit(u.id);
  return {
    type: 'reps', unitId: u.id, name: u.name, muscle: src.muscle || '', carried,
    setNo: u.doneSets + 1, setsLeft: u.targetSets - u.doneSets, targetSets: u.targetSets,
    target: u.target, perSide: !!src.perSide, clipUrl: clipUrl(src.clip), posterUrl: posterUrl(src.clip), tips: (src.tips || []).slice(0, 3),
  };
}

function library() {
  const out = [];
  for (const pd of ['d1', 'd2']) {
    for (const u of plan.days[pd].units) {
      out.push({ id: u.id, name: u.name, muscle: u.muscle, day: pd, tips: u.tips, perSide: !!u.perSide, clipUrl: clipUrl(u.clip), posterUrl: posterUrl(u.clip) });
    }
  }
  const seen = new Set();
  for (const m of plan.circuits.core) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push({ id: m.id, name: m.name, muscle: '腹肌核心', day: 'd3', tips: m.tips, sec: m.sec, clipUrl: clipUrl(m.clip), posterUrl: posterUrl(m.clip) });
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

  function buildPayload(key, day, mode, slot = null) {
    const pd = plan.days[day.planDay];
    let k = slot;
    if (mode !== 'slot') {
      const n = D.nextSlotIndex(day);
      k = n < 0 ? Infinity : n;
    }
    let pend = day.units.length ? D.pendingUnits(day, k) : [];
    if (mode === 'test' && !pend.length) {
      pend = [{ unit: D.buildUnits(plan, 'd1', data.settings.overrides)[0], carried: false }];
    }
    const items = pend.map((p) => toItem(p.unit, p.carried));
    const nextIdx = day.slots.findIndex((s, j) => s.status === 'pending' && (mode !== 'slot' || j > slot));
    return {
      mode,
      isLast: mode === 'slot' && slot === D.lastSlot(day),
      slotTime: mode === 'slot' && day.slots[slot] ? day.slots[slot].time : T.fmtHM(Math.floor(T.minutesOf(clock.now()))),
      dayLabel: (pd || plan.days.d1).label,
      dayTitle: (pd || plan.days.d1).title,
      items,
      demoSec: data.settings.demoSec,
      showDemo: data.settings.showDemo,
      setRestSec: plan.setRestSec,
      roundRestSec: plan.days.d3.roundRestSec || 180,
      todayDone: D.doneSets(day),
      todayTotal: D.totalSets(day),
      nextBreak: nextIdx >= 0 ? day.slots[nextIdx].time : null,
      selftest,
    };
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
      new Notification({ title: '休息一下，起來走走', body: '', icon: toastIcon }).show();
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
      if (b.mode === 'slot' || b.mode === 'manual') {
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
  const themeQuery = () => ({ query: { theme: data.settings.theme } });
  function applyTheme() {
    const t = data.settings.theme;
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue;
      w.setBackgroundColor((w === mainWin ? BG : STAGE_BG)[t]);
      w.webContents.send('theme', t);
    }
  }

  function overlayOptions(display, isMain) {
    const common = {
      frame: false,
      backgroundColor: STAGE_BG[data.settings.theme],
      show: false,
      skipTaskbar: true,
      icon: winIcon,
      webPreferences: { preload: PRELOAD, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
    };
    if (selftest) return { ...common, width: 1280, height: 720, x: 0, y: 0, focusable: false, paintWhenInitiallyHidden: true };
    const { x, y, width, height } = display.bounds;
    return {
      ...common, x, y, width, height,
      fullscreen: true, resizable: false, movable: false, minimizable: false, maximizable: false,
      alwaysOnTop: true, focusable: isMain,
    };
  }

  function showOverlay() {
    allowOverlayClose = false;
    const primary = screen.getPrimaryDisplay();
    const displays = selftest ? [primary] : screen.getAllDisplays();
    for (const d of displays) {
      const isMain = d.id === primary.id;
      const win = new BrowserWindow(overlayOptions(d, isMain));
      win.removeMenu();
      win.on('close', (e) => { if (!allowOverlayClose && !quitting) e.preventDefault(); });
      if (!selftest) {
        win.setAlwaysOnTop(true, 'screen-saver');
        win.setVisibleOnAllWorkspaces(true);
        win.once('ready-to-show', () => {
          win.show();
          if (isMain) win.focus();
        });
        if (isMain) {
          win.on('blur', () => setTimeout(() => {
            if (currentBreak && !win.isDestroyed()) { win.moveTop(); win.focus(); }
          }, 400));
        }
      }
      win.loadFile(path.join(RENDERER, isMain ? 'overlay.html' : 'cover.html'), themeQuery());
      win.isMainOverlay = isMain;
      overlayWins.push(win);
    }
  }

  function focusOverlay() {
    const w = overlayWins.find((x) => x.isMainOverlay && !x.isDestroyed());
    if (w && !selftest) { w.show(); w.focus(); }
  }

  function closeOverlay() {
    allowOverlayClose = true;
    for (const w of overlayWins) if (!w.isDestroyed()) w.destroy();
    overlayWins = [];
  }

  function openCoverForTest() {
    const win = new BrowserWindow(overlayOptions(screen.getPrimaryDisplay(), false));
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
    const pd = plan.days[day.planDay];
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
        units: day.units.filter((u) => u.slot === k).map((u) => ({ name: u.name, done: u.doneSets, target: u.targetSets })),
      })),
      next: nextBreak(day, key),
      done: D.doneSets(day),
      total: D.totalSets(day),
      canBreakNow: !currentBreak && day.status === 'pending' && D.remainingSets(day) > 0,
      breakActive: !!currentBreak,
      history,
      stats: S.computeStats(history, key.slice(0, 7)),
      monthSets,
      recent: S.recentTraining(history, 30),
      settings: data.settings,
      plan,
      library: library(),
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
    return {
      date: key,
      summary,
      day: day || null,
      title: pdKey && plan.days[pdKey] ? plan.days[pdKey].title : null,
      implied: !day || !!day.implied,
      impliedUnits: !day && pdKey && plan.days[pdKey] ? D.buildUnits(plan, pdKey, data.settings.overrides) : [],
    };
  }

  // Tray tooltip: one fact per line (no ASCII '·' / '+' in CJK text, DESIGN.md §6).
  function trayText(st) {
    const lines = (...l) => ['BreakFit', ...l.filter(Boolean)].join('\n');
    const sets = `今天 ${st.done}/${st.total} 組`;
    if (st.day.planDay === 'off') return lines('今天不用練');
    if (st.day.planDay === 'rest') return lines('今天休息');
    if (st.day.paused) return lines(sets, '今天已暫停');
    if (st.day.status === 'pass') return lines(sets, '已完成');
    if (st.day.status === 'fail') return lines(sets, '不合格');
    if (st.paused) return lines(`暫停到 ${T.fmtHM(st.day.pausedUntil)}`);
    return lines(sets, st.next ? `下次 ${st.next.time}` : '');
  }

  const DAY_LABEL = { d1: '第 1 天', d2: '第 2 天', d3: '第 3 天', rest: '休息日', off: '今天不用練' };

  function updateTray() {
    if (!tray) return;
    const day = ensureToday();
    const training = !!plan.days[day.planDay];
    const done = D.doneSets(day);
    const total = D.totalSets(day);
    const paused = pausedNow(day);
    const st = { day, done, total, paused, next: nextBreak(day, nowInfo().key) };
    tray.setToolTip(trayText(st));
    tray.setImage(paused || day.paused ? iconPaused : icon);
    const pending = training && day.status === 'pending' && !currentBreak;
    const pauseItems = [
      { label: '30 分鐘', enabled: pending, click: () => pauseFor(30) },
      { label: '1 小時', enabled: pending, click: () => pauseFor(60) },
      { label: '2 小時', enabled: pending, click: () => pauseFor(120) },
      { label: '到明天', enabled: pending, click: confirmPause },
    ];
    if (paused) pauseItems.push({ type: 'separator' }, { label: '取消暫停', click: () => pauseFor(null) });
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: training ? `${plan.days[day.planDay].label}　${plan.days[day.planDay].title}` : DAY_LABEL[day.planDay] || 'BreakFit', enabled: false },
      ...(training ? [{ label: `今天 ${done}/${total} 組`, enabled: false }] : []),
      { label: st.next ? `下次休息 ${st.next.time}` : '今天沒有下一次休息', enabled: false },
      { type: 'separator' },
      { label: '現在就休息', enabled: !currentBreak && day.status === 'pending' && D.remainingSets(day) > 0, click: () => openBreak('manual') },
      { label: paused ? `暫停提醒（到 ${T.fmtHM(day.pausedUntil)}）` : '暫停提醒', submenu: pauseItems },
      { type: 'separator' },
      { label: '打開主視窗', click: () => openMain('today') },
      { label: '記錄', click: () => openMain('history') },
      { label: '設定', click: () => openMain('settings') },
      {
        label: '開機自動啟動', type: 'checkbox', checked: !!data.settings.autoLaunch,
        click: (item) => { data.settings.autoLaunch = item.checked; applyLoginItem(item.checked); save(); changed(); },
      },
      { type: 'separator' },
      { label: '結束', click: () => { quitting = true; app.quit(); } },
    ]));
  }

  async function confirmPause() {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: 'BreakFit',
      message: '暫停到明天？',
      detail: '今天會記為不合格。',
      buttons: ['暫停到明天', '取消'],
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
    ipcMain.handle('break:payload', () => (currentBreak ? currentBreak.payload : null));
    ipcMain.handle('break:set', (_e, { unitId, reps }) => {
      if (!currentBreak) return -1;
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
      if (!currentBreak || currentBreak.mode === 'test') return false;
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
    initSettings, ensureToday, applyTheme, check, openBreak, endBreak, buildPayload, pauseToday, pauseFor, applyLoginItem,
    openMain, openCoverForTest, createTray, registerIpc, startLoop, getState, dayDetail, setQuitting,
    get currentBreak() { return currentBreak; },
    get overlayWins() { return overlayWins; },
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
      dialog.showErrorBox('BreakFit', `讀不到記錄檔，程式先不啟動以免覆蓋資料。\n${e && e.message}`);
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
      new Notification({ title: 'BreakFit 在右下角執行中', body: '圖示可能收在 ^ 裡', icon: notifyIcon() }).show();
    }
    app.on('second-instance', () => ctl.openMain());
    app.on('before-quit', () => ctl.setQuitting());
    if (!hidden) ctl.openMain();
    ctl.startLoop();
  });
}

module.exports = { start, createController, createClock };
