// Cue Coach desktop: an always-on-top side panel next to rekordbox.
// - serves the web app on 127.0.0.1:8642 (only index.html and js/)
// - starts the rekordbox helper (helper/rekordbox_helper.py) and stops it on quit
// - docks a 420 px window to the right edge of the screen, floating over rekordbox
const { app, BrowserWindow, Menu, ipcMain, screen, session, shell, desktopCapturer, systemPreferences, nativeImage, dialog } = require('electron');
const { spawn } = require('node:child_process');
const ai = require('./ai.cjs');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
app.setName('Cue Coach');
const PORT = 8642;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const HELPER = 'http://127.0.0.1:8765';
const PANEL_W = 420;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };
// Files the page may load: the app, the audio spike, and the time-stretch library it uses.
const SERVED = /^\/(index\.html|spike\.html|learn\.html|js\/[\w.-]+\.js|node_modules\/signalsmith-stretch\/SignalsmithStretch\.mjs)$/;

let win = null;
let server = null;
let helperProc = null;
let helperStatus = { state: 'starting', message: '' };
let pinned = true;
let mode = 'panel';

// ---------- static server ----------
function startServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, ORIGIN);
      const p = url.pathname === '/' ? '/index.html' : url.pathname;
      if (!SERVED.test(p)) { res.writeHead(404); return res.end(); }
      fs.readFile(path.join(ROOT, p), (err, data) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(p)], 'Cache-Control': 'no-store' });
        res.end(data);
      });
    });
    server.once('error', async (err) => {
      server = null;
      // Port taken. Fine if it serves this version's pages (e.g. `npm start`). If it's an older copy of
      // Cue Coach still running, its server doesn't know our pages, so say so instead of showing a blank window.
      if (err.code === 'EADDRINUSE') {
        if (await ping(`${ORIGIN}/learn.html`)) return resolve();
        const e = new Error('An older copy of Cue Coach is still running.'); e.code = 'STALE_COPY'; return reject(e);
      }
      reject(err);
    });
    server.listen(PORT, '127.0.0.1', resolve);
  });
}

