'use strict';
/* Main window: Today / History / Settings */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ICON = (name, cls = '') => `<span class="ms ${cls}" aria-hidden="true">${name}</span>`;
// Slider fill (accent left of the thumb) is drawn in CSS from --p.
const rangeFill = (el) => el.style.setProperty('--p', `${((el.value - el.min) / (el.max - el.min)) * 100}%`);

// Text: every string comes from src/i18n.js in the current language (window.LANG, set by theme.js).
const t = (key, vars) => I18N.t(window.LANG, key, vars);
const WD = () => I18N.weekdays(window.LANG);
const CYCLE_KEY = { d1: 'd1', d2: 'd2', d3: 'd3', rest: 'rest' };
const SLOT_TXT = (st) => (st === 'pending' ? '' : st === 'empty' ? '—' : t(`slot_${st}`));
const DAY_TXT = (st) => t(`day_${st}`);

// Tab / picked day / library filter are also in the query string (?tab=history&date=…&f=d2), so a
// reload or a bookmark of the web build comes back to the same view; ?theme / ?lang stay as they are.
const Q0 = new URLSearchParams(location.search);
let S = null;
let receivedAt = 0;
let tab = 'today';
let libFilter = ['d1', 'd2', 'd3', 'stretch'].includes(Q0.get('f')) ? Q0.get('f') : 'd1';
let selDate = /^\d{4}-\d{2}-\d{2}$/.test(Q0.get('date') || '') ? Q0.get('date') : null;
let viewMonth = selDate ? selDate.slice(0, 7) : null; // 'YYYY-MM'
let noteTimer = null;
let chartW = 0; // #chart width, kept by the ResizeObserver

// ---------- helpers ----------
const pad = (n) => String(n).padStart(2, '0');
const pct = (x) => new Intl.NumberFormat(I18N.locale(window.LANG), { style: 'percent', maximumFractionDigits: 0 }).format(x);
function syncUrl() {
  try {
    const q = new URLSearchParams(location.search);
    q.set('tab', tab);
    q.set('f', libFilter);
    if (selDate) q.set('date', selDate);
    history.replaceState(null, '', `${location.pathname}?${q}${location.hash}`);
  } catch (_) { /* no history API: the view just isn't in the URL */ }
}
function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d, wd: new Date(y, m - 1, d).getDay() };
}
const fmtKey = (key) => I18N.dayLabel(window.LANG, key);
function vnow() {
  return new Date(Date.parse(S.now) + (Date.now() - receivedAt) * S.rate);
}
function pill(status) {
  return status === 'pass' || status === 'fail' ? `<span class="pill ${status}">${DAY_TXT(status)}</span>` : '';
}

// ---------- data ----------
async function refresh() {
  S = await window.bf.getState();
  receivedAt = Date.now();
  if (S.settings.lang !== window.LANG) { window.LANG = S.settings.lang; I18N.apply(document, window.LANG); }
  if (!viewMonth) viewMonth = S.today.slice(0, 7);
  if (!selDate) selDate = S.today;
  renderToday();
  renderHistory();
  renderSettings();
  tick();
}

// ---------- 今天 ----------
// Page head = which training day; hero = the stop you owe next, its move playing; below it the
// workday as a transit line of stops (DESIGN.md §5). Rest / done / over: the hero points at the
// next training day instead (directive, not mood).
function repRange(it) {
  const [a, b] = it.target;
  return a === b ? `${a}` : `${a}–${b}`;
}
// Same meta as the break overlay's intro rows: `4 × 8–15 下` / `8 × 30 秒` / stretch holds `6 × 30 秒`.
function itemMeta(it) {
  if (it.type === 'reps') return `${it.setsLeft} × ${t(it.perSide ? 'perSideReps' : 'repsN', { r: repRange(it) })}`;
  if (it.type === 'stretch') return t('timedMeta', { n: it.moves.reduce((a, m) => a + (m.sides ? 2 : 1), 0), s: it.holdSec });
  return t('timedMeta', { n: it.moves.length, s: it.moves[0].sec });
}
const firstMove = (it) => (it.type === 'reps' ? it : it.moves[0]);

