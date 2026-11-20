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
  const c = (VIBES.find((v) => v.id === vibeId) || VIBES[2]).curve;
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
export function quickSet(library, { minutes = 60, vibe = 'journey', first = null } = {}) {
  const pool = library.filter((t) => t.bpm && !(t.duration > 0 && t.duration < 60));
  if (!pool.length) return [];
  const energy = (t) => t.energy ?? 5;
  const out = [];
  let cur = first && pool.find((t) => t.id === first.id) ? first
    : [...pool].sort((a, b) => Math.abs(energy(a) - targetEnergy(vibe, 0)) - Math.abs(energy(b) - targetEnergy(vibe, 0)) || (b.rating || 0) - (a.rating || 0))[0];
  let elapsed = 0;
  const used = new Set();
  out.push({ track: cur, why: first ? 'Your starting track' : 'Opens the set at the right energy', energyTarget: targetEnergy(vibe, 0) });
  used.add(cur.id); elapsed += trackMinutes(cur) * PLAYED_SHARE;
  while (elapsed < minutes && used.size < pool.length) {
    const want = targetEnergy(vibe, elapsed / minutes);
    let best = null;
    for (const t of pool) {
      if (used.has(t.id)) continue;
      const m = friendlyMatch(cur, t);
      const fit = m.score - Math.abs(energy(t) - want) * 0.08;
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