function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { headers: { Origin: ORIGIN }, timeout: 1500 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// ---------- rekordbox helper ----------
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

/** Packaged app: the bundled helper program. Development: Python + helper/rekordbox_helper.py. */
function helperCommand() {
  const bundled = path.join(process.resourcesPath || '', 'helper', IS_WIN ? 'cuecoach-helper.exe' : 'cuecoach-helper');
  if (app.isPackaged && fs.existsSync(bundled)) return { cmd: bundled, args: [], cwd: path.dirname(bundled) };
  if (app.isPackaged) return null; // e.g. the Linux build ships without it
  const venvPy = IS_WIN ? path.join(ROOT, '.venv', 'Scripts', 'python.exe') : path.join(ROOT, '.venv', 'bin', 'python');
  const python = fs.existsSync(venvPy) ? venvPy : IS_WIN ? 'python' : 'python3';
  return { cmd: python, args: [path.join(ROOT, 'helper', 'rekordbox_helper.py')], cwd: ROOT };
}

async function startHelper() {
  if (await ping(`${HELPER}/status`)) { helperStatus = { state: 'running', message: 'already running' }; return; }
  // CUECOACH_HELPER_ARGS lets you point at another database, e.g. "--unlocked --db /path/master.db"
  const extra = (process.env.CUECOACH_HELPER_ARGS || '').match(/"[^"]*"|\S+/g)?.map((a) => a.replace(/^"|"$/g, '')) || [];
  const hc = helperCommand();
  if (!hc || (process.platform === 'linux' && !extra.length)) {
    helperStatus = { state: 'unavailable', message: 'rekordbox runs on Mac and Windows only. Import a rekordbox XML export (☰ menu) instead.' };
    return;
  }
  let errText = '';
  helperStatus = { state: 'starting', message: '' };
  // Everything the helper prints goes to helper.log in the app's settings folder (for support).
  const log = fs.createWriteStream(helperLogPath(), { flags: 'w' });
  log.write(`Cue Coach ${app.getVersion()} · ${process.platform} ${process.arch} · ${new Date().toISOString()}\n${hc.cmd}\n\n`);
  const proc = spawn(hc.cmd, [...hc.args, ...extra], { cwd: hc.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' } });
  helperProc = proc;
  proc.stdout.on('data', (d) => { log.write(d); if (/Listening/.test(String(d))) helperStatus = { state: 'running', message: String(d).trim() }; });
  proc.stderr.on('data', (d) => { log.write(d); errText = (errText + d).slice(-2000); });
  proc.on('error', (err) => { log.write(`\n${err.stack || err}\n`); helperStatus = { state: 'failed', message: `Couldn't start the rekordbox helper: ${err.message}` }; });
  proc.on('exit', (code) => {
    log.end(`\n[helper exited with code ${code}]\n`);
    if (helperProc !== proc) return; // replaced by a restart
    helperProc = null;
    if (helperStatus.state !== 'running' || code) {
      const lines = errText.trim().split('\n').filter((l) => !/^\s*(Traceback|File |\^)/.test(l));
      helperStatus = { state: 'failed', message: lines.slice(-2).join(' ') || `helper exited (${code})` };
    } else helperStatus = { state: 'stopped', message: '' };
  });
}

const helperLogPath = () => path.join(app.getPath('userData'), 'helper.log');

function stopHelper() {
  if (helperProc) { helperProc.kill(); helperProc = null; } // SIGTERM; TerminateProcess on Windows
}

// ---------- window ----------
function workArea() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
}
function boundsFor(m) {
  const wa = workArea();
  if (m === 'panel') return { x: wa.x + wa.width - PANEL_W, y: wa.y, width: PANEL_W, height: wa.height };
  if (m === 'mini') return { x: wa.x + wa.width - PANEL_W, y: wa.y, width: PANEL_W, height: 300 }; // the page fits it to its content
  const width = Math.min(1440, wa.width), height = Math.min(940, wa.height);
  return { x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + Math.round((wa.height - height) / 2), width, height };
}

function setPinned(v) {
  pinned = !!v;
  if (!win) return pinned;
  win.setAlwaysOnTop(pinned, IS_MAC ? 'floating' : 'normal');
  // macOS: also float over a full-screen rekordbox (it lives in its own Space).
  if (IS_MAC) win.setVisibleOnAllWorkspaces(pinned, { visibleOnFullScreen: true });
  win.webContents.send('pinned', pinned);
  buildMenu();
  return pinned;
}

function setMode(m) {
  mode = ['practice', 'mini'].includes(m) ? m : 'panel';
  if (win) win.setBounds(boundsFor(mode), true);
  buildMenu();
}

function createWindow() {
  win = new BrowserWindow({
    ...boundsFor('panel'),
    minWidth: 340, minHeight: 160,
    title: 'Cue Coach',
    autoHideMenuBar: !IS_MAC, // Windows/Linux: menu shows with Alt
    backgroundColor: '#0d0f13',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  setPinned(true);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN)) e.preventDefault(); });
  win.loadURL(`${ORIGIN}/?mode=panel`);
  win.on('closed', () => { win = null; });
}

// ---------- main window: the Learn app ----------
// A native-feeling window: the page draws its own title bar (traffic lights on macOS, window buttons on
// Windows/Linux), follows the chosen theme, and remembers its size and position.
const ICON = path.join(ROOT, 'assets', 'icon.png');
let learnWin = null;
const winStatePath = () => path.join(app.getPath('userData'), 'window.json');
function readWinState() { try { return JSON.parse(fs.readFileSync(winStatePath(), 'utf8')); } catch { return {}; } }
function writeWinState(extra = {}) {
  const st = { ...readWinState(), ...extra };
  if (learnWin && !learnWin.isDestroyed()) Object.assign(st, { bounds: learnWin.getNormalBounds(), maximized: learnWin.isMaximized() });
  try { fs.writeFileSync(winStatePath(), JSON.stringify(st)); } catch { /* read-only profile: not fatal */ }
}
const onScreen = (b) => b && screen.getAllDisplays().some(({ workArea: w }) => b.x < w.x + w.width - 80 && b.x + b.width > w.x + 80 && b.y >= w.y - 10 && b.y < w.y + w.height - 80);

