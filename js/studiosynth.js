// Studio synths: the built-in drum kit, basses, chords, leads and FX, made in code (no sound files).
// Pure maths on Float32Arrays, so it runs in Node tests too. The page wraps the results in AudioBuffers.
import { degreeToMidi, registerBase, parseKey } from './studiomodel.js';

export const SR = 44100;
const TAU = Math.PI * 2;
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const saw = (ph) => 2 * (ph - Math.floor(ph + 0.5));
function noiseGen(seed = 1) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 1073741823.5 - 1); }
/** State-variable filter. f(x, cutoffHz, damping) returns the low-pass; f.band / f.high hold the others. */
function svf() {
  let low = 0, band = 0;
  const f = (x, fc, q = 1) => {
    const g = 2 * Math.sin(Math.PI * Math.min(Math.max(fc, 20), SR / 6) / SR);
    low += g * band; const high = x - low - q * band; band += g * high;
    f.band = band; f.high = high; return low;
  };
  return f;
}
const add = (out, at, i, v) => { const k = at + i; if (k >= 0 && k < out.length) out[k] += v; };

// ---------- drums ----------
function kick(out, at, vel) {
  const n = Math.floor(0.42 * SR), nz = noiseGen(11); let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR; ph += (44 + 120 * Math.exp(-t * 30)) / SR;
    const v = Math.sin(TAU * ph) * Math.exp(-t * 6.5) * Math.min(1, t / 0.0015) + nz() * Math.exp(-t * 400) * 0.12;
    add(out, at, i, Math.tanh(v * 1.4) * 0.85 * vel);
  }
}
function clap(out, at, vel) {
  const n = Math.floor(0.35 * SR), nz = noiseGen(23), f = svf();
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const e = [0, 0.011, 0.022].reduce((s, o) => s + (t >= o && t < o + 0.011 ? Math.exp(-(t - o) * 160) : 0), 0) + (t >= 0.03 ? Math.exp(-(t - 0.03) * 16) : 0);
    f(nz(), 1400, 0.8);
    add(out, at, i, f.band * e * 1.3 * vel);
  }
}
function hat(out, at, vel, open) {
  const n = Math.floor((open ? 0.32 : 0.06) * SR), nz = noiseGen(open ? 41 : 37);
  let prev = 0, y = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, x = nz(); y = 0.6 * (y + x - prev); prev = x; // one-pole high-pass
    add(out, at, i, y * Math.exp(-t * (open ? 10 : 70)) * (open ? 0.2 : 0.22) * vel);
  }
}
function perc(out, at, vel) {
  const n = Math.floor(0.25 * SR), nz = noiseGen(53); let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR; ph += (300 + 140 * Math.exp(-t * 45)) / SR;
    add(out, at, i, (Math.sin(TAU * ph) * Math.exp(-t * 16) + nz() * Math.exp(-t * 200) * 0.2) * 0.38 * vel);
  }
}
const VOICE = { kick, clap, hat: (o, a, v) => hat(o, a, v, false), open: (o, a, v) => hat(o, a, v, true), perc };

// ---------- notes ----------
/** One synth note into out. `len` in seconds (held part); the release rings past it. */
function note(out, at, len, midi, tone, vel = 1) {
  const fq = mtof(midi), rel = { pad: 0.5, bell: 0.9, sub: 0.03 }[tone] ?? 0.06;
  const atk = { pad: Math.min(0.35, len / 3), sub: 0.004, organ: 0.005 }[tone] ?? 0.003;
  const n = Math.floor((len + rel) * SR), f = svf(), f2 = svf();
  let p1 = 0, p2 = 0.33, p3 = 0.67;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.min(1, t / atk) * (t < len ? 1 : Math.max(0, 1 - (t - len) / rel));
    p1 += fq / SR; let v;
    switch (tone) {
      case 'sub': v = (Math.sin(TAU * p1) + 0.18 * Math.sin(2 * TAU * p1)) * 0.5; break;
      case 'reese': p2 += fq * 1.007 / SR; v = f(saw(p1) + saw(p2), 380 + 260 * Math.sin(t * 2.2), 0.9) * 0.3; break;
      case 'acid': v = Math.tanh(f(saw(p1), 180 + 2600 * Math.exp(-t * 11) * vel, 0.18) * 1.8) * 0.26; break;
      case 'pluck': p2 += fq * 1.004 / SR; v = f(saw(p1) + 0.6 * saw(p2), 250 + 3800 * Math.exp(-t * 16), 0.7) * 0.28; break;
      case 'saw': p2 += fq * 1.008 / SR; p3 += fq * 0.992 / SR; v = f(saw(p1) + saw(p2) + saw(p3), 3200, 0.9) * 0.12; break;
      case 'bell': v = Math.sin(TAU * p1 + 2.4 * Math.exp(-t * 5) * Math.sin(TAU * p1 * 3.5)) * Math.exp(-t * 2.8) * 0.3; break;
      case 'stab': p2 += fq * 1.006 / SR; v = f(saw(p1) + saw(p2), 380 + 2600 * Math.exp(-t * 9), 0.8) * 0.13 * Math.exp(-t * 3); break;
      case 'pad': p2 += fq * 1.005 / SR; p3 += fq * 0.995 / SR; v = f2(f(saw(p1) + saw(p2) + saw(p3), 1300, 1), 1300, 1) * 0.07; break;
      case 'organ': v = (Math.sin(TAU * p1) + 0.5 * Math.sin(2 * TAU * p1) + 0.3 * Math.sin(3 * TAU * p1) + 0.15 * Math.sin(4 * TAU * p1)) * 0.09 * Math.exp(-t * 4); break;
      default: v = Math.sin(TAU * p1) * 0.3;
    }
    add(out, at, i, v * env * vel);
  }
}

