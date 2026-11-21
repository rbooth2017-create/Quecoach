// Set planning: an energy curve over the length of a set, and a quick built-in set builder that works
// with no AI and no internet. The AI builder (coachai.js) uses the same shapes. DOM-free.
import { friendlyMatch } from './musiclib.js';

export const VIBES = [
  { id: 'warmup', name: 'Warm-up', blurb: 'Start low, build slowly.', curve: [0.25, 0.55] },
  { id: 'peak', name: 'Peak time', blurb: 'High energy all the way.', curve: [0.7, 0.95] },
  { id: 'journey', name: 'Journey', blurb: 'Build up, peak, then bring it down.', curve: [0.35, 0.95, 0.5] },
  { id: 'closing', name: 'Closing', blurb: 'From high back down to a gentle finish.', curve: [0.85, 0.35] },
];

/** Target energy (1–10) at a point 0..1 through the set, following the vibe's curve. */
export function targetEnergy(vibeId, t) {
  return curveEnergy((VIBES.find((v) => v.id === vibeId) || VIBES[2]).curve, t);
}
function curveEnergy(c, t) {
  const x = Math.max(0, Math.min(1, t)) * (c.length - 1);
  const i = Math.min(c.length - 2, Math.floor(x)), f = x - i;
  const v = c[i] + (c[i + 1] - c[i]) * f;
  return Math.round((1 + v * 9) * 10) / 10;
}

const trackMinutes = (t) => (t.duration > 0 ? t.duration / 60 : 5);
/** Tracks usually play for about 3/4 of their length in a mix (you leave during the outro). */
export const PLAYED_SHARE = 0.75;

/**
 * Quick set: start from `first` (or the best opener for the vibe), then repeatedly take the best-mixing
 * track whose energy is closest to the curve. Returns [{ track, why, energyTarget }].
 */
export function quickSet(library, { minutes = 60, vibe = 'journey', first = null, event = 'club', audience = 'mixed' } = {}) {
  const pool = library.filter((t) => t.bpm && !(t.duration > 0 && t.duration < 60));
  if (!pool.length) return [];
  const P = setProfile({ event, audience, vibe });
  const energy = (t) => t.energy ?? 5;
  const out = [];
  const want0 = P.energy(0);
  let cur = first && pool.find((t) => t.id === first.id) ? first
    : [...pool].sort((a, b) => Math.abs(energy(a) - want0) - Math.abs(energy(b) - want0) || (b.rating || 0) - (a.rating || 0))[0];
  let elapsed = 0;
  const used = new Set();
  out.push({ track: cur, why: first ? 'Your starting track' : 'Opens the set at the right energy', energyTarget: want0 });
  used.add(cur.id); elapsed += trackMinutes(cur) * PLAYED_SHARE;
  while (elapsed < minutes && used.size < pool.length) {
    const want = P.energy(elapsed / minutes);
    let best = null;
    for (const t of pool) {
      if (used.has(t.id)) continue;
      const m = friendlyMatch(cur, t);
      const fit = m.score * P.match - Math.abs(energy(t) - want) * 0.08 + (t.rating || 0) * P.familiar;
      if (!best || fit > best.fit) best = { t, m, fit };
    }
    if (!best) break;
    const dir = energy(best.t) > energy(cur) ? 'lifts the energy' : energy(best.t) < energy(cur) ? 'eases the energy down' : 'holds the energy';
    out.push({ track: best.t, why: `${best.m.why[0]}; ${dir}`, energyTarget: want });
    used.add(best.t.id); elapsed += trackMinutes(best.t) * PLAYED_SHARE; cur = best.t;
  }
  return out;
}

/** Total playing time of a set, in minutes, using the share of each track you'd normally play. */
export const setMinutes = (items) => Math.round(items.reduce((m, i) => m + trackMinutes(i.track) * PLAYED_SHARE, 0));

/** Compact track details for the AI: no file paths, no audio. */
export const slimTrack = (t) => ({ id: t.id, title: t.title, artist: t.artist || '', genre: t.genre || '', bpm: t.bpm ? Math.round(t.bpm * 10) / 10 : null, key: t.camelot || null, energy: t.energy ?? null, minutes: t.duration ? Math.round(t.duration / 6) / 10 : null });

// ---------- the set list: add, remove, reorder, vote, refine without AI ----------
// A saved set is { title, story, ai, items: [{ id, why, tip, vote }], played: [] }. Every function here
// returns a new set and leaves the one it was given alone. vote: 1 = keep it, -1 = swap it out, 0 = no verdict.