function createLearnWindow() {
  if (learnWin) { learnWin.show(); return learnWin.focus(); }
  const st = readWinState(), wa = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1440, wa.width), height = Math.min(920, wa.height);
  const bounds = onScreen(st.bounds) ? st.bounds : { width, height, x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + Math.round((wa.height - height) / 2) };
  const bg = st.chrome?.bg || '#f6f5f1', fg = st.chrome?.fg || '#1d2230';
  learnWin = new BrowserWindow({
    ...bounds, minWidth: 1100, minHeight: 700, title: 'Cue Coach', show: false, backgroundColor: bg,
    icon: fs.existsSync(ICON) ? ICON : undefined,
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 15 } }
      : { titleBarStyle: 'hidden', titleBarOverlay: { color: bg, symbolColor: fg, height: 46 } }),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (st.maximized) learnWin.maximize();
  learnWin.once('ready-to-show', () => learnWin.show());
  learnWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  learnWin.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN)) e.preventDefault(); });
  let t; const save = () => { clearTimeout(t); t = setTimeout(() => writeWinState(), 400); };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) learnWin.on(ev, save);
  learnWin.on('close', () => writeWinState());
  learnWin.on('closed', () => { learnWin = null; });
  // Never leave a silent white window: if the page can't load, say what happened.
  const showLoadError = (why) => learnWin?.loadURL(errorPage('Cue Coach couldn\'t open', why));
  learnWin.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => { if (isMainFrame && code !== -3) showLoadError(`The app's page didn't load (${desc}). Quit Cue Coach and open it again.`); });
  learnWin.webContents.on('did-navigate', (_e, url, status) => { if (url.startsWith(ORIGIN) && status >= 400) showLoadError(`The app's page wasn't found (error ${status}). If another copy of Cue Coach is open, quit every copy and open it again.`); });
  learnWin.loadURL(`${ORIGIN}/learn.html`);
}
/** A simple, readable page for when something goes wrong (instead of a blank window). */
function errorPage(title, text) {
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body style="margin:0;height:100vh;display:grid;place-items:center;font:14px system-ui,-apple-system,'Segoe UI',sans-serif;background:#f6f5f1;color:#1d2230;-webkit-app-region:drag">
    <div style="max-width:440px;text-align:center;padding:24px"><h1 style="font-size:20px;margin:0 0 8px">${esc(title)}</h1><p style="color:#5c6272;line-height:1.5;margin:0">${esc(text)}</p></div></body>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
const sendCommand = (cmd) => { if (!learnWin) createLearnWindow(); learnWin.webContents.send('command', cmd); };

// Extra full-size windows (the audio spike test page).
const pages = new Map();
function openPage(file, title, width, height) {
  if (pages.has(file)) return pages.get(file).focus();
  const w = new BrowserWindow({
    width, height, minWidth: 720, minHeight: 560, title,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  w.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN)) e.preventDefault(); });
  w.loadURL(`${ORIGIN}/${file}`);
  w.on('closed', () => pages.delete(file));
  pages.set(file, w);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const cmd = (label, c, accelerator) => ({ label, accelerator, click: () => sendCommand(c) });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        cmd('Open Music Folder…', 'source-folder', 'CmdOrCtrl+O'),
        cmd('Use Practice Tracks', 'source-practice'),
        cmd('Use rekordbox Library', 'source-rekordbox'),
        cmd('Use My Library', 'source-managed'),
        cmd('Import Music to My Library…', 'library-import', 'CmdOrCtrl+I'),
        { type: 'separator' },
        cmd('Find Music…', 'search', 'CmdOrCtrl+F'),
        { type: 'separator' },
        cmd('AI Coach Settings…', 'ai'),
        cmd('Controller and Sound…', 'controller'),
        ...(isMac ? [{ type: 'separator' }, { role: 'close' }] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Mix',
      submenu: [
        cmd('Play / Pause Deck A', 'play-left'),
        cmd('Play / Pause Deck B', 'play-right'),
        { type: 'separator' },
        cmd('Build a Set…', 'build-set', 'CmdOrCtrl+B'),
        cmd('Change Level…', 'level', 'CmdOrCtrl+L'),
        cmd('Start the Lesson Again', 'restart-lesson'),
      ],
    },
    {
      label: 'View',
      submenu: [
        cmd('Show / Hide Lessons', 'toggle-lessons', 'CmdOrCtrl+T'),
        cmd('Appearance…', 'theme', 'CmdOrCtrl+Shift+A'),
        { type: 'separator' },
        { label: 'Cue Coach', accelerator: 'CmdOrCtrl+1', click: () => createLearnWindow() },
        {
          label: 'rekordbox Side Panel (Club Mode)',
          submenu: [
            { label: 'Open Side Panel', accelerator: 'CmdOrCtrl+2', click: () => (win ? win.focus() : createWindow()) },
            { label: 'Keep on Top of rekordbox', type: 'checkbox', checked: pinned, accelerator: 'CmdOrCtrl+Shift+T', click: (i) => setPinned(i.checked) },
            { type: 'separator' },
            { label: 'Side Panel', type: 'radio', checked: mode === 'panel', click: () => win?.webContents.send('set-mode', 'panel') },
            { label: 'Practice Decks', type: 'radio', checked: mode === 'practice', click: () => win?.webContents.send('set-mode', 'practice') },
            { label: 'Mini Beatmatch', type: 'radio', checked: mode === 'mini', click: () => win?.webContents.send('set-mode', 'mini') },
            { label: 'Dock to Right Edge', accelerator: 'CmdOrCtrl+Shift+D', click: () => win?.setBounds(boundsFor(mode), true) },
          ],
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { label: 'Developer', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { label: 'Audio Spike (test page)', click: () => openPage('spike.html', 'Audio spike', 1000, 900) }] },
      ],
    },
    { role: 'windowMenu' },
    { role: 'help', submenu: [cmd('Keyboard Shortcuts', 'help', 'CmdOrCtrl+/')] },
  ]));
}

