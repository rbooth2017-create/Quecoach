// Beat grid and waveform analysis for tracks we have only as audio (no rekordbox grid). DOM-free.
// Works on raw samples: Float32Array + sample rate.
//
// The grid comes from the kick drum: we build an onset envelope of the low end, find the tempo,
// then fit the grid to EVERY kick across the whole track (least squares), so a tiny tempo error
// can't build up into an audible drift by bar 70.

/** One-pole low-pass, mono. */
export function lowpass(x, sr, hz) {
  const y = new Float32Array(x.length), a = 1 - Math.exp(-2 * Math.PI * hz / sr);
  let s = 0;
  for (let i = 0; i < x.length; i++) { s += a * (x[i] - s); y[i] = s; }
  return y;
}

/** Low-end onset strength every ~5 ms. Returns { env, fps } (frames per second, exact). */
export function onsetEnvelope(x, sr, maxSeconds = Infinity) {
  const lp = lowpass(x, sr, 150);
  const hop = Math.max(1, Math.floor(sr / 200)), fps = sr / hop;
  const n = Math.floor(Math.min(lp.length, maxSeconds * sr) / hop);
  const env = new Float32Array(n);
  let prev = 0;
  for (let f = 0; f < n; f++) {
    let e = 0; const i = f * hop;
    for (let j = 0; j < hop; j++) e += lp[i + j] * lp[i + j];
    env[f] = Math.max(0, e - prev); prev = e;
  }
  return { env, fps };
}

const interp = (env, x) => { const i = Math.floor(x), f = x - i; return i >= 0 && i + 1 < env.length ? env[i] * (1 - f) + env[i + 1] * f : 0; };

/** Tempo by comparing each onset with the ones 1, 2, 4 and 8 beats later (the original estimator). */
export function roughTempo(env, fps, { min = 90, max = 180 } = {}) {
  const score = (bpm) => {
    const lag = fps * 60 / bpm; let s = 0;
    for (let i = 0; i + 8 * lag < env.length; i++) if (env[i]) s += env[i] * (interp(env, i + lag) + interp(env, i + 2 * lag) + interp(env, i + 4 * lag) + interp(env, i + 8 * lag));
    return s * (bpm >= 100 && bpm <= 150 ? 1 : 0.7); // prefer 100–150 so we don't land on half/double time
  };
  let best = 120, bs = -1;
  for (let bpm = min; bpm <= max; bpm += 0.5) { const s = score(bpm); if (s > bs) { bs = s; best = bpm; } }
  const lo = best - 0.6;
  for (let bpm = lo; bpm <= lo + 1.2; bpm += 0.01) { const s = score(bpm); if (s > bs) { bs = s; best = bpm; } }
  return best;
}

/** Where the beats fall (in frames, 0..period) for a given tempo. */
export function beatPhase(env, period) {
  let phase = 0, ps = -1;
  for (let p = 0; p < period; p += 0.25) {
    let s = 0; for (let k = p; k < env.length; k += period) s += interp(env, k) + 0.5 * interp(env, k + 1);
    if (s > ps) { ps = s; phase = p; }
  }
  return phase;
}

/**
 * Fit the grid to the actual kicks of the whole track. For each predicted beat, find the strongest onset
 * within a quarter beat, then least-squares fit time = start + k × period, dropping outliers. Repeats a few
 * times so the fit can walk to the true tempo.
 */
