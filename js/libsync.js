// Keeps the Learn window and the library manager window in step.
// Both pages share one origin, so they share localStorage (hot cues, cue points, sets) and IndexedDB
// (folder access, analysis cache). Changes to localStorage reach the other window as `storage` events;
// everything else (beat grids, My library edits, "load this on deck A") goes over a BroadcastChannel.

const PREFIX = 'learn.';
export const shared = {
  get: (k, d) => { try { const v = localStorage.getItem(PREFIX + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

/** Call fn(value) when another window changes one of these shared keys. */
export function onShared(keys, fn) {
  const want = new Set(keys.map((k) => PREFIX + k));
  window.addEventListener('storage', (e) => {
    if (!e.key || !want.has(e.key)) return;
    let v = null; try { v = e.newValue == null ? null : JSON.parse(e.newValue); } catch { /* ignore */ }
    fn(e.key.slice(PREFIX.length), v);
  });
}

const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('cuecoach-library') : null;
/**
 * Messages:
 *   { type: 'analysis', id, grid, bpm, phrases }  a beat grid was edited
 *   { type: 'library' }                            My library changed (details, crates, tracks)
 *   { type: 'load', id, side }                     load this track on a deck in the Learn window
 *   { type: 'source', kind }                       the manager switched music source
 */
export const send = (msg) => { try { channel?.postMessage(msg); } catch { /* closed */ } };
export const onMessage = (fn) => channel?.addEventListener('message', (e) => fn(e.data || {}));

/** Open the library manager in its own window (desktop app) or a browser popup. */
export function openManager() {
  if (window.cueDesktop?.openLibraryManager) return window.cueDesktop.openLibraryManager();
  const w = Math.min(1320, screen.availWidth - 40), h = Math.min(860, screen.availHeight - 40);
  const win = window.open('library.html', 'cuecoach-library', `popup,width=${w},height=${h}`);
  win?.focus();
}
