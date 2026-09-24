'use strict';
// --selftest: temp userData, frozen fake clock, hidden 1280×720 windows (never fullscreen,
// never focused), walks every overlay phase + every main-window tab, saves PNGs, quits.
const { app } = require('electron');
// If the runner that spawned us goes away, console.log hits a closed pipe (EPIPE): stay silent, don't pop a dialog.
for (const s of [process.stdout, process.stderr]) s.on('error', () => {});
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createController, createClock } = require('./app');
const T = require('../core/time');
const D = require('../core/day');
const C = require('../core/cycle');
const plan = require('../../plan.json');
const { lintSource } = require('./layout-lint');

const MATRIX = process.argv.includes('--matrix'); // `npm.cmd run selftest -- --matrix`: size matrix + layout lint only
const QUICK = process.argv.includes('--quick'); // with --matrix: main window at 965/1366/1920/2560 only, no zoom, no overlay

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
  else if (fs.existsSync(OUT)) for (const f of fs.readdirSync(OUT)) if (f !== 'matrix') fs.rmSync(path.join(OUT, f), { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const clock = createClock({ base: new Date(2026, 8, 24, 13, 59, 30), rate: 0 });
  const ctl = createController({ clock, selftest: true });
  assert(ctl.file.startsWith(os.tmpdir()), `data file is temp: ${ctl.file}`);
  seedHistory(ctl);
  ctl.initSettings();
  const today = seedToday(ctl);
  ctl.data.days[TODAY].status = D.gradeDay(today, TODAY, TODAY);
  ctl.registerIpc();
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

  const press = (win, key, repeat = false) => js(win, `__test.key(${JSON.stringify(key)}, ${repeat})`);

  // ---------- last break of a 第 3 天 (circuits) ----------
  console.log('overlay (d3, last break)');
  let d3key = TODAY;
  while (C.planDayFor(d3key, ctl.data.settings, plan.cycle) !== 'd3') d3key = T.addDays(d3key, 1);
  const d3 = D.createDay(d3key, ctl.data.settings, plan);
  const payload = ctl.buildPayload(d3key, d3, 'slot', D.lastSlot(d3));
  assert(payload.isLast && payload.items.length === 2, 'last-break payload has both circuit rounds');
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
  await delay(450);
  assert(await press(ow4, ' ') === 'timed', 'demo OFF: circuit intro → straight to the timed move');
  await js(ow4, "__test.show('timed', { remaining: 27 })");
  await shot(ow4, '42-demo-off-circuit', '示範關閉：腹肌循環直接開始 30 秒');
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
  await delay(450);
  await press(ow6, 'Enter');
  await delay(300);
  assert(!ctl.currentBreak && ow6.isDestroyed(), 'Enter on finish → 關閉 → overlay closed');
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
  await settle(mw);
  for (const [name, code] of [['today', "__test.tab('today'); __test.scroll(0)"], ['library-d3', "__test.filter('d3')"], ['player', "__test.open('pushup')"],
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
  const coverE2 = ctl.openCoverForTest();
  await waitLoad(coverE2);
  assert(await js(coverE2, "document.querySelector('.c div').textContent + '|' + document.title") === 'On a Break|On a Break', 'new cover opens in English');
  coverE2.destroy();
  await js(mw, "document.querySelector('#sLang [data-l=\"zh\"]').click(); true");
  await delay(300);
  assert(ctl.data.settings.lang === 'zh' && await js(mw, "document.querySelector('.nav-item[data-tab=\"today\"] .nav-label').textContent") === '今天', 'switches back to 繁中 live');

  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, failures }, null, 2));
  console.log(`\n${results.length} screenshots → ${OUT}`);
  console.log(failures.length ? `SELFTEST FAIL (${failures.length})` : 'SELFTEST PASS');
  return failures.length ? 1 : 0;
}

