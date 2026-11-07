const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deskbud', {
  getState: () => ipcRenderer.invoke('get-state'),
  pair: (details) => ipcRenderer.invoke('pair', details),
  unpair: () => ipcRenderer.invoke('unpair'),
  save: (changes) => ipcRenderer.invoke('save', changes),
  setPaused: (value) => ipcRenderer.invoke('set-paused', value),
  stop: () => ipcRenderer.invoke('stop'),
  openKeysPage: () => ipcRenderer.invoke('open-keys-page'),
  openGeminiKeysPage: () => ipcRenderer.invoke('open-gemini-keys-page'),
  onState: (handler) => ipcRenderer.on('state', (_event, state) => handler(state)),
});
