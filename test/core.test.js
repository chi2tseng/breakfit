'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const plan = require('../plan.json');
const T = require('../src/core/time');
const { computeSlots } = require('../src/core/slots');
const C = require('../src/core/cycle');
const D = require('../src/core/day');
const S = require('../src/core/stats');
const { normalizeSettings, DEFAULT_SETTINGS } = require('../src/core/settings');
const store = require('../src/main/store');

// 2026-09-21 is a Monday.
const MON = '2026-09-21';
const settings = (over = {}) => normalizeSettings({ cycleAnchor: { date: MON, index: 0 }, ...over });
const complete = (day, unitId) => {
  const u = day.units.find((x) => x.id === unitId);
  while (u.doneSets < u.targetSets) D.recordSet(day, unitId, 10);
};

// ---------- time ----------
test('time helpers', () => {
  assert.equal(T.parseHM('10:00'), 600);
  assert.equal(T.fmtHM(1260), '21:00');
  assert.equal(T.fmtHM(1440 + 5), '00:05');
  assert.equal(T.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(T.addDays('2024-03-01', -1), '2024-02-29');
  assert.equal(T.weekdayOf(MON), 1);
  assert.equal(T.daysBetween('2026-09-21', '2026-10-01'), 10);
  assert.equal(T.dateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.throws(() => T.parseHM('abc'));
});

test('date rollover: dateKey changes exactly at local midnight', () => {
  assert.equal(T.dateKey(new Date(2026, 8, 24, 23, 59, 59)), '2026-09-24');
  assert.equal(T.dateKey(new Date(2026, 8, 25, 0, 0, 0)), '2026-09-25');
});

// ---------- slots ----------
test('slots: default 10:00-21:00 every 60 -> 11 slots 11:00..21:00', () => {
  const s = computeSlots(DEFAULT_SETTINGS);
  assert.equal(s.length, 11);
  assert.equal(s[0], '11:00');
  assert.equal(s.at(-1), '21:00');
});

test('slots: boundary - end off-grid excluded, end on-grid included', () => {
  assert.deepEqual(computeSlots({ start: '10:00', end: '12:30', interval: 60 }), ['11:00', '12:00']);
  assert.deepEqual(computeSlots({ start: '10:00', end: '12:00', interval: 60 }), ['11:00', '12:00']);
  assert.deepEqual(computeSlots({ start: '09:00', end: '10:30', interval: 45 }), ['09:45', '10:30']);
});

test('slots: interval larger than window -> single slot at end', () => {
  assert.deepEqual(computeSlots({ start: '10:00', end: '10:30', interval: 60 }), ['10:30']);
  assert.deepEqual(computeSlots({ start: '10:00', end: '09:00', interval: 60 }), ['09:00']);
});

// ---------- cycle ----------
test('cycle: advances only on active days, weekends skipped', () => {
  const s = settings();
  const seq = [];
  for (let i = 0; i < 14; i++) seq.push(C.planDayFor(T.addDays(MON, i), s));
  assert.deepEqual(seq, [
    'd1', 'd2', 'd3', 'rest', 'd1', 'off', 'off', // Mon..Sun
    'd2', 'd3', 'rest', 'd1', 'd2', 'off', 'off',
  ]);
});

test('cycle: dates before the anchor go backwards across weekends', () => {
  const s = settings();
  assert.equal(C.planDayFor('2026-09-19', s), 'off'); // Sat
  assert.equal(C.planDayFor('2026-09-18', s), 'rest'); // Fri = index -1 -> 3
  assert.equal(C.planDayFor('2026-09-17', s), 'd3');
  assert.equal(C.cycleIndex('2026-09-14', s), (0 - 5 + 400) % 4); // 5 active days earlier
});

test('cycle: weekend anchor hands its index to next active day', () => {
  const s = settings({ cycleAnchor: C.anchorFor('2026-09-26', 1) }); // Sat -> day 2
  assert.equal(C.planDayFor('2026-09-28', s), 'd2'); // Mon
  assert.equal(C.planDayFor('2026-09-29', s), 'd3');
});

test('cycle: custom weekdays and long spans match day-by-day counting', () => {
  const s = settings({ activeWeekdays: [0, 2, 4, 6] });
  let active = 0;
  for (let k = MON; k < '2027-03-01'; k = T.addDays(k, 1)) if (s.activeWeekdays.includes(T.weekdayOf(k))) active++;
  assert.equal(C.countActive(MON, '2027-03-01', s.activeWeekdays), active);
  assert.equal(C.activeOffset('2027-03-01', MON, s.activeWeekdays), -active);
});

test('cycle: setting today as day X via anchor', () => {
  const s = settings({ cycleAnchor: C.anchorFor('2026-09-23', 3) });
  assert.equal(C.planDayFor('2026-09-23', s), 'rest');
  assert.equal(C.planDayFor('2026-09-24', s), 'd1');
});

// ---------- distribution ----------
test('distribution: floor(i*M/N)', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => D.slotForUnit(i, 6, 11)), [0, 1, 3, 5, 7, 9]);
  assert.deepEqual([0, 1].map((i) => D.slotForUnit(i, 2, 11)), [0, 5]);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => D.slotForUnit(i, 5, 2)), [0, 0, 0, 1, 1]);
  assert.deepEqual([0, 1, 2].map((i) => D.slotForUnit(i, 3, 1)), [0, 0, 0]);
});

