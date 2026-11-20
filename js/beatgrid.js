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

/** BPM, first downbeat (seconds) and a version tag, from mono samples. */
export function analyseGrid(x, sr) {
  const { env, fps } = onsetEnvelope(x, sr);
  const head = env.subarray(0, Math.min(env.length, Math.floor(fps * 75)));
  const bpm0 = roughTempo(head, fps);
  const period0 = fps * 60 / bpm0;
  const { a, b } = fitGrid(env, fps, period0, beatPhase(head, period0));
  const o = downbeatOffset(env, a, b);
  // onsets register about half a frame late
  const first = Math.max(0, (a + o * b - 0.5) / fps);
  const bpm = Math.round((fps * 60 / b) * 1000) / 1000;
  return { bpm, firstDownbeat: Math.round(first * 10000) / 10000, estimated: true, v: GRID_VERSION };
}
export const GRID_VERSION = 2;

// ---------- waveform ----------

/**
 * Three-band waveform peaks (low / mid / high), `rate` columns per second, each 0..1 of the loudest
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