function renderToday() {
  const training = !!S.dayTitle;
  $('#todayLabel').textContent = training ? S.dayLabel : '';
  $('#todayLabel').hidden = !training;
  $('#todayTitle').textContent = training ? S.dayTitle : fmtKey(S.today);
  $('#breakNowBtn').disabled = !S.canBreakNow;
  $('#breakNowBtn').hidden = !S.canBreakNow && !S.upNext; // nothing owed today: no dead button next to the directive hero
  renderHero();
  renderLine();
  renderLibrary();
}

function renderHero() {
  const up = S.upNext;
  const box = $('#heroText');
  const hero = $('#hero');
  const clip = $('#heroClip');
  if (up) {
    const it = up.items[0];
    const mv = firstMove(it);
    mountClip(clip, mv.clipUrl, mv.name, { poster: mv.posterUrl });
    clip.hidden = false;
    hero.classList.remove('directive');
    const more = up.items.slice(1).map((x) => `<li><span class="nm">${esc(x.name)}</span><span class="mt">${esc(itemMeta(x))}</span></li>`).join('');
    box.innerHTML = `<div class="hero-when"><span class="hero-time">${up.time}</span><span class="hero-in" id="nextIn"></span>${up.isLast ? `<span class="pill fail">${t('lastBreak')}</span>` : ''}</div>
      <div class="hero-name">${esc(it.name)}</div>
      <div class="hero-meta">${esc(itemMeta(it))}</div>
      ${more ? `<ul class="hero-more">${more}</ul>` : ''}`;
    tick();
    return;
  }
  // No stop owes anything today: say what happens next.
  const d = S.day;
  const word = d.planDay === 'rest' ? t('heroRest')
    : d.planDay === 'off' ? t('noTraining')
      : d.paused ? t('pausedTillTomorrow')
        : d.status === 'pass' ? t('allDone') : t('dayOver');
  const nt = S.nextTraining;
  hero.classList.add('directive');
  if (nt) mountClip(clip, nt.clipUrl, nt.name, { poster: nt.posterUrl });
  clip.hidden = !nt;
  const when = nt ? (nt.tomorrow ? t('tomorrowAt', { t: nt.time }) : t('dayAt', { d: fmtKey(nt.key), t: nt.time })) : '';
  // One large line (the state), then when (accent), the day's title, and the move that is playing.
  const move = nt ? (nt.item ? `${nt.item.name} · ${itemMeta(nt.item)}` : nt.name) : '';
  box.innerHTML = `<div class="hero-state">${esc(word)}</div>
    ${nt ? `<div class="hero-when"><span class="hero-in">${esc(when)}</span></div>
      <div class="hero-title">${esc(nt.title)}</div><div class="hero-meta">${esc(move)}</div>` : ''}`;
}

// Stop state on the day line: done / partial / missed (skipped too) / passed (nothing was owed) /
// next (= the hero) / later (owes sets) / free (a stop ahead that owes nothing) / covered (owed
// nothing on a passed day: its sets were done earlier, so it reads as done, not as a gap).
function stopState(s, k) {
  if (S.upNext && k === S.upNext.index) return 'next';
  let st = s.status; // done | partial stay as they are
  if (st === 'pending') st = s.units.some((u) => u.done < u.target) || (s.isLast && S.upNext) ? 'later' : 'free';
  else if (st === 'skipped' || st === 'missed') st = 'missed';
  else if (st === 'notified' || st === 'empty') st = 'passed';
  return (st === 'passed' || st === 'free') && S.day.status === 'pass' ? 'covered' : st;
}
const STOP_TXT = { next: 'nextSlot', done: 'slot_done', partial: 'slot_partial' };

