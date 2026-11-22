// Mix report: watches each transition from one deck to the other and scores it like a teacher would:
// beats locked, "1"s lined up, started on a phrase, one bass at a time, a long enough blend, keys that fit.
// DOM-free: learn.js feeds it one sample per frame and shows the report.

export const AUDIBLE = 0.12;   // a deck's gain to the room (crossfader × channel fader) that counts as "in the mix"
export const GONE = 0.05;      // below this the deck is out
const END_HOLD = 1.0;          // seconds a deck has to stay out before the transition counts as finished
const MIN_SECONDS = 3;         // shorter overlaps are a flick of the crossfader, not a mix

/** The parts of the score, with the lesson that practises each one. */
export const PARTS = {
  beats: { name: 'Beats in time', lesson: 'nudge', weight: 0.35 },
  ones: { name: '"1"s lined up', lesson: 'phrase', weight: 0.14 },
  phrase: { name: 'Started on a phrase', lesson: 'phrasing', weight: 0.13 },
  bass: { name: 'One bass at a time', lesson: 'bass-swap', weight: 0.15 },
  length: { name: 'Blend length', lesson: 'smooth', weight: 0.09 },
  smooth: { name: 'Steady volume', lesson: 'first-mix', weight: 0.05 },
  // the id stays 'key' so older histories still line up; it now scores the whole choice of song: key and energy
  key: { name: 'Track choice', lesson: 'keys', weight: 0.1 },
};

export const GRADES = [
  [90, 'Smooth as butter'], [75, 'Clean mix'], [55, 'Getting there'], [0, 'A rough one'],
];
export const gradeFor = (score) => GRADES.find(([min]) => score >= min)[1];
/** A mix that counts towards the next level. */
export const CLEAN_SCORE = 75;

export function newRecorder() { return { mix: null, solo: null, outFor: 0 }; }

/**
 * Feed one frame. sample:
 * { left: { gain, playing, low (bass EQ dB), phrasePos (bars into the 16-bar phrase, 0..16) },
 *   right: {…}, offsetMs (beat offset when both play, or null), barOffset (beats between the "1"s), keyScore, bassTool, bpm,
 *   energyStep (the new song's energy minus the old one's, 1–10 scale, or null when unknown) }
 * Returns a finished report when a transition completes, else null.
 */
export function feed(rec, s, dt) {
  const on = (side) => s[side].playing && s[side].gain >= AUDIBLE;
  const out = (side) => !s[side].playing || s[side].gain < GONE;
  const both = on('left') && on('right');
  if (!rec.mix) {
    if (!both) { if (on('left') && !on('right')) rec.solo = 'left'; else if (on('right') && !on('left')) rec.solo = 'right'; return null; }
    const from = rec.solo || 'left', to = from === 'left' ? 'right' : 'left';
    rec.mix = { from, to, t: 0, startPhrase: s[from].phrasePos, aligned: 0, wreck: 0, timed: 0, ones: 0, offSum: 0, clash: 0, dip: 0, keyScore: s.keyScore ?? 0.5, energyStep: Number.isFinite(s.energyStep) ? s.energyStep : null, bassTool: !!s.bassTool, bpm: s.bpm || 120, bassCutAtStart: s[to].low <= -12 };
    rec.outFor = 0;
    return null;
  }
  const m = rec.mix;
  m.t += dt;
  if (s.offsetMs != null && s.left.playing && s.right.playing) {
    const o = Math.abs(s.offsetMs);
    m.timed += dt; m.offSum += o * dt;
    if (o <= 25) m.aligned += dt;
    if (o > 60) m.wreck += dt;
    if (s.barOffset === 0) m.ones += dt;
  }
  if (s.left.gain >= 0.35 && s.right.gain >= 0.35 && s.left.low > -12 && s.right.low > -12 && s.left.playing && s.right.playing) m.clash += dt;
  const g = (side) => (s[side].playing ? s[side].gain : 0);
  if (g('left') ** 2 + g('right') ** 2 < 0.45) m.dip += dt;
  if (out(m.from) || out(m.to)) rec.outFor += dt; else rec.outFor = 0;
  if (rec.outFor < END_HOLD) return null;
  // finished: did we land on the new deck, or back out?
  const landed = out(m.from) && !out(m.to);
  rec.mix = null; rec.outFor = 0; rec.solo = landed ? m.to : m.from;
  if (!landed || m.t - END_HOLD < MIN_SECONDS) return null;
  return scoreMix({ ...m, t: m.t - END_HOLD });
}

