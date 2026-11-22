// Library manager: the pure part (no DOM, no audio), so it can be unit-tested.
// Sorting and filtering the track table, beat grid edits, hot cues and memory cues, and set lists.
// Every function returns new data and leaves what it was given untouched.
import { friendlyMatch } from './musiclib.js';
import { energyOf } from './energy.js';
import { keyRelation } from './library.js';
import { gridUnsure } from './beatgrid.js';
import { NEW_SET_TITLE, PLAYED_SHARE } from './setbuilder.js';

// ---------- the track table ----------
export const COLUMNS = [
  { id: 'title', label: 'Title', get: (t) => (t.title || '').toLowerCase() },
  { id: 'artist', label: 'Artist', get: (t) => (t.artist || '').toLowerCase() },
  { id: 'bpm', label: 'BPM', get: (t) => t.bpm ?? null, num: true },
  { id: 'key', label: 'Key', get: (t) => camelotOrder(t.camelot), num: true },
  { id: 'energy', label: 'Energy', get: (t) => energyOf(t), num: true },
  { id: 'time', label: 'Time', get: (t) => t.duration || null, num: true },
  { id: 'genre', label: 'Genre', get: (t) => (t.genre || '').toLowerCase() },
  { id: 'cues', label: 'Cues', get: (t, x) => x?.cueCount?.(t) ?? 0, num: true },
  { id: 'grid', label: 'Grid', get: (t) => GRID_ORDER[gridStatus(t)], num: true },
  { id: 'added', label: 'Added', get: (t) => t.addedAt || '' },
];

/** 8A sorts before 8B, and 1A..12B in wheel order; unknown keys last. */
function camelotOrder(c) {
  const m = /^(\d{1,2})([AB])$/.exec(c || '');
  return m ? Number(m[1]) * 2 + (m[2] === 'B' ? 1 : 0) : null;
}

/** Sort by a column; empty values always go last. `extra` gives columns like Cues what they need. */
export function sortTracks(tracks, colId, dir = 1, extra = null) {
  const col = COLUMNS.find((c) => c.id === colId);
  if (!col) return tracks;
  const withVal = tracks.map((t, i) => ({ t, i, v: col.get(t, extra) }));
  const empty = (v) => v == null || v === '';
  withVal.sort((a, b) => {
    if (empty(a.v) || empty(b.v)) return (empty(a.v) ? 1 : 0) - (empty(b.v) ? 1 : 0) || a.i - b.i;
    const c = col.num ? a.v - b.v : String(a.v).localeCompare(String(b.v));
    return c * dir || a.i - b.i;
  });
  return withVal.map((x) => x.t);
}

/**
 * Search words must all appear (title, artist, genre, key). Optional filters: a BPM range, energy range,
 * and keys that mix with `matchKey` (same, ±1, relative).
 */