export function fitGrid(env, fps, period, phase) {
  let a = phase, b = period;
  for (let iter = 0; iter < 4; iter++) {
    const pts = [];
    const win = b * 0.22;
    for (let k = 0; a + k * b < env.length - 2; k++) {
      const c = a + k * b, lo = Math.max(1, Math.floor(c - win)), hi = Math.min(env.length - 2, Math.ceil(c + win));
      let m = -1, mv = 0;
      for (let i = lo; i <= hi; i++) if (env[i] > mv && env[i] >= env[i - 1] && env[i] >= env[i + 1]) { mv = env[i]; m = i; }
      if (m < 0) continue;
      // sub-frame peak position (parabola through the three samples)
      const y0 = env[m - 1], y1 = env[m], y2 = env[m + 1], den = y0 - 2 * y1 + y2;
      const off = den ? Math.max(-0.5, Math.min(0.5, 0.5 * (y0 - y2) / den)) : 0;
      pts.push([k, m + off, mv]);
    }
    if (pts.length < 16) break;
    // keep the clear kicks: at least a fifth of the typical strength
    const strengths = pts.map((p) => p[2]).sort((x, y) => x - y), typical = strengths[Math.floor(strengths.length * 0.6)];
    let use = pts.filter((p) => p[2] >= typical * 0.2);
    for (let pass = 0; pass < 2; pass++) {
      const fit = leastSquares(use);
      const res = use.map(([k, t]) => Math.abs(t - (fit.a + fit.b * k)));
      const mad = [...res].sort((x, y) => x - y)[Math.floor(res.length / 2)] || 0.5;
      use = use.filter((_, i) => res[i] <= Math.max(1.5, mad * 3));
      a = fit.a; b = fit.b;
    }
    if (use.length >= 16) { const fit = leastSquares(use); a = fit.a; b = fit.b; }
  }
  while (a - b >= 0) a -= b;       // first beat in the track
  while (a < 0) a += b;
  return { a, b };
}

function leastSquares(pts) {
  let n = 0, sk = 0, st = 0, skk = 0, skt = 0;
  for (const [k, t] of pts) { n++; sk += k; st += t; skk += k * k; skt += k * t; }
  const b = (n * skt - sk * st) / (n * skk - sk * sk), a = (st - b * sk) / n;
  return { a, b };
}

/** Just the frames that hold an onset (most are near zero), so folding many tempos stays quick. */
export function onsetList(env, min = 0.02) {
  let n = 0; for (let i = 0; i < env.length; i++) if (env[i] > min) n++;
  const idx = new Uint32Array(n), val = new Float32Array(n);
  for (let i = 0, j = 0; i < env.length; i++) if (env[i] > min) { idx[j] = i; val[j++] = env[i]; }
  return { idx, val };
}

/**
 * Which beat is the "1"? Sections change on a downbeat, so the low-end energy jumps most at real bar
 * starts. Score each of the 4 possible offsets by how much energy changes across its bar lines.
 */
export function downbeatOffset(env, a, b) {
  const beats = Math.floor((env.length - a) / b);
  if (beats < 32) return 0;
  const e = new Float32Array(beats);
  for (let k = 0; k < beats; k++) { let s = 0; const lo = Math.floor(a + k * b), hi = Math.floor(a + (k + 1) * b); for (let i = lo; i < hi; i++) s += env[i]; e[k] = s; }
  let best = 0, bs = -1;
  for (let o = 0; o < 4; o++) {
    let s = 0;
    for (let k = o + 4; k + 4 <= beats; k += 4) {
      const before = e[k - 4] + e[k - 3] + e[k - 2] + e[k - 1], after = e[k] + e[k + 1] + e[k + 2] + e[k + 3];
      s += Math.abs(after - before);
    }
    if (s > bs) { bs = s; best = o; }
  }
  return best;
}

// ---------- the grid (version 3) ----------
// Tested against rekordbox's own grids (its demo tracks and sampler loops): the beat lands within ~15 ms of
// rekordbox's, where the version 2 grid sat 30-50 ms late and could miss the BPM by 0.2.

/** Onset strength in four bands (bass, low-mid, mid, top), log-compressed, 400 frames a second, for sharp timing. */
const BANDS = [[30, 150, 1], [150, 600, 1], [600, 3000, 1], [3000, 9000, 0.5]];
export function sharpOnsets(x, sr) {
  const hop = Math.max(1, Math.round(sr / 400)), fps = sr / hop, n = Math.floor(x.length / hop);
  const env = new Float32Array(n), per = [];
  for (const [lo, hi, w] of BANDS) {
    const a1 = 1 - Math.exp(-2 * Math.PI * Math.min(hi, sr * 0.45) / sr), a2 = 1 - Math.exp(-2 * Math.PI * lo / sr);
    let s1 = 0, s2 = 0; const e = new Float32Array(n);
    for (let f = 0; f < n; f++) {
      let acc = 0; const o = f * hop;
      for (let j = 0; j < hop; j++) { const v = x[o + j]; s1 += a1 * (v - s1); s2 += a2 * (v - s2); const bp = s1 - s2; acc += bp * bp; }
      e[f] = Math.log1p(1e4 * acc / hop);
    }
    let m = 1e-9;
    for (let f = n - 1; f > 0; f--) { const d = Math.max(0, e[f] - e[f - 1]); e[f] = d; if (d > m) m = d; }
    e[0] = 0;
    for (let f = 0; f < n; f++) { e[f] /= m; env[f] += w * e[f]; }
    per.push(e);
  }
  return { env, fps, per };
}

