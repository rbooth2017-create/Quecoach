// Studio sound: plays a track bar by bar through lane faders, and renders it (or each lane) to audio.
// The same scheduler drives live playback (AudioContext) and export (OfflineAudioContext).
import * as S from './studiomodel.js';
import { SR, renderBar, renderFx } from './studiosynth.js';

// Signalsmith Stretch (MIT, WASM in an AudioWorklet): the same time-stretcher as the decks' key lock.
let stretchLoader = null;
const loadStretch = () => (stretchLoader ??= import('../node_modules/signalsmith-stretch/SignalsmithStretch.mjs').then((m) => m.default));

/**
 * A copy of `buf` played `rate` times as fast and moved by `semitones`, rendered ahead of time so the
 * live mix stays light. The stretcher answers 0.12 s late, so it's fed that much "before the start" and
 * that lead-in is cut off again: the result starts right on the beat.
 */
export async function stretchBuffer(buf, { rate = 1, semitones = 0, voice = false } = {}) {
  const Stretch = await loadStretch();
  const nch = buf.numberOfChannels, sr = buf.sampleRate;
  const outLen = Math.ceil(buf.duration / rate * sr);
  const probe = new OfflineAudioContext(nch, 1, sr);
  const lat = await (await Stretch(probe, { outputChannelCount: [nch] })).latency();
  const pre = Math.ceil(lat * sr);
  const ctx = new OfflineAudioContext(nch, outLen + pre, sr);
  const node = await Stretch(ctx, { outputChannelCount: [nch] });
  node.connect(ctx.destination);
  await node.addBuffers(Array.from({ length: nch }, (_, c) => buf.getChannelData(c)));
  node.schedule({ output: 0, active: true, input: -lat * rate, rate, semitones, ...(voice ? { formantCompensation: true, formantBaseHz: 0 } : {}) });
  const full = await ctx.startRendering();
  const out = new AudioBuffer({ numberOfChannels: nch, length: outLen, sampleRate: sr });
  for (let c = 0; c < nch; c++) out.copyToChannel(full.getChannelData(c).subarray(pre, pre + outLen), c);
  return out;
}