let lineW = 0; // #dayLine width, kept by the ResizeObserver
function renderLine() {
  const ol = $('#timeline');
  const stops = S.slotsView;
  $('#prog').innerHTML = S.total ? t('progressOf', { a: `<b>${S.done}</b>`, b: S.total }) : '';
  $('#dayLine').hidden = !stops.length;
  if (!stops.length) { ol.innerHTML = ''; return; }
  if (!lineW) lineW = Math.round($('#dayLine').clientWidth);
  // Horizontal while every stop keeps >= 46 px (a time label is ~40 px); else the vertical rows.
  const flat = lineW - 120 >= stops.length * 46;
  $('#dayLine').classList.toggle('flat', flat);
  // What a stop holds: its own moves with counts; else the sets done in its break (carried from an
  // earlier stop), 補做 on the last stop, 走動 on a stop that only sends the walk reminder. The last
  // stop of a training day also holds 拉伸 (no count: it is done or not), after any 補做.
  const unitHTML = (u) => (u.stretch
    ? `<span class="u ${u.done >= u.target ? 'full' : ''}">${esc(u.name)}</span>`
    : `<span class="u ${u.done >= u.target ? 'full' : ''}">${esc(u.name)}<small>${u.done}/${u.target}</small></span>`);
  const units = (s, st) => {
    if (s.units.length) {
      const catchUp = s.catchUp && (st === 'next' || st === 'later') ? `<span class="none">${esc(t('catchUp'))}</span>` : '';
      return catchUp + s.units.map(unitHTML).join('');
    }
    const txt = (st === 'done' || st === 'partial') && s.sets ? t('setsN', { n: s.sets })
      : s.isLast && (st === 'next' || st === 'later') ? t('catchUp')
        : st === 'passed' || st === 'free' || st === 'covered' ? t('walk') : '';
    return txt ? `<span class="none">${esc(txt)}</span>` : '';
  };
  ol.className = flat ? 'line' : 'timeline';
  ol.innerHTML = stops.map((s, k) => {
    const st = stopState(s, k);
    const stTxt = st === 'missed' ? t(`slot_${s.status}`) : STOP_TXT[st] ? t(STOP_TXT[st]) : ''; // 跳過 vs 錯過 stays distinct
    if (!flat) {
      return `<li class="${st}"><span class="t">${s.time}</span><span class="dot"></span>
        <div class="units">${units(s, st)}</div><span class="st">${stTxt}</span></li>`;
    }
    const edge = k < 2 ? 'start' : k > stops.length - 3 ? 'end' : '';
    const label = [s.time, stTxt, ...s.units.map((u) => (u.stretch ? u.name : `${u.name} ${u.done}/${u.target}`))].filter(Boolean).join(', ');
    // the tooltip carries the status word too, so the line never relies on dot colour alone
    const tip = (stTxt ? `<span class="tip-st">${esc(stTxt)}</span>` : '') + units(s, st);
    return `<li class="stop ${st} ${edge}" tabindex="0" aria-label="${esc(label)}"><span class="dot"></span><span class="t">${s.time}</span>${tip ? `<span class="tip" role="tooltip">${tip}</span>` : ''}</li>`;
  }).join('');
}

function renderLibrary() {
  $$('#libFilter button').forEach((b) => b.classList.toggle('on', b.dataset.f === libFilter));
  const list = S.library.filter((m) => m.day === libFilter);
  const grid = $('#library');
  const sig = window.LANG + list.map((m) => `${m.id}:${m.name}:${m.clipUrl || ''}`).join('|');
  if (grid.dataset.sig === sig) return;
  grid.dataset.sig = sig;
  grid.innerHTML = list.length
    ? list.map((m) => `<button type="button" class="lib-card" data-id="${m.id}"><span class="clip"></span><span class="n">${esc(m.name)}</span></button>`).join('')
    : `<div class="empty-state">${ICON('fitness_center')}<span>${t('noMoves')}</span></div>`;
  libCols();
  $$('.lib-card', grid).forEach((card) => {
    const m = S.library.find((x) => x.id === card.dataset.id);
    const clip = $('.clip', card);
    mountClip(clip, m.clipUrl, m.name, { autoplay: false, poster: m.posterUrl });
    card.addEventListener('mouseenter', () => { const v = $('video', clip); if (v) v.play().catch(() => {}); });
    card.addEventListener('mouseleave', () => { const v = $('video', clip); if (v) v.pause(); });
    card.addEventListener('click', () => openPlayer(m.id));
  });
}
// Column count that divides the day's move count (6 → 3 or 6, 8 → 4 or 2), so no tile is left alone
// on the last row; tiles stay >= 180 px. Three or fewer moves: one row in up to 3 columns.
function libCols() {
  const grid = $('#library');
  const n = $$('.lib-card', grid).length;
  const w = grid.clientWidth;
  if (!n || !w) return;
  const fit = Math.max(1, Math.floor((w + 16) / 196));
  let c = n <= 3 ? Math.min(fit, 3) : fit;
  while (n > 3 && c > 2 && n % c) c -= 1;
  if (grid.style.getPropertyValue('--cols') !== String(c)) grid.style.setProperty('--cols', String(c));
}

