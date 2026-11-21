// Cue Coach "Learn": a beginner-first DJ app. Two decks, a mixer, a music library and a coach that fades
// out as you level up. Works with mouse and keyboard; a controller is optional (later).
import { ctx, Deck, beatmatch, synthDemoTrack, estimateGrid, setCrossfader } from './audio.js';
import { beatLen, barLen, fmtTime, timeOfBar } from './engine.js';
import * as lib from './musiclib.js';
import { readTags, TAG_BYTES } from './tags.js';
import { beatHint, updateAligned, fill, HOLD_S, ALIGN_MS, TEMPO_OK } from './lesson.js';
import { LESSONS, TIERS, lessonById, advanceLesson, stepIndex, nextLesson, courseProgress } from './lessons.js';
import { VIBES, quickSet, setMinutes } from './setbuilder.js';
import { aiStatus, aiSetKey, aiClearKey, buildSetAI, suggestAI } from './coachai.js';
import { keyRelation } from './library.js';
import { bandPeaks, barEnergies, phrasesFromEnergy } from './beatgrid.js';

// Colours that read on every theme: hot cue pads and phrase sections.
const CUE_COLORS = ['#ef4f5c', '#22b573', '#f0a020', '#8b6cf6'];
const PHRASE_COLORS = { Intro: '#2bb5a0', Up: '#f0a020', Chorus: '#ef4f5c', Down: '#8b6cf6', Outro: '#4a90e2', Verse: '#7cbf3a', Bridge: '#c06cd8' };
const phraseColor = (label = '') => PHRASE_COLORS[label] || PHRASE_COLORS[Object.keys(PHRASE_COLORS).find((k) => label.startsWith(k))] || '#888';
const PHRASE_NAMES = { Up: 'Build', Down: 'Breakdown' };
import { LEVELS, featuresFor, tempoRange, suggestLevelUp, levelIndex, eqBands } from './levels.js';
import { JogWheel, jogHTML, dialHTML, setDial, bindDials } from './controls.js';
import { beatCount, phraseOffset, LOOP_SIZES, JUMP_SIZES, loopAt, jumpBy, scaleLoop } from './deckmath.js';
import { planMix, mixCue, partInfo, mixControls, mixSteps, shiftPlan, stepState } from './mixplan.js';
import { FxRack, FX, PAD_FX, padFxLabel } from './fx.js';
import { SAMPLES, playSample, stopSample, samplePlaying } from './sampler.js';

const PAD_MODE_LIST = [['hotcue', 'Cues'], ['loop', 'Loop'], ['jump', 'Jump'], ['fx1', 'FX 1'], ['fx2', 'FX 2'], ['sampler', 'Sampler']];
const BFX_BEATS = [0.25, 0.5, 1, 2, 4, 8];
const beatsLabel = (b) => (b < 1 ? `1/${Math.round(1 / b)}` : String(b));
import { midiToAction, KEEPALIVE, describeAction, hexBytes, flx4Lights, flx4Meters, JOG_STEPS_PER_TURN } from './learnmidi.js';
import { detectController, emptyController } from './controller.js';
import { icon } from './icons.js';

const THEMES = [
  { id: 'auto', name: 'Match my computer', bg: '#f6f5f1', bg2: '#14161b', left: '#2f7df6', right: '#ff6b4a' },
  { id: 'fresh', name: 'Fresh', bg: '#f6f5f1', left: '#2f7df6', right: '#ff6b4a' },
  { id: 'night', name: 'Night', bg: '#14161b', left: '#5b9bff', right: '#ff8566' },
  { id: 'neon', name: 'Neon', bg: '#0e0a1c', left: '#22d3ee', right: '#f472b6' },
  { id: 'sunset', name: 'Sunset', bg: '#fcf1e4', left: '#0e9384', right: '#e8572f' },
  { id: 'studio', name: 'Studio', bg: '#0c0d0e', left: '#2aa6ff', right: '#ffb020' },
];
const desktop = window.cueDesktop || null;

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get: (k, d) => { try { const v = localStorage.getItem(`learn.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(`learn.${k}`, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ---------- state ----------
const SIDES = ['left', 'right'];
const FINE = 0.05; // % per tap: about 0.06 BPM, small enough to land inside the lesson's ±0.1 BPM
const LETTER = { left: 'A', right: 'B' };
const state = {
  welcome: false, source: store.get('source', null), sourceName: '', tracks: [],
  query: '', tab: 'all', target: null, menuOpen: false,
  // My library (desktop app): crates, the open crate, an import in progress, the panel's size, selected rows
  crates: [], crate: store.get('crate', null), importing: null, importMenu: false, editCrate: null,
  libView: store.get('libView', 'normal'), libSel: new Set(),
  analysing: null, scanToken: 0, loading: {},
  level: store.get('level', 'starter'), f: null,
  aligned: 0, alignLocked: false, cleanMixes: store.get('cleanMixes', 0), checkUntil: 0, xfader: 0, jogUsed: false,
  // lessons
  lessonId: store.get('lesson', 'decks'), completed: store.get('completed', []), paneOpen: store.get('paneOpen', true),
  ticked: new Set(), did: new Set(), skippedAny: false, lessonDone: false, played: { left: 0, right: 0 }, blend: null,
  mixDir: null, mixStartBar: null, mixDone: new Set(), // the next-mix guide: direction, where B really started, steps ticked
  // set builder + AI
  set: null, setMinutes: store.get('setMinutes', 60), setVibe: store.get('setVibe', 'journey'), setIdea: '', setBusy: false,
  ai: { hasKey: false }, aiPicks: null, aiBusy: false,
  // Beat FX: effect index, beat size index, channel, level, on
  bfx: { i: 0, b: 2, ch: 'both', depth: 0.6, on: false }, bfxRunning: [], bfxKey: null,
};
state.f = featuresFor(state.level);

const decks = {};
const jogs = {};
function makeDeck(side) {
  const d = new Deck(LETTER[side]);
  // "Listen": a quiet copy of the deck that ignores the crossfader, standing in for headphones.
  d.listenGain = ctx.createGain(); d.listenGain.gain.value = 0;
  d.vol.connect(d.listenGain); d.listenGain.connect(ctx.destination);
  // Level meter, after the channel volume and EQ (before the crossfader), like a real mixer.
  d.meter = ctx.createAnalyser(); d.meter.fftSize = 512; d.vol.connect(d.meter);
  d.meterBuf = new Float32Array(d.meter.fftSize); d.peak = 0;
  d.listening = false; d.eq = { low: 0, mid: 0, high: 0 };
  // Trim (gain) and a filter knob, between the EQ and the channel fader, like a DJ mixer.
  d.trimNode = ctx.createGain(); d.filterNode = ctx.createBiquadFilter();
  d.filterNode.type = 'lowpass'; d.filterNode.frequency.value = 22000; d.filterNode.Q.value = 0.9;
  d.high.disconnect(); d.high.connect(d.trimNode); d.trimNode.connect(d.filterNode);
  d.fx = new FxRack(d, d.filterNode, d.vol); // pad FX and Beat FX
  d.padMode = 'hotcue';
  d.setTrim = (db) => { d.trimNode.gain.value = Math.pow(10, db / 20); };
  /** 0..1: left of centre sweeps a low-pass down, right of centre sweeps a high-pass up, centre is off. */
  d.setFilter = (v) => {
    const f = d.filterNode;
    if (v < 0.47) { f.type = 'lowpass'; f.frequency.value = 22000 * Math.pow(2, -((0.47 - v) / 0.47) * 10); }
    else if (v > 0.53) { f.type = 'highpass'; f.frequency.value = 20 * Math.pow(2, ((v - 0.53) / 0.47) * 10); }
    else { f.type = 'lowpass'; f.frequency.value = 22000; }
  };
  return d;
}
for (const s of SIDES) decks[s] = makeDeck(s);
/** Key lock per deck: remembered, on by default, and only from Improver (Starter hears the pitch follow the speed). */
const keyLockWanted = (side) => !!state.f.keyLock && store.get(`keyLock.${side}`, true);
function applyKeyLock(side) {
  decks[side].setKeyLock(keyLockWanted(side)).catch((err) => { console.warn('Key lock unavailable', err); if (state.f.keyLock) toast('Key lock isn\'t available on this computer.'); });
}
function toggleKeyLock(side) {
  store.set(`keyLock.${side}`, !keyLockWanted(side)); applyKeyLock(side);
  const b = $(`#deck-${side} [data-a="keylock"]`); if (b) { b.classList.toggle('on', keyLockWanted(side)); b.setAttribute('aria-pressed', keyLockWanted(side)); }
  toast(keyLockWanted(side) ? `Key lock on for deck ${LETTER[side]}: changing the speed keeps the key.` : `Key lock off for deck ${LETTER[side]}: the pitch follows the speed, like a record.`);
}
for (const s of SIDES) applyKeyLock(s);
const applyXfader = () => setCrossfader(decks.left, decks.right, state.xfader);
applyXfader();

// ---------- small UI helpers ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3400);
}
function keyBadge(t) {
  const h = lib.keyHue(t?.camelot);
  return h == null ? '<span class="keybadge unknown">–</span>' : `<span class="keybadge" style="background:hsl(${h} 58% 48%)">${esc(t.camelot)}</span>`;
}
const fmtBpm = (b, dp = 1) => (b ? b.toFixed(dp) : '–');
const kbd = (k) => (state.f.keyHints ? k.split(' ').map((x) => `<kbd>${esc(x)}</kbd>`).join(' ') : '');
const duration = (t) => (t.duration ? `${Math.floor(t.duration / 60)}:${String(Math.floor(t.duration % 60)).padStart(2, '0')}` : '');

// ---------- levels ----------
const LEVEL_ICON = ['sparkle', 'level', 'headphones', 'disc'];
function setLevel(id, quiet = false) {
  state.level = LEVELS[levelIndex(id)].id; state.f = featuresFor(state.level);
  store.set('level', state.level);
  for (const s of SIDES) { clampTempo(s); applyKeyLock(s); }
  $('#levelBtn').innerHTML = `${esc(LEVELS[levelIndex(state.level)].name)} ${icon('chevron', 14)}`;
  if (!state.f.upNext && state.tab === 'suggested') state.tab = 'all';
  renderLevels(); renderDecks(); renderMixer(); renderLibrary(); state.coachKey = null;
  if (!quiet) toast(`${LEVELS[levelIndex(state.level)].name}: ${LEVELS[levelIndex(state.level)].blurb}`);
}
function renderLevels() {
  $('#levelList').innerHTML = LEVELS.map((l, i) => `<button class="level ${l.id === state.level ? 'active' : ''}" data-level="${l.id}">${icon(LEVEL_ICON[i], 20)}<b>${esc(l.name)}</b><small>${esc(l.blurb)}</small></button>`).join('');
}
function clampTempo(side) {
  const d = decks[side], r = tempoRange(state.level);
  if (Math.abs(d.tempoPct) > r) d.setTempo(Math.sign(d.tempoPct) * r);
}

// ---------- themes ----------
function applyTheme(id) {
  const t = THEMES.find((x) => x.id === id) || THEMES[0];
  document.documentElement.dataset.theme = t.id; store.set('theme', t.id);
  readColors(); for (const s of SIDES) decks[s]._wave = null;
  renderThemes();
  desktop?.setChrome?.({ bg: colors.card, fg: colors.ink }); // title bar and window background follow the theme
}
function renderThemes() {
  const cur = document.documentElement.dataset.theme;
  $('#themeList').innerHTML = THEMES.map((t) => `<button class="theme ${t.id === cur ? 'active' : ''}" data-theme-id="${t.id}">
    <span class="swatch" style="background:${t.bg2 ? `linear-gradient(135deg, ${t.bg} 50%, ${t.bg2} 50%)` : t.bg}"><i style="background:${t.left}"></i><i style="background:${t.right}"></i></span>
    <b>${esc(t.name)}</b></button>`).join('');
}

// ---------- decks ----------
function deckRole(side) {
  const d = decks[side];
  if (!d.buffer) return '';
  const inRoom = d.playing && d.xf.gain.value > 0.3;
  if (!state.f.friendlyRoles) return inRoom ? 'On air' : d.playing ? 'Playing' : 'Paused';
  if (inRoom) return 'In the room';
  if (d.playing && d.listening) return 'Only you can hear this';
  if (d.playing) return 'Playing quietly';
  return 'Ready';
}

function renderDecks() { for (const s of SIDES) renderDeck(s); }

function renderDeck(side) {
  const d = decks[side], el = $(`#deck-${side}`), f = state.f, t = d.track;
  const head = (title, sub) => `<div class="deck-head"><span class="deck-letter">${LETTER[side]}</span><div style="min-width:0"><div class="title">${title}</div><div class="artist">${sub}</div></div>`;
  if (state.loading[side]) {
    el.innerHTML = `${head('Loading…', esc(state.loading[side]))}<span></span></div><div class="empty-deck"><div class="spinner"></div></div>`;
    jogs[side] = null; return;
  }
  if (!d.buffer) {
    el.innerHTML = `${head(`Deck ${LETTER[side]}`, side === 'left' ? 'Your first track goes here' : 'Your next track goes here')}<span></span></div>
      <div class="empty-deck" data-drop>${icon('music', 28)}<b>No track loaded</b><span class="small">Pick one from the library below, or drag an audio file here.</span>
      <button data-a="choose">${icon('search', 15)} Browse music</button></div>`;
    jogs[side] = null; return;
  }
  const r = tempoRange(state.level);
  const keys = f.keyHints ? `<span>${side === 'left' ? `${kbd('Q')} play` : `${kbd('P')} play · ${kbd('↑ ↓')} speed · ${kbd('← →')} nudge`}</span>` : '';
  el.innerHTML = `
    ${head(esc(t.title), `${keyBadge(t)}<span>${esc(t.artist || 'Unknown artist')}</span>`)}
      <div class="bpm"><b data-bpm>${fmtBpm(d.bpm, 2)}</b><span>BPM${t.grid?.estimated ? ' (est.)' : ''}</span></div></div>
    <canvas class="wave" data-wave title="Click to jump to a bar"></canvas>
    <div class="counter" data-counter>
      <span class="loopb" data-loopb></span>
      <span class="sec" data-sec></span>
    </div>
    <div class="deckbody">
      <div class="transport">
        <button class="play" data-a="play" aria-label="Play or pause (${side === 'left' ? 'Q' : 'P'})" title="Play / pause">${icon(d.playing ? 'pause' : 'play', 22)}</button>
        <button class="round" data-a="restart" aria-label="Back to the first beat" title="Back to the first beat">${icon('restart', 15)}</button>
        <div class="tlabel">Start</div>

      </div>
      ${jogHTML(side, f.keyHints && !state.jogUsed ? 'Spin me to nudge' : '')}
      <div class="pitch" title="Speed: up is faster">
        <button class="round" data-a="faster" aria-label="Faster">${icon('plus', 15)}</button>
        <input type="range" class="vfader" data-a="tempo" min="-${r}" max="${r}" step="0.05" value="${d.tempoPct}" aria-label="Speed">
        <button class="round" data-a="slower" aria-label="Slower">${icon('minus', 15)}</button>
        <div class="val" data-pct></div>
        ${f.keyLock ? `<button class="keylock ${keyLockWanted(side) ? 'on' : ''}" data-a="keylock" aria-pressed="${keyLockWanted(side)}" title="Key lock: change the speed without changing the key">${icon('lock', 12)} Key</button>` : ''}
      </div>
    </div>
    ${f.perfPads ? `<div class="perf">
      <div class="pmodes" role="tablist">${PAD_MODE_LIST.map(([m, name]) => `<button data-pmode="${m}" class="${d.padMode === m ? 'on' : ''}" role="tab">${name}</button>`).join('')}</div>
      <div class="ppads" data-ppads>${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<button class="ppad" data-ppad="${i}"></button>`).join('')}</div>
    </div>` : ''}
    <div class="deckfoot"><span class="role" data-live></span>${keys}<span class="grow"></span>
      ${f.gridEdit && t.grid?.estimated ? `<span class="gridtools" title="Cue Coach worked out this beat grid. If the beats sound off, nudge it.">Grid <button data-grid="-1" aria-label="Move grid earlier">‹</button><button data-grid="1" aria-label="Move grid later">›</button><button data-grid="one" title="Move the &quot;1&quot; to the next beat">1 ›</button></span>` : ''}
      ${f.barCounter ? '<span class="barcount" data-bar></span>' : ''}
      <button class="ghost small" data-a="choose" title="Load a different track">${icon('eject', 14)} Change</button></div>`;
  jogs[side] = new JogWheel($('[data-jog]', el), () => decks[side], (kind) => {
    state.jogUsed = true; $('.jog', el)?.classList.add('used');
    if (kind === 'jog' || kind === 'scrub') state.did.add(kind);
  });
  d._wave = null; // rebuild waveform columns for the new canvas
  requestAnimationFrame(measureLibLift);
}

// ---------- mixer ----------
function renderMixer() {
  const f = state.f, BAND = { high: 'Treble', mid: 'Mid', low: 'Bass' };
  const strip = (side) => {
    const d = decks[side];
    return `<div class="strip" data-side="${side}">
      <div class="strip-name">${LETTER[side]}</div>
      ${eqBands(state.level).map((b) => dialHTML({ id: `${side}:${b}`, label: BAND[b], value: d.eq[b], min: -30, max: 6, def: 0, cut: true })).join('')}
      <div class="fader-row">
        ${f.volume ? `<input type="range" class="vfader" data-vol="${side}" min="0" max="1" step="0.01" value="${d.vol.gain.value}" aria-label="Deck ${LETTER[side]} volume" title="Volume">` : ''}
        <canvas class="meter" data-meter="${side}"></canvas>
      </div>
      <button class="cue ${d.listening ? 'on' : ''}" data-listen="${side}" aria-pressed="${d.listening}" title="Listen: hear deck ${LETTER[side]} yourself, even when the crossfader is away from it">${icon('headphones', 17)}</button>
      <div class="dial-label">Listen</div>
    </div>`;
  };
  const pcol = (side) => `<div class="pc-col" data-pc="${side}">
      <div class="pc-top"><span class="pc-name">${LETTER[side]}</span><span class="pc-beats">${[1, 2, 3, 4].map((n) => `<i>${n}</i>`).join('')}</span></div>
      <div class="pc-line">Bar <b data-pcbar>–</b><span>/16</span> · Phr <b data-pcphrase>–</b></div>
    </div>`;
  $('#mixer').innerHTML = `<div class="label">Mixer</div>
    <div class="pcount" data-pcount title="Where each deck is: beat in the bar, bar in the 16-bar phrase, and which phrase">
      <div class="pc-cols">${pcol('left')}${pcol('right')}</div>
      <div class="pc-foot"><span class="pc-status" data-pstatus></span><button class="pc-align" data-align hidden>Align</button></div>
    </div>
    <div class="strips">${strip('left')}${strip('right')}</div>
    <div class="xf"><span style="color:var(--left)">A</span><input type="range" id="xfader" min="0" max="1" step="0.005" value="${state.xfader}" aria-label="Crossfader" title="Crossfader ([ and ])"><span style="color:var(--right)">B</span></div>
    ${f.beatFx ? `<div class="bfx">
      <div class="label">Beat FX</div>
      <div class="bfx-row"><button data-bfx="prev" aria-label="Previous effect">‹</button><b data-bfxname></b><button data-bfx="next" aria-label="Next effect">›</button></div>
      <div class="bfx-row"><button data-bfx="bdown" aria-label="Shorter">−</button><span data-bfxbeats></span><button data-bfx="bup" aria-label="Longer">+</button></div>
      <div class="bfx-row seg">${['A', 'both', 'B'].map((c) => `<button data-bfxch="${c}">${c === 'both' ? 'A+B' : c}</button>`).join('')}</div>
      <div class="bfx-row">${dialHTML({ id: 'fx:depth', label: 'Level', value: state.bfx.depth, min: 0, max: 1, def: 0.6 })}<button class="bfx-on" data-bfx="on">FX on</button></div>
    </div>` : ''}`;
  $$('#mixer [data-dial]').forEach((x) => setDial(x, +x.dataset.value));
}

function drawMeters() {
  for (const side of SIDES) {
    const d = decks[side], cv = $(`[data-meter="${side}"]`);
    if (!cv || !cv.clientHeight) continue;
    d.meter.getFloatTimeDomainData(d.meterBuf);
    let p = 0; for (let i = 0; i < d.meterBuf.length; i += 2) { const v = Math.abs(d.meterBuf[i]); if (v > p) p = v; }
    d.peak = Math.max(p, d.peak * 0.9); // fast attack, smooth fall
    const { g, w, h } = fitCanvas(cv);
    const n = 14, gap = 2, seg = (h - gap * (n - 1)) / n, lit = Math.round(Math.min(1, d.peak * 1.15) * n);
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
      g.fillStyle = i >= n - 2 ? colors.warn : i >= n - 5 ? colors.close : colors.ok;
      g.globalAlpha = i < lit ? 1 : 0.16;
      g.fillRect(0, h - (i + 1) * seg - i * gap, w, seg);
    }
    g.globalAlpha = 1;
  }
}

/** The coach's view of the mix, used by the lesson and the hint. */
function mixState(dt) {
  const L = decks.left, R = decks.right;
  const bm = L.buffer && R.buffer ? beatmatch(L, R) : null;
  for (const side of SIDES) { const d = decks[side]; if (d.playing && d.bpm) state.played[side] += (dt * d.bpm) / 240; }
  const deckState = (d, side) => ({ loaded: !!d.buffer, playing: d.playing, bpm: d.bpm, title: d.track?.title, camelot: d.track?.camelot, eqLow: d.eq.low, playedBars: state.played[side] });
  const s = {
    left: deckState(L, 'left'), right: deckState(R, 'right'),
    bpmDiff: bm ? bm.bpmDiff : null,
    offsetMs: bm && bm.both ? (bm.phase * 60000) / L.bpm : null,
    barOffset: bm && bm.both ? bm.barOffsetBeats : null,
    xfader: state.xfader, alignedFor: 0,
    keyScore: L.track && R.track ? keyRelation(L.track.camelot, R.track.camelot).score : 0,
    bReady: (() => { const p = currentPlan(); if (!p || p.to !== 'right' || R.playing) return false; return Math.abs(R.position() - p.bStart) < 0.3 && bm && Math.abs(bm.bpmDiff) <= TEMPO_OK; })(),
    did: state.did,
  };
  state.aligned = updateAligned(state.aligned, s, dt);
  if (state.aligned >= HOLD_S) { state.alignLocked = true; state.did.add('wasLocked'); }
  if (!R.playing) state.alignLocked = false;
  // "push it out on purpose": a clear drift after being lined up
  if (state.did.has('wasLocked') && s.offsetMs != null && Math.abs(s.offsetMs) > 60) { state.did.add('driftOut'); state.alignLocked = false; }
  if (s.offsetMs != null && Math.abs(s.offsetMs) > ALIGN_MS) state.alignLocked = false;
  s.alignedFor = state.alignLocked ? HOLD_S : state.aligned;
  return s;
}

// ---------- loading tracks ----------
/** Is this deck playing to the room (playing, channel fader up, crossfader on its side)? */
function isLive(side) { const d = decks[side]; return d.playing && d.xf.gain.value > 0.3 && d.vol.gain.value > 0.05; }

async function loadTo(side, track) {
  if (state.loading[side]) return;
  if (isLive(side)) {
    const other = side === 'left' ? 'right' : 'left';
    toast(`Deck ${LETTER[side]} is playing to the room. Load onto deck ${LETTER[other]}${isLive(other) ? ' after pausing it' : ''}, or pause ${LETTER[side]} first.`);
    const el = $(`#deck-${side}`); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    return;
  }
  state.loading[side] = track.title; renderDeck(side);
  try {
    let buffer;
    if (track.source === 'practice') buffer = synthDemoTrack(track);
    else if (track.source === 'rekordbox') buffer = await ctx.decodeAudioData(await lib.rekordboxDetail(track));
    else if (track.file) buffer = await ctx.decodeAudioData(await (await track.file()).arrayBuffer());
    else throw new Error('this track has no audio file');
    if (!track.grid || track.grid.approx || !track.analysed) { const grid = estimateGrid(buffer); lib.saveAnalysis(track, buffer, grid, track.phrases?.length ? null : phrasesFor(buffer, grid)); }
    else if (!track.phrases?.length && track.grid) { track.phrases = phrasesFor(buffer, track.grid); lib.persistAnalysis(track); }
    const d = decks[side];
    d.stop();
    d.load(track, buffer, null);
    d.bands = bandPeaks(buffer.getChannelData(0), buffer.sampleRate, WAVE_RATE);
    if (side === 'right') state.alignLocked = false;
    state.target = null;
    if (side === 'left' && !decks.right.buffer && state.f.upNext) state.tab = 'suggested'; // what's next?
  } catch (err) {
    console.error(err); toast(`Couldn't load "${track.title}": ${err.message}`);
  } finally {
    delete state.loading[side]; renderDeck(side); renderLibrary();
  }
}

