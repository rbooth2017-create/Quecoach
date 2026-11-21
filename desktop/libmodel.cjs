// My library: the pure part (no Electron, no file system), so it can be unit-tested.
// The library is one JSON object: { version, tracks: [record], crates: [{ id, name, trackIds, wanted? }] }.
// Crates are playlists: a track can be in several, and deleting a crate never deletes music.
// `wanted` lists tracks from an imported Spotify or Apple Music playlist that aren't in the library yet.
// Every function returns a new library object and leaves the one passed in untouched.

const VERSION = 1;
const emptyLibrary = () => ({ version: VERSION, tracks: [], crates: [] });

/** A library read from disk, with anything missing or malformed filled in. */
function normalise(lib) {
  const l = lib && typeof lib === 'object' ? lib : {};
  return {
    version: VERSION,
    tracks: Array.isArray(l.tracks) ? l.tracks.filter((t) => t && t.id && t.file) : [],
    crates: Array.isArray(l.crates) ? l.crates.filter((c) => c && c.id).map((c) => withWanted({ id: c.id, name: String(c.name || 'Crate'), trackIds: Array.isArray(c.trackIds) ? c.trackIds : [] }, c.wanted)) : [],
  };
}

// ---------- file names (valid on macOS, Windows and Linux) ----------
const AUDIO_EXT = /(\.(mp3|m4a|aac|mp4|wav|aif|aiff|flac|ogg|oga|opus|alac))$/i;
const isAudioName = (name) => AUDIO_EXT.test(String(name)) && !String(name).split(/[\\/]/).pop().startsWith('.');
const WIN_RESERVED =/^(con|prn|aux|nul|com\d|lpt\d)$/i;
const MAX_NAME = 120;

/** "AC/DC: Live?" → "AC-DC- Live". Never empty, never a reserved Windows name, never ends in a dot or space. */
function safeFileName(name) {
  let s = String(name || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  let ext = '';
  const m = s.match(AUDIO_EXT);
  if (m) { ext = m[1].toLowerCase(); s = s.slice(0, -ext.length); }
  s = s.replace(/^[. ]+/, '');
  s = s.replace(/[. ]+$/, '');
  if (!s) s = 'Track';
  if (WIN_RESERVED.test(s)) s = `${s}_`;
  if (s.length + ext.length > MAX_NAME) s = s.slice(0, MAX_NAME - ext.length).replace(/[. ]+$/, '');
  return s + ext;
}

/** A name not in `taken` (compared ignoring case, like Windows and macOS do): "Song.mp3", "Song (2).mp3", ... */
function uniqueFileName(name, taken) {
  const lower = new Set([...taken].map((n) => String(n).toLowerCase()));
  const safe = safeFileName(name);
  if (!lower.has(safe.toLowerCase())) return safe;
  const dot = safe.lastIndexOf('.');
  const base = dot > 0 ? safe.slice(0, dot) : safe, ext = dot > 0 ? safe.slice(dot) : '';
  for (let i = 2; ; i++) {
    const n = `${base} (${i})${ext}`;
    if (!lower.has(n.toLowerCase())) return n;
  }
}

/** "03 - Kora Vale - Night Drive.mp3" → { artist, title } (same rules as musiclib.js parseFileName). */
function parseFileName(name) {
  let s = String(name).replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  s = s.replace(/^\d{1,3}\s*[-.)]\s*/, '');
  const parts = s.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  return { artist: '', title: s };
}

/** The file name a new track gets in the library folder: "Artist - Title.ext". */
function libraryFileName(rec, originalName) {
  const ext = (String(originalName).match(AUDIO_EXT) || ['.mp3'])[0].toLowerCase();
  const stem = rec.artist ? `${rec.artist} - ${rec.title}` : rec.title || String(originalName).replace(/\.[^.]+$/, '');
  return safeFileName(stem + ext);
}

// ---------- track records ----------
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
const str = (v) => (v == null ? '' : String(v).trim());

/**
 * A library record for an imported file. `meta` is what the source already knew (from the Learn app:
 * title, artist, key, bpm, grid, phrases, cues, duration); it wins over the file's tags, which win over
 * the file name. Beat grids, phrases and cues come only from `meta`.
 */
function recordFrom({ id, file, size, sha1, originalName, addedAt, origin = '' }, tags = {}, meta = {}) {
  const fromName = parseFileName(originalName || file || '');
  const m = meta || {}, t = tags || {};
  return {
    id, file, size, sha1,
    title: str(m.title) || str(t.title) || fromName.title || 'Untitled',
    artist: str(m.artist) || str(t.artist) || fromName.artist,
    genre: str(m.genre) || str(t.genre),
    key: str(m.key) || str(t.key),
    bpm: num(m.bpm) ?? num(t.bpm),
    energy: num(m.energy) ?? num(t.energy),
    duration: num(m.duration) || 0,
    grid: m.grid && typeof m.grid === 'object' && num(m.grid.bpm) ? m.grid : null,
    phrases: Array.isArray(m.phrases) ? m.phrases : [],
    cues: Array.isArray(m.cues) ? m.cues : [],
    addedAt: addedAt || new Date().toISOString(),
    origin: str(origin),
  };
}

