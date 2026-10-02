'use strict';
// --selftest: temp userData, frozen fake clock, hidden 1280×720 windows (never fullscreen,
// never focused), walks every overlay phase + every main-window tab, saves PNGs, quits.
const { app } = require('electron');
// If the runner that spawned us goes away, console.log hits a closed pipe (EPIPE): stay silent, don't pop a dialog.
for (const s of [process.stdout, process.stderr]) s.on('error', () => {});
// Never pop Electron's "A JavaScript error occurred" dialog during tests (user may be trading): log and exit.
process.on('uncaughtException', (e) => { try { console.error('selftest crashed:', e); } catch (_) { /* closed pipe */ } app.exit(1); });
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createController, createClock } = require('./app');
const W = require('../core/overlay-window');
const T = require('../core/time');
const D = require('../core/day');
const C = require('../core/cycle');
const plan = require('../../plan.json');
const { lintSource, TOKENS, GROUPS, ROLES } = require('./layout-lint');

const MATRIX = process.argv.includes('--matrix'); // `npm.cmd run selftest -- --matrix`: size matrix + layout lint only
const QUICK = process.argv.includes('--quick'); // with --matrix: main window at 965/1366/1920/2560 only, no zoom, no overlay
const WONLY = process.argv.includes('--window'); // with --matrix: the windowed overlay only (quick iteration on its layout)

// Packaged builds run from inside the read-only app.asar; __dirname there resolves to a path
// under app.asar, and writing there throws ENOTDIR. Write next to the exe instead when packaged.
const OUT = path.join(app.isPackaged ? path.dirname(app.getPath('exe')) : path.join(__dirname, '..', '..'), 'selftest-out');
const TODAY = '2026-09-24'; // Thursday
const results = [];
const failures = [];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(cond, msg) {
  if (cond) console.log(`  ok  ${msg}`);
  else { console.log(`  FAIL ${msg}`); failures.push(msg); }
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 45 days of plausible history: mostly pass, some fail, a few days the app was never opened.
function seedHistory(ctl) {
  const s = ctl.data.settings;
  s.installedDate = T.addDays(TODAY, -45);
  s.cycleAnchor = C.anchorFor(TODAY, 0); // today = 第 1 天
  const r = rng(20260924);
  const notes = ['下午有點累，最後一次硬撐完', '伏地挺身改跪姿', '開會開太久，錯過兩次', '腰有點緊，捲腹做慢一點'];
  for (let i = 45; i >= 1; i--) {
    const key = T.addDays(TODAY, -i);
    const day = D.createDay(key, s, plan);
    const roll = r();
    if (day.units.length && roll < 0.06) continue; // never opened → implied fail
    if (day.units.length) {
      const pass = roll < 0.8;
      const total = D.totalSets(day);
      let budget = pass ? total : Math.floor(total * (0.3 + r() * 0.55));
      for (const u of day.units) {
        if (D.isStretch(u)) { if (pass) D.recordSet(day, u.id, 0); continue; } // stretch: done on pass days
        while (u.doneSets < u.targetSets && budget > 0) {
          const [a, b] = u.target || [0, 0];
          D.recordSet(day, u.id, a + Math.floor(r() * (b - a + 1)));
          budget--;
        }
      }
      day.slots.forEach((slot, k) => {
        const assigned = day.units.filter((u) => u.slot === k);
        if (!assigned.length) slot.status = pass ? 'empty' : 'notified';
        else if (assigned.every((u) => u.doneSets >= u.targetSets)) slot.status = r() < 0.12 ? 'partial' : 'done';
        else slot.status = r() < 0.5 ? 'skipped' : 'missed';
      });
      if (!pass) day.slots[day.slots.length - 1].status = 'skipped';
      day.events.push({ t: `${key}T11:00:00.000Z`, type: 'break_start', detail: { slot: 0 } });
      if (r() < 0.15) day.note = notes[Math.floor(r() * notes.length)];
    }
    day.status = D.gradeDay(day, key, TODAY);
    ctl.data.days[key] = day;
  }
}

// Today so far: 11:00 done, 12:00 partial, 13:00 skipped.
function seedToday(ctl) {
  const day = ctl.ensureToday();
  [12, 11, 10, 10, 9].forEach((n) => D.recordSet(day, 'pushup', n));
  [10, 9].forEach((n) => D.recordSet(day, 'weighted_pushup', n));
  day.slots[0].status = 'done';
  day.slots[1].status = 'partial';
  day.slots[2].status = 'skipped';
  day.note = '';
  return day;
}

// A 第 1 天 last break that still owes one move (bench dip 1/4, carried) + the end-of-day stretch.
function stretchDay(ctl) {
  const day = D.createDay(TODAY, ctl.data.settings, plan);
  for (const u of day.units) {
    if (D.isStretch(u)) continue;
    const n = u.id === 'bench_dip' ? 1 : u.targetSets;
    while (u.doneSets < n) D.recordSet(day, u.id, 10);
  }
  return day;
}
function stretchPayload(ctl) {
  const day = stretchDay(ctl);
  const p = ctl.buildPayload(TODAY, day, 'slot', D.lastSlot(day));
  p.showDemo = true;
  return p;
}
const STRETCH_SCREENS = [
  ['stretch-intro', "__test.show('intro', { remaining: 8.4 })", '最後一次(第 1 天)：補做 + 拉伸'],
  ['stretch-preview', "__test.show('stretchPreview', { remaining: 3.6 })", '拉伸：5 秒預覽(右側)'],
  ['stretch-hold-right', "__test.show('hold', { remaining: 21.4 })", '拉伸：右側 30 秒'],
  ['stretch-hold-left', "__test.show('hold', { nth: 1, remaining: 12.2 })", '拉伸：換左側'],
  ['stretch-hold-both', "__test.show('hold', { nth: 2, remaining: 18 })", '拉伸：雙手同時(前束，不分左右)'],
  ['stretch-hold-single', "__test.show('hold', { nth: 4, remaining: 27 })", '拉伸：最後一個'],
  ['stretch-finish-pass', "__test.show('finish', { sets: 3, stretchDone: true })", '拉伸做完：今天合格'],
  ['stretch-finish-fail', "__test.show('finish', { sets: 3 })", '拉伸沒做完：今天不合格'],
];

function waitLoad(win) {
  return new Promise((res) => {
    if (!win.webContents.isLoading()) res();
    else win.webContents.once('did-finish-load', res);
  });
}

async function until(win, expr, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await win.webContents.executeJavaScript(expr)) return true; } catch (_) { /* not ready */ }
    await delay(80);
  }
  throw new Error(`timeout waiting for ${expr}`);
}

function blankness(img) {
  const bmp = img.toBitmap();
  if (!bmp.length) return { blank: true, colors: 0 };
  const seen = new Set();
  let min = 765;
  let max = 0;
  for (let i = 0; i < bmp.length; i += 4 * 61) {
    const v = bmp[i] + bmp[i + 1] + bmp[i + 2];
    if (v < min) min = v;
    if (v > max) max = v;
    seen.add((bmp[i] >> 4) * 256 + (bmp[i + 1] >> 4) * 16 + (bmp[i + 2] >> 4));
  }
  return { blank: max - min < 40, colors: seen.size };
}

async function shot(win, name, desc) {
  await win.webContents.executeJavaScript(
    'document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))))',
  );
  await delay(450);
  const [width, height] = win.getContentSize();
  const img = await win.webContents.capturePage({ x: 0, y: 0, width, height }, { stayHidden: true });
  const size = img.getSize();
  const b = blankness(img);
  fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
  results.push({ file: `${name}.png`, desc, ...size, ...b });
  assert(!b.blank && size.width > 0, `${name}.png ${size.width}x${size.height} (${desc})`);
}

const js = (win, code) => win.webContents.executeJavaScript(code);

// English UI check: every visible text node + title / aria-label / placeholder, minus user notes and
// the 繁中 language segment, must be free of CJK. Returns the offending strings.
const CJK_SCAN = `(() => {
  const cjk = /[\\u3000-\\u9fff\\uff00-\\uffef]/;
  const bad = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const el = n.parentElement;
    if (!el || el.closest('textarea, #sLang, [hidden]') || !el.getClientRects().length) continue;
    if (cjk.test(n.nodeValue)) bad.push(n.nodeValue.trim());
  }
  for (const el of document.querySelectorAll('[title], [aria-label], [placeholder]')) {
    for (const a of ['title', 'aria-label', 'placeholder']) if (cjk.test(el.getAttribute(a) || '')) bad.push(a + ': ' + el.getAttribute(a));
  }
  if (cjk.test(document.title)) bad.push('title: ' + document.title);
  return bad.slice(0, 5);
})()`;