/**
 * Fold every onset of the track onto one beat of `period` frames. At the right tempo they pile up in one
 * place; a tempo even 0.01 BPM off smears them out over a whole track. Returns how sharp the pile is and
 * where it is (frames into the beat).
 */
export function foldBeat(env, period, bins = 96) {
  const h = new Float64Array(bins), { idx, val } = env.idx ? env : onsetList(env); // an envelope, or onsetList() of one
  for (let j = 0; j < idx.length; j++) { const i = idx[j]; h[Math.floor(((i % period) / period) * bins) % bins] += val[j]; }
  let total = 0, best = 0, bi = 0;
  for (let b = 0; b < bins; b++) { total += h[b]; const s = h[(b + bins - 1) % bins] * 0.5 + h[b] + h[(b + 1) % bins] * 0.5; if (s > best) { best = s; bi = b; } }
  const y0 = h[(bi + bins - 1) % bins], y1 = h[bi], y2 = h[(bi + 1) % bins], den = y0 - 2 * y1 + y2;
  const off = den ? Math.max(-0.5, Math.min(0.5, 0.5 * (y0 - y2) / den)) : 0;
  return { sharp: best / (total / bins || 1), phase: ((bi + 0.5 + off) / bins) * period };
}

/**
 * Which beat is the "1"? Sections change on a bar line, so square the steps between bar energies for each of
 * the 4 possible bar starts: a misplaced bar splits one big step into two half steps, which square to half as
 * much. With no clear sections (a loop, a steady groove), the bar starts on the first strong beat.
 */
export function downbeatFrom(per, fps, a, bl) {
  const beats = Math.floor((per[0].length / fps - a) / bl);
  if (beats < 8) return 0;
  const w = Math.round(0.03 * fps);
  const strength = (e, k) => { const c = Math.round((a + k * bl) * fps); let m = 0; for (let i = Math.max(0, c - w); i <= c + w && i < e.length; i++) if (e[i] > m) m = e[i]; return m; };
  const E = []; for (let k = 0; k < beats; k++) E.push(per.reduce((s, e) => s + strength(e, k), 0));
  const change = (o) => {
    const bars = []; for (let k = o; k + 4 <= beats; k += 4) bars.push(E[k] + E[k + 1] + E[k + 2] + E[k + 3]);
    let s = 0; for (let j = 1; j < bars.length; j++) s += (bars[j] - bars[j - 1]) ** 2;
    return s / Math.max(1, bars.length - 1);
  };
  const c = [0, 1, 2, 3].map(change), order = [0, 1, 2, 3].sort((i, j) => c[j] - c[i]);
  const bar = (E.reduce((s, v) => s + v, 0) / beats) * 4;
  if (c[order[0]] > 1.4 * c[order[1]] && c[order[0]] > (0.05 * bar) ** 2) return order[0];
  const top = Math.max(...E.slice(0, 64)), first = E.findIndex((v) => v > 0.4 * top);
  return first < 0 ? 0 : first % 4;
}