export class StudioEngine {
  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.bars = new Map();      // rendered pattern bars
    this.versions = new Map();  // ref → edit count, so edited patterns render again
    this.decoded = new Map();   // sample id → AudioBuffer
    this.stretched = new Map(); // sample id|plan → AudioBuffer fitted to the track's tempo and key
    this.stretching = new Map(); // the same, while it's being made
    this.live = this.chain(this.ctx);
    this.meter = new AnalyserNode(this.ctx, { fftSize: 1024 });
    this.live.out.connect(this.meter);
    this.sources = new Set();
    this.playing = false;
    this.loop = null;           // [startBar, endBar) to repeat while playing
  }

  /** Lane faders → mix bus → glue compressor → limiter → out. */
  chain(ctx, dest = ctx.destination, { limiter = true } = {}) {
    const lanes = Object.fromEntries(S.LANE_IDS.map((l) => [l, new GainNode(ctx, { gain: S.DEFAULT_GAIN[l] })]));
    const bus = new GainNode(ctx, { gain: 0.72 });
    for (const g of Object.values(lanes)) g.connect(bus);
    const out = new GainNode(ctx);
    if (limiter) {
      const glue = new DynamicsCompressorNode(ctx, { threshold: -10, knee: 6, ratio: 3, attack: 0.01, release: 0.15 });
      const lim = new DynamicsCompressorNode(ctx, { threshold: -1.5, knee: 0, ratio: 20, attack: 0.001, release: 0.08 });
      bus.connect(glue); glue.connect(lim); lim.connect(out);
    } else bus.connect(out);
    out.connect(dest);
    return { lanes, out };
  }

  /** Set the lane faders from the track (mute, solo, volume). */
  applyLanes(p, lanes = this.live.lanes, t = this.ctx.currentTime) {
    const solo = S.LANE_IDS.some((l) => p.lanes[l]?.solo);
    for (const l of S.LANE_IDS) {
      const st = p.lanes[l] || {}, on = !st.mute && (!solo || st.solo);
      if (t != null && lanes[l].gain.setTargetAtTime) lanes[l].gain.setTargetAtTime(on ? st.gain ?? S.DEFAULT_GAIN[l] : 0, t, 0.015);
      else lanes[l].gain.value = on ? st.gain ?? S.DEFAULT_GAIN[l] : 0;
    }
  }

  edited(ref) { this.versions.set(ref, (this.versions.get(ref) || 0) + 1); }
  buffer(data, ctx = this.ctx) { const b = ctx.createBuffer(1, data.length, SR); b.copyToChannel(data, 0); return b; }

  barBuffer(p, ref, pat, bar, barIn) {
    const chord = S.chordAt(p, bar), sub = barIn % (pat.bars || 1);
    const k = `${ref}|${this.versions.get(ref) || 0}|${p.bpm}|${p.key}|${chord}|${sub}|${p.pump ? 1 : 0}`;
    let b = this.bars.get(k);
    if (!b) {
      if (this.bars.size > 600) this.bars.clear();
      b = this.buffer(renderBar(pat, { bpm: p.bpm, key: p.key, chord, barIn: sub, pump: p.pump && pat.type !== 'drums' }));
      this.bars.set(k, b);
    }
    return b;
  }
  fxBuffer(kind, seconds) {
    const k = `fx|${kind}|${seconds.toFixed(3)}`;
    let b = this.bars.get(k);
    if (!b) { b = this.buffer(renderFx(kind, seconds)); this.bars.set(k, b); }
    return b;
  }

  /** Decode every sample the track uses and fit each one to its tempo and key (kept for next time). */
  async loadSamples(p, samples) {
    const ids = new Set();
    for (const c of Object.values(p.cells)) for (const r of Object.values(c)) if (r?.startsWith('s:')) ids.add(r.slice(2));
    await Promise.all([...ids].map(async (id) => { await this.decode(samples[id]); await this.fit(samples[id], p); }));
  }
  /** The sample fitted to the track (stretched and moved into its key), or null to play it as it is. */
  fitted(s, p) {
    const plan = S.stretchPlan(s, p.bpm, p.key);
    return plan.needed ? this.stretched.get(`${s.id}|${plan.id}`) || null : null;
  }
  async fit(s, p) {
    const plan = S.stretchPlan(s, p.bpm, p.key);
    if (!s || !plan.needed) return null;
    const k = `${s.id}|${plan.id}`;
    if (this.stretched.has(k)) return this.stretched.get(k);
    if (!this.stretching.has(k)) {
      this.stretching.set(k, (async () => {
        const buf = await this.decode(s);
        if (!buf) return null;
        try {
          const out = await stretchBuffer(buf, { rate: plan.rate, semitones: plan.semitones, voice: s.lane === 'vocals' });
          for (const old of [...this.stretched.keys()]) if (old.startsWith(`${s.id}|`)) this.stretched.delete(old); // one fitted copy per sample
          this.stretched.set(k, out);
          return out;
        } catch (err) { console.warn('stretch failed', err); return null; } finally { this.stretching.delete(k); }
      })());
    }
    return this.stretching.get(k);
  }
  async decode(s) {
    if (!s?.blob || this.decoded.has(s.id)) return this.decoded.get(s?.id) || null;
    try { const b = await this.ctx.decodeAudioData(await s.blob.arrayBuffer()); this.decoded.set(s.id, b); return b; } catch { return null; }
  }

  /** Start everything in one bar. `only` limits it to one lane (for stems). */
  scheduleBar(ctx, lanes, p, samples, bar, when, { only = null, track = null } = {}) {
    const slot = S.slotAt(p, bar);
    if (!slot) return;
    const barSec = S.barSeconds(p.bpm), cells = p.cells[slot.section.id] || {};
    for (const lane of S.LANE_IDS) {
      if (only && lane !== only) continue;
      const ref = cells[lane], r = S.resolve(p, ref, samples);
      if (!r) continue;
      const start = (buf, { offset = 0, dur, rate = 1, stopAt } = {}) => {
        const src = new AudioBufferSourceNode(ctx, { buffer: buf, playbackRate: rate });
        src.connect(lanes[lane]);
        if (dur != null) src.start(when, offset, dur); else src.start(when, offset);
        if (stopAt) src.stop(stopAt);
        if (track) { track.add(src); src.onended = () => track.delete(src); }
      };
      if (r.kind === 'pattern') {
        if (r.type === 'fx') { if (slot.barIn === 0) start(this.fxBuffer(r.fx, slot.section.bars * barSec)); }
        else start(this.barBuffer(p, ref, r, bar, slot.barIn));
        continue;
      }
      const fit = this.fitted(r, p), buf = fit || this.decoded.get(r.id);
      if (!buf) continue;
      // fitted copies already run at the track's tempo; otherwise play faster or slower (pitch moves with it)
      const rate = fit ? 1 : S.sampleRate(r, p.bpm);
      if (r.mode === 'loop') {
        const per = fit ? barSec : 240 / r.bpm, off = (slot.barIn % Math.max(1, r.bars)) * per;
        if (off < buf.duration - 0.001) start(buf, { offset: off, dur: Math.min(per, buf.duration - off), rate });
      } else {
        const every = Math.max(1, r.bars || 1);
        if (r.repeat === false ? slot.barIn === 0 : slot.barIn % every === 0) {
          const left = (slot.section.bars - slot.barIn) * barSec;
          start(buf, { rate, stopAt: when + Math.min(left, r.repeat === false ? left : every * barSec) });
        }
      }
    }
  }

  // ---------- live playback ----------
  play(p, samples, fromBar = 0) {
    this.stop();
    this.ctx.resume();
    this.p = p; this.samples = samples;
    this.applyLanes(p);
    this.playing = true;
    this.t0 = this.ctx.currentTime + 0.08;
    this.bar0 = fromBar;
    this.next = fromBar;
    this.nextAt = this.t0;
    this.timeline = [];          // [audio time, bar] so position() survives loop jumps
    this.tick();
    this.timer = setInterval(() => this.tick(), 25);
  }
  tick() {
    const p = this.p, total = S.totalBars(p), barSec = S.barSeconds(p.bpm);
    while (this.playing && this.nextAt < this.ctx.currentTime + 0.25) {
      if (this.loop && (this.next >= this.loop[1] || this.next < this.loop[0])) this.next = this.loop[0];
      if (this.next >= total) { if (this.nextAt <= this.ctx.currentTime) { this.stop(); this.onEnd?.(); } return; }
      this.scheduleBar(this.ctx, this.live.lanes, p, this.samples, this.next, this.nextAt, { track: this.sources });
      this.timeline.push([this.nextAt, this.next]);
      if (this.timeline.length > 8) this.timeline.shift();
      this.next++; this.nextAt += barSec;
    }
  }
  /** Where the music is now, in bars (fractional). */
  position() {
    if (!this.playing) return null;
    const now = this.ctx.currentTime - (this.ctx.outputLatency || 0), barSec = S.barSeconds(this.p.bpm);
    let cur = null;
    for (const e of this.timeline) if (e[0] <= now) cur = e;
    if (!cur) return this.bar0;
    return cur[1] + Math.min(1, (now - cur[0]) / barSec);
  }
  stop() {
    this.playing = false;
    clearInterval(this.timer);
    for (const s of this.sources) { try { s.stop(); } catch { /* done */ } }
    this.sources.clear();
  }
  level() {
    const d = new Float32Array(this.meter.fftSize); this.meter.getFloatTimeDomainData(d);
    let pk = 0; for (const v of d) pk = Math.max(pk, Math.abs(v)); return pk;
  }

  /** Hear one loop on its own, for a bar or two (or a sample as it is). */
  async preview(p, ref, samples, { bars = 2 } = {}) {
    this.stopPreview();
    this.ctx.resume();
    const r = S.resolve(p, ref, samples);
    if (!r) return;
    const out = new GainNode(this.ctx, { gain: 0.8 }); out.connect(this.ctx.destination);
    const srcs = [], t = this.ctx.currentTime + 0.05, barSec = S.barSeconds(p.bpm);
    const go = (buf, when, o = {}) => { const s = new AudioBufferSourceNode(this.ctx, { buffer: buf, playbackRate: o.rate || 1 }); s.connect(out); s.start(when, o.offset || 0, o.dur); srcs.push(s); };
    if (r.kind === 'sample') {
      const fit = await this.fit(r, p), buf = fit || await this.decode(r);
      if (buf) go(buf, this.ctx.currentTime + 0.05, { rate: fit ? 1 : S.sampleRate(r, p.bpm), dur: Math.min(buf.duration, 12) });
    } else if (r.type === 'fx') go(this.fxBuffer(r.fx, 4 * barSec), t);
    else for (let b = 0; b < Math.max(bars, r.bars || 1); b++) go(this.barBuffer(p, ref, r, b, b), t + b * barSec);
    this.previewing = { srcs, out };
  }
  stopPreview() {
    if (!this.previewing) return;
    for (const s of this.previewing.srcs) { try { s.stop(); } catch { /* done */ } }
    this.previewing.out.disconnect(); this.previewing = null;
  }

  // ---------- export ----------
  /** The whole track as an AudioBuffer (stereo, 44.1 kHz). With `only`, one lane without the limiter (a stem). */
  async render(p, samples, { only = null } = {}) {
    await this.loadSamples(p, samples);
    const total = S.totalBars(p), barSec = S.barSeconds(p.bpm);
    const ctx = new OfflineAudioContext(2, Math.ceil(total * barSec * SR), SR);
    const ch = this.chain(ctx, ctx.destination, { limiter: !only });
    this.applyLanes(p, ch.lanes, null);
    if (only) ch.lanes[only].gain.value = p.lanes[only]?.gain ?? S.DEFAULT_GAIN[only];
    for (let b = 0; b < total; b++) this.scheduleBar(ctx, ch.lanes, p, samples, b, b * barSec, { only });
    return ctx.startRendering();
  }
}

/** Which lanes have anything in them (for stems). */
export const usedLanes = (p) => S.LANE_IDS.filter((l) => Object.values(p.cells).some((c) => c[l]));
