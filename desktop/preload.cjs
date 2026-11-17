// The only things the page can ask the desktop shell to do.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cueDesktop', {
  platform: process.platform,
  setPinned: (v) => ipcRenderer.invoke('pin', !!v),
  getPinned: () => ipcRenderer.invoke('get-pin'),
  setMode: (m) => ipcRenderer.invoke('mode', m === 'practice' ? 'practice' : 'panel'),
  helperStatus: () => ipcRenderer.invoke('helper-status'),
  onPinned: (cb) => ipcRenderer.on('pinned', (_e, v) => cb(!!v)),
  onSetMode: (cb) => ipcRenderer.on('set-mode', (_e, m) => cb(m)),
});