function openPlayer(id) {
  const m = S.library.find((x) => x.id === id);
  if (!m) return;
  $('#playerName').textContent = m.name;
  $('#playerMeta').textContent = m.sec ? t(m.sides ? 'perSideSecs' : 'secs', { n: m.sec }) : '';
  $('#playerTips').innerHTML = (m.tips || []).map((t) => `<li>${ICON('check')}<span>${esc(t)}</span></li>`).join('');
  const clip = $('#playerClip');
  clip.dataset.src = '-';
  mountClip(clip, m.clipUrl, m.name, { poster: m.posterUrl });
  $('#player').hidden = false;
}
function closePlayer() {
  $('#player').hidden = true;
  const clip = $('#playerClip');
  clip.textContent = '';
  clip.dataset.src = '-';
}

// ---------- 記錄 ----------
function renderHistory() {
  const st = S.stats;
  const mSets = S.monthSets[viewMonth] || 0;
  const days = (n) => t(n === 1 ? 'daysN1' : 'daysN', { n });
  // The streak is the one hero numeral (ink); the other three are a quiet inline row (DESIGN.md §5).
  // No streak: the hero slot says when the next training starts instead of showing a big 0.
  const n = st.currentStreak;
  const nx = S.upNext || S.nextTraining;
  let [pre, post] = t(n === 1 ? 'streakHero1' : 'streakHero').split('{n}');
  let big = String(n);
  if (!n && nx) {
    [pre, post] = (S.upNext ? t('nextAt') : nx.tomorrow ? t('tomorrowAt') : t('dayAt', { d: fmtKey(nx.key) })).split('{t}');
    big = nx.time;
  }
  $('#streak').innerHTML = `${pre ? `<span>${esc(pre)}</span>` : ''}<b>${esc(big)}</b>${post ? `<span>${esc(post)}</span>` : ''}`;
  const stat = (k, v) => `<span class="stat"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></span>`;
  $('#stats').innerHTML = [
    stat(t('passRate'), st.passRate == null ? '—' : pct(st.passRate)),
    stat(t('longest'), days(st.longestStreak)),
    stat(t('monthShort', { m: Number(viewMonth.slice(5)), month: I18N.monthName(window.LANG, viewMonth) }), t('setsN', { n: mSets })),
  ].join('');
  renderCalendar();
  renderChart();
  loadDetail();
}

