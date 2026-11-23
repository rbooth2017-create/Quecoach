// Audio: decks, demo synth, per-bar energy analysis, BPM estimate, beatmatch maths.
import { DEMO_STRUCTURE, camelotRoot } from './library.js';
import { barLen, beatLen } from './engine.js';
import { analyseGrid } from './beatgrid.js';
import { wrapInLoop, keyLockSemitones, heardPosition } from './deckmath.js';

// Saved preferences (js/prefs.js writes them): the audio buffer has to be chosen before the context exists.
const PREFS = (() => { try { return JSON.parse(globalThis.localStorage?.getItem('learn.prefs') || '{}') || {}; } catch { return {}; } })();
const LATENCY = ['interactive', 'balanced', 'playback'].includes(PREFS.latency) ? PREFS.latency : 'interactive';
export const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: LATENCY });
// Stereo buses: a mono track is spread to both sides, so neither speaker nor headphone side goes quiet.
const STEREO = { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' };
const master = new GainNode(ctx, STEREO);
/** The main mix, after the crossfader (the sampler plays in here too). The Master knob is its gain. */
export const masterBus = master;

// ---------- master out: a safety limiter and the master meter ----------
// master → limiter → mainOut → speakers, recordings, booth and the headphones' "room" side.
// The limiter catches peaks above about −1 dBFS, so a hot mix can't clip the speakers or a recording.
const limiter = new DynamicsCompressorNode(ctx, { threshold: -1, knee: 0, ratio: 20, attack: 0.001, release: 0.08 });
/** What the room hears, after the limiter. Record and meter this. */
export const mainOut = new GainNode(ctx, STEREO);
const preMeter = new AnalyserNode(ctx, { fftSize: 512 });          // before the limiter: is the mix too hot?
const outSplit = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
const outMeters = [new AnalyserNode(ctx, { fftSize: 512 }), new AnalyserNode(ctx, { fftSize: 512 })];
master.connect(preMeter);
mainOut.connect(outSplit); outSplit.connect(outMeters[0], 0); outSplit.connect(outMeters[1], 1);
let limiterOn = PREFS.limiter !== false;
function wireLimiter() {
  try { master.disconnect(limiter); } catch { /* not connected */ }
  try { master.disconnect(mainOut); } catch { /* not connected */ }
  try { limiter.disconnect(); } catch { /* not connected */ }
  if (limiterOn) { master.connect(limiter); limiter.connect(mainOut); } else master.connect(mainOut);
}
wireLimiter();
/** Switch the safety limiter on or off. */
export function setLimiter(on) { limiterOn = !!on; wireLimiter(); }
export const limiterState = () => limiterOn;
const meterBuf = new Float32Array(512);
const peakOf = (an) => { an.getFloatTimeDomainData(meterBuf); let p = 0; for (let i = 0; i < meterBuf.length; i += 2) { const v = Math.abs(meterBuf[i]); if (v > p) p = v; } return p; };
/** The master meter: { l, r } peak levels after the limiter (0..1), hot: the mix before the limiter, reduction in dB. */
export function masterLevels() {
  return { l: peakOf(outMeters[0]), r: peakOf(outMeters[1]), hot: peakOf(preMeter), reduction: limiterOn ? -limiter.reduction : 0 };
}
mainOut.connect(ctx.destination);

// ---------- outputs: speakers and headphones ----------
// Decks with Listen on feed cueBus. The headphone feed is a blend of the cue and the main mix
// (the controller's HEADPHONES MIX knob). Where it goes depends on the route (headphones.js):
//   channels: one sound card, speakers on outputs 1-2, headphones on 3-4
//   device:   headphones on a second sound output, through an <audio> element
//   speakers: no separate headphones: the cue plays quietly through the speakers (the old "Listen")
export const cueBus = new GainNode(ctx, STEREO);
const hpCue = new GainNode(ctx, STEREO), hpMaster = new GainNode(ctx, STEREO), hpOut = new GainNode(ctx, STEREO);
cueBus.connect(hpCue); mainOut.connect(hpMaster); hpCue.connect(hpOut); hpMaster.connect(hpOut);
hpMaster.gain.value = 0;
const SPEAKER_CUE = 0.5; // Listen through the speakers: quieter than the room
const speakerCue = ctx.createGain(); speakerCue.gain.value = SPEAKER_CUE; cueBus.connect(speakerCue);
let wiring = [];      // nodes made for the current route, to take down on the next
let hpCtx = null;     // the headphone device's own audio context (closed on the next route)
let hpKeep = null;    // muted <audio> that keeps the headphone stream flowing
export const outputState = { mode: 'speakers', channels: 2, deviceId: null, error: null };

function unwire() {
  try { mainOut.disconnect(ctx.destination); } catch { /* not connected */ }
  try { speakerCue.disconnect(); } catch { /* */ }
  try { hpOut.disconnect(); } catch { /* */ }
  for (const n of wiring) { try { n.disconnect(); } catch { /* */ } }
  wiring = [];
  if (hpCtx) { hpCtx.close().catch(() => {}); hpCtx = null; }
  if (hpKeep) { hpKeep.pause(); hpKeep.srcObject = null; hpKeep = null; }
}

/** Send the main mix and the headphones where the route says. Resolves once the headphone device is playing. */
export async function routeOutputs(route) {
  unwire();
  outputState.error = null;
  const dest = ctx.destination;
  if (route.mode === 'channels' && dest.maxChannelCount >= route.channels) {
    dest.channelCount = route.channels; dest.channelCountMode = 'explicit'; dest.channelInterpretation = 'discrete';
    const merger = new ChannelMergerNode(ctx, { numberOfInputs: route.channels });
    const split = (node, [l, r]) => { const sp = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 }); node.connect(sp); sp.connect(merger, 0, l); sp.connect(merger, 1, r); wiring.push(sp); };
    split(mainOut, route.master); split(hpOut, route.cue);
    merger.connect(dest); wiring.push(merger);
    Object.assign(outputState, { mode: 'channels', channels: route.channels, deviceId: null });
    return outputState;
  }
  dest.channelCount = 2; dest.channelCountMode = 'explicit'; dest.channelInterpretation = 'speakers';
  mainOut.connect(dest);
  if (route.mode === 'device' && route.deviceId) {
    const out = ctx.createMediaStreamDestination(); hpOut.connect(out); wiring.push(out);
    try {
      // A second audio context on the headphone device, so the cue can go to any of its outputs
      // (a controller's headphone socket is outputs 3-4, which an <audio> element can't reach).
      hpCtx = new AudioContext({ sinkId: route.deviceId, latencyHint: 'interactive' });
      const n = hpCtx.destination.maxChannelCount;
      const [l, r] = route.cue && n > Math.max(...route.cue) ? route.cue : [0, 1];
      const chans = Math.max(2, r + 1);
      Object.assign(hpCtx.destination, { channelCount: chans, channelCountMode: 'explicit', channelInterpretation: 'discrete' });
      const src = hpCtx.createMediaStreamSource(out.stream);
      const sp = new ChannelSplitterNode(hpCtx, { numberOfOutputs: 2 }), merger = new ChannelMergerNode(hpCtx, { numberOfInputs: chans });
      src.connect(sp); sp.connect(merger, 0, l); sp.connect(merger, 1, r); merger.connect(hpCtx.destination);
      await hpCtx.resume();
      // the stream only flows while something plays it: a silent element keeps it running in Chromium
      const keep = new Audio(); keep.srcObject = out.stream; keep.muted = true; keep.play().catch(() => {}); hpKeep = keep;
      Object.assign(outputState, { mode: 'device', channels: chans, deviceId: route.deviceId, socket: l === 2 });
      return outputState;
    } catch (err) {
      outputState.error = `Couldn't play to the headphone output: ${err.message}`;
      unwire(); mainOut.connect(dest);
    }
  }
  speakerCue.connect(dest);
  Object.assign(outputState, { mode: 'speakers', channels: 2, deviceId: null });
  return outputState;
}

