// Engine: next-track scoring, mix-in / mix-out points, transition plans. DOM-free.
import { keyRelation } from './library.js';

/** Pitch change (%) the incoming track needs to match `fromBpm`, allowing half/double time. */
export function pitchNeeded(fromBpm, toBpm) {
  if (!fromBpm || !toBpm) return { pct: null, mode: '1x' };
  const options = [[toBpm, '1x'], [toBpm * 2, '2x'], [toBpm / 2, '½x']].map(([b, mode]) => ({ mode, pct: (fromBpm / b - 1) * 100 }));
  options.sort((x, y) => Math.abs(x.pct) - Math.abs(y.pct));
  return options[0];
}

const GENRE_FAMILY = (g) => {
  const s = (g || '').toLowerCase();
  if (s.includes('techno')) return 'techno';
  if (s.includes('house')) return 'house';
  if (s.includes('drum') || s.includes('dnb') || s.includes('jungle')) return 'dnb';
  if (s.includes('trance')) return 'trance';
  return s || null;
};

/**
 * Score one candidate against the track that is playing now.
 * opts.direction: 'up' | 'hold' | 'down' — where you want the energy to go.
 */
export function scoreCandidate(current, cand, opts = {}) {
  const reasons = [];
  const key = keyRelation(current.camelot, cand.camelot);
  reasons.push(`${current.camelot || '?'} → ${cand.camelot || '?'} ${key.label}`);

  const pitch = pitchNeeded(current.bpm, cand.bpm);
  const ap = Math.abs(pitch.pct ?? 99);
  const bpmScore = ap <= 2 ? 1 : ap <= 4 ? 0.8 : ap <= 6 ? 0.5 : ap <= 8 ? 0.2 : 0;
  if (pitch.pct != null) reasons.push(`${pitch.pct >= 0 ? '+' : ''}${pitch.pct.toFixed(1)}% pitch${pitch.mode !== '1x' ? ` (${pitch.mode} time)` : ''}`);

  const ga = GENRE_FAMILY(current.genre), gb = GENRE_FAMILY(cand.genre);
  const genreScore = !ga || !gb ? 0.5 : current.genre === cand.genre ? 1 : ga === gb ? 0.7 : 0.2;

  let energyScore = 0.5;
  if (current.energy != null && cand.energy != null) {
    const d = cand.energy - current.energy;
    const want = opts.direction === 'up' ? 1 : opts.direction === 'down' ? -1 : 0;
    energyScore = Math.max(0, 1 - Math.abs(d - want) / 3);
    reasons.push(`energy ${current.energy}→${cand.energy}`);
  }
  const ratingScore = (cand.rating || 0) / 5;

  const score = 0.4 * key.score + 0.3 * bpmScore + 0.15 * genreScore + 0.1 * energyScore + 0.05 * ratingScore;
  return { track: cand, score, key, pitch, reasons };
}

/** Best next tracks from the library, excluding what was already played. */
export function suggestNext(current, library, opts = {}) {
  const played = opts.played || new Set();
  return library
    .filter((t) => t.id !== current.id && !played.has(t.id) && t.bpm)
    .map((t) => scoreCandidate(current, t, opts))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit || 12);
}