test('createDay: d1 has 6 units, 25 sets, 11 slots, last slot empty buffer', () => {
  const day = D.createDay(MON, settings(), plan);
  assert.equal(day.planDay, 'd1');
  assert.equal(day.units.length, 6);
  assert.equal(D.totalSets(day), 25);
  assert.equal(day.slots.length, 11);
  assert.deepEqual(day.units.map((u) => u.slot), [0, 1, 3, 5, 7, 9]);
  assert.equal(day.status, 'pending');
  assert.equal(D.pendingUnits(day, 2).length, 2);
});

test('createDay: rest and off days have no slots and are graded rest/off', () => {
  const rest = D.createDay('2026-09-24', settings(), plan);
  assert.equal(rest.planDay, 'rest');
  assert.equal(rest.slots.length, 0);
  assert.equal(rest.status, 'rest');
  const off = D.createDay('2026-09-26', settings(), plan);
  assert.equal(off.status, 'off');
});

test('createDay: overrides apply to new days', () => {
  const day = D.createDay(MON, settings({ overrides: { pushup: { sets: 3, reps: [5, 8] } } }), plan);
  const u = day.units.find((x) => x.id === 'pushup');
  assert.equal(u.targetSets, 3);
  assert.deepEqual(u.target, [5, 8]);
});

test('d3: two circuit units with 1 set each', () => {
  const day = D.createDay('2026-09-23', settings(), plan);
  assert.equal(day.planDay, 'd3');
  assert.deepEqual(day.units.map((u) => [u.type, u.targetSets, u.slot]), [['circuit', 1, 0], ['circuit', 1, 5]]);
});

// ---------- pending roll-over ----------
test('pending: skipped slot rolls its unit into the next slot (marked carried)', () => {
  const day = D.createDay(MON, settings(), plan);
  D.endBreak(day, 0, 'skip', 0);
  assert.equal(day.slots[0].status, 'skipped');
  const p = D.pendingUnits(day, 1);
  assert.deepEqual(p.map((x) => [x.unit.id, x.carried]), [['pushup', true], ['weighted_pushup', false]]);
});

test('pending: aborted mid-way keeps done sets and carries the rest', () => {
  const day = D.createDay(MON, settings(), plan);
  D.recordSet(day, 'pushup', 12);
  D.recordSet(day, 'pushup', 10);
  D.endBreak(day, 0, 'abort', 2);
  assert.equal(day.slots[0].status, 'partial');
  const pu = day.units[0];
  assert.equal(pu.doneSets, 2);
  assert.deepEqual(pu.reps, [12, 10]);
  assert.equal(D.pendingUnits(day, 1)[0].unit.id, 'pushup');
  D.endBreak(day, 1, 'abort', 0);
  assert.equal(day.slots[1].status, 'skipped');
});