/** BPM, first downbeat (seconds) and a version tag, from mono samples. */
export function analyseGrid(x, sr) {
  // rough tempo from the kick drum, then the exact tempo and beat position from the whole track
  const low = onsetEnvelope(x, sr);
  const bpm0 = roughTempo(low.env.subarray(0, Math.min(low.env.length, Math.floor(low.fps * 75))), low.fps);
  const { env, fps, per } = sharpOnsets(x, sr);
  const onsets = onsetList(env), score = (bpm) => foldBeat(onsets, (fps * 60) / bpm);
  let bpm = bpm0, best = score(bpm0);
  for (const [span, step] of [[0.8, 0.02], [0.03, 0.002], [0.003, 0.0004]]) {
    const c = bpm;
    for (let b = c - span; b <= c + span + 1e-9; b += step) { const s = score(b); if (s.sharp > best.sharp) { best = s; bpm = b; } }
  }
  // most dance music sits on a whole or half BPM: take it when it lines up just as well
  for (const snap of [Math.round(bpm), Math.round(bpm * 2) / 2]) {
    if (Math.abs(snap - bpm) < 0.01) { const s = score(snap); if (s.sharp >= best.sharp * 0.995) { best = s; bpm = snap; break; } }
  }
  const bl = 60 / bpm;
  let a = best.phase / fps;
  while (a - bl >= 0) a -= bl;
  while (a < 0) a += bl;
  const first = a + downbeatFrom(per, fps, a, bl) * bl;
  // fit: how sharply the onsets line up on the grid (a steady kick drum scores high, live drums and pop lower)
  return { bpm: Math.round(bpm * 1000) / 1000, firstDownbeat: Math.round(first * 10000) / 10000, estimated: true, v: GRID_VERSION, fit: Math.round(best.sharp * 100) / 100 };
}
export const GRID_VERSION = 3;
/** Below this fit, the grid may well be wrong (live drums, no steady kick): ask the DJ to check it. */
export const GRID_UNSURE = 2.35;
export const gridUnsure = (g) => !!(g?.estimated && !g.adjusted && g.fit != null && g.fit < GRID_UNSURE);

// ---------- waveform ----------

/**
 * Three-band waveform peaks (low / mid / high), `rate` columns per second (the Learn lane uses 600), each 0..1 of the loudest
 * column. Used for the coloured waveforms, like DJ software.
 */
export function bandPeaks(x, sr, rate = 150) {
  const lo = lowpass(x, sr, 200), lm = lowpass(x, sr, 2500);
  const step = Math.max(1, Math.floor(sr / rate)), n = Math.floor(x.length / step);
  const low = new Float32Array(n), mid = new Float32Array(n), high = new Float32Array(n);
  let ml = 1e-9, mm = 1e-9, mh = 1e-9;
  for (let c = 0; c < n; c++) {
    let a = 0, b = 0, h = 0; const o = c * step;
    for (let j = 0; j < step; j += 2) {
      const i = o + j, l = Math.abs(lo[i]), m = Math.abs(lm[i] - lo[i]), hi = Math.abs(x[i] - lm[i]);
      if (l > a) a = l; if (m > b) b = m; if (hi > h) h = hi;
    }
    low[c] = a; mid[c] = b; high[c] = h;
    if (a > ml) ml = a; if (b > mm) mm = b; if (h > mh) mh = h;
  }
  const top = Math.max(ml, mm, mh);
  for (let c = 0; c < n; c++) { low[c] /= top; mid[c] /= top; high[c] /= top; }
  return { low, mid, high, rate: sr / step };
}

/**
 * "Kick & bass": just the kick drum and bassline, without sounding muffled.
 * A low-pass alone keeps the boom but loses the kick's click (its attack, a few kHz up), which is
 * the part you line a beat grid up with. So: the low end (two cascaded one-poles), plus the
 * 150 Hz–5 kHz band let through for ~25 ms at each low-end hit, so every kick keeps its snap
 * while hats, vocals and pads in between stay out.
 * Takes the channels (Float32Arrays) and sample rate; returns { channels, hits } (hit times, seconds).
 */
