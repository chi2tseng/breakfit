'use strict';
/* Main window: Today / History / Settings */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ICON = (name, cls = '') => `<span class="ms ${cls}">${name}</span>`;
// Slider fill (accent left of the thumb) is drawn in CSS from --p.
const rangeFill = (el) => el.style.setProperty('--p', `${((el.value - el.min) / (el.max - el.min)) * 100}%`);

// Text: every string comes from src/i18n.js in the current language (window.LANG, set by theme.js).
const t = (key, vars) => I18N.t(window.LANG, key, vars);
const WD = () => I18N.weekdays(window.LANG);
const CYCLE_KEY = { d1: 'd1', d2: 'd2', d3: 'd3', rest: 'rest' };
const SLOT_TXT = (st) => (st === 'pending' ? '' : st === 'empty' ? '—' : t(`slot_${st}`));
const DAY_TXT = (st) => t(`day_${st}`);

let S = null;
let receivedAt = 0;
let tab = 'today';
let libFilter = 'd1';
let viewMonth = null; // 'YYYY-MM'
let selDate = null;
let noteTimer = null;

// ---------- helpers ----------
const pad = (n) => String(n).padStart(2, '0');
function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d, wd: new Date(y, m - 1, d).getDay() };
}
const fmtKey = (key) => I18N.dayLabel(window.LANG, key);
function vnow() {
  return new Date(Date.parse(S.now) + (Date.now() - receivedAt) * S.rate);
}
function dur(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
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
function renderToday() {
  const d = S.day;
  const training = !!S.dayTitle;
  $('#todayLabel').textContent = training ? S.dayLabel : '';
  $('#todayLabel').hidden = !training;
  $('#todayTitle').textContent = training ? S.dayTitle : d.planDay === 'rest' ? t('restDay') : t('noTraining');
  $('#breakNowBtn').disabled = !S.canBreakNow;

  const pct = S.total ? S.done / S.total : 0;
  let status = d.status;
  if (d.paused) status = 'fail';
  const progCard = training
    ? `<div class="card"><div class="k"><span>${t('todayProgress')}</span>${pill(status)}</div>
        <div class="v">${S.done}<small>/ ${S.total} ${t('setsUnit')}</small></div>
        <div class="bar ${status === 'fail' ? 'fail' : ''}"><div style="width:${pct * 100}%"></div></div>
        ${d.paused ? `<div class="s">${t('pausedTillTomorrow')}</div>` : ''}</div>`
    : `<div class="card"><div class="k"><span>${t('todayProgress')}</span></div>
        <div class="v">${d.planDay === 'rest' ? t('restDay') : t('dayOff')}</div></div>`;
  const nextCard = `<div class="card"><div class="k"><span>${t('nextBreak')}</span>${S.next && S.next.isLast ? `<span class="pill fail">${t('lastBreak')}</span>` : ''}</div>
      <div class="v" id="nextTime">${S.next ? S.next.time : '—'}</div>
      <div class="s" id="nextIn"></div></div>`;
  $('#todayCards').innerHTML = progCard + nextCard;

  // timeline
  const nextIdx = S.next ? S.next.index : -1;
  if (!S.slotsView.length) {
    $('#timeline').innerHTML = `<li class="empty-state">${ICON('event_available')}<span>${t('noBreaksToday')}</span></li>`;
  } else {
    $('#timeline').innerHTML = S.slotsView.map((s, k) => {
      const units = s.units.length
        ? s.units.map((u) => `<span class="u ${u.done >= u.target ? 'full' : ''}">${esc(u.name)}<small>${u.done}/${u.target}</small></span>`).join('')
        : `<span class="none">${s.isLast ? t('catchUp') : '—'}</span>`;
      const isNext = k === nextIdx;
      const stTxt = isNext ? t('nextSlot') : SLOT_TXT(s.status);
      return `<li class="${s.status} ${isNext ? 'next' : ''}"><span class="t">${s.time}</span><span class="dot"></span>
        <div class="units">${units}</div><span class="st">${stTxt}</span></li>`;
    }).join('');
  }
  renderLibrary();
}

function renderLibrary() {
  $$('#libFilter button').forEach((b) => b.classList.toggle('on', b.dataset.f === libFilter));
  const list = S.library.filter((m) => m.day === libFilter);
  const grid = $('#library');
  const sig = window.LANG + list.map((m) => `${m.id}:${m.name}:${m.clipUrl || ''}`).join('|');
  if (grid.dataset.sig === sig) return;
  grid.dataset.sig = sig;
  grid.innerHTML = list.map((m) => `<div class="lib-card" data-id="${m.id}" tabindex="0" role="button">
      <div class="clip"></div>
      <div class="meta"><div class="n">${esc(m.name)}</div></div></div>`).join('');
  $$('.lib-card', grid).forEach((card) => {
    const m = S.library.find((x) => x.id === card.dataset.id);
    const clip = $('.clip', card);
    mountClip(clip, m.clipUrl, m.name, { autoplay: false, poster: m.posterUrl });
    card.addEventListener('mouseenter', () => { const v = $('video', clip); if (v) v.play().catch(() => {}); });
    card.addEventListener('mouseleave', () => { const v = $('video', clip); if (v) v.pause(); });
    card.addEventListener('click', () => openPlayer(m.id));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlayer(m.id); } });
  });
}

