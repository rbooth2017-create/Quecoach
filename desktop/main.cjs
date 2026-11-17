// Cue Coach desktop: an always-on-top side panel next to rekordbox.
// - serves the web app on 127.0.0.1:8642 (only index.html and js/)
// - starts the rekordbox helper (helper/rekordbox_helper.py) and stops it on quit
// - docks a 420 px window to the right edge of the screen, floating over rekordbox
const { app, BrowserWindow, Menu, ipcMain, screen, session, shell, desktopCapturer, systemPreferences, nativeImage } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PORT = 8642;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const HELPER = 'http://127.0.0.1:8765';
const PANEL_W = 420;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

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
      if (!/^\/(index\.html|js\/[\w.-]+\.js)$/.test(p)) { res.writeHead(404); return res.end(); }
      fs.readFile(path.join(ROOT, p), (err, data) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(p)], 'Cache-Control': 'no-store' });
        res.end(data);
      });
    });
    server.once('error', async (err) => {
      server = null;
      // Port taken — fine if it's Cue Coach already served by `npm start`.
      if (err.code === 'EADDRINUSE' && (await ping(`${ORIGIN}/js/main.js`))) return resolve();
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
  helperProc = spawn(hc.cmd, [...hc.args, ...extra], { cwd: hc.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' } });
  helperProc.stdout.on('data', (d) => { if (/Listening/.test(String(d))) helperStatus = { state: 'running', message: String(d).trim() }; });
  helperProc.stderr.on('data', (d) => { errText = (errText + d).slice(-2000); });
  helperProc.on('error', (err) => { helperStatus = { state: 'failed', message: `Could not start Python: ${err.message}` }; });
  helperProc.on('exit', (code) => {
    helperProc = null;
    if (helperStatus.state !== 'running' || code) {
      const lines = errText.trim().split('\n').filter((l) => !/^\s*(Traceback|File |\^)/.test(l));
      helperStatus = { state: 'failed', message: lines.slice(-2).join(' ') || `helper exited (${code})` };
    } else helperStatus = { state: 'stopped', message: '' };
  });
}

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

function buildMenu() {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : [{ label: 'File', submenu: [{ role: 'quit' }] }]),
    { role: 'editMenu' }, // copy/paste, e.g. for the API key
    {
      label: 'View',
      submenu: [
        { label: 'Keep on Top of rekordbox', type: 'checkbox', checked: pinned, accelerator: 'CmdOrCtrl+Shift+T', click: (i) => setPinned(i.checked) },
        { type: 'separator' },
        { label: 'Side Panel', type: 'radio', checked: mode === 'panel', accelerator: 'CmdOrCtrl+1', click: () => win?.webContents.send('set-mode', 'panel') },
        { label: 'Practice Decks', type: 'radio', checked: mode === 'practice', accelerator: 'CmdOrCtrl+2', click: () => win?.webContents.send('set-mode', 'practice') },
        { label: 'Mini Beatmatch', type: 'radio', checked: mode === 'mini', accelerator: 'CmdOrCtrl+3', click: () => win?.webContents.send('set-mode', 'mini') },
        { label: 'Dock to Right Edge', accelerator: 'CmdOrCtrl+Shift+D', click: () => win?.setBounds(boundsFor(mode), true) },
        { type: 'separator' },
        { role: 'reload' }, { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
  ]));
}

// ---------- IPC (only from our own page) ----------
const fromUs = (e) => e.senderFrame?.url?.startsWith(ORIGIN);
ipcMain.handle('pin', (e, v) => (fromUs(e) ? setPinned(v) : pinned));
ipcMain.handle('get-pin', () => pinned);
ipcMain.handle('mode', (e, m) => { if (fromUs(e)) setMode(m); return mode; });
// mini view: the page asks for the height its content needs
ipcMain.handle('fit-height', (e, h) => {
  if (!fromUs(e) || mode !== 'mini' || !win) return;
  const [w] = win.getContentSize();
  win.setContentSize(w, Math.max(140, Math.min(700, Math.round(Number(h) || 0))), true);
});
ipcMain.handle('helper-status', () => helperStatus);

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

app.whenReady().then(async () => {
  // Web MIDI for the controller, and video-only capture (the rekordbox window) for the beat view.
  const allowed = (perm, url, media) => perm === 'midi'
    || ((perm === 'display-capture' || perm === 'media') && String(url).startsWith(ORIGIN) && (media || ['video']).every((t) => t === 'video'));
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => { if (process.env.CUECOACH_DEBUG) console.log('perm request', perm, JSON.stringify(details)); cb(allowed(perm, details.requestingUrl || wc.getURL(), details.mediaTypes)); });
  session.defaultSession.setPermissionCheckHandler((wc, perm, origin, details) => { if (process.env.CUECOACH_DEBUG) console.log('perm check', perm, origin, JSON.stringify(details)); return allowed(perm, origin || wc?.getURL(), null); });
  try { await startServer(); } catch (err) { console.error('Cannot serve Cue Coach:', err.message); app.quit(); return; }
  startHelper();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { stopHelper(); server?.close(); });