test('pending: missed slots - only newest opens, older marked missed', () => {
  const day = D.createDay(MON, settings(), plan);
  const r = D.planCheck(day, T.parseHM('13:10'));
  assert.deepEqual(r.marks, { 0: 'missed', 1: 'missed' });
  assert.equal(r.open, 2);
  D.applyMarks(day, r.marks);
  assert.deepEqual(D.pendingUnits(day, 2).map((x) => x.unit.id), ['pushup', 'weighted_pushup']);
});

test('pending: startup - slots older than 5 min missed, within 5 min opens', () => {
  const day = D.createDay(MON, settings(), plan);
  let r = D.planCheck(day, T.parseHM('12:04'), { startup: true });
  assert.deepEqual(r.marks, { 0: 'missed' });
  assert.equal(r.open, 1);
  const day2 = D.createDay(MON, settings(), plan);
  r = D.planCheck(day2, T.parseHM('12:06'), { startup: true });
  assert.deepEqual(r.marks, { 0: 'missed', 1: 'missed' });
  assert.equal(r.open, null);
});

test('pending: nothing due before first slot, nothing reopened once handled', () => {
  const day = D.createDay(MON, settings(), plan);
  assert.equal(D.planCheck(day, T.parseHM('10:59')).open, null);
  assert.equal(D.planCheck(day, T.parseHM('11:00')).open, 0);
  D.endBreak(day, 0, 'done', 5);
  assert.equal(D.planCheck(day, T.parseHM('11:30')).open, null);
});

test('pending: empty non-last slot -> notification (or silent when disabled)', () => {
  const day = D.createDay(MON, settings(), plan);
  complete(day, 'pushup');
  complete(day, 'weighted_pushup');
  D.endBreak(day, 0, 'done', 9);
  D.endBreak(day, 1, 'done', 0);
  let r = D.planCheck(day, T.parseHM('13:00')); // slot 2 has no unit assigned
  assert.equal(r.open, null);
  assert.equal(r.notify, true);
  assert.deepEqual(r.marks, { 2: 'notified' });
  r = D.planCheck(day, T.parseHM('13:00'), { notifyEmptySlots: false });
  assert.deepEqual(r.marks, { 2: 'empty' });
});

test('pending: last slot owes everything left today', () => {
  const day = D.createDay(MON, settings(), plan);
  complete(day, 'pushup');
  const last = D.lastSlot(day);
  const p = D.pendingUnits(day, last);
  assert.equal(p.length, 5);
  assert.ok(p.every((x) => x.carried));
  assert.equal(p.reduce((a, x) => a + x.unit.targetSets - x.unit.doneSets, 0), 20);
  assert.equal(D.pendingUnits(day, Infinity).length, 5);
});

test('pending: after everything is done remaining slots never open', () => {
  const day = D.createDay(MON, settings(), plan);
  day.units.forEach((u) => complete(day, u.id));
  D.endBreak(day, null, 'done', 25); // manual break
  assert.ok(day.slots.every((s) => s.status === 'empty'));
  assert.equal(D.planCheck(day, T.parseHM('21:00')).open, null);
});

test('manual break does not mark a slot; that slot later only notifies if nothing is left for it', () => {
  const day = D.createDay(MON, settings(), plan);
  complete(day, 'pushup');
  D.endBreak(day, null, 'done', 5);
  assert.equal(day.slots[0].status, 'pending');
  const r = D.planCheck(day, T.parseHM('11:00'));
  assert.equal(r.open, null);
  assert.deepEqual(r.marks, { 0: 'notified' });
});

test('recordSet caps at target and setReps edits', () => {
  const day = D.createDay(MON, settings(), plan);
  for (let i = 0; i < 7; i++) D.recordSet(day, 'pushup', 8);
  assert.equal(day.units[0].doneSets, 5);
  assert.equal(D.recordSet(day, 'pushup', 8), -1);
  assert.ok(D.setReps(day, 'pushup', 1, 13));
  assert.equal(day.units[0].reps[1], 13);
  assert.equal(D.setReps(day, 'pushup', 9, 13), false);
});