// ---------- IPC (only from our own page) ----------
const fromUs = (e) => e.senderFrame?.url?.startsWith(ORIGIN);
ipcMain.handle('pin', (e, v) => (fromUs(e) ? setPinned(v) : pinned));
ipcMain.handle('get-pin', () => pinned);
// AI coach (Claude): only the Learn window may use it. The key stays in this process, encrypted on disk.
const fromLearn = (e) => fromUs(e) && learnWin && e.sender === learnWin.webContents;
ipcMain.handle('ai-status', (e) => (fromLearn(e) ? ai.status() : null));
ipcMain.handle('show-menu', (e, pos) => { if (fromLearn(e)) Menu.getApplicationMenu()?.popup({ window: learnWin, x: Math.round(pos?.x || 0), y: Math.round(pos?.y || 0) }); });
ipcMain.handle('ai-set-key', (e, key) => (fromLearn(e) ? ai.setKey(key) : null));
ipcMain.handle('ai-clear-key', (e) => (fromLearn(e) ? ai.clearKey() : null));
ipcMain.handle('ai-request', (e, payload) => (fromLearn(e) ? ai.request(payload) : { error: 'Not allowed.' }));
// ---------- My library: music copied into Cue Coach's own folder ----------
// userData/Music holds the files, userData/library.json the tracks and crates (see libstore.cjs).
const libModel = require('./libmodel.cjs');
const { createStore, walkAudio } = require('./libstore.cjs');
let libStore = null;
const store = () => (libStore ||= createStore(app.getPath('userData')));
let tagsModule = null;
const readTagsFn = async () => (tagsModule ||= await import(require('node:url').pathToFileURL(path.join(ROOT, 'js', 'tags.js')).href)).readTags;
let importing = null; // AbortController of the import in progress

