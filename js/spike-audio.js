// Audio spike (Phase 0): can our own decks replace rekordbox for training?
// Tests: separate headphone cue on the controller's sound card, key lock via WASM time-stretch,
// latency, and jog nudges from a real controller. Throwaway page: spike.html.
import SignalsmithStretch from '/node_modules/signalsmith-stretch/SignalsmithStretch.mjs';
import { stretchParams, jogBend, outputPlan, spikeVerdict } from './deckmath.js';
import { demoLibrary } from './library.js';
import { synthDemoTrack, estimateGrid } from './audio.js';
import { detectController, emptyController, applyMidi } from './controller.js';

const $ = (id) => document.getElementById(id);
const TEMPO_RANGE = 8; // ± %

let ctx = null;
let plan = outputPlan(2);
let masterBus, cueBus, merger;
const decks = [];
const midiDelays = []; // ms between the controller's message and our handler
const state = { device: '', xfader: 0.5, blockMs: 120, controller: null };

// ---------- output routing ----------
function buildBuses() {
  merger?.disconnect(); masterBus?.disconnect(); cueBus?.disconnect();
  plan = outputPlan(ctx.destination.maxChannelCount, Number($('cuePair').value));
  const dest = ctx.destination;
  dest.channelCount = plan.channels; dest.channelCountMode = 'explicit'; dest.channelInterpretation = 'discrete';
  merger = new ChannelMergerNode(ctx, { numberOfInputs: plan.channels });
  merger.connect(dest);
  const stereoBus = (pair) => {
    const bus = new GainNode(ctx, { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
    if (pair) { const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 }); bus.connect(split); split.connect(merger, 0, pair[0]); split.connect(merger, 1, pair[1]); }
    return bus;
  };
  // Re-point the fixed bus nodes at the new merger.
  const m = stereoBus(plan.master), c = stereoBus(plan.cue);
  masterBus.connect(m); cueBus.connect(c);
}
// Buses that decks connect to once; only their downstream routing is rebuilt on device change.
function stretchlessBus() { return new GainNode(ctx, { channelCount: 2, channelCountMode: 'explicit' }); }

async function startAudio() {
  const sinkId = $('device').value;
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    await createDecks();
  }
  if (ctx.setSinkId) { try { await ctx.setSinkId(sinkId); state.device = sinkId; } catch (err) { $('outInfo').textContent = `Couldn't switch device: ${err.message}`; return; } }
  await ctx.resume();
  buildBuses();
  showOutput();
  await listDevices();
}

async function listDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default');
  const sel = $('device'), keep = sel.value;
  sel.innerHTML = '<option value="">System default</option>' + outs.map((d, i) => `<option value="${d.deviceId}">${esc(d.label || `Output ${i + 1}`)}</option>`).join('');
  sel.value = keep;
}

function showOutput() {
  const lat = audioLatency();
  $('outInfo').innerHTML = `Device reports <b>${ctx.destination.maxChannelCount}</b> outputs · using ${plan.channels} · ${ctx.sampleRate} Hz · base ${ms(ctx.baseLatency)} + output ${ms(ctx.outputLatency)} = <b>${ms(lat)}</b><br>`
    + (plan.separateCue ? '<span class="pill ok">Separate headphone cue available</span>' : '<span class="pill bad">Only 2 outputs: no separate headphone cue on this device</span>');
  render();
}

function beep(bus, freq) {
  if (!ctx) return;
  const t = ctx.currentTime + 0.02;
  for (let i = 0; i < 3; i++) {
    const o = new OscillatorNode(ctx, { frequency: freq }), g = new GainNode(ctx, { gain: 0 });
    o.connect(g).connect(bus);
    g.gain.setValueAtTime(0, t + i * 0.3); g.gain.linearRampToValueAtTime(0.3, t + i * 0.3 + 0.01); g.gain.linearRampToValueAtTime(0, t + i * 0.3 + 0.18);
    o.start(t + i * 0.3); o.stop(t + i * 0.3 + 0.2);
  }
}

