'use strict';
// data.json persistence: tolerant load, atomic save (write tmp → rename).
const fs = require('fs');
const path = require('path');
const { normalizeSettings } = require('../core/settings');

function emptyData() {
  return { version: 1, settings: normalizeSettings({}), days: {} };
}

const sleepSync = (ms) => { const until = Date.now() + ms; while (Date.now() < until) { /* spin */ } };

// Read errors (EBUSY/EPERM/EACCES from AV, OneDrive, indexer) are retried and then thrown —
// never treated as "corrupt", so a transient lock can never lead to the history being overwritten.
function readWithRetry(file, tries = 6) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      err = e;
      sleepSync(150);
    }
  }
  throw err;
}

function load(file) {
  const text = readWithRetry(file);
  if (text === null) return emptyData();
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    // Unparseable: move it aside first; if even that fails, refuse to start rather than overwrite it.
    fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`);
    return emptyData();
  }
  if (!raw || typeof raw !== 'object') {
    fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`);
    return emptyData();
  }
  return {
    version: 1,
    settings: normalizeSettings(raw.settings || {}),
    days: raw.days && typeof raw.days === 'object' ? raw.days : {},
  };
}

function saveAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
  let err;
  for (let i = 0; i < 5; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      err = e; // EPERM/EBUSY when AV/indexer holds the file on Windows — retry
      sleepSync(40);
    }
  }
  throw err;
}

module.exports = { load, saveAtomic, emptyData };