function renderCalendar() {
  const [y, m] = viewMonth.split('-').map(Number);
  $('#monthLabel').innerHTML = `<span class="ml-long">${I18N.monthLabel(window.LANG, viewMonth)}</span><span class="ml-short">${I18N.monthLabel(window.LANG, viewMonth, 'short')}</span>`;
  $('#calWeek').innerHTML = WD().map((w) => `<span>${w}</span>`).join('');
  const first = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i = 0; i < first; i++) cells.push('<div class="cell out"></div>');
  for (let d = 1; d <= days; d++) {
    const key = `${y}-${pad(m)}-${pad(d)}`;
    const h = S.history[key];
    const cls = ['cell'];
    let inner = `<span class="d">${d}</span>`;
    if (h) {
      cls.push(h.status, 'has');
      inner += `<span class="p">${h.total ? pct(h.pct) : ''}</span>`;
    }
    if (key === S.today) cls.push('today');
    if (key === selDate) cls.push('sel');
    cells.push(h
      ? `<button type="button" class="${cls.join(' ')}" data-k="${key}" aria-pressed="${key === selDate}">${inner}</button>`
      : `<div class="${cls.join(' ')}">${inner}</div>`);
  }
  const hadFocus = $('#calendar').contains(document.activeElement);
  $('#calendar').innerHTML = cells.join('');
  if (hadFocus && selDate) { const c = $(`#calendar [data-k="${selDate}"]`); if (c) c.focus(); } // re-render replaced the focused cell
  $$('#calendar .cell.has').forEach((c) => c.addEventListener('click', () => {
    selDate = c.dataset.k;
    syncUrl();
    renderCalendar();
    loadDetail();
  }));
}

function renderChart() {
  const data = S.recent;
  if (!data.length) {
    $('#chart').innerHTML = `<div class="empty-state">${ICON('bar_chart')}<span>${t('noTrainingDays')}</span></div>`;
    return;
  }
  if (!chartW) chartW = Math.round($('#chart').clientWidth); // measured once here, then only by the ResizeObserver
  const W = Math.max(200, chartW || 660);
  const H = 180;
  const L = 40;
  const R = 16;
  const B = 24;
  const T = 8;
  const n = 30;
  const every = W < 480 ? 10 : 5; // date labels: fewer when narrow so they never collide
  const slot = (W - L - R) / n;
  const bw = Math.min(slot * 0.62, 16);
  const ih = H - B - T;
  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">`;
  for (const g of [0, 0.5, 1]) {
    const yy = T + ih * (1 - g);
    svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text x="${L - 6}" y="${yy + 3}" text-anchor="end">${pct(g)}</text>`;
  }
  const off = n - data.length;
  data.forEach((h, i) => {
    const x = L + (off + i) * slot + (slot - bw) / 2;
    const bh = Math.max(2, ih * h.pct);
    // pass = accent, anything else neutral: the bar height already shows the shortfall
    const color = h.status === 'pass' ? 'var(--accent)' : 'var(--muted)';
    const word = h.status === 'pass' || h.status === 'fail' ? ` ${DAY_TXT(h.status)}` : '';
    svg += `<rect x="${x.toFixed(1)}" y="${(T + ih - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${color}"><title>${h.date} ${pct(h.pct)}${word}</title></rect>`;
    if (i % every === 0 || i === data.length - 1) {
      svg += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${I18N.shortDate(window.LANG, h.date)}</text>`;
    }
  });
  svg += '</svg>';
  $('#chart').innerHTML = svg;
}

async function loadDetail() {
  if (document.activeElement && document.activeElement.id === 'note') return; // don't clobber typing
  const key = selDate;
  const det = await window.bf.getDay(key);
  if (key !== selDate) return;
  const box = $('#detail');
  const sm = det.summary;
  if (!sm) {
    box.innerHTML = `<div class="dh"><h3>${fmtKey(key)}</h3></div><div class="empty-state">${ICON('event_busy')}<span>${t('noRecord')}</span></div>`;
    return;
  }
  const units = det.day ? det.day.units : det.impliedUnits;
  let html = `<div class="dh"><h3>${fmtKey(key)}</h3>${pill(sm.status)}</div>`;
  if (units && units.length) {
    html += '<div class="sec">';
    html += units.map((u) => {
      const ok = u.doneSets >= u.targetSets;
      if (u.type === 'stretch') return `<div class="urow"><span>${esc(u.name)}</span><span class="c ${ok ? 'ok' : 'no'}">${t(ok ? 'slot_done' : 'notDone')}</span></div>`;
      const reps = u.type !== 'circuit' && u.reps && u.reps.length ? t('repsList', { r: u.reps.join(window.LANG === 'en' ? ', ' : '、') }) : '';
      return `<div class="urow"><span>${esc(u.name)}</span><span class="c ${ok ? 'ok' : 'no'}">${t('setsOf', { a: u.doneSets, b: u.targetSets })}</span>${reps ? `<span class="r">${esc(reps)}</span>` : ''}</div>`;
    }).join('');
    html += '</div>';
  }
  if (!units || !units.length) {
    html += `<div class="sec"><div class="empty-state">${ICON(sm.planDay === 'off' ? 'event_busy' : 'self_improvement')}<span>${sm.planDay === 'off' ? t('dayOff') : t('restDay')}</span></div></div>`;
  }
  if (det.day) {
    html += `<div class="sec"><textarea id="note" placeholder="${t('note')}" aria-label="${t('note')}">${esc(det.day.note || '')}</textarea></div>`;
  }
  box.innerHTML = html;
  const ta = $('#note');
  if (ta) {
    ta.addEventListener('input', () => {
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => window.bf.setNote(key, ta.value), 600);
    });
  }
}

