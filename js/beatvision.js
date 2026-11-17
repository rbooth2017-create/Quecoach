// Beat vision: read beat match and phase off rekordbox's own zoomed waveforms. DOM-free.
//
// rekordbox's 2-deck layout stacks the decks' zoomed waveforms: Deck 1 above a centre line,
// Deck 2 below it. Each has red downbeat (bar) markers on its outer edge, and a thin white
// playhead line runs through both at the same x (it stays put while the beat lines scroll). From the playhead's position between two
// downbeats we know where each deck is in its bar; comparing the two gives the phase.
//
// img: { width, height, data: RGBA bytes }  (ImageData from a canvas, or a decoded bitmap)

const isRed = (d, o) => d[o] > 165 && d[o + 1] < 95 && d[o + 2] < 95;
const isWave = (d, o) => { // the waveform's saturated blue / orange / white
  const r = d[o], g = d[o + 1], b = d[o + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx > 120 && mx - mn > 70;
};

/** Narrow red marks in one row → their centre x positions. */
function redTicks(img, y, x0 = 0, x1 = img.width) {
  const d = img.data, w = img.width, ticks = [];
  let start = -1;
  for (let x = x0; x <= x1; x++) {
    const red = x < x1 && isRed(d, (y * w + x) * 4);
    if (red && start < 0) start = x;
    if (!red && start >= 0) {
      const width = x - start;
      if (width <= Math.max(10, img.width / 150)) ticks.push((start + x - 1) / 2);
      start = -1;
    }
  }
  return ticks;
}

/** Regular spacing of ticks (some may be hidden): smallest gap that the other gaps are multiples of. */
export function tickSpacing(ticks) {
  if (ticks.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < ticks.length; i++) gaps.push(ticks[i] - ticks[i - 1]);
  const cands = gaps.filter((g) => g > 12).sort((a, b) => a - b);
  for (const c of cands) {
    let fit = 0, sum = 0, n = 0;
    for (const g of gaps) {
      const k = Math.round(g / c);
      if (k >= 1 && Math.abs(g - k * c) <= Math.max(2.5, c * 0.02)) { fit++; sum += g; n += k; }
    }
    if (fit >= Math.max(1, gaps.length - 1)) return { spacing: sum / n, fit };
  }
  return null;
}

/** Find the two rows of downbeat markers (Deck 1 above, Deck 2 below). */
export function findLayout(img) {
  const rows = [];
  for (let y = 0; y < img.height; y++) {
    const t = redTicks(img, y);
    if (t.length < 2) continue;
    const s = tickSpacing(t);
    if (s && s.spacing > img.width / 40) rows.push({ y, ticks: t, spacing: s.spacing, score: s.fit });
  }
  let best = null;
  for (const a of rows) {
    for (const b of rows) {
      const gap = b.y - a.y;
      if (gap < 40) continue;
      const ratio = a.spacing / b.spacing;
      if (ratio < 0.75 || ratio > 1.33) continue;
      // waveform colour must fill the band between the two marker rows
      let wave = 0, n = 0;
      const x0 = Math.max(0, Math.min(a.ticks[0], b.ticks[0]) | 0), x1 = Math.min(img.width - 1, Math.max(a.ticks.at(-1), b.ticks.at(-1)) | 0);
      for (let y = a.y + 4; y < b.y - 3; y += 3) for (let x = x0; x < x1; x += 7) { n++; if (isWave(img.data, (y * img.width + x) * 4)) wave++; }
      const fill = n ? wave / n : 0;
      if (fill < 0.12) continue;
      const score = a.score + b.score + fill * 10 - Math.abs(Math.log(ratio)) * 5;
      if (!best || score > best.score) best = { top: a, bottom: b, score };
    }
  }
  if (!best) return null;
  // horizontal extent: where waveform colour appears between the marker rows
  const topY = best.top.y, bottomY = best.bottom.y;
  let left = img.width, right = 0;
  for (let x = 0; x < img.width; x++) {
    let wave = 0;
    for (let y = topY + 4; y < bottomY - 3; y += 2) if (isWave(img.data, (y * img.width + x) * 4)) wave++;
    if (wave >= 2) { left = Math.min(left, x); right = Math.max(right, x); }
  }
  return { topY, bottomY, left, right };
}

/** A thin line pixel: neutral grey/white (the playhead; looks grey when the image is scaled down) or red. */
const isLinePx = (d, o) => {
  const r = d[o], g = d[o + 1], b = d[o + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return (mx > 55 && mx - mn < 34) || isRed(d, o);
};

/**
 * Playhead candidates: a thin line that runs through BOTH decks' halves.
 * Returns { x, score, scores (per column from x0), x0 }. Beat tick lines look alike but only cross
 * one deck (and they scroll), so callers can also average `scores` over frames.
 */
export function playheadScores(img, layout) {
  const d = img.data, w = img.width;
  const y0 = layout.topY + 5, y1 = layout.bottomY - 4, mid = (y0 + y1) / 2;
  const x0 = Math.max(6, Math.floor(layout.left) + 2), x1 = Math.min(w - 7, Math.ceil(layout.right) - 2);
  const step = Math.max(1, Math.round((y1 - y0) / 60));
  const scores = new Float32Array(x1 - x0 + 1);
  let best = { x: null, score: 0 };
  for (let x = x0; x <= x1; x++) {
    let up = 0, down = 0, nu = 0, nd = 0;
    for (let y = y0; y < y1; y += step) {
      const row = y * w;
      const on = isLinePx(d, (row + x - 1) * 4) || isLinePx(d, (row + x) * 4) || isLinePx(d, (row + x + 1) * 4);
      const thin = on && !isLinePx(d, (row + x - 5) * 4) && !isLinePx(d, (row + x + 5) * 4);
      if (y < mid) { nu++; up += thin; } else { nd++; down += thin; }
    }
    const sc = Math.min(up / nu, down / nd);
    scores[x - x0] = sc;
    if (sc > best.score) best = { x, score: sc };
  }
  return { ...best, x: best.x == null ? null : lineCentre(scores, x0, best.x), scores, x0 };
}

/** Centre of a 1–3 px line: weighted mean of the strong columns next to the best one. */
export function lineCentre(scores, x0, bestX) {
  const peak = scores[bestX - x0];
  let sum = 0, wsum = 0;
  for (let x = bestX - 3; x <= bestX + 3; x++) {
    const v = scores[x - x0];
    if (v != null && v >= peak * 0.85) { sum += x * v; wsum += v; }
  }
  return wsum ? sum / wsum : bestX;
}

export function findPlayhead(img, layout) {
  const p = playheadScores(img, layout);
  return p.score >= 0.4 ? p.x : null;
}

/** Is x on this deck's beat grid (a beat line is drawn there)? */
function onGrid(x, { ticks, spacing }) {
  const beat = spacing / 4, d = ((((x - ticks[0]) / beat) % 1) + 1) % 1;
  return Math.min(d, 1 - d) * beat <= Math.max(4, beat * 0.05); // beat lines are a few px wide
}

/**
 * Pick the playhead from one frame. When both decks' beat lines happen to line up, they look
 * like the playhead too: prefer a strong line that is not on both beat grids.
 */
function choosePlayhead(img, layout, grids) {
  const p = playheadScores(img, layout);
  if (p.x == null || p.score < 0.4) return null;
  const both = (x) => onGrid(x, grids[1]) && onGrid(x, grids[2]);
  if (!both(p.x)) return p.x;
  let alt = null;
  for (let i = 0; i < p.scores.length; i++) {
    const x = i + p.x0;
    if (p.scores[i] >= Math.max(0.4, p.score * 0.75) && !both(x) && (!alt || p.scores[i] > alt.v)) alt = { x, v: p.scores[i] };
  }
  return alt ? lineCentre(p.scores, p.x0, alt.x) : p.x;
}

/** Where the playhead is in a deck's bar, 0..1, from its downbeat markers (circular mean over all). */
function barPosition(ticks, spacing, x) {
  let sx = 0, sy = 0;
  for (const t of ticks) {
    const a = (((x - t) / spacing) % 1 + 1) % 1 * 2 * Math.PI;
    sx += Math.cos(a); sy += Math.sin(a);
  }
  return ((Math.atan2(sy, sx) / (2 * Math.PI)) + 1) % 1;
}

const wrapHalf = (x) => x - Math.round(x);

/**
 * Analyse one frame. Returns:
 * { ok, reason?, playheadX, decks: {1: {bar, beat, beatInBar, spacing}, 2: …},
 *   phase: deck 2 minus deck 1 in beats (−0.5..0.5; + = deck 2 ahead),
 *   barOffset: whole beats between their downbeats (−2..2), tempoRatio: deck 2 / deck 1 }
 * Pass the previous result's layout as `hint` to skip the search.
 */
export function analyzeFrame(img, hint = null) {
  let layout = hint;
  if (layout) { // still valid? both marker rows must still show ticks
    const ok = redTicks(img, layout.topY).length >= 1 && redTicks(img, layout.bottomY).length >= 1;
    if (!ok) layout = null;
  }
  layout ||= findLayout(img);
  if (!layout) return { ok: false, reason: 'no-waveforms' };
  // each deck's downbeat markers → its beat grid
  const grids = {};
  for (const [no, y] of [[1, layout.topY], [2, layout.bottomY]]) {
    // markers are a few rows tall: merge ticks from the marker row and its neighbours
    const ticks = [...new Set([y - 1, y, y + 1].flatMap((yy) => redTicks(img, yy).map((t) => Math.round(t * 2) / 2)))].sort((a, b) => a - b);
    const merged = ticks.filter((t, i) => i === 0 || t - ticks[i - 1] > 3);
    const s = tickSpacing(merged);
    if (!s) return { ok: false, reason: 'no-beats', layout };
    grids[no] = { ticks: merged, spacing: s.spacing };
  }
  const playheadX = hint?.playheadX ?? choosePlayhead(img, layout, grids);
  if (playheadX == null) return { ok: false, reason: 'no-playhead', layout };
  const decks = {};
  for (const no of [1, 2]) {
    const { ticks, spacing } = grids[no];
    const bar = barPosition(ticks, spacing, playheadX);
    const beatPos = bar * 4;
    decks[no] = { bar, beat: beatPos % 1, beatInBar: Math.floor(beatPos) + 1, spacing, ticks };
  }
  const phase = wrapHalf(decks[2].beat - decks[1].beat);
  const barBeats = decks[2].bar * 4 - decks[1].bar * 4;
  const barOffset = Math.round(((barBeats % 4) + 6) % 4 - 2) || 0; // −2..1 whole beats (no −0)
  // rekordbox's zoomed waveform runs at a fixed speed, so beat spacing ∝ 1/BPM
  const tempoRatio = decks[1].spacing / decks[2].spacing;
  return { ok: true, layout, playheadX, decks, phase, barOffset, tempoRatio };
}

/** Plain-language advice, from the next deck's point of view. bpm: playing deck's BPM (for ms). */
export function beatAdvice(r, { next = 2, bpm = null } = {}) {
  if (!r?.ok) return null;
  const sign = next === 2 ? 1 : -1;            // phase/tempo are deck 2 relative to deck 1
  const phase = r.phase * sign;                  // + = next deck ahead
  const tempoPct = (Math.pow(r.tempoRatio, sign) - 1) * 100; // + = next deck faster
  const ms = bpm ? Math.abs(phase) * 60000 / bpm : null;
  const tempoOk = Math.abs(tempoPct) < 0.15, phaseOk = Math.abs(phase) < 0.03;
  return {
    phase, tempoPct, tempoOk, phaseOk, barOk: r.barOffset === 0,
    tempo: tempoOk ? 'Tempo matched' : `Deck ${next} is ${Math.abs(tempoPct).toFixed(1)}% ${tempoPct > 0 ? 'faster — move its tempo slider up (towards −)' : 'slower — move its tempo slider down (towards +)'}`,
    beats: phaseOk ? 'Beats in phase' : `Deck ${next} is ${ms != null ? `${ms.toFixed(0)} ms` : `${Math.abs(phase * 100).toFixed(0)}% of a beat`} ${phase > 0 ? 'ahead — touch the side of its jog wheel to slow it' : 'behind — push the side of its jog wheel forward'}`,
    bars: r.barOffset === 0 ? 'Downbeats lined up' : `Deck ${next}'s "1" is ${Math.abs(r.barOffset)} beat${Math.abs(r.barOffset) > 1 ? 's' : ''} ${r.barOffset * sign > 0 ? 'early' : 'late'} — restart it on Deck ${next === 2 ? 1 : 2}'s "1"`,
  };
}

/**
 * Where each deck's header (title, artist, BPM) sits, relative to the waveform band.
 * Deck 1's is above the band, Deck 2's below; distances scale with the band's height.
 */
export function deckHeaderRegions(layout, width, height) {
  const band = layout.bottomY - layout.topY;
  const x = Math.max(0, Math.round(layout.left - 0.06 * width)), w = Math.min(width, Math.round(layout.right)) - x;
  const clampY = (a, b) => { const y0 = Math.max(0, Math.round(a)), y1 = Math.min(height, Math.round(b)); return { x, y: y0, w, h: Math.max(0, y1 - y0) }; };
  return { 1: clampY(layout.topY - 1.9 * band, layout.topY - 0.6 * band), 2: clampY(layout.bottomY + 0.5 * band, layout.bottomY + 1.9 * band) };
}