// ---------- Beat grid helpers ----------
export const beatLen = (grid) => 60 / grid.bpm;
export const barLen = (grid) => 240 / grid.bpm;
export const barAt = (grid, t) => Math.floor((t - grid.firstDownbeat) / barLen(grid)) + 1;
export const timeOfBar = (grid, bar) => grid.firstDownbeat + (bar - 1) * barLen(grid);
export const snapToBar = (grid, t) => timeOfBar(grid, Math.round((t - grid.firstDownbeat) / barLen(grid)) + 1);
export function fmtTime(t) {
  if (t == null || !isFinite(t)) return '–:––';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/**
 * Structure from per-bar low-end energy (0..1 per bar, bar 1 = first downbeat).
 * Returns the first "full energy" bar and where the outro starts, snapped to phrases.
 */
export function structureFromEnergy(barEnergy, phraseBars = 16) {
  const n = barEnergy.length;
  if (!n) return null;
  const sorted = [...barEnergy].sort((a, b) => a - b);
  const high = sorted[Math.floor(n * 0.8)];
  const isHigh = (i) => barEnergy[i] >= high * 0.85;
  // first drop: first run of 4+ high bars that starts after the opening bars
  let firstDrop = null;
  for (let i = 0; i < n - 4; i++) if ([0, 1, 2, 3].every((k) => isHigh(i + k))) { firstDrop = i + 1; break; }
  // last high bar → outro starts on the next phrase boundary after it
  let lastHigh = n;
  for (let i = n - 1; i >= 0; i--) if (isHigh(i)) { lastHigh = i + 1; break; }
  const snapUp = (bar) => Math.ceil((bar - 1) / phraseBars) * phraseBars + 1;
  // breakdowns: phrase-aligned runs well below the median
  const median = sorted[Math.floor(n / 2)];
  const breaks = [];
  for (let p = 1; p + phraseBars / 2 <= n; p += phraseBars / 2) {
    const slice = barEnergy.slice(p - 1, p - 1 + phraseBars / 2);
    const avg = slice.reduce((s, v) => s + v, 0) / slice.length;
    if (firstDrop && p > firstDrop && avg < median * 0.4) breaks.push(p);
  }
  return { firstDrop, outroStart: Math.min(snapUp(lastHigh + 1), n), breaks, bars: n };
}

/**
 * Structure from rekordbox's own phrase analysis (via the helper).
 * phrases: [{label, start, end}] in seconds. "Chorus" = drop, "Outro" = outro, "Down" = breakdown.
 */
export function structureFromPhrases(phrases, grid) {
  if (!phrases?.length || !grid) return null;
  const bar = (t) => Math.max(1, Math.round((t - grid.firstDownbeat) / barLen(grid)) + 1);
  const drop = phrases.find((p) => p.label === 'Chorus');
  const outros = phrases.filter((p) => p.label === 'Outro');
  const firstDrop = drop ? bar(drop.start) : null;
  return {
    firstDrop,
    outroStart: outros.length ? bar(outros[outros.length - 1].start) : null,
    breaks: phrases.filter((p) => (p.label === 'Down' || p.label === 'Bridge') && firstDrop && bar(p.start) > firstDrop).map((p) => bar(p.start)),
    source: 'phrases',
  };
}

/**
 * Suggested points to START the incoming track from.
 * analysis (optional) = { structure } from structureFromEnergy.
 */
export function mixInPoints(track, analysis, phraseBars = 16) {
  const g = track.grid;
  if (!g) return [];
  const pts = [];
  const introBars = analysis?.structure?.firstDrop ? analysis.structure.firstDrop - 1 : 32;
  pts.push({ bar: 1, time: g.firstDownbeat, label: 'First downbeat', detail: `${introBars}-bar intro for a long blend`, best: true });
  for (let b = 1 + phraseBars; b <= introBars - 7; b += phraseBars) {
    pts.push({ bar: b, time: timeOfBar(g, b), label: `Phrase ${Math.ceil(b / phraseBars)}`, detail: `${introBars - b + 1} bars before the drop — shorter blend` });
  }
  if (analysis?.structure?.firstDrop) {
    const b = analysis.structure.firstDrop;
    pts.push({ bar: b, time: timeOfBar(g, b), label: analysis.structure.source === 'phrases' ? 'Chorus' : 'Drop', detail: 'Cut straight in on the drop (quick mix)' });
  }
  for (const c of track.cues || []) {
    if (c.loop) continue;
    const t = snapToBar(g, c.time);
    if (pts.some((p) => Math.abs(p.time - t) < 0.05)) continue;
    pts.push({ bar: barAt(g, t + 0.01), time: t, label: c.num >= 0 ? `Hot cue ${'ABCDEFGH'[c.num] || c.num}` : 'Memory cue', detail: c.name || 'your cue' });
  }
  return pts.sort((a, b) => a.time - b.time);
}

/** Where to start bringing the next track in, on the outgoing track. */
export function mixOutPoint(track, analysis, phraseBars = 16) {
  const g = track.grid;
  if (!g) return null;
  const totalBars = Math.floor((track.duration - g.firstDownbeat) / barLen(g));
  let bar = analysis?.structure?.outroStart;
  let why = analysis?.structure?.source === 'phrases' ? 'start of the Outro phrase' : 'outro detected from the audio';
  if (!bar) {
    bar = Math.max(1, Math.floor((totalBars - 32) / phraseBars) * phraseBars + 1);
    why = '32 bars before the end, on a phrase (no phrase analysis for this track)';
  }
  return { bar, time: timeOfBar(g, bar), totalBars, why };
}

/** A full plan for mixing A (playing) into B (next). */
/**
 * Step texts use {IN} (the incoming track) and {OUT} (the playing track); callers fill them in.
 * inTime: optional chosen start point on B (seconds).
 */
export function planTransition(A, B, anaA, anaB, phraseBars = 16, inTime = null) {
  const out = mixOutPoint(A, anaA, phraseBars);
  const ins = mixInPoints(B, anaB, phraseBars);
  if (!out || !ins.length) return null;
  const inPt = (inTime != null && ins.find((p) => Math.abs(p.time - inTime) < 0.05)) || ins[0];
  const firstDrop = anaB?.structure?.firstDrop || 33;
  const introBars = Math.max(8, firstDrop - inPt.bar);
  const outroBars = Math.max(8, out.totalBars - out.bar + 1);
  const blend = Math.max(8, Math.min(32, introBars, outroBars) - (Math.min(32, introBars, outroBars) % 8));
  const gA = A.grid, gB = B.grid;
  const pitch = pitchNeeded(A.bpm, B.bpm);
  const at = (barsIn) => ({ a: timeOfBar(gA, out.bar + barsIn), b: inPt.time + barsIn * barLen(gB) });
  const steps = [
    { bars: 0, text: `Start {IN} from its ${inPt.label.toLowerCase()} exactly on {OUT}'s bar ${out.bar}, bass EQ fully cut.` },
    { bars: blend / 4, text: 'Bring {IN} up to the same volume as {OUT}. Keep its bass cut — only one kick drum\'s bass at a time.' },
    { bars: blend / 2, text: 'Bass swap: cut {OUT}\'s bass and bring {IN}\'s bass in on the same downbeat.' },
    { bars: blend * 3 / 4, text: 'Start fading {OUT} out (or pull its highs down).' },
    { bars: blend, text: '{OUT} fully out. {IN} is now your playing track.' },
  ].map((s) => ({ ...s, ...at(s.bars) }));
  return { outBar: out.bar, outTime: out.time, outWhy: out.why, inPoint: inPt, blendBars: blend, pitch, steps };
}
