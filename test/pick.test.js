'use strict';
// 完整訓練 picker (src/core/pick.js): presets, selection → session, mixed today / 加練 recording.
const test = require('node:test');
const assert = require('node:assert/strict');

const plan = require('../plan.json');
const T = require('../src/core/time');
const D = require('../src/core/day');
const P = require('../src/core/pick');
const { normalizeSettings } = require('../src/core/settings');

const MON = '2026-09-21'; // a 第 1 天 with this anchor
const settings = (over = {}) => normalizeSettings({ cycleAnchor: { date: MON, index: 0 }, ...over });
const complete = (day, id) => { const u = day.units.find((x) => x.id === id); while (u.doneSets < u.targetSets) D.recordSet(day, id, 10); };
const ids = (sess) => sess.units.map((u) => u.id);

test('catalog: every move once, grouped by day, core as one row per round, stretches as rows', () => {
  const rows = P.catalog(plan);
  assert.equal(rows.filter((r) => r.type === 'reps').length, 14);
  assert.deepEqual(rows.filter((r) => r.type === 'circuit').map((r) => r.key), ['core_round_1', 'core_round_2']);
  assert.equal(rows.filter((r) => r.type === 'stretch').length, 11);
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length);
  assert.deepEqual([...new Set(rows.map((r) => r.day))], ['d1', 'd2', 'd3']);
});

test('presets: a whole day; today = what it still owes; 拉伸 = today\'s stretches', () => {
  const s = settings();
  const day = D.createDay(MON, s, plan, 600);
  assert.deepEqual(P.presetKeys(plan, day, 'd2'), [...plan.days.d2.units.map((u) => u.id), ...plan.days.d2.stretch.map(P.stretchKey)]);
  complete(day, 'pushup');
  assert.deepEqual(P.presetKeys(plan, day, 'd1'), ['weighted_pushup', 'incline_pushup', 'diamond_pushup', 'triceps_pushup', 'bench_dip', 'stretch:chest', 'stretch:front_delt', 'stretch:triceps']);
  assert.deepEqual(P.presetKeys(plan, day, 'stretch'), ['stretch:chest', 'stretch:front_delt', 'stretch:triceps']);
  for (const u of day.units) complete(day, u.id);
  assert.equal(P.presetKeys(plan, day, 'd1').length, 9, 'nothing owed: the whole day (as 加練)');
  const rest = { planDay: 'rest', units: [] };
  assert.equal(P.presetKeys(plan, rest, 'stretch').length, 11, 'rest day: every stretch');
  assert.deepEqual(P.presetKeys(plan, day, 'nope'), []);
});

test('session from a selection: plan order, stretches last in one unit; empty selection rejected', () => {
  const s = settings();
  const day = D.createDay(MON, s, plan, 600);
  assert.equal(P.buildSession(plan, day, [], s), null);
  assert.equal(P.buildSession(plan, day, ['bogus'], s), null);
  const sess = P.buildSession(plan, day, ['stretch:quad', 'core_round_2', 'squat', 'pushup', 'stretch:chest', 'squat'], s);
  assert.deepEqual(ids(sess), ['pushup', 'squat', 'core_round_2', 'stretch']);
  assert.deepEqual(sess.units[3].stretches, ['chest', 'quad'], 'stretches in plan order');
  assert.deepEqual(sess.keys, ['pushup', 'stretch:chest', 'squat', 'stretch:quad', 'core_round_2'], 'keys: deduped, catalog order');
  assert.deepEqual(sess.ownIds, ['pushup']);
  assert.deepEqual(sess.extraIds, ['squat', 'core_round_2', 'stretch'], 'today\'s stretch not fully picked → 加練');
  assert.deepEqual(sess.extraDays, ['d1', 'd2', 'd3'], 'extra days in plan order (chest = a 第 1 天 stretch done as 加練)');
  assert.equal(sess.extra, false);
  assert.ok(sess.share > 0 && sess.share < 1);
  // a preset of another day = the old whole-day 加練
  const x = P.buildSession(plan, day, P.presetKeys(plan, day, 'd2'), s);
  assert.ok(x.extra && x.share === 1 && x.stretch === 'extra');
  assert.deepEqual(x.extraDays, ['d2']);
  // today's preset = the old today session (same units, same objects)
  const own = P.buildSession(plan, day, P.presetKeys(plan, day, 'd1'), s);
  assert.deepEqual(ids(own), D.sessionUnits(day).map((u) => u.id));
  assert.ok(!own.extra && own.extraIds.length === 0 && own.stretch === 'own' && own.units[0] === day.units[0]);
});

