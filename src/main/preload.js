'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bf', {
  // main window
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb) => ipcRenderer.on('state:changed', () => cb()),
  onTheme: (cb) => ipcRenderer.on('theme', (_e, theme) => cb(theme)),
  onLang: (cb) => ipcRenderer.on('lang', (_e, lang) => cb(lang)),
  onNav: (cb) => ipcRenderer.on('nav:tab', (_e, tab) => cb(tab)),
  getDay: (date) => ipcRenderer.invoke('day:get', date),
  setNote: (date, note) => ipcRenderer.invoke('day:note', { date, note }),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  setCycleToday: (index) => ipcRenderer.invoke('cycle:today', index),
  breakNow: () => ipcRenderer.invoke('break:now'),
  testBreak: () => ipcRenderer.invoke('break:test'),
  startSession: (planDay) => ipcRenderer.invoke('session:start', planDay),
  // overlay
  payload: () => ipcRenderer.invoke('break:payload'),
  setDone: (unitId, reps) => ipcRenderer.invoke('break:set', { unitId, reps }),
  setReps: (unitId, index, reps) => ipcRenderer.invoke('break:reps', { unitId, index, reps }),
  end: (outcome) => ipcRenderer.invoke('break:end', { outcome }),
  toggleView: () => ipcRenderer.invoke('break:view'), // F: full screen ⇄ window
  setView: (view) => ipcRenderer.invoke('break:view', view), // 'pip' | 'window' | 'full'
  minimize: () => ipcRenderer.invoke('break:minimize'),
  pipNeed: (need) => ipcRenderer.send('pip:need', need), // PIP too small for the clip + UI: { w, h } CSS px, or null
  onView: (cb) => ipcRenderer.on('view', (_e, v) => cb(v)),
  onAskLeave: (cb) => ipcRenderer.on('ask-leave', () => cb()), // windowed overlay closed by Alt+F4 / the taskbar
});