/** Intro / build / chorus / breakdown / outro sections from the audio, when rekordbox didn't give us any. */
function phrasesFor(buffer, grid) {
  try { return phrasesFromEnergy(barEnergies(buffer.getChannelData(0), buffer.sampleRate, grid), grid); } catch { return []; }
}

async function loadDroppedFile(side, file) {
  if (!lib.isAudioFile(file.name)) return toast('That isn\'t an audio file Cue Coach can play.');
  const meta = { name: file.name, relPath: file.name, size: file.size, lastModified: file.lastModified };
  const t = lib.trackFromFile(meta, readTags(await file.slice(0, TAG_BYTES).arrayBuffer()));
  t.source = 'file';
  Object.defineProperty(t, 'file', { value: async () => file, enumerable: false });
  loadTo(side, t);
}

/** Point the user at the library, e.g. "pick a track for deck B". */
function focusLibrary(target = null, tab = null) {
  state.target = target;
  if (tab) state.tab = tab;
  if (state.libView === 'collapsed') setLibView('normal');
  renderLibrary();
  const libEl = $('#library');
  libEl.style.setProperty('--c', target ? `var(--${target})` : 'var(--left)');
  libEl.classList.remove('flash'); void libEl.offsetWidth; libEl.classList.add('flash');
  libEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  $('#search').focus();
}

// ---------- music sources ----------
async function useSource(kind, { fromGesture = true } = {}) {
  const token = ++state.scanToken;
  state.menuOpen = false;
  try {
    if (kind === 'practice') {
      setTracks(lib.practiceLibrary(), 'Practice tracks', kind);
    } else if (kind === 'rekordbox') {
      if (!(await lib.rekordboxAvailable())) { toast(`rekordbox isn't connected${state.rbNote ? `: ${state.rbNote}` : ''}.`); renderSource(); return false; }
      state.analysing = { text: 'Reading your rekordbox library…' }; renderSource();
      setTracks(await lib.loadRekordbox(), 'rekordbox', kind);
    } else if (kind === 'managed') {
      if (!lib.hasManaged()) { toast('My library works in the Cue Coach desktop app.'); return false; }
      state.analysing = { text: 'Opening My library…' }; renderSource();
      const { tracks, crates } = await lib.loadManaged();
      if (token !== state.scanToken) return false;
      state.crates = crates;
      if (state.crate && !crates.some((c) => c.id === state.crate)) state.crate = null;
      setTracks(tracks, 'My library', 'managed');
      analyse(tracks, token);
    } else if (kind === 'folder') {
      if (!lib.canPickFolder()) { $('#dirInput').click(); return false; }
      let handle;
      if (fromGesture) {
        try { handle = await lib.pickFolder(); }
        catch (err) { if (err.name === 'AbortError') throw err; console.warn('folder picker refused, using the plain chooser', err); $('#dirInput').click(); return false; }
      }
      else {
        const saved = await lib.savedFolder();
        if (!saved) return false;
        if (saved.permission !== 'granted') { state.reconnect = saved.handle; renderSource(); renderLibrary(); return false; }
        handle = saved.handle;
      }
      await scanFolder(handle, token);
    }
    store.set('source', kind); state.source = kind;
    return true;
  } catch (err) {
    if (err.name !== 'AbortError') { console.error(err); toast(`Couldn't open your music: ${err.message}`); }
    renderSource();
    return false;
  } finally { if (token === state.scanToken && state.analysing && !state.analysing.spin) { state.analysing = null; renderSource(); } }
}

async function scanFolder(handle, token) {
  state.reconnect = null;
  state.analysing = { text: `Reading ${handle.name}…` }; renderSource();
  const tracks = await lib.scanFolder(handle, (n) => { if (token === state.scanToken) { state.analysing = { text: `Reading ${handle.name}: ${n} tracks…` }; renderSource(); } });
  if (token !== state.scanToken) return;
  if (!tracks.length) toast(`No audio files found in ${handle.name}.`);
  setTracks(tracks, handle.name, 'folder');
  analyse(tracks, token);
}

function analyse(tracks, token) {
  const todo = tracks.filter((t) => !t.analysed && t.file);
  if (!todo.length) { state.analysing = null; renderSource(); return; }
  let done = 0;
  state.analysing = { text: `Finding beats: 0 of ${todo.length}`, spin: true }; renderSource();
  let pending = false;
  lib.analyseInBackground(todo, {
    decode: (ab) => ctx.decodeAudioData(ab),
    estimate: estimateGrid,
    phrases: phrasesFor,
    shouldStop: () => token !== state.scanToken,
    onTrack: () => {
      done++;
      state.analysing = done >= todo.length ? null : { text: `Finding beats: ${done} of ${todo.length}`, spin: true };
      if (!pending) { pending = true; setTimeout(() => { pending = false; renderSource(); renderList(); }, 500); }
    },
  }).then(() => { if (token === state.scanToken) { state.analysing = null; renderSource(); } });
}

function setTracks(tracks, name, kind) {
  state.tracks = tracks; state.sourceName = name; state.source = kind;
  state.libSel = new Set([...state.libSel].filter((id) => tracks.some((t) => t.id === id)));
  renderSource(); renderLibrary();
}

// ---------- library ----------
const SOURCE_ICON = { managed: 'library', folder: 'folder', rekordbox: 'disc', practice: 'sparkle' };
function renderSource() {
  const a = state.analysing;
  const choice = (kind, ic, label, note, disabled = false) => `<button data-source="${kind}" ${disabled ? 'disabled' : ''}>${icon(ic, 16)}<span>${label}<small>${note}</small></span></button>`;
  const im = state.importing, managed = lib.hasManaged();
  const status = im && !im.total
    ? 'Choose music to copy…' // the file dialog is open
    : im ? `<span class="spinner"></span>${esc(`Copying ${Math.min(im.done + 1, im.total)} of ${im.total}${im.current ? `: ${im.current}` : '…'}`)} <button class="ghost small" data-a="cancel-import">Cancel</button>`
    : a ? `${a.spin ? '<span class="spinner"></span>' : ''}${esc(a.text)}` : state.tracks.length ? `${state.tracks.length} track${state.tracks.length === 1 ? '' : 's'}` : '';
  const copyAll = managed && ['folder', 'rekordbox'].includes(state.source) && state.tracks.some(lib.canImport);
  $('#source').innerHTML = `
    <span class="status">${status}</span>
    ${state.source === 'managed' ? `<button data-a="import-menu" aria-haspopup="menu" aria-expanded="${state.importMenu}" title="Copy music into My library">${icon('upload', 15)} Import ${icon('chevron', 14)}</button>
      ${state.importMenu ? `<div class="menu import-menu" role="menu">
        <button data-import="files">${icon('music', 16)}<span>Files…<small>Pick audio files to copy in</small></span></button>
        <button data-import="folder">${icon('folder', 16)}<span>Folder…<small>Copy every track in a folder</small></span></button>
      </div>` : ''}` : ''}
    <button data-a="menu" aria-haspopup="menu" aria-expanded="${state.menuOpen}">${icon(SOURCE_ICON[state.source] || 'sparkle', 15)} ${esc(state.sourceName || 'Choose music')} ${icon('chevron', 14)}</button>
    ${state.menuOpen ? `<div class="menu" role="menu">
      ${choice('managed', 'library', 'My library', managed ? 'Copied into Cue Coach, always there' : 'In the desktop app', !managed)}
      ${choice('practice', 'sparkle', 'Practice tracks', 'Built in, made for learning')}
      ${choice('folder', 'folder', 'Music folder…', 'MP3, WAV, AIFF, FLAC')}
      ${choice('rekordbox', 'disc', 'rekordbox library', state.rbAvailable ? 'Your tracks, grids and keys' : (state.rbNote || 'Not connected'), !state.rbAvailable)}
      ${copyAll ? `<hr><button data-a="copy-all">${icon('upload', 16)}<span>Copy all to My library<small>${state.tracks.filter(lib.canImport).length} tracks, with their beat grids and cues</small></span></button>` : ''}
    </div>` : ''}`;
}

function renderLibrary() {
  $$('#libTabs button').forEach((b) => { b.classList.toggle('active', b.dataset.tab === state.tab); b.classList.toggle('hidden', b.dataset.tab === 'suggested' && !state.f.upNext); });
  const banner = [];
  if (state.reconnect) banner.push(`Cue Coach needs your OK to read <b>${esc(state.reconnect.name)}</b> again. <button class="primary" data-a="reconnect">Reconnect</button>`);
  if (state.target) banner.push(`Choosing a track for <b style="color:var(--${state.target})">deck ${LETTER[state.target]}</b>. Double-click a track, or use its ${LETTER[state.target]} button. <button class="ghost" data-a="untarget">Cancel</button>`);
  $('#libBanner').innerHTML = banner.join(' ');
  renderCrates();
  renderList();
}

const MAX_ROWS = 400;
function renderList() {
  const el = $('#list'), ref = decks.left.track, f = state.f;
  if (state.tab === 'set') { renderSet(el); return markLibSel(); }
  const crate = currentCrate();
  const base = state.source === 'managed' ? lib.tracksInCrate(state.tracks, crate) : state.tracks;
  if (state.source === 'managed' && !state.tracks.length) {
    el.innerHTML = `<div class="empty">${icon('library', 30)}<b>My library is empty</b><span>Copy music in and it stays here, even if the drive it came from is unplugged.<br>Drag audio files onto this panel, or:</span>
      <span class="row-btns"><button class="primary" data-import="files">${icon('music', 15)} Import files…</button><button data-import="folder">${icon('folder', 15)} Import a folder…</button></span></div>`;
    return;
  }
  if (!state.tracks.length) { el.innerHTML = `<div class="empty">${icon('music', 30)}<b>No music yet</b><span>Choose where your music comes from with the button above.</span></div>`; return; }
  if (crate && !base.length) { el.innerHTML = `<div class="empty">${icon('crate', 30)}<b>${esc(crate.name)} is empty</b><span>Open All tracks and drag tracks onto this crate.</span></div>`; return; }
  let rows;
  if (state.tab === 'suggested') {
    if (!ref) { el.innerHTML = `<div class="empty">${icon('sparkle', 30)}<b>Suggestions appear here</b><span>Load a track on deck A and Cue Coach will rank what mixes well after it.</span></div>`; return; }
    rows = lib.rankNext(ref, lib.searchTracks(base, state.query), { exclude: [decks.right.track?.id], limit: 60 });
  } else {
    rows = lib.searchTracks(base, state.query).map((t) => ({ track: t, match: ref && t.id !== ref.id ? lib.friendlyMatch(ref, t) : null }));
  }
  if (!rows.length) { el.innerHTML = `<div class="empty">${icon('search', 30)}<b>Nothing matches "${esc(state.query)}"</b></div>`; return; }
  const loaded = new Map(SIDES.map((s) => [decks[s].track?.id, s]));
  const canAdd = lib.hasManaged() && state.source !== 'managed';
  const head = `<div class="trow head"><span>Key</span><span>Track</span><span class="wide">Artist</span><span>BPM</span><span class="wide">Time</span><span class="wide">${ref ? 'With deck A' : ''}</span><span></span></div>`;
  let aiTop = '';
  if (state.tab === 'suggested') {
    const picks = state.aiPicks?.forId === ref.id ? state.aiPicks : null;
    aiTop = `<div class="ai-bar">${icon('wand', 15)}${state.aiBusy ? '<span class="spinner"></span> The AI coach is thinking…' : picks ? `<span>${esc(picks.note)}</span>` : '<span>Want a second opinion? The AI coach picks 3 and tells you how to mix them in.</span>'}
      <span style="flex:1"></span>${state.aiBusy ? '' : `<button data-a="ask-ai">${picks ? 'Ask again' : 'Ask the AI coach'}</button>`}</div>`
      + (picks ? picks.picks.map((p) => `<div class="trow ai-row" data-id="${esc(p.track.id)}">${keyBadge(p.track)}<span class="t"><span class="ai-badge">AI</span> ${esc(p.track.title)}</span>
        <span class="a wide">${esc(p.track.artist)}</span><span class="n">${fmtBpm(p.track.bpm)}</span><span class="wide"></span>
        <span class="why wide" title="${esc(p.tip)}"><b>${esc(p.why)}</b> ${esc(p.tip)}</span>
        <span class="acts" style="opacity:1"><button class="l" data-load="left">A</button><button class="r" data-load="right">B</button></span></div>`).join('') : '');
    rows = rows.filter((r) => !picks?.picks.some((p) => p.track.id === r.track.id));
  }
  el.innerHTML = aiTop + head + rows.slice(0, MAX_ROWS).map(({ track: t, match: m }) => {
    const matchCell = !m ? '' : f.matchLabels
      ? `<span class="match ${m.level}">${m.label}</span>${f.matchReasons ? ` <span class="why">${esc(m.why.join(' · '))}</span>` : ''}`
      : `<span class="why">${m.pitch.pct != null ? `${m.pitch.pct >= 0 ? '+' : ''}${m.pitch.pct.toFixed(1)}%` : ''}</span>`;
    const bpm = t.bpm ? `${t.bpm.toFixed(1)}${t.analysed ? '' : '<span class="muted"> ~</span>'}` : '<span class="muted">…</span>';
    const on = loaded.get(t.id);
    const extra = crate ? `<button data-row="uncrate" title="Remove from ${esc(crate.name)} (the track stays in My library)" aria-label="Remove from crate">${icon('x', 12)}</button>`
      : canAdd && lib.canImport(t) ? `<button data-row="import" title="Copy into My library" aria-label="Copy into My library">${icon('plus', 12)}</button>` : '';
    return `<div class="trow ${on ? 'loaded' : ''}" data-id="${esc(t.id)}" draggable="true" title="Double-click to load. Drag onto a deck or a crate.">${keyBadge(t)}
      <span class="t">${on ? `<span style="color:var(--${on})">● </span>` : ''}${esc(t.title)}</span><span class="a wide">${esc(t.artist)}</span>
      <span class="n">${bpm}</span><span class="n wide muted">${duration(t)}</span><span class="wide" style="display:flex;gap:6px;min-width:0;align-items:center">${matchCell}</span>
      <span class="acts">${extra}<button class="l" data-load="left" title="Load on deck A">A</button><button class="r" data-load="right" title="Load on deck B">B</button></span></div>`;
  }).join('') + (rows.length > MAX_ROWS ? `<div class="empty small">Showing ${MAX_ROWS} of ${rows.length}. Search to narrow it down.</div>` : '');
  markLibSel();
}

