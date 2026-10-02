'use strict';
/* Break overlay: intro → [demo → work → rest]… / circuit [preview → timed]… → stretch [preview → hold]… → finish. */

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ICON = (name, cls = '') => `<span class="ms ${cls}" aria-hidden="true">${name}</span>`;

const INTRO_SEC = 10;
const PREVIEW_SEC = 5;
const FINISH_SEC = 5;
const KEY_GUARD_MS = 400; // Space/Enter ignored this long after a phase change (no double skips)

let P = null; // payload from main
let steps = [];
const st = {
  phase: 'intro', // intro | step | finish
  i: -1,
  remaining: INTRO_SEC,
  duration: INTRO_SEC,
  elapsed: 0,
  frozen: false,
  modal: null,
  sessionSets: 0,
  extraSets: 0, // of those, sets of 加練 moves in a mixed 自選 session (P.extraUnits)
  lastRec: null, // { unitId, index, reps } of the set just finished
  ended: false,
  shownAt: 0, // performance.now() when the current phase was rendered
};
const isExtra = (item) => !!(P && P.extraUnits && P.extraUnits.includes(item.unitId));

// ---------- text helpers (src/i18n.js, language = window.LANG from theme.js / the payload) ----------
const t = (key, vars) => I18N.t(window.LANG, key, vars);
function repRange(item) {
  const [a, b] = item.target;
  return a === b ? `${a}` : `${a}–${b}`;
}
function repsText(item) {
  return t(item.perSide ? 'perSideReps' : 'repsN', { r: repRange(item) });
}
function setText(item, setNo) {
  return t('setNo', { n: setNo, t: item.targetSets });
}
// End-of-day stretch: one timed hold per stretch, two (right, then left) when it has sides.
const holdsOf = (it) => it.moves.reduce((a, m) => a + (m.sides ? 2 : 1), 0);
const sideText = (side) => (side ? t(side === 'right' ? 'sideRight' : 'sideLeft') : '');
function itemMeta(it) {
  if (it.type === 'reps') return `${it.setsLeft} × ${repsText(it)}`;
  if (it.type === 'stretch') return t('timedMeta', { n: holdsOf(it), s: it.holdSec });
  return t('timedMeta', { n: it.moves.length, s: it.moves[0].sec });
}

// Meta line = separate facts with a gap, never an ASCII '·' between CJK words (DESIGN.md §6).
const metaHTML = (...parts) => parts.filter(Boolean).map((p) => `<span>${p}</span>`).join('');

