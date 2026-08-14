const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tempo', {
  getStore: (key) => ipcRenderer.invoke('store:get', key),
  setStore: (key, value) => ipcRenderer.invoke('store:set', key, value),

  createSticky: (type) => ipcRenderer.invoke('sticky:create', type),
  deleteSticky: (id) => ipcRenderer.invoke('sticky:delete', id),
  showSticky: (id) => ipcRenderer.invoke('sticky:show', id),
  updateSticky: (id, patch) => ipcRenderer.invoke('sticky:update', id, patch),

  aiBreakdown: (title) => ipcRenderer.invoke('ai:breakdown', title),
  aiHype: (stats) => ipcRenderer.invoke('ai:hype', stats),
  aiQuickAdd: (text) => ipcRenderer.invoke('ai:quick-add', text),
  aiDailyReport: (stats) => ipcRenderer.invoke('ai:daily-report', stats),

  testNotify: () => ipcRenderer.invoke('notify:test'),
  setAutostart: (enabled) => ipcRenderer.invoke('settings:set-autostart', enabled),
  setFocusMode: (enabled, minutes) => ipcRenderer.invoke('settings:set-focus', enabled, minutes),
  setActivityTracking: (enabled) => ipcRenderer.invoke('settings:set-activity-tracking', enabled),
  getLiveActivity: () => ipcRenderer.invoke('activity:get-live'),

  sessionStart: (taskId, taskTitle) => ipcRenderer.invoke('session:start', taskId, taskTitle),
  sessionPause: () => ipcRenderer.invoke('session:pause'),
  sessionResume: () => ipcRenderer.invoke('session:resume'),
  sessionStop: (status) => ipcRenderer.invoke('session:stop', status),
  sessionGetState: () => ipcRenderer.invoke('session:get-state'),
  onSessionUpdate: (cb) => ipcRenderer.on('session:update', (e, payload) => cb(payload)),

  toggleNowBar: () => ipcRenderer.invoke('nowbar:toggle'),

  clickupImport: (token, listId) => ipcRenderer.invoke('clickup:import', token, listId)
});