// ---------- My library: crates, copying music in ----------
const TRACK_MIME = 'application/x-cuecoach-track';
const currentCrate = () => (state.source === 'managed' && state.crate ? state.crates.find((c) => c.id === state.crate) || null : null);
const trashName = () => (desktop?.platform === 'win32' ? 'Recycle Bin' : 'Trash');

function renderCrates() {
  const el = $('#crates');
  const show = lib.hasManaged();
  $('#library').classList.toggle('with-crates', show);
  if (!show) { el.innerHTML = ''; return; }
  const inLib = state.source === 'managed', cur = currentCrate();
  const known = new Set(state.tracks.map((t) => t.libId));
  const count = (c) => (inLib ? c.trackIds.filter((id) => known.has(id)).length : c.trackIds.length);
  el.innerHTML = `<div class="crates-title">My library</div>
    <button class="crate ${inLib && !cur ? 'on' : ''}" data-crate="">${icon('library', 15)}<span class="name">All tracks</span><span class="count">${inLib ? state.tracks.length : ''}</span></button>
    ${state.crates.length ? '<div class="crates-title">Crates</div>' : ''}
    ${state.crates.map((c) => state.editCrate === c.id
      ? `<div class="crate editing">${icon('crate', 15)}<input type="text" class="crate-edit" data-crate-edit="${esc(c.id)}" value="${esc(c.name)}" maxlength="80" aria-label="Crate name"></div>`
      : `<div class="crate ${cur?.id === c.id ? 'on' : ''}" data-crate="${esc(c.id)}" role="button" tabindex="0" title="Double-click to rename">${icon('crate', 15)}<span class="name">${esc(c.name)}</span><span class="count">${count(c)}</span>
        <span class="cacts"><button data-crate-a="rename" title="Rename" aria-label="Rename ${esc(c.name)}">${icon('pencil', 12)}</button><button data-crate-a="delete" title="Delete crate" aria-label="Delete ${esc(c.name)}">${icon('trash', 12)}</button></span></div>`).join('')}
    <button class="crate new" data-crate-a="new" title="New crate (you can also drop tracks here)">${icon('plus', 15)}<span class="name">New crate</span></button>`;
  const input = $('[data-crate-edit]', el);
  if (input && document.activeElement !== input) { input.focus(); input.select(); }
}

async function crateOp(op, args) {
  try {
    const r = await desktop.library.crate(op, args);
    state.crates = r.crates;
    return r;
  } catch (err) { toast(`Couldn't change the crate: ${err.message}`); return null; } finally { renderCrates(); renderList(); }
}
async function openCrate(id) {
  state.crate = id || null; store.set('crate', state.crate); state.libSel = new Set();
  if (state.tab === 'set') state.tab = 'all';
  if (state.source !== 'managed') await useSource('managed'); else renderLibrary();
}
async function newCrate(trackIds = []) {
  const r = await crateOp('create', { trackIds });
  if (r?.created) { state.editCrate = r.created.id; renderCrates(); }
}
async function commitCrateName(input, save) {
  const id = input.dataset.crateEdit; if (state.editCrate !== id) return;
  state.editCrate = null;
  if (save && input.value.trim()) await crateOp('rename', { id, name: input.value });
  else renderCrates();
}
async function deleteCrate(id) {
  const c = state.crates.find((x) => x.id === id); if (!c) return;
  if (!confirm(`Delete the crate "${c.name}"?\n\nIts tracks stay in My library.`)) return;
  if (state.crate === id) { state.crate = null; store.set('crate', null); }
  await crateOp('delete', { id });
}

/** Run an import, showing progress, then refresh My library and say what happened. Returns library ids. */
async function importToLibrary(run, { crateId = null } = {}) {
  if (!lib.hasManaged()) { toast('My library works in the Cue Coach desktop app.'); return null; }
  if (state.importing) { toast('Already copying music. Wait for it to finish, or cancel it.'); return null; }
  state.importing = { done: 0, total: 0, base: 0, current: '' }; state.importMenu = false; state.importCancelled = false; renderSource();
  let r = null;
  try { r = await run(); } catch (err) { console.error(err); toast(`Couldn't copy the music: ${err.message}`); }
  state.importing = null;
  if (!r || r.cancelled && !r.added && !r.skipped && !r.failed) { renderSource(); if (r?.busy) toast('Already copying music.'); return null; }
  if (r.empty) { renderSource(); toast('No audio files Cue Coach can play were found there.'); return null; }
  const ids = (r.ids || []).filter(Boolean);
  if (crateId && ids.length) await crateOp('add', { id: crateId, trackIds: ids });
  await refreshManaged(r.library);
  let msg = lib.importSummary(r);
  if (crateId && ids.length) msg += ` · in ${state.crates.find((c) => c.id === crateId)?.name || 'the crate'}`;
  toast(msg);
  if (r.errors?.length) console.warn('not copied:', r.errors);
  return ids;
}
/** Show the latest My library (after an import or a delete) without losing the open crate. */
async function refreshManaged(view) {
  const { tracks, crates } = view ? lib.fromManaged(view) : await lib.loadManaged();
  state.crates = crates;
  if (state.source === 'managed') {
    // keep the objects of tracks already open, so decks and background analysis keep working
    const old = new Map(state.tracks.map((t) => [t.id, t]));
    const merged = tracks.map((t) => old.get(t.id) || t);
    setTracks(merged, 'My library', 'managed');
    analyse(merged.filter((t) => !old.has(t.id)), state.scanToken);
  } else { renderSource(); renderCrates(); }
}
const importDialog = (kind) => importToLibrary(() => desktop.library.importDialog(kind));
const importLibTracks = (tracks, opts) => importToLibrary(() => lib.importTracks(tracks, {
  onBatch: (done, total) => { if (state.importing) Object.assign(state.importing, { base: done, total }); },
  shouldStop: () => !!state.importCancelled,
}), opts);
const importDropped = (files, opts) => importToLibrary(() => lib.importFiles(files), opts);
if (desktop?.library) desktop.library.onProgress((p) => {
  const im = state.importing; if (!im || p.finished) return;
  im.done = im.base + p.done; im.total = Math.max(im.total, im.base + p.total); im.current = p.current;
  if (!im.queued) { im.queued = true; requestAnimationFrame(() => { im.queued = false; if (state.importing === im) renderSource(); }); }
});

async function deleteFromLibrary(ids) {
  const tracks = state.tracks.filter((t) => ids.includes(t.id) && t.libId); if (!tracks.length) return;
  const what = tracks.length === 1 ? `"${tracks[0].title}"` : `${tracks.length} tracks`;
  if (!confirm(`Move ${what} to the ${trashName()}?\n\nThey'll be taken out of My library and every crate.`)) return;
  try { await refreshManaged(await desktop.library.remove(tracks.map((t) => t.libId))); toast(`Moved ${what} to the ${trashName()}.`); } catch (err) { toast(`Couldn't delete: ${err.message}`); }
}

/** Track ids being dragged: the whole selection if the dragged row is in it. */
function dragIds(row) {
  const id = row.dataset.id;
  return state.libSel.has(id) ? [...state.libSel] : [id];
}
const draggedIds = (e) => { try { return JSON.parse(e.dataTransfer.getData(TRACK_MIME) || '[]'); } catch { return []; } };
const hasTracks = (e) => [...(e.dataTransfer?.types || [])].includes(TRACK_MIME);
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

/** Drop tracks (from any source) or audio files onto a crate, All tracks, or New crate. */
async function dropOnCrate(target, e) {
  const crateId = target.dataset.crate || null, isNew = target.dataset.crateA === 'new';
  let ids = [];
  if (hasTracks(e)) {
    const tracks = draggedIds(e).map((id) => state.tracks.find((t) => t.id === id)).filter(Boolean);
    const own = tracks.filter((t) => t.libId).map((t) => t.libId);
    const others = tracks.filter((t) => !t.libId && lib.canImport(t));
    if (tracks.length && !own.length && !others.length) return toast('Practice tracks can\'t be copied into My library.');
    ids = own;
    if (others.length) ids = ids.concat((await importLibTracks(others)) || []);
  } else if (hasFiles(e)) ids = (await importDropped([...e.dataTransfer.files])) || [];
  if (!ids.length) return;
  if (isNew) return newCrate(ids);
  if (crateId) {
    const r = await crateOp('add', { id: crateId, trackIds: ids });
    if (r && hasTracks(e)) toast(`Added to ${state.crates.find((c) => c.id === crateId)?.name || 'the crate'}.`);
  }
}

// ---------- library panel size: normal, expanded (over the decks, below their titles) or collapsed ----------
function setLibView(v) {
  state.libView = ['expanded', 'collapsed'].includes(v) ? v : 'normal';
  store.set('libView', state.libView);
  applyLibView();
}
function applyLibView() {
  const st = $('.stage'), v = state.libView;
  st.classList.toggle('lib-expanded', v === 'expanded');
  st.classList.toggle('lib-collapsed', v === 'collapsed');
  const ex = $('#libExpand'), co = $('#libCollapse');
  ex.innerHTML = icon(v === 'expanded' ? 'restore' : 'expand', 16);
  ex.title = v === 'expanded' ? 'Back to normal size' : 'Make the library bigger'; ex.setAttribute('aria-pressed', v === 'expanded');
  co.innerHTML = icon(v === 'collapsed' ? 'restore' : 'collapse', 16);
  co.title = v === 'collapsed' ? 'Show the library' : 'Shrink the library to its header'; co.setAttribute('aria-pressed', v === 'collapsed');
  measureLibLift();
}
/** How far the expanded library reaches up: to just below the decks' title rows. */
function measureLibLift() {
  if (state.libView !== 'expanded') return;
  const row = $('.decks-row'), heads = $$('.decks-row .deck-head');
  if (!row || !heads.length) return;
  const rowBottom = row.getBoundingClientRect().bottom, headBottom = Math.max(...heads.map((h) => h.getBoundingClientRect().bottom));
  const gap = parseFloat(getComputedStyle($('.stage')).rowGap) || 10;
  $('.stage').style.setProperty('--lib-lift', `${Math.max(0, Math.round(rowBottom + gap - headBottom - 8))}px`);
}

// ---------- lessons ----------
const lesson = () => lessonById(state.lessonId);

function startLesson(id) {
  state.lessonId = lessonById(id).id; store.set('lesson', state.lessonId);
  state.ticked = new Set(); state.did = new Set(); state.skippedAny = false; state.lessonDone = false;
  state.played = { left: 0, right: 0 }; state.alignLocked = false; state.coachKey = null; state.blend = null;
  renderTutor();
}

function finishLesson() {
  state.lessonDone = true;
  if (!state.completed.includes(state.lessonId)) { state.completed = [...state.completed, state.lessonId]; store.set('completed', state.completed); }
  if (state.lessonId === 'first-mix' && !state.skippedAny) { state.cleanMixes += 1; store.set('cleanMixes', state.cleanMixes); }
  toast(`Lesson complete: ${lesson().title}`);
}

function renderCoach(s) {
  const el = $('#coach'), f = state.f, L = lesson();
  const show = f.lesson || state.paneOpen;
  el.classList.toggle('hidden', !show);
  if (!show) { $('#progress').innerHTML = ''; state.coachKey = null; return; }
  if (!state.lessonDone) {
    state.ticked = advanceLesson(L, s, state.ticked);
    if (stepIndex(L, state.ticked) >= L.steps.length) finishLesson();
  }
  const idx = state.lessonDone ? L.steps.length : stepIndex(L, state.ticked);
  const key = `${L.id}|${idx}|${fmtBpm(s.left.bpm, 2)}|${state.level}|${state.f.lessonDetail}`;
  if (key === state.coachKey) return;
  state.coachKey = key;
  renderProgress(L, idx);
  renderTutor();
  if (idx >= L.steps.length) {
    const next = nextLesson(L.id, state.completed);
    const up = L.id === 'first-mix' ? suggestLevelUp(state.level, state.cleanMixes) : null;
    el.classList.add('complete');
    el.innerHTML = `<div class="num">${icon('check', 16)}</div><div style="min-width:0"><h2>${esc(L.title)}: done!</h2><p>${up ? `That's ${state.cleanMixes} clean mixes: you're ready for ${esc(up.name)}.` : next ? `Up next: ${esc(next.title)}.` : 'You\'ve finished the course. Nice work.'}</p></div>
      <div class="side">${up ? `<button data-a="levelup" data-level="${up.id}">Try ${esc(up.name)}</button>` : ''}${L.id === 'first-mix' ? '<button data-a="again">Mix another track</button>' : `<button data-a="repeat">Do it again</button>`}${next ? `<button class="primary" data-a="next" data-lesson="${next.id}">Next lesson ${icon('chevron', 14, 'style="transform:rotate(-90deg)"')}</button>` : ''}</div>`;
    return;
  }
  el.classList.remove('complete');
  const st = L.steps[idx];
  const body = fill(st.body, s);
  el.innerHTML = `<div class="num">${idx + 1}</div><div style="min-width:0"><h2>${esc(st.title)}</h2>${f.lessonDetail || state.paneOpen ? `<p title="${esc(body)}">${esc(body)}</p>` : ''}</div>
    <div class="side">${st.key ? kbd(st.key) : ''}${st.action === 'music' ? `<button class="primary" data-a="music">${icon('search', 15)} Browse music</button>` : ''}<button class="ghost" data-a="skip">Skip step</button></div>`;
}

function renderProgress(L, idx) {
  $('#progress').innerHTML = `<span>${esc(L.title)} · ${idx >= L.steps.length ? 'done' : `step ${idx + 1} of ${L.steps.length}`}</span><div class="dots">${L.steps.map((_, i) => `<span class="${i < idx ? 'done' : i === idx ? 'now' : ''}"></span>`).join('')}</div>`;
}

const NEEDS = { bassEQ: ['the Bass dial', 'improver'], barCounter: ['the bar counter', 'improver'] };
function renderTutor() {
  const el = $('#tutor');
  el.classList.toggle('hidden', !state.paneOpen);
  $('#lessonsBtn').setAttribute('aria-pressed', state.paneOpen); $('#lessonsBtn').classList.toggle('on', state.paneOpen);
  if (!state.paneOpen) return;
  const L = lesson(), idx = state.lessonDone ? L.steps.length : stepIndex(L, state.ticked), prog = courseProgress(state.completed);
  const need = L.needs && !state.f[L.needs] && NEEDS[L.needs];
  const next = nextLesson(L.id, state.completed);
  const stepRow = (st, i) => {
    const cls = i < idx ? 'done' : i === idx ? 'now' : '';
    return `<li class="${cls}">${icon(i < idx ? 'check' : i === idx ? 'dot' : 'circle', 16)}<div><b>${esc(st.title)}</b>${i === idx ? `<p>${esc(st.body)}</p>` : ''}</div></li>`;
  };
  el.innerHTML = `
    <div class="tutor-head">${icon('book', 17)}<b>Lessons</b><span class="grow"></span><span class="small muted">${prog.done} of ${prog.total} done</span>
      <button class="icon-btn" data-a="close" title="Hide lessons (L)" aria-label="Hide lessons">${icon('x', 16)}</button></div>
    <div class="tutor-body">
      <div class="bar" title="${prog.done} of ${prog.total} lessons"><i style="width:${(prog.done / prog.total) * 100}%"></i></div>
      <div class="lesson-card">
        <span class="tier-tag">${esc(TIERS.find((t) => t.id === L.tier).name)} · ${L.minutes} min</span>
        <h3>${esc(L.title)}</h3>
        <p class="why">${esc(L.why)}</p>
        ${need ? `<div class="notice">This lesson uses ${need[0]}, which appears at the Improver level.<button class="primary" data-a="need-level" data-level="${need[1]}">Switch to Improver</button></div>` : ''}
        ${L.hidesLane ? '<div class="notice">The beat lane stays hidden during this lesson. Use your ears.</div>' : ''}
        <ol class="steps">${L.steps.map(stepRow).join('')}</ol>
        <div class="card-actions">
          ${idx >= L.steps.length && next ? `<button class="primary" data-lesson="${next.id}">Next: ${esc(next.title)}</button>` : ''}
          <button class="ghost" data-a="restart-lesson">${idx > 0 ? 'Start over' : 'Restart'}</button>
        </div>
      </div>
      ${TIERS.map((t, ti) => `<div class="course"><h4><span>${esc(t.name)}</span><span>${prog.tiers[ti].done}/${prog.tiers[ti].total}</span></h4>
        ${LESSONS.filter((l) => l.tier === t.id).map((l) => {
          const done = state.completed.includes(l.id);
          return `<button class="${l.id === L.id ? 'active' : ''} ${done ? 'done' : ''}" data-lesson="${l.id}">${icon(done ? 'check' : l.id === L.id ? 'dot' : 'circle', 15)}<span>${esc(l.title)}</span><small>${l.minutes} min</small></button>`;
        }).join('')}</div>`).join('')}
    </div>`;
}