export function filterTracks(tracks, { query = '', bpmMin = null, bpmMax = null, matchKey = null, gridTodo = false } = {}) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  return tracks.filter((t) => {
    if (words.length) {
      const hay = `${t.title} ${t.artist} ${t.genre} ${t.camelot || ''}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    if (bpmMin != null && !(t.bpm >= bpmMin)) return false;
    if (bpmMax != null && !(t.bpm <= bpmMax)) return false;
    if (matchKey && !(t.camelot && keyRelation(matchKey, t.camelot).score >= 0.85)) return false;
    if (gridTodo && !['unsure', 'none', 'approx'].includes(gridStatus(t))) return false;
    return true;
  });
}

// ---------- beat grids ----------
const GRID_ORDER = { adjusted: 0, ok: 1, unsure: 2, approx: 3, none: 4 };
export const GRID_LABEL = {
  adjusted: 'Checked by you', ok: 'Analysed', unsure: 'Worth checking', approx: 'From tags only', none: 'Not analysed yet',
};
export function gridStatus(t) {
  const g = t?.grid;
  if (!g || !g.bpm) return 'none';
  if (g.adjusted) return 'adjusted';
  if (g.approx || !t.analysed) return 'approx';
  if (gridUnsure(g)) return 'unsure';
  return 'ok';
}

const beatOf = (g) => 60 / g.bpm;
const round3 = (x) => Math.round(x * 1000) / 1000;
const edited = (g, change) => ({ ...g, ...change, adjusted: true, approx: false });

/** This spot is a "1": the grid and the bars start here. */
export function gridSetOne(g, t) {
  const at = round3(Math.max(0, t));
  return edited(g, { firstDownbeat: at, oneBase: at });
}

/** Slide the whole grid by `dt` seconds (keeps it from going before the start). */
export function gridNudge(g, dt) {
  const bar = 4 * beatOf(g);
  let fd = g.firstDownbeat + dt, base = (g.oneBase ?? g.firstDownbeat) + dt;
  if (fd < 0) { fd += bar; base += bar; }
  return edited(g, { firstDownbeat: round3(fd), oneBase: round3(base) });
}

/** The grid is right but the bar starts on the wrong beat: move the "1" one beat later, within the bar. */
export function gridShiftBeat(g) {
  const beat = beatOf(g), bar = 4 * beat, base = g.oneBase ?? g.firstDownbeat;
  const fd = base + ((((g.firstDownbeat - base + beat) % bar) + bar) % bar);
  return edited(g, { firstDownbeat: round3(fd), oneBase: base });
}

/** A new tempo, keeping the "1" where it is. Out-of-range tempos are refused (null). */
export function gridSetBpm(g, bpm) {
  if (!(bpm >= 40 && bpm <= 250)) return null;
  return edited(g, { bpm: Math.round(bpm * 100) / 100 });
}

/** Tempo from tap times (ms). Needs 4 taps; a gap over 2 s starts again. Returns { bpm, taps }. */
export function tapTempo(taps, now) {
  const tp = taps.length && now - taps[taps.length - 1] > 2000 ? [] : [...taps];
  tp.push(now);
  while (tp.length > 12) tp.shift();
  if (tp.length < 4) return { bpm: null, taps: tp, more: 4 - tp.length };
  const bpm = 60000 / ((tp[tp.length - 1] - tp[0]) / (tp.length - 1));
  return { bpm: Math.round(bpm * 10) / 10, taps: tp, more: 0 };
}

/** The nearest beat to `t` (or `t` itself without a grid). */
export function snapTime(g, t) {
  if (!g?.bpm) return t;
  const b = beatOf(g);
  return round3(g.firstDownbeat + Math.round((t - g.firstDownbeat) / b) * b);
}

/** Beats between t0 and t1: [{ time, bar (1-based, may be ≤ 0 before the first downbeat), beat (1..4) }]. */
export function beatsBetween(g, t0, t1) {
  if (!g?.bpm) return [];
  const b = beatOf(g), out = [];
  for (let n = Math.ceil((t0 - g.firstDownbeat) / b); ; n++) {
    const time = g.firstDownbeat + n * b;
    if (time > t1) break;
    if (out.length > 4000) break;
    out.push({ time, bar: Math.floor(n / 4) + 1, beat: (((n % 4) + 4) % 4) + 1 });
  }
  return out;
}

// ---------- cues ----------
// Hot cues live in the Learn app's store as times per slot (false = cleared on purpose, so rekordbox's own
// hot cue there stays hidden). Names and memory cues are kept beside them by the library manager.
export const HOT_CUES = 8;
export const CUE_COLORS = ['#ef4f5c', '#22b573', '#f0a020', '#8b6cf6'];
export const cueColor = (i) => CUE_COLORS[i % CUE_COLORS.length];

/** The 8 hot cue times for a track: your own first, then rekordbox's. Same rule as the decks. */
export function hotCues(t, own = []) {
  return Array.from({ length: HOT_CUES }, (_, i) => (own[i] === false ? null : own[i] ?? (t?.cues || []).find((c) => c.num === i && !c.loop)?.time ?? null));
}
export function setHotCue(own = [], i, time) {
  const out = [...own]; out[i] = round3(Math.max(0, time)); return out;
}
export function clearHotCue(own = [], i) {
  const out = [...own]; out[i] = false; return out;
}

/** Memory cues: sorted by time, one per spot (within 50 ms). Includes rekordbox's memory cues (read-only). */
export function addMemoryCue(list = [], time, name = '') {
  const t = round3(Math.max(0, time));
  if (list.some((c) => Math.abs(c.time - t) < 0.05)) return list;
  return [...list, { time: t, name: String(name).slice(0, 40) }].sort((a, b) => a.time - b.time);
}
export const removeMemoryCue = (list = [], time) => list.filter((c) => Math.abs(c.time - time) >= 0.001);
export const renameMemoryCue = (list = [], time, name) => list.map((c) => (Math.abs(c.time - time) < 0.001 ? { ...c, name: String(name).slice(0, 40) } : c));
export function memoryCues(t, own = []) {
  const rb = (t?.cues || []).filter((c) => c.num < 0 && !c.loop).map((c) => ({ time: c.time, name: c.comment || '', fixed: true }));
  return [...own, ...rb].sort((a, b) => a.time - b.time);
}

// ---------- set lists ----------
// Set lists are the Learn app's saved sets: [{ id, title, savedAt, count, set: { title, story, ai, items } }],
// so a set built here is in the Set panel's "My sets", and the other way round.

/** How well track b follows track a, for the chip between two rows. */
export function transition(a, b) {
  if (!a || !b) return null;
  const m = friendlyMatch(a, b);
  const k = a.camelot && b.camelot ? keyRelation(a.camelot, b.camelot) : null;
  const d = a.bpm && b.bpm ? Math.round((b.bpm - a.bpm) * 10) / 10 : null;
  const de = energyOf(b) != null && energyOf(a) != null ? energyOf(b) - energyOf(a) : null;
  return {
    level: m.level, label: m.label, why: m.why,
    key: k ? `${a.camelot} → ${b.camelot}` : '',
    bpm: d == null ? '' : d === 0 ? 'same BPM' : `${d > 0 ? '+' : '−'}${Math.abs(d)} BPM`,
    energy: de == null ? 0 : Math.sign(de),
  };
}

/** Length (played share of each track), BPM range and how many transitions are tricky. */
export function setStats(tracks) {
  const bpms = tracks.map((t) => t.bpm).filter(Boolean);
  let tricky = 0;
  for (let i = 1; i < tracks.length; i++) if (transition(tracks[i - 1], tracks[i])?.level === 'tricky') tricky++;
  return {
    count: tracks.length,
    minutes: Math.round(tracks.reduce((m, t) => m + (t.duration > 0 ? t.duration / 60 : 5) * PLAYED_SHARE, 0)),
    fullMinutes: Math.round(tracks.reduce((m, t) => m + (t.duration > 0 ? t.duration / 60 : 0), 0)),
    bpmMin: bpms.length ? Math.min(...bpms) : null, bpmMax: bpms.length ? Math.max(...bpms) : null,
    tricky,
  };
}

const entry = (id, title, items, now, extra = {}) => ({
  id, title, savedAt: now, count: items.length,
  set: { title, story: extra.story || '', ai: !!extra.ai, items, savedId: id, played: [] },
});
const item = (id) => ({ id, why: '', tip: '', vote: 0 });
const cleanTitle = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);

/** A new set list at the top of the list, with these tracks. Returns { list, id }. */
export function newSetList(list = [], title = NEW_SET_TITLE, trackIds = [], now = Date.now()) {
  const id = `set-${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const t = uniqueTitle(list, cleanTitle(title) || NEW_SET_TITLE);
  const ids = [...new Set(trackIds)];
  return { list: [entry(id, t, ids.map(item), now), ...list], id };
}
function uniqueTitle(list, wanted, exceptId = null) {
  const taken = new Set(list.filter((x) => x.id !== exceptId).map((x) => x.title.toLowerCase()));
  if (!taken.has(wanted.toLowerCase())) return wanted;
  for (let i = 2; ; i++) if (!taken.has(`${wanted} ${i}`.toLowerCase())) return `${wanted} ${i}`;
}

/** Change one set list's items (fn: items → items) in place, keeping its spot in the list. */
export function editSetList(list = [], id, fn, now = Date.now()) {
  return list.map((x) => {
    if (x.id !== id) return x;
    const items = fn(x.set.items || []);
    return { ...x, savedAt: now, count: items.length, set: { ...x.set, items } };
  });
}
export const renameSetList = (list = [], id, title) => {
  const t = cleanTitle(title);
  if (!t) return list;
  return list.map((x) => (x.id === id ? { ...x, title: uniqueTitle(list, t, id), set: { ...x.set, title: uniqueTitle(list, t, id) } } : x));
};
export const deleteSetList = (list = [], id) => list.filter((x) => x.id !== id);
export function duplicateSetList(list = [], id, now = Date.now()) {
  const src = list.find((x) => x.id === id);
  if (!src) return { list, id: null };
  const r = newSetList(list, `${src.title} copy`, [], now);
  return { list: editSetList(r.list, r.id, () => src.set.items.map((i) => ({ ...i })), now), id: r.id };
}

/** Add tracks to the end (once each). */
export const addItems = (items, ids) => {
  const have = new Set(items.map((i) => i.id));
  return [...items, ...ids.filter((id) => !have.has(id) && have.add(id)).map(item)];
};
export const removeItems = (items, ids) => { const gone = new Set(ids); return items.filter((i) => !gone.has(i.id)); };
/** Move the items with these ids so they start at index `to` (in the list without them). */
export function moveItems(items, ids, to) {
  const moving = new Set(ids);
  const picked = items.filter((i) => moving.has(i.id)), rest = items.filter((i) => !moving.has(i.id));
  const at = Math.max(0, Math.min(rest.length, to));
  return [...rest.slice(0, at), ...picked, ...rest.slice(at)];
}

/** An .m3u8 playlist other DJ software can open. Tracks without a real file path are left out. */
export function toM3U(title, tracks) {
  const lines = ['#EXTM3U', `#PLAYLIST:${title}`];
  for (const t of tracks) {
    const p = t.path || '';
    if (!p) continue;
    lines.push(`#EXTINF:${Math.round(t.duration || -1)},${t.artist ? `${t.artist} - ` : ''}${t.title}`, p);
  }
  return `${lines.join('\n')}\n`;
}

/** "5:07" */
export const fmtDur = (s) => (s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '–');
/** "1:02.35" for cue times */
export function fmtCue(s) {
  if (s == null) return '–';
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r.toFixed(2).padStart(5, '0')}`;
}