// ---------- 設定 ----------
function setVal(el, v) {
  if (document.activeElement !== el && !el.classList.contains('bad')) el.value = v;
}

function renderSettings() {
  const s = S.settings;
  setVal($('#sStart'), s.start);
  setVal($('#sEnd'), s.end);
  setVal($('#sInterval'), s.interval);
  // Buttons are built once per language and only restyled after that: rebuilding them on every
  // refresh swallowed a click whose mousedown blurred an edited field (change → save → refresh).
  const sd = $('#sDays');
  if (sd.dataset.lang !== window.LANG) {
    sd.dataset.lang = window.LANG;
    sd.innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) => `<button data-d="${d}">${WD()[d]}</button>`).join('');
  }
  $$('button', sd).forEach((b) => {
    const on = s.activeWeekdays.includes(Number(b.dataset.d));
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });

  const idx = ['d1', 'd2', 'd3', 'rest'].indexOf(S.day.planDay);
  const sc = $('#sCycle');
  if (sc.dataset.lang !== window.LANG) {
    sc.dataset.lang = window.LANG;
    sc.innerHTML = ['d1', 'd2', 'd3', 'rest'].map((k, i) => `<button data-i="${i}">${t(CYCLE_KEY[k])}</button>`).join('');
  }
  $$('button', sc).forEach((b) => b.classList.toggle('on', Number(b.dataset.i) === idx));

  document.documentElement.dataset.theme = s.theme;
  $$('#sTheme button').forEach((b) => b.classList.toggle('on', b.dataset.t === s.theme));
  $$('#sLang button').forEach((b) => b.classList.toggle('on', b.dataset.l === s.lang));
  $('#sShowDemo').classList.toggle('on', s.showDemo);
  $('#sDemoRow').classList.toggle('off', !s.showDemo);
  $('#sDemo').disabled = !s.showDemo;
  setVal($('#sDemo'), s.demoSec);
  rangeFill($('#sDemo'));
  $('#sDemoVal').textContent = t('secs', { n: s.demoSec });
  $('#sNotify').classList.toggle('on', s.notifyEmptySlots);
  $('#sLaunch').classList.toggle('on', s.autoLaunch);

  renderOverrides();
}

