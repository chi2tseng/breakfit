'use strict';
// Day record lifecycle: build → distribute → pending → check → record sets → grade.
const { parseHM, fmtHM, addDays } = require('./time');
const { computeSlots } = require('./slots');
const { planDayFor } = require('./cycle');

const TRAINING = (plan, planDay) => !!(plan.days && plan.days[planDay]);
// End-of-day stretch: one unit per training day (targetSets 1), pinned to the last slot, never part
// of the floor(i*M/N) spread. Records made before it existed simply have no such unit.
const STRETCH_ID = 'stretch';
const isStretch = (u) => u.type === 'stretch';

function buildUnits(plan, planDay, overrides = {}) {
  const d = plan.days[planDay];
  if (!d) return [];
  const units = d.units.map((u) => {
    if (u.type === 'circuit') {
      return { id: u.id, name: u.name, type: 'circuit', moves: u.moves, targetSets: u.sets, doneSets: 0, reps: [], slot: 0 };
    }
    const ov = overrides[u.id] || {};
    const sets = Number.isFinite(ov.sets) && ov.sets > 0 ? ov.sets : u.sets;
    const target = Array.isArray(ov.reps) && ov.reps.length === 2 ? [...ov.reps] : [...u.reps];
    return { id: u.id, name: u.name, type: 'reps', targetSets: sets, target, doneSets: 0, reps: [], slot: 0 };
  });
  if (Array.isArray(d.stretch) && d.stretch.length) {
    units.push({ id: STRETCH_ID, name: '拉伸', type: 'stretch', stretches: [...d.stretch], targetSets: 1, doneSets: 0, reps: [], slot: 0 });
  }
  return units;
}

// Unit i of N goes to slot floor(i*M/N).
function slotForUnit(i, n, m) {
  return Math.floor((i * m) / n);
}

// Spread over slots [first, m): a day first seen mid-day (late boot / install) shouldn't dump
// the already-passed slots' share onto the next break. The stretch unit always sits on the last slot.
function distribute(units, m, first = 0) {
  const f = Math.max(0, Math.min(first, m - 1));
  const train = units.filter((u) => !isStretch(u));
  train.forEach((u, i) => { u.slot = f + slotForUnit(i, train.length, m - f); });
  units.forEach((u) => { if (isStretch(u)) u.slot = Math.max(0, m - 1); });
  return units;
}

// Index of the first slot still ahead of nowMin (within grace); last slot if all have passed.
function firstOpenSlot(times, nowMin, graceMin = 5) {
  const i = times.findIndex((t) => nowMin - parseHM(t) <= graceMin);
  return i === -1 ? Math.max(0, times.length - 1) : i;
}

// Everything still owed today, the stretch included (grading, "is the day finished").
function remainingSets(day) {
  return day.units.reduce((a, u) => a + Math.max(0, u.targetSets - u.doneSets), 0);
}
// Set counts shown to the user ("17 / 25 組") are training sets only: the stretch is not a set.
function totalSets(day) {
  return day.units.reduce((a, u) => a + (isStretch(u) ? 0 : u.targetSets), 0);
}
function doneSets(day) {
  return day.units.reduce((a, u) => a + (isStretch(u) ? 0 : Math.min(u.doneSets, u.targetSets)), 0);
}
// true / false for a day that has a stretch unit, null for one that has none (rest/off, old records).
function stretchDone(day) {
  const u = day.units.find(isStretch);
  return u ? u.doneSets >= u.targetSets : null;
}

function lastSlot(day) {
  return day.slots.length - 1;
}

// Units still owing sets that are due at slot k (the last slot / k >= last owes everything).
// The stretch is pinned to the last slot, so it is only ever pending there (or for a manual break
// whose next slot is the last one), after the training units.
function pendingUnits(day, k) {
  const last = lastSlot(day);
  const kk = Math.min(k, last);
  return day.units
    .map((u, i) => ({ unit: u, index: i, carried: u.slot < kk }))
    .filter(({ unit }) => unit.doneSets < unit.targetSets && (k >= last || unit.slot <= k));
}

function nextSlotIndex(day) {
  return day.slots.findIndex((s) => s.status === 'pending');
}

function gradeDay(day, dayKey, todayKey) {
  if (day.planDay === 'rest') return 'rest';
  if (day.planDay === 'off') return 'off';
  if (!day.units.length) return 'off';
  if (remainingSets(day) === 0) return 'pass';
  if (dayKey < todayKey) return 'fail';
  if (day.paused) return 'fail';
  const last = day.slots[lastSlot(day)];
  if (!last || last.status !== 'pending') return 'fail';
  return 'pending';
}