const clamp = (x) => Math.max(0, Math.min(100, Math.round(x)));
/** How well an energy step suits a mix (100: hold or lift by up to 2; drops and big jumps cost). null when unknown. */
export function energyFit(step) {
  if (step == null || !Number.isFinite(step)) return null;
  const s = Math.round(step);
  return s >= 0 && s <= 2 ? 100 : s === -1 || s === 3 ? 75 : s === -2 ? 55 : 35;
}
const secs = (x) => `${Math.round(x)} second${Math.round(x) === 1 ? '' : 's'}`;

/** Turn what the recorder saw into a score, the parts and tips. Exported for tests. */
export function scoreMix(m) {
  const bars = (m.t * m.bpm) / 240;
  const timed = Math.max(1e-6, m.timed);
  const alignedPct = m.timed ? m.aligned / timed : 0;
  const parts = {};
  parts.beats = { score: m.timed ? clamp(alignedPct * 100 - Math.min(35, m.wreck * 6)) : 0, value: alignedPct };
  parts.ones = { score: m.timed ? clamp((m.ones / timed) * 100) : 0 };
  const off = m.startPhrase == null ? null : Math.min(m.startPhrase % 16, 16 - (m.startPhrase % 16));
  parts.phrase = { score: off == null ? 50 : off <= 0.5 ? 100 : off <= 1.25 ? 80 : off <= 2.5 ? 55 : 25, bars: off };
  parts.bass = m.bassTool ? { score: clamp(100 - (m.clash / Math.max(1, m.t)) * 160) } : null;
  parts.length = { score: bars >= 12 ? 100 : bars >= 6 ? 80 : bars >= 3 ? 55 : 30, bars };
  parts.smooth = { score: clamp(100 - m.dip * 20) };
  const keyPart = m.keyScore >= 0.85 ? 100 : m.keyScore >= 0.55 ? 75 : m.keyScore >= 0.5 ? 60 : 35;
  const energyPart = energyFit(m.energyStep);
  parts.key = { score: energyPart == null ? keyPart : Math.round(keyPart * 0.5 + energyPart * 0.5), keyPart, energyPart, step: m.energyStep };
  let total = 0, weights = 0;
  for (const [id, p] of Object.entries(parts)) if (p) { total += p.score * PARTS[id].weight; weights += PARTS[id].weight; }
  const score = clamp(total / weights);

  const tipFor = {
    beats: () => (m.wreck > 2 ? `The beats drifted apart for ${secs(m.wreck)}. Keep a hand on the jog wheel and nudge as soon as you hear a gallop.` : 'The beats wandered a little. Small, early nudges keep them locked.'),
    ones: () => 'The "1"s weren\'t lined up, so the two tracks\' phrases were out of step. Start the new track from its first beat, right on a "1".',
    phrase: () => `The new track came in ${Math.round(parts.phrase.bars)} bars into a phrase. Start it on bar 1 of a phrase: watch the phrase counter.`,
    bass: () => `Both basses were up together for ${secs(m.clash)}, which sounds muddy. Keep the new track's bass cut until the swap.`,
    length: () => `That blend was short (${Math.round(bars)} bars). Try 16: start at the outro and take your time.`,
    smooth: () => 'The volume dipped during the mix. Move the crossfader steadily and keep both channel faders up.',
    key: () => (parts.key.energyPart != null && parts.key.energyPart < parts.key.keyPart
      ? (m.energyStep < 0 ? `The energy dropped ${-Math.round(m.energyStep)} steps, which can empty a floor. Hold or lift the energy, and save the big drops for a planned breather.` : `The energy jumped ${Math.round(m.energyStep)} steps at once. Build up a step or two at a time.`)
      : 'The keys clash. Pick a "Great match" from Suggested for a sweeter blend.'),
  };
  const praiseFor = {
    beats: () => `Your beats were locked together ${Math.round(alignedPct * 100)}% of the time.`,
    ones: () => 'Your "1"s were lined up: the phrases moved together.',
    phrase: () => 'You brought it in right on a phrase.',
    bass: () => 'Only one bass at a time: clean low end.',
    length: () => `A nice long ${Math.round(bars)}-bar blend.`,
    smooth: () => 'Steady volume all the way through.',
    key: () => 'A great pick: the key and the energy fit.',
  };
  const list = Object.entries(parts).filter(([, p]) => p).map(([id, p]) => ({ id, name: PARTS[id].name, score: p.score, lost: (100 - p.score) * PARTS[id].weight, lesson: PARTS[id].lesson }));
  const tips = list.filter((p) => p.score < 80).sort((a, b) => b.lost - a.lost).slice(0, 2).map((p) => ({ id: p.id, lesson: p.lesson, text: tipFor[p.id]() }));
  const best = [...list].sort((a, b) => b.score * PARTS[b.id].weight - a.score * PARTS[a.id].weight)[0];
  const notes = [];
  if (!m.bassTool && m.clash > 4) notes.push('Next skill: the bass swap. At the Improver level you get a Bass dial to keep the two basses apart.');
  return {
    score, grade: gradeFor(score), seconds: Math.round(m.t), bars: Math.round(bars), from: m.from, to: m.to,
    parts: list.map(({ id, name, score: sc }) => ({ id, name, score: sc })),
    tips, praise: best && best.score >= 70 ? praiseFor[best.id]() : null, notes,
  };
}

