'use strict';
const { parseHM, fmtHM } = require('./time');

// t_k = start + k*interval for k = 1.. while t_k <= end; none → single slot at end.
function computeSlots(settings) {
  const start = parseHM(settings.start);
  const end = parseHM(settings.end);
  const interval = Math.max(1, Number(settings.interval) || 60);
  const out = [];
  for (let t = start + interval; t <= end; t += interval) out.push(fmtHM(t));
  if (!out.length) out.push(fmtHM(end));
  return out;
}

module.exports = { computeSlots };