function renderOverrides() {
  const box = $('#overrides');
  if (box.contains(document.activeElement) && box.dataset.lang === window.LANG) return;
  box.dataset.lang = window.LANG;
  const ov = S.settings.overrides || {};
  box.innerHTML = ['d1', 'd2'].map((pd) => {
    const rows = S.plan.days[pd].units.map((u) => {
      const o = ov[u.id] || {};
      const sets = o.sets || u.sets;
      const reps = o.reps || u.reps;
      const changed = !!ov[u.id];
      return `<div class="ov-row" data-id="${u.id}">
        <span class="nm ${changed ? 'changed' : ''}">${esc(u.name)}</span>
        <input type="number" min="1" max="10" value="${sets}" data-k="sets" aria-label="${t('sets')}">
        <input type="number" min="1" max="100" value="${reps[0]}" data-k="a" aria-label="${t('minReps')}">
        <span class="dash">–</span>
        <input type="number" min="1" max="100" value="${reps[1]}" data-k="b" aria-label="${t('maxReps')}">
        <button class="reset" title="${t('reset')}" aria-label="${t('reset')}" ${changed ? '' : 'disabled'}>${ICON('undo')}</button></div>`;
    }).join('');
    return `<div class="ov-col"><div class="ov-head"><h3>${esc(t(pd))}</h3><span class="lbl l-sets">${t('colSets')}</span><span class="lbl l-reps">${t('colReps')}</span></div>${rows}</div>`;
  }).join('');
  $$('.ov-row', box).forEach((row) => {
    const id = row.dataset.id;
    const u = [...S.plan.days.d1.units, ...S.plan.days.d2.units].find((x) => x.id === id);
    const commit = () => {
      const get = (k) => Math.max(1, Math.round(Number($(`input[data-k="${k}"]`, row).value) || 1));
      const sets = get('sets');
      let a = get('a');
      let b = get('b');
      if (b < a) [a, b] = [b, a];
      const next = { ...(S.settings.overrides || {}) };
      if (sets === u.sets && a === u.reps[0] && b === u.reps[1]) delete next[id];
      else next[id] = { sets, reps: [a, b] };
      save({ overrides: next }, true);
    };
    $$('input', row).forEach((inp) => inp.addEventListener('change', commit));
    $('.reset', row).addEventListener('click', () => {
      const next = { ...(S.settings.overrides || {}) };
      delete next[id];
      save({ overrides: next }, true);
    });
  });
}

async function save(patch, rerenderOverrides = false) {
  S.settings = await window.bf.saveSettings(patch);
  if (rerenderOverrides) {
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    renderOverrides();
  }
}

function bindSettings() {
  const timeField = (id, key) => $(id).addEventListener('change', (e) => {
    const m = /^(\d{1,2})[:：]?(\d{2})$/.exec(e.target.value.trim());
    const ok = m && Number(m[1]) < 24 && Number(m[2]) < 60;
    // invalid: keep the typed text, red edge + aria-invalid until it is fixed (no microcopy: brief)
    e.target.classList.toggle('bad', !ok);
    e.target.setAttribute('aria-invalid', String(!ok));
    if (ok) save({ [key]: `${pad(Number(m[1]))}:${m[2]}` }).then(() => { e.target.value = S.settings[key]; });
  });
  $('#sDays').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = Number(b.dataset.d);
    const set = new Set(S.settings.activeWeekdays);
    if (set.has(d)) set.delete(d); else set.add(d);
    save({ activeWeekdays: [...set] }).then(renderSettings);
  });
  $('#sCycle').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) window.bf.setCycleToday(Number(b.dataset.i));
  });
  timeField('#sStart', 'start');
  timeField('#sEnd', 'end');
  $('#sInterval').addEventListener('change', (e) => save({ interval: Number(e.target.value) }));
  $('#sDemo').addEventListener('input', (e) => { $('#sDemoVal').textContent = t('secs', { n: e.target.value }); rangeFill(e.target); });
  $('#sDemo').addEventListener('change', (e) => save({ demoSec: Number(e.target.value) }));
  $$('#sTheme button').forEach((b) => b.addEventListener('click', () => save({ theme: b.dataset.t }).then(renderSettings)));
  $$('#sLang button').forEach((b) => b.addEventListener('click', () => save({ lang: b.dataset.l })));
  $('#sShowDemo').addEventListener('click', () => save({ showDemo: !S.settings.showDemo }).then(renderSettings));
  $('#sNotify').addEventListener('click', () => save({ notifyEmptySlots: !S.settings.notifyEmptySlots }));
  $('#sLaunch').addEventListener('click', () => save({ autoLaunch: !S.settings.autoLaunch }));
  $('#testBreakBtn').addEventListener('click', () => window.bf.testBreak());
}

// ---------- tabs / chrome ----------
function showTab(name) {
  tab = name;
  syncUrl();
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach((t) => { t.hidden = t.id !== `tab-${name}`; });
  $('#content').scrollTop = 0;
}

