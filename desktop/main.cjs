// Cue Coach desktop: an always-on-top side panel next to rekordbox.
// - serves the web app on 127.0.0.1:8642 (only index.html and js/)
// - starts the rekordbox helper (helper/rekordbox_helper.py) and stops it on quit
// - docks a 420 px window to the right edge of the screen, floating over rekordbox
const { app, BrowserWindow, Menu, ipcMain, screen, session, shell } = require('electron');
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
  mode = m === 'practice' ? 'practice' : 'panel';
  if (win) win.setBounds(boundsFor(mode), true);
  buildMenu();
}

function createWindow() {
  win = new BrowserWindow({
    ...boundsFor('panel'),
    minWidth: 340, minHeight: 480,
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
ipcMain.handle('helper-status', () => helperStatus);

app.whenReady().then(async () => {
  // Web MIDI for the controller; nothing else.
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'midi'));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'midi');
  try { await startServer(); } catch (err) { console.error('Cannot serve Cue Coach:', err.message); app.quit(); return; }
  startHelper();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { stopHelper(); server?.close(); });