async function main() {
  if (MATRIX) fs.rmSync(path.join(OUT, 'matrix'), { recursive: true, force: true });
  else if (fs.existsSync(OUT)) for (const f of fs.readdirSync(OUT)) if (f !== 'matrix' && f !== 'pip-review' && !f.startsWith('m-')) fs.rmSync(path.join(OUT, f), { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const clock = createClock({ base: new Date(2026, 8, 24, 13, 59, 30), rate: 0 });
  const ctl = createController({ clock, selftest: true });
  assert(ctl.file.startsWith(os.tmpdir()), `data file is temp: ${ctl.file}`);
  seedHistory(ctl);
  ctl.initSettings();
  const today = seedToday(ctl);
  ctl.data.days[TODAY].status = D.gradeDay(today, TODAY, TODAY);
  ctl.registerIpc();
  assert(ctl.data.settings.breakView === 'pip', 'a new install opens breaks as 畫中畫 (settings.breakView default = pip)');
  ctl.data.settings.breakView = 'full'; // the full-screen suites below keep their screenshots
  fs.writeFileSync(path.join(OUT, 'tray-icon.png'), ctl.icon.toPNG());

  // ---------- main window ----------
  console.log('main window');
  const mw = ctl.openMain();
  await waitLoad(mw);
  await until(mw, 'window.__test && window.__test.ready()');
  const cornerSupport = await js(mw, "JSON.stringify({ squircle: CSS.supports('corner-shape','squircle'), round: CSS.supports('corner-shape','round'), chrome: navigator.userAgent.match(/Chrome\\/([\\d.]+)/)[1] })");
  console.log(`  corner-shape support: ${cornerSupport}`);
  if (MATRIX) return matrix(ctl, mw);
  // Focus ring = keyboard only (base.css + theme.js): a real click must not leave it, Tab must show it.
  mw.webContents.focus();
  const navXY = JSON.parse(await js(mw, "(() => { const r = document.querySelector('.nav-item[data-tab=\"history\"]').getBoundingClientRect(); return JSON.stringify([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]); })()"));
  for (const type of ['mouseDown', 'mouseUp']) mw.webContents.sendInputEvent({ type, x: navXY[0], y: navXY[1], button: 'left', clickCount: 1 });
  await delay(150);
  const ring = () => js(mw, "(() => { const a = document.activeElement; return JSON.stringify([a && a.dataset.tab, getComputedStyle(a).outlineStyle, document.documentElement.dataset.input]); })()").then(JSON.parse);
  const afterClick = await ring();
  assert(afterClick[0] === 'history' && afterClick[1] === 'none', `mouse click on nav item: focused, no focus ring (${afterClick})`);
  mw.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
  mw.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
  await delay(150);
  const afterTab = await ring();
  assert(afterTab[2] === 'keyboard' && afterTab[1] === 'solid', `Tab key: focus ring shown (${afterTab})`);
  await js(mw, 'document.activeElement.blur(), true');
  await js(mw, "__test.tab('today')");
  await shot(mw, '01-today', '今天：進度、下次休息、時間表、示範庫');
  await js(mw, '__test.scroll(10000)');
  await shot(mw, '02-today-bottom', '今天：捲到底');
  // Directive hero states (no stop owes anything): the hero names the next training day instead.
  for (const [kind, word, desc] of [['done', '今天完成', '全部完成'], ['over', '今天結束', '沒有下一站'], ['rest', '今天休息', '休息日']]) {
    await js(mw, `__test.scroll(0); __test.hero('${kind}')`);
    const heroTxt = await js(mw, "document.querySelector('.hero-state').textContent + '|' + document.querySelector('#heroText .hero-in').textContent + '|' + !document.getElementById('heroClip').hidden");
    assert(heroTxt.startsWith(`${word}|明天`) && heroTxt.endsWith('|true'), `今天 hero, ${desc}: directive + next training day + its clip (${heroTxt})`);
    await shot(mw, `01-today-${kind}`, `今天：${desc}`);
  }
  await js(mw, '__test.hero(null)');
  // Day line: hovering a stop shows what it owes.
  const stopXY = JSON.parse(await js(mw, "(() => { const r = document.querySelector('#timeline .stop.next .dot').getBoundingClientRect(); return JSON.stringify([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]); })()"));
  mw.webContents.sendInputEvent({ type: 'mouseMove', x: stopXY[0], y: stopXY[1] });
  await delay(150);
  const tip = await js(mw, "(() => { const t = document.querySelector('#timeline .stop.next .tip'); return getComputedStyle(t).display + '|' + t.textContent; })()");
  assert(tip.startsWith('flex|下一次負重伏地挺身'), `day line: hover on the next stop shows what it owes (${tip})`);
  await shot(mw, '01-today-stop-hover', '今天：滑到下一站，顯示該做的動作');
  mw.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 5 });
  assert(await js(mw, "!!document.querySelector('#heroText .hero-time')"), '今天 hero back to the next stop');
  // Library defaults to today's plan day (rest → next training day, only stretch owed → 拉伸).
  assert(await js(mw, "document.querySelector('#libFilter button.on').dataset.f") === 'd1', 'library defaults to today (第 1 天)');
  const libDefaults = await js(mw, `(() => { const real = S, out = [];
    S = { ...real, day: { ...real.day, planDay: 'd3' } }; out.push(defaultLibFilter());
    S = { ...real, day: { ...real.day, planDay: 'rest' }, nextTraining: { planDay: 'd2' } }; out.push(defaultLibFilter());
    S = { ...real, total: 5, done: 5, upNext: { index: 10 } }; out.push(defaultLibFilter());
    S = real; return out.join(','); })()`);
  assert(libDefaults === 'd3,d2,stretch', `library default: d3 day / rest day / stretch owed (${libDefaults})`);
  await js(mw, "__test.scroll(0); __test.filter('d3')");
  await shot(mw, '03-library-d3', '示範庫切到第 3 天(腹肌)');
  await js(mw, "__test.open('pushup')");
  await shot(mw, '04-library-player', '示範庫：放大播放伏地挺身');
  await js(mw, '__test.close()');

  await js(mw, "__test.tab('history')");
  const failDay = Object.keys(ctl.data.days).sort().reverse().find((k) => ctl.data.days[k].status === 'fail' && ctl.data.days[k].events.length);
  await js(mw, `__test.select('${failDay}')`);
  await shot(mw, '05-history', `記錄：統計卡、月曆、30 日長條圖、${failDay} 明細`);
  const passDay = Object.keys(ctl.data.days).sort().find((k) => k.startsWith('2026-08') && ctl.data.days[k].status === 'pass');
  await js(mw, `__test.select('${passDay}')`);
  await shot(mw, '06-history-prev-month', `記錄：上個月 + ${passDay} 合格明細`);
  await js(mw, '__test.scroll(10000)');
  await shot(mw, '07-history-bottom', '記錄：捲到底');

  await js(mw, "__test.tab('settings')");
  // 設定 → 一般 → 休息顯示: 全螢幕 | 視窗 (settings.breakView); the 完整訓練 sheet shows the same choice
  assert(await js(mw, "[...document.querySelectorAll('#sView button')].map((b) => b.dataset.v).join() + '|' + document.querySelector('#sView .on').dataset.v") === 'pip,window,full|full', '休息顯示: 畫中畫 | 視窗 | 全螢幕 (PIP first), shows the saved view');
  await js(mw, "document.querySelector('#sView [data-v=\"window\"]').click(), true");
  await until(mw, "document.querySelector('#sView .on').dataset.v === 'window'");
  assert(ctl.data.settings.breakView === 'window', '休息顯示 → 視窗 saves settings.breakView');
  assert(await js(mw, "__test.workout() && document.querySelector('#woView .on').dataset.v") === 'window', '完整訓練 sheet shows the same 休息顯示 choice');
  await shot(mw, '08b-workout-view', '完整訓練：休息顯示 全螢幕 | 視窗');
  await js(mw, "document.querySelector('#woView [data-v=\"full\"]').click(), true");
  await until(mw, "document.querySelector('#woView .on').dataset.v === 'full'");
  assert(ctl.data.settings.breakView === 'full', '完整訓練 sheet: 全螢幕 saves it back');
  await js(mw, "__test.close(); __test.tab('settings')");
  await shot(mw, '08-settings', '設定：時段、循環、休息畫面、菜單覆寫');
  await js(mw, '__test.scroll(10000)');
  await shot(mw, '09-settings-bottom', '設定：捲到底');

  // ---------- real scheduler path: 16:00 slot fires ----------
  // (mid-day createDay spreads d1's 6 units over slots 3..9 starting at the first open slot when
  // seedToday ran at 13:59 — see distribute()/firstOpenSlot() in src/core/day.js — so pushup lands
  // on slot 3 itself and is already fully recorded; the next slot with something pending is 5/16:00.)
  console.log('overlay (d1, slot 16:00)');
  clock.set(new Date(2026, 8, 24, 16, 0, 5));
  ctl.check();
  const b = ctl.currentBreak;
  assert(b && b.mode === 'slot' && b.slot === 5, 'checker opened slot 5 (16:00)');
  assert(b && b.payload.items.map((i) => `${i.unitId}${i.carried ? '*' : ''}`).join(',') === 'weighted_pushup*,incline_pushup', 'pending = weighted_pushup (carried) + incline_pushup');
  const ow = ctl.overlayWins[0];
  assert(ow && !ow.isFullScreen() && !ow.isAlwaysOnTop() && !ow.isVisible(), 'selftest overlay is hidden, not fullscreen, not on top');
  await waitLoad(ow);
  await until(ow, 'window.__test && window.__test.ready()');
  await js(ow, "__test.show('intro', { remaining: 7.3 })");
  await shot(ow, '10-intro', '開場：清單(上次留下標記)+10 秒倒數');
  // full screen ⇄ normal window, live, mid-break (button / F key → main; showing / moving the window
  // is skipped in selftest): same phase, timer and sets, and the choice is saved for the next break
  assert(ctl.overlayView === 'full' && ow.bfView.regrab && !ow.isResizable() && await js(ow, "document.documentElement.dataset.view === 'full' && document.querySelector('#minBtn').hidden"), 'overlay opens in the saved view: full screen (minimize hidden, blur re-grab on)');
  await js(ow, "__test.show('rest', { remaining: 42, reps: 12 })");
  const live0 = await js(ow, '__test.state()');
  const done0 = D.doneSets(ctl.data.days[TODAY]);
  await js(ow, "document.querySelector('#winBtn').click()");
  await until(ow, "document.documentElement.dataset.view === 'window'");
  assert(ctl.overlayView === 'window' && ctl.data.settings.breakView === 'window', 'button → windowed, saved as settings.breakView = window');
  assert(ow.isResizable() && ow.isMovable() && ow.isMinimizable() && !ow.bfView.skipTaskbar && ow.bfView.alwaysOnTop && !ow.bfView.regrab, 'windowed flags: resizable, movable, minimizable, in the taskbar, on top, no blur re-grab');
  assert(await js(ow, "!document.querySelector('#minBtn').hidden && document.querySelector('#winBtn').hidden && !document.querySelector('#fullBtn').hidden && !document.querySelector('#pipBtn').hidden && getComputedStyle(document.querySelector('#top')).webkitAppRegion === 'drag'"), 'windowed: minimize + → 畫中畫 / → 全螢幕, header is the drag region');
  const live1 = await js(ow, '__test.state()');
  assert(live1 === live0 && ctl.currentBreak.sets === 0 && D.doneSets(ctl.data.days[TODAY]) === done0, `live switch keeps phase, timer, sets (${live1})`);
  await shot(ow, '10w-windowed', '視窗化(組間休息中切換)：標題列可拖、最小化與全螢幕鈕');
  await js(ow, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }))");
  await until(ow, "document.documentElement.dataset.view === 'full'");
  assert(await js(ow, "document.querySelector('#minBtn').hidden") && ctl.data.settings.breakView === 'full' && !ow.isResizable() && ow.bfView.regrab, 'F key returns to full screen and saves it');
  assert(await js(ow, '__test.state()') === live0, 'round trip: phase, timer, sets unchanged');
  // → 畫中畫, then back through 視窗 to 全螢幕, mid-break (all by mouse)
  await js(ow, "document.querySelector('#pipBtn').click()");
  await until(ow, "document.documentElement.dataset.view === 'pip'");
  assert(ctl.overlayView === 'pip' && ctl.data.settings.breakView === 'pip' && ow.bfView.focusable === false && ow.bfView.keepOnTop && ow.bfView.skipTaskbar && !ow.bfView.regrab && ow.isResizable() && ow.isMovable() && ctl.overlayWins.length === 1,
    'button → PIP: saved, mouse-only (not focusable), re-asserted on top, resizable / movable, no covers');
  const pipUi = await js(ow, `(() => { const v = (s) => !!document.querySelector(s).offsetParent;
    return [!v('#pipBtn'), v('#winBtn'), v('#fullBtn'), !v('#minBtn'), [...document.querySelectorAll('kbd')].every((k) => !k.offsetParent),
      getComputedStyle(document.querySelector('#pipDrag')).webkitAppRegion, getComputedStyle(document.querySelector('#pPri .btn')).webkitAppRegion,
      getComputedStyle(document.body).webkitAppRegion, getComputedStyle(document.getElementById('grip')).display].join(); })()`);
  assert(pipUi === 'true,true,true,true,true,drag,no-drag,none,block', `PIP: → 視窗 / → 全螢幕, no keycaps, drag anywhere but controls and the rim, resize grip (${pipUi})`);
  for (const k of [' ', 'Enter', 'Escape', 'f']) await js(ow, `__test.key(${JSON.stringify(k)})`);
  assert(await js(ow, '__test.state()') === live0 && await js(ow, "document.getElementById('modal').hidden && document.documentElement.dataset.view === 'pip'"), 'PIP: same phase, timer, sets; Space / Enter / Esc / F do nothing (the keyboard belongs to the app underneath)');
  ow.setContentSize(400, 580);
  await shot(ow, '10p-pip', '畫中畫(組間休息中切換)400×580');
  ow.setContentSize(1280, 720);
  await js(ow, "document.querySelector('#winBtn').click()");
  await until(ow, "document.documentElement.dataset.view === 'window'");
  assert(ctl.overlayView === 'window' && ow.bfView.focusable && await js(ow, '__test.state()') === live0, 'PIP → 視窗: focusable again, state unchanged');
  await js(ow, "document.querySelector('#fullBtn').click()");
  await until(ow, "document.documentElement.dataset.view === 'full'");
  assert(ctl.overlayView === 'full' && ctl.data.settings.breakView === 'full' && ow.bfView.regrab && await js(ow, '__test.state()') === live0, '視窗 → 全螢幕: saved, state unchanged');
  await js(ow, "__test.show('demo', { remaining: 5.2 })");
  await shot(ow, '11-demo', '示範：循環示範片/佔位 + 要點 + 目標組數');
  await js(ow, "__test.show('work', { elapsed: 23 })");
  await shot(ow, '12-work', '換你做(次數型)：大字目標 + 碼錶 + 完成這組');
  await js(ow, "__test.show('rest', { remaining: 42, reps: 12 })");
  await shot(ow, '13-rest', '組間休息：倒數、+30 秒、次數修正、下一組預覽');
  await js(ow, "__test.show('rest', { nth: 1, remaining: 51 })");
  await shot(ow, '14-rest-next-move', '組間休息：下一個動作預覽');
  await js(ow, '__test.leave()');
  await shot(ow, '15-leave-confirm', '離開確認');
  await js(ow, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); true");
  await delay(100);
  assert(ctl.currentBreak && await js(ow, "document.getElementById('modal').hidden"), 'Enter in leave dialog (focus on 繼續) cancels, does not abort');
  await js(ow, "__test.show('finish', { sets: 6 })");
  await shot(ow, '16-finish', '完成：本次組數 + 今天進度 + 下次休息');
  await js(ow, "__test.show('finish', { sets: 6, afterWork: true, reps: 13 })");
  await shot(ow, '16b-finish-adjust', '完成：最後一組結束後仍可修正次數');

  // end-to-end IPC: record one set through the renderer bridge, then abort
  await js(ow, "window.bf.setDone('weighted_pushup', 11)");
  assert(ctl.data.days[TODAY].units[1].doneSets === 3, 'set recorded via IPC (weighted_pushup 3/4)');
  await js(ow, "setTimeout(() => window.bf.end('abort'), 0); true");
  await delay(300);
  await delay(200);
  assert(!ctl.currentBreak && ctl.data.days[TODAY].slots[5].status === 'partial', 'abort → slot partial, overlay closed');
  assert(D.pendingUnits(ctl.data.days[TODAY], 6).map((p) => p.unit.id).join(',') === 'weighted_pushup,incline_pushup', 'unfinished sets roll to next slot');

  // ---------- a break that opens directly windowed (saved view + saved rectangle) ----------
  console.log('overlay (opens windowed)');
  ctl.data.settings.breakView = 'window';
  const rect = { x: 60, y: 60, width: 960, height: 600 };
  ctl.data.settings.windowBounds = { ...rect };
  assert(ctl.openBreak('test'), '預覽休息畫面 opens');
  const wo = ctl.overlayWins[0];
  await waitLoad(wo);
  await until(wo, 'window.__test && window.__test.ready()');
  const wb = wo.getBounds();
  assert(ctl.overlayWins.length === 1 && ctl.overlayView === 'window' && JSON.stringify(wb) === JSON.stringify(rect), `opens windowed at the saved rectangle, no cover windows (${JSON.stringify(wb)})`);
  assert(!wo.isFullScreen() && !wo.isVisible() && wo.isResizable() && wo.isMovable() && wo.isMinimizable() && !wo.bfView.skipTaskbar && wo.bfView.alwaysOnTop && !wo.bfView.regrab,
    'windowed from the start: not full screen (hidden in selftest), resizable, movable, minimizable, in the taskbar, on top, no blur re-grab');
  assert(await js(wo, "document.documentElement.dataset.view === 'window' && !document.querySelector('#minBtn').hidden"), 'the page starts in window view');
  await shot(wo, '17-opens-windowed', '直接以視窗開啟(上次的位置與大小)');
  // Alt+F4 / the taskbar's Close = 離開: asks first, the break stays
  wo.close();
  await until(wo, "!document.getElementById('modal').hidden");
  assert(ctl.currentBreak && !wo.isDestroyed() && await js(wo, "document.getElementById('mTitle').textContent") === '離開休息？', 'closing the windowed break (Alt+F4) asks 離開休息？, the break stays');
  await shot(wo, '17b-windowed-close-asks', '視窗模式按 Alt+F4：先問要不要離開');
  await js(wo, "document.getElementById('mCancel').click(), true");
  // moved / resized: remembered (debounced) in data.json, so it survives a restart
  wo.setBounds({ x: 80, y: 70, width: 900, height: 620 });
  await delay(900);
  const onDisk = JSON.parse(fs.readFileSync(ctl.file, 'utf8')).settings;
  assert(JSON.stringify(onDisk.windowBounds) === JSON.stringify({ x: 80, y: 70, width: 900, height: 620 }) && onDisk.breakView === 'window', `moved / resized window saved to data.json (${JSON.stringify(onDisk.windowBounds)})`);
  ctl.endBreak('abort');
  assert(!ctl.currentBreak && ctl.overlayWins.length === 0, 'windowed preview break closed');

  // ---------- a break that opens directly as PIP (the default) ----------
  console.log('overlay (opens as PIP)');
  ctl.data.settings.breakView = 'pip';
  ctl.data.settings.pipBounds = null;
  assert(ctl.openBreak('test'), '預覽休息畫面 opens as PIP');
  const po = ctl.overlayWins[0];
  await waitLoad(po);
  await until(po, 'window.__test && window.__test.ready()');
  const pb = W.defaultPipBounds(require('electron').screen.getPrimaryDisplay().workArea);
  assert(ctl.overlayWins.length === 1 && ctl.overlayView === 'pip' && JSON.stringify(po.getBounds()) === JSON.stringify(pb), `PIP opens bottom-right of the work area, no covers (${JSON.stringify(po.getBounds())} vs ${JSON.stringify(pb)})`);
  assert(!po.isFullScreen() && !po.isVisible() && po.bfView.focusable === false && po.bfView.keepOnTop && po.bfView.alwaysOnTop && po.isResizable() && po.isMovable(), 'PIP from the start: not focusable, kept on top, resizable, movable (hidden in selftest)');
  assert(await js(po, "document.documentElement.dataset.view === 'pip'"), 'the page starts in PIP view');
  await shot(po, '18-opens-pip', '直接以畫中畫開啟(右下角 400×580)');
  // leaving is all mouse: 離開 → dialog → 離開
  await js(po, "document.getElementById('leaveBtn').click(), true");
  await until(po, "!document.getElementById('modal').hidden");
  await shot(po, '18b-pip-leave', '畫中畫：離開確認(滑鼠)');
  await js(po, "setTimeout(() => document.getElementById('mOk').click(), 0), true");
  await delay(400);
  assert(!ctl.currentBreak && ctl.overlayWins.length === 0, 'PIP: 離開 + confirm by mouse closes the break');
  ctl.data.settings.breakView = 'full';

  const press = (win, key, repeat = false) => js(win, `__test.key(${JSON.stringify(key)}, ${repeat})`);

  // ---------- last break of a 第 3 天 (circuits) ----------
  console.log('overlay (d3, last break)');
  let d3key = TODAY;
  while (C.planDayFor(d3key, ctl.data.settings, plan.cycle) !== 'd3') d3key = T.addDays(d3key, 1);
  const d3 = D.createDay(d3key, ctl.data.settings, plan);
  const payload = ctl.buildPayload(d3key, d3, 'slot', D.lastSlot(d3));
  assert(payload.isLast && payload.items.map((i) => i.type).join(',') === 'circuit,circuit,stretch', 'last-break payload has both circuit rounds, then the stretch');
  ctl.openBreak('test', null, payload);
  const ow2 = ctl.overlayWins[0];
  await waitLoad(ow2);
  await until(ow2, 'window.__test && window.__test.ready()');
  await js(ow2, "__test.show('intro', { remaining: 9.1 })");
  await shot(ow2, '20-last-intro', '最後一次休息：警告條 + 腹肌循環 2 輪');
  await js(ow2, '__test.skip()');
  await shot(ow2, '21-last-skip-confirm', '最後一次按跳過：二次確認「跳過 = 今天不合格」');
  await press(ow2, ' ');
  await delay(100);
  assert(ctl.currentBreak && await js(ow2, "document.getElementById('modal').hidden"), 'Space in skip dialog (focus on 繼續) cancels, does not skip');
  await js(ow2, '__test.skip()');
  await press(ow2, 'Enter');
  await delay(100);
  assert(ctl.currentBreak && await js(ow2, "document.getElementById('modal').hidden"), 'Enter in skip dialog (focus on 繼續) cancels, does not skip');
  await js(ow2, "__test.show('preview', { nth: 2, remaining: 3.4 })");
  await shot(ow2, '22-circuit-preview', '腹肌循環：5 秒「下一個」預覽');
  await js(ow2, "__test.show('timed', { nth: 2, remaining: 18.2 })");
  await shot(ow2, '23-circuit-timed', '腹肌循環：30 秒倒數');
  await js(ow2, "__test.show('roundRest', { remaining: 152 })");
  await shot(ow2, '24-round-rest', '輪間休息 180 秒 + 下一輪預覽');
  for (const k of [' ', 'Enter']) {
    await js(ow2, "__test.show('roundRest', { remaining: 152 })");
    await delay(450);
    const after = await press(ow2, k);
    assert(after !== 'roundRest', `${k === ' ' ? 'Space' : 'Enter'} on round rest → 跳過休息 (→ ${after})`);
  }
  await js(ow2, "__test.show('finish', { sets: 2 })");
  await shot(ow2, '25-finish-pass', '最後一次完成：今天合格');
  await delay(450);
  await press(ow2, ' ');
  await delay(300);
  assert(!ctl.currentBreak && ow2.isDestroyed(), 'Space on finish → 關閉 → overlay closed');
  ctl.endBreak('abort');

  // ---------- end-of-day stretch (last break, after the training) ----------
  console.log('overlay (d1, last break + stretch)');
  const pS = stretchPayload(ctl);
  assert(pS.isLast && pS.stretchOwed && pS.items.map((i) => `${i.unitId}${i.carried ? '*' : ''}`).join(',') === 'bench_dip*,stretch', `last break = carried bench dip, then the stretch (${pS.items.map((i) => i.unitId)})`);
  const stIt = pS.items[1];
  assert(stIt.moves.map((m) => `${m.id}${m.sides ? '2' : ''}`).join(',') === 'chest2,front_delt,triceps2' && stIt.holdSec === 30, `第 1 天 stretches: chest ×2 sides, front delt (both arms at once), triceps ×2 sides, 30 s (${stIt.moves.map((m) => m.id)})`);
  ctl.openBreak('test', null, pS);
  const owS = ctl.overlayWins[0];
  await waitLoad(owS);
  await until(owS, 'window.__test && window.__test.ready()');
  const kindsS = (await js(owS, "__test.steps().join(',')")).split(',');
  const firstS = kindsS.indexOf('stretchPreview');
  assert(firstS > 0 && kindsS[firstS - 1] === 'work' && kindsS.slice(firstS).join(',') === `${'stretchPreview,hold,'.repeat(5)}stretchDone`,
    `steps: training, then (preview, hold) × 5 holds, no rest before the stretch (${kindsS.slice(firstS - 1).join(',')})`);
  for (const [name, code, desc] of STRETCH_SCREENS) {
    await js(owS, code);
    await shot(owS, `26-${name}`, desc);
  }
  await js(owS, "__test.show('hold', { remaining: 21.4 })");
  const holdTxt = await js(owS, "document.getElementById('pTitle').textContent + '|' + document.getElementById('pMeta').textContent + '|' + document.querySelectorAll('#pBody .tips li').length + '|' + !!document.querySelector('#pBody .ring') + '|' + document.querySelector('#pPri .btn').id");
  assert(holdTxt === '胸肌拉伸|右側第 1/3 個|2|true|holdNext', `hold: name, side, 2 tips, ring, primary = 下一個 (${holdTxt})`);
  assert(await js(owS, "!!document.querySelector('#clipMain .ph, #clipMain video')"), 'hold: clip box (clip or placeholder) on the left');
  await delay(450);
  assert(await press(owS, ' ') === 'stretchPreview' && await js(owS, "document.getElementById('pMeta').textContent.startsWith('左側')"), 'Space on a hold → next: preview of the left side');
  await delay(450);
  assert(await press(owS, ' ') === 'hold', 'Space on the stretch preview → hold');
  await js(owS, "__test.show('hold', { nth: 4, remaining: 3 })");
  await delay(450);
  assert(await press(owS, ' ') === 'finish', 'Space on the last hold → finish (stretch recorded)');
  assert(ctl.currentBreak && ctl.currentBreak.sets === 1, 'the stretch was recorded through IPC when its last hold ended');
  ctl.endBreak('abort');

  const cover = ctl.openCoverForTest();
  await waitLoad(cover);
  await shot(cover, '30-cover', '其他螢幕的覆蓋層');
  cover.destroy();

  // ---------- 示範 OFF: every break goes straight to work; Space = primary button ----------
  console.log('demo OFF');
  const settle = async (win) => { await delay(150); await until(win, 'window.__test && window.__test.ready()'); };
  await js(mw, "__test.tab('settings'); window.bf.saveSettings({ showDemo: false }).then(() => true)");
  await settle(mw);
  assert(await js(mw, "document.getElementById('sDemo').disabled && document.getElementById('sDemoRow').classList.contains('off')"), '示範 OFF disables the 示範秒數 row');
  await shot(mw, '40-settings-demo-off', '設定：示範關閉 → 示範秒數停用');
  const pOff = ctl.buildPayload(TODAY, ctl.ensureToday(), 'slot', 6);
  assert(pOff.showDemo === false, 'payload carries showDemo=false');
  ctl.openBreak('test', null, pOff);
  const ow3 = ctl.overlayWins[0];
  await waitLoad(ow3);
  await until(ow3, 'window.__test && window.__test.ready()');
  const kindsOff = await js(ow3, "__test.steps().join(',')");
  assert(!/demo|preview/.test(kindsOff) && kindsOff.startsWith('work'), `demo OFF: no demo steps (${kindsOff})`);
  await delay(450);
  assert(await press(ow3, ' ') === 'work', 'demo OFF: Space on intro → straight to work');
  assert(await press(ow3, ' ', true) === 'work', 'held Space (auto-repeat) is ignored');
  assert(await press(ow3, ' ') === 'work', 'Space within 400 ms of a phase change is ignored');
  await delay(450);
  await press(ow3, ' ');
  await delay(250);
  assert(await js(ow3, '__test.phase()') === 'rest', 'Space on work → 完成這組 → rest');
  await delay(450);
  assert(await press(ow3, 'Enter') === 'work', 'Enter on rest → 跳過休息 → next set');
  await js(ow3, "__test.show('work', { elapsed: 4 })");
  await shot(ow3, '41-demo-off-work', '示範關閉：開始 → 直接換你做(左邊影片照常循環)');
  await js(ow3, '__test.leave()');
  await delay(450);
  await press(ow3, ' ');
  await delay(100);
  assert(ctl.currentBreak && await js(ow3, "document.getElementById('modal').hidden"), 'Space in leave dialog (focus on 繼續) cancels, does not abort');
  ctl.endBreak('abort');
  const pOffD3 = ctl.buildPayload(d3key, d3, 'slot', D.lastSlot(d3));
  ctl.openBreak('test', null, pOffD3);
  const ow4 = ctl.overlayWins[0];
  await waitLoad(ow4);
  await until(ow4, 'window.__test && window.__test.ready()');
  assert(!/preview/.test(await js(ow4, "__test.steps().join(',')")), 'demo OFF: circuit has no 5 s previews');
  ctl.endBreak('abort');
  const pOffS = stretchPayload(ctl);
  pOffS.showDemo = false;
  ctl.openBreak('test', null, pOffS);
  const owS2 = ctl.overlayWins[0];
  await waitLoad(owS2);
  await until(owS2, 'window.__test && window.__test.ready()');
  const kOffS = await js(owS2, "__test.steps().join(',')");
  assert(!/stretchPreview/.test(kOffS) && (kOffS.match(/hold/g) || []).length === 5, `demo OFF: stretch goes hold → hold, no previews (${kOffS})`);
  await js(owS2, "__test.show('hold', { remaining: 2 })");
  await delay(450);
  assert(await press(owS2, ' ') === 'hold' && await js(owS2, "document.getElementById('pMeta').textContent.startsWith('左側')"), 'demo OFF: Space on the right-side hold → left-side hold');
  ctl.endBreak('abort');
  ctl.openBreak('test', null, pOffD3);
  const ow4b = ctl.overlayWins[0];
  await waitLoad(ow4b);
  await until(ow4b, 'window.__test && window.__test.ready()');
  await delay(450);
  assert(await press(ow4b, ' ') === 'timed', 'demo OFF: circuit intro → straight to the timed move');
  await js(ow4b, "__test.show('timed', { remaining: 27 })");
  await shot(ow4b, '42-demo-off-circuit', '示範關閉：腹肌循環直接開始 30 秒');
  ctl.endBreak('abort');

  // ---------- light theme (switched live through the real settings IPC) ----------
  console.log('light theme');
  const pL = ctl.buildPayload(TODAY, ctl.ensureToday(), 'slot', 6);
  pL.showDemo = true;
  ctl.openBreak('test', null, pL);
  const ow5 = ctl.overlayWins[0];
  await waitLoad(ow5);
  await until(ow5, 'window.__test && window.__test.ready()');
  assert(await js(ow5, '__test.theme()') === 'dark', 'overlay opened dark');
  const coverLive = ctl.openCoverForTest();
  await waitLoad(coverLive);
  assert(await js(coverLive, 'document.documentElement.dataset.theme') === 'dark', 'cover opened dark');
  await js(mw, "window.bf.saveSettings({ showDemo: true, theme: 'light' }).then(() => true)");
  await delay(250);
  assert(await js(ow5, '__test.theme()') === 'light' && await js(mw, 'document.documentElement.dataset.theme') === 'light', 'theme switches live in main window and open overlay');
  assert(ctl.data.settings.theme === 'light', 'theme persisted in settings');
  assert(await js(coverLive, 'document.documentElement.dataset.theme') === 'light', 'theme switches live in an already-open cover window');
  await shot(coverLive, 'light-30-cover', '淺色：其他螢幕覆蓋層(開著時即時切換)');
  coverLive.destroy();
  await delay(300);
  assert(await press(ow5, ' ') === 'demo', 'Space on intro → demo');
  await delay(450);
  assert(await press(ow5, ' ') === 'work', 'Space on demo → work');
  await js(ow5, "__test.show('intro', { remaining: 7.3 })");
  await shot(ow5, 'light-10-intro', '淺色：開場');
  await js(ow5, "__test.show('demo', { remaining: 5.2 })");
  await shot(ow5, 'light-11-demo', '淺色：示範');
  await js(ow5, "__test.show('work', { elapsed: 23 })");
  await shot(ow5, 'light-12-work', '淺色：換你做');
  await js(ow5, "__test.show('rest', { remaining: 42, reps: 12 })");
  await shot(ow5, 'light-13-rest', '淺色：組間休息');
  await js(ow5, '__test.leave()');
  await shot(ow5, 'light-15-leave-confirm', '淺色：離開確認');
  await js(ow5, "__test.show('finish', { sets: 6, afterWork: true, reps: 13 })");
  await shot(ow5, 'light-16-finish', '淺色：完成');
  ctl.endBreak('abort');
  ctl.openBreak('test', null, ctl.buildPayload(d3key, d3, 'slot', D.lastSlot(d3)));
  const ow6 = ctl.overlayWins[0];
  await waitLoad(ow6);
  await until(ow6, 'window.__test && window.__test.ready()');
  assert(await js(ow6, '__test.theme()') === 'light', 'new overlay opens light');
  await js(ow6, "__test.show('intro', { remaining: 9.1 })");
  await shot(ow6, 'light-20-last-intro', '淺色：最後一次開場');
  await js(ow6, "__test.show('preview', { nth: 2, remaining: 3.4 })");
  await shot(ow6, 'light-22-circuit-preview', '淺色：循環預覽');
  await js(ow6, "__test.show('timed', { nth: 2, remaining: 18.2 })");
  await shot(ow6, 'light-23-circuit-timed', '淺色：循環 30 秒');
  await js(ow6, "__test.show('roundRest', { remaining: 152 })");
  await shot(ow6, 'light-24-round-rest', '淺色：輪間休息');
  await js(ow6, "__test.show('finish', { sets: 2 })");
  await shot(ow6, 'light-25-finish-pass', '淺色：今天合格');
  ctl.endBreak('abort');
  ctl.openBreak('test', null, stretchPayload(ctl));
  const owSL = ctl.overlayWins[0];
  await waitLoad(owSL);
  await until(owSL, 'window.__test && window.__test.ready()');
  assert(await js(owSL, '__test.theme()') === 'light', 'stretch overlay opens light');
  for (const [name, code, desc] of STRETCH_SCREENS) {
    await js(owSL, code);
    await shot(owSL, `light-26-${name}`, `淺色：${desc}`);
  }
  ctl.endBreak('abort');
  ctl.openBreak('test', null, ctl.buildPayload(d3key, d3, 'slot', D.lastSlot(d3)));
  const ow6b = ctl.overlayWins[0];
  await waitLoad(ow6b);
  await until(ow6b, 'window.__test && window.__test.ready()');
  await js(ow6b, "__test.show('finish', { sets: 2 })");
  await delay(450);
  await press(ow6b, 'Enter');
  await delay(300);
  assert(!ctl.currentBreak && ow6b.isDestroyed(), 'Enter on finish → 關閉 → overlay closed');
  ctl.endBreak('abort');
  await settle(mw);
  await js(mw, "__test.tab('today'); __test.scroll(0)");
  await shot(mw, 'light-01-today', '淺色：今天');
  await js(mw, "__test.open('pushup')");
  await shot(mw, 'light-04-library-player', '淺色：示範庫播放');
  await js(mw, "__test.close(); __test.tab('history')");
  await js(mw, `__test.select('${failDay}')`);
  await shot(mw, 'light-05-history', '淺色：記錄');
  await js(mw, '__test.scroll(10000)');
  await shot(mw, 'light-07-history-bottom', '淺色：記錄捲到底(長條圖)');
  await js(mw, "__test.tab('settings')");
  await shot(mw, 'light-08-settings', '淺色：設定');
  await js(mw, '__test.scroll(10000)');
  await shot(mw, 'light-09-settings-bottom', '淺色：設定捲到底');
  const coverL = ctl.openCoverForTest();
  await waitLoad(coverL);
  assert(await js(coverL, 'document.documentElement.dataset.theme') === 'light', 'new cover opens light');
  await shot(coverL, 'light-31-cover-new', '淺色：新開的覆蓋層');
  coverL.destroy();

  // ---------- English (switched live through the real settings IPC, like the theme) ----------
  console.log('english');
  await js(mw, "window.bf.saveSettings({ theme: 'dark' }).then(() => true)");
  const pE = ctl.buildPayload(TODAY, ctl.ensureToday(), 'slot', 6);
  pE.showDemo = true;
  ctl.openBreak('test', null, pE);
  const ow7 = ctl.overlayWins[0];
  await waitLoad(ow7);
  await until(ow7, 'window.__test && window.__test.ready()');
  await js(ow7, "__test.show('rest', { remaining: 42, reps: 12 })");
  await js(ow7, '__test.leave()');
  const coverE = ctl.openCoverForTest();
  await waitLoad(coverE);
  const chipZh = await js(ow7, "document.querySelector('#pChip .chip').lastChild.textContent");
  assert(chipZh === '下一個動作', `overlay opened in 繁中 (${chipZh})`);
  await js(mw, "__test.tab('settings'); document.querySelector('#sLang [data-l=\"en\"]').click(); true");
  await delay(400);
  assert(ctl.data.settings.lang === 'en', 'language persisted in settings (clicked English)');
  assert(await js(mw, "document.querySelector('#sLang .on').dataset.l") === 'en', 'language segment shows English');
  assert(await js(mw, "document.querySelector('.nav-item[data-tab=\"today\"] .nav-label').textContent") === 'Today', 'main window switched live');
  assert(await js(ow7, "document.querySelector('#pChip .chip').lastChild.textContent + '|' + document.getElementById('mTitle').textContent") === 'Next Exercise|Leave this break?', 'open overlay + its dialog switched live');
  assert(await js(ow7, "__test.phase()") === 'rest', 'switching language keeps the break where it was');
  assert(await js(coverE, "document.querySelector('.c div').textContent") === 'On a Break', 'open cover switched live');
  await shot(ow7, 'en-15-leave-confirm', 'English: leave dialog');
  const scanOv = async (name) => {
    const bad = await js(ow7, CJK_SCAN);
    assert(!bad.length, `English overlay ${name}: no CJK text ${bad.length ? JSON.stringify(bad) : ''}`);
  };
  await scanOv('leave');
  for (const [name, code] of [['intro', "__test.show('intro', { remaining: 7.3 })"], ['demo', "__test.show('demo', { remaining: 5.2 })"],
    ['work', "__test.show('work', { elapsed: 23 })"], ['rest', "__test.show('rest', { remaining: 42, reps: 12 })"],
    ['rest-next-move', "__test.show('rest', { nth: 1, remaining: 51 })"], ['finish', "__test.show('finish', { sets: 6, afterWork: true, reps: 13 })"]]) {
    await js(ow7, code);
    await scanOv(name);
    await shot(ow7, `en-ov-${name}`, `English: ${name}`);
  }
  ctl.endBreak('abort');
  coverE.destroy();
  ctl.openBreak('test', null, ctl.buildPayload(d3key, d3, 'slot', D.lastSlot(d3)));
  const ow8 = ctl.overlayWins[0];
  await waitLoad(ow8);
  await until(ow8, 'window.__test && window.__test.ready()');
  for (const [name, code] of [['last-intro', "__test.show('intro', { remaining: 9.1 })"], ['skip-confirm', '__test.skip()'],
    ['preview', "__test.show('preview', { nth: 2, remaining: 3.4 })"], ['timed', "__test.show('timed', { nth: 2, remaining: 18.2 })"],
    ['round-rest', "__test.show('roundRest', { remaining: 152 })"], ['finish-pass', "__test.show('finish', { sets: 2 })"]]) {
    await js(ow8, code);
    const bad = await js(ow8, CJK_SCAN);
    assert(!bad.length, `English overlay d3 ${name}: no CJK text ${bad.length ? JSON.stringify(bad) : ''}`);
    await shot(ow8, `en-ov-d3-${name}`, `English: 第 3 天 ${name}`);
  }
  ctl.endBreak('abort');
  ctl.openBreak('test', null, stretchPayload(ctl));
  const owSE = ctl.overlayWins[0];
  await waitLoad(owSE);
  await until(owSE, 'window.__test && window.__test.ready()');
  for (const [name, code] of STRETCH_SCREENS) {
    await js(owSE, code);
    const bad = await js(owSE, CJK_SCAN);
    assert(!bad.length, `English overlay ${name}: no CJK text ${bad.length ? JSON.stringify(bad) : ''}`);
    await shot(owSE, `en-ov-${name}`, `English: ${name}`);
  }
  await js(owSE, "__test.show('hold', { nth: 1, remaining: 12.2 })");
  const holdEn = await js(owSE, "document.getElementById('pTitle').textContent + '|' + [...document.querySelectorAll('#pMeta > span')].map((x) => x.textContent).join('/') + '|' + document.querySelector('#pPri .btn .lb').textContent");
  assert(holdEn === 'Chest stretch|Left/Stretch 1/3|Next', `English hold: name, side, button (${holdEn})`);
  ctl.endBreak('abort');
  await settle(mw);
  for (const [name, code] of [['today', "__test.tab('today'); __test.scroll(0)"], ['library-d3', "__test.filter('d3')"], ['library-stretch', "__test.filter('stretch')"], ['player', "__test.open('pushup')"],
    ['history', `__test.close(); __test.tab('history'); __test.select('${failDay}').then(() => true)`], ['history-prev-month', `__test.select('${passDay}').then(() => true)`],
    ['settings', "__test.tab('settings'); __test.scroll(0)"]]) {
    await js(mw, code);
    await delay(150);
    const bad = await js(mw, CJK_SCAN);
    assert(!bad.length, `English main ${name}: no CJK text ${bad.length ? JSON.stringify(bad) : ''}`);
    await shot(mw, `en-${name}`, `English: ${name}`);
  }
  const cjk = /[\u3000-\u9fff\uff00-\uffef]/;
  const labels = [];
  const walkMenu = (items) => items.forEach((i) => { if (i.label) labels.push(i.label); if (i.submenu) walkMenu(i.submenu); });
  const tm = ctl.trayModel();
  walkMenu(tm.template);
  const badTray = [tm.tip, ...labels].filter((l) => cjk.test(l));
  assert(labels.length >= 12 && !badTray.length, `English tray tooltip + menu + submenu (${labels.length} labels) ${JSON.stringify(badTray)}`);
  // tray 休息顯示: three radio items, PIP first, the saved view checked; clicking one saves it
  const viewMenu = tm.template.find((i) => i.label === 'Break Display');
  const vm = viewMenu ? viewMenu.submenu.map((i) => `${i.label}:${i.type}:${i.checked}`).join(',') : '';
  assert(vm === 'Picture-in-Picture:radio:false,Window:radio:false,Full Screen:radio:true', `tray Break Display submenu (${vm})`);
  viewMenu.submenu[0].click();
  assert(ctl.data.settings.breakView === 'pip' && ctl.trayModel().template.find((i) => i.label === 'Break Display').submenu[0].checked, 'tray → Picture-in-Picture saves breakView = pip');
  ctl.setBreakView('full');
  const coverE2 = ctl.openCoverForTest();
  await waitLoad(coverE2);
  assert(await js(coverE2, "document.querySelector('.c div').textContent + '|' + document.title") === 'On a Break|On a Break', 'new cover opens in English');
  coverE2.destroy();
  await js(mw, "document.querySelector('#sLang [data-l=\"zh\"]').click(); true");
  await delay(300);
  assert(ctl.data.settings.lang === 'zh' && await js(mw, "document.querySelector('.nav-item[data-tab=\"today\"] .nav-label').textContent") === '今天', 'switches back to 繁中 live');

  // ---------- stretch on 今天: training cleared, the last stop still owes the stretch ----------
  console.log('today: stretch owed');
  const tday = ctl.data.days[TODAY];
  for (const u of tday.units) if (!D.isStretch(u)) while (u.doneSets < u.targetSets) D.recordSet(tday, u.id, 10);
  assert(D.remainingSets(tday) === 1 && D.gradeDay(tday, TODAY, TODAY) === 'pending', 'all sets done, stretch owed → still pending');
  await js(mw, "window.bf.saveSettings({}).then(() => true)"); // any save pushes state:changed → refresh
  await settle(mw);
  await js(mw, "__test.tab('today'); __test.scroll(0); __test.filter('d1')");
  await delay(200);
  const heroS = await js(mw, "document.querySelector('#heroText .hero-time').textContent + '|' + document.querySelector('#heroText .hero-name').textContent + '|' + document.querySelector('#heroText .hero-meta').textContent + '|' + !document.getElementById('heroClip').hidden + '|' + document.getElementById('heroClip').dataset.name");
  assert(heroS === '21:00|拉伸|5 × 30 秒|true|胸肌拉伸', `今天 hero: the stretch at the last stop, first stretch clip (${heroS})`);
  const lastStop = await js(mw, "(() => { const s = [...document.querySelectorAll('#timeline .stop')].pop(); return s.getAttribute('aria-label') + '|' + s.querySelector('.tip').textContent + '|' + s.className; })()");
  assert(/拉伸/.test(lastStop.split('|')[0]) && /拉伸/.test(lastStop.split('|')[1]) && / next /.test(` ${lastStop.split('|')[2]} `), `day line: last stop label + tooltip say 拉伸, and it is the next stop (${lastStop})`);
  await shot(mw, '50-today-stretch-owed', '今天：練完了，最後一站還要拉伸');
  await js(mw, "__test.filter('stretch')");
  await delay(150);
  const libS = await js(mw, "[...document.querySelectorAll('#library .lib-card .n')].map((n) => n.textContent).join(',') + '|' + document.querySelector('#libFilter .on').textContent");
  assert(libS === '胸肌拉伸,三角肌前束拉伸,肱三頭肌拉伸|拉伸', `library 拉伸 filter = today's stretches (${libS})`);
  await js(mw, '__test.scroll(10000)');
  await shot(mw, '51-library-stretch', '示範庫：拉伸(今天的三個)');
  await js(mw, "__test.open('stretch_chest')");
  assert(await js(mw, "document.getElementById('playerMeta').textContent") === '每邊 30 秒', 'stretch player: 每邊 30 秒');
  await shot(mw, '52-library-stretch-player', '示範庫：拉伸放大播放');
  await js(mw, "__test.close(); __test.scroll(0)");

  // real last break: only the stretch is owed; leaving mid-stretch = not done = today fails
  console.log('last break: leave mid-stretch');
  clock.set(new Date(2026, 8, 24, 21, 0, 5));
  ctl.check();
  const bS = ctl.currentBreak;
  assert(bS && bS.mode === 'slot' && bS.slot === D.lastSlot(tday) && bS.payload.items.map((i) => i.unitId).join(',') === 'stretch', `21:00 opens the last break with only the stretch (${bS && bS.payload.items.map((i) => i.unitId)})`);
  const owR = ctl.overlayWins[0];
  await waitLoad(owR);
  await until(owR, 'window.__test && window.__test.ready()');
  assert(await js(owR, "__test.steps().join(',')") === `${'stretchPreview,hold,'.repeat(5)}stretchDone`, 'stretch-only break: previews + holds');
  await js(owR, "__test.show('intro', { remaining: 6 })");
  await shot(owR, '53-last-break-stretch-only', '最後一次：只剩拉伸');
  await js(owR, "__test.show('hold', { nth: 2, remaining: 14 })");
  await js(owR, '__test.leave()');
  assert(await js(owR, "document.getElementById('mBody').textContent") === '離開 = 今天不合格', 'leave mid-stretch warns the day fails');
  await js(owR, "document.getElementById('mOk').click(); true");
  await delay(400);
  assert(!ctl.currentBreak && D.stretchDone(tday) === false && tday.status === 'fail', `left mid-stretch → stretch not done → today fails (${tday.status})`);

  await fullWorkout(ctl, mw, settle, clock);

  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, failures }, null, 2));
  console.log(`\n${results.length} screenshots → ${OUT}`);
  console.log(failures.length ? `SELFTEST FAIL (${failures.length})` : 'SELFTEST PASS');
  return failures.length ? 1 : 0;
}