// `還有 25 分` / `還有 1 小時 5 分` (minutes rounded up), `即將開始` in the last seconds.
function untilText(sec) {
  if (sec <= 0) return t('startingSoon');
  const min = Math.ceil(sec / 60);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return !h ? t('inMin', { n: m }) : m ? t('inHourMin', { h, m }) : t('inHour', { h });
}

function tick() {
  if (!S) return;
  const el = $('#nextIn');
  if (el && S.upNext) el.textContent = untilText((Date.parse(S.upNext.at) - vnow().getTime()) / 1000);
}

$$('.nav-item').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
$$('#libFilter button').forEach((b) => b.addEventListener('click', () => { libFilter = b.dataset.f; syncUrl(); renderLibrary(); }));
$('#breakNowBtn').addEventListener('click', () => window.bf.breakNow());
$('#prevMonth').addEventListener('click', () => shiftMonth(-1));
$('#nextMonth').addEventListener('click', () => shiftMonth(1));
$('#playerClose').addEventListener('click', closePlayer);
$('#player').addEventListener('click', (e) => { if (e.target.id === 'player') closePlayer(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#player').hidden) closePlayer(); });

function shiftMonth(d) {
  const [y, m] = viewMonth.split('-').map(Number);
  const dt = new Date(y, m - 1 + d, 1);
  viewMonth = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`;
  renderHistory();
}

bindSettings();
new ResizeObserver(() => {
  const w = Math.round($('#chart').clientWidth);
  if (S && w && w !== chartW) { chartW = w; renderChart(); }
}).observe($('#chart'));
new ResizeObserver(() => requestAnimationFrame(libCols)).observe($('#library')); // next frame: more rows can add a scrollbar
new ResizeObserver(() => {
  const w = Math.round($('#dayLine').clientWidth);
  if (S && w && w !== lineW) { lineW = w; requestAnimationFrame(renderLine); } // next frame: switching flat / rows resizes the observed box
}).observe($('#dayLine'));
window.bf.onState(() => refresh());
addEventListener('bf:lang', () => { if (S) refresh(); });
window.bf.onNav((name) => { if (['today', 'history', 'settings'].includes(name)) showTab(name); });
if (['history', 'settings'].includes(Q0.get('tab'))) showTab(Q0.get('tab'));
setInterval(() => {
  tick();
  if (S && S.rate > 1) refresh(); // --fast: virtual clock runs 60×
}, 1000);
setInterval(() => { if (S && S.rate === 1) refresh(); }, 60000);
refresh();

// ---------- selftest hooks ----------
window.__test = {
  ready: () => !!S,
  tab: (name) => { showTab(name); return true; },
  select: async (key) => { selDate = key; viewMonth = key.slice(0, 7); renderHistory(); await loadDetail(); return true; },
  month: (d) => { shiftMonth(d); return true; },
  filter: (f) => { libFilter = f; renderLibrary(); return true; },
  open: (id) => { openPlayer(id); return true; },
  close: () => { closePlayer(); return true; },
  scroll: (y) => { $('#content').scrollTop = y; return $('#content').scrollTop; },
  // Directive hero states without touching the data: 'done' | 'over' | 'rest'; null = back to the real state.
  hero: (kind) => {
    if (!kind) { if (realS) { S = realS; realS = null; renderToday(); } return true; }
    realS = realS || S;
    const r = realS;
    S = kind === 'rest'
      ? { ...r, day: { ...r.day, planDay: 'rest', status: 'rest' }, dayTitle: null, slotsView: [], total: 0, done: 0, upNext: null, canBreakNow: false }
      : { ...r, day: { ...r.day, status: kind === 'done' ? 'pass' : 'fail' }, done: kind === 'done' ? r.total : r.done, upNext: null, canBreakNow: false,
        slotsView: r.slotsView.map((x) => ({ ...x, status: x.status === 'pending' ? (kind === 'done' ? 'empty' : 'missed') : x.status })) };
    renderToday();
    return true;
  },
};
let realS = null;