const libView = (lib) => ({
  musicDir: store().musicDir,
  tracks: lib.tracks.map((t) => ({ ...t, path: store().filePath(t) })),
  crates: lib.crates,
});
/** Only plain data from the page: a size cap and a JSON round trip. */
const plain = (v, max = 2e6) => { try { const s = JSON.stringify(v ?? {}); return s.length > max ? {} : JSON.parse(s); } catch { return {}; } };

async function runImport(items) {
  if (importing) return { busy: true };
  importing = new AbortController();
  const send = (p) => learnWin?.webContents.send('library-progress', p);
  try {
    const res = await store().importItems(items, { readTags: await readTagsFn(), signal: importing.signal, onProgress: send });
    send({ ...res, finished: true, errors: res.errors.slice(0, 5) });
    return { ...res, errors: res.errors.slice(0, 20), library: libView(await store().load()) };
  } finally { importing = null; }
}

ipcMain.handle('library-list', async (e) => (fromLearn(e) ? libView(await store().load()) : null));
ipcMain.handle('library-read', async (e, id) => {
  if (!fromLearn(e)) return null;
  await store().load();
  const rec = store().get(String(id));
  if (!rec) throw new Error('That track is no longer in your library.');
  return fs.promises.readFile(store().filePath(rec));
});
ipcMain.handle('library-import-dialog', async (e, kind) => {
  if (!fromLearn(e)) return null;
  const folder = kind === 'folder';
  const r = await dialog.showOpenDialog(learnWin, folder
    ? { title: 'Import a folder of music', buttonLabel: 'Import', properties: ['openDirectory', 'multiSelections'] }
    : { title: 'Import music', buttonLabel: 'Import', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'aac', 'mp4', 'wav', 'aif', 'aiff', 'flac', 'ogg', 'oga', 'opus'] }] });
  if (r.canceled || !r.filePaths.length) return { cancelled: true };
  const paths = [];
  for (const p of r.filePaths) {
    if (folder) paths.push(...(await walkAudio(p)));
    else if (libModel.isAudioName(p)) paths.push(p);
  }
  if (!paths.length) return { added: 0, skipped: 0, failed: 0, total: 0, ids: [], errors: [], empty: true };
  return runImport(paths.map((p) => ({ path: p })));
});
ipcMain.handle('library-import', async (e, payload) => {
  if (!fromLearn(e)) return null;
  const raw = Array.isArray(payload?.items) ? payload.items.slice(0, 20000) : [];
  const items = [];
  for (const it of raw) {
    const meta = plain(it?.meta);
    if (typeof it?.path === 'string' && it.path) {
      const p = path.normalize(it.path);
      if (path.isAbsolute(p) && libModel.isAudioName(p) && fs.existsSync(p)) items.push({ path: p, meta });
      else items.push({ name: path.basename(p), error: 'the original file wasn\'t found' });
    } else if (it?.bytes instanceof Uint8Array && typeof it.name === 'string') items.push({ bytes: it.bytes, name: path.basename(it.name), meta });
  }
  return runImport(items);
});
ipcMain.handle('library-cancel-import', (e) => { if (fromLearn(e)) importing?.abort(); });
ipcMain.handle('library-update-analysis', async (e, id, data) => {
  if (!fromLearn(e)) return;
  const d = plain(data);
  await store().update((l) => libModel.updateAnalysis(l, String(id), { grid: d.grid, duration: d.duration, phrases: d.phrases }));
});
ipcMain.handle('library-crate', async (e, op, args) => {
  if (!fromLearn(e)) return null;
  const a = plain(args, 1e6), ids = Array.isArray(a.trackIds) ? a.trackIds.map(String) : [];
  let created = null;
  const lib = await store().update((l) => {
    switch (op) {
      case 'create': { const r = libModel.createCrate(l, require('node:crypto').randomUUID(), a.name); created = r.crate; return ids.length ? libModel.addToCrate(r.lib, r.crate.id, ids) : r.lib; }
      case 'rename': return libModel.renameCrate(l, String(a.id), a.name);
      case 'delete': return libModel.deleteCrate(l, String(a.id));
      case 'add': return libModel.addToCrate(l, String(a.id), ids);
      case 'remove': return libModel.removeFromCrate(l, String(a.id), ids);
      default: return l;
    }
  });
  return { crates: lib.crates, created };
});
ipcMain.handle('library-delete', async (e, ids) => {
  if (!fromLearn(e) || !Array.isArray(ids)) return null;
  return libView(await store().remove(ids.map(String), (p) => shell.trashItem(p)));
});
app.on('will-quit', () => { importing?.abort(); });