function findDuplicate(lib, sha1, size) {
  return lib.tracks.find((t) => t.sha1 === sha1 && t.size === size) || null;
}

const addTrack = (lib, rec) => ({ ...lib, tracks: [...lib.tracks, rec] });

/** Save a beat grid, length and phrases worked out by the Learn app. */
function updateAnalysis(lib, id, { grid, duration, phrases } = {}) {
  return {
    ...lib,
    tracks: lib.tracks.map((t) => (t.id !== id ? t : {
      ...t,
      ...(grid && typeof grid === 'object' ? { grid, bpm: num(grid.bpm) ?? t.bpm } : {}),
      ...(num(duration) ? { duration: Number(duration) } : {}),
      ...(Array.isArray(phrases) ? { phrases } : {}),
    })),
  };
}

/** Take tracks out of the library and out of every crate. */
function removeTracks(lib, ids) {
  const gone = new Set(ids);
  return {
    ...lib,
    tracks: lib.tracks.filter((t) => !gone.has(t.id)),
    crates: lib.crates.map((c) => ({ ...c, trackIds: c.trackIds.filter((id) => !gone.has(id)) })),
  };
}

// ---------- crates ----------
const cleanName = (name) => String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80);

function uniqueCrateName(lib, wanted, exceptId = null) {
  const taken = new Set(lib.crates.filter((c) => c.id !== exceptId).map((c) => c.name.toLowerCase()));
  if (!taken.has(wanted.toLowerCase())) return wanted;
  for (let i = 2; ; i++) if (!taken.has(`${wanted} ${i}`.toLowerCase())) return `${wanted} ${i}`;
}

// ---------- tracks still to get (from an imported playlist) ----------
const MAX_WANTED = 5000;
const short = (v, n = 300) => str(v).slice(0, n);
/** Only the fields we know, trimmed; items without a title are dropped. */
function cleanWanted(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const it of items.slice(0, MAX_WANTED)) {
    if (!it || typeof it !== 'object' || !short(it.title)) continue;
    const w = { title: short(it.title), artist: short(it.artist) };
    for (const k of ['album', 'isrc', 'spotify']) if (short(it[k], 200)) w[k] = short(it[k], 200);
    if (num(it.duration)) w.duration = Math.round(num(it.duration));
    out.push(w);
  }
  return out;
}
/** The crate with its `wanted` list, which is left off when empty. */
function withWanted(crate, items) {
  const { wanted: _old, ...rest } = crate;
  const w = cleanWanted(items);
  return w.length ? { ...rest, wanted: w } : rest;
}
/** Replace a crate's list of tracks still to get. */
function setWanted(lib, id, items) {
  return { ...lib, crates: lib.crates.map((c) => (c.id === id ? withWanted(c, items) : c)) };
}

function createCrate(lib, id, name = 'New crate', wanted = []) {
  const crate = withWanted({ id, name: uniqueCrateName(lib, cleanName(name) || 'New crate'), trackIds: [] }, wanted);
  return { lib: { ...lib, crates: [...lib.crates, crate] }, crate };
}

/** Rename a crate. An empty name is refused (the library comes back unchanged). */
function renameCrate(lib, id, name) {
  const n = cleanName(name);
  if (!n) return lib;
  return { ...lib, crates: lib.crates.map((c) => (c.id === id ? { ...c, name: uniqueCrateName(lib, n, id) } : c)) };
}

const deleteCrate = (lib, id) => ({ ...lib, crates: lib.crates.filter((c) => c.id !== id) });

/** Add tracks to a crate, in order, once each. Ids that aren't in the library are ignored. */
function addToCrate(lib, id, trackIds) {
  const known = new Set(lib.tracks.map((t) => t.id));
  return {
    ...lib,
    crates: lib.crates.map((c) => {
      if (c.id !== id) return c;
      const have = new Set(c.trackIds), add = [];
      for (const t of trackIds) if (known.has(t) && !have.has(t)) { have.add(t); add.push(t); }
      return { ...c, trackIds: [...c.trackIds, ...add] };
    }),
  };
}

function removeFromCrate(lib, id, trackIds) {
  const gone = new Set(trackIds);
  return { ...lib, crates: lib.crates.map((c) => (c.id === id ? { ...c, trackIds: c.trackIds.filter((t) => !gone.has(t)) } : c)) };
}

module.exports = {
  VERSION, emptyLibrary, normalise, AUDIO_EXT, isAudioName,
  safeFileName, uniqueFileName, parseFileName, libraryFileName,
  recordFrom, findDuplicate, addTrack, updateAnalysis, removeTracks,
  createCrate, renameCrate, deleteCrate, addToCrate, removeFromCrate,
  cleanWanted, setWanted,
};