function setPane(open) { state.paneOpen = open; store.set('paneOpen', open); state.coachKey = null; renderTutor(); for (const s of SIDES) decks[s]._wave = null; }

function mixAgain() {
  // The track on B is now the one in the room; move it to A and start fresh on B.
  const old = decks.right;
  const keep = { track: old.track, buffer: old.buffer, pos: old.position(), tempo: old.tempoPct, playing: old.playing };
  decks.left.stop();
  decks.left.load(keep.track, keep.buffer, null);
  decks.left.bands = old.bands;
  decks.left.setTempo(keep.tempo); decks.left.offset = keep.pos;
  old.dispose();
  if (keep.playing) decks.left.play();
  decks.right = makeDeck('right'); applyKeyLock('right');
  state.xfader = 0; applyXfader();
  if (state.f.upNext) state.tab = 'suggested';
  startLesson(state.lessonId);
  renderDecks(); renderMixer(); renderLibrary();
  toast('The track you mixed in moved to deck A. Pick the next one for deck B.');
}

// ---------- canvases ----------
const lane = $('#lane');
let colors = {};
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ['left', 'right', 'ok', 'close', 'warn', 'ink', 'ink-3', 'line-2', 'card', 'card-2']) colors[k] = cs.getPropertyValue(`--${k}`).trim();
  for (const s of SIDES) colors[`on-${s}`] = textOn(colors[s]); // the beat numbers' colour on each deck's dots
}
function hexRgb(hex) {
  let h = String(hex).trim().replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return Number.isNaN(n) ? null : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** A theme colour token (hex) at the given opacity. */
function withAlpha(hex, a) { const c = hexRgb(hex); return c ? `rgba(${c[0]},${c[1]},${c[2]},${a})` : hex; }
/** Dark text on light fills, white on dark ones, so a dot's number reads in every theme. */
function textOn(hex) {
  const c = hexRgb(hex); if (!c) return '#fff';
  const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.3 ? '#11141b' : '#fff';
}
readColors();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(document.documentElement.dataset.theme));

function fitCanvas(cv) {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h, dpr };
}

// The beat lane's waveform is sampled once per device pixel column, then drawn as one filled outline per band.
const WAVE_RATE = 600; // waveform columns per second of audio (the lane shows ~4 s across ~2800 device px)
const DOT_GAP = 22; // beat dots sit this far above (deck A) and below (deck B) the line between the rows
let laneCols = new Float32Array(0); // low | mid | high per device column, reused every frame

/**
 * Fill out[0..n) low, out[n..2n) mid, out[2n..3n) high for n device columns. Column i covers band columns
 * f0 + i*df .. f0 + (i+1)*df. Zoomed in (df < 1) it interpolates between neighbours for smooth slopes;
 * zoomed out it takes the peak, so short kicks never fall between pixels.
 */
function sampleBands(B, out, n, f0, df) {
  const len = B.low.length, arrs = [B.low, B.mid, B.high];
  for (let i = 0; i < n; i++) {
    const a = f0 + i * df, b = a + df;
    if (b <= 0 || a >= len) { out[i] = out[n + i] = out[2 * n + i] = 0; continue; }
    if (df < 1) {
      const c = Math.max(0, Math.min(len - 1, (a + b) / 2 - 0.5)), j = Math.floor(c), k = Math.min(len - 1, j + 1), t = c - j;
      for (let m = 0; m < 3; m++) { const arr = arrs[m]; out[m * n + i] = arr[j] + (arr[k] - arr[j]) * t; }
    } else {
      const j0 = Math.max(0, Math.floor(a)), j1 = Math.min(len, Math.ceil(b));
      for (let m = 0; m < 3; m++) { const arr = arrs[m]; let v = 0; for (let j = j0; j < j1; j++) if (arr[j] > v) v = arr[j]; out[m * n + i] = v; }
    }
  }
}

/** One band as a mirrored filled outline around `mid`, in device pixels. */
function fillBand(g, vals, off, n, x0, mid, amp, gain, fill, alpha) {
  g.fillStyle = fill; g.globalAlpha = alpha;
  g.beginPath(); g.moveTo(x0, mid);
  for (let i = 0; i < n; i++) g.lineTo(x0 + i + 0.5, mid - Math.min(1, vals[off + i] * gain) * amp);
  g.lineTo(x0 + n, mid);
  for (let i = n - 1; i >= 0; i--) g.lineTo(x0 + i + 0.5, mid + Math.min(1, vals[off + i] * gain) * amp);
  g.closePath(); g.fill();
}

/** A soft halo of the lane's own background behind a beat dot, so its number stands clear of the waveform and grid. */
function dotHalo(g, x, y, r) {
  const bg = colors['card-2'], R = r + 9, gr = g.createRadialGradient(x, y, r, x, y, R);
  gr.addColorStop(0, withAlpha(bg, 0.92)); gr.addColorStop(1, withAlpha(bg, 0));
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.fill();
}

function drawLane(hint) {
  const L = lesson(), f = state.f;
  const byEar = f.beatLaneCheck || (L.hidesLane && !state.lessonDone);
  const visible = (f.beatLane && !byEar) || (byEar && performance.now() < state.checkUntil);
  $('#laneCover').classList.toggle('hidden', visible || !byEar);
  $('#lanePanel').classList.toggle('hidden', !f.beatLane && !byEar);
  $('#laneTitle').textContent = f.beatDots ? 'Beat lane' : 'Waveforms';
  if (!visible || lane.clientWidth === 0) return;
  const { g, w, h, dpr } = fitCanvas(lane);
  g.clearRect(0, 0, w, h);
  const cx = w / 2, pps = w / 4, rowH = h / 2, left = 30;
  if (hint?.tone === 'ok' && f.beatDots) { g.fillStyle = colors.ok; g.globalAlpha = 0.16; g.fillRect(cx - 12, 0, 24, h); g.globalAlpha = 1; }
  g.font = '650 10px system-ui, -apple-system, "Segoe UI", sans-serif'; g.textBaseline = 'middle';
  const dots = { left: [], right: [] }; // beat dots, drawn last so they sit on top
  SIDES.forEach((side, r) => {
    const d = decks[side], top = r * rowH, mid = top + rowH / 2, col = colors[side];
    g.fillStyle = col; g.textAlign = 'left'; g.font = '750 11px system-ui, -apple-system, "Segoe UI", sans-serif'; g.fillText(LETTER[side], 10, mid);
    g.font = '650 10px system-ui, -apple-system, "Segoe UI", sans-serif';
    if (r === 0) { g.fillStyle = colors['line-2']; g.fillRect(left, rowH - 0.5, w - left, 1); }
    if (!d.buffer) return;
    const pos = d.position(), rate = d.rate, dur = d.buffer.duration;
    const tAt = (x) => pos + ((x - cx) / pps) * rate, xAt = (t) => cx + ((t - pos) / rate) * pps;
    // Waveform and grid lines are drawn in device pixels, so they stay sharp on high-DPI screens.
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    const B = d.bands, x0 = Math.ceil(left * dpr), n = Math.max(0, Math.floor(w * dpr) - x0);
    if (B && n) {
      if (laneCols.length < n * 3) laneCols = new Float32Array(n * 3);
      sampleBands(B, laneCols, n, tAt(x0 / dpr) * B.rate, (rate / (pps * dpr)) * B.rate);
      const midD = mid * dpr, ampD = (rowH / 2 - 3) * dpr;
      if (f.beatDots) {
        // learning: a quiet grey waveform, so the coloured dots are the brightest thing; the low end keeps the kicks readable
        const ink = colors['ink-3'];
        fillBand(g, laneCols, 0, n, x0, midD, ampD, 1.25, ink, 0.85);
        fillBand(g, laneCols, n, n, x0, midD, ampD * 0.7, 1.7, ink, 0.35);
        fillBand(g, laneCols, 2 * n, n, x0, midD, ampD * 0.45, 2.2, ink, 0.45);
      } else {
        // low end in the deck colour, mids lighter, highs white, like DJ software
        fillBand(g, laneCols, 0, n, x0, midD, ampD, 1.25, col, 0.9);
        fillBand(g, laneCols, n, n, x0, midD, ampD * 0.7, 1.7, '#ffffff', 0.42);
        fillBand(g, laneCols, 2 * n, n, x0, midD, ampD * 0.45, 2.2, '#ffffff', 0.75);
      }
      g.globalAlpha = 1;
    }
    // beat grid: 1-device-pixel beats, stronger "1"s with bar numbers, a coloured line at each new phrase
    const grid = d.track.grid, marks = [];
    if (grid) {
      const bl = 60 / grid.bpm, span = (w / 2 / pps) * rate, gTop = Math.round((top + 2) * dpr), gH = Math.round((rowH - 4) * dpr);
      const k0 = Math.ceil((pos - span - grid.firstDownbeat) / bl), k1 = Math.floor((pos + span - grid.firstDownbeat) / bl);
      for (let k = k0; k <= k1; k++) {
        const x = xAt(grid.firstDownbeat + k * bl); if (x < left) continue;
        const down = ((k % 4) + 4) % 4 === 0, bar = Math.floor(k / 4) + 1, phraseStart = down && ((bar - 1) % 16 + 16) % 16 === 0;
        g.fillStyle = phraseStart ? colors.warn : colors.ink;
        g.globalAlpha = phraseStart ? 0.85 : down ? (f.beatDots ? 0.4 : 0.7) : (f.beatDots ? 0.12 : 0.28); // the dots already mark the beats
        const xd = Math.round(x * dpr);
        g.fillRect(phraseStart ? xd - 1 : xd, gTop, phraseStart ? 2 : 1, gH);
        marks.push({ x, k, down, bar, phraseStart });
        if (f.beatDots) dots[side].push({ x, n: ((k % 4) + 4) % 4 + 1 });
      }
    }
    g.restore(); g.globalAlpha = 1;
    if (grid) {
      const bl = 60 / grid.bpm;
      for (const { x, k, down, bar, phraseStart } of marks) {
        if (phraseStart && bar >= 1) {
          // mark each phrase: "Phrase 3 · Chorus"
          const t = grid.firstDownbeat + k * bl, ph = d.track.phrases?.find((p) => t >= p.start - 0.05 && t < p.end - 0.05);
          const label = `Phrase ${Math.floor((bar - 1) / 16) + 1}${ph ? ` · ${PHRASE_NAMES[ph.label] || ph.label}` : ''}`;
          g.globalAlpha = 1; g.font = '750 10px system-ui, -apple-system, "Segoe UI", sans-serif';
          const tw = g.measureText(label).width;
          g.fillStyle = colors.warn; g.fillRect(x, top + 2, tw + 10, 14);
          g.fillStyle = '#fff'; g.textAlign = 'left'; g.fillText(label, x + 5, top + 9.5);
          g.font = '650 10px system-ui, -apple-system, "Segoe UI", sans-serif';
        } else if (down && f.barCounter && bar >= 1) { g.globalAlpha = 0.75; g.fillStyle = colors.ink; g.textAlign = 'left'; g.fillText(String(bar), x + 4, top + 9); }
      }
      g.globalAlpha = 1;
    }
    // cue markers
    if (d.loop) {
      const x0 = Math.max(left, xAt(d.loop.start)), x1 = Math.min(w, xAt(d.loop.end));
      if (x1 > x0) { g.fillStyle = colors.ok; g.globalAlpha = 0.16; g.fillRect(x0, top, x1 - x0, rowH); g.globalAlpha = 0.9; g.fillRect(x0, top, 2, rowH); g.fillRect(x1 - 2, top, 2, rowH); g.globalAlpha = 1; }
    }
    for (const c of allCues(d.track)) {
      const x = xAt(c.time); if (x < left || x > w) continue;
      g.fillStyle = c.color; g.beginPath(); g.moveTo(x - 6, top + 1); g.lineTo(x + 6, top + 1); g.lineTo(x, top + 9); g.fill();
      g.fillRect(x - 0.5, top + 1, 1, rowH - 2);
    }
  });
  // now line
  g.fillStyle = colors.ink; g.globalAlpha = 0.9; g.fillRect(Math.round(cx) - 1, 0, 2, h); g.globalAlpha = 1;
  if (f.beatDots) drawBeatDots(g, dots, { w, cx, pps, rowH, left });
}

/**
 * The learning dots: deck A's along the bottom of its row and deck B's along the top of its row, so each
 * pair of beats sits close together. A line joins each pair: straight and green when they're lined up,
 * slanted amber or red when they're not (the slant shows which way to nudge).
 */
function drawBeatDots(g, dots, { w, cx, pps, rowH, left }) {
  const yA = rowH - DOT_GAP, yB = rowH + DOT_GAP; // far enough apart that the joining line shows between the dots
  const fade = (x) => Math.max(0.3, 1 - Math.abs(x - cx) / (w * 0.55));
  // halos, then connectors, then the dots on top
  for (const [side, y] of [['left', yA], ['right', yB]]) for (const { x, n } of dots[side]) if (x >= left + 8) dotHalo(g, x, y, n === 1 ? 11 : 8);
  const A = dots.left, B = dots.right;
  if (A.length && B.length) {
    const spacing = A.length > 1 ? Math.abs(A[1].x - A[0].x) : w;
    for (const a of A) {
      if (Math.abs(a.x - cx) > w * 0.42) continue;
      let b = null; for (const c of B) if (!b || Math.abs(c.x - a.x) < Math.abs(b.x - a.x)) b = c;
      if (!b || Math.abs(b.x - a.x) > spacing / 2) continue;
      const ms = Math.abs(b.x - a.x) / pps * 1000;
      g.strokeStyle = ms <= ALIGN_MS ? colors.ok : ms <= 50 ? colors.close : colors.warn;
      g.lineWidth = ms <= ALIGN_MS ? 3 : 2; g.globalAlpha = fade(a.x);
      g.beginPath(); g.moveTo(a.x, yA); g.lineTo(b.x, yB); g.stroke();
    }
  }
  g.font = '800 11px system-ui, -apple-system, "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const [side, y] of [['left', yA], ['right', yB]]) {
    for (const { x, n } of dots[side]) {
      if (x < left + 8) continue;
      const r = n === 1 ? 11 : 8;
      g.globalAlpha = fade(x);
      g.fillStyle = colors[side]; g.strokeStyle = colors.card; g.lineWidth = 2.5;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke();
      if (Math.abs(x - cx) < 5) { g.strokeStyle = colors.ink; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r + 4, 0, Math.PI * 2); g.stroke(); } // the beat that's playing now
      g.fillStyle = colors[`on-${side}`]; g.font = n === 1 ? '800 12px system-ui, -apple-system, "Segoe UI", sans-serif' : '750 10px system-ui, -apple-system, "Segoe UI", sans-serif';
      g.fillText(String(n), x, y + 0.5);
    }
  }
  g.globalAlpha = 1;
}

/** Hot cues and rekordbox memory cues, for markers. */
function allCues(t) {
  const out = cuesFor(t).map((time, i) => (time == null ? null : { time, color: CUE_COLORS[i], label: String(i + 1) })).filter(Boolean);
  for (const c of t.cues || []) if (c.num < 0 && !c.loop) out.push({ time: c.time, color: '#d9d9d9', label: '' });
  return out;
}

function drawWave(side) {
  const d = decks[side], cv = $(`#deck-${side} [data-wave]`);
  if (!cv || !d.buffer || cv.clientWidth === 0) return;
  const { g, w, h } = fitCanvas(cv);
  const n = Math.floor(w), B = d.bands;
  if (!d._wave || d._wave.n !== n) {
    // per-pixel maxima of each band (or the plain peaks if bands aren't ready)
    const cols = { n, low: new Float32Array(n), mid: new Float32Array(n), high: new Float32Array(n) };
    const src = B || { low: d.peaks.data, mid: new Float32Array(d.peaks.data.length), high: new Float32Array(d.peaks.data.length) };
    const len = src.low.length;
    for (let i = 0; i < n; i++) {
      const a = Math.floor((i / n) * len), b = Math.max(a + 1, Math.floor(((i + 1) / n) * len));
      for (const k of ['low', 'mid', 'high']) { let m = 0; for (let j = a; j < b; j++) if (src[k][j] > m) m = src[k][j]; cols[k][i] = m; }
    }
    d._wave = cols;
  }
  const dur = d.buffer.duration, px = (d.position() / dur) * w, col = colors[side];
  const strip = d.track.phrases?.length ? 6 : 0, mid = strip + (h - strip) / 2, amp = (h - strip) / 2 - 2;
  g.clearRect(0, 0, w, h);
  // phrase sections, like rekordbox's coloured phrase bar
  for (const p of d.track.phrases || []) { g.fillStyle = phraseColor(p.label); g.globalAlpha = 0.9; g.fillRect((p.start / dur) * w, 0, Math.max(1, ((p.end - p.start) / dur) * w - 1), strip - 1); }
  const layer = (arr, gain, scale, fill, alpha) => {
    for (let i = 0; i < n; i++) {
      const v = Math.min(1, arr[i] * gain) * amp * scale; if (v < 0.5) continue;
      g.fillStyle = fill; g.globalAlpha = alpha * (i < px ? 0.4 : 1);
      g.fillRect(i, mid - v, 1, v * 2);
    }
  };
  layer(d._wave.low, 1.2, 1, col, 0.9);
  if (B) { layer(d._wave.mid, 1.6, 0.7, '#ffffff', 0.4); layer(d._wave.high, 2, 0.45, '#ffffff', 0.7); }
  g.globalAlpha = 1;
  for (const c of allCues(d.track)) { const x = (c.time / dur) * w; g.fillStyle = c.color; g.beginPath(); g.moveTo(x - 4, h); g.lineTo(x + 4, h); g.lineTo(x, h - 6); g.fill(); }
  const plan = state.f.mixGuide ? currentPlan() : null;
  if (plan && side === plan.from) { const x = (plan.startTime / dur) * w; g.fillStyle = colors.ok; g.fillRect(x - 1, 0, 3, h); g.beginPath(); g.moveTo(x - 6, 0); g.lineTo(x + 6, 0); g.lineTo(x, 8); g.fill(); }
  if (plan && side === plan.to) {
    const x = (plan.bStart / dur) * w; g.fillStyle = colors.ok; g.fillRect(x - 1, 0, 3, h);
    const drop = d.track.grid.firstDownbeat + (plan.bDropAtBarA - plan.startBar) * barLen(d.track.grid); const xd = (drop / dur) * w; g.fillStyle = colors.ink; g.globalAlpha = 0.6; g.fillRect(xd - 1, 0, 2, h); g.globalAlpha = 1;
  }
  if (d.loop) { g.fillStyle = colors.ok; g.globalAlpha = 0.5; g.fillRect((d.loop.start / dur) * w, 0, Math.max(2, ((d.loop.end - d.loop.start) / dur) * w), h); g.globalAlpha = 1; }
  g.fillStyle = colors.ink; g.fillRect(px - 1, 0, 2, h);
}