// ---------- grading ----------
test('grade: pass when all sets done', () => {
  const day = D.createDay(MON, settings(), plan);
  day.units.forEach((u) => complete(day, u.id));
  assert.equal(D.gradeDay(day, MON, MON), 'pass');
});

test('grade: fail after last break ends with sets left (done/skip/abort)', () => {
  for (const outcome of ['done', 'skip', 'abort']) {
    const day = D.createDay(MON, settings(), plan);
    assert.equal(D.gradeDay(day, MON, MON), 'pending');
    D.endBreak(day, D.lastSlot(day), outcome, 0);
    assert.equal(D.gradeDay(day, MON, MON), 'fail', outcome);
  }
});

test('grade: fail when the date rolls over with sets left', () => {
  const day = D.createDay(MON, settings(), plan);
  assert.equal(D.gradeDay(day, MON, T.addDays(MON, 1)), 'fail');
});

test('grade: pause-until-tomorrow fails the day', () => {
  const day = D.createDay(MON, settings(), plan);
  D.pauseDay(day);
  assert.equal(D.gradeDay(day, MON, MON), 'fail');
  assert.ok(day.slots.every((s) => s.status === 'missed'));
  assert.equal(D.planCheck(day, T.parseHM('15:00')).open, null);
});

test('grade: last slot missed on startup -> fail', () => {
  const day = D.createDay(MON, settings(), plan);
  const r = D.planCheck(day, T.parseHM('22:00'), { startup: true });
  D.applyMarks(day, r.marks);
  assert.equal(r.open, null);
  assert.equal(D.gradeDay(day, MON, MON), 'fail');
});

// ---------- rebuild ----------
test('rebuildDay: new schedule keeps progress, re-distributes, past new slots missed', () => {
  const day = D.createDay(MON, settings(), plan);
  complete(day, 'pushup');
  D.endBreak(day, 0, 'done', 5);
  D.rebuildDay(day, MON, settings({ start: '10:00', end: '14:00', interval: 30 }), plan, T.parseHM('11:10'));
  assert.deepEqual(day.slots.map((s) => s.time), ['10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00']);
  assert.equal(day.slots[0].status, 'missed');
  assert.equal(day.slots[1].status, 'done');
  assert.equal(day.units[0].doneSets, 5);
  // re-spread over the still-pending slots only (11:30 onward = index 2..7)
  assert.deepEqual(day.units.map((u) => u.slot), [2, 3, 4, 5, 6, 7]);
});

test('rebuildDay: switching today to rest clears units', () => {
  const day = D.createDay(MON, settings(), plan);
  D.rebuildDay(day, MON, settings({ cycleAnchor: C.anchorFor(MON, 3) }), plan, 600, { replan: true });
  assert.equal(day.planDay, 'rest');
  assert.equal(day.status, 'rest');
});

// ---------- stats ----------
test('stats: history implies fail for unopened training days, rest/off otherwise', () => {
  const s = settings({ installedDate: MON });
  const days = { '2026-09-25': D.createDay('2026-09-25', s, plan) };
  const h = S.buildHistory(days, s, plan, '2026-09-29');
  assert.equal(h['2026-09-21'].status, 'fail'); // unopened d1
  assert.equal(h['2026-09-21'].total, 25);
  assert.equal(h['2026-09-24'].status, 'rest');
  assert.equal(h['2026-09-26'].status, 'off');
  assert.equal(h['2026-09-25'].status, 'fail'); // recorded but past with sets left
  assert.equal(h['2026-09-29'], undefined); // today without record
  assert.equal(h['2026-09-20'], undefined); // before install
});