// ---------- sound (WebAudio, no files) ----------
let ac = null;
function tone(freq, dur, when = 0, vol = 0.18) {
  if (!P || P.selftest) return;
  try {
    ac = ac || new AudioContext();
    const o = ac.createOscillator();
    const g = ac.createGain();
    const t0 = ac.currentTime + when;
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(ac.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  } catch (_) { /* no audio device */ }
}
const beep = () => tone(880, 0.12);
const chime = () => { tone(660, 0.14); tone(990, 0.22, 0.13); };
// Stretching is calm: a soft low note per step, a gentle two-note cue when it is time to switch sides.
const softCue = () => tone(523, 0.35, 0, 0.08);
const sideCue = () => { tone(440, 0.3, 0, 0.08); tone(587, 0.4, 0.2, 0.08); };

// ---------- step plan ----------
function nextRef(it) {
  return it.type === 'reps' ? { item: it, setNo: it.setNo } : { item: it, move: it.moves[0] };
}

function buildSteps(all) {
  const out = [];
  // Training first; the stretch (only ever in the last break) comes after it, with no rest before it.
  const items = all.filter((it) => it.type !== 'stretch');
  items.forEach((it, i) => {
    const lastItem = i === items.length - 1;
    const nextItem = items[i + 1];
    if (it.type === 'reps') {
      for (let s = 0; s < it.setsLeft; s++) {
        const setNo = it.setNo + s;
        if (s === 0 && P.showDemo !== false) out.push({ kind: 'demo', item: it, setNo });
        out.push({ kind: 'work', item: it, setNo });
        const lastSet = s === it.setsLeft - 1;
        if (!(lastItem && lastSet)) {
          out.push({
            kind: 'rest', item: it, setNo, dur: P.setRestSec,
            next: lastSet ? nextRef(nextItem) : { item: it, setNo: setNo + 1 },
          });
        }
      }
    } else {
      it.moves.forEach((m, j) => {
        if (P.showDemo !== false) out.push({ kind: 'preview', item: it, move: m, j });
        out.push({ kind: 'timed', item: it, move: m, j });
      });
      out.push({ kind: 'round', item: it });
      if (!lastItem) {
        const circuitNext = nextItem.type === 'circuit';
        out.push({
          kind: circuitNext ? 'roundRest' : 'rest', item: it,
          dur: circuitNext ? P.roundRestSec : P.setRestSec, next: nextRef(nextItem),
        });
      }
    }
  });
  for (const it of all.filter((x) => x.type === 'stretch')) {
    it.moves.forEach((m, j) => {
      for (const side of m.sides ? ['right', 'left'] : [null]) {
        if (P.showDemo !== false) out.push({ kind: 'stretchPreview', item: it, move: m, j, side });
        out.push({ kind: 'hold', item: it, move: m, j, side, dur: it.holdSec });
      }
    });
    out.push({ kind: 'stretchDone', item: it });
  }
  return out;
}
const STRETCH_KINDS = new Set(['stretchPreview', 'hold']);
const RECORD_KINDS = new Set(['round', 'stretchDone']); // bookkeeping steps: recorded, never shown

function durFor(s) {
  switch (s.kind) {
    case 'demo': return P.demoSec;
    case 'preview':
    case 'stretchPreview': return PREVIEW_SEC;
    case 'hold': return s.dur;
    case 'timed': return s.move.sec;
    case 'rest':
    case 'roundRest': return s.dur;
    default: return 0; // work: stopwatch
  }
}

const cur = () => steps[st.i];
const counting = () => st.phase !== 'step' || (cur() && cur().kind !== 'work');

// ---------- ring ----------
function ringHTML(id = 'ring') {
  const r = 45;
  const c = 2 * Math.PI * r;
  return `<div class="ring" id="${id}">
    <svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="${r}" fill="none" stroke-width="6"/>
    <circle class="bar" cx="50" cy="50" r="${r}" fill="none" stroke-width="6" stroke-dasharray="${c}" stroke-dashoffset="0"/></svg>
    <div class="num"><span class="n"></span></div></div>`;
}
function updateRing(id, remaining, duration) {
  const el = document.getElementById(id);
  if (!el) return;
  const c = 2 * Math.PI * 45;
  const frac = duration > 0 ? Math.max(0, Math.min(1, remaining / duration)) : 0;
  el.querySelector('.bar').setAttribute('stroke-dashoffset', String(c * (1 - frac)));
  const txt = String(Math.max(0, Math.ceil(remaining - 1e-6)));
  el.querySelector('.n').textContent = txt;
  el.classList.toggle('wide', txt.length >= 3); // 3 digits (round rest) need a smaller size to clear the ring
}
const mmss = (sec) => {
  const s = Math.floor(sec);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

// ---------- top bar ----------
function renderTop() {
  $('#slotText').textContent = P.slotTime;
  const tag = $('#modeTag');
  const modeLabel = P.mode === 'manual' ? t('earlyBreak') : P.mode === 'test' ? t('test')
    : P.mode === 'session' ? t(P.extra ? 'extraSession' : 'fullWorkout') : '';
  tag.hidden = !modeLabel;
  tag.textContent = modeLabel;
  const total = steps.length || 1;
  const done = st.phase === 'finish' ? total : st.phase === 'intro' ? 0 : Math.max(0, st.i);
  $('#progFill').style.transform = `scaleX(${done / total})`;
}

// ---------- the one fixed frame (DESIGN.md §4) ----------
// Left: #clipMain is the same element in every phase; it only swaps its source (and keeps
// playing when the source is unchanged, e.g. demo → work). Right: chip / title / meta / body /
// secondary / primary slots, always in the same place.
const btn = (id, icon, label, { primary = false, fill = false, kbd = '', cd = false } = {}) =>
  `<button class="btn ${primary ? 'primary' : 'ghost'}" id="${id}" aria-label="${esc(label)}">${ICON(icon, fill ? 'fill' : '')}<span class="lb">${esc(label)}</span>${kbd ? `<kbd>${kbd}</kbd>` : ''}${cd ? '<span class="cd" id="cd"></span>' : ''}</button>`;

// A phase title wider than the panel (English day titles, long move names) steps down the type
// scale — display → title2 → title3 — instead of ending in an ellipsis.
function fitTitle() {
  const el = $('#pTitle');
  el.classList.remove('fit2', 'fit3', 'wrap');
  delete el.dataset.lintWrap;
  if (el.scrollWidth > el.clientWidth + 1) el.classList.add('fit2');
  if (el.scrollWidth > el.clientWidth + 1) { el.classList.remove('fit2'); el.classList.add('fit3'); }
  // a narrow window / PIP: still too wide at title3 → two lines (the only title that may wrap)
  if (el.scrollWidth > el.clientWidth + 1 && document.documentElement.dataset.view !== 'full') {
    el.classList.add('wrap');
    el.dataset.lintWrap = '';
  }
}

// PIP (DESIGN.md §4b): the clip IS the window — the largest 16:9 it holds, never shrunk for the UI — and
// NOTHING scrolls. All UI is one dense bar (#pipBar): in the strip under the clip when the window is
// taller than 16:9 (form "below"), in a column beside it when wider ("side"), else on a scrim over the
// clip's bottom ("over"). A tall strip / column puts the name above the number (rows 2) with the
// number as big as fits (hero → ring → title2) and the tips when they fit. Each try adds levels
// (overlay.css pb-l1 … pb-l4: context, secondary, name, primary label) until the bar fits.
const PB_LEVELS = ['pb-l1', 'pb-l2', 'pb-l3', 'pb-l4'];
const SIDE_MIN = 168; // narrowest column beside a full-height clip (px)
const PEEK_MS = 2000; // the window buttons + mode chip show this long after a phase change
let pipData = null; // what the bar shows for the current phase (pipSet)
function pipMoveActs(on) {
  const to = on ? $('#pbActs') : $('.p-foot');
  for (const id of ['pSec', 'pPri']) { const e = document.getElementById(id); if (e.parentElement !== to) to.appendChild(e); }
}
function barFits(bar) {
  const br = bar.getBoundingClientRect();
  if (bar.scrollWidth > bar.clientWidth + 1 || bar.scrollHeight > bar.clientHeight + 1) return false;
  if (br.top < -0.5 || br.bottom > innerHeight + 0.5 || br.right > innerWidth + 0.5) return false;
  for (const e of bar.querySelectorAll('*')) {
    if (!e.getClientRects().length || e.closest('svg') || e.classList.contains('ms')) continue;
    if (e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1) return false;
    const r = e.getBoundingClientRect();
    if (r.right > br.right + 0.5 || r.left < br.left - 0.5 || r.bottom > br.bottom + 0.5 || r.top < br.top - 0.5) return false;
  }
  // over the clip: the bar keeps clear of the window buttons (top 8 + 28 px)
  return $('html').dataset.pipForm !== 'over' || br.top >= 40;
}
function pipPlace(form, vw, vh) {
  const html = document.documentElement;
  const bar = $('#pipBar');
  const W = innerWidth;
  const H = innerHeight;
  const vx = form === 'over' ? (W - vw) / 2 : 0;
  html.style.setProperty('--px', `${vx}px`);
  html.style.setProperty('--pvw', `${vw}px`);
  html.style.setProperty('--pvh', `${vh}px`);
  const box = form === 'below' ? [0, vh, W, H - vh] : form === 'side' ? [vw, 0, W - vw, H] : null;
  bar.style.cssText = box ? `left:${box[0]}px;top:${box[1]}px;width:${box[2]}px;height:${box[3]}px`
    : `left:${vx}px;width:${vw}px;bottom:0`;
}
function pipTry(form, rows, tips, vw, vh) {
  const html = document.documentElement;
  const bar = $('#pipBar');
  html.dataset.pipForm = form;
  bar.dataset.rows = rows;
  bar.dataset.tips = tips ? '1' : '0';
  pipPlace(form, vw, vh);
  // type: roomier in a bigger window, sized by the column beside the clip in a side form; 13 px text minimum
  html.style.fontSize = `${Math.max(16, Math.min(20, (form === 'side' ? (innerWidth - vw) * 2 : innerWidth) / 36))}px`;
  // a stacked strip drops nothing (else one row is better); a side column may drop the context and the
  // secondary button before the bar goes over the clip; one row drops down to number + primary icon
  const maxLv = rows === 1 ? PB_LEVELS.length : form === 'side' ? 2 : 0;
  for (const size of rows > 1 ? ['hero', 'ring', 'title2'] : ['title2']) {
    bar.dataset.size = size;
    for (let n = 0; n <= maxLv; n++) {
      html.classList.remove(...PB_LEVELS);
      html.classList.add(...PB_LEVELS.slice(0, n));
      if (barFits(bar)) { html.dataset.fit = `${form}${rows > 1 ? ` ${rows}-row` : ''}${tips ? ' tips' : ''} ${size} ${n}`; return true; }
    }
  }
  return false;
}
function pipFit() {
  const html = document.documentElement;
  if (html.dataset.view !== 'pip' || !P) {
    pipMoveActs(false);
    html.classList.remove(...PB_LEVELS, 'pip-show');
    delete html.dataset.pipForm;
    delete html.dataset.fit;
    html.style.fontSize = '';
    fitTitle();
    return;
  }
  pipMoveActs(true);
  const W = innerWidth;
  const H = innerHeight;
  const vw = Math.min(W, (H * 16) / 9);
  const vh = (vw * 9) / 16;
  const tips = !!(pipData && pipData.tips && pipData.tips.length);
  const tries = [];
  // a tall strip / a column: stacked (name / tips / number / actions) when it fits, then number + actions
  // side by side, then (strip) one row
  const t = (form, rows) => [...(tips ? [[form, rows, true]] : []), [form, rows, false]];
  if (H - vh >= 40) tries.push(...t('below', 3), ...t('below', 2), ['below', 1, false]);
  else if (W - vw >= SIDE_MIN) tries.push(...t('side', 3), ...t('side', 2));
  if (!tries.some(([f, r, tp]) => pipTry(f, r, tp, vw, vh)) && !pipTry('over', 1, false, vw, vh)) {
    html.dataset.fit = 'over (does not fit)';
  }
}
addEventListener('resize', pipFit);
document.fonts.ready.then(() => pipFit());
document.fonts.addEventListener('loadingdone', () => pipFit()); // a weight / glyph loaded late: re-measure

// The window buttons and the mode chip: on hover (main polls the cursor: a drag region gets no mouse
// events), for PEEK_MS after a phase change, and while a dialog is open.
let pipHover = false;
let peekUntil = 0;
let peekTimer = 0;
function pipChrome() {
  const on = pipHover || !!st.modal || performance.now() < peekUntil || !!(P && P.selftest); // selftest: shown, so it is linted
  document.documentElement.classList.toggle('pip-show', on);
}
function pipPeek() {
  peekUntil = performance.now() + PEEK_MS;
  clearTimeout(peekTimer);
  peekTimer = setTimeout(pipChrome, PEEK_MS + 20);
  pipChrome();
}
if (window.bf.onPipHover) window.bf.onPipHover((on) => { pipHover = !!on; pipChrome(); });

// The bar's content for one phase: name, context parts (metaHTML), the live number —
// num 'cd' (countdown + mini ring), { v, u } (a fixed value: the work target, the sets done) or null,
// icon (finish ✓ / ✗) — and the tips a tall strip may show.
function pipSet(d) {
  pipData = d;
  const bar = $('#pipBar');
  $('#pbName').textContent = d.name || '';
  $('#pbCtx').innerHTML = metaHTML(...(d.ctx || []));
  const r = 45;
  const c = 2 * Math.PI * r;
  const ring = `<svg class="pb-ring" viewBox="0 0 100 100" aria-hidden="true"><circle class="track" cx="50" cy="50" r="${r}" fill="none" stroke-width="12"/><circle class="bar" id="pbBar" cx="50" cy="50" r="${r}" fill="none" stroke-width="12" stroke-dasharray="${c}" stroke-dashoffset="0"/></svg>`;
  const n = d.num;
  bar.dataset.num = n === 'cd' ? 'cd' : n ? 'v' : '';
  $('#pbNum').innerHTML = (d.icon ? ICON(d.icon.name, `fill pb-icon ${d.icon.fail ? 'fail' : ''}`) : '')
    + (n === 'cd' ? `${ring}<span class="pb-v" id="pbVal"></span>` : '')
    + (n && n !== 'cd' ? `<span class="pb-v">${esc(n.v)}</span>${n.u ? `<span class="pb-u">${esc(n.u)}</span>` : ''}` : '');
  $('#pbTips').innerHTML = d.tips && d.tips.length ? tipsHTML(d.tips) : '';
}
function pipTick() {
  if (!pipData) return;
  if (pipData.num === 'cd') {
    const v = $('#pbVal');
    if (v) v.textContent = String(Math.max(0, Math.ceil(st.remaining - 1e-6)));
    const b = $('#pbBar');
    const c = 2 * Math.PI * 45;
    const frac = st.duration > 0 ? Math.max(0, Math.min(1, st.remaining / st.duration)) : 0;
    if (b) b.setAttribute('stroke-dashoffset', String(c * (1 - frac)));
  }
  const sw = $('#pbSw');
  if (sw) sw.textContent = mmss(st.elapsed);
}

function frame({ clip, chip, title = '', meta = '', body = '', sec = '', pri = '', cover = null, pip = null }) {
  $('#panel').classList.remove('menu');
  const box = $('#clipMain');
  if (clip) mountClip(box, clip.url, clip.name, { poster: clip.poster });
  const v = $('video', box);
  const vc = $('#vCover');
  vc.hidden = !cover;
  if (cover) {
    vc.className = `vcover ${cover.failed ? 'failed' : ''}`;
    vc.innerHTML = ICON(cover.icon, 'fill');
    if (v) v.pause();
  } else if (v && v.paused) {
    v.play().catch(() => {});
  }
  $('#pChip').innerHTML = chip
    ? `<span class="chip ${chip.tone || ''}">${chip.icon ? ICON(chip.icon, chip.fill ? 'fill' : '') : ''}${esc(chip.text)}</span>`
    : '';
  $('#pTitle').textContent = title;
  fitTitle();
  $('#pMeta').innerHTML = meta;
  const b = $('#pBody');
  b.innerHTML = body;
  $('#pSec').innerHTML = sec;
  $('#pPri').innerHTML = pri;
  pipSet(pip || { name: title });
}

const clipOf = (x) => ({ url: x.clipUrl, name: x.name, poster: x.posterUrl });
const firstClip = (it) => (it.type === 'reps' ? clipOf(it) : clipOf(it.moves[0]));

function tipsHTML(tips) {
  return `<ul class="tips">${(tips || []).slice(0, 2).map((t) => `<li>${ICON('check')}<span>${esc(t)}</span></li>`).join('')}</ul>`;
}
function moveDots(it, j) {
  return `<div class="move-dots">${it.moves.map((_, k) => `<i class="${k < j ? 'done' : k === j ? 'cur' : ''}"></i>`).join('')}</div>`;
}

// ---------- views ----------
function renderIntro() {
  const rows = P.items.map((it) => {
    const meta = itemMeta(it);
    return `<li><span class="nm">${esc(it.name)}${it.carried ? ICON('history') : ''}</span><span class="mt">${esc(meta)}</span></li>`;
  }).join('');
  const last = !!P.isLast;
  const session = P.mode === 'session';
  // 完整訓練: the whole menu and roughly how long it takes; leaving is Esc (no 跳過這次)
  const sets = P.items.reduce((a, it) => a + (it.type === 'reps' ? it.setsLeft : 0), 0);
  frame({
    clip: P.items.length ? firstClip(P.items[0]) : null,
    chip: last ? { tone: 'fail', icon: 'warning', fill: true, text: t('lastBreak') }
      : { icon: session ? 'fitness_center' : 'calendar_today', text: P.dayLabel || '' },
    title: P.dayTitle || '',
    meta: session ? metaHTML(esc(t('aboutMin', { n: Math.max(1, Math.ceil((P.estSec || 0) / 60)) })), sets ? esc(t(sets === 1 ? 'setsN1' : 'setsN', { n: sets })) : '') : '',
    body: `<ul class="plan">${rows}</ul>`,
    sec: session ? '' : btn('skipBtn', 'skip_next', t('skipThis')),
    pri: btn('startBtn', 'play_arrow', t('start'), { primary: true, fill: true, kbd: 'Space', cd: true }),
    // PIP: one summary line instead of the list — the last-break warning, minutes, moves, sets
    pip: {
      name: P.dayTitle || '',
      ctx: [last ? `<span class="warn">${ICON('warning', 'fill')}${esc(t('lastBreak'))}</span>` : '',
        P.estSec ? esc(t('aboutMin', { n: Math.max(1, Math.ceil(P.estSec / 60)) })) : '',
        esc(t(P.items.length === 1 ? 'movesN1' : 'movesN', { n: P.items.length })),
        sets ? esc(t(sets === 1 ? 'setsN1' : 'setsN', { n: sets })) : ''],
    },
  });
  $('#startBtn').onclick = startSteps;
  if (!session) $('#skipBtn').onclick = askSkip;
  // the whole day's menu: compact rows that share the height, in the empty secondary slot
  if (session) $('#panel').classList.add('menu');
}

function renderDemo(s) {
  const it = s.item;
  frame({
    clip: clipOf(it),
    chip: { icon: 'visibility', text: t('demo') },
    title: it.name,
    meta: metaHTML(setText(it, s.setNo), esc(repsText(it))),
    body: tipsHTML(it.tips),
    pri: btn('goBtn', 'play_arrow', t('start'), { primary: true, fill: true, kbd: 'Space', cd: true }),
    pip: { name: it.name, ctx: [setText(it, s.setNo), esc(repsText(it))], num: 'cd', tips: it.tips },
  });
  $('#goBtn').onclick = next;
}

function renderWork(s) {
  const it = s.item;
  frame({
    clip: clipOf(it),
    chip: { tone: 'accent', icon: 'directions_run', text: t('yourTurn') },
    title: it.name,
    meta: metaHTML(setText(it, s.setNo), it.perSide ? t('perSide') : ''),
    body: `<div class="big">${repRange(it)}<span class="u">${t('repUnit')}</span></div>
      <div class="sw-row"><span class="stopwatch" id="sw">00:00</span><span class="tempo">${ICON('slow_motion_video')}${t('tempo')}</span></div>`,
    pri: btn('doneBtn', 'check', t('doneSet'), { primary: true, kbd: 'Space' }),
    pip: {
      name: it.name,
      ctx: [setText(it, s.setNo), it.perSide ? t('perSide') : '', `${ICON('timer')}<span id="pbSw">00:00</span>`],
      num: { v: repRange(it), u: t('repUnit') },
    },
  });
  $('#doneBtn').onclick = completeSet;
}

function renderPreview(s) {
  frame({
    clip: clipOf(s.move),
    chip: { icon: 'arrow_forward', text: t('upNext') },
    title: s.move.name,
    meta: t('secs', { n: s.move.sec }),
    body: moveDots(s.item, s.j) + tipsHTML(s.move.tips),
    pri: btn('goBtn', 'play_arrow', t('start'), { primary: true, fill: true, kbd: 'Space', cd: true }),
    pip: { name: s.move.name, ctx: [esc(t('upNext')), t('secs', { n: s.move.sec })], num: 'cd', tips: s.move.tips },
  });
  $('#goBtn').onclick = next;
}

function renderTimed(s) {
  frame({
    clip: clipOf(s.move),
    chip: { tone: 'accent', icon: 'timer', text: t('yourTurn') },
    title: s.move.name,
    meta: esc(s.item.name),
    body: `<div class="hrow">${ringHTML()}${moveDots(s.item, s.j)}</div>`,
    pip: { name: s.move.name, ctx: [esc(s.item.name), `${s.j + 1}/${s.item.moves.length}`], num: 'cd' },
  });
}

// Stretch: a short look at the next stretch/side, then the timed hold. Same frame as the circuit.
function renderStretchPreview(s) {
  frame({
    clip: clipOf(s.move),
    chip: { icon: 'arrow_forward', text: t('upNext') },
    title: s.move.name,
    meta: metaHTML(sideText(s.side), t('secs', { n: s.item.holdSec })),
    body: moveDots(s.item, s.j) + tipsHTML(s.move.tips),
    pri: btn('goBtn', 'play_arrow', t('start'), { primary: true, fill: true, kbd: 'Space', cd: true }),
    pip: { name: s.move.name, ctx: [esc(t('upNext')), sideText(s.side), t('secs', { n: s.item.holdSec })], num: 'cd', tips: s.move.tips },
  });
  $('#goBtn').onclick = next;
}

function renderHold(s) {
  frame({
    clip: clipOf(s.move),
    chip: { tone: 'accent', icon: 'self_improvement', text: t('stretch') },
    title: s.move.name,
    meta: metaHTML(sideText(s.side), t('stretchNo', { n: s.j + 1, t: s.item.moves.length })),
    body: `<div class="hrow hold-row">${ringHTML()}${tipsHTML(s.move.tips)}</div>`, // n/t is in the meta line
    pri: btn('holdNext', 'skip_next', t('nextHold'), { primary: true, kbd: 'Space' }),
    pip: { name: s.move.name, ctx: [sideText(s.side), t('stretchNo', { n: s.j + 1, t: s.item.moves.length })], num: 'cd', tips: s.move.tips },
  });
  $('#holdNext').onclick = next;
}

function renderRest(s) {
  const n = s.next;
  const nIt = n.item;
  let chip;
  let parts;
  let clip;
  if (nIt.type === 'reps') {
    chip = nIt === s.item ? t('nextSet') : t('nextMove');
    parts = [setText(nIt, n.setNo), esc(repsText(nIt))];
    clip = clipOf(nIt);
  } else {
    chip = t('nextRound');
    parts = [esc(n.move.name), t('secs', { n: n.move.sec })];
    clip = clipOf(n.move);
  }
  const meta = metaHTML(...parts);
  const adjust = s.kind === 'rest' ? adjustHTML() : '';
  frame({
    clip,
    chip: { icon: 'arrow_forward', text: chip },
    title: nIt.name,
    meta,
    body: `<div class="hrow">${ringHTML()}${adjust}</div>`,
    sec: btn('plus30', 'more_time', t('plus30')),
    pri: btn('skipRest', 'skip_next', t('skipRest'), { primary: true, kbd: 'Space' }),
    pip: { name: nIt.name, ctx: [esc(chip), ...parts], num: 'cd' },
  });
  $('#skipRest').onclick = next;
  // (+30 s can add a digit: the PIP bar re-fits)
  $('#plus30').onclick = () => { st.remaining += 30; st.duration = Math.max(st.duration, st.remaining); updateTick(); pipFit(); };
  bindAdjust(adjust);
}

// 上一組 −/+ — after a finished rep set: on the rest screen, and on the finish screen when the
// break ended with a rep set (no rest step follows the final set).
function adjustHTML() {
  const prev = steps[st.i - 1];
  return prev && prev.kind === 'work' && st.lastRec
    ? `<div class="adjust"><span class="lbl">${t('prevSet')}</span><div class="stepper">
        <button class="btn" id="repMinus" aria-label="${t('decreaseReps')}">${ICON('remove')}</button><span class="val" id="repVal">${st.lastRec.reps}</span><button class="btn" id="repPlus" aria-label="${t('increaseReps')}">${ICON('add')}</button></div></div>`
    : '';
}
function bindAdjust(html) {
  if (!html) return;
  $('#repMinus').onclick = () => adjustReps(-1);
  $('#repPlus').onclick = () => adjustReps(1);
}

function renderFinish() {
  const test = P.mode === 'test'; // test runs record nothing: never show them as today's progress
  // a mixed 自選 session: its 加練 sets / stretch are not today's progress
  const done = P.todayDone + (test ? 0 : st.sessionSets - (st.extraSets || 0));
  const total = P.todayTotal;
  const stretchOwed = !!P.stretchOwed && !(st.stretchDone && !isExtra({ unitId: 'stretch' }));
  const allDone = total > 0 && done >= total && !stretchOwed;
  const failed = P.isLast && !allDone && P.mode === 'slot';
  let chip = { icon: 'check_circle', text: t('done') };
  const session = P.mode === 'session';
  if (!test && P.isLast && P.mode === 'slot') {
    chip = allDone ? { tone: 'accent', icon: 'check_circle', fill: true, text: t('passedToday') } : { tone: 'fail', icon: 'cancel', fill: true, text: t('failedToday') };
  } else if (!test && allDone) {
    // a full workout of today's plan that clears the day passes it; an extra one is just done
    const word = session ? (P.extra ? 'sessionDone' : 'passedToday') : 'allDoneToday';
    chip = { tone: 'accent', icon: 'check_circle', fill: true, text: t(word) };
  }
  // training cleared before the last break: say the stretch still waits there
  const later = !test && total > 0 && done >= total && stretchOwed && !P.isLast;
  const nextAt = !test && !allDone && P.nextBreak && !P.isLast
    ? metaHTML(`${ICON(later ? 'self_improvement' : 'schedule')}${esc(later ? t('stretchLater') : t('nextAt', { t: P.nextBreak }))}`) : '';
  const adjust = adjustHTML();
  const prog = total > 0 && !test ? `<div class="today ${failed ? 'failed' : ''}">
      <div class="txt">${done}<small>/ ${total} ${t('setsUnit')}</small></div>
      <div class="bar"><div style="width:${Math.min(100, (done / total) * 100)}%"></div></div></div>` : '';
  frame({
    chip,
    title: t(session ? 'thisSession' : 'thisBreak', { n: st.sessionSets }),
    // every set can be done and the day still fail: say it was the stretch
    meta: failed && stretchOwed ? metaHTML(`${ICON('self_improvement')}${esc(t('stretchNotDone'))}`) : nextAt,
    body: prog + adjust,
    pri: btn('closeBtn', 'close', t('close'), { primary: true, kbd: 'Space', cd: true }),
    cover: { icon: failed ? 'cancel' : 'check_circle', failed },
    // PIP: ✓ / ✗ + the sets of this break, today's count and what comes next
    pip: {
      name: chip.text,
      ctx: [total > 0 && !test ? esc(t('progressOf', { a: done, b: total })) : '',
        failed && stretchOwed ? esc(t('stretchNotDone'))
          : !test && !allDone && P.nextBreak && !P.isLast ? esc(later ? t('stretchLater') : t('nextAt', { t: P.nextBreak })) : ''],
      num: { v: String(st.sessionSets), u: t('setsUnit') },
      icon: { name: failed ? 'cancel' : 'check_circle', fail: failed },
    },
  });
  $('#closeBtn').onclick = () => end('done');
  bindAdjust(adjust);
}

function renderStep() {
  const s = cur();
  ({
    demo: renderDemo, work: renderWork, preview: renderPreview, timed: renderTimed, rest: renderRest, roundRest: renderRest,
    stretchPreview: renderStretchPreview, hold: renderHold,
  })[s.kind](s);
}

function render() {
  st.shownAt = performance.now();
  if (st.phase === 'intro') renderIntro();
  else if (st.phase === 'finish') renderFinish();
  else renderStep();
  $('#panel').dataset.kind = st.phase === 'step' ? cur().kind : st.phase;
  renderTop();
  updateTick();
  pipFit();
  pipPeek();
}

function updateTick() {
  if (st.phase === 'step' && cur() && cur().kind === 'work') {
    const sw = $('#sw');
    if (sw) sw.textContent = mmss(st.elapsed);
  } else {
    updateRing('ring', st.remaining, st.duration);
    const cd = $('#cd');
    if (cd) cd.textContent = String(Math.max(0, Math.ceil(st.remaining - 1e-6)));
  }
  pipTick();
}

// ---------- flow ----------
function setPhase(phase, dur) {
  st.phase = phase;
  st.duration = dur;
  st.remaining = dur;
  st.elapsed = 0;
}

function startSteps() {
  if (st.phase !== 'intro') return;
  st.phase = 'step';
  st.i = -1;
  next();
}

function next() {
  if (st.ended) return;
  const prev = steps[st.i];
  st.i += 1;
  while (st.i < steps.length && RECORD_KINDS.has(steps[st.i].kind)) {
    // a full circuit round / every stretch hold just finished: record it (the stretch is not a set)
    const s = steps[st.i];
    if (s.kind === 'round') { st.sessionSets += 1; if (isExtra(s.item)) st.extraSets += 1; }
    else st.stretchDone = true;
    window.bf.setDone(s.item.unitId, 0);
    st.i += 1;
  }
  if (st.i >= steps.length) {
    finish();
    return;
  }
  const s = steps[st.i];
  st.phase = 'step';
  st.duration = durFor(s);
  st.remaining = st.duration;
  st.elapsed = 0;
  if (!STRETCH_KINDS.has(s.kind)) chime();
  else if (s.side === 'left' && prev && prev.move === s.move && prev.side === 'right') sideCue(); // first step of the left side
  else softCue();
  render();
}

async function completeSet() {
  const s = cur();
  if (!s || s.kind !== 'work' || st.busy) return;
  st.busy = true;
  const reps = s.item.target[0];
  st.sessionSets += 1;
  if (isExtra(s.item)) st.extraSets += 1;
  let index = -1;
  try { index = await window.bf.setDone(s.item.unitId, reps); } catch (_) { /* keep going */ }
  st.lastRec = { unitId: s.item.unitId, index, reps };
  st.busy = false;
  next();
}

function adjustReps(d) {
  if (!st.lastRec) return;
  st.lastRec.reps = Math.max(0, Math.min(200, st.lastRec.reps + d));
  $('#repVal').textContent = st.lastRec.reps;
  if (st.phase === 'finish') { st.remaining = FINISH_SEC; st.duration = FINISH_SEC; }
  if (st.lastRec.index >= 0) window.bf.setReps(st.lastRec.unitId, st.lastRec.index, st.lastRec.reps);
}

function finish() {
  setPhase('finish', FINISH_SEC);
  chime();
  render();
}

function end(outcome) {
  if (st.ended) return;
  st.ended = true;
  window.bf.end(outcome);
}

function onTimeout() {
  if (st.phase === 'intro') startSteps();
  else if (st.phase === 'finish') end('done');
  else next();
}

// ---------- modal ----------
function openModal({ kind, title, body, ok, cancel = t('continue'), warn = false, onOk }) {
  st.modal = { onOk, kind };
  $('#mTitle').textContent = title;
  $('#mBody').textContent = body;
  $('#mBody').className = warn ? 'warn' : '';
  $('#mOk').textContent = ok;
  $('#mCancel').textContent = cancel;
  $('#modal').hidden = false;
  $('#mCancel').focus();
  pipChrome();
}
function closeModal() {
  st.modal = null;
  $('#modal').hidden = true;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  pipChrome();
}

function askLeave() {
  if (st.phase === 'finish') { end('done'); return; }
  const lastWarn = P.isLast && P.mode === 'slot';
  openModal({
    kind: 'leave',
    title: t(P.mode === 'session' ? 'leaveSessionQ' : 'leaveQ'),
    body: lastWarn ? t('leaveFails') : '',
    ok: t('leave'),
    warn: lastWarn,
    onOk: () => end('abort'),
  });
}

function askSkip() {
  if (P.isLast && P.mode === 'slot') {
    openModal({ kind: 'skip', title: t('skipLastQ'), body: t('skipFails'), ok: t('skip'), warn: true, onOk: () => end('skip') });
  } else {
    end('skip');
  }
}

// ---------- timer ----------
let lastT = performance.now();
setInterval(() => {
  const t = performance.now();
  const dt = (t - lastT) / 1000;
  lastT = t;
  if (!P || st.frozen || st.modal || st.ended) return;
  if (counting()) {
    const before = st.remaining;
    st.remaining -= dt;
    const a = Math.ceil(before);
    const b = Math.ceil(st.remaining);
    if (b < a && b >= 1 && b <= 3) beep();
    if (st.remaining <= 0) { onTimeout(); return; }
  } else {
    st.elapsed += dt;
  }
  updateTick();
}, 100);

document.addEventListener('keydown', (e) => {
  if (st.ended) return;
  if (document.documentElement.dataset.view === 'pip') return; // PIP is mouse-only: the keyboard belongs to the app underneath
  if (e.key === 'Escape') {
    e.preventDefault();
    if (st.modal) closeModal();
    else askLeave();
    return;
  }
  if ((e.key === 'f' || e.key === 'F') && !st.modal && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    toggleView();
    return;
  }
  if (st.modal) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const f = document.activeElement === $('#mOk') ? st.modal.onOk : null;
      closeModal();
      if (f) f();
    }
    return;
  }
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault(); // never let a focused button (e.g. 離開) catch the key
    // Holding Space must not skip several phases: ignore auto-repeat and a short window after
    // every phase change.
    if (e.repeat || performance.now() - st.shownAt < KEY_GUARD_MS) return;
    pressPrimary();
  }
});