/** Light up beat 1–4, the phrase number, the 4-bar block within the phrase, and the section name. */
function updateCounter(el, d) {
  const box = $('[data-counter]', el); if (!box) return;
  const pos = d.position();
  const p = d.track.phrases?.find((ph) => pos >= ph.start && pos < ph.end);
  const key = p ? `${p.start}` : 'none';
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  $('[data-sec]', box).innerHTML = p ? `<i style="background:${phraseColor(p.label)}"></i>${esc(partInfo(p.label).name)}` : '';
  $('[data-sec]', box).title = p ? `${partInfo(p.label).what} ${partInfo(p.label).mix}` : '';
}

// ---------- side-by-side phrase counter in the mixer, and Align ----------
const ALIGN_MAX_BEATS = 8; // Align offers to fix up to 2 bars

/** The deck Align moves: the one that isn't playing to the room (else the planned incoming deck, else B). */
function alignSide() {
  const live = SIDES.filter((s) => decks[s].buffer && decks[s].playing && decks[s].xf.gain.value > 0.3);
  if (live.length === 1) return live[0] === 'left' ? 'right' : 'left';
  return currentPlan()?.to || 'right';
}

/** How far `side` is from the other deck in the phrase (see phraseOffset), or null. */
function deckOffset(side) {
  const d = decks[side], r = decks[side === 'left' ? 'right' : 'left'];
  if (!d.buffer || !r.buffer || !d.track?.grid || !r.track?.grid) return null;
  return phraseOffset(r.track.grid, r.position(), d.track.grid, d.position(), { maxBeats: ALIGN_MAX_BEATS, duration: d.buffer.duration });
}

/** "2 bars", "3 beats", "1 bar 2 beats" */
function beatsWords(n) {
  const a = Math.abs(n), bars = Math.floor(a / 4), beats = a % 4;
  const w = (k, u) => `${k} ${u}${k === 1 ? '' : 's'}`;
  return [bars && w(bars, 'bar'), beats && w(beats, 'beat')].filter(Boolean).join(' ');
}

/** Beat-jump `side` by the exact difference so it sits on the other deck's beat and bar of the phrase. Keeps playing. */
function alignDeck(side) {
  const o = deckOffset(side);
  if (!o?.canAlign) return false;
  decks[side].seek(o.target);
  state.did.add('align');
  toast(`Jumped deck ${LETTER[side]} ${o.beats > 0 ? 'forward' : 'back'} ${beatsWords(o.beats)}: same beat and bar as ${LETTER[side === 'left' ? 'right' : 'left']}.`);
  return true;
}

function updateMixCounter() {
  const box = $('[data-pcount]'); if (!box) return;
  for (const side of SIDES) {
    const d = decks[side], col = $(`[data-pc="${side}"]`, box);
    const c = d.buffer && d.track?.grid ? beatCount(d.track.grid, d.position()) : null;
    const key = c ? `${c.beat}|${c.bar}` : d.buffer ? 'before' : 'empty';
    if (col.dataset.key === key) continue;
    col.dataset.key = key;
    col.classList.toggle('before', !c);
    $$('.pc-beats i', col).forEach((x, i) => x.classList.toggle('on', !!c && i + 1 === c.beat));
    $('[data-pcbar]', col).textContent = c ? c.barInPhrase : '–';
    $('[data-pcphrase]', col).textContent = c ? c.phrase : '–';
  }
  const mover = alignSide(), ref = mover === 'left' ? 'right' : 'left';
  const o = deckOffset(mover);
  const key = o ? `${mover}|${o.beats}|${o.canAlign}` : 'none';
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  const status = $('[data-pstatus]', box), btn = $('[data-align]', box);
  box.classList.toggle('off', !!o && o.beats !== 0);
  box.classList.toggle('same', !!o && o.beats === 0);
  if (!o) status.textContent = '';
  else if (o.beats === 0) status.textContent = 'Same bar ✓';
  else if (Math.abs(o.beats) <= ALIGN_MAX_BEATS) status.textContent = `${LETTER[mover]} ${beatsWords(o.beats)} ${o.beats > 0 ? 'behind' : 'ahead'}`;
  else status.textContent = 'Different bars';
  status.title = o && o.beats ? `Deck ${LETTER[mover]} is ${beatsWords(o.beats)} ${o.beats > 0 ? 'behind' : 'ahead of'} deck ${LETTER[ref]} in the phrase.` : '';
  btn.hidden = !o?.canAlign;
  if (o?.canAlign) {
    btn.title = `Jump deck ${LETTER[mover]} ${o.beats > 0 ? 'forward' : 'back'} ${beatsWords(o.beats)} so it's on the same beat and bar of the phrase as ${LETTER[ref]}. It keeps playing. (BEAT SYNC on the controller does this too.)`;
  }
}

// ---------- every frame ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.2, (now - last) / 1000); last = now;
  const s = mixState(dt);
  const hint = beatHint(s);
  const hel = $('#hint');
  const checking = performance.now() < state.checkUntil;
  if (hint && ((state.f.offsetHint && !(lesson().hidesLane && !state.lessonDone)) || checking)) { hel.className = `hint ${hint.tone}`; hel.textContent = hint.text; }
  else if (hint) { hel.className = state.f.beatLane && !state.f.offsetHint ? 'hidden' : 'hint'; hel.textContent = 'Trust your ears'; }
  else { hel.className = 'hint'; hel.textContent = 'Play both decks to compare beats'; }
  drawLane(hint);
  renderCoach(s);
  drawMeters();
  for (const side of SIDES) {
    const d = decks[side], el = $(`#deck-${side}`);
    if (!d.buffer) continue;
    drawWave(side);
    jogs[side]?.draw(colors, side);
    const q = (k) => $(`[data-${k}]`, el);
    if (q('bpm')) q('bpm').textContent = fmtBpm(d.bpm, 2);
    if (q('pct')) q('pct').textContent = state.f.pitchPercent ? `${d.tempoPct >= 0 ? '+' : ''}${d.tempoPct.toFixed(2)}%` : (d.tempoPct ? (d.tempoPct > 0 ? 'faster' : 'slower') : 'normal');
    const role = q('live'); if (role) { role.textContent = deckRole(side); role.classList.toggle('on', d.playing && d.xf.gain.value > 0.3); }
    const play = $('[data-a="play"]', el);
    if (play && play.dataset.state !== String(d.playing)) { play.dataset.state = String(d.playing); play.innerHTML = icon(d.playing ? 'pause' : 'play', 22); }
    const slider = $('input[data-a="tempo"]', el); if (slider && document.activeElement !== slider) slider.value = d.tempoPct;
    updateCounter(el, d);
    updatePads(side);
    const lb = q('loopb'); if (lb) { const t = d.loop ? `Loop ${beatsLabel(d.loop.beats)}` : ''; if (lb.textContent !== t) lb.textContent = t; }
    if (q('bar') && d.track.grid) {
      const bar = Math.max(1, Math.floor((d.position() - d.track.grid.firstDownbeat) / barLen(d.track.grid)) + 1);
      q('bar').textContent = `Bar ${bar} · phrase ${Math.ceil(bar / 16)} · −${fmtTime(Math.max(0, d.buffer.duration - d.position()))}`;
    }
  }
  const xf = $('#xfader'); if (xf && document.activeElement !== xf) xf.value = state.xfader;
  updateMixCounter();
  syncLights();
  updateBfx();
  updateMixPlan();
  requestAnimationFrame(frame);
}

// ---------- actions ----------
function stepTempo(side, delta) {
  const d = decks[side], r = tempoRange(state.level);
  if (!d.buffer) return;
  d.setTempo(Math.max(-r, Math.min(r, Math.round((d.tempoPct + delta) * 100) / 100)));
}
function nudge(side, dir) { const d = decks[side]; if (d.buffer) d.setBend(dir * 0.04); }
function togglePlay(side) {
  const d = decks[side]; if (!d.buffer) return focusLibrary(side);
  ctx.resume();
  const starting = !d.playing;
  d.toggle();
  // Started the next track right on the planned mix point (within a beat)?
  const plan = currentPlan();
  if (starting && plan && side === plan.to) {
    const F = decks[plan.from], fg = F.track.grid;
    const bar = (F.position() - fg.firstDownbeat) / barLen(fg) + 1;
    if (F.playing) { state.mixStartBar = bar; state.mixDone.add('start'); }
    if (Math.abs(bar - plan.startBar) <= 0.25) { state.did.add('onCue'); toast('Right on time.'); }
  }
  // Started deck B at the top of one of A's 16-bar phrases?
  const A = decks.left, g = A.track?.grid;
  if (starting && side === 'right' && A.playing && g) {
    const bars = (A.position() - g.firstDownbeat) / barLen(g), inPhrase = ((bars % 16) + 16) % 16;
    if (inPhrase < 0.25 || inPhrase > 15.85) state.did.add('phraseStart');
  }
}
function setEQ(side, band, db, rerender = true) {
  const d = decks[side]; d.eq[band] = db; d.setEQ(band, db);
  if (rerender) { const dial = $(`[data-dial="${side}:${band}"]`); if (dial) setDial(dial, db); }
  $(`[data-cut="${side}:${band}"]`)?.classList.toggle('on', db <= -25);
}
function setListen(side, on) {
  const d = decks[side]; d.listening = on; d.listenGain.gain.value = on ? 0.5 : 0;
  const b = $(`[data-listen="${side}"]`); if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }
}
function moveXfader(x) {
  state.xfader = Math.max(0, Math.min(1, x)); applyXfader();
  // Time the blend from A to B, in deck A's bars.
  const A = decks.left;
  if (state.xfader <= 0.1) state.blend = null;
  else if (!state.blend && A.playing && A.bpm) state.blend = { t: performance.now(), bpm: A.bpm };
  if (state.blend && state.xfader >= 0.9) {
    const bars = ((performance.now() - state.blend.t) / 1000) * state.blend.bpm / 240;
    if (bars >= 8) { state.did.add('slowBlend'); toast(`Smooth: that blend took ${Math.round(bars)} bars.`); }
    else if (lesson().id === 'smooth') toast(`That took ${Math.max(1, Math.round(bars))} bars. Go back to A and try 8 or more.`);
    state.blend = null;
  }
}
// ---------- next mix: when to start the next track ----------
/** The planned mix from the deck the room hears into the other one (null until both have tracks). */
function currentPlan() {
  // Mid-blend the crossfader crosses the middle, so keep the direction while both decks play.
  const L = decks.left.playing, R = decks.right.playing;
  const from = L && R && state.mixDir ? state.mixDir : L !== R ? (L ? 'left' : 'right') : state.xfader <= 0.5 ? 'left' : 'right';
  state.mixDir = from;
  const to = from === 'left' ? 'right' : 'left';
  const F = decks[from], T = decks[to];
  if (!F.buffer || !T.buffer || !F.track?.grid || !T.track?.grid) return null;
  const key = `${F.track.id}|${T.track.id}|${F.track.grid.firstDownbeat}|${T.track.grid.firstDownbeat}|${F.track.phrases?.length}|${T.track.phrases?.length}`;
  if (state.planKey !== key) { state.planKey = key; state.mixStartBar = null; state.mixDone = new Set(); state.plan = planMix({ ...F.track, duration: F.buffer.duration }, { ...T.track, duration: T.buffer.duration }); }
  return state.plan ? { ...state.plan, from, to } : null;
}

const STEP_PRAISE = { start: 'Right on the 1.', fade: 'Nice, smooth fade-in.', highs: 'Highs in.', mids: 'Mids in.', swap: 'Clean bass swap.', out: 'Mix done: nice and smooth.' };

/** The guide's steps for this plan, where the DJ is in them, and how the mixer looks right now. */
function mixGuideNow(plan, bar) {
  const F = decks[plan.from], T = decks[plan.to];
  // B paused again while A plays: start over from "get ready"
  if (!T.playing && (state.mixStartBar != null || state.mixDone.has('start'))) { state.mixStartBar = null; state.mixDone = new Set(); }
  // the steps follow when B was really started (a late start, or a beat off); a start well before the plan keeps the "started early" tip
  const p = T.playing && state.mixStartBar != null && state.mixStartBar >= plan.startBar - 1 ? shiftPlan(plan, state.mixStartBar) : plan;
  const controls = mixControls(state.f, ctlState.connected.length > 0);
  const steps = mixSteps(p, controls, { a: LETTER[plan.from], b: LETTER[plan.to] });
  const toB = plan.to === 'right' ? state.xfader : 1 - state.xfader;
  const snap = {
    bReady: !!T.buffer && !T.playing && Math.abs(T.position() - plan.bStart) < 60 / (T.bpm || 120) && Math.abs((F.bpm || 0) - (T.bpm || 0)) < 0.1,
    bPlaying: T.playing, aPlaying: F.playing, xf: toB, volA: F.vol.gain.value, volB: T.vol.gain.value, eqA: F.eq, eqB: T.eq,
  };
  const g = stepState(steps, p, bar, snap, controls, state.mixDone);
  for (const id of g.doneIds) if (!state.mixDone.has(id)) {
    state.mixDone.add(id);
    const st = steps.find((x) => x.id === id);
    if (F.playing && STEP_PRAISE[id] && id !== 'start' && bar <= st.by + 1) toast(STEP_PRAISE[id]);
  }
  return { plan: p, guide: g };
}

