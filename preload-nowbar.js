const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tempoBar', {
  getStore: (key) => ipcRenderer.invoke('store:get', key),
  setStore: (key, value) => ipcRenderer.invoke('store:set', key, value),

  sessionStart: (taskId, taskTitle) => ipcRenderer.invoke('session:start', taskId, taskTitle),
  sessionPause: () => ipcRenderer.invoke('session:pause'),
  sessionResume: () => ipcRenderer.invoke('session:resume'),
  sessionStop: (status) => ipcRenderer.invoke('session:stop', status),
  sessionGetState: () => ipcRenderer.invoke('session:get-state'),
  onSessionUpdate: (cb) => ipcRenderer.on('session:update', (e, payload) => cb(payload))
});