test('mixed recording: today\'s moves count toward today, the rest is 加練; the day passes only on its whole menu', () => {
  const s = settings();
  const day = D.createDay(MON, s, plan, 600);
  complete(day, 'pushup');
  const keys = [...P.presetKeys(plan, day, 'd1'), 'squat', 'stretch:quad'];
  const sess = P.buildSession(plan, day, keys, s);
  assert.equal(sess.units[0], day.units[1], 'remaining today units only (pushup done)');
  assert.equal(sess.stretch, 'both');
  assert.deepEqual(sess.extraDays, ['d2']);
  const tally = { sets: 0, xsets: 0, stretch: false };
  for (const u of sess.units) {
    const n = u.type === 'reps' ? u.targetSets - u.doneSets : 1;
    for (let i = 0; i < n; i++) P.recordPicked(day, sess, tally, u.id, 10);
  }
  assert.equal(D.remainingSets(day), 0);
  assert.equal(D.gradeDay(day, MON, MON), 'pass');
  assert.deepEqual(tally, { sets: 20 + 4, xsets: 4, stretch: true });
  const before = JSON.stringify(day.units);
  const e = P.logExtra(day, sess, tally, '2026-09-21T12:00:00.000Z', 3000);
  assert.deepEqual(e.detail.days, ['d2']);
  assert.equal(e.detail.planDay, 'd2');
  assert.equal(e.detail.sets, 4);
  assert.ok(e.detail.sec > 0 && e.detail.sec < 3000, `extra minutes = its share (${e.detail.sec})`);
  assert.equal(JSON.stringify(day.units), before, '加練 never touches the units');
  assert.equal(D.extraSessions(day).length, 1);
});

test('mixed recording: only 加練 picked → today untouched, grade unchanged; a done unit picked again is 加練', () => {
  const s = settings();
  const day = D.createDay(MON, s, plan, 600);
  complete(day, 'pushup');
  const sess = P.buildSession(plan, day, ['pushup', 'y_raise', 'stretch:chest'], s);
  assert.ok(sess.extra && sess.ownIds.length === 0);
  assert.deepEqual(sess.extraDays, ['d1', 'd2']);
  const tally = { sets: 0, xsets: 0, stretch: false };
  assert.equal(P.recordPicked(day, sess, tally, 'pushup', 10), -1);
  P.recordPicked(day, sess, tally, 'y_raise', 15);
  P.recordPicked(day, sess, tally, 'stretch', 0);
  assert.equal(D.doneSets(day), 5);
  assert.equal(D.stretchDone(day), false, 'a partial stretch pick never clears today\'s stretch');
  assert.equal(D.gradeDay(day, MON, MON), 'pending');
  assert.deepEqual(tally, { sets: 2, xsets: 2, stretch: true });
  assert.equal(P.logExtra(day, sess, tally, 't', 600).detail.sec, 600, 'all 加練: all the minutes');
  const none = P.buildSession(plan, day, ['y_raise'], s);
  assert.equal(P.logExtra(day, none, { sets: 0, xsets: 0, stretch: false }, 't', 60), null, 'nothing done → nothing logged');
});

test('picker estimate: per-row seconds + rests = D.estimateSec of the session', () => {
  const s = settings({ demoSec: 8, showDemo: true });
  const wed = T.addDays(MON, 2);
  for (const day of [D.createDay(MON, s, plan, 600), D.createDay(wed, s, plan, 600)]) {
    const rows = P.catalog(plan).map((r) => {
      const one = P.buildSession(plan, day, [r.key], s);
      return { ...r, sec: D.estimateSec(plan, one.units, s) };
    });
    for (const keys of [P.presetKeys(plan, day, 'd1'), P.presetKeys(plan, day, 'd3'), ['pushup', 'core_round_1', 'core_round_2', 'squat', 'stretch:lat'], rows.map((r) => r.key)]) {
      const sess = P.buildSession(plan, day, keys, s);
      assert.equal(P.estimatePick(rows, keys, plan.setRestSec, plan.days.d3.roundRestSec), D.estimateSec(plan, sess.units, s), keys.join());
    }
  }
});

test('sameKeys: order-free set equality', () => {
  assert.ok(P.sameKeys(['a', 'b'], ['b', 'a']));
  assert.ok(!P.sameKeys(['a'], ['a', 'b']));
  assert.ok(!P.sameKeys(['a', 'c'], ['a', 'b']));
});
