const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  getState: () => ipcRenderer.invoke('app:state'),
  getDefaults: () => ipcRenderer.invoke('settings:defaults'),
  saveSettings: (draft) => ipcRenderer.invoke('settings:save', draft),
  cancelSettings: () => ipcRenderer.invoke('settings:cancel'),
  pickFile: (kind) => ipcRenderer.invoke('settings:pick', kind),
  clientStatus: (id) => ipcRenderer.invoke('client:status', id),
  testLaunch: (kind, value, browserPath) => ipcRenderer.invoke('launch:test', kind, value, browserPath),
  launch: (kind, id) => ipcRenderer.invoke('launch:role', kind, id),
  openReleaseLink: (key) => ipcRenderer.invoke('app:release-link', key),
  windowAction: (action) => ipcRenderer.invoke('window:action', action),
  onWindowChanged: (listener) => ipcRenderer.on('window:changed', (_event, state) => listener(state))
});