// ---------- 完整訓練 (full workout): chooser, overlay screens, real recording paths ----------
// a custom 完整訓練 pick across days: two of today's (第 1 天) moves + 第 2 / 3 天 moves + two stretches
const PICK = ['pushup', 'incline_pushup', 'squat', 'core_round_1', 'stretch:chest', 'stretch:quad'];
async function fullWorkout(ctl, mw, settle, clock) {
  console.log('full workout');
  const openOv = async (payload) => {
    ctl.openBreak('test', null, payload);
    const ow = ctl.overlayWins[0];
    await waitLoad(ow);
    await until(ow, 'window.__test && window.__test.ready()');
    return ow;
  };
  const ready = async (win) => { await waitLoad(win); await until(win, 'window.__test && window.__test.ready()'); };
  const scan = async (win, what) => { const bad = await js(win, CJK_SCAN); assert(!bad.length, `English ${what}: no CJK ${bad.length ? JSON.stringify(bad) : ''}`); };

  // a fresh 第 1 天 at 10:50, nothing done yet
  const s = ctl.data.settings;
  clock.set(new Date(2026, 8, 24, 10, 50, 0));
  ctl.data.days[TODAY] = D.createDay(TODAY, s, plan, T.parseHM('10:50'));
  const tday = ctl.data.days[TODAY];
  tday.planDay = 'rest';
  assert(ctl.getState().session.def === 'd2', 'chooser default on a rest day = the next training day (第 2 天)');
  tday.planDay = 'd1';

  // chooser: default = today's plan day; another day says 加練 (both themes, both languages)
  for (const [theme, lang, pre] of [['dark', 'zh', ''], ['light', 'zh', 'light-'], ['dark', 'en', 'en-'], ['light', 'en', 'en-light-']]) {
    await js(mw, `window.bf.saveSettings({ theme: '${theme}', lang: '${lang}' }).then(() => true)`);
    await settle(mw);
    await js(mw, "__test.close(); __test.tab('today'); __test.scroll(0)");
    assert(await js(mw, "__test.workout() && document.querySelector('#woDay .on').dataset.d") === 'd1', `${pre || 'zh-'}chooser opens on today's plan day`);
    if (lang === 'en') await scan(mw, 'chooser');
    await shot(mw, `${pre}60-workout-chooser`, `${pre}完整訓練：選第幾天(預設今天)`);
    const def = await js(mw, "document.querySelectorAll('#woList .wo-row').length + '|' + document.querySelectorAll('#woList .wo-row.on').length + '|' + document.getElementById('woSum').textContent");
    assert(/^27\|9\|9 (個動作|exercises)(約|About) \d+ (分鐘|min)$/.test(def), `${pre || 'zh-'}chooser: 27 rows, today's 9 ticked, count + time, no 加練 (${def})`);
    await js(mw, "__test.workout('d2')");
    const meta = await js(mw, "document.querySelector('#woDay .on').dataset.d + '|' + document.getElementById('woSum').textContent");
    assert(/^d2\|14 (個動作|exercises)/.test(meta) && /(加練|Extra Workout)$/.test(meta), `${pre || 'zh-'}chooser 第 2 天: 14 rows, time, 加練 (${meta})`);
    await shot(mw, `${pre}61-workout-chooser-extra`, `${pre}完整訓練：選別天 = 加練`);
    // a custom pick across days: no preset lit, live count, today's moves keep it off 加練
    await js(mw, `__test.workout(${JSON.stringify(PICK)})`);
    const cust = await js(mw, "!document.querySelector('#woDay .on') + '|' + document.querySelectorAll('#woList .wo-row.on').length + '|' + document.getElementById('woSum').textContent + '|' + document.getElementById('woStart').disabled");
    assert(/^true\|6\|6 (個動作|exercises)(約|About) \d+ (分鐘|min)\|false$/.test(cust), `${pre || 'zh-'}custom pick: no preset, 6 ticked, not 加練, 開始 on (${cust})`);
    if (lang === 'en') await scan(mw, 'custom chooser');
    await shot(mw, `${pre}61b-workout-chooser-custom`, `${pre}完整訓練：自選(跨天勾選)`);
    // tick / untick by click; nothing ticked → 開始 off
    await js(mw, "document.querySelector('#woList .wo-row[data-k=\"pushup\"]').click(); true");
    assert(!(await js(mw, '__test.workoutSel()')).includes('pushup'), 'clicking a ticked row unticks it');
    await js(mw, '__test.workout([])');
    assert(await js(mw, "document.getElementById('woStart').disabled") === true, 'nothing ticked → 開始 disabled');
    await js(mw, '__test.close()');
  }
  await js(mw, "window.bf.saveSettings({ theme: 'dark', lang: 'zh' }).then(() => true)");
  await settle(mw);

  // overlay screens (frozen): 第 1 天 full menu, a set rest, finish; 第 3 天 round rest
  const p1 = ctl.buildSessionPayload(TODAY, D.createDay(TODAY, s, plan, 600), 'd1');
  p1.showDemo = true;
  assert(!p1.extra && p1.items.map((i) => i.unitId).join(',') === 'pushup,weighted_pushup,incline_pushup,diamond_pushup,triceps_pushup,bench_dip,stretch', 'session payload: whole day in plan order, stretch last');
  const ow = await openOv(p1);
  const steps = await js(ow, "__test.steps().join(',')");
  assert(steps.startsWith('demo,work,rest,work,rest,work') && steps.endsWith('stretchDone') && !/rest,stretch/.test(steps), 'session steps: demo → sets with rests → … → stretch (no rest before it)');
  await js(ow, "__test.show('intro', { remaining: 8 })");
  const intro = await js(ow, "document.getElementById('modeTag').textContent + '|' + document.querySelectorAll('.plan li').length + '|' + document.getElementById('pMeta').textContent + '|' + !document.getElementById('skipBtn')");
  assert(/^完整訓練\|7\|約 \d+ 分鐘25 組\|true$/.test(intro), `session intro: tag, 7 rows, time + sets, no 跳過 (${intro})`);
  await shot(ow, '62-session-intro', '完整訓練：開場列出整天菜單 + 預估時間');
  await js(ow, "__test.show('rest', { nth: 6, remaining: 38, reps: 11 })");
  await shot(ow, '63-session-set-rest', '完整訓練：組間休息 60 秒(下一組)');
  await js(ow, '__test.leave()');
  assert(await js(ow, "document.getElementById('mTitle').textContent") === '結束訓練？', 'Esc in a session asks 結束訓練？');
  await js(ow, "__test.show('finish', { sets: 25, stretchDone: true })");
  assert(await js(ow, "document.querySelector('#pChip .chip').lastChild.textContent") === '今天合格', 'session of today, all done → 今天合格');
  await shot(ow, '65-session-finish', '完整訓練：完成(今天合格)');
  ctl.endBreak('abort');
  const p3 = ctl.buildSessionPayload(TODAY, tday, 'd3');
  p3.showDemo = true;
  assert(p3.extra && p3.items.map((i) => i.type).join(',') === 'circuit,circuit,stretch', 'session of 第 3 天 (another day) = 加練: both rounds + stretch');
  const ow3 = await openOv(p3);
  assert(/timed,round,roundRest,preview/.test(await js(ow3, "__test.steps().join(',')")), 'd3 session: round 1 → 180 s round rest → round 2');
  await js(ow3, "__test.show('roundRest', { remaining: 131 })");
  await shot(ow3, '64-session-round-rest', '完整訓練第 3 天：輪間休息 3 分鐘');
  await js(ow3, "__test.show('finish', { sets: 2, stretchDone: true })");
  const fin = await js(ow3, "document.querySelector('#pChip .chip').lastChild.textContent + '|' + document.getElementById('modeTag').textContent");
  assert(fin === '訓練完成|加練', `extra session finish: 訓練完成, tagged 加練 (${fin})`);
  await shot(ow3, '66-session-finish-extra', '加練完成');
  ctl.endBreak('abort');
  for (const [theme, lang, pre] of [['light', 'zh', 'light-'], ['dark', 'en', 'en-']]) {
    await js(mw, `window.bf.saveSettings({ theme: '${theme}', lang: '${lang}' }).then(() => true)`);
    const px = ctl.buildSessionPayload(TODAY, D.createDay(TODAY, s, plan, 600), 'd2');
    px.showDemo = true;
    const owX = await openOv(px);
    await js(owX, "__test.show('intro', { remaining: 8 })");
    if (lang === 'en') await scan(owX, 'session intro');
    await shot(owX, `${pre}62-session-intro-d2`, `${pre}完整訓練第 2 天(加練)開場`);
    await js(owX, "__test.show('rest', { nth: 3, remaining: 38, reps: 11 })");
    if (lang === 'en') await scan(owX, 'session rest');
    await shot(owX, `${pre}63-session-set-rest`, `${pre}完整訓練：組間休息`);
    ctl.endBreak('abort');
  }
  await js(mw, "window.bf.saveSettings({ theme: 'dark', lang: 'zh' }).then(() => true)");
  await settle(mw);

  // real path 1: today's session from 10:50; 11:00 and 12:00 come due meanwhile → never a 2nd overlay
  assert(ctl.openSession('d1') && ctl.currentBreak.mode === 'session' && !ctl.currentBreak.extra, "openSession(d1) on a 第 1 天 = today's session");
  const owA = ctl.overlayWins[0];
  await ready(owA);
  assert(!ctl.openBreak('manual') && !ctl.openSession('d2') && ctl.overlayWins.length === 1, 'no break / second session while a session runs');
  for (let i = 0; i < 5; i++) await js(owA, "window.bf.setDone('pushup', 10)");
  // live switch mid-session: same screen, timer and sets; session continues in the same window
  await js(owA, "__test.show('rest', { nth: 2, remaining: 33, reps: 10 })");
  const sess0 = await js(owA, '__test.state()');
  await js(owA, "__test.key('f')");
  await until(owA, "document.documentElement.dataset.view === 'window'");
  assert(ctl.currentBreak.mode === 'session' && ctl.currentBreak.sets === 5 && ctl.overlayWins.length === 1 && ctl.overlayView === 'window' && await js(owA, '__test.state()') === sess0,
    `mid-session switch to window: phase, timer, 5 sets unchanged (${sess0})`);
  await js(owA, "__test.key('f')");
  await until(owA, "document.documentElement.dataset.view === 'full'");
  assert(ctl.currentBreak.sets === 5 && tday.units[0].doneSets === 5 && await js(owA, '__test.state()') === sess0 && ctl.data.settings.breakView === 'full', 'mid-session round trip back to full screen: unchanged');
  for (const v of ['pip', 'window', 'full']) {
    await js(owA, `window.bf.setView('${v}')`);
    await until(owA, `document.documentElement.dataset.view === '${v}'`);
    assert(ctl.overlayView === v && ctl.currentBreak.mode === 'session' && ctl.currentBreak.sets === 5 && ctl.overlayWins.length === 1 && await js(owA, '__test.state()') === sess0, `mid-session → ${v}: phase, timer, sets unchanged`);
  }
  clock.set(new Date(2026, 8, 24, 12, 10, 0));
  ctl.check();
  assert(ctl.currentBreak && ctl.currentBreak.mode === 'session' && ctl.overlayWins.length === 1, 'breaks due during the session do not open');
  await js(owA, "setTimeout(() => window.bf.end('abort'), 0); true");
  await delay(400);
  assert(!ctl.currentBreak && tday.units[0].doneSets === 5 && D.doneSets(tday) === 5, 'left mid-way: the 5 sets stay recorded');
  assert(tday.slots[0].status === 'empty' && tday.slots[1].status === 'missed' && tday.status === 'pending', `stops due meanwhile absorbed (${tday.slots[0].status}/${tday.slots[1].status}), day still pending`);
  ctl.check();
  assert(!ctl.currentBreak, '12:10 check after the session: nothing opens');
  assert(D.pendingUnits(tday, 2).some((p) => p.unit.id === 'weighted_pushup' && p.carried), 'the rest carries on to the next break');

  // real path 2: a second session does the remaining sets only → today passes, no more pop-ups
  ctl.openSession('d1');
  const pay = ctl.currentBreak.payload;
  assert(pay.items[0].unitId === 'weighted_pushup' && pay.items[0].setNo === 1 && pay.items.length === 6, 'second session: remaining units only (pushup done)');
  const owB = ctl.overlayWins[0];
  await ready(owB);
  for (const it of pay.items) {
    const n = it.type === 'reps' ? it.setsLeft : 1;
    for (let i = 0; i < n; i++) await js(owB, `window.bf.setDone(${JSON.stringify(it.unitId)}, 10)`);
  }
  await js(owB, "setTimeout(() => window.bf.end('done'), 0); true");
  await delay(400);
  assert(tday.status === 'pass' && tday.slots.slice(2).every((x) => x.status === 'empty'), `full session → today passes, remaining stops empty (${tday.status})`);
  const ends = tday.events.filter((e) => e.type === 'session_end').map((e) => `${e.detail.outcome}:${e.detail.sets}`).join(',');
  assert(ends === 'abort:5,done:20', `session_end events (${ends})`);

  // real path 3: another plan day = 加練: logged on today's record, grade and sets unchanged
  ctl.openSession('d2');
  assert(ctl.currentBreak.extra, 'd2 on a 第 1 天 = 加練');
  const owC = ctl.overlayWins[0];
  await ready(owC);
  for (let i = 0; i < 3; i++) await js(owC, "window.bf.setDone('y_raise', 15)");
  clock.set(new Date(2026, 8, 24, 12, 40, 0));
  await js(owC, "setTimeout(() => window.bf.end('abort'), 0); true");
  await delay(400);
  const ex = D.extraSessions(tday);
  assert(ex.length === 1 && ex[0].planDay === 'd2' && ex[0].sets === 3 && ex[0].sec >= 60 && tday.status === 'pass' && D.doneSets(tday) === 25,
    `加練 logged (${JSON.stringify(ex)}), today untouched`);
  await js(mw, 'window.bf.saveSettings({}).then(() => true)');
  await settle(mw);
  await js(mw, `__test.tab('history'); __test.select('${TODAY}').then(() => __test.scroll(0))`);
  await delay(250);
  const row = await js(mw, "[...document.querySelectorAll('#detail .urow')].map((r) => r.textContent).filter((x) => x.startsWith('加練')).join('|')");
  assert(/^加練　第 2 天3 組\d+ 分鐘$/.test(row), `history day detail shows 加練 (${row})`);
  await shot(mw, '67-history-extra', '記錄：當天明細的加練');

  // real path 4: a custom pick on a fresh 第 1 天 — today's moves count, the rest is 加練, remembered
  ctl.data.days[TODAY] = D.createDay(TODAY, s, plan, T.parseHM('12:40'));
  const fday = ctl.data.days[TODAY];
  assert(ctl.openSession(PICK) && !ctl.currentBreak.extra, 'custom pick with today\'s moves = 完整訓練 (not 加練)');
  const payM = ctl.currentBreak.payload;
  assert(payM.items.map((i) => i.unitId).join(',') === 'pushup,incline_pushup,squat,core_round_1,stretch' && payM.extraUnits.join(',') === 'squat,core_round_1,stretch'
    && payM.dayTitle === '自選訓練' && payM.dayLabel === '第 1 天、第 2 天、第 3 天', `custom payload: plan order, stretch last, 加練 units, 自選 (${payM.items.map((i) => i.unitId)} / ${payM.extraUnits} / ${payM.dayLabel})`);
  const owD = ctl.overlayWins[0];
  await ready(owD);
  await js(owD, "__test.show('intro', { remaining: 8 })");
  await shot(owD, '68-session-intro-custom', '完整訓練：自選開場');
  for (let i = 0; i < 5; i++) await js(owD, "window.bf.setDone('pushup', 10)");
  for (let i = 0; i < 2; i++) await js(owD, "window.bf.setDone('squat', 12)");
  await js(owD, "window.bf.setDone('stretch', 0)");
  clock.set(new Date(2026, 8, 24, 13, 0, 0));
  await js(owD, "setTimeout(() => window.bf.end('abort'), 0); true");
  await delay(400);
  const exM = D.extraSessions(fday);
  assert(D.doneSets(fday) === 5 && D.stretchDone(fday) === false && fday.status === 'pending' && exM.length === 1 && exM[0].sets === 2 && exM[0].stretch && exM[0].days.join() === 'd1,d2,d3',
    `mixed: 5 sets toward today, 2 + stretch as 加練 (${JSON.stringify(exM)}), day pending`);
  assert(ctl.getState().session.last.join() === 'pushup,incline_pushup,stretch:chest,squat,stretch:quad,core_round_1', 'custom pick remembered for today');
  await js(mw, 'window.bf.saveSettings({}).then(() => true)');
  await settle(mw);
  assert(await js(mw, "__test.close(); __test.tab('today'); __test.workout() && __test.workoutSel().length") === 6, 'chooser reopens on the remembered pick');
  await js(mw, '__test.close()');
  await js(mw, `__test.tab('history'); __test.select('${TODAY}').then(() => __test.scroll(0))`);
  await delay(250);
  const rowM = await js(mw, "[...document.querySelectorAll('#detail .urow')].map((r) => r.textContent).filter((x) => x.startsWith('加練')).join('|')");
  assert(/^加練　第 1 天、第 2 天、第 3 天2 組\d+ 分鐘$/.test(rowM), `history: 自選 加練 across days (${rowM})`);
  await js(mw, "__test.tab('today')");
}