// ---------- decks ----------
class SpikeDeck {
  constructor(n, node) {
    this.n = n; this.node = node;
    this.track = null; this.grid = null; this.duration = 0;
    this.playing = false; this.tempoPct = 0; this.bend = 0; this.keyLock = true; this.cue = false;
    this.pos = 0; this.posAt = 0; // last reported input time and when we got it
    this.vol = new GainNode(ctx); this.xf = new GainNode(ctx); this.cueGain = new GainNode(ctx, { gain: 0 });
    node.connect(this.vol); this.vol.connect(this.xf).connect(masterBus); this.vol.connect(this.cueGain).connect(cueBus);
    node.setUpdateInterval(0.03, (t) => { this.pos = t; this.posAt = performance.now(); });
    this.bendTimer = null;
  }
  get rate() { return stretchParams(this.tempoPct, this.bend, this.keyLock).rate; }
  get bpm() { return this.grid ? this.grid.bpm * (1 + this.tempoPct / 100) : null; }
  position() { return this.playing ? this.pos + (performance.now() - this.posAt) / 1000 * this.rate : this.pos; }
  async load(track, buffer) {
    this.pause();
    await this.node.dropBuffers();
    const chans = [buffer.getChannelData(0), buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0)];
    await this.node.addBuffers(chans.map((c) => c.slice()));
    this.track = track; this.grid = track.grid; this.duration = buffer.duration;
    this.pos = this.grid?.firstDownbeat || 0; this.posAt = performance.now();
    render();
  }
  apply(extra = {}) {
    const { rate, semitones } = stretchParams(this.tempoPct, this.bend, this.keyLock);
    this.node.schedule({ rate, semitones, ...extra });
  }
  play() { if (!this.track) return; this.playing = true; this.apply({ active: true, input: this.position() }); render(); }
  pause() { if (!this.playing) return; this.pos = this.position(); this.playing = false; this.posAt = performance.now(); this.node.schedule({ active: false }); render(); }
  toggle() { this.playing ? this.pause() : this.play(); }
  setTempo(pct) { this.pos = this.position(); this.posAt = performance.now(); this.tempoPct = Math.max(-TEMPO_RANGE, Math.min(TEMPO_RANGE, pct)); this.apply(); }
  nudge(bend) {
    this.pos = this.position(); this.posAt = performance.now();
    this.bend = bend; this.apply();
    clearTimeout(this.bendTimer);
    this.bendTimer = setTimeout(() => { this.pos = this.position(); this.posAt = performance.now(); this.bend = 0; this.apply(); }, 90);
  }
  setCue(on) { this.cue = on; this.cueGain.gain.value = on ? 1 : 0; render(); }
  beatPhase() { if (!this.grid) return null; const x = (this.position() - this.grid.firstDownbeat) * this.grid.bpm / 60; return x - Math.floor(x); }
}

async function createDecks() {
  masterBus = stretchlessBus(); cueBus = stretchlessBus();
  for (const n of [1, 2]) {
    const node = await SignalsmithStretch(ctx);
    await node.configure({ blockMs: state.blockMs });
    decks.push(new SpikeDeck(n, node));
  }
  setCrossfader(state.xfader);
  // Two demo tracks at slightly different tempos so there is something to beatmatch.
  const lib = demoLibrary(40), a = lib.find((t) => t.bpm > 122 && t.bpm < 125), b = lib.find((t) => t !== a && Math.abs(t.bpm - a.bpm) > 1 && Math.abs(t.bpm - a.bpm) < 4);
  await loadDemo(decks[0], a); await loadDemo(decks[1], b);
}

async function loadDemo(deck, track) {
  const raw = synthDemoTrack(track); // 22.05 kHz mono from the existing demo synth
  await deck.load(track, await resample(raw));
}

async function loadFile(deck, file) {
  const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
  const grid = estimateGrid(buffer);
  await deck.load({ title: file.name.replace(/\.[^.]+$/, ''), artist: 'your file', grid, bpm: grid.bpm }, buffer);
}

/** The stretch node plays samples at the context rate, so convert first. */
function resample(buffer) {
  if (buffer.sampleRate === ctx.sampleRate) return buffer;
  const off = new OfflineAudioContext(buffer.numberOfChannels, Math.ceil(buffer.duration * ctx.sampleRate), ctx.sampleRate);
  const src = new AudioBufferSourceNode(off, { buffer }); src.connect(off.destination); src.start();
  return off.startRendering();
}

function setCrossfader(x) {
  state.xfader = x;
  if (decks.length < 2) return;
  decks[0].xf.gain.value = Math.cos(x * Math.PI / 2);
  decks[1].xf.gain.value = Math.sin(x * Math.PI / 2);
}

async function setBlock(msVal) {
  state.blockMs = msVal;
  for (const d of decks) await d.node.configure({ blockMs: msVal });
  render();
}

// ---------- controller ----------
async function initMidi() {
  if (!navigator.requestMIDIAccess) { $('midiInfo').textContent = 'Web MIDI is not available here.'; return; }
  try {
    const access = await navigator.requestMIDIAccess();
    const hook = () => {
      const found = [];
      for (const input of access.inputs.values()) {
        const profile = detectController(input.name);
        if (!profile) continue;
        const ctl = emptyController();
        input.onmidimessage = (e) => onMidi(profile, ctl, e);
        found.push(profile.name);
      }
      state.controller = found[0] || null;
      render();
    };
    access.onstatechange = hook; hook();
  } catch (err) { $('midiInfo').textContent = `No MIDI access: ${err.message}`; }
}

