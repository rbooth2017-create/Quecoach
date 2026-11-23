// DJ Life: little sound effects, made on the fly with Web Audio (no sound files). Quiet, short and optional:
// they play through their own audio context, so they never touch the decks or the mix recording.

let ac = null;
const ctx = () => {
  if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
};

/** One note: frequency (Hz), start (s from now), length (s), type, volume. */
function note(a, f, at, len, type = 'sine', vol = 0.08) {
  const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + at;
  o.type = type; o.frequency.setValueAtTime(f, t);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + len + 0.02);
}

const SOUNDS = {
  cash: (a) => { [880, 1175, 1568, 2093].forEach((f, i) => note(a, f, i * 0.07, 0.35, 'triangle', 0.07)); },
  buy: (a) => { note(a, 660, 0, 0.12, 'square', 0.04); note(a, 990, 0.08, 0.2, 'square', 0.04); },
  door: (a) => { note(a, 180, 0, 0.12, 'triangle', 0.06); note(a, 140, 0.09, 0.14, 'triangle', 0.05); },
  pick: (a) => note(a, 520, 0, 0.08, 'sine', 0.06),
  drop: (a) => { note(a, 300, 0, 0.1, 'sine', 0.08); note(a, 220, 0.05, 0.12, 'sine', 0.06); },
  nope: (a) => { note(a, 200, 0, 0.1, 'sawtooth', 0.03); note(a, 150, 0.1, 0.14, 'sawtooth', 0.03); },
  week: (a) => { [523, 659, 784].forEach((f, i) => note(a, f, i * 0.1, 0.4, 'sine', 0.06)); },
};

export function play(name) {
  const a = ctx(); const fn = SOUNDS[name];
  if (a && fn) try { fn(a); } catch { /* never let a sound break the game */ }
}