// ---------- size matrix + layout lint (DESIGN.md §10) ----------
const MAIN_SIZES = [[800, 600], [900, 700], [965, 940], [1024, 768], [1280, 720], [1366, 768], [1440, 900], [1600, 900], [1920, 1080], [2560, 1440]];
const ZOOMS = [[965, 940, 1.25], [965, 940, 1.5]];
const EN_MAIN_SIZES = [[800, 600], [965, 940], [1366, 768], [1920, 1080], [2560, 1440]];
const EN_OV_SIZES = [[1024, 768], [1366, 768], [1920, 1080]];
const OV_SIZES = [[1024, 768], [1280, 720], [1280, 800], [1366, 768], [1440, 900], [1536, 864], [1920, 1080], [2560, 1440]];
// windowed overlay (settings.breakView = 'window'): window content sizes, zoom = Windows display scaling
const WIN_SIZES = [[1280, 800, 1], [1024, 640, 1], [960, 540, 1], [800, 450, 1], [640, 400, 1], [520, 640, 1], [400, 620, 1], [400, 480, 1], [800, 450, 1.25], [800, 450, 1.5]];
// PIP (settings.breakView = 'pip'; 400×580 is the default): a dense grid from the minimum up, plus
// display scaling. `-- --only=400x580,640x360@150` limits the window / PIP sizes while iterating.
const PIP_W = [320, 360, 400, 480, 560, 640, 720, 960];
const PIP_H = [300, 360, 420, 480, 580, 720, 800];
const PIP_SIZES = [
  ...PIP_H.flatMap((h) => PIP_W.map((w) => [w, h, 1])).filter(([w, h]) => w >= W.PIP_MIN.width && h >= W.PIP_MIN.height),
  [W.PIP_MIN.width, W.PIP_MIN.height, 1], [300, 169, 1], [330, 420, 1], [480, 270, 1], [960, 540, 1], [W.PIP_SIZE.width, W.PIP_SIZE.height, 1],
  [400, 580, 1.25], [400, 580, 1.5], [640, 360, 1.25], [640, 360, 1.5]];
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const sizeTag = (w, h, z) => `${w}x${h}${z === 1 ? '' : `@${Math.round(z * 100)}`}`;
// PIP: the form and fit overlay.js pipFit chose, and where the clip renders (DESIGN.md §4b)
const PIP_PROBE = `(() => { const r = document.querySelector('.vbox').getBoundingClientRect();
  return JSON.stringify({ form: document.documentElement.dataset.pipForm, fit: document.documentElement.dataset.fit,
    clip: [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10), vw: innerWidth, vh: innerHeight }); })()`;