export function kickBass(channels, sr) {
  const n = channels[0].length, nc = channels.length;
  const lp2 = (x, hz) => lowpass(lowpass(x, sr, hz), sr, hz);
  // where the low end hits: a fast follower jumping well above a slow one
  const mono = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) mono[i] += c[i] / nc;
  const low = lp2(mono, 150);
  const fa = 1 - Math.exp(-1 / (0.004 * sr)), sa = 1 - Math.exp(-1 / (0.12 * sr));
  let f = 0, sl = 0, peak = 1e-9;
  const fast = new Float32Array(n), slow = new Float32Array(n);
  for (let i = 0; i < n; i++) { const r = Math.abs(low[i]); f += fa * (r - f); sl += sa * (r - sl); fast[i] = f; slow[i] = sl; if (f > peak) peak = f; }
  const cand = [], gap = Math.round(0.12 * sr);
  for (let i = 1, last = -gap; i < n; i++) {
    if (i - last < gap || fast[i] < 0.1 * peak || fast[i] < slow[i] * 1.6) continue;
    cand.push({ i, rise: fast[i] - slow[i] }); last = i;
  }
  // louder hits (kicks) open the gate fully; softer ones (bass notes) a little
  const ref = cand.map((c) => c.rise).sort((a, b) => a - b)[Math.floor(cand.length * 0.8)] || 1;
  const gate = new Float32Array(n);
  const pre = Math.round(0.006 * sr), open = Math.round(0.001 * sr), hold = Math.round(0.02 * sr), rel = 0.035 * sr;
  for (const { i, rise } of cand) {
    const g = Math.min(1, rise / ref) ** 1.5, s0 = Math.max(0, i - pre);
    for (let k = 0; s0 + k < n; k++) {
      const v = k < open ? k / open : k < open + hold ? 1 : Math.exp(-(k - open - hold) / rel);
      if (v < 0.003) break;
      if (g * v > gate[s0 + k]) gate[s0 + k] = g * v;
    }
  }
  const out = channels.map((x) => {
    const lo = lp2(x, 200), body = lp2(x, 150), top = lp2(x, 5000), y = new Float32Array(n);
    for (let i = 0; i < n; i++) y[i] = lo[i] * 1.4 + (top[i] - body[i]) * gate[i] * 0.9;
    return y;
  });
  let m = 1e-9; for (const y of out) for (let i = 0; i < n; i++) { const a = Math.abs(y[i]); if (a > m) m = a; }
  const k = Math.min(4, 0.9 / m);
  for (const y of out) for (let i = 0; i < n; i++) y[i] *= k;
  return { channels: out, hits: cand.map((c) => Math.max(0, c.i - pre) / sr) };
}

/** Average low-end energy per bar, 0..1. */
export function barEnergies(x, sr, grid) {
  const lp = lowpass(x, sr, 150), bl = 240 / grid.bpm;
  const n = Math.floor((x.length / sr - grid.firstDownbeat) / bl);
  const out = new Float32Array(Math.max(0, n)); let max = 1e-9;
  for (let b = 0; b < n; b++) {
    const s0 = Math.floor((grid.firstDownbeat + b * bl) * sr), s1 = Math.floor((grid.firstDownbeat + (b + 1) * bl) * sr);
    let s = 0; for (let i = s0; i < s1; i += 4) s += lp[i] * lp[i];
    out[b] = Math.sqrt(s / ((s1 - s0) / 4)); if (out[b] > max) max = out[b];
  }
  return Array.from(out, (v) => v / max);
}

/**
 * Phrases (16 bars each) labelled the way rekordbox does: Intro, Up (build), Chorus (drop), Down
 * (breakdown), Outro. Loud phrases are choruses; quiet ones are intros before the first chorus, outros
 * after the last, and breakdowns in between; a phrase leading into a chorus that isn't one is a build.
 */
export function phrasesFromEnergy(energies, grid, phraseBars = 16) {
  const bl = 240 / grid.bpm, n = energies.length;
  if (n < phraseBars) return [];
  const blocks = [];
  for (let s = 0; s < n; s += phraseBars) {
    const e = Math.min(n, s + phraseBars);
    if (e - s < phraseBars / 2 && blocks.length) { blocks.at(-1).e = e; continue; } // a short tail joins the last phrase
    const sl = energies.slice(s, e);
    blocks.push({ s, e, v: sl.reduce((a, b) => a + b, 0) / sl.length });
  }
  const sorted = blocks.map((b) => b.v).sort((a, b) => a - b), top = sorted[Math.floor(sorted.length * 0.85)] || sorted.at(-1);
  const loud = blocks.map((b) => b.v >= top * 0.78);
  const first = loud.indexOf(true), last = loud.lastIndexOf(true);
  // A quiet stretch of two or more phrases builds up in its last phrase before a chorus.
  const buildsUp = (i) => loud[i + 1] && i > 0 && !loud[i - 1];
  return blocks.map((b, i) => {
    let label;
    if (loud[i]) label = 'Chorus';
    else if (first < 0 || i < first) label = buildsUp(i) ? 'Up' : 'Intro';
    else if (i > last) label = 'Outro';
    else label = buildsUp(i) ? 'Up' : 'Down';
    return { label, start: grid.firstDownbeat + b.s * bl, end: grid.firstDownbeat + b.e * bl };
  });
}