// ---------- size matrix + layout lint (DESIGN.md §10) ----------
// Type tokens (DESIGN.md §3). Overlay sizes are rem × 16, so one list serves both windows.
const TOKENS = [
  { name: 'footnote', size: 13, lh: 18, weights: [400, 600] },
  { name: 'subheadline', size: 15, lh: 20, weights: [400, 600] },
  { name: 'body', size: 17, lh: 24, weights: [400] },
  { name: 'headline', size: 17, lh: 24, weights: [600] },
  { name: 'title3', size: 21, lh: 26, weights: [400, 600] },
  { name: 'title2', size: 28, lh: 34, weights: [600] },
  { name: 'largeTitle', size: 34, lh: 41, weights: [400, 600] },
  { name: 'display', size: 40, lh: 48, weights: [600] },
  { name: 'ring', size: 48, lh: 48, weights: [700] },
  { name: 'ring3', size: 36, lh: 36, weights: [700] },
  { name: 'hero', size: 96, lh: 96, weights: [700] },
];
const GROUPS = [
  { scope: '.set-grid > .panel', row: '.field', cols: [[':scope > label', 'left'], [':scope > :last-child', 'right']] },
  { scope: '.ov-col', row: '.ov-row', cols: [['.nm', 'left'], ['[data-k="sets"]', 'left'], ['[data-k="sets"]', 'right'], ['[data-k="a"]', 'left'], ['[data-k="b"]', 'right'], ['.reset', 'right']] },
  { scope: '.ov-col', row: '.ov-head, .ov-row', cols: [['.l-sets, [data-k="sets"]', 'center']] },
  { scope: '.timeline', row: 'li', cols: [['.t', 'left'], ['.st', 'right']] },
  { scope: '.detail .sec', row: '.urow', cols: [[':scope > :first-child', 'left'], ['.c', 'right']] },
  { scope: '.plan', row: 'li', cols: [['.nm', 'left'], ['.mt', 'right']] },
];
// Rule (h): comparable elements that must render with one token (DESIGN.md §3).
const ROLES = {
  'page title': '.page-head h1', eyebrow: '.eyebrow', 'panel title': '.panel-head h2',
  'card title': '.card .k', 'card value': '.card .v', 'row label': '.field > label',
  'table header': '.ov-head .lbl', 'table name': '.ov-row .nm', segment: '.seg button:not(.on)',
  'weekday toggle': '.days button:not(.on)', 'timeline status': '.timeline li:not(.next) .st',
  'calendar day': '.cell .d', 'overlay meta': '.p-meta',
};
const MAIN_SIZES = [[800, 600], [900, 700], [965, 940], [1024, 768], [1280, 720], [1366, 768], [1440, 900], [1600, 900], [1920, 1080], [2560, 1440]];
const ZOOMS = [[965, 940, 1.25], [965, 940, 1.5]];
const EN_MAIN_SIZES = [[800, 600], [965, 940], [1366, 768], [1920, 1080], [2560, 1440]];
const EN_OV_SIZES = [[1024, 768], [1366, 768], [1920, 1080]];
const OV_SIZES = [[1024, 768], [1280, 720], [1280, 800], [1366, 768], [1440, 900], [1536, 864], [1920, 1080], [2560, 1440]];

async function settleLayout(win) {
  await win.webContents.executeJavaScript(
    'document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))))',
  );
  await delay(120);
}

async function resize(win, w, h, zoom = 1) {
  win.setMinimumSize(100, 100);
  win.setContentSize(w, h);
  win.webContents.setZoomFactor(zoom);
  await delay(200);
  await settleLayout(win);
  const [cw, ch] = win.getContentSize();
  const inner = await js(win, '[innerWidth, innerHeight]');
  if (cw !== w || ch !== h) console.log(`  WARN content size ${cw}x${ch} != ${w}x${h}`);
  return inner;
}