function updateMixPlan() {
  const el = $('#mixPlan'), plan = state.f.mixGuide ? currentPlan() : null;
  el.classList.toggle('hidden', !plan);
  if (!plan) return;
  const F = decks[plan.from], T = decks[plan.to], g = F.track.grid;
  const bar = (F.position() - g.firstDownbeat) / barLen(g) + 1;
  const { plan: p, guide } = mixGuideNow(plan, bar);
  const full = state.f.lessonDetail; // Starter reads whole sentences; later levels just the step
  let cue = F.playing ? mixCue(p, bar, T.playing, 16, guide) : { phase: 'prep', title: `Plan: start ${LETTER[plan.to]} at ${LETTER[plan.from]}'s bar ${plan.startBar}`, detail: `Play deck ${LETTER[plan.from]} and the countdown starts. ${plan.why}`, big: '▶', unit: '' };
  if (cue.nextText != null && !full) cue = { ...cue, detail: cue.nextText };
  // before B starts, say exactly how to get it ready (bass cut, volume down) for this level's controls
  else if (!T.playing && guide.current?.id === 'ready' && (cue.phase === 'prep' || cue.phase === 'soon')) cue = { ...cue, detail: guide.current.detail };
  const ph = F.track.phrases?.find((x) => F.position() >= x.start && F.position() < x.end);
  const part = ph ? partInfo(ph.label) : null;
  const note = guide.note;
  const stepsKey = guide.items.map((it) => `${it.id}:${it.status}:${it.bar}`).join();
  const key = `${cue.phase}|${cue.title}|${cue.detail}|${cue.big}|${part?.name}|${plan.from}|${note?.text}|${stepsKey}|${full}`;
  if (el.dataset.key !== key) {
    el.dataset.key = key; el.dataset.phase = cue.phase;
    $('[data-mp-big]', el).textContent = cue.big; $('[data-mp-unit]', el).textContent = cue.unit;
    $('[data-mp-title]', el).textContent = cue.title.replace(/deck B/g, `deck ${LETTER[plan.to]}`);
    $('[data-mp-detail]', el).textContent = cue.nextText != null ? cue.detail : cue.detail.replace(/\bA's\b|\bB\b/g, (m) => (m === 'B' ? LETTER[plan.to] : `${LETTER[plan.from]}'s`)); // one pass, so a swapped letter isn't swapped back
    const nt = $('[data-mp-note]', el); nt.textContent = note?.text || ''; nt.className = `mp-note ${note?.tone || ''}`; nt.hidden = !note;
    $('[data-mp-part]', el).hidden = !!note;
    $('[data-mp-part]', el).innerHTML = part ? `<i style="background:${phraseColor(ph.label)}"></i>Deck ${LETTER[plan.from]} is in its ${esc(part.name.toLowerCase())}: ${esc(part.what)} ${esc(part.mix)}` : '';
    $('[data-mp-steps]', el).innerHTML = guide.items.map((it, i) => `<li class="${it.status}${it === guide.current ? ' current' : ''}" title="${esc(it.title)}. ${esc(it.detail)}"><b>${it.status === 'done' ? '✓' : it.status === 'missed' ? '–' : i + 1}</b>${esc(it.short)}<span>bar ${it.bar}</span></li>`).join('');
    $('[data-a="cue-b"]', el).textContent = `Cue ${LETTER[plan.to]} up`;
    $('[data-a="cue-b"]', el).disabled = T.playing;
  }
  drawMixTimeline(p, bar, guide.items);
}

/** Deck A's parts across its length, where B starts, how far B's intro runs, and where B's drop lands. */
function drawMixTimeline(plan, bar, steps = []) {
  const cv = $('[data-mp-time]'); if (!cv || !cv.clientWidth) return;
  const { g, w, h } = fitCanvas(cv);
  const F = decks[plan.from], fg = F.track.grid, total = plan.aTotalBars;
  // show from a little before now (or the plan) to the end of A
  const first = Math.max(1, Math.min(bar, plan.startBar) - 16), last = total + 1;
  const xOf = (b) => ((b - first) / (last - first)) * w;
  g.clearRect(0, 0, w, h);
  const rowA = 4, rowB = 22, hh = 12;
  for (const p of F.track.phrases || []) {
    const b0 = (p.start - fg.firstDownbeat) / barLen(fg) + 1, b1 = (p.end - fg.firstDownbeat) / barLen(fg) + 1;
    if (b1 < first) continue;
    g.fillStyle = phraseColor(p.label); g.globalAlpha = 0.85;
    g.fillRect(Math.max(0, xOf(b0)), rowA, Math.max(1, xOf(b1) - Math.max(0, xOf(b0)) - 1), hh);
  }
  g.globalAlpha = 1;
  // B's intro, lined up from the start bar, then where its drop lands
  const xs = xOf(plan.startBar), xi = xOf(plan.startBar + plan.bIntroBars);
  g.fillStyle = colors[plan.to]; g.globalAlpha = 0.35; g.fillRect(xs, rowB, Math.max(2, Math.min(w, xi) - xs), hh); g.globalAlpha = 1;
  g.fillStyle = colors.ok; g.globalAlpha = 0.25; g.fillRect(xs, rowA - 2, Math.max(2, xOf(plan.endBar) - xs), rowB + hh - rowA + 4); g.globalAlpha = 1;
  g.fillStyle = colors.ok; g.fillRect(Math.round(xs) - 1, 0, 3, h);
  g.font = '700 10px system-ui, -apple-system, "Segoe UI", sans-serif'; g.textBaseline = 'middle';
  g.fillStyle = colors.ink; g.textAlign = 'left';
  g.fillText(`${LETTER[plan.to]} intro`, Math.min(w - 60, xs + 4), rowB + hh / 2);
  const xd = xOf(plan.bDropAtBarA);
  if (xd < w - 2) { g.fillStyle = colors[plan.to]; g.fillRect(Math.round(xd) - 1, rowB - 2, 2, hh + 4); g.fillStyle = colors.ink; g.fillText(`${LETTER[plan.to]} drop`, Math.min(w - 44, xd + 4), rowB + hh + 8); }
  // the start label sits left of the marker, on the top row, so it never covers the intro label
  g.textAlign = 'right'; g.fillStyle = colors.card; g.globalAlpha = 0.85;
  const startLabel = `${LETTER[plan.to]} starts · bar ${plan.startBar}`, lw = g.measureText(startLabel).width;
  const lx = Math.max(lw + 8, xs - 4);
  g.fillRect(lx - lw - 4, rowA, lw + 8, hh); g.globalAlpha = 1; g.fillStyle = colors.ink; g.fillText(startLabel, lx, rowA + hh / 2);
  // each step's bar, as a small tick under the B row
  for (const st of steps) {
    if (st.id === 'start') continue;
    const x = xOf(st.bar); if (x < 0 || x > w) continue;
    g.fillStyle = st.status === 'done' ? colors.ok : colors.ink; g.globalAlpha = st.status === 'done' ? 0.9 : 0.5;
    g.fillRect(Math.round(x), rowB + hh + 1, 2, 5);
  }
  g.globalAlpha = 1;
  // now
  const xn = xOf(bar); if (xn >= 0 && xn <= w) { g.fillStyle = colors.ink; g.fillRect(Math.round(xn) - 1, 0, 2, rowB + hh); }
}

// ---------- performance pads: cues, loops, beat jump, pad FX, sampler ----------
function setPadMode(side, mode) {
  const d = decks[side];
  if (d.padMode === mode) return;
  d.fx.stopAll(); d.padMode = mode; d._padKey = null;
  $$(`#deck-${side} [data-pmode]`).forEach((b) => b.classList.toggle('on', b.dataset.pmode === mode));
}
function padPress(side, i, down, shift = false, mode = decks[side].padMode) {
  const d = decks[side];
  if (mode === 'sampler') { if (down) (shift ? stopSample(i) : playSample(i)); d._padKey = null; return; }
  if (!d.buffer) return;
  if (mode === 'fx1' || mode === 'fx2') {
    const [id, beats] = PAD_FX[mode][i];
    if (down) { d.fx.start(id, beats, 0.85); d._fxPad = i; } else if (d._fxPad === i) { d.fx.stop(id); d._fxPad = null; }
    d._padKey = null; return;
  }
  if (!down) return;
  if (mode === 'hotcue') return hotCue(side, i, shift);
  if (mode === 'loop') return toggleLoop(side, LOOP_SIZES[i]);
  if (mode === 'jump') return d.seek(jumpBy(d.track.grid, d.position(), JUMP_SIZES[i]));
}
/** Pad labels and lights for the deck's current mode (only redrawn when something changes). */
function updatePads(side) {
  const d = decks[side], box = $(`#deck-${side} [data-ppads]`); if (!box) return;
  const cues = d.track ? cuesFor(d.track) : [];
  const key = [d.padMode, d.loop?.beats, cues.join(), d._fxPad, SAMPLES.map((_, i) => samplePlaying(i)).join()].join('|');
  if (d._padKey === key) return;
  d._padKey = key;
  $$('[data-ppad]', box).forEach((b, i) => {
    let label = '', on = false, color = '';
    if (d.padMode === 'hotcue') { label = String(i + 1); on = cues[i] != null; color = CUE_COLORS[i % 4]; b.title = on ? `Hot cue ${i + 1}: jump here. Alt-click to clear.` : `Set hot cue ${i + 1}`; }
    else if (d.padMode === 'loop') { label = `${beatsLabel(LOOP_SIZES[i])}`; on = d.loop?.beats === LOOP_SIZES[i]; b.title = `Loop ${label} beat${LOOP_SIZES[i] === 1 ? '' : 's'} (press again to exit)`; }
    else if (d.padMode === 'jump') { const j = JUMP_SIZES[i]; label = j < 0 ? `‹ ${-j}` : `${j} ›`; b.title = `Jump ${Math.abs(j)} beat${Math.abs(j) === 1 ? '' : 's'} ${j < 0 ? 'back' : 'forward'}`; }
    else if (d.padMode === 'fx1' || d.padMode === 'fx2') { label = padFxLabel(PAD_FX[d.padMode][i]); on = d._fxPad === i; b.title = 'Hold for the effect, let go to stop'; }
    else if (d.padMode === 'sampler') { label = SAMPLES[i]; on = samplePlaying(i); b.title = `Play ${SAMPLES[i]} (Alt-click stops it)`; }
    b.textContent = label; b.classList.toggle('on', on); b.style.setProperty('--pc', color || `var(--${side})`);
  });
}

// ---------- loops ----------
function snapToBeat(d, t) { const g = d.track?.grid; if (!g) return t; const b = 60 / g.bpm; return g.firstDownbeat + Math.round((t - g.firstDownbeat) / b) * b; }
function toggleLoop(side, beats) {
  const d = decks[side]; if (!d.buffer) return;
  if (d.loop && Math.abs(d.loop.beats - beats) < 1e-6) { d.lastLoop = d.loop; d.clearLoop(); return; }
  d.setLoop(loopAt(d.track.grid, d.position(), beats)); d.lastLoop = d.loop;
}
function loopIn(side) { const d = decks[side]; if (d.buffer) { d._loopIn = snapToBeat(d, d.position()); toast(`Loop in set on deck ${LETTER[side]}. Press Loop out where it should end.`); } }
function loopOut(side) {
  const d = decks[side]; if (!d.buffer) return;
  if (d._loopIn == null) return loopIn(side);
  const beat = 60 / (d.track.grid?.bpm || 120);
  let end = snapToBeat(d, d.position()); if (end <= d._loopIn) end = d._loopIn + beat;
  d.setLoop({ start: d._loopIn, end, beats: Math.round(((end - d._loopIn) / beat) * 100) / 100 }); d.lastLoop = d.loop; d._loopIn = null;
}
function reloop(side) {
  const d = decks[side]; if (!d.buffer) return;
  if (d.loop) { d.lastLoop = d.loop; d.clearLoop(); } else if (d.lastLoop) d.setLoop(d.lastLoop);
}
function scaleDeckLoop(side, factor) { const d = decks[side]; if (d.loop) { d.setLoop(scaleLoop(d.loop, factor, d.track.grid)); d.lastLoop = d.loop; } }

// ---------- Beat FX (mixer) ----------
function applyBfx() {
  for (const r of state.bfxRunning) decks[r.side].fx.stop(r.id);
  state.bfxRunning = [];
  const { on, ch, depth } = state.bfx, id = FX[state.bfx.i].id, beats = BFX_BEATS[state.bfx.b];
  if (on) for (const side of SIDES) {
    if (ch !== 'both' && LETTER[side] !== ch) continue;
    if (!decks[side].buffer) continue;
    decks[side].fx.start(id, beats, depth); state.bfxRunning.push({ side, id });
  }
  state.bfxKey = null;
}
function updateBfx() {
  const box = $('#mixer .bfx'); if (!box) return;
  const key = JSON.stringify(state.bfx); if (state.bfxKey === key) return; state.bfxKey = key;
  $('[data-bfxname]', box).textContent = FX[state.bfx.i].name;
  $('[data-bfxbeats]', box).textContent = `${beatsLabel(BFX_BEATS[state.bfx.b])} beat${BFX_BEATS[state.bfx.b] === 1 ? '' : 's'}`;
  $$('[data-bfxch]', box).forEach((b) => b.classList.toggle('on', b.dataset.bfxch === state.bfx.ch));
  $('[data-bfx="on"]', box).classList.toggle('on', state.bfx.on);
}

// ---------- hot cues ----------
const cueStore = store.get('cues', {});
/** Four pads: your own cues, falling back to rekordbox's hot cues A–D. */
function cuesFor(t) {
  const own = cueStore[t.id] || [];
  return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (own[i] === false ? null : own[i] ?? (t.cues || []).find((c) => c.num === i && !c.loop)?.time ?? null));
}
function hotCue(side, i, clear) {
  const d = decks[side], t = d.track, own = (cueStore[t.id] ||= []);
  const cur = cuesFor(t)[i];
  if (clear) own[i] = false;
  else if (cur == null) {
    const g = t.grid, p = d.position();
    own[i] = g ? g.firstDownbeat + Math.round((p - g.firstDownbeat) * g.bpm / 60) * 60 / g.bpm : p; // snap to the nearest beat
  } else { d.seek(cur); return; }
  store.set('cues', cueStore); renderDeck(side);
}

// ---------- beat grid fine-tuning ----------
function shiftGrid(side, how, big) {
  const d = decks[side], g = d.track.grid; if (!g) return;
  const beat = 60 / g.bpm;
  if (how === 'one') g.firstDownbeat += beat; else g.firstDownbeat += (+how) * (big ? 0.02 : 0.005);
  while (g.firstDownbeat >= 4 * beat) g.firstDownbeat -= 4 * beat;
  while (g.firstDownbeat < 0) g.firstDownbeat += 4 * beat;
  g.adjusted = true;
  lib.persistAnalysis(d.track);
}

function check() {
  const byEar = state.f.beatLaneCheck || lesson().hidesLane;
  if (!byEar) return;
  state.checkUntil = performance.now() + 3000;
  const L = decks.left, R = decks.right;
  if (!(L.playing && R.playing && L.track?.grid && R.track?.grid)) return toast('Play both decks first.');
  const bm = beatmatch(L, R), off = (bm.phase * 60000) / L.bpm;
  if (Math.abs(bm.bpmDiff) > TEMPO_OK) return toast(`Speeds don't match yet: B is ${Math.abs(bm.bpmDiff).toFixed(2)} BPM ${bm.bpmDiff > 0 ? 'faster' : 'slower'}.`);
  if (Math.abs(off) <= ALIGN_MS) { state.did.add('checkOk'); toast('Spot on: your ears got it.'); }
  else toast(`Close: B is ${Math.abs(off).toFixed(0)} ms ${off > 0 ? 'early' : 'late'}.`);
}

// ---------- events ----------
function deckEvents(side) {
  const el = $(`#deck-${side}`);
  const d = () => decks[side];
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'keylock') return toggleKeyLock(side);
    if (a === 'choose') return focusLibrary(side, side === 'right' && state.f.upNext && decks.left.buffer ? 'suggested' : 'all');
    if (!d().buffer) return;
    if (a === 'play') togglePlay(side);
    else if (a === 'restart') { d().seek(d().track.grid?.firstDownbeat || 0); state.did.add('restart'); }
    else if (a === 'slower' || a === 'faster') stepTempo(side, (a === 'faster' ? 1 : -1) * (e.shiftKey ? 1 : FINE));
  });
  el.addEventListener('input', (e) => { if (e.target.dataset.a === 'tempo') d().setTempo(+e.target.value); });
  el.addEventListener('click', (e) => {
    const pad = e.target.closest('[data-cue]'); if (pad && d().buffer) return hotCue(side, +pad.dataset.cue, e.altKey);
    const gb = e.target.closest('[data-grid]'); if (gb && d().buffer) return shiftGrid(side, gb.dataset.grid, e.shiftKey);
  });
  el.addEventListener('contextmenu', (e) => { const pad = e.target.closest('[data-ppad]'); if (pad) { e.preventDefault(); padPress(side, +pad.dataset.ppad, true, true); } });
  el.addEventListener('click', (e) => { const m = e.target.closest('[data-pmode]'); if (m) setPadMode(side, m.dataset.pmode); });
  // pads: pressed and released (Pad FX are held)
  el.addEventListener('pointerdown', (e) => {
    const pad = e.target.closest('[data-ppad]'); if (!pad || e.button !== 0) return;
    const i = +pad.dataset.ppad; padPress(side, i, true, e.altKey || e.shiftKey);
    const up = () => { padPress(side, i, false); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  });
  el.addEventListener('click', (e) => {
    const cv = e.target.closest('[data-wave]'); if (!cv || !d().buffer) return;
    const r = cv.getBoundingClientRect(), g = d().track.grid;
    let t = ((e.clientX - r.left) / r.width) * d().buffer.duration;
    if (g) t = timeOfBar(g, Math.max(1, Math.round((t - g.firstDownbeat) / barLen(g)) + 1));
    d().seek(t);
  });
  el.addEventListener('dragover', (e) => { e.preventDefault(); $('[data-drop]', el)?.classList.add('dragover'); });
  el.addEventListener('dragleave', () => $('[data-drop]', el)?.classList.remove('dragover'));
  el.addEventListener('drop', (e) => {
    e.preventDefault(); $('[data-drop]', el)?.classList.remove('dragover');
    if (hasTracks(e)) { const t = state.tracks.find((x) => x.id === draggedIds(e)[0]); if (t) loadTo(side, t); return; }
    const f = e.dataTransfer.files[0]; if (f) loadDroppedFile(side, f);
  });
}

function mixerEvents() {
  const m = $('#mixer');
  bindDials(m, (id, v) => {
    if (id === 'fx:depth') { state.bfx.depth = v; for (const r of state.bfxRunning) decks[r.side].fx.setDepth(r.id, v); return; }
    const [side, band] = id.split(':'); setEQ(side, band, v, false);
  });
  m.addEventListener('click', (e) => {
    const b = e.target.closest('[data-bfx]'); const c = e.target.closest('[data-bfxch]');
    if (c) { state.bfx.ch = c.dataset.bfxch; applyBfx(); }
    if (!b) return;
    const k = b.dataset.bfx;
    if (k === 'on') state.bfx.on = !state.bfx.on;
    else if (k === 'next' || k === 'prev') state.bfx.i = (state.bfx.i + (k === 'next' ? 1 : -1) + FX.length) % FX.length;
    else if (k === 'bup' || k === 'bdown') state.bfx.b = Math.max(0, Math.min(BFX_BEATS.length - 1, state.bfx.b + (k === 'bup' ? 1 : -1)));
    applyBfx();
  });
  m.addEventListener('click', (e) => {
    const cut = e.target.closest('[data-cut]');
    if (cut) { const [side, band] = cut.dataset.cut.split(':'); return setEQ(side, band, decks[side].eq[band] <= -25 ? 0 : -30); }
    const l = e.target.closest('[data-listen]'); if (l) setListen(l.dataset.listen, !decks[l.dataset.listen].listening);
    if (e.target.closest('[data-align]')) alignDeck(alignSide());
  });
  m.addEventListener('input', (e) => {
    if (e.target.id === 'xfader') moveXfader(+e.target.value);
    else if (e.target.dataset.vol) decks[e.target.dataset.vol].setVolume(+e.target.value);
  });
}