function openPlayer(id) {
  const m = S.library.find((x) => x.id === id);
  if (!m) return;
  $('#playerName').textContent = m.name;
  $('#playerMeta').textContent = m.sec ? t('secs', { n: m.sec }) : '';
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
  const mNum = Number(viewMonth.slice(5));
  const mSets = S.monthSets[viewMonth] || 0;
  const card = (k, v) => `<div class="card"><div class="k"><span>${k}</span></div><div class="v">${v}</div></div>`;
  $('#statCards').innerHTML = [
    card(t('passRate'), st.passRate == null ? '—' : `${Math.round(st.passRate * 100)}<small>%</small>`),
    card(t('streak'), `${st.currentStreak}<small>${t('daysUnit')}</small>`),
    card(t('longest'), `${st.longestStreak}<small>${t('daysUnit')}</small>`),
    card(t('monthSets', { m: mNum, month: I18N.monthName(window.LANG, viewMonth) }), `${mSets}<small>${t('setsUnit')}</small>`),
  ].join('');
  renderCalendar();
  renderChart();
  loadDetail();
}

function renderCalendar() {
  const [y, m] = viewMonth.split('-').map(Number);
  $('#monthLabel').textContent = I18N.monthLabel(window.LANG, viewMonth);
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
      const pct = h.total ? `${Math.round(h.pct * 100)}%` : '';
      inner += `<span class="p">${pct}</span>`;
    }
    if (key === S.today) cls.push('today');
    if (key === selDate) cls.push('sel');
    cells.push(`<div class="${cls.join(' ')}" data-k="${key}"${h ? ' tabindex="0" role="button"' : ''}>${inner}</div>`);
  }
  $('#calendar').innerHTML = cells.join('');
  $$('#calendar .cell.has').forEach((c) => {
    const pick = () => {
      selDate = c.dataset.k;
      renderCalendar();
      loadDetail();
    };
    c.addEventListener('click', pick);
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  });
}

