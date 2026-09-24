'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bf', {
  // main window
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb) => ipcRenderer.on('state:changed', () => cb()),
  onTheme: (cb) => ipcRenderer.on('theme', (_e, theme) => cb(theme)),
  onNav: (cb) => ipcRenderer.on('nav:tab', (_e, tab) => cb(tab)),
  getDay: (date) => ipcRenderer.invoke('day:get', date),
  setNote: (date, note) => ipcRenderer.invoke('day:note', { date, note }),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  setCycleToday: (index) => ipcRenderer.invoke('cycle:today', index),
  breakNow: () => ipcRenderer.invoke('break:now'),
  testBreak: () => ipcRenderer.invoke('break:test'),
  // overlay
  payload: () => ipcRenderer.invoke('break:payload'),
  setDone: (unitId, reps) => ipcRenderer.invoke('break:set', { unitId, reps }),
  setReps: (unitId, index, reps) => ipcRenderer.invoke('break:reps', { unitId, index, reps }),
  end: (outcome) => ipcRenderer.invoke('break:end', { outcome }),
});
