// Audio: decks, demo synth, per-bar energy analysis, BPM estimate, beatmatch maths.
import { DEMO_STRUCTURE, camelotRoot } from './library.js';
import { barLen, beatLen } from './engine.js';

export const ctx = new (window.AudioContext || window.webkitAudioContext)();
const master = ctx.createGain();
master.connect(ctx.destination);

export class Deck {
  constructor(name) {
    this.name = name;
    this.track = null; this.buffer = null; this.analysis = null; this.peaks = null;
    this.source = null; this.playing = false;
    this.offset = 0; this.anchor = 0;   // position = offset + (now - anchor) * rate
    this.tempoPct = 0; this.bend = 0;
    this.low = ctx.createBiquadFilter(); this.low.type = 'lowshelf'; this.low.frequency.value = 200;
    this.vol = ctx.createGain(); this.xf = ctx.createGain();
    this.low.connect(this.vol); this.vol.connect(this.xf); this.xf.connect(master);
  }
  get rate() { return (1 + this.tempoPct / 100) * (1 + this.bend); }
  get bpm() { return this.track?.grid ? this.track.grid.bpm * (1 + this.tempoPct / 100) : null; }
  position() { return this.playing ? this.offset + (ctx.currentTime - this.anchor) * this.rate : this.offset; }
  load(track, buffer, analysis) {
    this.stop(); this.track = track; this.buffer = buffer; this.analysis = analysis;
    this.peaks = buffer ? computePeaks(buffer) : null;
    this.offset = track.grid?.firstDownbeat || 0;
  }
  play() {
    if (!this.buffer || this.playing) return;
    ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = this.buffer; src.playbackRate.value = this.rate; src.connect(this.low);
    src.start(0, Math.max(0, this.offset));
    src.onended = () => { if (this.source === src) { this.playing = false; this.source = null; } };
    this.source = src; this.anchor = ctx.currentTime; this.playing = true;
  }
  stop() {
    if (this.source) { this.offset = this.position(); const s = this.source; this.source = null; try { s.stop(); } catch { /* already stopped */ } }
    this.playing = false;
  }
  toggle() { this.playing ? this.stop() : this.play(); }
  seek(t) { const was = this.playing; this.stop(); this.offset = Math.max(0, t); if (was) this.play(); }
  reanchor() { this.offset = this.position(); this.anchor = ctx.currentTime; if (this.source) this.source.playbackRate.value = this.rate; }
  setTempo(pct) { this.reanchor(); this.tempoPct = pct; this.reanchor(); }
  setBend(b) { this.reanchor(); this.bend = b; this.reanchor(); }
  setLowEQ(db) { this.low.gain.value = db; }
  setVolume(v) { this.vol.gain.value = v; }
  /** Position inside the current beat / bar, 0..1 */
  beatPhase() { const g = this.track?.grid; if (!g) return null; const x = (this.position() - g.firstDownbeat) / beatLen(g); return x - Math.floor(x); }
  barPhase() { const g = this.track?.grid; if (!g) return null; const x = (this.position() - g.firstDownbeat) / barLen(g); return x - Math.floor(x); }
}

export function setCrossfader(deckA, deckB, x) { // x: 0 = A only, 1 = B only (constant power)
  deckA.xf.gain.value = Math.cos(x * Math.PI / 2);
  deckB.xf.gain.value = Math.sin(x * Math.PI / 2);
}

/**
 * Beatmatch status between the playing deck (ref) and the other (other).
 * phase: how far other's beats are ahead of ref's, in beats (−0.5..0.5).
 */