function onMidi(profile, ctl, e) {
  const delay = performance.now() - e.timeStamp;
  if (delay >= 0 && delay < 1000) { midiDelays.push(delay); if (midiDelays.length > 50) midiDelays.shift(); }
  const hit = applyMidi(profile, ctl, e.data, Date.now(), { tempoRange: TEMPO_RANGE });
  if (!hit) return;
  const [where, what] = hit.split('.');
  const deck = decks[Number(where) - 1];
  if (what === 'play' && deck) deck.toggle();
  else if (what === 'jog' && deck) deck.nudge(jogBend(e.data[2]));
  else if (what === 'tempo' && deck) deck.setTempo(ctl.decks[where].tempo);
  else if (what === 'fader' && deck) deck.vol.gain.value = ctl.decks[where].fader;
  else if (what === 'headphones' && deck) deck.setCue(ctl.decks[where].headphones);
  else if (where === 'mixer' && what === 'crossfader') { setCrossfader(ctl.crossfader); $('xfader').value = ctl.crossfader; }
}

// ---------- readouts ----------
const ms = (s) => (Number.isFinite(s) ? `${(s * 1000).toFixed(1)} ms` : '?');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const audioLatency = () => (ctx ? (ctx.baseLatency || 0) + (ctx.outputLatency || 0) : NaN);
const avgMidi = () => (midiDelays.length ? midiDelays.reduce((a, b) => a + b, 0) / midiDelays.length / 1000 : 0);

function deckHTML(d) {
  const t = d.track;
  return `<div class="panel deck" data-deck="${d.n}">
    <h2>2 · Deck ${d.n}</h2>
    <div><b>${esc(t?.title || 'Empty')}</b> <span class="muted">${esc(t?.artist || '')}</span></div>
    <div class="row"><span class="big" data-bpm="${d.n}">–</span><span class="muted">BPM</span><span class="big" data-pos="${d.n}">${d.position().toFixed(1)}</span><span class="muted">s</span></div>
    <div class="row"><button data-act="play" data-n="${d.n}">${d.playing ? 'Pause' : 'Play'}</button>
      <button data-act="cue" data-n="${d.n}" class="${d.cue ? 'on' : ''}">Headphones</button>
      <label><input type="checkbox" data-act="keylock" data-n="${d.n}" ${d.keyLock ? 'checked' : ''}> Key lock</label>
      <button data-act="nudge-" data-n="${d.n}">◀ Nudge</button><button data-act="nudge+" data-n="${d.n}">Nudge ▶</button></div>
    <div class="row"><span class="muted">Tempo</span><input type="range" data-act="tempo" data-n="${d.n}" min="-${TEMPO_RANGE}" max="${TEMPO_RANGE}" step="0.05" value="${d.tempoPct}"><span data-tempo="${d.n}"></span></div>
    <div class="row"><button data-act="demo" data-n="${d.n}">Another demo track</button><label class="muted">or your own file <input type="file" accept="audio/*" data-act="file" data-n="${d.n}"></label></div>
  </div>`;
}

function render() {
  if (!ctx) return;
  $('decks').innerHTML = decks.map(deckHTML).join('');
  $('midiInfo').innerHTML = state.controller
    ? `<span class="pill ok">${esc(state.controller)}</span> Play, tempo, jog, channel faders, headphone cue and crossfader drive these decks. Average MIDI handling delay: <b>${ms(avgMidi())}</b> over ${midiDelays.length} messages.`
    : 'No supported controller found. Plug one in (FLX4, DDJ-400, DDJ-200, SB3, Inpulse, Mixtrack 3); the on-screen buttons work too.';
  report();
}

