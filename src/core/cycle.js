'use strict';
const { weekdayOf, daysBetween, addDays } = require('./time');

const DEFAULT_CYCLE = ['d1', 'd2', 'd3', 'rest'];

function isActive(key, weekdays) {
  return weekdays.includes(weekdayOf(key));
}

// Active days in the half-open range [from, to). from <= to.
function countActive(from, to, weekdays) {
  const n = daysBetween(from, to);
  if (n <= 0) return 0;
  const perWeek = weekdays.length;
  let count = Math.floor(n / 7) * perWeek;
  const rem = n % 7;
  const w0 = weekdayOf(from);
  for (let i = 0; i < rem; i++) if (weekdays.includes((w0 + i) % 7)) count++;
  return count;
}

// Signed number of active days "passed" from anchor to key.
// key >= anchor: active days in [anchor, key); key < anchor: -(active days in [key, anchor)).
// So an active anchor day itself has offset 0, the next active day 1; a weekend anchor
// hands its index to the next active day.
function activeOffset(anchorKey, key, weekdays) {
  if (key >= anchorKey) return countActive(anchorKey, key, weekdays);
  return -countActive(key, anchorKey, weekdays);
}

function cycleIndex(key, settings, cycleLen = DEFAULT_CYCLE.length) {
  const anchor = settings.cycleAnchor || { date: key, index: 0 };
  const off = activeOffset(anchor.date, key, settings.activeWeekdays);
  return (((anchor.index + off) % cycleLen) + cycleLen) % cycleLen;
}

function planDayFor(key, settings, cycle = DEFAULT_CYCLE) {
  if (!isActive(key, settings.activeWeekdays)) return 'off';
  return cycle[cycleIndex(key, settings, cycle.length)];
}

// Anchor that makes `key` land on cycle index `index`.
function anchorFor(key, index) {
  return { date: key, index };
}

// Anchor to use when activeWeekdays change: the day after `todayKey` keeps the index it would have
// had under the old weekdays, so today's record and all past days stay as they were.
function reanchorForWeekdays(todayKey, oldSettings, cycleLen = DEFAULT_CYCLE.length) {
  const tomorrow = addDays(todayKey, 1);
  return { date: tomorrow, index: cycleIndex(tomorrow, oldSettings, cycleLen) };
}

module.exports = { DEFAULT_CYCLE, isActive, countActive, activeOffset, cycleIndex, planDayFor, anchorFor, reanchorForWeekdays, addDays };