export function beatmatch(ref, other) {
  if (!ref.track?.grid || !other.track?.grid) return null;
  const bpmDiff = other.bpm - ref.bpm;
  const wrap = (x) => x - Math.round(x);
  const phase = wrap(other.beatPhase() - ref.beatPhase());
  const barOffsetBeats = Math.round(wrap(other.barPhase() - ref.barPhase()) * 4);
  const both = ref.playing && other.playing;
  let tempoAdvice = 'Tempo matched ✓';
  if (Math.abs(bpmDiff) > 0.05) tempoAdvice = `${other.name} is ${Math.abs(bpmDiff).toFixed(2)} BPM ${bpmDiff > 0 ? 'fast — pull its tempo down' : 'slow — push its tempo up'}`;
  let phaseAdvice = '–';
  if (both) phaseAdvice = Math.abs(phase) < 0.04 ? 'Beats aligned ✓' : `${other.name} is ${Math.abs(phase * 1000 * 60 / ref.bpm).toFixed(0)} ms ${phase > 0 ? 'ahead — slow its jog wheel' : 'behind — nudge its jog forward'}`;
  let barAdvice = '';
  if (both && Math.abs(phase) < 0.15) barAdvice = barOffsetBeats === 0 ? 'Downbeats on the same "1" ✓' : `Phrase off by ${Math.abs(barOffsetBeats)} beat${Math.abs(barOffsetBeats) > 1 ? 's' : ''} — restart ${other.name} on a downbeat`;
  return { bpmDiff, phase, barOffsetBeats, tempoAdvice, phaseAdvice, barAdvice, both };
}

// ---------- Waveform peaks & analysis ----------
const PEAK_RATE = 150; // columns per second
function computePeaks(buffer) {
  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(buffer.sampleRate / PEAK_RATE));
  const n = Math.floor(data.length / step);
  const peaks = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0; const o = i * step;
    for (let j = 0; j < step; j += 2) { const v = Math.abs(data[o + j]); if (v > m) m = v; }
    peaks[i] = m;
  }
  return { data: peaks, rate: buffer.sampleRate / step };
}

/** Low-passed signal (~150 Hz one-pole), mono. Used for kick/bass energy. */
function lowpass(buffer) {
  const x = buffer.getChannelData(0), y = new Float32Array(x.length);
  const a = 1 - Math.exp(-2 * Math.PI * 150 / buffer.sampleRate);
  let s = 0;
  for (let i = 0; i < x.length; i++) { s += a * (x[i] - s); y[i] = s; }
  return y;
}

/** Per-bar low-end RMS, normalised 0..1. */
export function barEnergy(buffer, grid) {
  const lp = lowpass(buffer), sr = buffer.sampleRate;
  const bl = barLen(grid);
  const n = Math.floor((buffer.duration - grid.firstDownbeat) / bl);
  const out = new Float32Array(Math.max(0, n));
  let max = 1e-9;
  for (let b = 0; b < n; b++) {
    const s0 = Math.floor((grid.firstDownbeat + b * bl) * sr), s1 = Math.floor((grid.firstDownbeat + (b + 1) * bl) * sr);
    let sum = 0;
    for (let i = s0; i < s1; i += 4) sum += lp[i] * lp[i];
    out[b] = Math.sqrt(sum / ((s1 - s0) / 4));
    if (out[b] > max) max = out[b];
  }
  for (let b = 0; b < n; b++) out[b] /= max;
  return Array.from(out);
}

/** Estimate BPM + first downbeat for files rekordbox didn't give us a grid for. */
export function estimateGrid(buffer) {
  const lp = lowpass(buffer), sr = buffer.sampleRate;
  const hop = Math.floor(sr / 200); // ~5 ms frames
  const HPS = sr / hop;             // exact frames per second
  const len = Math.min(lp.length, sr * 75);
  const env = new Float32Array(Math.floor(len / hop));
  let prev = 0;
  for (let f = 0; f < env.length; f++) {
    let e = 0; const i = f * hop; for (let j = 0; j < hop; j++) e += lp[i + j] * lp[i + j];
    env[f] = Math.max(0, e - prev); prev = e;
  }
  const at = (x) => { const i = Math.floor(x), fr = x - i; return i + 1 < env.length ? env[i] * (1 - fr) + env[i + 1] * fr : 0; };
  // Compare each onset with the ones 1, 2, 4 and 8 beats later: long lags make the tempo precise.
  const score = (bpm) => {
    const lag = HPS * 60 / bpm; let s = 0;
    for (let i = 0; i + 8 * lag < env.length; i++) if (env[i]) s += env[i] * (at(i + lag) + at(i + 2 * lag) + at(i + 4 * lag) + at(i + 8 * lag));
    return s * (bpm >= 100 && bpm <= 150 ? 1 : 0.7); // prefer 100–150 so we don't land on half/double time
  };
  let best = 120, bs = -1;
  for (let bpm = 90; bpm <= 180; bpm += 0.5) { const s = score(bpm); if (s > bs) { bs = s; best = bpm; } }
  const lo = best - 0.6;
  for (let bpm = lo; bpm <= lo + 1.2; bpm += 0.01) { const s = score(bpm); if (s > bs) { bs = s; best = bpm; } }
  const bpm = Math.round(best * 100) / 100;
  const beatF = HPS * 60 / bpm;
  let phase = 0, ps = -1;
  for (let p = 0; p < beatF; p += 0.25) {
    let s = 0; for (let k = p; k < env.length; k += beatF) s += at(k) + 0.5 * at(k + 1);
    if (s > ps) { ps = s; phase = p; }
  }
  // onsets are detected a frame late; shift back half a frame
  return { bpm, firstDownbeat: Math.max(0, phase - 0.5) / HPS, estimated: true };
}