function report() {
  const stretchLat = decks[0]?.lastLatency;
  const total = audioLatency() + avgMidi();
  const v = spikeVerdict({ separateCue: plan.separateCue && $('heardSeparate').checked, totalLatency: total, keyLockClean: $('keyLockClean').checked });
  const pill = (ok, yes, no) => `<span class="pill ${ok ? 'ok' : 'bad'}">${ok ? yes : no}</span>`;
  $('verdict').innerHTML = pill(v.separateCue, 'Separate cue ✓', 'Separate cue not confirmed')
    + pill(v.latency, `Latency ${ms(total)} ✓`, `Latency ${ms(total)}`)
    + pill(v.keyLock, 'Key lock clean ✓', 'Key lock not confirmed')
    + `<span class="pill ${v.go ? 'ok' : 'warn'}">${v.go ? 'GO' : 'Not yet'}</span>`;
  $('report').textContent = JSON.stringify({
    date: new Date().toISOString(), userAgent: navigator.userAgent,
    device: $('device').selectedOptions[0]?.textContent, maxChannelCount: ctx.destination.maxChannelCount, plan,
    sampleRate: ctx.sampleRate, baseLatencyMs: +(ctx.baseLatency * 1000).toFixed(1), outputLatencyMs: +((ctx.outputLatency || 0) * 1000).toFixed(1),
    midiDelayMs: +(avgMidi() * 1000).toFixed(2), stretchBlockMs: state.blockMs, stretchLatencyMs: stretchLat != null ? +(stretchLat * 1000).toFixed(1) : null,
    controller: state.controller, heardSeparate: $('heardSeparate').checked, keyLockClean: $('keyLockClean').checked, verdict: v,
  }, null, 2);
}

function tick() {
  for (const d of decks) {
    const q = (k) => document.querySelector(`[data-${k}="${d.n}"]`);
    if (q('pos')) q('pos').textContent = d.position().toFixed(1);
    if (q('bpm')) q('bpm').textContent = d.bpm ? d.bpm.toFixed(2) : '–';
    if (q('tempo')) q('tempo').textContent = `${d.tempoPct >= 0 ? '+' : ''}${d.tempoPct.toFixed(2)} %`;
    const slider = document.querySelector(`input[data-act="tempo"][data-n="${d.n}"]`);
    if (slider && document.activeElement !== slider) slider.value = d.tempoPct;
  }
  const [a, b] = decks;
  if (a?.playing && b?.playing && a.grid && b.grid) {
    const wrap = (x) => x - Math.round(x);
    const phase = wrap(b.beatPhase() - a.beatPhase()), bpmDiff = b.bpm - a.bpm;
    const offMs = phase * 60000 / a.bpm, ok = Math.abs(offMs) < 10 && Math.abs(bpmDiff) < 0.05;
    $('match').className = `pill ${ok ? 'ok' : 'warn'}`;
    $('match').textContent = `Tempo ${bpmDiff >= 0 ? '+' : ''}${bpmDiff.toFixed(2)} BPM · deck 2 is ${Math.abs(offMs).toFixed(0)} ms ${offMs > 0 ? 'ahead' : 'behind'}`;
  } else { $('match').className = 'pill'; $('match').textContent = 'Play both decks to see the beatmatch'; }
  requestAnimationFrame(tick);
}

// ---------- events ----------
$('apply').onclick = async () => { await startAudio(); for (const d of decks) d.lastLatency = await d.node.latency(); render(); };
$('cuePair').onchange = () => { if (ctx) { buildBuses(); showOutput(); } };
$('beepMaster').onclick = () => beep(masterBus, 330);
$('beepCue').onclick = () => beep(cueBus, 880);
$('heardSeparate').onchange = report;
$('keyLockClean').onchange = report;
$('xfader').oninput = (e) => setCrossfader(Number(e.target.value));
$('blockMs').onchange = async (e) => { await setBlock(Number(e.target.value)); for (const d of decks) d.lastLatency = await d.node.latency(); render(); };
$('copy').onclick = () => navigator.clipboard.writeText($('report').textContent);
$('decks').addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const d = decks[Number(el.dataset.n) - 1];
  const act = el.dataset.act;
  if (act === 'play') d.toggle();
  else if (act === 'cue') d.setCue(!d.cue);
  else if (act === 'nudge+') d.nudge(0.04);
  else if (act === 'nudge-') d.nudge(-0.04);
  else if (act === 'demo') { const lib = demoLibrary(40); loadDemo(d, lib[Math.floor(Math.random() * lib.length)]); }
});
$('decks').addEventListener('input', (e) => {
  const el = e.target; const d = decks[Number(el.dataset.n) - 1]; if (!d) return;
  if (el.dataset.act === 'tempo') d.setTempo(Number(el.value));
});
$('decks').addEventListener('change', (e) => {
  const el = e.target; const d = decks[Number(el.dataset.n) - 1]; if (!d) return;
  if (el.dataset.act === 'keylock') { d.keyLock = el.checked; d.apply(); }
  else if (el.dataset.act === 'file' && el.files[0]) loadFile(d, el.files[0]);
});
navigator.mediaDevices?.addEventListener?.('devicechange', listDevices);

listDevices();
initMidi();
requestAnimationFrame(tick);