/** The headphone blend of cue and main mix, as gains (headphones.js headphoneMix). */
export function setHeadphoneMix({ cue, master: m }) { hpCue.gain.value = cue; hpMaster.gain.value = m; }
/** Headphone volume, 0..1 (the controller's own LEVEL knob also works on its socket). */
export function setHeadphoneLevel(v) { hpOut.gain.value = Math.max(0, Math.min(1.5, v)); }

// ---------- booth output: the main mix on a second sound output, with its own level ----------
const boothGain = new GainNode(ctx, STEREO); mainOut.connect(boothGain);
let booth = { ctx: null, keep: null, out: null, deviceId: null };
/** Play the main mix on another output (a booth monitor), or stop with deviceId null. Resolves to an error text or null. */
export async function routeBooth(deviceId, level = 1) {
  boothGain.gain.value = Math.max(0, Math.min(1.5, level));
  if (booth.deviceId === deviceId && (deviceId == null || booth.ctx)) return null;
  if (booth.ctx) { booth.ctx.close().catch(() => {}); }
  if (booth.keep) { booth.keep.pause(); booth.keep.srcObject = null; }
  if (booth.out) { try { boothGain.disconnect(booth.out); } catch { /* */ } }
  booth = { ctx: null, keep: null, out: null, deviceId: null };
  if (!deviceId) return null;
  try {
    const out = ctx.createMediaStreamDestination(); boothGain.connect(out);
    const bctx = new AudioContext({ sinkId: deviceId, latencyHint: 'interactive' });
    bctx.createMediaStreamSource(out.stream).connect(bctx.destination);
    await bctx.resume();
    const keep = new Audio(); keep.srcObject = out.stream; keep.muted = true; keep.play().catch(() => {});
    booth = { ctx: bctx, keep, out, deviceId };
    return null;
  } catch (err) { return `Couldn't play to the booth output: ${err.message}`; }
}
export function setBoothLevel(v) { boothGain.gain.value = Math.max(0, Math.min(1.5, v)); }