// The Learn page tells us its theme colours so the title bar and window background match.
ipcMain.handle('chrome', (e, c) => {
  if (!fromUs(e) || !learnWin || e.sender !== learnWin.webContents) return;
  const hex = (v, d) => (/^#[0-9a-f]{3,8}$/i.test(String(v || '').trim()) ? String(v).trim() : d);
  const bg = hex(c?.bg, '#f6f5f1'), fg = hex(c?.fg, '#1d2230');
  learnWin.setBackgroundColor(bg);
  if (!IS_MAC) learnWin.setTitleBarOverlay({ color: bg, symbolColor: fg, height: 46 });
  writeWinState({ chrome: { bg, fg } });
});
ipcMain.handle('mode', (e, m) => { if (fromUs(e)) setMode(m); return mode; });
// mini view: the page asks for the height its content needs
ipcMain.handle('fit-height', (e, h) => {
  if (!fromUs(e) || mode !== 'mini' || !win) return;
  const [w] = win.getContentSize();
  win.setContentSize(w, Math.max(140, Math.min(700, Math.round(Number(h) || 0))), true);
});
ipcMain.handle('helper-status', () => helperStatus);
ipcMain.handle('restart-helper', async (e) => {
  if (!fromUs(e)) return helperStatus;
  stopHelper();
  await new Promise((r) => setTimeout(r, 500)); // let the old one release its port
  await startHelper();
  return helperStatus;
});
ipcMain.handle('show-helper-log', (e) => { if (fromUs(e) && fs.existsSync(helperLogPath())) shell.showItemInFolder(helperLogPath()); });
// Connection check (Options): everything needed to see why rekordbox isn't connecting.
ipcMain.handle('diagnostics', async (e) => {
  if (!fromUs(e)) return null;
  let window = null;
  try {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
    const rb = sources.find((s) => /rekordbox/i.test(s.name) && !/cue coach/i.test(s.name));
    window = rb ? rb.name : null;
  } catch (err) { window = `error: ${err.message}`; }
  const hc = helperCommand();
  return {
    app: app.getVersion(), platform: process.platform, arch: process.arch,
    helper: helperStatus, helperProgram: hc ? hc.cmd : null, helperFound: !!hc && (hc.cmd.includes(path.sep) ? fs.existsSync(hc.cmd) : true),
    helperAnswers: await ping(`${HELPER}/status`),
    screenAccess: IS_MAC ? systemPreferences.getMediaAccessStatus('screen') : 'not needed',
    rekordboxWindow: window, log: helperLogPath(),
  };
});

// ---------- Beat view: capture only rekordbox's window ----------
ipcMain.handle('screen-access', () => (IS_MAC ? systemPreferences.getMediaAccessStatus('screen') : 'granted'));
ipcMain.handle('find-rekordbox', async (e) => {
  if (!fromUs(e)) return null;
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
  const rb = sources.find((s) => /^rekordbox\b/i.test(s.name.trim())) || sources.find((s) => /rekordbox/i.test(s.name) && !/cue coach/i.test(s.name));
  return rb ? { id: rb.id, name: rb.name } : null;
});
// ---------- Deck reader: OCR of rekordbox's deck headers (offline, bundled English data) ----------
let ocrWorker = null;
function ocr() {
  if (!ocrWorker) {
    const { createWorker } = require('tesseract.js');
    // packaged app: these files are unpacked next to app.asar (see build.asarUnpack)
    const unpacked = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    ocrWorker = createWorker('eng', 1, {
      langPath: unpacked(path.join(ROOT, 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int')),
      gzip: true,
      cachePath: path.join(app.getPath('userData'), 'ocr'),
    }).catch((err) => { ocrWorker = null; throw err; });
  }
  return ocrWorker;
}
ipcMain.handle('ocr', async (e, bytes) => {
  if (!fromUs(e) || !(bytes instanceof Uint8Array) || bytes.length > 20e6) return null;
  const worker = await ocr();
  const { data } = await worker.recognize(Buffer.from(bytes));
  return data.text;
});
app.on('will-quit', () => { ocrWorker?.then((w) => w.terminate()).catch(() => {}); });

// ---------- Drag a track onto a rekordbox deck ----------
// The page starts a real file drag (like dragging from Finder/Explorer); rekordbox loads the
// file on whichever deck it's dropped on. Only audio files that exist are allowed.
const AUDIO = /\.(mp3|m4a|aac|wav|aiff?|flac|ogg|alac|mp4)$/i;
const dragIcon = nativeImage.createFromPath(path.join(__dirname, 'drag-icon.png'));
ipcMain.on('start-drag', (e, filePath) => {
  if (!fromUs(e) || typeof filePath !== 'string' || !AUDIO.test(filePath)) return;
  const file = path.normalize(filePath);
  if (!fs.existsSync(file)) return;
  e.sender.startDrag({ file, icon: dragIcon });
});

ipcMain.handle('open-screen-settings', (e) => {
  if (fromUs(e) && IS_MAC) shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
});

// Only one copy of the app: opening it again brings the open window to the front.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => {
  // While developing, running `npm run desktop` again restarts this copy so it picks up the latest code.
  if (!app.isPackaged) { writeWinState(); stopHelper(); app.relaunch(); app.exit(0); return; }
  if (learnWin) { if (learnWin.isMinimized()) learnWin.restore(); learnWin.show(); learnWin.focus(); } else if (app.isReady()) createLearnWindow();
});

app.whenReady().then(async () => {
  if (!gotLock) return; // another copy is already open and has been brought to the front
  // Web MIDI for the controller, and video-only capture (the rekordbox window) for the beat view.
  // fileSystem: read-only access to the music folder the user picks in the Learn app.
  // Electron asks for 'midiSysex' even when the page only wants plain MIDI, so allow both for our own pages.
  const allowed = (perm, url, media) => ((perm === 'midi' || perm === 'midiSysex') && String(url).startsWith(ORIGIN))
    || (perm === 'fileSystem' && String(url).startsWith(ORIGIN))
    || ((perm === 'display-capture' || perm === 'media') && String(url).startsWith(ORIGIN) && (media || ['video']).every((t) => t === 'video'));
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => { if (process.env.CUECOACH_DEBUG) console.log('perm request', perm, JSON.stringify(details)); cb(allowed(perm, details.requestingUrl || wc.getURL(), details.mediaTypes)); });
  session.defaultSession.setPermissionCheckHandler((wc, perm, origin, details) => { if (process.env.CUECOACH_DEBUG) console.log('perm check', perm, origin, JSON.stringify(details)); return allowed(perm, origin || wc?.getURL(), null); });
  try { await startServer(); } catch (err) {
    console.error('Cannot serve Cue Coach:', err.message);
    dialog.showErrorBox(err.code === 'STALE_COPY' ? 'Another copy of Cue Coach is open' : 'Cue Coach couldn\'t start',
      err.code === 'STALE_COPY'
        ? 'An older copy of Cue Coach is still running in the background. Quit it (Cue Coach › Quit, or ⌘Q in its window), then open Cue Coach again.'
        : `Something stopped the app from starting: ${err.message}`);
    app.quit(); return;
  }
  startHelper();
  buildMenu();
  if (IS_MAC && app.dock && fs.existsSync(ICON) && !app.isPackaged) app.dock.setIcon(ICON);
  createLearnWindow();
  app.on('activate', () => { if (!learnWin && !win) createLearnWindow(); });
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { stopHelper(); server?.close(); });
