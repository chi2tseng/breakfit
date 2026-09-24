'use strict';
// Pure date/time helpers. Dates are local "YYYY-MM-DD" keys; times are minutes since midnight.

const pad = (n) => String(n).padStart(2, '0');

function parseHM(hm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm).trim());
  if (!m) throw new Error(`bad time: ${hm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

function fmtHM(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function minutesOf(d) {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

// Calendar arithmetic on keys via UTC so DST never shifts a day.
function keyToUTC(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcToKey(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function addDays(key, n) {
  return utcToKey(keyToUTC(key) + n * 86400000);
}

// 0 = Sunday … 6 = Saturday (same as Date#getDay)
function weekdayOf(key) {
  return new Date(keyToUTC(key)).getUTCDay();
}

function daysBetween(a, b) {
  return Math.round((keyToUTC(b) - keyToUTC(a)) / 86400000);
}

// Local Date for key + minutes.
function toDate(key, min) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, Math.floor(min / 60), Math.round(min % 60));
}

module.exports = { pad, parseHM, fmtHM, dateKey, minutesOf, addDays, weekdayOf, daysBetween, toDate };