// Space / Enter = the primary (bottom-right) button of the current phase, whatever it is.
function pressPrimary() {
  const b = $('#pPri .btn');
  if (b && !b.disabled) b.click();
}

$('#leaveBtn').onclick = (e) => { e.currentTarget.blur(); askLeave(); };

// ---------- PIP ⇄ window ⇄ full screen: main reshapes the SAME window, so this page keeps its state ----------
const VIEW_LABEL = { pip: 'viewPipMenu', window: 'viewWindow', full: 'viewFull' }; // button tooltips
function applyView(v) {
  const view = VIEW_LABEL[v] ? v : 'full';
  document.documentElement.dataset.view = view;
  if (P) pipFit();
  // the header offers the two other views; F (full ⇄ window) shows its keycap on the button it presses
  for (const b of document.querySelectorAll('.vbtn')) {
    b.hidden = b.dataset.v === view;
    b.title = t(VIEW_LABEL[b.dataset.v]);
    b.setAttribute('aria-label', b.title);
  }
  $('#winBtn kbd').hidden = view !== 'full';
  $('#fullBtn kbd').hidden = view !== 'window';
  const m = $('#minBtn');
  m.hidden = view !== 'window';
  m.title = t('minimize');
  m.setAttribute('aria-label', m.title);
  const l = $('#leaveBtn'); // a narrow window shows its icon only
  l.title = t('leave');
  l.setAttribute('aria-label', l.title);
}
const hasViews = () => [...document.querySelectorAll('.vbtn')].some((b) => b.offsetParent); // hidden in the web build
const toggleView = () => { if (hasViews()) window.bf.toggleView(); };
for (const b of document.querySelectorAll('.vbtn')) b.onclick = (e) => { e.currentTarget.blur(); if (hasViews()) window.bf.setView(b.dataset.v); };
$('#minBtn').onclick = (e) => { e.currentTarget.blur(); window.bf.minimize(); };
window.bf.onView(applyView);
// the break opens in the saved view (main passes ?view=); the web build has no window view
applyView(new URLSearchParams(location.search).get('view') || 'full');
if (!hasViews()) applyView('full');
// window / PIP: Alt+F4 / the taskbar's Close asks like 離開 (main keeps the window open)
window.bf.onAskLeave(() => { if (P && !st.ended && !st.modal) askLeave(); });
addEventListener('bf:lang', () => applyView(document.documentElement.dataset.view));
$('#mCancel').onclick = closeModal;
$('#mOk').onclick = () => { const f = st.modal && st.modal.onOk; closeModal(); if (f) f(); };

