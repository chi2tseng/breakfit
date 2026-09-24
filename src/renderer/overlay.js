'use strict';
/* Break overlay: intro → [demo → work → rest]… / circuit [preview → timed]… → finish. */

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
  lastRec: null, // { unitId, index, reps } of the set just finished
  ended: false,
  shownAt: 0, // performance.now() when the current phase was rendered
};

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

// ---------- step plan ----------
function nextRef(it) {
  return it.type === 'reps' ? { item: it, setNo: it.setNo } : { item: it, move: it.moves[0] };
}

function buildSteps(items) {
  const out = [];
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
  return out;
}

function durFor(s) {
  switch (s.kind) {
    case 'demo': return P.demoSec;
    case 'preview': return PREVIEW_SEC;
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
  const modeLabel = P.mode === 'manual' ? t('earlyBreak') : P.mode === 'test' ? t('test') : '';
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
  `<button class="btn ${primary ? 'primary' : 'ghost'}" id="${id}">${ICON(icon, fill ? 'fill' : '')}${esc(label)}${kbd ? `<kbd>${kbd}</kbd>` : ''}${cd ? '<span class="cd" id="cd"></span>' : ''}</button>`;

function frame({ clip, chip, title = '', meta = '', body = '', sec = '', pri = '', cover = null }) {
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
  $('#pMeta').innerHTML = meta;
  const b = $('#pBody');
  b.innerHTML = body;
  $('#pSec').innerHTML = sec;
  $('#pPri').innerHTML = pri;
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
    const meta = it.type === 'reps'
      ? `${it.setsLeft} × ${repsText(it)}`
      : t('timedMeta', { n: it.moves.length, s: it.moves[0].sec });
    return `<li><span class="nm">${esc(it.name)}${it.carried ? ICON('history') : ''}</span><span class="mt">${esc(meta)}</span></li>`;
  }).join('');
  const last = !!P.isLast;
  frame({
    clip: P.items.length ? firstClip(P.items[0]) : null,
    chip: last ? { tone: 'fail', icon: 'warning', fill: true, text: t('lastBreak') } : { icon: 'calendar_today', text: P.dayLabel || '' },
    title: P.dayTitle || '',
    body: `<ul class="plan">${rows}</ul>`,
    sec: btn('skipBtn', 'skip_next', t('skipThis')),
    pri: btn('startBtn', 'play_arrow', t('start'), { primary: true, fill: true, kbd: 'Space', cd: true }),
  });
  $('#startBtn').onclick = startSteps;
  $('#skipBtn').onclick = askSkip;
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
  });
}

function renderRest(s) {
  const n = s.next;
  const nIt = n.item;
  let chip;
  let meta;
  let clip;
  if (nIt.type === 'reps') {
    chip = nIt === s.item ? t('nextSet') : t('nextMove');
    meta = metaHTML(setText(nIt, n.setNo), esc(repsText(nIt)));
    clip = clipOf(nIt);
  } else {
    chip = t('nextRound');
    meta = metaHTML(esc(n.move.name), t('secs', { n: n.move.sec }));
    clip = clipOf(n.move);
  }
  const adjust = s.kind === 'rest' ? adjustHTML() : '';
  frame({
    clip,
    chip: { icon: 'arrow_forward', text: chip },
    title: nIt.name,
    meta,
    body: `<div class="hrow">${ringHTML()}${adjust}</div>`,
    sec: btn('plus30', 'more_time', t('plus30')),
    pri: btn('skipRest', 'skip_next', t('skipRest'), { primary: true, kbd: 'Space' }),
  });
  $('#skipRest').onclick = next;
  $('#plus30').onclick = () => { st.remaining += 30; st.duration = Math.max(st.duration, st.remaining); updateTick(); };
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
  const done = P.todayDone + (test ? 0 : st.sessionSets);
  const total = P.todayTotal;
  const allDone = total > 0 && done >= total;
  const failed = P.isLast && !allDone && P.mode === 'slot';
  let chip = { icon: 'check_circle', text: t('done') };
  if (!test && P.isLast && P.mode === 'slot') {
    chip = allDone ? { tone: 'accent', icon: 'check_circle', fill: true, text: t('passedToday') } : { tone: 'fail', icon: 'cancel', fill: true, text: t('failedToday') };
  } else if (!test && allDone) chip = { tone: 'accent', icon: 'check_circle', fill: true, text: t('allDoneToday') };
  const nextAt = !test && !allDone && P.nextBreak && !P.isLast ? metaHTML(`${ICON('schedule')}${esc(t('nextAt', { t: P.nextBreak }))}`) : '';
  const adjust = adjustHTML();
  const prog = total > 0 && !test ? `<div class="today ${failed ? 'failed' : ''}">
      <div class="txt">${done}<small>/ ${total} ${t('setsUnit')}</small></div>
      <div class="bar"><div style="width:${Math.min(100, (done / total) * 100)}%"></div></div></div>` : '';
  frame({
    chip,
    title: t('thisBreak', { n: st.sessionSets }),
    meta: nextAt,
    body: prog + adjust,
    pri: btn('closeBtn', 'close', t('close'), { primary: true, kbd: 'Space', cd: true }),
    cover: { icon: failed ? 'cancel' : 'check_circle', failed },
  });
  $('#closeBtn').onclick = () => end('done');
  bindAdjust(adjust);
}

function renderStep() {
  const s = cur();
  ({ demo: renderDemo, work: renderWork, preview: renderPreview, timed: renderTimed, rest: renderRest, roundRest: renderRest })[s.kind](s);
}

function render() {
  st.shownAt = performance.now();
  if (st.phase === 'intro') renderIntro();
  else if (st.phase === 'finish') renderFinish();
  else renderStep();
  renderTop();
  updateTick();
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
  st.i += 1;
  while (st.i < steps.length && steps[st.i].kind === 'round') {
    // a full circuit round just finished: record it
    const s = steps[st.i];
    st.sessionSets += 1;
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
  chime();
  render();
}

async function completeSet() {
  const s = cur();
  if (!s || s.kind !== 'work' || st.busy) return;
  st.busy = true;
  const reps = s.item.target[0];
  st.sessionSets += 1;
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
}
function closeModal() {
  st.modal = null;
  $('#modal').hidden = true;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}

function askLeave() {
  if (st.phase === 'finish') { end('done'); return; }
  const lastWarn = P.isLast && P.mode === 'slot';
  openModal({
    kind: 'leave',
    title: t('leaveQ'),
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
  if (e.key === 'Escape') {
    e.preventDefault();
    if (st.modal) closeModal();
    else askLeave();
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
    if (kind === 'intro') {
      setPhase('intro', INTRO_SEC);
    } else if (kind === 'finish') {
      st.sessionSets = opts.sets || 0;
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
  key: (key, repeat = false) => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, repeat, bubbles: true }));
    return st.phase === 'step' ? cur().kind : st.phase;
  },
  theme: () => document.documentElement.dataset.theme,
};