/** A short test sound in the speakers or the headphones only, so you can check each is where it should be. */
export function testTone(where = 'headphones') {
  ctx.resume();
  const t0 = ctx.currentTime + 0.05, g = ctx.createGain(); g.gain.value = 0;
  const freqs = where === 'headphones' ? [880, 1320] : [440, 660];
  freqs.forEach((f, i) => {
    const o = ctx.createOscillator(); o.frequency.value = f; o.connect(g);
    o.start(t0 + i * 0.25); o.stop(t0 + i * 0.25 + 0.22);
  });
  for (let i = 0; i < 2; i++) { g.gain.setValueAtTime(0.0001, t0 + i * 0.25); g.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.25 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.25 + 0.2); }
  // into the bus only: headphones get cue (bypassing the mix knob, so it's heard whatever the knob says)
  if (where === 'headphones') g.connect(hpOut); else g.connect(master);
  setTimeout(() => g.disconnect(), 900);
}

// Key lock: Signalsmith Stretch (MIT, WASM in an AudioWorklet), loaded the first time a deck turns key lock on.
let stretchLoader = null;
const loadStretch = () => (stretchLoader ??= import('../node_modules/signalsmith-stretch/SignalsmithStretch.mjs').then((m) => m.default));
/** Stretch block size: smaller is less delay but a little rougher. 60 ms keeps the delay under a 1/16 beat at 128 BPM. */
export const KEYLOCK_BLOCK_MS = 60;