test('stats: pass rate, streaks and month sets', () => {
  const mk = (date, status, done) => ({ date, planDay: 'd1', status, done, total: 25, pct: done / 25 });
  const h = {
    '2026-08-31': mk('2026-08-31', 'pass', 25),
    '2026-09-01': mk('2026-09-01', 'pass', 25),
    '2026-09-02': { date: '2026-09-02', planDay: 'rest', status: 'rest', done: 0, total: 0, pct: 0 },
    '2026-09-03': mk('2026-09-03', 'pass', 25),
    '2026-09-04': mk('2026-09-04', 'fail', 10),
    '2026-09-07': mk('2026-09-07', 'pass', 25),
    '2026-09-08': mk('2026-09-08', 'pass', 25),
    '2026-09-09': mk('2026-09-09', 'pending', 3),
  };
  const st = S.computeStats(h, '2026-09');
  assert.equal(st.pass, 5);
  assert.equal(st.fail, 1);
  assert.ok(Math.abs(st.passRate - 5 / 6) < 1e-9);
  assert.equal(st.longestStreak, 3); // rest day does not break a streak
  assert.equal(st.currentStreak, 2); // today pending ignored
  assert.equal(st.monthSets, 25 + 25 + 10 + 25 + 25 + 3);
  assert.equal(S.recentTraining(h, 3).map((x) => x.date).join(','), '2026-09-07,2026-09-08,2026-09-09');
});

// ---------- settings + store ----------
test('settings: normalize clamps and fills defaults', () => {
  const s = normalizeSettings({ demoSec: 99, interval: 'x', activeWeekdays: [5, 1, 1, 9] });
  assert.equal(s.demoSec, 10);
  assert.equal(s.interval, 60);
  assert.deepEqual(s.activeWeekdays, [1, 5]);
  assert.equal(s.autoLaunch, true); // SPEC 2026-09-24: default ON
});

test('settings: showDemo defaults ON, keeps an explicit OFF, coerces junk', () => {
  assert.equal(DEFAULT_SETTINGS.showDemo, true);
  assert.equal(normalizeSettings({}).showDemo, true);
  assert.equal(normalizeSettings({ showDemo: undefined }).showDemo, true);
  assert.equal(normalizeSettings({ showDemo: null }).showDemo, true);
  assert.equal(normalizeSettings({ showDemo: false }).showDemo, false);
  assert.equal(normalizeSettings({ showDemo: 0 }).showDemo, false);
  assert.equal(normalizeSettings({ showDemo: 1 }).showDemo, true);
  assert.equal(normalizeSettings({ ...normalizeSettings({ showDemo: false }), demoSec: 6 }).showDemo, false);
});

test('settings: theme is dark or light only, default dark', () => {
  assert.equal(DEFAULT_SETTINGS.theme, 'dark');
  assert.equal(normalizeSettings({}).theme, 'dark');
  assert.equal(normalizeSettings({ theme: 'light' }).theme, 'light');
  assert.equal(normalizeSettings({ theme: 'dark' }).theme, 'dark');
  for (const junk of ['Light', 'blue', '', null, 1, {}]) assert.equal(normalizeSettings({ theme: junk }).theme, 'dark');
});

test('store: atomic save round-trips, no tmp left; corrupt file kept aside', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'breakfit-test-'));
  const file = path.join(dir, 'data.json');
  assert.deepEqual(store.load(file).days, {});
  const data = store.emptyData();
  data.days[MON] = D.createDay(MON, settings(), plan);
  store.saveAtomic(file, data);
  store.saveAtomic(file, data);
  assert.equal(fs.existsSync(`${file}.tmp`), false);
  assert.equal(store.load(file).days[MON].units.length, 6);
  fs.writeFileSync(file, '{broken');
  assert.deepEqual(store.load(file).days, {});
  assert.ok(fs.readdirSync(dir).some((f) => f.includes('.corrupt-')));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- regressions (review round) ----------
const WED = '2026-10-07';

test('regression: changing activeWeekdays mid-day keeps today planDay + progress, applies from tomorrow', () => {
  const old = settings();
  const day = D.createDay(WED, old, plan);
  const pd = day.planDay;
  const id = day.units[0].id;
  for (let i = 0; i < 3; i++) D.recordSet(day, id, 10);
  const next = normalizeSettings({ ...old, activeWeekdays: [1, 2, 3, 4, 5, 6] });
  next.cycleAnchor = C.reanchorForWeekdays(WED, old);
  D.rebuildDay(day, WED, next, plan, T.parseHM('15:00'));
  assert.equal(day.planDay, pd);
  assert.equal(D.doneSets(day), 3);
  const thu = T.addDays(WED, 1);
  assert.equal(C.planDayFor(thu, next), C.planDayFor(thu, old)); // tomorrow unchanged
  const sat = T.addDays(WED, 3);
  const fri = T.addDays(WED, 2);
  assert.equal(C.cycleIndex(sat, next), (C.cycleIndex(fri, next) + 1) % 4); // new Saturday follows Friday
  // plain schedule change never replans either
  D.rebuildDay(day, WED, normalizeSettings({ ...next, cycleAnchor: C.anchorFor(WED, 2) }), plan, T.parseHM('15:00'));
  assert.equal(day.planDay, pd);
});