export const NEW_SET_TITLE = 'My set';
const item = (id, why = '', tip = '', vote = 0) => ({ id, why, tip, vote });

/** A fresh saved set from builder output ({ title, story, ai, items: [{ track, why, tip }] }). */
export function makeSet({ title = NEW_SET_TITLE, story = '', ai = false, items = [] } = {}) {
  return { title, story, ai: !!ai, items: items.map((i) => item(i.track?.id ?? i.id, i.why || '', i.tip || '', 0)), played: [] };
}

export const inSet = (set, id) => !!set?.items.some((i) => i.id === id);

/** Add a track to the end of the set, starting "My set" if there isn't one. Already there: unchanged. */
export function addToSet(set, id) {
  const s = set || makeSet();
  if (inSet(s, id)) return s;
  return { ...s, items: [...s.items, item(id)] };
}

export function removeFromSet(set, id) {
  if (!set) return set;
  return { ...set, items: set.items.filter((i) => i.id !== id), played: (set.played || []).filter((p) => p !== id) };
}

/** The library's + button: add it, or take it out if it's already in. */
export const toggleInSet = (set, id) => (inSet(set, id) ? removeFromSet(set, id) : addToSet(set, id));

/** Move the item at `from` so it ends up at index `to` (both clamped to the list). */
export function moveInSet(set, from, to) {
  if (!set) return set;
  const n = set.items.length;
  if (from < 0 || from >= n) return set;
  to = Math.max(0, Math.min(n - 1, to));
  if (from === to) return set;
  const items = [...set.items];
  const [x] = items.splice(from, 1);
  items.splice(to, 0, x);
  return { ...set, items };
}

/** Thumbs up (1) or down (-1); pressing the same verdict again clears it (0). */
export function voteInSet(set, id, vote) {
  if (!set) return set;
  const v = vote > 0 ? 1 : vote < 0 ? -1 : 0;
  return { ...set, items: set.items.map((i) => (i.id === id ? { ...i, vote: (i.vote || 0) === v ? 0 : v } : i)) };
}

/**
 * Put an AI (or any) proposal back on the rules: every 👍 track stays exactly where it was, no 👎 track
 * comes back, no track appears twice, and ids that aren't in `known` (the library) are dropped.
 * `proposed` is [{ id, why, tip }] in the order the proposer wants.
 */
export function mergeRefined(set, proposed, known = null) {
  const old = set?.items || [];
  const keeps = new Map(old.map((i, n) => [n, i]).filter(([, i]) => i.vote > 0));
  const keepIds = new Set([...keeps.values()].map((i) => i.id));
  const banned = new Set(old.filter((i) => i.vote < 0).map((i) => i.id));
  const seen = new Set();
  const rest = proposed.filter((p) => p && !keepIds.has(p.id) && !banned.has(p.id) && (!known || known.has(p.id)) && !seen.has(p.id) && seen.add(p.id))
    .map((p) => item(p.id, p.why || '', p.tip || '', 0));
  const items = [];
  const total = rest.length + keeps.size;
  for (let n = 0; items.length < total; n++) {
    if (keeps.has(n)) items.push({ ...keeps.get(n) });
    else if (rest.length) items.push(rest.shift());
    else { // fewer new tracks than gaps: close up, keeping the kept tracks in order
      for (const k of [...keeps.keys()].filter((k) => k > n).sort((a, b) => a - b)) items.push({ ...keeps.get(k) });
      break;
    }
  }
  const ids = new Set(items.map((i) => i.id));
  return { ...set, items, played: (set?.played || []).filter((p) => ids.has(p)) };
}

/**
 * Refine without AI: swap each 👎 track for the library track that best fits its slot (mixes well out of
 * the track before it and into the track after it, and sits near the vibe's energy at that point).
 * Everything else stays put. Returns { set, swapped, dropped } (dropped: 👎 tracks with nothing to swap in).
 */