async function settleLayout(win) {
  await win.webContents.executeJavaScript(
    'document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))))',
  );
  await delay(120);
}

async function resize(win, w, h, zoom = 1, quiet = false) {
  win.setMinimumSize(100, 100);
  win.setPosition(0, 0); // stay on the primary display: a size that reaches a second display at another scale comes back garbled
  win.setContentSize(w, h);
  win.webContents.setZoomFactor(zoom);
  await delay(200);
  await settleLayout(win);
  const [cw, ch] = win.getContentSize();
  const inner = await js(win, '[innerWidth, innerHeight]');
  if ((cw !== w || ch !== h) && !quiet) console.log(`  WARN content size ${cw}x${ch} != ${w}x${h}`);
  return inner;
}

// Windowed overlay: does the stage scroll, and can the primary button (or the dialog's OK) be
// scrolled fully into view? Leaves the stage scrolled back to the top.
const REACH_CHECK = `(() => {
  const st = document.getElementById('stage');
  const modal = !document.getElementById('modal').hidden;
  const b = modal ? document.getElementById('mOk') : document.querySelector('#pPri .btn');
  const over = st.scrollHeight - st.clientHeight;
  let reach = true, msg = '';
  if (b) {
    b.scrollIntoView({ block: 'nearest' });
    const r = b.getBoundingClientRect();
    reach = r.top >= -1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.right <= innerWidth + 1;
    msg = [r.top, r.bottom, innerHeight].map(Math.round).join('/');
  }
  st.scrollTop = 0;
  return JSON.stringify({ reach, msg, sel: b ? b.id : '', scrolls: over > 1, over });
})()`;