test('regression: "set today to day X" round-trip restores done sets; refused once decided', () => {
  const day = D.createDay(MON, settings(), plan); // d1
  complete(day, 'pushup');
  D.rebuildDay(day, MON, settings({ cycleAnchor: C.anchorFor(MON, 1) }), plan, 700, { replan: true });
  assert.equal(day.planDay, 'd2');
  assert.equal(D.doneSets(day), 0);
  D.rebuildDay(day, MON, settings({ cycleAnchor: C.anchorFor(MON, 0) }), plan, 700, { replan: true });
  assert.equal(day.planDay, 'd1');
  assert.equal(day.units.find((u) => u.id === 'pushup').doneSets, 5);
  day.status = 'fail';
  D.rebuildDay(day, MON, settings({ cycleAnchor: C.anchorFor(MON, 3) }), plan, 700, { replan: true });
  assert.equal(day.planDay, 'd1');
  assert.equal(day.status, 'fail');
});

test('regression: a failed day stays failed when end/interval change afterwards', () => {
  const day = D.createDay(MON, settings(), plan);
  D.applyMarks(day, D.planCheck(day, T.parseHM('21:00')).marks);
  D.endBreak(day, D.lastSlot(day), 'skip', 0);
  day.status = D.gradeDay(day, MON, MON);
  assert.equal(day.status, 'fail');
  D.rebuildDay(day, MON, settings({ end: '22:00' }), plan, T.parseHM('21:10'));
  assert.equal(day.status, 'fail');
});

test('regression: moving end before now keeps a pending final break that opens now', () => {
  const day = D.createDay(MON, settings(), plan);
  for (let k = 0; k <= 4; k++) D.endBreak(day, k, 'skip', 0); // 11:00-15:00 handled
  D.rebuildDay(day, MON, settings({ end: '14:00' }), plan, T.parseHM('15:30'));
  assert.equal(day.status, 'pending');
  const last = day.slots[D.lastSlot(day)];
  assert.equal(last.time, '15:30');
  assert.equal(last.status, 'pending');
  const r = D.planCheck(day, T.parseHM('15:30'));
  assert.equal(r.open, D.lastSlot(day));
  assert.equal(D.pendingUnits(day, r.open).length, 6);
});

test('regression: new slot inside the 5-min grace opens instead of being missed', () => {
  const day = D.createDay(MON, settings(), plan);
  const now = T.parseHM('11:30') + 0.2;
  D.endBreak(day, 0, 'done', 0);
  D.rebuildDay(day, MON, settings({ interval: 30 }), plan, now);
  const k = day.slots.findIndex((s) => s.time === '11:30');
  assert.equal(day.slots[k].status, 'pending');
  assert.equal(D.planCheck(day, now).open, k);
});

test('regression: missed past days are frozen once; later settings changes do not rewrite history', () => {
  const s0 = settings({ installedDate: MON });
  const days = {};
  const added = D.fillMissedDays(days, s0, plan, '2026-10-02');
  assert.equal(added.length, 11);
  const before = S.buildHistory(days, s0, plan, '2026-10-02');
  const s1 = settings({ installedDate: MON, cycleAnchor: C.anchorFor('2026-10-02', 0), activeWeekdays: [0, 1, 2, 3, 4, 5, 6] });
  const after = S.buildHistory(days, s1, plan, '2026-10-02');
  assert.deepEqual(after, before);
  assert.equal(before['2026-09-21'].status, 'fail');
  assert.equal(before['2026-09-24'].status, 'rest');
  assert.equal(before['2026-09-26'].status, 'off');
  assert.equal(before['2026-09-21'].recorded, false);
  assert.equal(D.fillMissedDays(days, s1, plan, '2026-10-02').length, 0);
});

