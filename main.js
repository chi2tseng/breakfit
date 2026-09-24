'use strict';
// BreakFit entry. Flags: --selftest (temp data, hidden windows, screenshots, auto-quit),
// --fast (temp data, 1 minute = 1 second), --hidden (started at login: tray only).
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SELFTEST = process.argv.includes('--selftest');
const FAST = process.argv.includes('--fast');
const HIDDEN = process.argv.includes('--hidden');

if (SELFTEST || FAST) {
  // never touch the real data.json in test modes; clear leftovers from earlier test runs first
  const prefix = SELFTEST ? 'breakfit-selftest-' : 'breakfit-fast-';
  for (const d of fs.readdirSync(os.tmpdir())) {
    if (d.startsWith(prefix)) {
      try { fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true }); } catch (_) { /* in use */ }
    }
  }
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), SELFTEST ? 'breakfit-selftest-' : 'breakfit-fast-')));
}
// Dev/selftest electron.exe must not share the packaged app's ID, or Windows groups them into one
// taskbar button and shows electron.exe's default icon for the real app.
app.setAppUserModelId(app.isPackaged ? 'com.breakfit.app' : 'com.breakfit.app.dev');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('lang', 'zh-TW');

if (SELFTEST) {
  require('./src/main/selftest').run();
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  require('./src/main/app').start({ fast: FAST, hidden: HIDDEN });
}
