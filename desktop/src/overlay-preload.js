const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  on: (handler) => ipcRenderer.on('overlay', (_event, name, data) => handler(name, data)),
});