function bind() {
  SIDES.forEach(deckEvents);
  mixerEvents();
  $('#themeBtn').innerHTML = icon('palette', 18); $('#helpBtn').innerHTML = icon('help', 18); $('#searchIcon').innerHTML = icon('search', 15);
  $$('[data-icon]').forEach((x) => { x.outerHTML = icon(x.dataset.icon, 26); });
  $('#helpBtn').addEventListener('click', () => $('#help').showModal());
  $('#settingsBtn').innerHTML = icon('gear', 18); $('#menuBtn').innerHTML = icon('menu', 18);
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#settingsList').addEventListener('click', (e) => { const b = e.target.closest('[data-set]'); if (b) runSetting(b.dataset.set); });
  $('#menuBtn').addEventListener('click', (e) => { const r = e.currentTarget.getBoundingClientRect(); desktop?.showMenu?.(r.left, r.bottom); });
  $('#themeBtn').addEventListener('click', () => { renderThemes(); $('#themes').showModal(); });
  $('#themeList').addEventListener('click', (e) => { const b = e.target.closest('[data-theme-id]'); if (b) applyTheme(b.dataset.themeId); });
  $('#levelBtn').addEventListener('click', () => { renderLevels(); $('#levels').showModal(); });
  $('#levelList').addEventListener('click', (e) => { const b = e.target.closest('[data-level]'); if (b) { setLevel(b.dataset.level); $('#levels').close(); } });
  $('#checkBtn').addEventListener('click', check);
  $('#mixPlan').addEventListener('click', (e) => {
    if (!e.target.closest('[data-a="cue-b"]')) return;
    const plan = currentPlan(); if (!plan) return;
    const T = decks[plan.to]; if (T.playing) return;
    T.seek(plan.bStart); toast(`Deck ${LETTER[plan.to]} is ready at its first beat. Press play on GO.`);
  });
  $('#lessonsBtn').innerHTML = icon('book', 18); $('#aiBtn').innerHTML = icon('wand', 18);
  $('#lessonsBtn').addEventListener('click', () => setPane(!state.paneOpen));
  $('#aiBtn').addEventListener('click', openAI);
  $('#ctlBtn').addEventListener('click', openCtl);
  $('#sinkSel').addEventListener('change', (e) => useSink(e.target.value));
  navigator.mediaDevices?.addEventListener?.('devicechange', () => { if ($('#ctlDlg').open) listSinks(); });
  $('#tutor').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.a === 'close') setPane(false);
    else if (b.dataset.a === 'restart-lesson') startLesson(state.lessonId);
    else if (b.dataset.a === 'need-level') setLevel(b.dataset.level);
    else if (b.dataset.lesson) startLesson(b.dataset.lesson);
  });
  $('#aiForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#aiErr').textContent = ''; $('#aiSave').disabled = true; $('#aiSave').textContent = 'Checking…';
    const r = await aiSetKey($('#aiKey').value);
    $('#aiSave').disabled = false; $('#aiSave').textContent = 'Save key';
    if (r?.error) { $('#aiErr').textContent = r.error; return; }
    $('#aiKey').value = ''; state.ai = r; renderAI(); toast('AI coach connected.');
  });
  $('#aiRemove').addEventListener('click', async () => { state.ai = await aiClearKey(); renderAI(); });
  $('#coach').addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'music') { const side = decks.left.buffer ? 'right' : 'left'; focusLibrary(side, side === 'right' && state.f.upNext ? 'suggested' : 'all'); }
    else if (b.dataset.a === 'skip') { const L = lesson(), st = L.steps[stepIndex(L, state.ticked)]; if (st) { state.ticked.add(st.id); state.skippedAny = true; state.coachKey = null; } }
    else if (b.dataset.a === 'again') mixAgain();
    else if (b.dataset.a === 'repeat') startLesson(state.lessonId);
    else if (b.dataset.a === 'next') startLesson(b.dataset.lesson);
    else if (b.dataset.a === 'levelup') { state.cleanMixes = 0; store.set('cleanMixes', 0); setLevel(b.dataset.level); mixAgain(); }
  });
  $('#welcomeView').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-source]'); if (!b || b.disabled) return;
    if (await useSource(b.dataset.source)) { $('#welcomeView').classList.add('hidden'); focusLibrary('left', 'all'); }
  });
  $('#libTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { state.tab = b.dataset.tab; renderLibrary(); } });
  $('#source').addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'menu') { state.menuOpen = !state.menuOpen; state.importMenu = false; renderSource(); return; }
    if (a === 'import-menu') { state.importMenu = !state.importMenu; state.menuOpen = false; renderSource(); return; }
    if (a === 'cancel-import') { state.importCancelled = true; desktop?.library?.cancelImport(); return; }
    if (a === 'copy-all') { state.menuOpen = false; renderSource(); return importLibTracks(state.tracks.filter(lib.canImport)); }
    const imp = e.target.closest('[data-import]'); if (imp) return importDialog(imp.dataset.import);
    const b = e.target.closest('[data-source]'); if (b && !b.disabled) useSource(b.dataset.source);
  });
  document.addEventListener('pointerdown', (e) => {
    if ((state.menuOpen || state.importMenu) && !e.target.closest('#source')) { state.menuOpen = false; state.importMenu = false; renderSource(); }
  });
  // library panel size
  $('#libExpand').addEventListener('click', () => setLibView(state.libView === 'expanded' ? 'normal' : 'expanded'));
  $('#libCollapse').addEventListener('click', () => setLibView(state.libView === 'collapsed' ? 'normal' : 'collapsed'));
  new ResizeObserver(() => measureLibLift()).observe($('.decks-row'));
  applyLibView();
  // crates
  const cr = $('#crates');
  cr.addEventListener('click', (e) => {
    if (e.target.closest('[data-crate-edit]')) return;
    const act = e.target.closest('[data-crate-a]')?.dataset.crateA, c = e.target.closest('[data-crate]');
    if (act === 'new') return newCrate();
    if (act === 'rename') { state.editCrate = c.dataset.crate; return renderCrates(); }
    if (act === 'delete') return deleteCrate(c.dataset.crate);
    if (c) openCrate(c.dataset.crate);
  });
  cr.addEventListener('dblclick', (e) => { const c = e.target.closest('[data-crate]'); if (c?.dataset.crate) { state.editCrate = c.dataset.crate; renderCrates(); } });
  cr.addEventListener('keydown', (e) => {
    const input = e.target.closest('[data-crate-edit]');
    if (input) { if (e.key === 'Enter') commitCrateName(input, true); else if (e.key === 'Escape') { e.stopPropagation(); commitCrateName(input, false); } return; }
    const c = e.target.closest('[data-crate]');
    if (c && (e.key === 'Enter' || e.key === ' ') && e.target === c) { e.preventDefault(); openCrate(c.dataset.crate); }
  });
  cr.addEventListener('focusout', (e) => { const input = e.target.closest('[data-crate-edit]'); if (input) commitCrateName(input, true); });
  const dropTarget = (e) => e.target.closest('[data-crate], [data-crate-a="new"]');
  cr.addEventListener('dragover', (e) => {
    const t = dropTarget(e); if (!t || !(hasTracks(e) || hasFiles(e))) return;
    e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy';
    $$('.crate.drop', cr).forEach((x) => x !== t && x.classList.remove('drop')); t.classList.add('drop');
  });
  cr.addEventListener('dragleave', (e) => { const t = dropTarget(e); if (t && !t.contains(e.relatedTarget)) t.classList.remove('drop'); });
  cr.addEventListener('drop', (e) => {
    const t = dropTarget(e); if (!t) return;
    e.preventDefault(); e.stopPropagation(); t.classList.remove('drop');
    dropOnCrate(t, e);
  });
  // audio files from Finder / Explorer dropped anywhere else on the library: copy into My library
  const libEl = $('#library');
  libEl.addEventListener('dragover', (e) => { if (lib.hasManaged() && hasFiles(e) && !hasTracks(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; libEl.classList.add('filedrop'); } });
  libEl.addEventListener('dragleave', (e) => { if (!libEl.contains(e.relatedTarget)) libEl.classList.remove('filedrop'); });
  libEl.addEventListener('drop', (e) => {
    libEl.classList.remove('filedrop');
    if (!lib.hasManaged() || !hasFiles(e) || hasTracks(e)) return;
    e.preventDefault();
    importDropped([...e.dataTransfer.files], { crateId: currentCrate()?.id || null });
  });
  $('#list').addEventListener('dragstart', (e) => {
    const row = e.target.closest('.trow[data-id]'); if (!row) return;
    const ids = dragIds(row);
    e.dataTransfer.setData(TRACK_MIME, JSON.stringify(ids));
    e.dataTransfer.setData('text/plain', ids.map((id) => state.tracks.find((t) => t.id === id)?.title || '').join(', '));
    e.dataTransfer.effectAllowed = 'copy';
  });
  $('#libBanner').addEventListener('click', async (e) => {
    if (e.target.closest('[data-a="untarget"]')) { state.target = null; renderLibrary(); }
    if (e.target.closest('[data-a="reconnect"]')) {
      const h = state.reconnect;
      if ((await h.requestPermission({ mode: 'read' })) === 'granted') { store.set('source', 'folder'); state.source = 'folder'; scanFolder(h, ++state.scanToken); renderLibrary(); }
    }
  });
  $('#dirInput').addEventListener('change', async (e) => {
    const files = [...e.target.files]; if (!files.length) return;
    const token = ++state.scanToken;
    state.analysing = { text: `Reading ${files.length} files…` }; renderSource();
    const tracks = await lib.tracksFromFileList(files);
    setTracks(tracks, files[0].webkitRelativePath?.split('/')[0] || 'Music folder', 'folder'); analyse(tracks, token);
    $('#welcomeView').classList.add('hidden');
  });
  $('#search').addEventListener('input', (e) => { state.query = e.target.value; renderList(); });
  $('#list').addEventListener('change', (e) => {
    if (e.target.id === 'setMinutes') { state.setMinutes = +e.target.value; store.set('setMinutes', state.setMinutes); }
    if (e.target.id === 'setVibe') { state.setVibe = e.target.value; store.set('setVibe', state.setVibe); }
  });
  $('#list').addEventListener('input', (e) => { if (e.target.id === 'setIdea') state.setIdea = e.target.value; });
  const rowTrack = (e) => { const row = e.target.closest('.trow[data-id]'); return row && state.tracks.find((x) => x.id === row.dataset.id); };
  $('#list').addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'ask-ai') return askAICoach();
    if (a === 'build-ai') return buildSet(true);
    if (a === 'build-quick') return buildSet(false);
    if (a === 'load-next') return loadNextFromSet();
    if (a === 'clear-set') { state.set = null; store.set('set', null); return renderList(); }
    if (a === 'ai-settings') return openAI();
    const imp = e.target.closest('[data-import]'); if (imp) return importDialog(imp.dataset.import);
    const rb = e.target.closest('[data-row]');
    if (rb) {
      const t = rowTrack(e); if (!t) return;
      if (rb.dataset.row === 'import') return importLibTracks([t]);
      if (rb.dataset.row === 'uncrate' && currentCrate()) return crateOp('remove', { id: currentCrate().id, trackIds: [t.libId] });
      return;
    }
    const b = e.target.closest('[data-load]');
    if (b) { const t = rowTrack(e); if (t) loadTo(b.dataset.load, t); return; }
    selectRow(e);
  });
  $('#list').addEventListener('dblclick', (e) => {
    if (e.target.closest('[data-load]')) return;
    const t = rowTrack(e); if (!t) return;
    let side = state.target || (decks.left.buffer ? 'right' : 'left');
    if (!state.target && isLive(side)) side = side === 'left' ? 'right' : 'left'; // never replace the track the room hears
    loadTo(side, t);
  });
  window.addEventListener('resize', () => { for (const s of SIDES) decks[s]._wave = null; });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') nudge('right', 0); });
  desktop?.onCommand?.(runCommand);
}

/** Commands from the desktop app's menus. */
function runCommand(cmd) {
  ({
    'source-practice': () => useSource('practice'),
    'source-folder': () => useSource('folder'),
    'source-rekordbox': () => useSource('rekordbox'),
    'source-managed': () => useSource('managed'),
    'library-import': () => importDialog('files'),
    'play-left': () => togglePlay('left'),
    'play-right': () => togglePlay('right'),
    search: () => focusLibrary(null),
    level: () => { renderLevels(); $('#levels').showModal(); },
    theme: () => { renderThemes(); $('#themes').showModal(); },
    help: () => $('#help').showModal(),
    'restart-lesson': () => startLesson(state.lessonId),
    'toggle-lessons': () => setPane(!state.paneOpen),
    'build-set': () => focusLibrary(null, 'set'),
    ai: openAI,
    controller: openCtl,
  }[cmd] || (() => {}))();
}

function onKey(e) {
  const typing = !!e.target?.matches?.('input[type=search], input[type=text]');
  if (e.key === 'Escape') { if (typing) e.target.blur(); if (state.target) { state.target = null; renderLibrary(); } return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || !$('#welcomeView').classList.contains('hidden')) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.source === 'managed' && state.tab !== 'set' && !e.target?.matches?.('input, textarea, select')) {
    const ids = state.libSel.size ? [...state.libSel] : state.libSelId ? [state.libSelId] : [];
    if (!ids.length) return;
    e.preventDefault();
    const crate = currentCrate();
    if (crate) crateOp('remove', { id: crate.id, trackIds: ids.map((id) => state.tracks.find((t) => t.id === id)?.libId).filter(Boolean) });
    else deleteFromLibrary(ids);
    return;
  }
  const k = e.key.toLowerCase();
  const act = {
    q: () => togglePlay('left'),
    p: () => togglePlay('right'),
    arrowup: () => stepTempo('right', e.shiftKey ? 1 : FINE),
    arrowdown: () => stepTempo('right', e.shiftKey ? -1 : -FINE),
    arrowleft: () => { if (!e.repeat) { nudge('right', -1); state.did.add('jog'); } },
    arrowright: () => { if (!e.repeat) { nudge('right', 1); state.did.add('jog'); } },
    l: () => setPane(!state.paneOpen),
    '[': () => moveXfader(state.xfader - 0.05),
    ']': () => moveXfader(state.xfader + 0.05),
    '/': () => focusLibrary(null),
    c: check,
    '?': () => $('#help').showModal(),
  }[k];
  if (!act) return;
  if (e.target?.matches?.('input[type=range]') && k.startsWith('arrow')) e.target.blur();
  e.preventDefault(); act();
}

// ---------- set builder ----------
function setItems() {
  if (!state.set) return [];
  const byId = new Map(state.tracks.map((t) => [t.id, t]));
  return state.set.items.map((i) => ({ ...i, track: byId.get(i.id) })).filter((i) => i.track);
}
function saveSet(set) {
  state.set = set && { title: set.title, story: set.story, ai: !!set.ai, items: set.items.map((i) => ({ id: i.track.id, why: i.why, tip: i.tip || '' })), played: [] };
  store.set('set', state.set);
}

async function buildSet(useAI) {
  if (!state.tracks.length) return toast('Add some music first.');
  const first = decks.left.track || null;
  if (!useAI) {
    const items = quickSet(state.tracks, { minutes: state.setMinutes, vibe: state.setVibe, first });
    saveSet({ title: `${VIBES.find((v) => v.id === state.setVibe).name} set`, story: `Built from your library: neighbouring keys, small speed changes and an energy shape that fits the vibe.`, items });
    return renderList();
  }
  if (!state.ai.hasKey) { toast('Connect the AI coach first.'); return openAI(); }
  state.setBusy = true; renderList();
  try {
    const r = await buildSetAI({ library: state.tracks, minutes: state.setMinutes, vibe: VIBES.find((v) => v.id === state.setVibe).name, idea: state.setIdea, level: state.level, first });
    saveSet({ ...r, ai: true });
  } catch (err) { toast(err.message); if (err.noKey) openAI(); }
  finally { state.setBusy = false; renderList(); }
}

function nextSetItem() {
  const loaded = new Set(SIDES.map((s) => decks[s].track?.id));
  const items = setItems(), played = new Set(state.set?.played || []);
  return items.find((i) => !played.has(i.track.id) && !loaded.has(i.track.id)) || null;
}
function loadNextFromSet() {
  const n = nextSetItem(); if (!n) return toast('That\'s the end of the set.');
  // Load on whichever deck the room isn't hearing.
  const side = !decks.left.buffer ? 'left' : !decks.right.buffer ? 'right' : state.xfader < 0.5 ? 'right' : 'left';
  const old = decks[side].track?.id; if (old && !state.set.played.includes(old)) { state.set.played.push(old); store.set('set', state.set); }
  loadTo(side, n.track);
}

function renderSet(el) {
  const items = setItems(), next = nextSetItem(), played = new Set(state.set?.played || []);
  const loaded = new Map(SIDES.map((s) => [decks[s].track?.id, s]));
  const form = `<div class="set-form">
    <label>Length <select id="setMinutes">${[30, 45, 60, 90, 120].map((m) => `<option value="${m}" ${m === state.setMinutes ? 'selected' : ''}>${m} min</option>`).join('')}</select></label>
    <label>Vibe <select id="setVibe">${VIBES.map((v) => `<option value="${v.id}" ${v.id === state.setVibe ? 'selected' : ''} title="${esc(v.blurb)}">${esc(v.name)}</option>`).join('')}</select></label>
    <input type="text" id="setIdea" placeholder="Describe the night (optional): sunset rooftop, deep and warm…" value="${esc(state.setIdea)}">
    ${state.setBusy ? '<span class="status"><span class="spinner"></span> Building your set…</span>' : `<button class="primary" data-a="build-ai" title="${state.ai.hasKey ? 'Claude plans the set from your library' : 'Connect the AI coach first'}">${icon('wand', 15)} Build with AI</button>
    <button data-a="build-quick" title="Instant, no internet needed">Quick build</button>`}
    ${decks.left.track ? `<span class="small muted">Starts from deck A: ${esc(decks.left.track.title)}</span>` : ''}
  </div>`;
  if (!items.length) {
    el.innerHTML = form + `<div class="empty">${icon('list', 30)}<b>Plan a set</b><span>Pick a length and a vibe. The AI coach orders your tracks into a set that flows, with a tip for every mix.${state.ai.hasKey ? '' : ' <button class="ghost" data-a="ai-settings">Connect the AI coach</button> or use Quick build.'}</span></div>`;
    return;
  }
  el.innerHTML = form + `<div class="set-head">${state.set.ai ? '<span class="ai-badge">AI</span>' : icon('list', 16)}<div style="min-width:0;flex:1"><b>${esc(state.set.title)}</b><p>${esc(state.set.story)} · ${items.length} tracks · about ${setMinutes(items)} min</p></div>
      ${next ? `<button class="primary" data-a="load-next">Load next: ${esc(next.track.title)}</button>` : ''}<button class="ghost" data-a="clear-set">Clear</button></div>`
    + items.map((i, n) => {
      const on = loaded.get(i.track.id);
      return `<div class="srow ${i === next ? 'next' : ''} ${played.has(i.track.id) ? 'played' : ''}" data-id="${esc(i.track.id)}">
        <span class="num">${n + 1}</span>${keyBadge(i.track)}
        <span style="min-width:0"><span class="t" style="display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${on ? `<span style="color:var(--${on})">● </span>` : ''}${esc(i.track.title)}</span><span class="a" style="display:block;color:var(--ink-2);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(i.track.artist)}</span></span>
        <span class="n" style="font-variant-numeric:tabular-nums">${fmtBpm(i.track.bpm)}</span>
        <span class="tip"><b>${esc(i.why)}</b>${i.tip ? `<br>${esc(i.tip)}` : ''}</span>
        <span class="acts" style="display:flex;gap:4px;justify-content:flex-end"><button class="l" data-load="left" style="padding:1px 8px;font-size:11px;font-weight:700;color:var(--left)">A</button><button class="r" data-load="right" style="padding:1px 8px;font-size:11px;font-weight:700;color:var(--right)">B</button></span></div>`;
    }).join('');
}

// ---------- AI coach ----------
function openAI() { renderAI(); $('#aiDlg').showModal(); }
function renderAI() {
  const a = state.ai;
  $('#aiState').innerHTML = a.hasKey ? `<span class="ok-pill">${icon('check', 14)} Connected · ${esc(a.model || 'Claude')}</span>` : `<span class="off-pill">${icon('key', 14)} Not connected</span>`;
  $('#aiRemove').classList.toggle('hidden', !a.hasKey);
  $('#aiKey').placeholder = a.hasKey ? 'Paste a new key to replace it' : 'sk-ant-…';
  $('#aiWhere').textContent = a.where === 'desktop'
    ? `Your key is encrypted with your computer's secure storage${a.secure ? '' : ' (not available on this computer)'} and never leaves the app except to talk to Anthropic.`
    : 'In this browser the key is stored on this computer only. The desktop app keeps it encrypted instead.';
  $('#aiBtn').classList.toggle('on', !!a.hasKey);
  if (state.tab === 'set' || state.tab === 'suggested') renderList();
}