async function matrix(ctl, mw) {
  // `-- --mdir=<name>`: write to selftest-out/<name> (several matrix runs side by side)
  const dir = path.join(OUT, (process.argv.find((a) => a.startsWith('--mdir=')) || '--mdir=matrix').slice(7));
  fs.mkdirSync(dir, { recursive: true });
  const runs = [];
  const snap = async (win, name, lintOpts) => {
    await settleLayout(win);
    const [width, height] = win.getContentSize();
    const img = await win.webContents.capturePage({ x: 0, y: 0, width, height }, { stayHidden: true });
    // AV / the indexer can briefly lock or hide a just-written PNG on this box: retry, don't abort the run.
    const png = img.toPNG();
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${name}.png`), png); break; }
      catch (e) { if (i >= 4 || !['EBUSY', 'EPERM', 'EACCES', 'ENOENT'].includes(e.code)) throw e; await delay(250); }
    }
    if (!lintOpts) return;
    const res = await js(win, `${lintSource}(${JSON.stringify({ tokens: TOKENS, groups: GROUPS, roles: ROLES, ...lintOpts })})`);
    runs.push({ name, viewport: res.viewport, issues: res.issues, combos: res.combos });
  };

  const failDay = Object.keys(ctl.data.days).sort().reverse().find((k) => ctl.data.days[k].status === 'fail' && ctl.data.days[k].events.length);
  const MAIN_STATES = [
    ['today', "__test.close(); __test.tab('today'); __test.filter('d1'); __test.scroll(0)", true],
    ['today-bottom', '__test.scroll(100000)', false],
    ['today-done', "__test.scroll(0); __test.hero('done')", true],
    ['today-rest', "__test.hero('rest')", true],
    ['library-stretch', "__test.filter('stretch'); __test.scroll(100000)", true],
    ['player', "__test.filter('d1'); __test.scroll(0); __test.hero(null); __test.open('pushup')", true],
    ['workout', "__test.close(); __test.workout('d2')", true],
    ['history', `__test.close(); __test.tab('history'); __test.select('${failDay}').then(() => __test.scroll(0))`, true],
    ['history-bottom', '__test.scroll(100000)', false],
    ['settings', "__test.tab('settings'); __test.scroll(0)", true],
    ['settings-bottom', '__test.scroll(100000)', false],
  ];
  let d3key = TODAY;
  while (C.planDayFor(d3key, ctl.data.settings, plan.cycle) !== 'd3') d3key = T.addDays(d3key, 1);
  const d3 = D.createDay(d3key, ctl.data.settings, plan);
  const openFor = async (pd) => {
    const payload = pd === 'd1' ? ctl.buildPayload(TODAY, ctl.ensureToday(), 'slot', 6)
      : pd === 'stretch' ? stretchPayload(ctl)
        : pd === 'session' ? ctl.buildSessionPayload(TODAY, D.createDay(TODAY, ctl.data.settings, plan, 600), 'd2')
          : ctl.buildPayload(d3key, d3, 'slot', D.lastSlot(d3));
    payload.showDemo = true;
    ctl.openBreak('test', null, payload);
    const ow = ctl.overlayWins[0];
    await waitLoad(ow);
    await until(ow, 'window.__test && window.__test.ready()');
    return ow;
  };
  const scrolled = [];
  const pipProbe = {}; // `${pre}${theme} ${screen}` -> { requested size: probe }
  const pipDone = new Set();
  const OV = [
    ['d1', [['intro', "__test.show('intro', { remaining: 7.3 })"], ['demo', "__test.show('demo', { remaining: 5.2 })"],
      ['work', "__test.show('work', { elapsed: 23 })"], ['rest', "__test.show('rest', { remaining: 42, reps: 12 })"],
      ['finish', "__test.show('finish', { sets: 6, afterWork: true, reps: 13 })"], ['leave', "__test.show('work', { elapsed: 23 }) && __test.leave()"]]],
    ['d3', [['last-intro', "__test.show('intro', { remaining: 9.1 })"], ['timed', "__test.show('timed', { nth: 2, remaining: 18.2 })"],
      ['round-rest', "__test.show('roundRest', { remaining: 152 })"], ['finish-pass', "__test.show('finish', { sets: 2 })"]]],
    ['stretch', STRETCH_SCREENS.filter(([n]) => !['stretch-hold-single', 'stretch-finish-fail'].includes(n)).map(([n, code]) => [n, code])],
    ['session', [['session-intro', "__test.show('intro', { remaining: 8 })"], ['session-rest', "__test.show('rest', { nth: 6, remaining: 38, reps: 11 })"],
      ['session-finish', "__test.show('finish', { sets: 25, stretchDone: true })"]]],
  ];

  const WOV = [
    ['d1', OV[0][1]],
    ['d3', [['last-intro', "__test.show('intro', { remaining: 9.1 })"], ['preview', "__test.show('preview', { nth: 1, remaining: 3.2 })"],
      ['timed', "__test.show('timed', { nth: 2, remaining: 18.2 })"], ['round-rest', "__test.show('roundRest', { remaining: 152 })"],
      ['finish-pass', "__test.show('finish', { sets: 2 })"], ['skip', "__test.show('intro', { remaining: 9.1 }) && __test.skip()"]]],
    ['stretch', [['stretch-preview', "__test.show('stretchPreview', { remaining: 3.6 })"], ['stretch-hold', "__test.show('hold', { nth: 1, remaining: 12.2 })"]]],
    ['session', [['session-intro', "__test.show('intro', { remaining: 8 })"]]],
  ];

  // 繁中 in both themes at every size; English (longer words) in dark at the sizes that bound the layouts.
  const ALL_PASSES = [['dark', 'zh', ''], ['light', 'zh', ''], ['dark', 'en', 'en-']];
  // `-- --matrix --en`: the English pass only (quick iteration on text length)
  // `-- --passes=dark,light`: those passes only (pass name = file prefix + theme: dark, light, en-dark)
  const only = (process.argv.find((a) => a.startsWith('--passes=')) || '').slice(9).split(',').filter(Boolean);
  const PASSES = process.argv.includes('--en') ? ALL_PASSES.filter((p) => p[1] === 'en')
    : only.length ? ALL_PASSES.filter(([theme, , pre]) => only.includes(pre + theme)) : ALL_PASSES;
  for (const [theme, lang, pre] of PASSES) {
    console.log(`matrix ${pre}${theme}`);
    await js(mw, `window.bf.saveSettings({ theme: '${theme}', lang: '${lang}' }).then(() => true)`);
    await delay(300);
    const base = lang === 'en' ? EN_MAIN_SIZES : MAIN_SIZES;
    const sizes = QUICK
      ? base.filter(([w]) => [965, 1366, 1920, 2560].includes(w)).map(([w, h]) => [w, h, 1])
      : [...base.map(([w, h]) => [w, h, 1]), ...(lang === 'en' ? [] : ZOOMS)];
    for (const [w, h, z] of WONLY ? [] : sizes) {
      const inner = await resize(mw, w, h, z);
      const tag = `${w}x${h}${z === 1 ? '' : `@${Math.round(z * 100)}`}`;
      for (const [screen, code, doLint] of MAIN_STATES) {
        await js(mw, code);
        await snap(mw, `${pre}${theme}-${screen}-${tag}`, doLint ? { kind: 'main', root: screen === 'player' ? '#player' : screen === 'workout' ? '#workout' : 'body' } : null);
      }
      console.log(`  main ${tag} (css ${inner.join('x')})`);
    }
    await js(mw, '__test.close()');
    await resize(mw, 1280, 800, 1);
    for (const [pd, states] of QUICK || WONLY ? [] : OV) {
      const payload = pd === 'd1' ? ctl.buildPayload(TODAY, ctl.ensureToday(), 'slot', 6)
        : pd === 'stretch' ? stretchPayload(ctl)
          : pd === 'session' ? ctl.buildSessionPayload(TODAY, D.createDay(TODAY, ctl.data.settings, plan, 600), 'd2')
          : ctl.buildPayload(d3key, d3, 'slot', D.lastSlot(d3));
      payload.showDemo = true;
      ctl.openBreak('test', null, payload);
      const ow = ctl.overlayWins[0];
      await waitLoad(ow);
      await until(ow, 'window.__test && window.__test.ready()');
      for (const [w, h] of lang === 'en' ? EN_OV_SIZES : OV_SIZES) {
        await resize(ow, w, h, 1);
        for (const [screen, code] of states) {
          await js(ow, code);
          await snap(ow, `${pre}${theme}-ov-${screen}-${w}x${h}`, { kind: 'overlay' });
        }
        console.log(`  overlay ${pd} ${w}x${h}`);
      }
      ctl.endBreak('abort');
      await delay(150);
    }

    // window + PIP overlay: every phase + both dialogs at every size; the stage may scroll only when
    // the window is too short, and the primary button must always be reachable
    for (const [view, SIZES, short] of [['window', WIN_SIZES, 'win'], ['pip', PIP_SIZES, 'pip']].filter(([v]) => (!process.argv.includes('--pip') || v === 'pip') && (!process.argv.includes('--nopip') || v !== 'pip'))) for (const [pd, states] of QUICK ? [] : WOV) {
      ctl.data.settings.breakView = view;
      const ow = await openFor(pd);
      assert(ctl.overlayView === view && await js(ow, `document.documentElement.dataset.view === '${view}'`), `matrix ${pd}: break opens as ${view}`);
      for (const [w, h, z] of SIZES.filter(([w, h, z]) => !ONLY.length || ONLY.includes(sizeTag(w, h, z)))) {
        await resize(ow, w, h, z);
        const tag = sizeTag(w, h, z);
        for (const [screen, code] of states) {
          await js(ow, code);
          if (view === 'pip') {
            await settleLayout(ow); // late font loads re-run pipFit
            if (/does not fit/.test(await js(ow, '__test.pipFit()'))) console.log(`  WARN ${screen} ${tag}: the PIP bar does not fit`);
            const [aw, ah] = ow.getContentSize();
            const atag = sizeTag(aw, ah, z);
            const name = `${pre}${theme}-${short}-${screen}-${atag}`;
            const pr = { ...JSON.parse(await js(ow, PIP_PROBE)), at: atag };
            (pipProbe[`${pre}${theme} ${screen}`] ||= {})[tag] = pr;
            if (pipDone.has(name)) continue;
            pipDone.add(name);
            // PIP never scrolls: lint rules j (no scroller, content ≤ viewport, primary inside) and k (drag)
            await snap(ow, name, { kind: 'overlay', pip: true });
            continue;
          }
          await snap(ow, `${pre}${theme}-${short}-${screen}-${tag}`, { kind: 'overlay', scroller: '#stage' });
          const r = JSON.parse(await js(ow, REACH_CHECK));
          const run = runs[runs.length - 1];
          if (!r.reach) run.issues.push({ rule: 'i-reach', sel: r.sel, text: '', size: '', msg: `primary button not reachable (${r.msg})` });
          if (r.scrolls) scrolled.push(`${run.name} (${r.over}px)`);
        }
      }
      console.log(`  ${view} ${pd}: ${runs.reduce((a, r) => a + r.issues.length, 0)} issues so far`);
      fs.writeFileSync(path.join(dir, 'lint-partial.json'), JSON.stringify(runs.filter((r) => r.issues.length).map((r) => ({ name: r.name, issues: r.issues })), null, 1));
      ctl.endBreak('abort');
      await delay(150);
    }
    ctl.data.settings.breakView = 'full';
    // after every pass: the issues so far (a long run can be read while it goes on)
    fs.writeFileSync(path.join(dir, 'lint-partial.json'), JSON.stringify(runs.filter((r) => r.issues.length).map((r) => ({ name: r.name, issues: r.issues })), null, 1));
  }
  console.log(`window screens that scroll: ${scrolled.length}${scrolled.length ? `\n  ${scrolled.join('\n  ')}` : ''}`);
  // PIP clip (rule l): the largest 16:9 the window holds (width min(W, H × 16/9)), at the top edge —
  // whatever the form. pipForms: form / rows / number size / level per size.
  const pipForms = {};
  const clipIssue = (name, msg) => runs.push({ name, viewport: '', combos: {}, issues: [{ rule: 'l-clip', sel: '.vbox', text: '', size: '', msg }] });
  for (const [key, bySz] of Object.entries(pipProbe)) {
    const [pass, screen] = key.split(' ');
    for (const [tag, p] of Object.entries(bySz)) {
      ((pipForms[pass] ||= {})[screen] ||= {})[tag] = `${p.form} ${p.fit}${p.at !== tag ? ` -> ${p.at}` : ''}`;
      const [, top, cw, ch] = p.clip;
      const ww = Math.min(p.vw, (p.vh * 16) / 9);
      const want = [ww, (ww * 9) / 16];
      if (Math.abs(cw - want[0]) > 1.5 || Math.abs(ch - want[1]) > 1.5 || Math.abs(top) > 1) {
        clipIssue(`${pass}-pip-${screen}-${p.at}`, `${p.form} clip ${cw}×${ch} at y ${top}, want ${want.map(Math.round).join('×')} at y 0`);
      }
    }
    const tall = PIP_W.map((w) => [w, bySz[`${w}x800`]]).filter(([, p]) => p);
    for (let i = 1; i < tall.length; i++) {
      if (tall[i][1].clip[2] + 1 < tall[i - 1][1].clip[2]) clipIssue(`${pass}-pip-${screen}-${tall[i][0]}x800`, `clip ${tall[i][1].clip[2]}px at ${tall[i][0]} wide < ${tall[i - 1][1].clip[2]}px at ${tall[i - 1][0]}`);
    }
  }
  for (const [pass, f] of Object.entries(pipForms).slice(0, 1)) {
    if (!f.rest) continue;
    console.log(`PIP form per size (${pass} rest screen):`);
    for (const h of PIP_H) console.log(`  ${h}: ${PIP_W.map((w) => `${w}=${(f.rest[`${w}x${h}`] || '-').replace(' -> ', '>')}`).join('  ')}`);
  }

  // summary: issue counts per size and rule, distinct type combos
  const bySize = {};
  const byRule = {};
  const combos = {};
  for (const r of runs) {
    const m = /-(\d+x\d+(?:@\d+)?)$/.exec(r.name);
    const key = `${r.name.startsWith('en-') ? 'en ' : ''}${r.name.includes('-ov-') ? 'overlay' : r.name.includes('-win-') ? 'window' : r.name.includes('-pip-') ? 'pip' : 'main'} ${m ? m[1] : '?'}`;
    bySize[key] = (bySize[key] || 0) + r.issues.length;
    for (const i of r.issues) byRule[i.rule] = (byRule[i.rule] || 0) + 1;
    for (const [k, v] of Object.entries(r.combos)) {
      const c = combos[k] || (combos[k] = { count: 0, token: v.token, eg: v.eg });
      c.count += v.count;
    }
  }
  const total = runs.reduce((a, r) => a + r.issues.length, 0);
  fs.writeFileSync(path.join(dir, 'lint.json'), JSON.stringify({ total, bySize, byRule, combos, pipForms, runs }, null, 1));
  console.log(`\nmatrix: ${runs.length} linted screens, ${total} issues -> ${path.join(dir, 'lint.json')}`);
  console.log(JSON.stringify(bySize));
  console.log(JSON.stringify(byRule));
  return 0;
}

function run() {
  const guard = setTimeout(() => {
    console.error(`SELFTEST TIMEOUT (${MATRIX ? 14400 : 240} s)`);
    app.exit(2);
  }, MATRIX ? 14400000 : 240000); // the full matrix (dense PIP grid) takes ≈ 2.5 h
  app.on('window-all-closed', () => {});
  app.whenReady()
    .then(main)
    .catch((e) => {
      console.error('SELFTEST ERROR', e && e.stack ? e.stack : e);
      return 1;
    })
    .then((code) => {
      clearTimeout(guard);
      const dir = app.getPath('userData');
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* files still in use */ }
      app.exit(code);
    });
}

module.exports = { run };