function renderChart() {
  const data = S.recent;
  if (!data.length) {
    $('#chart').innerHTML = `<div class="empty-state">${ICON('bar_chart')}<span>${t('noTrainingDays')}</span></div>`;
    return;
  }
  const W = Math.max(280, Math.round($('#chart').clientWidth || 660));
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
    svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text x="${L - 6}" y="${yy + 3}" text-anchor="end">${g * 100}%</text>`;
  }
  const off = n - data.length;
  data.forEach((h, i) => {
    const x = L + (off + i) * slot + (slot - bw) / 2;
    const bh = Math.max(2, ih * h.pct);
    const color = h.status === 'pass' ? 'var(--accent)' : h.status === 'fail' ? 'var(--fail)' : 'var(--muted)';
    svg += `<rect x="${x.toFixed(1)}" y="${(T + ih - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${color}"><title>${h.date} ${Math.round(h.pct * 100)}%</title></rect>`;
    if (i % every === 0 || i === data.length - 1) {
      const { m, d } = parseKey(h.date);
      svg += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${m}/${d}</text>`;
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
      const reps = u.type !== 'circuit' && u.reps && u.reps.length ? t('repsList', { r: u.reps.join(window.LANG === 'en' ? ', ' : '、') }) : '';
      return `<div class="urow"><span>${esc(u.name)}</span><span class="c ${ok ? 'ok' : 'no'}">${t('setsOf', { a: u.doneSets, b: u.targetSets })}</span>${reps ? `<span class="r">${esc(reps)}</span>` : ''}</div>`;
    }).join('');
    html += '</div>';
  }
  if (!units || !units.length) {
    html += `<div class="sec"><div class="empty-state">${ICON(sm.planDay === 'off' ? 'event_busy' : 'self_improvement')}<span>${sm.planDay === 'off' ? t('dayOff') : t('restDay')}</span></div></div>`;
  }
  if (det.day) {
    html += `<div class="sec"><textarea id="note" placeholder="${t('note')}">${esc(det.day.note || '')}</textarea></div>`;
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
  if (document.activeElement !== el) el.value = v;
}

function renderSettings() {
  const s = S.settings;
  setVal($('#sStart'), s.start);
  setVal($('#sEnd'), s.end);
  setVal($('#sInterval'), s.interval);
  $('#sDays').innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) => `<button data-d="${d}" class="${s.activeWeekdays.includes(d) ? 'on' : ''}">${WD()[d]}</button>`).join('');
  $$('#sDays button').forEach((b) => b.addEventListener('click', () => {
    const d = Number(b.dataset.d);
    const set = new Set(S.settings.activeWeekdays);
    if (set.has(d)) set.delete(d); else set.add(d);
    save({ activeWeekdays: [...set] });
  }));

  const idx = ['d1', 'd2', 'd3', 'rest'].indexOf(S.day.planDay);
  $('#sCycle').innerHTML = ['d1', 'd2', 'd3', 'rest'].map((k, i) => `<button data-i="${i}" class="${i === idx ? 'on' : ''}">${t(CYCLE_KEY[k])}</button>`).join('');
  $$('#sCycle button').forEach((b) => b.addEventListener('click', async () => {
    await window.bf.setCycleToday(Number(b.dataset.i));
  }));

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
        <button class="reset" title="${t('reset')}" ${changed ? '' : 'disabled'}>${ICON('undo')}</button></div>`;
    }).join('');
    return `<div class="ov-col"><div class="ov-head"><h4>${esc(t(pd))}</h4><span class="lbl l-sets">${t('colSets')}</span><span class="lbl l-reps">${t('colReps')}</span></div>${rows}</div>`;
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
    if (m && Number(m[1]) < 24 && Number(m[2]) < 60) save({ [key]: `${pad(Number(m[1]))}:${m[2]}` }).then(() => { e.target.value = S.settings[key]; });
    else e.target.value = S.settings[key];
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
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach((t) => { t.hidden = t.id !== `tab-${name}`; });
  $('#content').scrollTop = 0;
}

function tick() {
  if (!S) return;
  const now = vnow();
  const el = $('#nextIn');
  if (el && S.next) {
    const sec = (Date.parse(S.next.at) - now.getTime()) / 1000;
    el.textContent = sec > 0 ? t('inTime', { t: dur(sec) }) : t('startingSoon');
  }
}

$$('.nav-item').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
$$('#libFilter button').forEach((b) => b.addEventListener('click', () => { libFilter = b.dataset.f; renderLibrary(); }));
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
let chartW = 0;
new ResizeObserver(() => {
  const w = Math.round($('#chart').clientWidth);
  if (S && w && w !== chartW) { chartW = w; renderChart(); }
}).observe($('#chart'));
window.bf.onState(() => refresh());
addEventListener('bf:lang', () => { if (S) refresh(); });
window.bf.onNav((name) => { if (['today', 'history', 'settings'].includes(name)) showTab(name); });
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
};
