// Music library for the Learn app: a music folder, the rekordbox library (via the helper), or practice tracks.
// The pure helpers at the top are unit-tested in Node; the browser parts (folders, IndexedDB, fetch) are below.
import { toCamelot, demoLibrary } from './library.js';
import { scoreCandidate } from './engine.js';
import { readTags, TAG_BYTES } from './tags.js';

export const AUDIO_EXT = /\.(mp3|m4a|aac|mp4|wav|aif|aiff|flac|ogg|oga|opus)$/i;
export const isAudioFile = (name) => AUDIO_EXT.test(name) && !name.startsWith('._');

/** "03 - Kora Vale - Night Drive (Extended Mix).mp3" → { artist: 'Kora Vale', title: 'Night Drive (Extended Mix)' } */
export function parseFileName(name) {
  let s = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  s = s.replace(/^\d{1,3}\s*[-.)]\s*/, ''); // leading track number
  const parts = s.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  return { artist: '', title: s };
}

/** A library track from a file in a music folder, its tags, and any cached analysis. */
export function trackFromFile({ name, relPath, size, lastModified }, tags = {}, analysis = null) {
  const fromName = parseFileName(name);
  const bpm = analysis?.grid?.bpm || tags.bpm || null;
  return {
    id: `file:${relPath}`,
    source: 'folder',
    relPath, fileName: name, size, lastModified,
    title: tags.title || fromName.title,
    artist: tags.artist || fromName.artist,
    genre: tags.genre || '',
    bpm: bpm ? Math.round(bpm * 100) / 100 : null,
    key: tags.key || '',
    camelot: toCamelot(tags.key),
    energy: tags.energy ?? null,
    duration: analysis?.duration || 0,
    rating: 0,
    grid: analysis?.grid || (tags.bpm ? { bpm: tags.bpm, firstDownbeat: 0, approx: true } : null),
    analysed: !!analysis?.grid,
    cues: [],
  };
}

/** Identifies one version of one file, so edited files get analysed again. */
export const cacheKey = (t) => `${t.relPath}|${t.size}|${t.lastModified}`;

