// The only things the page can ask the desktop shell to do.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
  openLibraryManager: () => ipcRenderer.invoke('open-library-manager'),
  showMenu: (x, y) => ipcRenderer.invoke('show-menu', { x: Number(x) || 0, y: Number(y) || 0 }),
  // The real path of a dropped or picked file ('' when it has none, e.g. made in memory).
  filePath: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
  // My library: music copied into Cue Coach's own folder, organised in crates.
  library: {
    list: () => ipcRenderer.invoke('library-list'),
    read: (id) => ipcRenderer.invoke('library-read', String(id)),
    importDialog: (kind) => ipcRenderer.invoke('library-import-dialog', kind === 'folder' ? 'folder' : 'files'),
    importItems: (items) => ipcRenderer.invoke('library-import', { items }),
    cancelImport: () => ipcRenderer.invoke('library-cancel-import'),
    updateAnalysis: (id, data) => ipcRenderer.invoke('library-update-analysis', String(id), data),
    updateMeta: (id, fields) => ipcRenderer.invoke('library-update-meta', String(id), fields),
    crate: (op, args) => ipcRenderer.invoke('library-crate', String(op), args),
    remove: (ids) => ipcRenderer.invoke('library-delete', ids),
    onProgress: (cb) => ipcRenderer.on('library-progress', (_e, p) => cb(p)),
  },
  // AI coach: the API key goes in but never comes back out.
  ai: {
    status: () => ipcRenderer.invoke('ai-status'),
    setKey: (key) => ipcRenderer.invoke('ai-set-key', String(key || '')),
    clearKey: () => ipcRenderer.invoke('ai-clear-key'),
    request: (payload) => ipcRenderer.invoke('ai-request', payload),
  },
});