async function matrix(ctl, mw) {
  const dir = path.join(OUT, 'matrix');
  fs.mkdirSync(dir, { recursive: true });
  const runs = [];
  const snap = async (win, name, lintOpts) => {
    await settleLayout(win);
    const [width, height] = win.getContentSize();
    const img = await win.webContents.capturePage({ x: 0, y: 0, width, height }, { stayHidden: true });
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
    if (!lintOpts) return;
    const res = await js(win, `${lintSource}(${JSON.stringify({ tokens: TOKENS, groups: GROUPS, roles: ROLES, ...lintOpts })})`);
    runs.push({ name, viewport: res.viewport, issues: res.issues, combos: res.combos });
  };

  const failDay = Object.keys(ctl.data.days).sort().reverse().find((k) => ctl.data.days[k].status === 'fail' && ctl.data.days[k].events.length);
  const MAIN_STATES = [
    ['today', "__test.close(); __test.tab('today'); __test.filter('d1'); __test.scroll(0)", true],
    ['today-bottom', '__test.scroll(100000)', false],
    ['player', "__test.open('pushup')", true],
    ['history', `__test.close(); __test.tab('history'); __test.select('${failDay}').then(() => __test.scroll(0))`, true],
    ['history-bottom', '__test.scroll(100000)', false],
    ['settings', "__test.tab('settings'); __test.scroll(0)", true],
    ['settings-bottom', '__test.scroll(100000)', false],
  ];
  let d3key = TODAY;
  while (C.planDayFor(d3key, ctl.data.settings, plan.cycle) !== 'd3') d3key = T.addDays(d3key, 1);
  const d3 = D.createDay(d3key, ctl.data.settings, plan);
  const OV = [
    ['d1', [['intro', "__test.show('intro', { remaining: 7.3 })"], ['demo', "__test.show('demo', { remaining: 5.2 })"],
      ['work', "__test.show('work', { elapsed: 23 })"], ['rest', "__test.show('rest', { remaining: 42, reps: 12 })"],
      ['finish', "__test.show('finish', { sets: 6, afterWork: true, reps: 13 })"], ['leave', "__test.show('work', { elapsed: 23 }) && __test.leave()"]]],
    ['d3', [['last-intro', "__test.show('intro', { remaining: 9.1 })"], ['timed', "__test.show('timed', { nth: 2, remaining: 18.2 })"],
      ['round-rest', "__test.show('roundRest', { remaining: 152 })"], ['finish-pass', "__test.show('finish', { sets: 2 })"]]],
  ];

  // 繁中 in both themes at every size; English (longer words) in dark at the sizes that bound the layouts.
  const ALL_PASSES = [['dark', 'zh', ''], ['light', 'zh', ''], ['dark', 'en', 'en-']];
  // `-- --matrix --en`: the English pass only (quick iteration on text length)
  const PASSES = process.argv.includes('--en') ? ALL_PASSES.filter((p) => p[1] === 'en') : ALL_PASSES;
  for (const [theme, lang, pre] of PASSES) {
    console.log(`matrix ${pre}${theme}`);
    await js(mw, `window.bf.saveSettings({ theme: '${theme}', lang: '${lang}' }).then(() => true)`);
    await delay(300);
    const base = lang === 'en' ? EN_MAIN_SIZES : MAIN_SIZES;
    const sizes = QUICK
      ? base.filter(([w]) => [965, 1366, 1920, 2560].includes(w)).map(([w, h]) => [w, h, 1])
      : [...base.map(([w, h]) => [w, h, 1]), ...(lang === 'en' ? [] : ZOOMS)];
    for (const [w, h, z] of sizes) {
      const inner = await resize(mw, w, h, z);
      const tag = `${w}x${h}${z === 1 ? '' : `@${Math.round(z * 100)}`}`;
      for (const [screen, code, doLint] of MAIN_STATES) {
        await js(mw, code);
        await snap(mw, `${pre}${theme}-${screen}-${tag}`, doLint ? { kind: 'main', root: screen === 'player' ? '#player' : 'body' } : null);
      }
      console.log(`  main ${tag} (css ${inner.join('x')})`);
    }
    await js(mw, '__test.close()');
    await resize(mw, 1280, 800, 1);
    for (const [pd, states] of QUICK ? [] : OV) {
      const payload = pd === 'd1'
        ? ctl.buildPayload(TODAY, ctl.ensureToday(), 'slot', 6)
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
  }

  // summary: issue counts per size and rule, distinct type combos
  const bySize = {};
  const byRule = {};
  const combos = {};
  for (const r of runs) {
    const m = /-(\d+x\d+(?:@\d+)?)$/.exec(r.name);
    const key = `${r.name.startsWith('en-') ? 'en ' : ''}${r.name.includes('-ov-') ? 'overlay' : 'main'} ${m ? m[1] : '?'}`;
    bySize[key] = (bySize[key] || 0) + r.issues.length;
    for (const i of r.issues) byRule[i.rule] = (byRule[i.rule] || 0) + 1;
    for (const [k, v] of Object.entries(r.combos)) {
      const c = combos[k] || (combos[k] = { count: 0, token: v.token, eg: v.eg });
      c.count += v.count;
    }
  }
  const total = runs.reduce((a, r) => a + r.issues.length, 0);
  fs.writeFileSync(path.join(dir, 'lint.json'), JSON.stringify({ total, bySize, byRule, combos, runs }, null, 1));
  console.log(`\nmatrix: ${runs.length} linted screens, ${total} issues -> ${path.join(dir, 'lint.json')}`);
  console.log(JSON.stringify(bySize));
  console.log(JSON.stringify(byRule));
  return 0;
}

function run() {
  const guard = setTimeout(() => {
    console.error(`SELFTEST TIMEOUT (${MATRIX ? 900 : 150} s)`);
    app.exit(2);
  }, MATRIX ? 900000 : 150000);
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
