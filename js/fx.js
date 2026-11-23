// Effects for the Learn app: one effects unit per deck, used by the Pad FX pads and Beat FX.
// Sits between the deck's filter and its channel fader:  in → trans gate → sweep filter → dry → out
//                                                                           ↘ echo send → delay ⟲ → out
//                                                                           ↘ reverb send → convolver → out
import { ctx } from './audio.js';

/** The effects you can pick, in Beat FX order. Pad FX use the same names with their own beat sizes. */
export const FX = [
  { id: 'echo', name: 'Echo' },
  { id: 'reverb', name: 'Reverb' },
  { id: 'trans', name: 'Trans' },
  { id: 'hpf', name: 'High-pass sweep' },
  { id: 'lpf', name: 'Low-pass sweep' },
  { id: 'roll', name: 'Roll' },
];

/** Pad FX banks (PAD FX1 and PAD FX2 on the controller): effect and beat size for each of the 8 pads. */
export const PAD_FX = {
  fx1: [['echo', 0.5], ['echo', 1], ['reverb', 1], ['trans', 0.25], ['roll', 0.25], ['roll', 0.5], ['hpf', 4], ['lpf', 4]],
  fx2: [['echo', 0.25], ['echo', 2], ['reverb', 2], ['trans', 0.125], ['roll', 0.125], ['roll', 1], ['trans', 0.5], ['hpf', 8]],
};
export const padFxLabel = ([id, beats]) => `${FX.find((f) => f.id === id).name.replace(' sweep', '')} ${beats < 1 ? `1/${Math.round(1 / beats)}` : beats}`;

let impulse = null;
/** A reverb tail made of decaying noise (no sound files needed). */
function reverbImpulse(seconds = 2.6) {
  if (impulse) return impulse;
  const sr = ctx.sampleRate, n = Math.floor(seconds * sr);
  impulse = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = impulse.getChannelData(c);
    let seed = 1 + c * 7919; const noise = () => ((seed = (seed * 16807) % 2147483647) / 1073741823.5 - 1);
    for (let i = 0; i < n; i++) d[i] = noise() * Math.pow(1 - i / n, 3.2);
  }
  return impulse;
}

export class FxRack {
  /** deck: the audio.js Deck (for tempo, beat phase and loops). input/output: nodes to sit between. */
  constructor(deck, input, output) {
    this.deck = deck;
    this.gate = ctx.createGain();                        // trans
    this.sweep = ctx.createBiquadFilter(); this.sweep.type = 'allpass';
    this.dry = ctx.createGain();
    this.echoSend = ctx.createGain(); this.echoSend.gain.value = 0;
    this.delay = ctx.createDelay(4); this.feedback = ctx.createGain(); this.feedback.gain.value = 0.45;
    this.revSend = ctx.createGain(); this.revSend.gain.value = 0;
    this.conv = ctx.createConvolver(); this.conv.buffer = reverbImpulse();
    input.connect(this.gate); this.gate.connect(this.sweep); this.sweep.connect(this.dry); this.dry.connect(output);
    this.sweep.connect(this.echoSend); this.echoSend.connect(this.delay); this.delay.connect(this.feedback); this.feedback.connect(this.delay); this.delay.connect(output);
    this.sweep.connect(this.revSend); this.revSend.connect(this.conv); this.conv.connect(output);
    this.active = new Map(); // id → { beats, depth, ... }
  }
  beatSec() { return 60 / (this.deck.bpm || 120); }

  /** Start an effect (held pad or Beat FX on). depth 0..1. */
  start(id, beats = 1, depth = 0.8) {
    this.stop(id, true);
    const now = ctx.currentTime, b = this.beatSec();
    const st = { beats, depth };
    if (id === 'echo') {
      this.delay.delayTime.setTargetAtTime(Math.min(3.9, beats * b), now, 0.01);
      this.echoSend.gain.setTargetAtTime(0.85 * depth, now, 0.01);
      this.feedback.gain.setTargetAtTime(0.35 + 0.3 * depth, now, 0.01);
    } else if (id === 'reverb') {
      this.revSend.gain.setTargetAtTime(Math.min(1.2, (0.5 + 0.8 * depth) * beats), now, 0.02);
    } else if (id === 'trans') {
      // chop on the beat grid: on for the first half of each step, off (down to 1−depth) for the second
      const step = beats * b, phase = this.deck.beatPhase() ?? 0, beatInto = phase * b;
      const first = now + ((step - (beatInto % step)) % step);
      const g = this.gate.gain, low = 1 - depth;
      g.cancelScheduledValues(now); g.setValueAtTime(1, now);
      for (let t = first, i = 0; i < 400; i++, t += step) { g.setValueAtTime(1, t); g.setValueAtTime(low, t + step / 2); }
    } else if (id === 'hpf' || id === 'lpf') {
      const f = this.sweep; f.type = id === 'hpf' ? 'highpass' : 'lowpass'; f.Q.value = 6;
      f.frequency.cancelScheduledValues(now);
      const from = id === 'hpf' ? 40 : 18000, to = id === 'hpf' ? 200 + 6000 * depth : 3000 - 2700 * depth;
      f.frequency.setValueAtTime(from, now); f.frequency.exponentialRampToValueAtTime(to, now + beats * b);
    } else if (id === 'roll') {
      // repeat a short slice; on release, jump to where the track would have been (stays in time)
      const d = this.deck; if (!d.buffer) return;
      st.slip = { pos: d.position(), t: now, rate: d.rate, hadLoop: d.loop };
      const unit = beats * b * (d.rate || 1);
      const start = st.slip.pos - ((st.slip.pos - (d.track.grid?.firstDownbeat || 0)) % unit + unit) % unit;
      d.setLoop({ start, end: start + unit, beats });
    }
    this.active.set(id, st);
  }

  /** Change the depth of a running effect (Beat FX level knob). */
  setDepth(id, depth) {
    const st = this.active.get(id); if (!st) return;
    const now = ctx.currentTime; st.depth = depth;
    if (id === 'echo') { this.echoSend.gain.setTargetAtTime(0.85 * depth, now, 0.02); this.feedback.gain.setTargetAtTime(0.35 + 0.3 * depth, now, 0.02); }
    else if (id === 'reverb') this.revSend.gain.setTargetAtTime(Math.min(1.2, (0.5 + 0.8 * depth) * st.beats), now, 0.02);
    else if (id === 'trans') this.start(id, st.beats, depth);
  }

  stop(id, quiet = false) {
    const st = this.active.get(id); if (!st) return;
    this.active.delete(id);
    const now = ctx.currentTime;
    if (id === 'echo') { this.echoSend.gain.setTargetAtTime(0, now, 0.01); this.feedback.gain.setTargetAtTime(0.45, now, 0.4); } // the tail rings out
    else if (id === 'reverb') this.revSend.gain.setTargetAtTime(0, now, 0.05);
    else if (id === 'trans') { this.gate.gain.cancelScheduledValues(now); this.gate.gain.setValueAtTime(1, now); }
    else if (id === 'hpf' || id === 'lpf') { if (!this.active.has('hpf') && !this.active.has('lpf')) { this.sweep.frequency.cancelScheduledValues(now); this.sweep.type = 'allpass'; } }
    else if (id === 'roll' && !quiet) {
      const d = this.deck, s = st.slip;
      d.clearLoop();
      if (s.hadLoop) d.setLoop(s.hadLoop);
      else d.seek(s.pos + (now - s.t) * s.rate);
    }
  }
  stopAll() { for (const id of [...this.active.keys()]) this.stop(id); }
}