/** Sidechain-style pump: dips at every beat and swells back, the classic house "breathing". */
function pump(out, beat, depth = 0.6) {
  const b = beat * SR;
  for (let i = 0; i < out.length; i++) { const ph = (i % b) / b; out[i] *= 1 - depth * (1 - Math.min(1, ph / 0.45)) ** 2; }
}

/**
 * One bar of a pattern, as mono samples. The buffer runs past the bar so notes can ring out; the player
 * starts each bar on the beat and lets the tails overlap. opts: { bpm, key, chord (scale degree under
 * this bar), barIn (which bar of the pattern), pump }.
 */
export function renderBar(pat, { bpm, key, chord = 0, barIn = 0, pump: doPump = false }) {
  const beat = 60 / bpm, step = beat / 4, bar = beat * 4;
  const tail = pat.type === 'chords' && pat.tone === 'pad' ? 0.6 : pat.tone === 'bell' ? 1 : beat;
  const out = new Float32Array(Math.ceil((bar + tail) * SR));
  const k = typeof key === 'string' ? parseKey(key) : key;
  const b = barIn % (pat.bars || 1), s0 = b * 16;
  if (pat.type === 'drums') {
    for (const [voice, str] of Object.entries(pat.steps || {})) {
      const play = VOICE[voice]; if (!play || !str) continue;
      for (let i = 0; i < 16; i++) {
        const c = str[s0 + i]; if (c !== 'x' && c !== 'o') continue;
        const t = i * step + (i % 2 ? (pat.swing || 0) * step : 0);
        play(out, Math.round(t * SR), c === 'x' ? 1 : 0.5);
      }
    }
    return out;
  }
  if (pat.type === 'chords') {
    const base = registerBase(k, 'chords');
    const root = chord >= 4 ? chord - 7 : chord;
    const tones = [0, 2, 4].concat(pat.tone === 'pad' ? [6] : []).map((d) => degreeToMidi(root + d, k, base));
    if (pat.tone === 'pad' || pat.hits === 'x') tones.forEach((m) => note(out, 0, bar, m, pat.tone));
    else for (let i = 0; i < 16; i++) if (pat.hits?.[i] === 'x') tones.forEach((m) => note(out, Math.round(i * step * SR), step * (pat.tone === 'organ' ? 2 : 1.5), m, pat.tone));
  } else {
    const reg = pat.type === 'bass' ? 'bass' : 'lead', base = registerBase(k, reg);
    const shift = pat.follow ? (reg === 'bass' && chord >= 4 ? chord - 7 : chord) : 0;
    for (const [s, d, l] of pat.notes || []) {
      if (s < s0 || s >= s0 + 16) continue;
      note(out, Math.round((s - s0) * step * SR), l * step * 0.92, degreeToMidi(d + shift, k, base), pat.tone, 1);
    }
  }
  if (doPump) pump(out, beat, pat.type === 'bass' ? 0.5 : 0.65);
  return out;
}

/** An FX sound that fills `seconds` (risers end right on the next section). */
export function renderFx(kind, seconds) {
  const len = { crash: 3, impact: 2.5 }[kind] ?? seconds;
  const n = Math.ceil(Math.min(len, 32) * SR), out = new Float32Array(n), nz = noiseGen(71), f = svf();
  let ph = 0, y = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, u = i / n;
    switch (kind) {
      case 'riser': { const fc = 250 * 32 ** u; ph += (180 + 900 * u * u) / SR; out[i] = (f(nz(), fc, 0.5) * 0.5 + Math.sin(TAU * ph) * 0.12) * u * u * 0.9; break; }
      case 'downlifter': { const fc = 7000 * (1 / 32) ** u; out[i] = f(nz(), fc, 0.6) * 0.45 * (1 - u) ** 2 * Math.min(1, t / 0.01); break; }
      case 'crash': { const x = nz(); y = 0.7 * (y + x - prev); prev = x; out[i] = y * Math.exp(-t * 1.6) * 0.35; break; }
      case 'impact': ph += (28 + 110 * Math.exp(-t * 18)) / SR; out[i] = (Math.sin(TAU * ph) * Math.exp(-t * 1.8) * 0.8 + nz() * Math.exp(-t * 25) * 0.3); break;
      case 'sweep': { f(nz(), 200 + 6000 * Math.sin(Math.PI * u) ** 2, 0.4); out[i] = f.band * 0.5 * Math.sin(Math.PI * u); break; }
      default: out[i] = 0;
    }
  }
  return out;
}
