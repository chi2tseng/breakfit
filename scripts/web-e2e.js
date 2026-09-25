'use strict';
// Web build smoke test: npx electron scripts/web-e2e.js  (run npm run build:web first)
// Serves web-dist/ under /breakfit/ (like GitHub Pages), drives it in a hidden Chromium window,
// writes selftest-out/web/*.png and prints a JSON report. Exit code 1 on any failed check.
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { lintSource, TOKENS, GROUPS, ROLES } = require('../src/main/layout-lint');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'web-dist');
const OUT = path.join(ROOT, 'selftest-out', 'web');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const results = [];
const check = (name, ok, info) => { results.push({ name, ok: !!ok, ...(info === undefined ? {} : { info }) }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  const bad = [];
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!u.startsWith('/breakfit/')) { bad.push(u); res.writeHead(404).end(); return; }
    let f = path.join(DIST, u.slice('/breakfit/'.length));
    if (u.endsWith('/')) f = path.join(f, 'index.html');
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { bad.push(u); res.writeHead(404).end(); return; }
    const data = fs.readFileSync(f);
    const range = req.headers.range && /bytes=(\d+)-(\d*)/.exec(req.headers.range);
    const type = TYPES[path.extname(f)] || 'application/octet-stream';
    if (range) {
      const a = +range[1];
      const b = range[2] ? +range[2] : data.length - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${a}-${b}/${data.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1 });
      res.end(data.subarray(a, b + 1));
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes' }).end(data);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, bad, port: srv.address().port })));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { srv, bad, port } = await serve();
  const base = `http://127.0.0.1:${port}/breakfit/`;
  const errors = [];
  const win = new BrowserWindow({
    show: false, useContentSize: true, width: 1366, height: 768, paintWhenInitiallyHidden: true,
    webPreferences: { partition: `bfweb-${Date.now()}`, backgroundThrottling: false, offscreen: false },
  });
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) errors.push(e.message); });
  const js = (code) => win.webContents.executeJavaScript(code);
  const until = async (expr, ms = 8000) => {
    const t = Date.now() + ms;
    while (Date.now() < t) {
      try { if (await js(expr)) return true; } catch (_) { /* navigating */ }
      await sleep(100);
    }
    return false;
  };
  const shot = async (name) => {
    await sleep(350);
    const img = await win.webContents.capturePage(undefined, { stayHidden: true });
    fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
  };
  const frame = (expr) => `(() => { const f = document.querySelector('.bf-window'); const w = f && f.contentWindow; return w ? (${expr}) : null; })()`;
  const size = async (w, h) => { win.setContentSize(w, h); await sleep(300); };

  await win.loadURL(base);
  check('main page ready', await until('window.__test && window.__test.ready()'));
  check('url stays under /breakfit/', (await js('location.pathname')) === '/breakfit/');
  check('desktop-only row hidden', await js("getComputedStyle(document.querySelector('#sLaunch').closest('.field')).display === 'none'"));
  check('fonts loaded', await js("document.fonts.ready.then(() => document.fonts.check('17px Inter') && document.fonts.check('24px \"Material Symbols Outlined\"'))"));

  // tabs, desktop 1366×768
  await shot('desktop-today');
  for (const t of ['history', 'settings']) { await js(`__test.tab('${t}')`); await shot(`desktop-${t}`); }

  // persistence: light theme + a note survive reload
  await js("document.querySelector('#sTheme [data-t=light]').click()");
  await until("document.documentElement.dataset.theme === 'light'");
  await js('__test.tab("today")');
  const key = await js('bf.getState().then((s) => s.today)');
  await js(`bf.setNote('${key}', 'web-e2e note')`);
  win.webContents.reload();
  check('reload: ready', await until('window.__test && window.__test.ready()'));
  check('reload: theme kept', (await js('document.documentElement.dataset.theme')) === 'light');
  check('reload: note kept', (await js(`bf.getDay('${key}').then((d) => d.day && d.day.note)`)) === 'web-e2e note');
  await shot('desktop-today-light');

  // language: English applies live and survives reload, then back to 繁中 for the rest
  await js("__test.tab('settings'); document.querySelector('#sLang [data-l=en]').click()");
  check('lang: English live', await until("document.documentElement.lang === 'en' && document.querySelector('[data-tab=today] .nav-label').textContent === 'Today'"));
  await shot('desktop-settings-en');
  win.webContents.reload();
  check('lang: kept after reload', await until("window.__test && window.__test.ready() && document.documentElement.lang === 'en'"));
  await js("document.querySelector('#sLang [data-l=zh]').click(); __test.tab('today')");
  check('lang: back to 繁中', await until("/^zh/.test(document.documentElement.lang)"));

  // test break: demo → work → rest, then leave
  await js("document.querySelector('#testBreakBtn').click()");
  check('overlay frame opens', await until(frame('w.__test && w.__test.ready()')));
  check('page behind overlay is inert', await js("document.querySelector('#content').inert === true"));
  const phases = await js(frame('w.__test.steps()'));
  check('overlay steps', Array.isArray(phases) && phases.length > 0, phases);
  await shot('desktop-break-intro');
  // real click on the primary button: user gesture → fullscreen request
  const r = await js(frame("(() => { const b = w.document.querySelector('#pPri .btn'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()"));
  win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(r.x), y: Math.round(r.y), button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(r.x), y: Math.round(r.y), button: 'left', clickCount: 1 });
  await sleep(600);
  check('start click advanced phase', (await js(frame('w.__test.phase()'))) !== 'intro', await js(frame('w.__test.phase()')));
  check('fullscreen on Start click', await until('document.fullscreenElement === document.querySelector(".bf-window")', 2000));
  for (const k of ['demo', 'work', 'rest']) {
    const ok = await js(frame(`w.__test.show('${k}')`));
    if (ok) await shot(`desktop-break-${k}`);
    else check(`phase ${k} exists`, false);
  }
  await js(frame("w.bf.end('abort')"));
  check('overlay closes', await until('!document.querySelector(".bf-window")'));
  check('page usable again', await js("document.querySelector('#content').inert === false"));
  await js('document.fullscreenElement && document.exitFullscreen()');

  // phone 390×844
  await js("document.querySelector('#sTheme [data-t=dark]').click()");
  await size(390, 844);
  await js('__test.tab("today")');
  await shot('phone-today');
  await js('__test.tab("history")');
  await shot('phone-history');
  await js('__test.tab("settings")');
  await shot('phone-settings');
  // layout lint (DESIGN.md §10) at phone widths, both languages, top and bottom of every tab
  const phone = [];
  for (const [pw, ph] of [[390, 844], [360, 740]]) {
    await size(pw, ph);
    for (const lang of ['zh', 'en']) {
      await js(`bf.saveSettings({ lang: '${lang}' }).then(() => true)`);
      await until(`document.documentElement.lang.startsWith('${lang}')`);
      for (const tab of ['today', 'history', 'settings']) {
        for (const y of [0, 100000]) {
          await js(`__test.tab('${tab}'); __test.scroll(${y})`);
          await js('document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))))');
          await sleep(150);
          const res = await js(`${lintSource}(${JSON.stringify({ kind: 'main', tokens: TOKENS, groups: GROUPS, roles: ROLES })})`);
          for (const i of res.issues) phone.push(`${lang} ${tab}${y ? '-bottom' : ''} ${pw}: ${i.rule} ${i.sel} ${i.msg}`);
        }
      }
    }
  }
  check('phone layout lint 0 (390, 360 × 繁中, English)', phone.length === 0, phone.slice(0, 40));
  await js("bf.saveSettings({ lang: 'zh' }).then(() => true)");
  await size(390, 844);
  const pause = await js("!!document.querySelector('.bf-dock .nav-item')");
  if (pause) {
    await js("document.querySelector('.bf-dock .nav-item').click()");
    await shot('phone-pause-menu');
    await js("document.querySelector('.bf-menu').hidden = true");
  }
  await js("document.querySelector('#testBreakBtn').click()");
  await until(frame('w.__test && w.__test.ready()'));
  await shot('phone-break-intro');
  for (const k of ['work', 'rest']) { await js(frame(`w.__test.show('${k}')`)); await shot(`phone-break-${k}`); }
  await js(frame("w.bf.end('abort')"));
  await until('!document.querySelector(".bf-window")');

  // scheduler: ?fast (1 min = 1 s, starts 10:59) must open the 11:00 break by itself
  await size(1366, 768);
  await win.loadURL(`${base}?fast`);
  await until('window.__test && window.__test.ready()');
  check('scheduled break opens by itself (?fast)', await until(frame('w.__test && w.__test.ready()'), 15000));
  check('scheduled break is a slot', (await js(frame('w.bf.payload().then((p) => p.mode)'))) === 'slot');
  await shot('desktop-fast-slot');
  await js(frame("w.bf.end('skip')"));
  check('slot closes', await until('!document.querySelector(".bf-window")'));
  // pause control from the tray menu is present while the day is pending
  check('pause control present', await until("!!document.querySelector('.bf-dock .nav-item')", 3000));
  await js("document.querySelector('.bf-dock .nav-item').click()");
  check('pause menu lists items', (await js("document.querySelectorAll('.bf-menu .bf-mi').length")) >= 4);
  await shot('desktop-pause-menu');
  await js("document.querySelector('.bf-menu .bf-mi').click()"); // first item = shortest pause
  check('pause applied', await until("bf.getState().then((s) => s.day.pausedUntil != null)", 3000));

  // last break of the ?fast day: move the schedule so the only slot is 2 virtual minutes ahead (= the
  // last break); it owes all of 第 1 天 + the end-of-day stretch. Walk the stretch with Space.
  const nowMin = await js('bf.getState().then((s) => { const d = new Date(s.now); return d.getHours() * 60 + d.getMinutes(); })');
  const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  await js(`bf.saveSettings({ start: '${hm(nowMin + 2)}', end: '${hm(nowMin + 2)}' }).then(() => true)`);
  check('last break opens by itself (?fast)', await until(frame('w.__test && w.__test.ready()'), 15000));
  const lp = await js(frame('w.bf.payload().then((p) => ({ isLast: p.isLast, mode: p.mode, items: p.items.map((i) => i.unitId) }))'));
  check('last break: slot, isLast, stretch after the training', lp && lp.isLast && lp.mode === 'slot' && lp.items[lp.items.length - 1] === 'stretch', lp);
  check('stretch preview reachable', await js(frame("w.__test.show('stretchPreview')")));
  await shot('desktop-last-stretch-preview');
  const walked = [];
  for (let i = 0; i < 20; i++) {
    await sleep(450);
    const ph = await js(frame("w.__test.key(' ')"));
    walked.push(ph);
    if (ph === 'hold' && walked.filter((x) => x === 'hold').length === 1) {
      check('hold: side + clip (or placeholder) + primary 下一個', await js(frame("w.document.getElementById('pMeta').textContent.startsWith('右側') && !!w.document.querySelector('#clipMain video[src*=\"stretch_\"], #clipMain .ph') && w.document.querySelector('#pPri .btn').id === 'holdNext'")));
      await shot('desktop-last-stretch-hold');
    }
    if (ph === 'finish') break;
  }
  check('Space walks preview → hold per side to finish', walked[walked.length - 1] === 'finish' && walked.filter((x) => x === 'hold').length === 5, walked.join(','));
  check('stretch recorded', await until("bf.getState().then((s) => s.day.units.find((u) => u.id === 'stretch').doneSets === 1)", 3000));
  await shot('desktop-last-stretch-finish');
  await js(frame("w.bf.end('done')"));
  check('last break closes; sets left → today fails', await until("!document.querySelector('.bf-window') && bf.getState().then((s) => s.day.status === 'fail')", 4000));

  check('no 404s', bad.length === 0, bad.slice(0, 10));
  check('no console errors', errors.length === 0, errors.slice(0, 10));
  srv.close();
  const failed = results.filter((x) => !x.ok);
  console.log(JSON.stringify({ passed: results.length - failed.length, failed }, null, 1));
  app.exit(failed.length ? 1 : 0);
}

app.whenReady().then(() => main().catch((e) => { console.error(e); app.exit(2); }));
