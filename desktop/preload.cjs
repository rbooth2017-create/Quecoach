// The only things the page can ask the desktop shell to do.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cueDesktop', {
  platform: process.platform,
  setPinned: (v) => ipcRenderer.invoke('pin', !!v),
  getPinned: () => ipcRenderer.invoke('get-pin'),
  setMode: (m) => ipcRenderer.invoke('mode', ['practice', 'mini'].includes(m) ? m : 'panel'),
  fitHeight: (px) => ipcRenderer.invoke('fit-height', Number(px)),
  helperStatus: () => ipcRenderer.invoke('helper-status'),
  restartHelper: () => ipcRenderer.invoke('restart-helper'),
  showHelperLog: () => ipcRenderer.invoke('show-helper-log'),
  diagnostics: () => ipcRenderer.invoke('diagnostics'),
  onPinned: (cb) => ipcRenderer.on('pinned', (_e, v) => cb(!!v)),
  onSetMode: (cb) => ipcRenderer.on('set-mode', (_e, m) => cb(m)),
  // beat view
  screenAccess: () => ipcRenderer.invoke('screen-access'),
  findRekordbox: () => ipcRenderer.invoke('find-rekordbox'),
  openScreenSettings: () => ipcRenderer.invoke('open-screen-settings'),
  ocr: (pngBytes) => ipcRenderer.invoke('ocr', pngBytes),
  startDrag: (filePath) => ipcRenderer.send('start-drag', String(filePath)),
  // Learn app: match the title bar to the theme, and receive menu commands.
  setChrome: (c) => ipcRenderer.invoke('chrome', { bg: String(c?.bg || ''), fg: String(c?.fg || '') }),
  onCommand: (cb) => ipcRenderer.on('command', (_e, c) => cb(String(c))),
  // Windows/Linux: the app menu, opened from the ☰ button (the custom title bar hides the menu bar)
  showMenu: (x, y) => ipcRenderer.invoke('show-menu', { x: Number(x) || 0, y: Number(y) || 0 }),
  // AI coach: the API key goes in but never comes back out.
  ai: {
    status: () => ipcRenderer.invoke('ai-status'),
    setKey: (key) => ipcRenderer.invoke('ai-set-key', String(key || '')),
    clearKey: () => ipcRenderer.invoke('ai-clear-key'),
    request: (payload) => ipcRenderer.invoke('ai-request', payload),
  },
});