test('regression: first install after the last break does not fail the install day', () => {
  const late = D.initialAnchor('2026-09-23', T.parseHM('22:00'), settings());
  assert.deepEqual(late, { date: '2026-09-24', index: 0 });
  const s = settings({ cycleAnchor: late });
  const day = D.createDay('2026-09-23', s, plan);
  assert.equal(day.status, 'rest');
  assert.equal(C.planDayFor('2026-09-24', s), 'd1');
  assert.deepEqual(D.initialAnchor('2026-09-23', T.parseHM('14:00'), settings()), { date: '2026-09-23', index: 0 });
});

test('regression: timed pause marks non-last due slots missed, last slot still opens', () => {
  const day = D.createDay(MON, settings(), plan);
  D.pauseUntil(day, T.parseHM('13:50') + 60);
  const r = D.planCheck(day, T.parseHM('14:00'));
  assert.equal(r.open, null);
  assert.equal(r.marks[3], 'missed');
  D.applyMarks(day, r.marks);
  assert.equal(D.planCheck(day, T.parseHM('15:00')).open, 4); // pause over: rolls into 15:00
  const d2 = D.createDay(MON, settings(), plan);
  D.pauseUntil(d2, T.parseHM('20:30') + 120);
  for (let k = 0; k < D.lastSlot(d2); k++) d2.slots[k].status = 'missed';
  assert.equal(D.planCheck(d2, T.parseHM('21:00')).open, D.lastSlot(d2));
  D.pauseUntil(d2, null);
  assert.equal(d2.pausedUntil, null);
});

test('regression: store never treats a read I/O error as corrupt (no empty data, no overwrite)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'breakfit-test-'));
  const locked = path.join(dir, 'data.json');
  fs.mkdirSync(locked); // readFileSync -> EISDIR, a non-ENOENT I/O error
  assert.throws(() => store.load(locked));
  assert.equal(fs.readdirSync(dir).filter((f) => f.includes('.corrupt-')).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('regression: day first created mid-day spreads units over the slots still ahead', () => {
  // 10:00–21:00 / 60 → 11 slots (11:00..21:00); created at 16:10 → first open slot is 17:00 (index 6)
  const day = D.createDay(MON, settings(), plan, T.parseHM('16:10'));
  const slots = day.units.map((u) => u.slot);
  assert.equal(Math.min(...slots), 6);
  assert.ok(Math.max(...slots) < D.lastSlot(day) + 1);
  // the 16:00 slot is past grace → planCheck at startup marks earlier slots missed, and the first
  // opened break only owes one unit, not the whole morning's share
  const r = D.planCheck(day, T.parseHM('17:00'));
  assert.equal(r.open, 6);
  // 6 units over the 5 remaining slots (17:00..21:00) → floor(i*5/6)+6 = 6,6,7,8,9,10
  assert.deepEqual(slots, [6, 6, 7, 8, 9, 10]);
  assert.equal(D.pendingUnits(day, 6).length, 2);
  // within grace (16:03) the 16:00 slot still counts as open
  assert.equal(D.firstOpenSlot(computeSlots(settings()), T.parseHM('16:03')), 5);
  // created after the last break → everything lands on the last slot
  const late = D.createDay(MON, settings(), plan, T.parseHM('21:30'));
  assert.ok(late.units.every((u) => u.slot === D.lastSlot(late)));
  // default (no nowMin) keeps the whole-day spread
  assert.equal(D.createDay(MON, settings(), plan).units[0].slot, 0);
});

test('regression: rebuild after a settings change only redistributes onto pending slots', () => {
  const day = D.createDay(MON, settings(), plan);
  for (let k = 0; k < 4; k++) day.slots[k].status = 'missed';
  D.rebuildDay(day, MON, settings({ interval: 30 }), plan, T.parseHM('13:40'));
  const first = day.slots.findIndex((s) => s.status === 'pending');
  assert.ok(day.units.every((u) => u.slot >= first));
});