// ---------- language switched live: same progress, new text (main re-texts the payload) ----------
addEventListener('bf:lang', async () => {
  if (!P || st.ended) return;
  const np = await window.bf.payload();
  if (!np) return;
  Object.assign(P, { lang: np.lang, dayLabel: np.dayLabel, dayTitle: np.dayTitle });
  P.items.forEach((it, i) => {
    const n = np.items[i];
    if (!n) return;
    Object.assign(it, { name: n.name, tips: n.tips });
    if (it.moves) it.moves.forEach((m, j) => Object.assign(m, { name: n.moves[j].name, tips: n.moves[j].tips }));
  });
  const modal = st.modal && st.modal.kind;
  render();
  if (modal === 'leave') askLeave();
  else if (modal === 'skip') askSkip();
});

// ---------- boot ----------
(async function boot() {
  P = await window.bf.payload();
  if (!P) return;
  window.LANG = I18N.norm(P.lang);
  steps = buildSteps(P.items);
  setPhase('intro', INTRO_SEC);
  st.frozen = !!P.selftest;
  render();
  chime();
})();

// ---------- selftest hooks (frozen timers, jump to any screen) ----------
window.__test = {
  ready: () => !!P,
  show(kind, opts = {}) {
    closeModal();
    st.frozen = true;
    st.stretchDone = !!opts.stretchDone; // finish screen of a last break whose stretch was (not) done
    if (kind === 'intro') {
      setPhase('intro', INTRO_SEC);
    } else if (kind === 'finish') {
      st.sessionSets = opts.sets || 0;
      st.extraSets = opts.extraSets || 0;
      st.lastRec = null;
      if (opts.afterWork) {
        st.i = steps.length;
        const w = steps[steps.length - 1];
        st.lastRec = w && w.kind === 'work' ? { unitId: w.item.unitId, index: -1, reps: opts.reps || w.item.target[0] } : null;
      }
      setPhase('finish', FINISH_SEC);
    } else {
      let n = opts.nth || 0;
      const idx = steps.findIndex((s) => s.kind === kind && n-- === 0);
      if (idx < 0) return false;
      st.phase = 'step';
      st.i = idx;
      st.duration = durFor(steps[idx]);
      st.remaining = st.duration;
      st.elapsed = 0;
      if (kind === 'rest') st.lastRec = { unitId: steps[idx].item.unitId, index: -1, reps: opts.reps || steps[idx].item.target[0] };
    }
    if (opts.remaining != null) st.remaining = opts.remaining;
    if (opts.elapsed != null) st.elapsed = opts.elapsed;
    render();
    return true;
  },
  leave: () => { askLeave(); return true; },
  skip: () => { askSkip(); return true; },
  steps: () => steps.map((s) => s.kind),
  phase: () => (st.phase === 'step' ? cur().kind : st.phase),
  // what a live view switch must not change
  state: () => JSON.stringify({ phase: st.phase === 'step' ? cur().kind : st.phase, i: st.i, remaining: st.remaining, elapsed: st.elapsed, sets: st.sessionSets, lastRec: st.lastRec }),
  key: (key, repeat = false) => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, repeat, bubbles: true }));
    return st.phase === 'step' ? cur().kind : st.phase;
  },
  theme: () => document.documentElement.dataset.theme,
  pipFit: () => document.documentElement.dataset.fit || '', // PIP: form, rows, number size, level
};