// ---------- history and progress ----------
const DAY = 86400000;
const dayOf = (ms) => Math.floor((ms - new Date(ms).getTimezoneOffset() * 60000) / DAY);

/** Keep the last 100 mixes, small: { at, score, bars }. */
export function addToHistory(history = [], report, at = Date.now()) {
  const parts = Object.fromEntries((report.parts || []).map((p) => [p.id, p.score]));
  return [...history, { at, score: report.score, bars: report.bars, parts }].slice(-100);
}

/**
 * Each skill's average over the last `n` mixes that scored it, weakest first:
 * [{ id, name, lesson, avg, count, trend }] (trend: this window vs the one before).
 */
export function skillStats(history = [], n = 10) {
  const out = [];
  for (const [id, info] of Object.entries(PARTS)) {
    const vals = history.map((h) => h.parts?.[id]).filter((v) => Number.isFinite(v));
    if (!vals.length) continue;
    const last = vals.slice(-n), prev = vals.slice(-2 * n, -n);
    const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
    out.push({ id, name: info.name, lesson: info.lesson, avg: avg(last), count: vals.length, trend: prev.length ? avg(last) - avg(prev) : 0 });
  }
  return out.sort((a, b) => a.avg - b.avg);
}

/**
 * Should the level change? Up after CLEAN_SCORE mixes are the norm (the app's clean-mix count handles that);
 * down when the last 5 mixes average under 45, so the coaching comes back. levels: ordered ids.
 * Returns { dir: 'down', to } or null.
 */
export function levelAdvice(history = [], level, levels = ['starter', 'improver', 'confident', 'pro']) {
  const i = levels.indexOf(level), last = history.slice(-5);
  if (i <= 0 || last.length < 5) return null;
  const avg = last.reduce((s, h) => s + h.score, 0) / last.length;
  return avg < 45 ? { dir: 'down', to: levels[i - 1] } : null;
}

/** Totals for the progress card. streak: days in a row with at least one mix, ending today or yesterday. */
export function progressStats(history = [], now = Date.now()) {
  if (!history.length) return { count: 0, recent: null, best: null, streak: 0, trend: 0, last: [] };
  const scores = history.map((h) => h.score);
  const last5 = scores.slice(-5), prev5 = scores.slice(-10, -5);
  const avg = (a) => Math.round(a.reduce((s, x) => s + x, 0) / a.length);
  const days = new Set(history.map((h) => dayOf(h.at)));
  let d = dayOf(now), streak = 0;
  if (!days.has(d)) d -= 1;
  while (days.has(d)) { streak++; d--; }
  return { count: history.length, recent: avg(last5), best: Math.max(...scores), streak, trend: prev5.length ? avg(last5) - avg(prev5) : 0, last: scores.slice(-12) };
}

/** A tiny line chart of recent scores, as an SVG string. */
export function sparkSVG(scores = [], { width = 120, height = 28 } = {}) {
  if (scores.length < 2) return '';
  const x = (i) => (i / (scores.length - 1)) * (width - 4) + 2, y = (v) => height - 2 - (v / 100) * (height - 4);
  const pts = scores.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="spark" role="img" aria-label="Your last ${scores.length} mix scores"><line x1="0" x2="${width}" y1="${y(CLEAN_SCORE)}" y2="${y(CLEAN_SCORE)}" stroke="currentColor" stroke-dasharray="2 3" opacity=".35"/><polyline points="${pts}" fill="none" stroke="var(--left)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(scores.length - 1)}" cy="${y(scores.at(-1))}" r="3" fill="var(--left)"/></svg>`;
}