// ---------- Demo synth: a 4/4 track with intro / build / drop / break / outro ----------
export function synthDemoTrack(track) {
  const sr = 22050, g = track.grid, beat = 60 / g.bpm;
  const buffer = ctx.createBuffer(1, Math.ceil(track.duration * sr), sr);
  const out = buffer.getChannelData(0);
  const add = (sample, t, gain = 1) => { const o = Math.floor(t * sr); for (let i = 0; i < sample.length && o + i < out.length; i++) out[o + i] += sample[i] * gain; };
  const kick = new Float32Array(Math.floor(0.3 * sr));
  for (let i = 0, ph = 0; i < kick.length; i++) { const t = i / sr; ph += 2 * Math.PI * (48 + 90 * Math.exp(-t * 30)) / sr; kick[i] = Math.sin(ph) * Math.exp(-t * 9); }
  const hat = new Float32Array(Math.floor(0.05 * sr));
  let seed = 1; const noise = () => ((seed = (seed * 16807) % 2147483647) / 1073741823.5 - 1);
  for (let i = 0; i < hat.length; i++) hat[i] = noise() * Math.exp(-i / sr * 90);
  const clap = new Float32Array(Math.floor(0.12 * sr));
  for (let i = 0; i < clap.length; i++) clap[i] = noise() * Math.exp(-i / sr * 30);
  const root = camelotRoot(track.camelot);
  const f0 = 55 * Math.pow(2, ((root - 9 + 12) % 12) / 12); // bass root around A1
  const minor = track.camelot.endsWith('A');
  const bass = new Float32Array(Math.floor(beat * 0.45 * sr));
  for (let i = 0; i < bass.length; i++) { const t = i / sr; bass[i] = (Math.sin(2 * Math.PI * f0 * t) + 0.3 * Math.sin(4 * Math.PI * f0 * t)) * Math.min(1, t * 200) * Math.exp(-t * 6); }
  const chordFreqs = [0, minor ? 3 : 4, 7].map((s) => f0 * 4 * Math.pow(2, s / 12));
  let bar = 0;
  for (const [section, bars] of DEMO_STRUCTURE) {
    for (let b = 0; b < bars; b++, bar++) {
      const t0 = g.firstDownbeat + bar * 4 * beat;
      for (let k = 0; k < 4; k++) {
        const t = t0 + k * beat;
        const kickOn = section === 'intro' || section === 'drop' || section === 'outro' || (section === 'build' && b >= 8);
        if (kickOn) add(kick, t, 0.9);
        if (section !== 'break') add(hat, t + beat / 2, section === 'drop' ? 0.25 : 0.15);
        if (section === 'drop') { add(bass, t + beat / 2, 0.55); if (k % 2) add(clap, t, 0.3); }
        if (section === 'build' && b >= 8) add(clap, t + (k % 2 ? beat / 2 : 0), 0.1 + 0.02 * (b - 8));
      }
      if (section === 'break' || section === 'build' || (section === 'drop' && b % 4 === 0)) {
        const len = section === 'drop' ? beat * 0.5 : 4 * beat, o = Math.floor(t0 * sr);
        for (let i = 0; i < len * sr && o + i < out.length; i++) {
          const t = i / sr; let v = 0; for (const f of chordFreqs) v += Math.sin(2 * Math.PI * f * t);
          out[o + i] += v * 0.06 * Math.min(1, t * 8) * Math.min(1, (len - t) * 8);
        }
      }
    }
  }
  return buffer;
}