function createDay(key, settings, plan, nowMin = -Infinity) {
  const planDay = planDayFor(key, settings, plan.cycle);
  const training = TRAINING(plan, planDay);
  const times = training ? computeSlots(settings) : [];
  const units = training
    ? distribute(buildUnits(plan, planDay, settings.overrides), times.length, firstOpenSlot(times, nowMin))
    : [];
  const day = {
    planDay,
    units,
    slots: times.map((time) => ({ time, status: 'pending' })),
    events: [],
    status: 'pending',
    note: '',
  };
  day.status = gradeDay(day, key, key);
  return day;
}

/**
 * Decide what the 15-second checker should do right now.
 * Returns { marks: {slotIndex: status}, open: slotIndex|null, notify: boolean }.
 */
function planCheck(day, nowMin, { startup = false, graceMin = 5, notifyEmptySlots = true } = {}) {
  const res = { marks: {}, open: null, notify: false };
  if (day.paused || !day.slots.length || day.status === 'pass' || day.status === 'fail') {
    // still silently close out due slots once the day is decided
    if (day.slots.length && (day.status === 'pass' || day.status === 'fail')) {
      day.slots.forEach((s, k) => {
        if (s.status === 'pending' && parseHM(s.time) <= nowMin) res.marks[k] = day.status === 'pass' ? 'empty' : 'missed';
      });
    }
    return res;
  }
  const due = [];
  day.slots.forEach((s, k) => { if (s.status === 'pending' && parseHM(s.time) <= nowMin) due.push(k); });
  if (!due.length) return res;
  if (remainingSets(day) === 0) {
    due.forEach((k) => { res.marks[k] = 'empty'; });
    return res;
  }
  let candidates = due;
  // Timed pause: due slots become missed (their sets roll on) — except the last slot, which always opens.
  if (Number.isFinite(day.pausedUntil) && nowMin < day.pausedUntil) {
    const last = lastSlot(day);
    candidates = [];
    for (const k of due) {
      if (k === last) candidates.push(k);
      else res.marks[k] = 'missed';
    }
  }
  if (startup) {
    const c2 = [];
    for (const k of candidates) {
      if (nowMin - parseHM(day.slots[k].time) > graceMin) res.marks[k] = 'missed';
      else c2.push(k);
    }
    candidates = c2;
  }
  if (!candidates.length) return res;
  const k = candidates[candidates.length - 1];
  candidates.slice(0, -1).forEach((j) => { res.marks[j] = 'missed'; });
  if (pendingUnits(day, k).length) {
    res.open = k;
  } else if (notifyEmptySlots) {
    res.marks[k] = 'notified';
    res.notify = true;
  } else {
    res.marks[k] = 'empty';
  }
  return res;
}

function applyMarks(day, marks) {
  for (const [k, st] of Object.entries(marks)) day.slots[Number(k)].status = st;
}

function recordSet(day, unitId, reps) {
  const u = day.units.find((x) => x.id === unitId);
  if (!u || u.doneSets >= u.targetSets) return -1;
  u.doneSets += 1;
  if (u.type === 'reps' || !u.type) u.reps.push(Math.max(0, Math.round(reps || 0)));
  return u.reps.length - 1;
}

function setReps(day, unitId, idx, reps) {
  const u = day.units.find((x) => x.id === unitId);
  if (!u || idx < 0 || idx >= u.reps.length) return false;
  u.reps[idx] = Math.max(0, Math.round(reps));
  return true;
}

function closeRemainingIfDone(day) {
  if (remainingSets(day) === 0) day.slots.forEach((s) => { if (s.status === 'pending') s.status = 'empty'; });
}

// outcome: 'done' | 'skip' | 'abort'. slotIndex null = manual break (no slot marking).
function endBreak(day, slotIndex, outcome, setsThisBreak) {
  if (slotIndex !== null && slotIndex !== undefined && day.slots[slotIndex]) {
    let st = 'done';
    if (outcome === 'skip') st = 'skipped';
    else if (outcome === 'abort') st = setsThisBreak > 0 ? 'partial' : 'skipped';
    day.slots[slotIndex].status = st;
  }
  closeRemainingIfDone(day);
}

// "Pause until tomorrow": every pending slot is missed and the day fails.
function pauseDay(day) {
  day.paused = true;
  day.pausedUntil = null;
  day.slots.forEach((s) => { if (s.status === 'pending') s.status = 'missed'; });
}