export function refineSet(library, set, { vibe = 'journey', minutes = 60, from = library, event = 'club', audience = 'mixed' } = {}) {
  if (!set) return { set, swapped: 0, dropped: 0 };
  const byId = new Map(library.map((t) => [t.id, t]));
  const pool = from.filter((t) => t.bpm && !(t.duration > 0 && t.duration < 60));
  const energy = (t) => t.energy ?? 5;
  const used = new Set(set.items.map((i) => i.id)); // never bring back a 👎 track or repeat one
  const items = [];
  let swapped = 0, dropped = 0, elapsed = 0;
  for (let n = 0; n < set.items.length; n++) {
    const it = set.items[n];
    if (it.vote >= 0) {
      items.push(it);
      const t = byId.get(it.id); if (t) elapsed += trackMinutes(t) * PLAYED_SHARE;
      continue;
    }
    const prev = byId.get(items[items.length - 1]?.id);
    const next = set.items.slice(n + 1).map((x) => byId.get(x.id)).find((t, k) => t && set.items[n + 1 + k].vote >= 0);
    const P = setProfile({ event, audience, vibe });
    const want = P.energy(Math.min(1, elapsed / Math.max(1, minutes)));
    let best = null;
    for (const t of pool) {
      if (used.has(t.id)) continue;
      const a = prev ? friendlyMatch(prev, t) : null, b = next ? friendlyMatch(t, next) : null;
      const fit = ((a ? a.score : 0.5) + (b ? b.score : 0.5) * 0.6) * P.match - Math.abs(energy(t) - want) * 0.08 + (t.rating || 0) * P.familiar;
      if (!best || fit > best.fit) best = { t, a, fit };
    }
    if (!best) { dropped++; continue; }
    used.add(best.t.id); swapped++;
    items.push(item(best.t.id, best.a ? `Swapped in: ${best.a.why[0].toLowerCase()}` : 'Swapped in: opens at the right energy', '', 0));
    elapsed += trackMinutes(best.t) * PLAYED_SHARE;
  }
  const ids = new Set(items.map((i) => i.id));
  return { set: { ...set, items, played: (set.played || []).filter((p) => ids.has(p)) }, swapped, dropped };
}

// ---------- where a set is built from: the whole library, a crate, or one folder ----------

/** The folder a track's file sits in ('' when it has no file path, e.g. practice tracks). */
export function trackFolder(t) {
  const p = String(t.relPath || t.path || '').replace(/\\/g, '/');
  const i = p.lastIndexOf('/');
  return i > 0 ? p.slice(0, i) : '';
}

/** A short, readable folder name: the last two parts of the path. */
const folderName = (dir) => dir.split('/').filter(Boolean).slice(-2).join(' / ') || dir;

/**
 * The choices for "Build from": All music first, then each crate, then each folder that holds tracks
 * (only when there's more than one folder). Each choice is { id, name, count, kind }.
 */
export function setSources(tracks, crates = []) {
  const out = [{ id: 'all', name: 'All music', count: tracks.length, kind: 'all' }];
  const byLib = new Set(tracks.map((t) => t.libId).filter(Boolean));
  for (const c of crates) {
    const count = c.trackIds.filter((id) => byLib.has(id)).length;
    out.push({ id: `crate:${c.id}`, name: c.name, count, kind: 'crate' });
  }
  const dirs = new Map();
  for (const t of tracks) { const d = trackFolder(t); if (d) dirs.set(d, (dirs.get(d) || 0) + 1); }
  if (dirs.size > 1) {
    for (const [d, count] of [...dirs].sort((a, b) => a[0].localeCompare(b[0]))) out.push({ id: `folder:${d}`, name: folderName(d), count, kind: 'folder' });
  }
  return out;
}

/** The tracks a "Build from" choice covers. A choice that no longer exists means All music. */
export function tracksFrom(tracks, crates, sourceId) {
  if (sourceId?.startsWith('crate:')) {
    const c = crates.find((x) => `crate:${x.id}` === sourceId);
    if (c) { const ids = new Set(c.trackIds); return tracks.filter((t) => ids.has(t.libId)); }
  }
  if (sourceId?.startsWith('folder:')) {
    const d = sourceId.slice(7);
    const inDir = tracks.filter((t) => trackFolder(t) === d);
    if (inDir.length) return inDir;
  }
  return tracks;
}

// ---------- the event and the crowd: a wedding is not a club night ----------
// Each event has an energy shape (or follows the vibe), how much smooth key/speed matching matters,
// and how much songs people know matter (a track's star rating stands in for "people know it").

