const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tempoSticky', {
  getStore: (key) => ipcRenderer.invoke('store:get', key),
  updateSticky: (id, patch) => ipcRenderer.invoke('sticky:update', id, patch),
  deleteSticky: (id) => ipcRenderer.invoke('sticky:delete', id),
  hideSticky: (id) => ipcRenderer.invoke('sticky:hide', id)
});

