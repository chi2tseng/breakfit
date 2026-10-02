'use strict';
// 完整訓練 picker: which moves a full workout does. A selection is a list of keys: a unit id
// ('pushup', 'core_round_1') or 'stretch:<id>' for one stretch. Presets = a whole plan day.
const D = require('./day');

const DAYS = ['d1', 'd2', 'd3'];
const SK = 'stretch:';
const stretchKey = (id) => SK + id;

// Every pickable row in plan order, grouped by day: the day's units, then its stretches.
function catalog(plan) {
  const rows = [];
  const seen = new Set();
  for (const pd of DAYS) {
    const d = plan.days[pd];
    if (!d) continue;
    for (const u of d.units) rows.push({ key: u.id, day: pd, type: u.type === 'circuit' ? 'circuit' : 'reps', id: u.id });
    for (const id of d.stretch || []) {
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({ key: stretchKey(id), day: pd, type: 'stretch', id });
    }
  }
  return rows;
}

// The picked rows in plan order (unknown keys dropped, duplicates folded).
function ordered(plan, keys) {
  const set = new Set(keys || []);
  return catalog(plan).filter((r) => set.has(r.key));
}

const sameKeys = (a, b) => {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((k) => y.has(k));
};

// Preset of a plan day ('d1'…'d3'): the whole day — or, for today's plan day while it still owes
// anything, only what it owes (done sets are skipped, as before the picker). 'stretch': today's
// stretches (every stretch on a rest / off day).
function presetKeys(plan, day, pd) {
  if (pd === 'stretch') {
    const own = plan.days[day.planDay];
    const ids = own && own.stretch ? own.stretch : catalog(plan).filter((r) => r.type === 'stretch').map((r) => r.id);
    return ids.map(stretchKey);
  }
  const d = DAYS.includes(pd) && plan.days[pd];
  if (!d) return [];
  if (pd === day.planDay) {
    const left = D.sessionUnits(day);
    if (left) return left.flatMap((u) => (D.isStretch(u) ? u.stretches.map(stretchKey) : [u.id]));
  }
  return [...d.units.map((u) => u.id), ...(d.stretch || []).map(stretchKey)];
}

/**
 * Session of a selection: the picked training units in plan order, then one stretch unit with the
 * picked stretches. A unit today's record still owes counts toward today (its remaining sets);
 * anything else is 加練. Today's stretch counts only when every one of today's stretches is picked.
 * Returns null for an empty selection.
 *   { keys, units, ownIds, extraIds, extraDays, stretch: null|'own'|'extra'|'both', extra, share }
 */
function buildSession(plan, day, keys, settings = {}) {
  const rows = ordered(plan, keys);
  if (!rows.length) return null;
  const today = day.units || [];
  const units = [];
  const ownIds = [];
  const extraIds = [];
  const xdays = new Set();
  const xunits = [];
  for (const r of rows.filter((x) => x.type !== 'stretch')) {
    const mine = today.find((u) => u.id === r.id && u.doneSets < u.targetSets);
    if (mine) {
      units.push(mine);
      ownIds.push(r.id);
    } else {
      const u = D.buildUnits(plan, r.day, settings.overrides).find((x) => x.id === r.id);
      units.push(u);
      xunits.push(u);
      extraIds.push(r.id);
      xdays.add(r.day);
    }
  }
  let stretch = null;
  const sts = rows.filter((x) => x.type === 'stretch');
  if (sts.length) {
    const ids = sts.map((x) => x.id);
    const mine = today.find(D.isStretch);
    const covers = !!mine && mine.doneSets < mine.targetSets && mine.stretches.every((id) => ids.includes(id));
    const beyond = sts.filter((x) => !(covers && mine.stretches.includes(x.id)));
    stretch = covers ? (beyond.length ? 'both' : 'own') : 'extra';
    beyond.forEach((x) => xdays.add(x.day));
    const unit = (list) => ({ id: D.STRETCH_ID, name: '拉伸', type: 'stretch', stretches: list, targetSets: 1, doneSets: 0, reps: [], slot: 0 });
    units.push(unit(ids));
    if (covers) ownIds.push(D.STRETCH_ID);
    else extraIds.push(D.STRETCH_ID);
    if (beyond.length) xunits.push(unit(beyond.map((x) => x.id)));
  }
  const est = D.estimateSec(plan, units, settings);
  return {
    keys: rows.map((r) => r.key),
    units,
    ownIds,
    extraIds,
    extraDays: DAYS.filter((d) => xdays.has(d)),
    stretch,
    extra: ownIds.length === 0,
    // the 加練 part's share of the session's length (its logged minutes in a mixed session)
    share: !ownIds.length ? 1 : est ? Math.min(1, D.estimateSec(plan, xunits, settings) / est) : 0,
  };
}

// One finished set / round / stretch of a session: today's units are recorded into the day (as a
// break would), 加練 ones only counted in `tally` ({ sets, xsets, stretch }). Returns the reps index or -1.
function recordPicked(day, sess, tally, unitId, reps) {
  if (unitId === D.STRETCH_ID) {
    if (sess.stretch === 'extra' || sess.stretch === 'both') tally.stretch = true;
    return sess.stretch === 'own' || sess.stretch === 'both' ? D.recordSet(day, unitId, reps) : -1;
  }
  tally.sets += 1;
  if (!sess.ownIds.includes(unitId)) {
    tally.xsets += 1;
    return -1;
  }
  return D.recordSet(day, unitId, reps);
}

// End of a session: its 加練 part goes onto today's record (never its grade).
function logExtra(day, sess, tally, t, sec) {
  return D.recordExtra(day, t, {
    planDay: sess.extraDays[0] || null, days: sess.extraDays, sets: tally.xsets, sec: sec * sess.share, stretch: tally.stretch,
  });
}

// Chooser footer: length of a selection from per-row seconds (row.sec = that move alone) plus the
// rests between consecutive training moves — the same sum as D.estimateSec of the session.
function estimatePick(rows, keys, restSec, roundRestSec) {
  const set = new Set(keys);
  let sec = 0;
  let prev = null;
  for (const r of rows) {
    if (!set.has(r.key)) continue;
    if (r.type !== 'stretch') {
      if (prev) sec += prev.type === 'circuit' && r.type === 'circuit' ? roundRestSec : restSec;
      prev = r;
    }
    sec += r.sec;
  }
  return sec;
}

module.exports = {
  DAYS, stretchKey, catalog, ordered, sameKeys, presetKeys, buildSession, recordPicked, logExtra, estimatePick,
};