export class Deck {
  constructor(name) {
    this.name = name;
    this.track = null; this.buffer = null; this.analysis = null; this.peaks = null;
    this.source = null; this.playing = false;
    this.offset = 0; this.anchor = 0;   // position = offset + (now - anchor) * rate
    this.tempoPct = 0; this.bend = 0;
    this.loop = null; // { start, end, beats } in track seconds, while a loop is on
    // Key lock: source → input → dry ─────────────→ EQ
    //                          ↘ stretch → wet ↗      (only one of dry/wet is open)
    this.keyLock = false; this.stretch = null; this.lag = 0; this.startedAt = 0; this.startOffset = 0;
    this.keyShift = 0;                         // semitones up or down on top of key lock (Pro tools)
    this.reversed = false; this.rbuffer = null; // playing backwards (reverse / censor)
    this.slipOn = false; this.shadow = null;    // slip: the track carries on silently under a loop or reverse
    this.input = new GainNode(ctx, { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
    this.dry = ctx.createGain(); this.wet = ctx.createGain(); this.wet.gain.value = 0;
    this.low = ctx.createBiquadFilter(); this.low.type = 'lowshelf'; this.low.frequency.value = 200;
    this.vol = ctx.createGain(); this.xf = ctx.createGain();
    this.mid = ctx.createBiquadFilter(); this.mid.type = 'peaking'; this.mid.frequency.value = 1000; this.mid.Q.value = 0.7;
    this.high = ctx.createBiquadFilter(); this.high.type = 'highshelf'; this.high.frequency.value = 3500;
    this.input.connect(this.dry); this.dry.connect(this.low); this.wet.connect(this.low);
    this.low.connect(this.mid); this.mid.connect(this.high); this.high.connect(this.vol); this.vol.connect(this.xf); this.xf.connect(master);
  }
  get rate() { return (1 + this.tempoPct / 100) * (1 + this.bend); }
  get bpm() { return this.track?.grid ? this.track.grid.bpm * (1 + this.tempoPct / 100) : null; }
  /** Where the deck is playing from (track seconds). */
  playhead() {
    if (!this.playing) return this.offset;
    const run = Math.max(0, ctx.currentTime - this.anchor) * this.rate;
    return this.reversed ? Math.max(0, this.offset - run) : wrapInLoop(this.offset + run, this.loop);
  }
  /** Where the listener is: the playhead, minus the key lock's delay. Everything on screen follows this. */
  position() {
    if (!this.playing || !this.lag || this.reversed) return this.playhead();
    const raw = this.offset + Math.max(0, ctx.currentTime - this.anchor) * this.rate;
    return wrapInLoop(heardPosition({ raw, lag: this.lag, rate: this.rate, since: ctx.currentTime - this.startedAt, startOffset: this.startOffset }), this.loop);
  }
  load(track, buffer, analysis) {
    this.stop(); this.loop = null; this.reversed = false; this.rbuffer = null; this.shadow = null;
    this.track = track; this.buffer = buffer; this.analysis = analysis;
    this.peaks = buffer ? computePeaks(buffer) : null;
    this.offset = track.grid?.firstDownbeat || 0;
  }
  /** Play from the current position, now or at `when` (audio clock seconds, for quantise). */
  play(when = 0) {
    if (!this.buffer || this.playing) return;
    ctx.resume();
    const at = Math.max(ctx.currentTime, when || 0);
    const src = ctx.createBufferSource();
    src.buffer = this.reversed ? this.reverseBuffer() : this.buffer; src.playbackRate.value = this.rate; src.connect(this.input);
    if (this.loop && !this.reversed) { src.loop = true; src.loopStart = this.loop.start; src.loopEnd = this.loop.end; }
    src.start(at, Math.max(0, this.reversed ? this.buffer.duration - this.offset : this.offset));
    src.onended = () => { if (this.source === src) { this.playing = false; this.source = null; } };
    this.source = src; this.anchor = this.startedAt = at; this.startOffset = this.offset; this.playing = true;
  }
  /** Jump to `t`, at `when` on the audio clock: the track plays on until then (quantise). */
  jumpAt(t, when) {
    if (!this.playing || !(when > ctx.currentTime + 0.002)) return this.seek(t);
    const old = this.source; this.source = null;
    try { old.stop(when); } catch { /* already stopped */ }
    this.playing = false; this.offset = Math.max(0, t);
    if (this.loop && (this.offset < this.loop.start || this.offset >= this.loop.end)) this.loop = null;
    this.play(when);
  }
  stop() {
    if (this.source) { this.offset = this.playhead(); const s = this.source; this.source = null; try { s.stop(); } catch { /* already stopped */ } }
    this.playing = false;
  }
  toggle() { this.playing ? this.stop() : this.play(); }
  seek(t) {
    const was = this.playing; this.stop(); this.offset = Math.max(0, t);
    if (this.loop && (this.offset < this.loop.start || this.offset >= this.loop.end)) this.loop = null; // jumped out of the loop
    if (was) this.play();
  }
  /** Loop between two points (track seconds). Playback carries on from where it is if that's inside. */
  setLoop(loop) {
    if (this.reversed) this.setReverse(false);
    this.slipStart();
    this.reanchor();
    this.loop = loop;
    const src = this.source;
    if (this.playhead() < loop.start || this.playhead() >= loop.end) return this.seek(loop.start);
    if (src) { src.loopStart = loop.start; src.loopEnd = loop.end; src.loop = true; }
  }
  /** Leave the loop and play on from where it is. */
  clearLoop() {
    if (!this.loop) return;
    this.offset = this.playhead(); this.anchor = ctx.currentTime;
    this.loop = null;
    if (this.source) this.source.loop = false;
    this.slipEnd();
  }
  // ---------- reverse, slip and censor (Pro tools) ----------
  /** The track backwards, made the first time it's needed. */
  reverseBuffer() {
    if (this.rbuffer) return this.rbuffer;
    const b = this.buffer, r = ctx.createBuffer(b.numberOfChannels, b.length, b.sampleRate);
    for (let c = 0; c < b.numberOfChannels; c++) { const src = b.getChannelData(c), dst = r.getChannelData(c); for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i]; }
    return (this.rbuffer = r);
  }
  /** Play backwards from where it is, or forwards again. With slip on, forwards picks up where the track would be. */
  setReverse(on) {
    on = !!on; if (!this.buffer || on === this.reversed) return;
    if (on) { this.loop = null; this.slipStart(); }
    const was = this.playing, p = this.playhead();
    if (this.source) { const s = this.source; this.source = null; try { s.stop(); } catch { /* already stopped */ } }
    this.playing = false; this.reversed = on; this.offset = p;
    if (was) this.play();
    if (!on) this.slipEnd();
  }
  /** Slip mode: loops, reverse and censor play over the track, which carries on silently underneath. */
  setSlip(on) { this.slipOn = !!on; if (!this.slipOn) this.shadow = null; }
  slipStart() { if (this.slipOn && this.playing && !this.shadow) this.shadow = { pos: this.playhead(), t: ctx.currentTime }; }
  /** Back to where the track would have got to. */
  slipEnd() {
    const sh = this.shadow; if (!sh) return;
    this.shadow = null;
    if (!this.playing) return;
    const to = sh.pos + (ctx.currentTime - sh.t) * (1 + this.tempoPct / 100);
    this.seek(Math.min(this.buffer.duration - 0.05, to));
  }
  /** Where the track is underneath while slipping (null when not slipping). */
  slipPosition() { const sh = this.shadow; return sh ? sh.pos + (ctx.currentTime - sh.t) * (1 + this.tempoPct / 100) : null; }
  /** Censor: hold to play backwards; let go and the track is where it would have been. */
  censor(down) {
    if (down) { this.censorSlip = this.slipOn; this.slipOn = true; this.setReverse(true); }
    else { this.setReverse(false); this.slipOn = !!this.censorSlip; }
  }
  reanchor() { this.offset = this.playhead(); this.anchor = ctx.currentTime; if (this.source) this.source.playbackRate.value = this.rate; }
  setTempo(pct) { this.reanchor(); this.tempoPct = pct; this.reanchor(); if (this.needsStretch() && this.stretch) this.stretch.schedule({ semitones: this.semitones() }); }
  /** The pitch change the stretcher adds: undo the tempo's pitch (key lock), plus any key shift. */
  semitones() { return (this.keyLock ? keyLockSemitones(this.tempoPct) : 0) + this.keyShift; }
  needsStretch() { return this.keyLock || this.keyShift !== 0; }
  async ensureStretch() {
    if (this.stretch) return;
    const Stretch = await loadStretch();
    if (this.stretch) return; // a second call got there first
    const node = await Stretch(ctx);
    await node.configure({ blockMs: KEYLOCK_BLOCK_MS });
    this.stretchLatency = await node.latency();
    if (this.stretch || this.disposed) { node.disconnect(); return; }
    this.input.connect(node); node.connect(this.wet);
    this.stretch = node;
  }
  /** Key lock on: changing the tempo keeps the key. Off: the pitch follows the tempo, like a record. */
  async setKeyLock(on) {
    this.keyLock = !!on;
    if (this.needsStretch()) await this.ensureStretch();
    this.applyKeyLock();
  }
  /** Move the key up or down in semitones (−12..12), without changing the speed. */
  async setKeyShift(n) {
    this.keyShift = Math.max(-12, Math.min(12, Math.round(n) || 0));
    if (this.needsStretch()) await this.ensureStretch();
    this.applyKeyLock();
  }
  applyKeyLock() {
    const on = this.needsStretch() && !!this.stretch, t = ctx.currentTime;
    if (on) this.stretch.schedule({ active: true, semitones: this.semitones() });
    // A 20 ms crossfade between the straight and the key-locked sound, so switching doesn't click.
    for (const [g, v] of [[this.dry, on ? 0 : 1], [this.wet, on ? 1 : 0]]) { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(v, t + 0.02); }
    if (!on && this.stretch) this.stretch.schedule({ active: false, output: t + 0.05 }); // stop processing once faded out
    this.lag = on ? this.stretchLatency : 0;
  }
  /** Stop and let go of the audio nodes (when a deck is replaced). */
  dispose() {
    this.stop(); this.disposed = true;
    if (this.stretch) { this.stretch.schedule({ active: false }); this.stretch.disconnect(); this.stretch = null; }
    this.xf.disconnect();
  }
  setBend(b) { this.reanchor(); this.bend = b; this.reanchor(); }
  setLowEQ(db) { this.low.gain.value = db; }
  /** band: 'low' | 'mid' | 'high', gain in dB (−30 = cut) */
  setEQ(band, db) { this[band].gain.value = db; }
  setVolume(v) { this.vol.gain.value = v; }
  /** Position inside the current beat / bar, 0..1 */
  /** Seconds until this deck's next beat (null without a grid or when stopped). */
  toNextBeat() {
    const ph = this.beatPhase(); if (ph == null || !this.playing) return null;
    return ((1 - ph) % 1) * (60 / this.bpm) / (1 + this.bend);
  }
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

/** BPM + first downbeat for files rekordbox didn't give us a grid for: fitted to the kicks of the whole track. */
export function estimateGrid(buffer) {
  return analyseGrid(buffer.getChannelData(0), buffer.sampleRate);
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