export const EVENTS = [
  { id: 'club', name: 'Club night', usesVibe: true, match: 1, familiar: 0.02,
    blurb: 'A crowd that came to dance. Long, smooth blends; keys and speeds that match.',
    story: 'Long blends between tracks in neighbouring keys and close speeds, shaped to the vibe.',
    ai: 'A club night: keep the beat going with long, smooth blends, close BPMs and neighbouring keys. Phrase-matched mixes matter.' },
  { id: 'wedding', name: 'Wedding', curve: [0.3, 0.35, 0.8, 0.95, 0.75], match: 0.35, familiar: 0.12,
    blurb: 'Songs everyone knows. Gentle while people eat and talk, then a full dance floor. Quick, simple mixes are fine.',
    story: 'Starts gentle for dinner, then builds to a full dance floor with songs people know. Short, simple mixes are fine here.',
    ai: 'A wedding: guests of every age who did not come for the DJ. Pick well-known, feel-good songs and singalongs, nothing explicit or gloomy. Start gentle (drinks and dinner), build to a full dance floor, and leave room near the end for big singalongs. Genres and tempos can change between songs; quick fades or cuts on the phrase are better than long blends. Tips should be simple.' },
  { id: 'party', name: 'House party or birthday', curve: [0.45, 0.8, 0.9, 0.7], match: 0.6, familiar: 0.08,
    blurb: 'Fun, familiar songs that warm up fast and keep people dancing.',
    story: 'Warms up fast with fun, familiar songs and keeps the energy high.',
    ai: 'A house party or birthday: friends who want fun, familiar songs. Warm up fast and keep the energy high. Mixing can be short and simple.' },
  { id: 'bar', name: 'Bar or lounge', curve: [0.3, 0.5, 0.45], cap: 6, match: 0.8, familiar: 0.03,
    blurb: 'Background music while people talk: warm, steady, never too loud.',
    story: 'Warm, steady background music that never takes over the room.',
    ai: 'A bar or lounge: background music while people talk. Keep it warm, steady and mid-energy, with no big drops. Smooth, gentle mixes.' },
  { id: 'work', name: 'Work event', curve: [0.3, 0.55, 0.6], cap: 7, match: 0.6, familiar: 0.08,
    blurb: 'Upbeat, safe, clean songs. Nothing too heavy.',
    story: 'Upbeat and easy-going, with nothing too heavy.',
    ai: 'A work event: mixed colleagues. Upbeat, safe, well-known songs with clean lyrics. Nothing heavy, explicit or divisive.' },
  { id: 'festival', name: 'Festival', usesVibe: true, shift: 1, match: 0.9, familiar: 0.03,
    blurb: 'Big energy for a big crowd that came to dance.',
    story: 'Big energy for a big crowd, with smooth mixes between tracks.',
    ai: 'A festival stage: a big crowd that came to dance. High energy, big moments and drops, and smooth beatmatched mixes.' },
];

export const AUDIENCES = [
  { id: 'mixed', name: 'Mixed ages', shift: 0, familiar: 0.06,
    blurb: 'Something for everyone: lean on songs people know.',
    ai: 'The crowd is mixed ages: pick songs that work across generations.' },
  { id: 'young', name: 'Young crowd (18–30)', shift: 1, familiar: 0.02,
    blurb: 'Newer music and more energy.',
    ai: 'The crowd is mostly 18 to 30: newer music and more energy.' },
  { id: 'older', name: 'Older crowd (40+)', shift: -1, familiar: 0.08,
    blurb: 'Classics and well-loved songs, a little less intense.',
    ai: 'The crowd is mostly over 40: classics and well-loved songs from past decades, a little less intense.' },
  { id: 'family', name: 'Families with kids', shift: -0.5, cap: 7, familiar: 0.08,
    blurb: 'Clean, happy songs that kids and grandparents both know.',
    ai: 'Families with children: clean lyrics only, happy and well-known songs, nothing too intense.' },
  { id: 'heads', name: 'Music lovers', shift: 0, match: 0.2, familiar: -0.02,
    blurb: 'They know the music: deeper tracks and longer blends are welcome.',
    ai: 'The crowd knows the music: deeper, less obvious tracks and longer, technical blends are welcome.' },
];

const pick = (list, id) => list.find((x) => x.id === id) || list[0];

/**
 * How to build for one event and crowd: target energy over the set, how much matching matters and how
 * much songs people know matter. { energy(t), match, familiar, event, audience }.
 */
export function setProfile({ event = 'club', audience = 'mixed', vibe = 'journey' } = {}) {
  const ev = pick(EVENTS, event), au = pick(AUDIENCES, audience);
  const cap = Math.min(ev.cap ?? 10, au.cap ?? 10);
  const energy = (t) => {
    const base = ev.usesVibe ? targetEnergy(vibe, t) : curveEnergy(ev.curve, t);
    return Math.round(Math.max(1, Math.min(cap, base + (ev.shift || 0) + (au.shift || 0))) * 10) / 10;
  };
  return { energy, match: ev.match + (au.match || 0), familiar: ev.familiar + au.familiar, event: ev, audience: au };
}

/** What the AI should know about the event and the crowd. */
export const eventBrief = ({ event, audience } = {}) => `${pick(EVENTS, event).ai} ${pick(AUDIENCES, audience).ai}`;