/** Every search word must appear in the title, artist, genre or key. */
export function searchTracks(tracks, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return tracks;
  return tracks.filter((t) => {
    const hay = `${t.title} ${t.artist} ${t.genre} ${t.camelot || ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Beginner-friendly verdict on mixing `cand` after `current`. */
export function friendlyMatch(current, cand) {
  if (!current || !cand) return null;
  const s = scoreCandidate(current, cand);
  const why = [];
  const k = s.key.label;
  if (k === 'key unknown') why.push('Key unknown');
  else if (k === 'same key') why.push('Same key, blends smoothly');
  else if (k.startsWith('+1') || k.startsWith('−1')) why.push('Neighbouring key, blends well');
  else if (k.startsWith('relative')) why.push('Same key family');
  else if (k === 'key clash') why.push('Keys may clash');
  else why.push('Key change adds a lift');
  const p = s.pitch.pct;
  if (p == null) why.push('Speed unknown');
  else if (Math.abs(p) <= 2) why.push('Close in speed');
  else if (Math.abs(p) <= 6) why.push(`Needs ${p > 0 ? 'speeding up' : 'slowing down'} ${Math.abs(p).toFixed(1)}%`);
  else why.push('Very different speed');
  const level = s.score >= 0.75 ? 'great' : s.score >= 0.55 ? 'good' : 'tricky';
  return { level, label: { great: 'Great match', good: 'Good match', tricky: 'Tricky' }[level], why, score: s.score, pitch: s.pitch };
}

/** Rank the library for "what next?", best first. */
export function rankNext(current, tracks, { exclude = [], limit = 20 } = {}) {
  const skip = new Set(exclude);
  return tracks
    .filter((t) => t.id !== current.id && !skip.has(t.id) && t.bpm)
    .map((t) => ({ track: t, match: friendlyMatch(current, t) }))
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, limit);
}

/** Colour for a Camelot key: neighbours on the wheel get neighbouring hues, so matching keys look alike. */
export function keyHue(camelot) {
  const n = parseInt(camelot, 10);
  return Number.isFinite(n) ? ((n - 1) * 30 + 200) % 360 : null;
}

export const practiceLibrary = () => demoLibrary(24).map((t) => ({ ...t, source: 'practice', analysed: true }));

// ---------- browser: IndexedDB ----------
const DB_NAME = 'cuecoach-learn';
let dbp = null;
function db() {
  dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('kv'); req.result.createObjectStore('analysis'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function idb(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode), req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}
export const kvGet = (k) => idb('kv', 'readonly', (s) => s.get(k)).catch(() => undefined);
export const kvSet = (k, v) => idb('kv', 'readwrite', (s) => s.put(v, k)).catch(() => undefined);
const anaGet = (k) => idb('analysis', 'readonly', (s) => s.get(k)).catch(() => undefined);
const anaSet = (k, v) => idb('analysis', 'readwrite', (s) => s.put(v, k)).catch(() => undefined);

// ---------- browser: music folder ----------
export const canPickFolder = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/** Ask for a music folder and remember it for next time. */
export async function pickFolder() {
  const handle = await window.showDirectoryPicker({ id: 'music', mode: 'read', startIn: 'music' });
  await kvSet('folder', handle);
  return handle;
}

/** The folder chosen last time, and whether we may still read it ('granted' or 'prompt'). */
export async function savedFolder() {
  const handle = await kvGet('folder');
  if (!handle?.queryPermission) return null;
  return { handle, permission: await handle.queryPermission({ mode: 'read' }) };
}

async function* walk(dir, prefix = '') {
  for await (const entry of dir.values()) {
    if (entry.name.startsWith('.')) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') yield* walk(entry, rel);
    else if (isAudioFile(entry.name)) yield { handle: entry, relPath: rel };
  }
}

/**
 * Read every audio file's tags. Calls onProgress(found) as it goes. Returns tracks; each keeps a
 * non-enumerable `file()` that returns its File for playback and analysis.
 */
export async function scanFolder(dir, onProgress = () => {}) {
  const tracks = [];
  for await (const { handle, relPath } of walk(dir)) {
    try {
      const file = await handle.getFile();
      const meta = { name: file.name, relPath, size: file.size, lastModified: file.lastModified };
      const analysis = await anaGet(cacheKey(meta));
      const tags = readTags(await file.slice(0, TAG_BYTES).arrayBuffer());
      const t = trackFromFile(meta, tags, analysis);
      Object.defineProperty(t, 'file', { value: () => handle.getFile(), enumerable: false });
      tracks.push(t);
      if (tracks.length % 25 === 0) onProgress(tracks.length);
    } catch (err) { console.warn('skipped', relPath, err); }
  }
  onProgress(tracks.length);
  return tracks;
}

/** Files picked with <input webkitdirectory> (browsers without folder access). */
export async function tracksFromFileList(files) {
  const tracks = [];
  for (const file of files) {
    if (!isAudioFile(file.name)) continue;
    const relPath = file.webkitRelativePath || file.name;
    const meta = { name: file.name, relPath, size: file.size, lastModified: file.lastModified };
    const tags = readTags(await file.slice(0, TAG_BYTES).arrayBuffer());
    const t = trackFromFile(meta, tags, await anaGet(cacheKey(meta)));
    Object.defineProperty(t, 'file', { value: async () => file, enumerable: false });
    tracks.push(t);
  }
  return tracks;
}

/**
 * Analyse tracks one at a time in the background (beat grid and length), caching the result.
 * decode(arrayBuffer) → AudioBuffer and estimate(AudioBuffer) → grid are passed in from audio.js.
 */
export async function analyseInBackground(tracks, { decode, estimate, onTrack = () => {}, shouldStop = () => false }) {
  for (const t of tracks) {
    if (shouldStop()) return;
    if (t.analysed || !t.file) continue;
    try {
      const buffer = await decode(await (await t.file()).arrayBuffer());
      saveAnalysis(t, buffer, estimate(buffer));
      onTrack(t);
    } catch (err) { t.analyseError = err.message; console.warn('analysis failed', t.relPath, err); }
    await new Promise((r) => setTimeout(r, 30)); // let the UI breathe
  }
}

/** Store a beat grid we worked out (in the background or when the track was loaded on a deck). */
export function saveAnalysis(t, buffer, grid) {
  const g = reconcileBpm(grid, t.bpm && !t.analysed ? t.bpm : null);
  Object.assign(t, { grid: g, bpm: g.bpm, duration: buffer.duration, analysed: true });
  if (t.source === 'folder') anaSet(cacheKey(t), { grid: g, duration: buffer.duration });
  return t;
}

/** The tag BPM is usually right about half/double time; the audio estimate is right about the phase. */
export function reconcileBpm(grid, tagBpm) {
  if (!tagBpm || !grid?.bpm) return grid;
  for (const f of [1, 2, 0.5]) {
    const est = grid.bpm * f;
    if (Math.abs(est - tagBpm) / tagBpm < 0.03) return { ...grid, bpm: Math.round(est * 100) / 100 };
  }
  return grid;
}

// ---------- browser: rekordbox (through the helper) ----------
export const HELPER = 'http://127.0.0.1:8765';

export async function rekordboxAvailable() {
  try { const r = await fetch(`${HELPER}/status`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
}

export async function loadRekordbox() {
  const tracks = await (await fetch(`${HELPER}/library`)).json();
  return tracks.map((t) => ({ ...t, source: 'rekordbox', camelot: toCamelot(t.key), analysed: !t.grid?.approx }));
}

/** Exact beat grid and phrases for one rekordbox track, plus its audio. */
export async function rekordboxDetail(t) {
  if (!t.detailed) {
    const d = await (await fetch(`${HELPER}/track/${encodeURIComponent(t.id)}`)).json();
    Object.assign(t, d, { source: 'rekordbox', camelot: toCamelot(d.key), detailed: true, analysed: !d.grid?.approx });
  }
  const r = await fetch(`${HELPER}/audio/${encodeURIComponent(t.id)}`);
  if (!r.ok) throw new Error(`rekordbox couldn't find the file for "${t.title}"`);
  return r.arrayBuffer();
}
