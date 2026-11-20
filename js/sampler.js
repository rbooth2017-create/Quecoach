// Sampler: 8 original one-shot sounds, made in code (no sound files), played on the performance pads.
import { ctx, masterBus } from './audio.js';

export const SAMPLES = ['Stab', 'Siren', 'Laser', 'Riser', 'Boom', 'Claps', 'Chord', 'Rewind'];

const SR = 44100;
function render(seconds, fn) {
  const n = Math.floor(seconds * SR), buf = ctx.createBuffer(1, n, SR), d = buf.getChannelData(0);
  let seed = 3; const noise = () => ((seed = (seed * 16807) % 2147483647) / 1073741823.5 - 1);
  let peak = 1e-9;
  for (let i = 0; i < n; i++) { d[i] = fn(i / SR, noise, seconds); if (Math.abs(d[i]) > peak) peak = Math.abs(d[i]); }
  for (let i = 0; i < n; i++) d[i] = (d[i] / peak) * 0.8; // even loudness
  return buf;
}
const saw = (ph) => 2 * (ph - Math.floor(ph + 0.5));
const env = (t, a, r, len) => Math.min(1, t / a) * Math.max(0, 1 - Math.max(0, t - (len - r)) / r);

const MAKERS = [
  // Stab: three detuned saws in a short brassy burst
  () => render(0.7, (t, _n, L) => [1, 1.5, 2.01].reduce((s, m) => s + saw(t * 233 * m), 0) * env(t, 0.005, 0.5, L) * (0.6 + 0.4 * Math.exp(-t * 6))),
  // Siren: a sine sweeping up and down
  () => { let ph = 0; return render(2.2, (t, _n, L) => { ph += (700 + 450 * Math.sin(t * Math.PI * 2 * 1.4)) / SR; return Math.sin(2 * Math.PI * ph) * env(t, 0.05, 0.3, L); }); },
  // Laser: a fast falling zap
  () => { let ph = 0; return render(0.45, (t) => { ph += (3200 * Math.exp(-t * 9) + 120) / SR; return saw(ph) * Math.exp(-t * 6); }); },
  // Riser: filtered noise rising over two bars
  () => { let lp = 0; return render(3.8, (t, n, L) => { const a = 0.02 + 0.5 * (t / L) ** 2; lp += a * (n() - lp); return lp * (t / L) * env(t, 0.01, 0.05, L); }); },
  // Boom: a deep falling sine hit with a noise crack
  () => { let ph = 0; return render(1.6, (t, n) => { ph += (40 + 140 * Math.exp(-t * 18)) / SR; return Math.sin(2 * Math.PI * ph) * Math.exp(-t * 2.4) + n() * Math.exp(-t * 60) * 0.5; }); },
  // Claps: four quick noise bursts
  () => render(0.6, (t, n) => [0, 0.012, 0.024, 0.04].reduce((s, o) => s + (t >= o ? Math.exp(-(t - o) * (o < 0.04 ? 140 : 18)) : 0), 0) * n()),
  // Chord: a soft minor chord stab
  () => render(1.2, (t, _n, L) => [220, 261.6, 329.6, 440].reduce((s, f) => s + saw(t * f) * 0.6 + Math.sin(2 * Math.PI * f * t), 0) * env(t, 0.01, 0.8, L) * Math.exp(-t * 2)),
  // Rewind: noise and a tone sliding down, like a tape stopping
  () => { let ph = 0; return render(1.1, (t, n, L) => { const s = Math.max(0.02, 1 - t / L); ph += (300 * s * s) / SR; return (saw(ph) * 0.7 + n() * 0.25 * s) * env(t, 0.01, 0.1, L); }); },
];

let buffers = null;
const voices = new Map();
const out = ctx.createGain(); out.gain.value = 0.8; out.connect(masterBus);

/** Play sample i (0–7); pressing again restarts it. */
export function playSample(i) {
  buffers ||= MAKERS.map((m) => m());
  stopSample(i);
  ctx.resume();
  const src = ctx.createBufferSource(); src.buffer = buffers[i]; src.connect(out); src.start();
  src.onended = () => { if (voices.get(i) === src) voices.delete(i); };
  voices.set(i, src);
}
export function stopSample(i) { const v = voices.get(i); if (v) { voices.delete(i); try { v.stop(); } catch { /* done */ } } }
export const samplePlaying = (i) => voices.has(i);
export function setSamplerVolume(v) { out.gain.value = v; }
