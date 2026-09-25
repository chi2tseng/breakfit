'use strict';
// Record-page aggregates: per-date summary, streaks, pass rate, recent training days.
const { addDays } = require('./time');
const { planDayFor } = require('./cycle');
const { buildUnits, gradeDay, doneSets, totalSets } = require('./day');

const TRAINING_DAYS = new Set(['d1', 'd2', 'd3']);

function summarizeDay(key, day, todayKey) {
  const total = totalSets(day);
  const done = doneSets(day);
  return {
    date: key,
    planDay: day.planDay,
    status: gradeDay(day, key, todayKey),
    done,
    total,
    pct: total ? done / total : 0,
    recorded: !day.implied,
  };
}

// Summary for a date without a record (app never opened that day).
function impliedDay(key, settings, plan) {
  const planDay = planDayFor(key, settings, plan.cycle);
  if (planDay === 'off' || planDay === 'rest') return { date: key, planDay, status: planDay, done: 0, total: 0, pct: 0, recorded: false };
  const total = totalSets({ units: buildUnits(plan, planDay, settings.overrides) });
  return { date: key, planDay, status: 'fail', done: 0, total, pct: 0, recorded: false };
}

// Every date from the first known day to today → summary.
function buildHistory(days, settings, plan, todayKey) {
  const keys = Object.keys(days).sort();
  let first = settings.installedDate || keys[0] || todayKey;
  if (keys[0] && keys[0] < first) first = keys[0];
  const out = {};
  for (let k = first; k <= todayKey; k = addDays(k, 1)) {
    out[k] = days[k] ? summarizeDay(k, days[k], todayKey) : k === todayKey ? null : impliedDay(k, settings, plan);
    if (!out[k]) delete out[k];
  }
  return out;
}

function computeStats(history, monthPrefix) {
  const keys = Object.keys(history).sort();
  const graded = keys.map((k) => history[k]).filter((h) => h.status === 'pass' || h.status === 'fail');
  const pass = graded.filter((h) => h.status === 'pass').length;
  const fail = graded.length - pass;
  let longest = 0;
  let run = 0;
  for (const h of graded) {
    run = h.status === 'pass' ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let current = 0;
  for (let i = graded.length - 1; i >= 0 && graded[i].status === 'pass'; i--) current++;
  const monthSets = keys
    .filter((k) => k.startsWith(monthPrefix))
    .reduce((a, k) => a + history[k].done, 0);
  return {
    pass,
    fail,
    passRate: graded.length ? pass / graded.length : null,
    currentStreak: current,
    longestStreak: longest,
    monthSets,
  };
}

function recentTraining(history, n = 30) {
  return Object.keys(history)
    .sort()
    .map((k) => history[k])
    .filter((h) => TRAINING_DAYS.has(h.planDay))
    .slice(-n);
}

module.exports = { summarizeDay, impliedDay, buildHistory, computeStats, recentTraining, TRAINING_DAYS };