// Timed pause until minute-of-day `untilMin` (null = cancel).
function pauseUntil(day, untilMin) {
  day.pausedUntil = Number.isFinite(untilMin) ? Math.min(untilMin, 1440) : null;
}

const isDecided = (day) => day.status === 'pass' || day.status === 'fail';

/**
 * Re-derive today's slots after a settings change, keeping progress (SPEC §2: planDay is fixed
 * once the record exists). Only `replan: true` (the explicit "set today to day X" action) may
 * change planDay, and only while the day is still undecided; progress of the plan day being
 * left is stashed and restored if the user switches back.
 */
function rebuildDay(day, key, settings, plan, nowMin, { replan = false, graceMin = 5 } = {}) {
  const decided = isDecided(day);
  if (replan && !decided) {
    const planDay = planDayFor(key, settings, plan.cycle);
    if (planDay !== day.planDay) {
      day.stash = day.stash || {};
      if (day.units.length) day.stash[day.planDay] = day.units;
      day.units = day.stash[planDay] || (TRAINING(plan, planDay) ? buildUnits(plan, planDay, settings.overrides) : []);
      delete day.stash[planDay];
      if (!Object.keys(day.stash).length) delete day.stash;
      day.planDay = planDay;
    }
  }
  const training = TRAINING(plan, day.planDay) && day.units.length > 0;
  const times = training ? computeSlots(settings) : [];
  const old = new Map(day.slots.map((s) => [s.time, s.status]));
  day.slots = times.map((time) => ({
    time,
    status: old.get(time) || (nowMin - parseHM(time) > graceMin ? 'missed' : 'pending'),
  }));
  if (day.paused) day.slots.forEach((s) => { if (s.status === 'pending') s.status = 'missed'; });
  // Undecided day whose new last slot is already handled/past: keep a final break so it still opens.
  if (training && !decided && !day.paused && remainingSets(day) > 0) {
    const last = day.slots[day.slots.length - 1];
    if (last.status !== 'pending') {
      const t = Math.min(1439, Math.max(Math.ceil(nowMin), parseHM(last.time) + 1));
      day.slots.push({ time: fmtHM(t), status: 'pending' });
    }
  }
  const open = day.slots.findIndex((s) => s.status === 'pending');
  distribute(day.units, day.slots.length, open === -1 ? day.slots.length - 1 : open);
  closeRemainingIfDone(day);
  if (!decided) day.status = gradeDay(day, key, key);
  return day;
}

// Cycle anchor for a first install at nowMin: if today's last break (+grace) is already over, the
// cycle starts tomorrow (today becomes a rest day) so the install day can't be graded 'fail'.
function initialAnchor(key, nowMin, settings, graceMin = 5) {
  const times = computeSlots(settings);
  const late = nowMin - parseHM(times[times.length - 1]) > graceMin;
  return { date: late ? addDays(key, 1) : key, index: 0 };
}

// Frozen record for a past date the app never ran: graded once, never re-derived from later settings.
function createMissedDay(key, settings, plan) {
  const planDay = planDayFor(key, settings, plan.cycle);
  const units = TRAINING(plan, planDay) ? buildUnits(plan, planDay, settings.overrides) : [];
  const day = { planDay, units, slots: [], events: [], status: 'pending', note: '', implied: true };
  day.status = gradeDay(day, key, addDays(key, 1));
  return day;
}

// Write frozen records for every missing date in [installedDate or first record, todayKey). Returns added keys.
function fillMissedDays(days, settings, plan, todayKey) {
  const keys = Object.keys(days).sort();
  let from = settings.installedDate || keys[0];
  if (!from) return [];
  if (keys[0] && keys[0] < from) from = keys[0];
  const added = [];
  for (let k = from; k < todayKey; k = addDays(k, 1)) {
    if (!days[k]) { days[k] = createMissedDay(k, settings, plan); added.push(k); }
  }
  return added;
}

module.exports = {
  STRETCH_ID, isStretch, stretchDone,
  buildUnits, slotForUnit, distribute, firstOpenSlot, remainingSets, totalSets, doneSets, lastSlot,
  pendingUnits, nextSlotIndex, gradeDay, createDay, planCheck, applyMarks, recordSet, setReps,
  endBreak, pauseDay, pauseUntil, rebuildDay, closeRemainingIfDone, isDecided,
  createMissedDay, fillMissedDays, initialAnchor,
};
