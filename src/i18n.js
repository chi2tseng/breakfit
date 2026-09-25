'use strict';
// Every user-visible string, shared by the main process (require) and the renderers (<script>).
// t(lang, key, vars) with {name} placeholders; plan text comes from plan.json's *_en fields.
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.I18N = m;
}(typeof self !== 'undefined' ? self : this, () => {
  const STR = {
    zh: {
      // main window
      navToday: '今天', navHistory: '記錄', navSettings: '設定',
      breakNow: '現在就休息', library: '動作示範庫',
      d1: '第 1 天', d2: '第 2 天', d3: '第 3 天', rest: '休息', restDay: '休息日', noTraining: '今天不用練', dayOff: '非上班日',
      setsUnit: '組', setsOf: '{a}/{b} 組', progressOf: '{a} / {b} 組', pausedTillTomorrow: '已暫停到明天',
      lastBreak: '最後一次', noBreaksToday: '今天沒有排休息', catchUp: '補做', walk: '走動', nextSlot: '下一次', noMoves: '沒有動作',
      slot_done: '完成', slot_partial: '部分完成', slot_skipped: '跳過', slot_missed: '錯過', slot_notified: '已提醒',
      day_pass: '合格', day_fail: '不合格', day_rest: '休息', day_off: '非上班日', day_pending: '進行中',
      secs: '{n} 秒', inMin: '還有 {n} 分', inHour: '還有 {h} 小時', inHourMin: '還有 {h} 小時 {m} 分', startingSoon: '即將開始', close: '關閉',
      allDone: '今天完成', dayOver: '今天結束', heroRest: '今天休息', tomorrowAt: '明天 {t}', dayAt: '{d} {t}',
      historyTitle: '記錄', last30: '最近 30 個訓練日', passRate: '合格率', streakHero: '連續 {n} 天', streakHero1: '連續 {n} 天', longest: '最長',
      daysN: '{n} 天', daysN1: '{n} 天', setsN: '{n} 組', monthShort: '{m}月', noTrainingDays: '還沒有訓練日', noRecord: '沒有記錄', repsList: '{r} 下', note: '筆記',
      settingsTitle: '設定', testBreak: '預覽休息畫面', hours: '時段', start: '開始', end: '結束', interval: '間隔（分鐘）',
      workdays: '上班日', walkReminder: '提醒走動', general: '一般', todayIs: '今天是', appearance: '配色', dark: '深色', light: '淺色',
      language: '語言', demo: '示範', demoSec: '示範秒數', launchAtLogin: '開機啟動', overrides: '菜單組數 / 次數',
      sets: '組數', minReps: '最少次數', maxReps: '最多次數', reset: '還原', colSets: '組', colReps: '次數',
      prevMonth: '上個月', nextMonth: '下個月', decreaseReps: '減少次數', increaseReps: '增加次數',
      // overlay
      breakTime: '休息時間', leave: '離開', earlyBreak: '提前休息', test: '測試', skipThis: '跳過這次',
      perSide: '每邊', repsN: '{r} 下', perSideReps: '每邊 {r} 下', setNo: '第 {n}/{t} 組', timedMeta: '{n} × {s} 秒',
      yourTurn: '換你做', repUnit: '下', tempo: '3–5 秒/下', doneSet: '完成這組', upNext: '下一個', nextSet: '下一組',
      nextMove: '下一個動作', nextRound: '下一輪', plus30: '延長 30 秒', skipRest: '跳過休息', prevSet: '上一組',
      done: '完成', passedToday: '今天合格', failedToday: '今天不合格', allDoneToday: '今天全部完成', nextAt: '下次 {t}',
      stretch: '拉伸', sideRight: '右側', sideLeft: '左側', nextHold: '下一個', stretchNo: '第 {n}/{t} 個', perSideSecs: '每邊 {n} 秒',
      stretchLater: '最後一次休息拉伸', notDone: '未完成', stretchNotDone: '拉伸沒做完',
      thisBreak: '這次 {n} 組', continue: '繼續', leaveQ: '離開休息？', leaveFails: '離開 = 今天不合格',
      skipLastQ: '跳過最後一次休息？', skipFails: '跳過 = 今天不合格', skip: '跳過',
      // cover
      onBreak: '休息中',
      // tray / notifications / dialogs
      walkNotify: '休息一下，起來走走', traySets: '今天 {a}/{b} 組', restToday: '今天休息', pausedToday: '今天已暫停',
      completed: '已完成', failed: '不合格', pausedUntil: '暫停到 {t}', trayNext: '下次 {t}', trayNextBreak: '下次休息 {t}',
      noMoreBreaks: '今天沒有下一次休息', m30: '30 分鐘', h1: '1 小時', h2: '2 小時', tillTomorrow: '到明天', cancelPause: '取消暫停',
      pauseReminders: '暫停提醒', pauseRemindersUntil: '暫停提醒（到 {t}）', openMain: '打開主視窗', launchAtLoginMenu: '開機啟動', enableNotify: '開啟通知',
      quit: '結束', pauseQ: '暫停到明天？', pauseDetail: '今天會記為不合格。', pauseOk: '暫停到明天', cancel: '取消',
      runningTitle: 'BreakFit 在右下角執行中', runningBody: '圖示可能收在 ^ 裡',
      dataError: '讀不到記錄檔，程式先不啟動以免覆蓋資料。請關掉可能鎖住 {file} 的程式（OneDrive、防毒），再重新開啟 BreakFit。',
    },
    en: {
      navToday: 'Today', navHistory: 'History', navSettings: 'Settings',
      breakNow: 'Break Now', library: 'Exercises',
      d1: 'Day 1', d2: 'Day 2', d3: 'Day 3', rest: 'Rest', restDay: 'Rest Day', noTraining: 'No Workout Today', dayOff: 'Day Off',
      setsUnit: 'sets', setsOf: '{a}/{b} sets', progressOf: '{a} / {b} sets', pausedTillTomorrow: 'Paused Until Tomorrow',
      lastBreak: 'Last Break', noBreaksToday: 'No breaks today', catchUp: 'Catch-up', walk: 'Walk', nextSlot: 'Next', noMoves: 'No exercises',
      slot_done: 'Done', slot_partial: 'Partial', slot_skipped: 'Skipped', slot_missed: 'Missed', slot_notified: 'Reminded',
      day_pass: 'Passed', day_fail: 'Failed', day_rest: 'Rest', day_off: 'Day off', day_pending: 'In progress',
      secs: '{n} s', inMin: 'in {n} min', inHour: 'in {h} h', inHourMin: 'in {h} h {m} min', startingSoon: 'Starting soon', close: 'Close',
      allDone: 'Done for Today', dayOver: 'Today Is Over', heroRest: 'Rest Day Today', tomorrowAt: 'Tomorrow {t}', dayAt: '{d}, {t}',
      historyTitle: 'History', last30: 'Last 30 Training Days', passRate: 'Pass rate', streakHero: '{n} days in a row', streakHero1: '{n} day in a row', longest: 'Longest',
      daysN: '{n} days', daysN1: '{n} day', setsN: '{n} sets', monthShort: '{month}', noTrainingDays: 'No training days yet', noRecord: 'No record', repsList: '{r} reps', note: 'Notes',
      settingsTitle: 'Settings', testBreak: 'Preview Break', hours: 'Hours', start: 'Start', end: 'End', interval: 'Interval (min)',
      workdays: 'Workdays', walkReminder: 'Walk Reminder', general: 'General', todayIs: 'Today is', appearance: 'Appearance', dark: 'Dark', light: 'Light',
      language: 'Language', demo: 'Demo', demoSec: 'Demo Length', launchAtLogin: 'Open at Login', overrides: 'Sets / Reps',
      sets: 'Sets', minReps: 'Min Reps', maxReps: 'Max Reps', reset: 'Reset', colSets: 'Sets', colReps: 'Reps',
      prevMonth: 'Previous Month', nextMonth: 'Next Month', decreaseReps: 'Fewer Reps', increaseReps: 'More Reps',
      breakTime: 'Break Time', leave: 'Leave', earlyBreak: 'Early Break', test: 'Test', skipThis: 'Skip This One',
      perSide: 'Each side', repsN: '{r} reps', perSideReps: '{r} reps each side', setNo: 'Set {n}/{t}', timedMeta: '{n} × {s} s',
      yourTurn: 'Your Turn', repUnit: 'reps', tempo: '3–5 s per rep', doneSet: 'Set Done', upNext: 'Up Next', nextSet: 'Next Set',
      nextMove: 'Next Exercise', nextRound: 'Next Round', plus30: '+30 s', skipRest: 'Skip Rest', prevSet: 'Last Set',
      done: 'Done', passedToday: 'Passed Today', failedToday: 'Failed Today', allDoneToday: 'All Done Today', nextAt: 'Next {t}',
      stretch: 'Stretch', sideRight: 'Right', sideLeft: 'Left', nextHold: 'Next', stretchNo: 'Stretch {n}/{t}', perSideSecs: '{n} s each side',
      stretchLater: 'Stretch at the last break', notDone: 'Not done', stretchNotDone: 'Stretch not done',
      thisBreak: '{n} Sets This Break', continue: 'Continue', leaveQ: 'Leave this break?', leaveFails: 'Leaving means today fails',
      skipLastQ: 'Skip the last break?', skipFails: 'Skipping means today fails', skip: 'Skip',
      onBreak: 'On a Break',
      walkNotify: 'Time for a break. Get up and walk around.', traySets: 'Today {a}/{b} sets', restToday: 'Rest day today', pausedToday: 'Paused for today',
      completed: 'Done', failed: 'Failed', pausedUntil: 'Paused until {t}', trayNext: 'Next {t}', trayNextBreak: 'Next break {t}',
      noMoreBreaks: 'No more breaks today', m30: '30 minutes', h1: '1 hour', h2: '2 hours', tillTomorrow: 'Until tomorrow', cancelPause: 'Resume Reminders',
      pauseReminders: 'Pause Reminders', pauseRemindersUntil: 'Pause Reminders (until {t})', openMain: 'Open BreakFit', launchAtLoginMenu: 'Open at Login', enableNotify: 'Enable Notifications',
      quit: 'Quit', pauseQ: 'Pause until tomorrow?', pauseDetail: 'Today will count as failed.', pauseOk: 'Pause Until Tomorrow', cancel: 'Cancel',
      runningTitle: 'BreakFit is running in the tray', runningBody: 'The icon may be hidden under ^',
      dataError: 'Can’t read the data file. BreakFit won’t start so your records aren’t overwritten. Close anything that may lock {file} (OneDrive, antivirus), then open BreakFit again.',
    },
  };

  const norm = (lang) => (lang === 'en' ? 'en' : 'zh');
  const locale = (lang) => (norm(lang) === 'en' ? 'en-US' : 'zh-TW');
  const htmlLang = (lang) => (norm(lang) === 'en' ? 'en' : 'zh-Hant-TW');

  function t(lang, key, vars) {
    const s = STR[norm(lang)][key] ?? STR.zh[key] ?? key;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
  }

  // Static markup: data-i18n (text), data-i18n-title, data-i18n-aria, data-i18n-ph.
  function apply(doc, lang) {
    doc.documentElement.lang = htmlLang(lang);
    for (const el of doc.querySelectorAll('[data-i18n]')) el.textContent = t(lang, el.dataset.i18n);
    for (const el of doc.querySelectorAll('[data-i18n-title]')) el.title = t(lang, el.dataset.i18nTitle);
    for (const el of doc.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(lang, el.dataset.i18nAria));
    for (const el of doc.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(lang, el.dataset.i18nPh);
    const title = doc.querySelector('title[data-i18n-doc]');
    if (title) title.textContent = t(lang, title.dataset.i18nDoc);
  }

  // Deep copy of plan.json with every `x_en` field promoted to `x` (English), or untouched (繁中).
  function localizePlan(plan, lang) {
    const en = norm(lang) === 'en';
    const walk = (v) => {
      if (Array.isArray(v)) return v.map(walk);
      if (!v || typeof v !== 'object') return v;
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x);
      if (en) for (const k of Object.keys(v)) if (k.endsWith('_en')) o[k.slice(0, -3)] = o[k];
      return o;
    };
    return walk(plan);
  }

  // Dates from 'YYYY-MM-DD' keys, via Intl in the chosen language.
  const dateOf = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmt = (lang, opts, d) => new Intl.DateTimeFormat(locale(lang), opts).format(d);
  function dayLabel(lang, key) { // 9月24日 週四 / Thu, September 24
    const d = dateOf(key);
    return norm(lang) === 'en'
      ? fmt(lang, { weekday: 'short', month: 'long', day: 'numeric' }, d)
      : `${fmt(lang, { month: 'long', day: 'numeric' }, d)} ${fmt(lang, { weekday: 'short' }, d)}`;
  }
  // month: 'long' (September 2026) or 'short' (Sep 2026, phone calendar); 繁中 is 2026年9月 either way
  const monthLabel = (lang, ym, month = 'long') => fmt(lang, { year: 'numeric', month: norm(lang) === 'en' ? month : 'long' }, dateOf(`${ym}-01`));
  const shortDate = (lang, key) => fmt(lang, { month: 'numeric', day: 'numeric' }, dateOf(key)); // chart axis: 9/24
  const monthName = (lang, ym) => fmt(lang, { month: 'long' }, dateOf(`${ym}-01`));
  // 7 narrow weekday names, Sunday first (日 一 … / S M T …)
  const weekdays = (lang) => Array.from({ length: 7 }, (_, i) => fmt(lang, { weekday: 'narrow' }, new Date(2026, 8, 20 + i)));

  return { STR, norm, locale, htmlLang, t, apply, localizePlan, dayLabel, monthLabel, monthName, shortDate, weekdays };
}));