async function askAICoach() {
  const ref = decks.left.track; if (!ref) return toast('Load a track on deck A first.');
  if (!state.ai.hasKey) { toast('Connect the AI coach first.'); return openAI(); }
  state.aiBusy = true; renderList();
  try {
    const ranked = lib.rankNext(ref, state.tracks, { exclude: [decks.right.track?.id], limit: 25 });
    const r = await suggestAI({ current: ref, ranked, played: [], level: state.level });
    state.aiPicks = { forId: ref.id, ...r };
  } catch (err) { toast(err.message); if (err.noKey) openAI(); }
  finally { state.aiBusy = false; renderList(); }
}

// ---------- DJ controller ----------
const ctlState = { connected: [], unknown: [], sinks: [], log: [], timers: [] };
async function initController() {
  if (!navigator.requestMIDIAccess) return renderCtl();
  try {
    // SysEx lets us say hello to controllers that wait for DJ software (the FLX4 does); plain MIDI if not allowed.
    const access = await navigator.requestMIDIAccess({ sysex: true }).catch(() => navigator.requestMIDIAccess());
    const bind = () => {
      const before = ctlState.connected.map((c) => c.name).join();
      ctlState.connected = []; ctlState.unknown = [];
      ctlState.timers.forEach(clearInterval); ctlState.timers = [];
      for (const input of access.inputs.values()) {
        if (input.state === 'disconnected') continue;
        const profile = detectController(input.name);
        if (!profile) { ctlState.unknown.push(input.name); input.onmidimessage = null; continue; }
        const ctl = emptyController();
        input.onmidimessage = (e) => onControllerMessage(profile, ctl, e.data);
        ctlState.connected.push({ name: profile.name, profile });
        // keep-alive: the same hello Mixxx sends, at start and on a timer
        const k = KEEPALIVE[profile.id];
        const out = k && access.sysexEnabled && [...access.outputs.values()].find((o) => o.state !== 'disconnected' && o.name === input.name);
        if (out) {
          const hello = () => { try { out.send(k.bytes); } catch { /* port went away */ } };
          hello(); ctlState.timers.push(setInterval(hello, k.everyMs));
        }
        const lightsOut = profile.id === 'ddj-flx4' && [...access.outputs.values()].find((o) => o.state !== 'disconnected' && o.name === input.name);
        if (lightsOut) { ctlState.lightsOut = lightsOut; ctlState.lightCache = new Map(); }
      }
      const now = ctlState.connected.map((c) => c.name).join();
      if (now && now !== before) toast(`${ctlState.connected[0].name} connected. Your decks and mixer follow it now.`);
      renderCtl();
    };
    access.onstatechange = bind; bind();
  } catch (err) { console.warn('MIDI unavailable', err); ctlState.error = 'Cue Coach wasn\'t allowed to use MIDI, so it can\'t read controllers. Restart the app and try again.'; renderCtl(); }
}

let syncTold = -Infinity; // when we last explained there's no sync (shown at most every 8 s)
function onControllerMessage(profile, ctl, data) {
  if (data[0] === 0xF0) return; // SysEx replies to our keep-alive
  const a = midiToAction(profile, ctl, data, { tempoRange: tempoRange(state.level) });
  logMidi(data, a);
  if (!a) return;
  const d = a.side ? decks[a.side] : null;
  switch (a.type) {
    case 'play': return togglePlay(a.side);
    case 'restart': if (d.buffer) { d.seek(d.track.grid?.firstDownbeat || 0); state.did.add('restart'); } return;
    case 'sync': // BEAT SYNC = Align: line this deck's phrase up with the other deck (no tempo sync)
      if (alignDeck(a.side)) return;
      if (performance.now() - syncTold > 8000) { syncTold = performance.now(); toast('No tempo sync in Cue Coach: match the speed with the tempo fader. BEAT SYNC lines up the phrase when the decks are 1–2 bars apart.'); }
      return;
    case 'jog': return jogFromController(a.side, a.ticks);
    case 'search': return jogFromController(a.side, a.ticks, true);
    case 'pad': {
      // pads we have codes for say their mode; Pad FX pads (no known codes) follow the deck's current mode
      let mode = a.mode;
      if (!mode) { if (d.padMode !== 'fx1' && d.padMode !== 'fx2') return; mode = d.padMode; }
      if (mode !== d.padMode) setPadMode(a.side, mode);
      return padPress(a.side, a.pad, a.down, a.shift, mode);
    }
    case 'padMode': return setPadMode(a.side, a.mode);
    case 'loopIn': return loopIn(a.side);
    case 'loopOut': return loopOut(a.side);
    case 'reloop': return reloop(a.side);
    case 'loopHalf': return scaleDeckLoop(a.side, 0.5);
    case 'loopDouble': return scaleDeckLoop(a.side, 2);
    case 'jump': if (d.buffer) d.seek(jumpBy(d.track.grid, d.position(), a.beats)); return;
    case 'fxOn': state.bfx.on = !state.bfx.on; return applyBfx();
    case 'fxSelect': state.bfx.i = (state.bfx.i + a.step + FX.length) % FX.length; return applyBfx();
    case 'fxBeats': state.bfx.b = Math.max(0, Math.min(BFX_BEATS.length - 1, state.bfx.b + a.step)); return applyBfx();
    case 'fxChannel': state.bfx.ch = a.ch; return applyBfx();
    case 'fxLevel': { state.bfx.depth = a.value; for (const r of state.bfxRunning) decks[r.side].fx.setDepth(r.id, a.value); const dl = $('[data-dial="fx:depth"]'); if (dl) setDial(dl, a.value); return; }
    case 'trim': return d.setTrim(a.db);
    case 'filter': return d.setFilter(a.value);
    case 'browse': return moveLibSel(a.steps);
    case 'browsePress': { const tabs = ['suggested', 'all', 'set'].filter((t) => t !== 'suggested' || state.f.upNext); state.tab = tabs[(tabs.indexOf(state.tab) + 1) % tabs.length]; return renderLibrary(); }
    case 'load': return loadSelected(a.side);
    case 'tempo': if (d.buffer) d.setTempo(a.pct); return;
    case 'eq': return setEQ(a.side, a.band, a.db);
    case 'volume': { d.setVolume(a.value); const f = $(`[data-vol="${a.side}"]`); if (f && document.activeElement !== f) f.value = a.value; return; }
    case 'listen': return setListen(a.side, a.on);
    case 'xfader': return moveXfader(a.value);
  }
}

/**
 * Jog wheel. While playing, the nudge follows how fast you turn: a quarter turn in half a second speeds
 * the track up about 12%, and it eases off as soon as you stop. While paused, it moves through the track
 * like a record: one full turn is 1.8 seconds of music (33⅓ rpm). Shift + jog searches quickly.
 */
const JOG_GAIN = 0.00033; // speed bend per jog step per second
function jogFromController(side, ticks, search = false) {
  const d = decks[side]; if (!d.buffer || !ticks) return;
  const clampPos = (t) => Math.max(0, Math.min(d.buffer.duration - 0.1, t));
  if (search) { d.seek(clampPos(d.position() + ticks * 0.06)); state.did.add('scrub'); return; }
  if (!d.playing) { d.seek(clampPos(d.position() + ticks * (1.8 / JOG_STEPS_PER_TURN))); state.did.add('scrub'); return; }
  state.did.add('jog');
  d._jogAcc = (d._jogAcc || 0) + ticks;
  if (!d._jogLoop) { d._jogLast = performance.now(); d._jogSpeed = 0; d._jogLoop = setInterval(() => jogTick(d), 16); }
}
function jogTick(d) {
  const now = performance.now(), dt = Math.max(0.004, (now - d._jogLast) / 1000);
  d._jogLast = now;
  d._jogSpeed = d._jogSpeed * 0.6 + (d._jogAcc / dt) * 0.4; d._jogAcc = 0; // steps per second, smoothed
  if (Math.abs(d._jogSpeed) < 4 || !d.playing) { d.setBend(0); clearInterval(d._jogLoop); d._jogLoop = null; return; }
  d.setBend(Math.max(-0.3, Math.min(0.3, d._jogSpeed * JOG_GAIN)));
}

/** The last few controller messages and what Cue Coach did with them (shown in the Controller window). */
function logMidi(data, action) {
  ctlState.log.unshift({ hex: hexBytes(data), text: describeAction(action), used: !!action });
  ctlState.log.length = Math.min(ctlState.log.length, 40);
  if ($('#ctlDlg').open && !logMidi.queued) { logMidi.queued = true; requestAnimationFrame(() => { logMidi.queued = false; renderMidiLog(); }); }
}
function renderMidiLog() {
  $('#midiLog').innerHTML = ctlState.log.length
    ? ctlState.log.map((m) => `<div><span>${m.hex}</span><span class="act ${m.used ? '' : 'unused'}">${esc(m.text)}</span></div>`).join('')
    : '<span class="empty">Nothing yet. Press a button or move a fader on your controller.</span>';
}

/** Light the controller's buttons to match the app (only sending what changed). */
function syncLights() {
  const out = ctlState.lightsOut; if (!out) return;
  const deckLights = (side) => { const d = decks[side]; return { playing: d.playing, loaded: !!d.buffer, listening: d.listening, cues: d.track ? cuesFor(d.track) : [], padMode: d.padMode, loopBeats: d.loop ? d.loop.beats : null }; };
  for (const [st, d1, v] of flx4Lights({ left: deckLights('left'), right: deckLights('right'), fxOn: state.bfx.on })) {
    const key = st * 256 + d1;
    if (ctlState.lightCache.get(key) === v) continue;
    ctlState.lightCache.set(key, v);
    try { out.send([st, d1, v]); } catch { ctlState.lightsOut = null; return; }
  }
  // channel level meters, about 25 times a second, only when the level changes
  const now = performance.now();
  if (now - (ctlState.meterAt || 0) < 40) return;
  ctlState.meterAt = now;
  const level = (side) => (decks[side].buffer ? Math.min(1, decks[side].peak * 0.85) : 0); // normal tracks peak just under the red
  for (const [st, d1, v] of flx4Meters({ left: level('left'), right: level('right') })) {
    const key = st * 256 + d1;
    if (ctlState.lightCache.get(key) === v) continue;
    ctlState.lightCache.set(key, v);
    try { out.send([st, d1, v]); } catch { ctlState.lightsOut = null; return; }
  }
}

/** Switch every light and meter off (when the app closes), so the controller isn't left lit. */
function lightsOff() {
  const out = ctlState.lightsOut; if (!out) return;
  const off = { playing: false, loaded: false, listening: false, cues: [], padMode: null, loopBeats: null };
  try {
    for (const [st, d1] of flx4Lights({ left: off, right: off })) out.send([st, d1, 0]);
    for (const [st, d1] of flx4Meters({})) out.send([st, d1, 0]);
  } catch { /* controller already gone */ }
}
window.addEventListener('beforeunload', lightsOff);

// ---------- library selection from the controller's browse knob ----------
const LIB_ROWS = '#list .trow[data-id], #list .srow[data-id]';
function moveLibSel(steps) {
  const rows = $$(LIB_ROWS); if (!rows.length || !steps) return;
  const cur = rows.findIndex((r) => r.dataset.id === state.libSelId);
  const i = Math.max(0, Math.min(rows.length - 1, (cur < 0 ? -1 : cur) + Math.sign(steps) * Math.min(Math.abs(steps), 5)));
  state.libSelId = rows[i].dataset.id; markLibSel();
  rows[i].scrollIntoView({ block: 'nearest' });
}
function markLibSel() { $$(LIB_ROWS).forEach((r) => r.classList.toggle('sel', r.dataset.id === state.libSelId || state.libSel.has(r.dataset.id))); }
/** Click a row to select it; Cmd/Ctrl-click adds or removes it; Shift-click selects a range. */
function selectRow(e) {
  const row = e.target.closest('.trow[data-id]'); if (!row) return;
  const id = row.dataset.id, ids = $$('#list .trow[data-id]').map((r) => r.dataset.id);
  if (e.shiftKey && state.libSelId && ids.includes(state.libSelId)) {
    const [a, b] = [ids.indexOf(state.libSelId), ids.indexOf(id)].sort((x, y) => x - y);
    state.libSel = new Set(ids.slice(a, b + 1));
  } else if (e.metaKey || e.ctrlKey) {
    if (state.libSel.has(id)) state.libSel.delete(id); else state.libSel.add(id);
    state.libSelId = id;
  } else { state.libSel = new Set([id]); state.libSelId = id; }
  markLibSel();
}
function loadSelected(side) {
  const row = $$(LIB_ROWS).find((r) => r.dataset.id === state.libSelId) || $(LIB_ROWS);
  const t = row && state.tracks.find((x) => x.id === row.dataset.id);
  if (t) loadTo(side, t); else toast('Turn the browse knob to pick a track first.');
}

function renderCtl() {
  const c = ctlState.connected[0];
  const b = $('#ctlBtn');
  b.classList.toggle('on', !!c);
  b.innerHTML = `<span class="led"></span>${c ? esc(c.name.replace(/^(Pioneer|Hercules|Numark) /, '')) : 'No controller'}`;
  $('#ctlState').innerHTML = c
    ? `<span class="ok-pill">${icon('check', 14)} ${esc(c.name)} connected</span>`
    : `<span class="off-pill">No controller connected</span>${ctlState.error ? `<span class="err">${esc(ctlState.error)}</span>` : ''}${ctlState.unknown.length ? `<span class="small muted">Found ${esc(ctlState.unknown.join(', '))}, which Cue Coach doesn't support yet.</span>` : ''}`;
}

// ---------- sound output ----------
async function listSinks() {
  const sel = $('#sinkSel');
  let outs = [];
  try { outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default'); } catch { /* no device list */ }
  const cur = store.get('sink', '');
  sel.innerHTML = `<option value="">Computer default</option>${outs.map((d, i) => `<option value="${esc(d.deviceId)}" ${d.deviceId === cur ? 'selected' : ''}>${esc(d.label || `Output ${i + 1}`)}</option>`).join('')}`;
  sel.disabled = !ctx.setSinkId;
}
async function useSink(id) {
  if (!ctx.setSinkId) return;
  try { await ctx.setSinkId(id); store.set('sink', id); }
  catch (err) { toast(`Couldn't switch the sound output: ${err.message}`); listSinks(); }
}
function openCtl() { renderCtl(); renderMidiLog(); listSinks(); $('#ctlDlg').showModal(); }

// ---------- rekordbox helper ----------
/**
 * The rekordbox helper can take a while to start, especially the first time on Windows. Keep checking for up
 * to 3 minutes instead of deciding "not connected" at launch. Resolves true once rekordbox answers.
 */
async function watchRekordbox() {
  const started = performance.now();
  const note = (t) => { state.rbNote = t; $('#rbChoiceNote').textContent = t; renderSource(); };
  while (performance.now() - started < 180000) {
    if (await lib.rekordboxAvailable()) {
      const waited = state.rbWaited;
      state.rbAvailable = true; state.rbNote = ''; $('#rbChoice').disabled = false;
      $('#rbChoiceNote').textContent = 'Use the tracks, beat grids and keys you already have.'; renderSource();
      if (waited && state.source !== 'rekordbox') toast('rekordbox is connected. Choose it from the music menu in the library.');
      return true;
    }
    state.rbWaited = true; state.rbAvailable = false; $('#rbChoice').disabled = true;
    const st = desktop?.helperStatus ? await desktop.helperStatus().catch(() => null) : null;
    if (!st) { note('Not connected. rekordbox works in the desktop app.'); return false; }
    if (['unavailable', 'failed', 'stopped'].includes(st.state)) { note(st.message || 'The rekordbox helper stopped.'); return false; }
    note('Connecting to rekordbox…');
    await new Promise((r) => setTimeout(r, 2500));
  }
  note('rekordbox didn\'t answer. Is it installed on this computer?');
  return false;
}

// ---------- settings ----------
const SETTINGS = [
  ['music', 'folder', 'Music library', 'Practice tracks, a music folder or your rekordbox library'],
  ['controller', 'keyboard', 'Controller and sound', 'Your DJ controller, and where the sound comes out'],
  ['ai', 'wand', 'AI coach', 'Connect Claude for set building and track picks'],
  ['theme', 'palette', 'Appearance', 'Light, dark and colour themes'],
  ['level', 'level', 'Your level', 'How much help and how many controls you see'],
  ['lessons', 'book', 'Lessons', 'Show or hide the lessons pane'],
  ['help', 'help', 'Keyboard shortcuts', 'Every key Cue Coach listens to'],
];
function openSettings() {
  $('#settingsList').innerHTML = SETTINGS.map(([id, ic, name, note]) => `<button data-set="${id}">${icon(ic, 18)}<span><b>${name}</b><small>${note}</small></span></button>`).join('');
  $('#settingsDlg').showModal();
}
function runSetting(id) {
  $('#settingsDlg').close();
  if (id === 'music') { state.menuOpen = true; renderSource(); $('#library').scrollIntoView({ block: 'nearest' }); return; }
  if (id === 'lessons') return setPane(!state.paneOpen);
  runCommand({ controller: 'controller', ai: 'ai', theme: 'theme', level: 'level', help: 'help' }[id]);
}

// ---------- start ----------
async function boot() {
  if (desktop?.platform) document.documentElement.classList.add(desktop.platform);
  applyTheme(store.get('theme', 'auto'));
  bind();
  setLevel(state.level, true);
  renderSource();
  startLesson(state.lessonId);
  aiStatus().then((st) => { state.ai = st; renderAI(); });
  initController();
  const sink = store.get('sink', ''); if (sink && ctx.setSinkId) ctx.setSinkId(sink).catch(() => store.set('sink', ''));
  const rb = watchRekordbox();
  if (!state.source) { $('#welcomeView').classList.remove('hidden'); return; }
  if (state.source === 'rekordbox') {
    // the helper may still be starting: wait for it rather than switching your library to practice tracks
    state.analysing = { text: 'Connecting to rekordbox…', spin: true }; renderSource();
    if (await rb) return useSource('rekordbox', { fromGesture: false });
    state.analysing = null; renderSource();
    toast(`Couldn't reach rekordbox${state.rbNote ? `: ${state.rbNote}` : ''}. Showing practice tracks for now.`);
    setTracks(lib.practiceLibrary(), 'Practice tracks', 'practice'); // not saved: rekordbox stays your choice
    return;
  }
  const ok = await useSource(state.source, { fromGesture: false });
  if (!ok && state.source !== 'folder') await useSource('practice');
}

boot();
requestAnimationFrame(frame);

