// Cue Coach "Learn": a beginner-first DJ app. Two decks, a mixer, a music library and a coach that fades
// out as you level up. Works with mouse and keyboard; a controller is optional (later).
import { ctx, Deck, beatmatch, synthDemoTrack, estimateGrid, setCrossfader } from './audio.js';
import { beatLen, barLen, fmtTime, timeOfBar } from './engine.js';
import * as lib from './musiclib.js';
import { readTags, TAG_BYTES } from './tags.js';
import { beatHint, updateAligned, fill, HOLD_S, ALIGN_MS, TEMPO_OK } from './lesson.js';
import { LESSONS, TIERS, lessonById, advanceLesson, stepIndex, nextLesson, courseProgress } from './lessons.js';
import { VIBES, EVENTS, AUDIENCES, quickSet, setMinutes, setSources, tracksFrom, NEW_SET_TITLE, makeSet, inSet, toggleInSet, addToSet, removeFromSet, moveInSet, voteInSet, mergeRefined, refineSet } from './setbuilder.js';
import { aiStatus, aiSetKey, aiClearKey, buildSetAI, refineSetAI, suggestAI } from './coachai.js';
import { keyRelation } from './library.js';
import { bandPeaks, barEnergies, phrasesFromEnergy } from './beatgrid.js';

// Colours that read on every theme: hot cue pads and phrase sections.
const CUE_COLORS = ['#ef4f5c', '#22b573', '#f0a020', '#8b6cf6'];
import { phraseColor, describeTrack, timelineSVG, sectionsFromBars, beatsSVG, phraseSVG, mixMapSVG, GUIDE, GUIDE_PARTS, CHEAT_SHEET, clock } from './songguide.js';
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
import * as stream from './streaming.js';
import * as lay from './layout.js';
import { stopsFor, step as tourStep, shouldAutoStart, progressLabel } from './tour.js';

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
/** The saved set, with a vote on every item (sets saved before votes existed have none). */
function loadSavedSet() {
  const s = store.get('set', null);
  if (!s || !Array.isArray(s.items) || !s.items.length) return null;
  return { title: s.title || NEW_SET_TITLE, story: s.story || '', ai: !!s.ai, items: s.items.filter((i) => i?.id).map((i) => ({ id: i.id, why: i.why || '', tip: i.tip || '', vote: i.vote > 0 ? 1 : i.vote < 0 ? -1 : 0 })), played: Array.isArray(s.played) ? s.played : [] };
}
const SIDES = ['left', 'right'];
const FINE = 0.05; // % per tap: about 0.06 BPM, small enough to land inside the lesson's ±0.1 BPM
const LETTER = { left: 'A', right: 'B' };
const state = {
  welcome: false, source: store.get('source', null), sourceName: '', tracks: [],
  query: '', tab: 'all', target: null, menuOpen: false,
  // My library (desktop app): crates, the open crate, an import in progress, the panel's size, selected rows
  layout: lay.normalize(store.get('layout', null)),
  crates: [], crate: store.get('crate', null), importing: null, importMenu: false, editCrate: null,
  libView: store.get('libView', 'normal'), libSel: new Set(),
  analysing: null, scanToken: 0, loading: {},
  level: store.get('level', 'starter'), f: null,
  aligned: 0, alignLocked: false, cleanMixes: store.get('cleanMixes', 0), checkUntil: 0, xfader: 0, jogUsed: false,
  // lessons
  lessonId: store.get('lesson', 'decks'), completed: store.get('completed', []), paneOpen: store.get('paneOpen', true),
  ticked: new Set(), did: new Set(), skippedAny: false, lessonDone: false, played: { left: 0, right: 0 }, blend: null,
  mixDir: null, mixStartBar: null, mixDone: new Set(), // the next-mix guide: direction, where B really started, steps ticked
  // side panel tab (null: the level decides), set list + AI
  paneTab: store.get('paneTab', null), refineText: '', setFrom: store.get('setFrom', 'all'),
  setEvent: store.get('setEvent', 'club'), setAudience: store.get('setAudience', 'mixed'),
  set: loadSavedSet(), setMinutes: store.get('setMinutes', 60), setVibe: store.get('setVibe', 'journey'), setIdea: '', setBusy: false,
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
      <button class="ghost small" data-a="breakdown" title="What's in this track and where to mix it">${icon('list', 14)} Breakdown</button>
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
      <div class="pc-blocks" title="The 16 bars of the phrase, in four blocks of 4">${[0, 1, 2, 3].map(() => `<i>${'<s></s>'.repeat(4)}</i>`).join('')}</div>
      <div class="pc-line">Phrase <b data-pcphrase>–</b></div>
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
    if (state.paneOpen && (paneTab() === 'track' || state.guideOpen)) { if (decks[side].buffer) state.trackSide = side; renderTutor(); }
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
      resolveWanted(tracks);
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
        <hr><button data-a="import-playlist">${icon('list', 16)}<span>Playlist from Spotify or Apple Music…<small>Make a crate, see which tracks you still need</small></span></button>
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
  renderSetPanel();
}

const MAX_ROWS = 400;
function renderList() {
  const el = $('#list'), ref = decks.left.track, f = state.f;
  const crate = currentCrate();
  const base = state.source === 'managed' ? lib.tracksInCrate(state.tracks, crate) : state.tracks;
  if (state.source === 'managed' && !state.tracks.length) {
    el.innerHTML = `<div class="empty">${icon('library', 30)}<b>My library is empty</b><span>Copy music in and it stays here, even if the drive it came from is unplugged.<br>Drag audio files onto this panel, or:</span>
      <span class="row-btns"><button class="primary" data-import="files">${icon('music', 15)} Import files…</button><button data-import="folder">${icon('folder', 15)} Import a folder…</button></span></div>`;
    return;
  }
  if (!state.tracks.length) { el.innerHTML = `<div class="empty">${icon('music', 30)}<b>No music yet</b><span>Choose where your music comes from with the button above.</span></div>`; return; }
  const wanted = crate && state.tab !== 'suggested' ? wantedRows(crate) : [];
  if (crate && !base.length && !crate.wanted?.length) { el.innerHTML = `<div class="empty">${icon('crate', 30)}<b>${esc(crate.name)} is empty</b><span>Open All tracks and drag tracks onto this crate.</span></div>`; return; }
  let rows;
  if (state.tab === 'suggested') {
    if (!ref) { el.innerHTML = `<div class="empty">${icon('sparkle', 30)}<b>Suggestions appear here</b><span>Load a track on deck A and Cue Coach will rank what mixes well after it.</span></div>`; return; }
    rows = lib.rankNext(ref, lib.searchTracks(base, state.query), { exclude: [decks.right.track?.id], limit: 60 });
  } else {
    rows = lib.searchTracks(base, state.query).map((t) => ({ track: t, match: ref && t.id !== ref.id ? lib.friendlyMatch(ref, t) : null }));
  }
  if (!rows.length && !wanted.length) { el.innerHTML = crate && !base.length && state.tab === 'suggested' ? `<div class="empty">${icon('crate', 30)}<b>Nothing in ${esc(crate.name)} yet</b><span>Its tracks are still to get. Open All to see them.</span></div>` : `<div class="empty">${icon('search', 30)}<b>Nothing matches "${esc(state.query)}"</b><span>Not in your music yet? Buy a copy, import it, and it's yours to mix.</span>${buyButton('primary')}</div>`; return; }
  const loaded = new Map(SIDES.map((s) => [decks[s].track?.id, s]));
  const canAdd = lib.hasManaged() && state.source !== 'managed';
  const setIds = new Set(state.set?.items.map((i) => i.id) || []);
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
  el.innerHTML = aiTop + (rows.length ? head : '') + rows.slice(0, MAX_ROWS).map(({ track: t, match: m }) => {
    const matchCell = !m ? '' : f.matchLabels
      ? `<span class="match ${m.level}">${m.label}</span>${f.matchReasons ? ` <span class="why">${esc(m.why.join(' · '))}</span>` : ''}`
      : `<span class="why">${m.pitch.pct != null ? `${m.pitch.pct >= 0 ? '+' : ''}${m.pitch.pct.toFixed(1)}%` : ''}</span>`;
    const bpm = t.bpm ? `${t.bpm.toFixed(1)}${t.analysed ? '' : '<span class="muted"> ~</span>'}` : '<span class="muted">…</span>';
    const on = loaded.get(t.id), inS = setIds.has(t.id);
    const extra = crate ? `<button data-row="uncrate" title="Remove from ${esc(crate.name)} (the track stays in My library)" aria-label="Remove from crate">${icon('x', 12)}</button>`
      : canAdd && lib.canImport(t) ? `<button data-row="import" title="Copy into My library" aria-label="Copy into My library">${icon('upload', 12)}</button>` : '';
    const linkBtn = `<button class="add" data-row="links" aria-haspopup="menu" title="Listen on Spotify or Apple Music, or buy it" aria-label="Listen or buy">${icon('external', 12)}</button>`;
    const setBtn = `<button class="add ${inS ? 'on' : ''}" data-row="set" aria-pressed="${inS}" title="${inS ? 'In your set. Press to take it out.' : 'Add to the end of your set'}" aria-label="${inS ? 'Take out of set' : 'Add to set'}">${icon(inS ? 'check' : 'plus', 12)}</button>`;
    return `<div class="trow ${on ? 'loaded' : ''}" data-id="${esc(t.id)}" draggable="true" title="Double-click to load. Drag onto a deck or a crate.">${keyBadge(t)}
      <span class="t">${on ? `<span style="color:var(--${on})">● </span>` : ''}${esc(t.title)}</span><span class="a wide">${esc(t.artist)}</span>
      <span class="n">${bpm}</span><span class="n wide muted">${duration(t)}</span><span class="wide mcell">${matchCell}</span>
      <span class="acts">${extra}${linkBtn}${setBtn}<button class="l" data-load="left" title="Load on deck A">A</button><button class="r" data-load="right" title="Load on deck B">B</button></span></div>`;
  }).join('') + (rows.length > MAX_ROWS ? `<div class="empty small">Showing ${MAX_ROWS} of ${rows.length}. Search to narrow it down.</div>` : '')
    + wantedHTML(crate, wanted) + buyBar();
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
      : `<div class="crate ${cur?.id === c.id ? 'on' : ''}" data-crate="${esc(c.id)}" role="button" tabindex="0" title="Double-click to rename">${icon('crate', 15)}<span class="name">${esc(c.name)}</span><span class="count" ${c.wanted?.length ? `title="${c.wanted.length} still to get"` : ''}>${count(c)}${c.wanted?.length ? `<span class="want">+${c.wanted.length}</span>` : ''}</span>
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
  resolveWanted(tracks);
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

// ---------- Spotify and Apple Music: playlists in, links out ----------
/** Searching for a track you don't own: offer the stores. */
const buyButton = (cls = '') => (state.query.trim() ? `<button class="${cls}" data-buy aria-haspopup="menu" title="Buy it on Beatport, Juno, Traxsource, Bandcamp or Amazon">${icon('external', 14)} Buy "${esc(state.query.trim())}"</button>` : '');
const buyBar = () => (state.query.trim() ? `<div class="buy-bar"><span>Don't have the one you're after?</span>${buyButton()}</div>` : '');

/** The crate's tracks still to get that match the search, with their place in the crate's list. */
function wantedRows(crate) {
  const words = state.query.toLowerCase().split(/\s+/).filter(Boolean);
  return (crate.wanted || []).map((w, i) => ({ w, i }))
    .filter(({ w }) => words.every((x) => `${w.title} ${w.artist} ${w.album || ''}`.toLowerCase().includes(x)));
}
function wantedHTML(crate, rows) {
  if (!crate?.wanted?.length || state.tab === 'suggested') return '';
  const n = crate.wanted.length;
  return `<div class="wanted-head"><b>Still to get · ${n}</b><span>Not in My library yet. Get a copy, import it, and it moves into this crate.</span></div>`
    + rows.map(({ w, i }) => `<div class="trow wanted" data-w="${i}"><span></span><span class="t">${esc(w.title)}</span><span class="a wide">${esc(w.artist)}</span>
      <span></span><span class="n wide muted">${duration(w)}</span><span class="wide why">${esc(w.album || '')}</span>
      <span class="acts"><button class="find" data-w-a="find" aria-haspopup="menu" title="Listen on Spotify or Apple Music, or buy it">${icon('search', 12)} Find</button><button data-w-a="remove" title="Take off the list" aria-label="Take ${esc(w.title)} off the list">${icon('x', 12)}</button></span></div>`).join('');
}
function wantedAction(btn, i) {
  const c = currentCrate(), w = c?.wanted?.[i]; if (!w) return;
  if (btn.dataset.wA === 'find') return openLinkMenu(btn, w);
  if (btn.dataset.wA === 'remove') return crateOp('wanted', { id: c.id, wanted: c.wanted.filter((_, j) => j !== i) });
}

/** Tracks still to get that are now in My library move into their crates. */
let resolving = false;
async function resolveWanted(tracks) {
  if (resolving || !lib.hasManaged()) return;
  resolving = true;
  try {
    const moved = [];
    for (const c of state.crates) {
      if (!c.wanted?.length) continue;
      const m = stream.matchPlaylist(c.wanted, tracks);
      const ids = m.filter((x) => x.track).map((x) => x.track.libId);
      if (!ids.length) continue;
      if (await crateOp('add', { id: c.id, trackIds: ids, wanted: m.filter((x) => !x.track).map((x) => x.item) })) moved.push(`${ids.length} into ${c.name}`);
    }
    if (moved.length) toast(`Tracks you were after are here: moved ${moved.join(', ')}.`);
  } finally { resolving = false; }
}

/** Listen or buy: a small menu by the button. */
function openLinkMenu(btn, t, buyFirst = false) {
  const m = $('#linkMenu'), links = stream.trackLinks(t);
  const item = (l) => `<button data-url="${esc(l.url)}" role="menuitem">${icon('external', 14)}<span>${l.kind === 'listen' ? 'Listen on' : 'Buy on'} ${esc(l.label)}</span></button>`;
  const listen = links.filter((l) => l.kind === 'listen').map(item).join(''), buy = links.filter((l) => l.kind === 'buy').map(item).join('');
  m.innerHTML = `<div class="menu-title">${esc([t.artist, t.title].filter(Boolean).join(' – '))}</div>${buyFirst ? `${buy}<hr>${listen}` : `${listen}<hr>${buy}`}`;
  m.classList.remove('hidden');
  const r = btn.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  const x = Math.max(8, Math.min(r.right - w, innerWidth - w - 8));
  const y = r.bottom + 4 + h > innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4;
  m.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  m.querySelector('button')?.focus();
}
const closeLinkMenu = () => $('#linkMenu').classList.add('hidden');

function openPlaylistDlg() {
  if (!lib.hasManaged()) return toast('Playlists become crates in My library, in the Cue Coach desktop app.');
  state.importMenu = false; state.menuOpen = false; renderSource();
  state.playlist = null; $('#plText').value = ''; $('#plInput').value = '';
  // match against My library even when another music source is open
  state.plTracks = state.source === 'managed' ? state.tracks : [];
  if (state.source !== 'managed') lib.loadManaged().then((v) => { state.plTracks = v.tracks; if (state.playlist) readPlaylist(state.playlist.text, state.playlist.fileName); }).catch(() => {});
  const link = (s, url) => (url ? esc(s).replace(new URL(url).host, `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(new URL(url).host)}</a>`) : esc(s));
  $('#plHow').innerHTML = Object.values(stream.EXPORT_HELP).map((h) => `<div><b>${esc(h.label)}</b><ol>${h.steps.map((s) => `<li>${link(s, h.url)}</li>`).join('')}</ol></div>`).join('');
  renderPlaylistPreview();
  $('#plDlg').showModal();
}
function readPlaylist(text, fileName = '') {
  const p = stream.parsePlaylist(text, fileName);
  state.playlist = { ...p, text, fileName, matches: stream.matchPlaylist(p.items, state.plTracks || []) };
  renderPlaylistPreview();
}
function renderPlaylistPreview() {
  const p = state.playlist, el = $('#plPreview');
  $('#plCreate').disabled = !p?.items.length;
  if (!p) { el.innerHTML = ''; return; }
  if (!p.items.length) {
    el.innerHTML = `<div class="err">${p.links ? 'Those are links only, with no track names in them. Export the playlist to a file instead (see above).' : 'No tracks found there. Use a playlist export, or one track per line: Artist - Title.'}</div>`;
    return;
  }
  const MAX = 200, more = p.matches.length - MAX;
  el.innerHTML = `<div class="pl-sum">${esc(stream.playlistSummary(p.matches))}</div>
    <div class="field" style="margin:0"><label for="plName" class="small muted">Crate name</label><input id="plName" type="text" maxlength="80" value="${esc(p.name)}" style="font:inherit"></div>
    <div class="pl-list">${p.matches.slice(0, MAX).map((m) => `<div class="pl-row ${m.track ? 'have' : ''}">${icon(m.track ? 'check' : 'circle', 13)}<span class="t">${esc(m.item.title)}</span><span class="a">${esc(m.item.artist)}</span><span class="small muted">${m.track ? (m.exact ? 'in My library' : 'another mix in My library') : 'to get'}</span></div>`).join('')}
      ${more > 0 ? `<div class="pl-row"><span></span><span class="muted">and ${more} more</span></div>` : ''}</div>`;
}
async function createPlaylistCrate() {
  const p = state.playlist; if (!p?.items.length) return;
  const name = $('#plName')?.value.trim() || p.name;
  const trackIds = [...new Set(p.matches.filter((m) => m.track).map((m) => m.track.libId))];
  const wanted = p.matches.filter((m) => !m.track).map((m) => m.item);
  $('#plCreate').disabled = true;
  const r = await crateOp('create', { name, trackIds, wanted });
  if (!r?.created) { $('#plCreate').disabled = false; return; }
  $('#plDlg').close(); state.playlist = null;
  await openCrate(r.created.id);
  toast(`Made the crate ${r.created.name}: ${stream.playlistSummary(p.matches)}.`);
}
function bindStreaming() {
  $('#plFile').addEventListener('click', () => $('#plInput').click());
  $('#plInput').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 20e6) return toast('That file is too big to be a playlist.');
    $('#plText').value = '';
    readPlaylist(stream.decodeText(new Uint8Array(await f.arrayBuffer())), f.name);
  });
  let typing = 0;
  $('#plText').addEventListener('input', (e) => { clearTimeout(typing); typing = setTimeout(() => readPlaylist(e.target.value), 250); });
  $('#plCancel').addEventListener('click', () => $('#plDlg').close());
  $('#plCreate').addEventListener('click', createPlaylistCrate);
  const m = $('#linkMenu');
  m.addEventListener('click', (e) => { const b = e.target.closest('[data-url]'); if (!b) return; window.open(b.dataset.url, '_blank', 'noopener'); closeLinkMenu(); });
  m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeLinkMenu(); } });
  document.addEventListener('pointerdown', (e) => { if (!m.classList.contains('hidden') && !m.contains(e.target) && !e.target.closest('[data-row="links"], [data-w-a="find"], [data-buy]')) closeLinkMenu(); });
  $('#list').addEventListener('scroll', closeLinkMenu, { passive: true });
  window.addEventListener('resize', closeLinkMenu);
}

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
  const ex = $('#libExpand'), fold = $('#libFold');
  ex.innerHTML = icon(v === 'expanded' ? 'restore' : 'expand', 16);
  ex.title = v === 'expanded' ? 'Back to normal size' : 'Make the library bigger'; ex.setAttribute('aria-pressed', v === 'expanded');
  fold.innerHTML = `<span class="fold-ic">${icon('chevron', 14)}</span>`;
  fold.setAttribute('aria-expanded', String(v !== 'collapsed'));
  fold.title = v === 'collapsed' ? 'Show the library' : 'Collapse the library to its header';
  measureLibLift();
}
/** How far the expanded library reaches up: to just below the decks' title rows. */
function measureLibLift() {
  if (state.libView !== 'expanded') return;
  const row = $('.decks-row'), heads = $$('.decks-row .deck-head');
  if (!row || !heads.length) return;
  // only reach over the decks when they're open and sit right above the library
  const shown = lay.groupOrder(state.layout, 'stage').filter((id) => !state.layout.hidden[id] && !$(`[data-panel="${id}"]`).classList.contains('hidden'));
  if (state.layout.folded.decks || shown[shown.indexOf('library') - 1] !== 'decks') { $('.stage').style.setProperty('--lib-lift', '0px'); return; }
  const rowBottom = row.getBoundingClientRect().bottom, headBottom = Math.max(...heads.map((h) => h.getBoundingClientRect().bottom));
  const gap = parseFloat(getComputedStyle($('.stage')).rowGap) || 10;
  $('.stage').style.setProperty('--lib-lift', `${Math.max(0, Math.round(rowBottom + gap - headBottom - 8))}px`);
}

// ---------- your layout: collapse, move and hide sections (js/layout.js) ----------
const isFolded = (id) => (id === 'library' ? state.libView === 'collapsed' : !!state.layout.folded[id]);
function setLayout(next) {
  state.layout = next; store.set('layout', next);
  lay.applyLayout(next);
  measureLibLift();
  for (const s of SIDES) decks[s]._wave = null; // the decks' waveforms redraw at their new size
  if ($('#layoutDlg').open) renderLayoutDlg();
}
function setFolded(id, on) {
  if (id === 'library') { setLibView(on ? 'collapsed' : 'normal'); if ($('#layoutDlg').open) renderLayoutDlg(); return; }
  setLayout(lay.setFlag(state.layout, 'folded', id, on));
}
function renderLayoutDlg() {
  const L = state.layout, levelOff = { lane: $('#lanePanel').classList.contains('hidden'), mixplan: !state.f.mixGuide };
  $('#layoutList').innerHTML = lay.GROUPS.map((g) => {
    const ids = g.id === 'top' ? ['coach'] : lay.groupOrder(L, g.id);
    return `<div><h3>${esc(g.name)}</h3>${ids.map((id, i) => {
      const p = lay.PANELS.find((x) => x.id === id), shown = !L.hidden[id], folded = isFolded(id);
      const note = levelOff[id] ? 'Not shown at your level' : p.note || '';
      return `<div class="lay-row ${shown ? '' : 'off'}" data-lay="${id}">
        <label><input type="checkbox" data-lay-show ${shown ? 'checked' : ''} aria-label="Show ${esc(p.name)}"><span><b>${esc(p.name)}</b>${note ? `<small>${esc(note)}</small>` : ''}</span></label>
        ${p.noFold ? '<span></span>' : `<button type="button" class="ghost lay-fold" data-lay-fold aria-pressed="${folded}" ${shown ? '' : 'disabled'}>${folded ? 'Expand' : 'Collapse'}</button>`}
        ${p.fixed ? '<span></span><span></span>' : `<button type="button" class="icon-btn" data-lay-move="-1" ${i === 0 ? 'disabled' : ''} title="Move up" aria-label="Move ${esc(p.name)} up">${icon('chevron', 15, 'style="transform:rotate(180deg)"')}</button>
        <button type="button" class="icon-btn" data-lay-move="1" ${i === ids.length - 1 ? 'disabled' : ''} title="Move down" aria-label="Move ${esc(p.name)} down">${icon('chevron', 15)}</button>`}
      </div>`;
    }).join('')}</div>`;
  }).join('');
}
function openLayout() { renderLayoutDlg(); $('#layoutDlg').showModal(); }
function bindLayout() {
  for (const x of $$('.fold-ic')) x.innerHTML = icon('chevron', 14);
  // a section's arrow collapses it; capture, so the panes' own click handlers never see it
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-fold]'); if (!b) return;
    e.stopPropagation();
    setFolded(b.dataset.fold, !isFolded(b.dataset.fold));
  }, true);
  $('#libFold').addEventListener('click', () => setLibView(state.libView === 'collapsed' ? 'normal' : 'collapsed'));
  $('#layoutList').addEventListener('change', (e) => {
    const id = e.target.closest('[data-lay]')?.dataset.lay;
    if (id && e.target.matches('[data-lay-show]')) setLayout(lay.setFlag(state.layout, 'hidden', id, !e.target.checked));
  });
  $('#layoutList').addEventListener('click', (e) => {
    const b = e.target.closest('button'), id = b?.closest('[data-lay]')?.dataset.lay; if (!id) return;
    if (b.matches('[data-lay-fold]')) setFolded(id, !isFolded(id));
    if (b.dataset.layMove) {
      setLayout(lay.move(state.layout, id, +b.dataset.layMove));
      const again = $(`[data-lay="${id}"] [data-lay-move="${b.dataset.layMove}"]`, $('#layoutList'));
      (again && !again.disabled ? again : $(`[data-lay="${id}"] [data-lay-show]`, $('#layoutList')))?.focus();
    }
  });
  $('#layoutReset').addEventListener('click', () => { setLibView('normal'); setLayout(lay.emptyLayout()); });
  $('#layoutDone').addEventListener('click', () => $('#layoutDlg').close());
  // drag a section by its header to move it within its area (the lessons and set panes are redrawn, so delegate)
  let dragging = null;
  const panelOf = (el) => el?.closest?.('[data-panel][data-group]');
  document.addEventListener('dragstart', (e) => {
    const head = e.target.closest?.('.fold-head'), p = panelOf(head);
    if (!head || !p || e.target !== head || head.parentElement !== p) return;
    dragging = p; p.classList.add('lay-drag');
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-cue-panel', p.dataset.panel);
  });
  document.addEventListener('dragover', (e) => {
    if (!dragging) return;
    const p = panelOf(e.target);
    for (const x of $$('.lay-drop')) if (x !== p) x.classList.remove('lay-drop');
    if (!p || p === dragging || p.dataset.group !== dragging.dataset.group) return;
    e.preventDefault(); p.classList.add('lay-drop');
  });
  document.addEventListener('drop', (e) => {
    if (!dragging) return;
    const p = panelOf(e.target);
    if (p && p !== dragging && p.dataset.group === dragging.dataset.group) { e.preventDefault(); setLayout(lay.moveBefore(state.layout, dragging.dataset.panel, p.dataset.panel)); }
  });
  document.addEventListener('dragend', () => { dragging?.classList.remove('lay-drag'); dragging = null; for (const x of $$('.lay-drop')) x.classList.remove('lay-drop'); });
  markDraggable();
  lay.applyLayout(state.layout);
}
/** Section headers you can drag (called again whenever a pane is redrawn). */
function markDraggable(root = document) {
  for (const h of $$('[data-panel][data-group] > .fold-head', root)) h.draggable = true;
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
  if (paneTab() === 'lessons') renderTutor();
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
  const tab = paneTab();
  el.setAttribute('aria-label', tab === 'set' ? 'Set list' : 'Lessons');
  const tabBtn = (id, ic, name) => `<button data-ptab="${id}" role="tab" aria-selected="${tab === id}" class="${tab === id ? 'active' : ''}">${icon(ic, 14)} ${name}</button>`;
  const head = (note) => `<div class="tutor-head"><div class="tabs pane-tabs" role="tablist" aria-label="Side panel">${tabBtn('lessons', 'book', 'Lessons')}${tabBtn('track', 'music', 'Track')}${tabBtn('set', 'list', 'Set')}</div>
      <span class="grow"></span><span class="small muted">${note}</span>
      <button class="icon-btn" data-a="close" title="Hide the side panel (L)" aria-label="Hide the side panel">${icon('x', 16)}</button></div>`;
  if (state.guideOpen) {
    keepFocus(el, head('') + `<div class="tutor-body guide-pane">${guideHTML()}</div>`);
    return;
  }
  if (tab === 'track') {
    keepFocus(el, head('') + `<div class="tutor-body track-pane">${trackPaneHTML()}</div>`);
    return;
  }
  if (tab === 'set') {
    const n = setItems().length;
    keepFocus(el, head(n ? `${n} track${n === 1 ? '' : 's'}` : '') + `<div class="tutor-body set-pane">${setPanelHTML()}</div>`);
    lay.applyLayout(state.layout, el); markDraggable(el);
    return;
  }
  const L = lesson(), idx = state.lessonDone ? L.steps.length : stepIndex(L, state.ticked), prog = courseProgress(state.completed);
  const need = L.needs && !state.f[L.needs] && NEEDS[L.needs];
  const next = nextLesson(L.id, state.completed);
  const stepRow = (st, i) => {
    const cls = i < idx ? 'done' : i === idx ? 'now' : '';
    return `<li class="${cls}">${icon(i < idx ? 'check' : i === idx ? 'dot' : 'circle', 16)}<div><b>${esc(st.title)}</b>${i === idx ? `<p>${esc(st.body)}</p>` : ''}</div></li>`;
  };
  keepFocus(el, `${head("")}
    <div class="tutor-body">
      <button class="guide-entry" data-a="guide">${icon('book', 16)}<span><b>How songs are built</b><small>Beats, phrases and the parts of a track, in 3 minutes</small></span>${icon('chevron', 14, 'style="transform:rotate(-90deg)"')}</button>
      <section class="tutor-sec" data-panel="lesson" data-group="lessons">
      <div class="fold-head">${fold('lesson', 'Current lesson')}</div>
      <div class="lesson-card">
        <span class="tier-tag">${esc(TIERS.find((t) => t.id === L.tier).name)} · ${L.minutes} min</span>
        <h3>${esc(L.title)}</h3>
        <p class="why">${esc(L.why)}</p>
        ${need ? `<div class="notice">This lesson uses ${need[0]}, which appears at the Improver level.<button class="primary" data-a="need-level" data-level="${need[1]}">Switch to Improver</button></div>` : ''}
        ${L.hidesLane ? '<div class="notice">The beat lane stays hidden during this lesson. Use your ears.</div>' : ''}
        ${GUIDE_LESSONS.has(L.id) ? `<button class="link-btn" data-a="guide">${icon('book', 14)} Learn more: how songs are built</button>` : ''}
        <ol class="steps">${L.steps.map(stepRow).join('')}</ol>
        <div class="card-actions">
          ${idx >= L.steps.length && next ? `<button class="primary" data-lesson="${next.id}">Next: ${esc(next.title)}</button>` : ''}
          <button class="ghost" data-a="restart-lesson">${idx > 0 ? 'Start over' : 'Restart'}</button>
        </div>
      </div>
      </section>
      <section class="tutor-sec" data-panel="course" data-group="lessons">
      <div class="fold-head">${fold('course', 'All lessons')}<span class="grow"></span><span class="small muted">${prog.done}/${prog.total}</span></div>
      <div class="bar" title="${prog.done} of ${prog.total} lessons"><i style="width:${(prog.done / prog.total) * 100}%"></i></div>
      ${TIERS.map((t, ti) => `<div class="course"><h4><span>${esc(t.name)}</span><span>${prog.tiers[ti].done}/${prog.tiers[ti].total}</span></h4>
        ${LESSONS.filter((l) => l.tier === t.id).map((l) => {
          const done = state.completed.includes(l.id);
          return `<button class="${l.id === L.id ? 'active' : ''} ${done ? 'done' : ''}" data-lesson="${l.id}">${icon(done ? 'check' : l.id === L.id ? 'dot' : 'circle', 15)}<span>${esc(l.title)}</span><small>${l.minutes} min</small></button>`;
        }).join('')}</div>`).join('')}
      </section>
    </div>`);
  lay.applyLayout(state.layout, el); markDraggable(el);
}
// ---------- the first-run tour ----------
const tour = { stops: [], i: 0, back: null };
const visibleEl = (sel) => $$(sel).find((x) => x.offsetParent !== null && x.getClientRects().length && !x.closest('.hidden'));
const tourOpen = () => !$('#tour').classList.contains('hidden');
function startTour() {
  closeHelpMenu();
  if (!$('#welcomeView').classList.contains('hidden')) return;
  for (const d of $$('dialog[open]')) d.close();
  tour.stops = stopsFor(state.level, (st) => !!visibleEl(st.target));
  if (!tour.stops.length) return;
  tour.i = 0; tour.back = document.activeElement;
  $('#tour').classList.remove('hidden');
  showTourStop();
}
function endTour() {
  if (!tourOpen()) return;
  $('#tour').classList.add('hidden'); store.set('tourDone', true);
  if (tour.back?.isConnected) tour.back.focus();
}
function moveTour(dir) { const n = tourStep(tour.i, dir, tour.stops.length); if (n < 0) return endTour(); tour.i = n; showTourStop(); }
function showTourStop() {
  const st = tour.stops[tour.i], el = visibleEl(st.target);
  if (!el) { tour.stops.splice(tour.i, 1); if (tour.i >= tour.stops.length) return endTour(); return showTourStop(); }
  $('#tourCount').textContent = progressLabel(tour.i, tour.stops.length);
  $('#tourTitle').textContent = st.title; $('#tourText').textContent = st.text;
  $('[data-tour="back"]').disabled = tour.i === 0;
  $('[data-tour="next"]').textContent = tour.i === tour.stops.length - 1 ? 'Done' : 'Next';
  el.scrollIntoView({ block: 'nearest' });
  placeTour(el);
  $('.tour-card').focus();
}
function placeTour(el = tour.stops[tour.i] && visibleEl(tour.stops[tour.i].target)) {
  if (!el) return;
  const r = el.getBoundingClientRect(), pad = 6, vw = innerWidth, vh = innerHeight;
  Object.assign($('.tour-ring').style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
  const card = $('.tour-card'), cw = card.offsetWidth, ch = card.offsetHeight, gap = 14;
  let left, top;
  if (r.bottom + gap + ch < vh) { top = r.bottom + gap; left = r.left; }
  else if (r.top - gap - ch > 0) { top = r.top - gap - ch; left = r.left; }
  else if (r.left - gap - cw > 0) { left = r.left - gap - cw; top = r.top; }
  else { left = r.right + gap; top = r.top; }
  card.style.left = `${Math.max(16, Math.min(vw - cw - 16, left))}px`;
  card.style.top = `${Math.max(16, Math.min(vh - ch - 16, top))}px`;
}
function maybeStartTour() {
  if (shouldAutoStart({ done: store.get('tourDone', false), hasSource: !!state.source, welcomeOpen: !$('#welcomeView').classList.contains('hidden') })) setTimeout(startTour, 600);
}
function bindTour() {
  $('#tour').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tour]'); if (!b) return;
    ({ skip: endTour, back: () => moveTour(-1), next: () => moveTour(1) })[b.dataset.tour]();
  });
  addEventListener('resize', () => { if (tourOpen()) placeTour(); });
  // keep keyboard focus inside the card
  $('.tour-card').addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = $$('.tour-card button:not([disabled])'); if (!items.length) return;
    const first = items[0], last = items.at(-1);
    if (e.shiftKey && (document.activeElement === first || document.activeElement === $('.tour-card'))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}
/** Keys while the tour is open. True when the tour took the key. */
function tourKey(e) {
  if (!tourOpen()) return false;
  if (e.key === 'Escape') { e.preventDefault(); endTour(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); moveTour(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); moveTour(-1); }
  return true; // nothing else reacts while touring (Enter / Space still press the focused button)
}

// ---------- help menu ----------
function toggleHelpMenu(open = $('#helpMenu').classList.contains('hidden')) {
  $('#helpMenu').classList.toggle('hidden', !open); $('#helpBtn').setAttribute('aria-expanded', open);
  if (open) $('#helpMenu button').focus();
}
function closeHelpMenu() { if (!$('#helpMenu').classList.contains('hidden')) toggleHelpMenu(false); }
function bindHelpMenu() {
  $('#helpBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleHelpMenu(); });
  $('#helpMenu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-help]'); if (!b) return;
    closeHelpMenu();
    ({ tour: startTour, guide: openGuide, keys: () => $('#help').showModal() })[b.dataset.help]();
  });
  $('#helpMenu').addEventListener('keydown', (e) => {
    const items = $$('#helpMenu button'), i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
    else if (e.key === 'Escape') { e.stopPropagation(); closeHelpMenu(); $('#helpBtn').focus(); }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.help-wrap')) closeHelpMenu(); });
}

// ---------- track breakdown and the "How songs are built" guide ----------
const GUIDE_LESSONS = new Set(['counting', 'phrase', 'phrasing', 'timing']);
const trackSide = () => (state.trackSide === 'right' && decks.right.buffer) || (!decks.left.buffer && decks.right.buffer) ? 'right' : 'left';
function openTrackTab(side) { state.trackSide = side; state.guideOpen = false; if (!state.paneOpen) setPane(true); setPaneTab('track'); }
function openGuide() { state.guideReturn = document.activeElement; state.guideOpen = true; if (!state.paneOpen) setPane(true); else renderTutor(); requestAnimationFrame(() => $('#tutor .guide-pane h2')?.focus()); }
function closeGuide() { state.guideOpen = false; renderTutor(); const back = state.guideReturn; state.guideReturn = null; if (back?.isConnected) back.focus(); else $('#tutor [data-a="guide"]')?.focus(); }

function trackPaneHTML() {
  const side = trackSide(), d = decks[side], t = d.track;
  const sw = `<div class="tabs deck-switch" role="tablist" aria-label="Which deck">${SIDES.map((s) => `<button data-tside="${s}" role="tab" aria-selected="${s === side}" class="${s === side ? 'active' : ''}" ${decks[s].buffer ? '' : 'disabled'}>Deck ${LETTER[s]}</button>`).join('')}</div>`;
  const guideBtn = `<button class="guide-entry" data-a="guide">${icon('book', 16)}<span><b>How songs are built</b><small>What intros, builds, drops and outros are</small></span>${icon('chevron', 14, 'style="transform:rotate(-90deg)"')}</button>`;
  if (!d.buffer) {
    return `${sw}<div class="tb-empty"><b>Load a track to see its breakdown</b><p class="muted small">Cue Coach shows each part of the track, what it's for and where to mix. Here's what a typical club track looks like:</p>
      ${timelineSVG(sectionsFromBars(), { width: 300 })}</div>${guideBtn}`;
  }
  const b = describeTrack(t);
  if (!b) return `${sw}<div class="tb-empty"><b>${esc(t.title)}</b><p class="muted small">No beat grid or phrases for this track yet. They're worked out when the track is analysed.</p></div>${guideBtn}`;
  const marks = [...(b.drops[0] ? [{ time: b.drops[0].time, label: 'Drop', color: phraseColor('Chorus') }] : []), { time: b.mixOut.time, label: 'Mix out', color: 'currentColor' }];
  const ease = { easy: 'ok', ok: 'close', hard: 'warn' }[b.ease.id];
  return `${sw}
    <div class="tb-head"><h3>${esc(t.title)}</h3><div class="muted small">${esc(t.artist || '')}${t.artist ? ' · ' : ''}${esc(b.headline)}</div>
      <div class="tb-chips"><span class="chip ${ease}" title="${esc(b.ease.why)}">${esc(b.ease.name)}</span><span class="chip">${esc(b.shape)}</span></div></div>
    <div class="tb-time" data-tbtime data-side="${side}">${timelineSVG(b.sections, { width: 300, marks, now: d.position() })}</div>
    <div class="tb-story">${b.story.map((x) => `<p>${esc(x)}</p>`).join('')}</div>
    <div class="tb-jumps"><button data-tjump="${b.mixIn.time}" title="${esc(b.mixIn.why)}">${icon('restart', 14)} Start</button>${b.drops[0] ? `<button data-tjump="${b.drops[0].time}">Jump to the drop</button>` : ''}<button data-tjump="${b.mixOut.time}" title="${esc(b.mixOut.why)}">Jump to the outro</button></div>
    <h4 class="tb-sub">The parts</h4>
    <ol class="tb-parts">${b.sections.map((s) => `<li><button data-tjump="${s.start}" title="Jump deck ${LETTER[side]} here"><i style="background:${s.color}"></i><span><b>${esc(s.name)}</b><small>${clock(s.start)} · ${s.bars} bars</small></span></button><p>${esc(s.what)} <em>${esc(s.mix)}</em></p></li>`).join('')}</ol>
    ${b.tips.length ? `<h4 class="tb-sub">Mixing tips for this track</h4><ul class="tb-tips">${b.tips.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${guideBtn}`;
}

/** Move the "now" line on the breakdown's timeline as the deck plays. */
function updateTrackNow() {
  const box = state.paneOpen && !state.guideOpen && paneTab() === 'track' ? $('#tutor [data-tbtime]') : null;
  const line = box && $('[data-now]', box); if (!line) return;
  const d = decks[box.dataset.side], svg = $('svg', box), secs = describeTrack(d.track)?.sections; if (!d.buffer || !secs) return;
  const w = +svg.viewBox.baseVal.width, t0 = Math.min(secs[0].start, 0), x = ((d.position() - t0) / (secs.at(-1).end - t0)) * w;
  const v = String(Math.max(0, Math.min(w, x)).toFixed(1));
  if (line.getAttribute('x1') !== v) { line.setAttribute('x1', v); line.setAttribute('x2', v); }
}

function guideHTML() {
  const t = decks.left.track, b = t && describeTrack(t);
  const pic = (id) => ({
    beats: beatsSVG(), phrase: phraseSVG(),
    parts: `${timelineSVG(sectionsFromBars(), { width: 300 })}<ul class="sg-parts">${GUIDE_PARTS.map((p) => `<li><i style="background:${p.color}"></i><div><b>${esc(p.name)}</b> ${esc(p.what)} <em>${esc(p.mix)}</em></div></li>`).join('')}</ul>`,
    mixmap: mixMapSVG({ width: 300 }),
  }[id] || '');
  const yours = b ? `<section class="sg-sec"><h3>Your track: ${esc(t.title)}</h3><p>${esc(b.story.slice(0, 3).join(' '))}</p>
      ${timelineSVG(b.sections, { width: 300, marks: [{ time: b.mixOut.time, label: 'Mix out' }, ...(b.drops[0] ? [{ time: b.drops[0].time, label: 'Drop', color: phraseColor('Chorus') }] : [])] })}
      <div class="tb-jumps">${b.drops[0] ? `<button data-gjump="${b.drops[0].time}">Jump to the drop</button>` : ''}<button data-gjump="${b.mixOut.time}">Jump to the outro</button></div></section>`
    : '<section class="sg-sec"><h3>Your track</h3><p class="muted">Load a track on deck A to see its parts here.</p></section>';
  return `<div class="guide-top"><button class="ghost" data-a="guide-back">${icon('chevron', 14, 'style="transform:rotate(90deg)"')} Back</button></div>
    <h2 tabindex="-1">How songs are built</h2>
    <p class="muted">Dance tracks follow a pattern. Once you can hear it, you always know when to mix.</p>
    ${GUIDE.map((g, i) => `<section class="sg-sec"><h3><span class="sg-n">${i + 1}</span>${esc(g.title)}</h3>${g.text.map((x) => `<p>${esc(x)}</p>`).join('')}${pic(g.pic)}</section>`).join('')}
    ${yours}
    <section class="sg-sec sg-cheat"><h3>Cheat sheet</h3><ol>${CHEAT_SHEET.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></section>`;
}

function seekDeck(side, t) {
  const d = decks[side]; if (!d.buffer || !Number.isFinite(t)) return;
  if (isLive(side)) toast(`Jumped deck ${LETTER[side]} while it's playing to the room. Pause it first if you only want to look.`);
  d.seek(Math.max(0, Math.min(d.buffer.duration - 0.5, t)));
}

const fold = (id, label) => lay.foldButton(id, esc(label), `<span class="fold-ic">${icon('chevron', 14)}</span>`);

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
    $$('.pc-blocks i', col).forEach((x, i) => x.classList.toggle('on', !!c && i + 1 === c.block));
    $$('.pc-blocks s', col).forEach((x, i) => x.classList.toggle('on', !!c && i < c.barInPhrase));
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
  updateTrackNow();
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
    if (a === 'breakdown') return openTrackTab(side);
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
  bindStreaming();
  SIDES.forEach(deckEvents);
  mixerEvents();
  $('#themeBtn').innerHTML = icon('palette', 18); $('#helpBtn').innerHTML = icon('help', 18); $('#searchIcon').innerHTML = icon('search', 15);
  $$('[data-icon]').forEach((x) => { x.outerHTML = icon(x.dataset.icon, 26); });
  bindHelpMenu(); bindTour();
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
  bindSetPanel($('#tutor'));
  bindLayout();
  $('#tutor').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.ptab) return setPaneTab(b.dataset.ptab);
    if (b.dataset.a === 'close') return setPane(false);
    if (b.dataset.a === 'guide') return openGuide();
    if (b.dataset.a === 'guide-back') return closeGuide();
    if (b.dataset.gjump) return seekDeck('left', +b.dataset.gjump);
    if (b.dataset.tside) { state.trackSide = b.dataset.tside; return renderTutor(); }
    if (b.dataset.tjump) return seekDeck(trackSide(), +b.dataset.tjump);
    if (state.guideOpen || paneTab() === 'track') return;
    if (paneTab() === 'set') { setPanelClick(e); return; }
    if (b.dataset.a === 'restart-lesson') startLesson(state.lessonId);
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
    if (await useSource(b.dataset.source)) { $('#welcomeView').classList.add('hidden'); focusLibrary('left', 'all'); maybeStartTour(); }
  });
  $('#libTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { state.tab = b.dataset.tab; renderLibrary(); } });
  $('#source').addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'menu') { state.menuOpen = !state.menuOpen; state.importMenu = false; renderSource(); return; }
    if (a === 'import-menu') { state.importMenu = !state.importMenu; state.menuOpen = false; renderSource(); return; }
    if (a === 'import-playlist') return openPlaylistDlg();
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
  const rowTrack = (e) => { const row = e.target.closest('.trow[data-id]'); return row && state.tracks.find((x) => x.id === row.dataset.id); };
  $('#list').addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'ask-ai') return askAICoach();
    if (a === 'ai-settings') return openAI();
    const imp = e.target.closest('[data-import]'); if (imp) return importDialog(imp.dataset.import);
    const buy = e.target.closest('[data-buy]'); if (buy) return openLinkMenu(buy, { title: state.query.trim() }, true);
    const wrow = e.target.closest('[data-w]');
    if (wrow) { const wb = e.target.closest('[data-w-a]'); if (wb) wantedAction(wb, +wrow.dataset.w); return; }
    const rb = e.target.closest('[data-row]');
    if (rb) {
      const t = rowTrack(e); if (!t) return;
      if (rb.dataset.row === 'links') return openLinkMenu(rb, t);
      if (rb.dataset.row === 'import') return importLibTracks([t]);
      if (rb.dataset.row === 'set') { const had = inSet(state.set, t.id); commitSet(toggleInSet(state.set, t.id)); return toast(had ? `Took "${t.title}" out of your set.` : `Added "${t.title}" to your set.`); }
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
    'library-import-playlist': () => openPlaylistDlg(),
    'play-left': () => togglePlay('left'),
    'play-right': () => togglePlay('right'),
    search: () => focusLibrary(null),
    level: () => { renderLevels(); $('#levels').showModal(); },
    theme: () => { renderThemes(); $('#themes').showModal(); },
    help: () => $('#help').showModal(),
    tour: startTour,
    guide: openGuide,
    'restart-lesson': () => startLesson(state.lessonId),
    'toggle-lessons': () => setPane(!state.paneOpen),
    'build-set': () => { if (!state.paneOpen) setPane(true); setPaneTab('set'); },
    ai: openAI,
    controller: openCtl,
  }[cmd] || (() => {}))();
}

function onKey(e) {
  if (tourKey(e)) return;
  const typing = !!e.target?.matches?.('input[type=search], input[type=text], textarea');
  if (e.key === 'Escape') { if (typing) e.target.blur(); if (state.target) { state.target = null; renderLibrary(); } return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || !$('#welcomeView').classList.contains('hidden')) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.source === 'managed' && !e.target?.closest?.('#tutor') && !e.target?.matches?.('input, textarea, select')) {
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

// ---------- set list (side panel) ----------
function setItems() {
  if (!state.set) return [];
  const byId = new Map(state.tracks.map((t) => [t.id, t]));
  return state.set.items.map((i, n) => ({ ...i, n, track: byId.get(i.id) })).filter((i) => i.track);
}
/** Save a new version of the set and redraw everything that shows it. */
function commitSet(next) {
  state.set = next && next.items.length ? next : null;
  store.set('set', state.set);
  renderSetPanel(); renderList();
}
const setEvent = () => EVENTS.find((e) => e.id === state.setEvent) || EVENTS[0];
/** The vibe only counts for events that follow one (club, festival); the others have their own shape. */
const vibeName = () => (setEvent().usesVibe ? VIBES.find((v) => v.id === state.setVibe)?.name || 'Journey' : '');
const crowd = () => ({ event: state.setEvent, audience: state.setAudience });

/** "Build from": the choices for this library, and the one picked (All music if it has gone away). */
function setFromChoice() {
  const all = setSources(state.tracks, lib.hasManaged() && state.source === 'managed' ? state.crates : []);
  return { all, cur: all.find((s) => s.id === state.setFrom) || all[0] };
}
const setPool = () => tracksFrom(state.tracks, state.crates, setFromChoice().cur.id);

async function generateSet() {
  if (!state.tracks.length) return toast('Add some music first.');
  const from = setFromChoice().cur, pool = setPool();
  if (!pool.length) return toast(`${from.name} has no tracks yet.`);
  const first = decks.left.track && pool.some((t) => t.id === decks.left.track.id) ? decks.left.track : null;
  const where = from.kind === 'all' ? 'your library' : from.name;
  if (!state.ai.hasKey) {
    const items = quickSet(pool, { minutes: state.setMinutes, vibe: state.setVibe, first, ...crowd() });
    if (!items.length) return toast('None of these tracks have a known speed yet. Try again in a moment.');
    const ev = setEvent(), name = ev.usesVibe ? `${vibeName()} set` : `${ev.name} set`;
    commitSet(makeSet({ title: `${name}${from.kind === 'all' ? '' : ` from ${from.name}`}`, story: `Built from ${where}. ${ev.story}`, items }));
    return toast('Quick build done. Connect the AI coach for sets that follow your description.');
  }
  state.setBusy = 'generate'; renderSetPanel();
  try {
    const r = await buildSetAI({ library: pool, minutes: state.setMinutes, vibe: vibeName(), idea: state.setIdea, level: state.level, first, ...crowd() });
    commitSet(makeSet({ ...r, ai: true }));
  } catch (err) { toast(err.message); if (err.noKey) openAI(); }
  finally { state.setBusy = false; renderSetPanel(); }
}

async function refineCurrentSet() {
  const s = state.set; if (!s?.items.length) return toast('Make a set first: press Generate, or add tracks with + in the library.');
  const downs = s.items.filter((i) => i.vote < 0).length;
  if (!state.ai.hasKey) {
    if (!downs) return toast(state.refineText ? 'Following an instruction needs the AI coach. Without it, Refine swaps the tracks you gave a thumbs down.' : 'Give a thumbs down to the tracks you want swapped, then press Refine.');
    const r = refineSet(state.tracks, s, { vibe: state.setVibe, minutes: state.setMinutes, from: setPool(), ...crowd() });
    commitSet(r.set);
    return toast(`Swapped ${r.swapped} track${r.swapped === 1 ? '' : 's'}${r.dropped ? `; ${r.dropped} had nothing left to swap in, so ${r.dropped === 1 ? 'it was' : 'they were'} taken out` : ''}.`);
  }
  state.setBusy = 'refine'; renderSetPanel();
  try {
    const r = await refineSetAI({ library: state.tracks, from: setPool(), set: s, instruction: state.refineText.trim(), vibe: vibeName(), minutes: state.setMinutes, level: state.level, ...crowd() });
    if (state.set !== s) return; // changed while the AI was thinking: keep the DJ's edits
    const merged = mergeRefined(s, r.items, new Set(state.tracks.map((t) => t.id)));
    commitSet({ ...merged, title: s.title === NEW_SET_TITLE ? s.title : r.title || s.title, story: r.story || s.story, ai: true });
    state.refineText = ''; renderSetPanel();
    toast('Set refined. Your thumbs-up tracks stayed where they were.');
  } catch (err) { toast(err.message); if (err.noKey) openAI(); }
  finally { state.setBusy = false; renderSetPanel(); }
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
  const old = decks[side].track?.id;
  if (old && inSet(state.set, old) && !state.set.played.includes(old)) { state.set = { ...state.set, played: [...state.set.played, old] }; store.set('set', state.set); }
  loadTo(side, n.track);
}

const paneTab = () => state.paneTab || (state.f.setFirst ? 'set' : 'lessons');
function setPaneTab(tab) { state.paneTab = tab; state.guideOpen = false; store.set('paneTab', tab); renderTutor(); }
function renderSetPanel() { if (state.paneOpen && paneTab() === 'set') renderTutor(); }

/** The three questions the set builder asks: where the music comes from, what the event is, who's coming. */
function setQuestionsHTML() {
  const { all, cur } = setFromChoice(), ev = setEvent(), au = AUDIENCES.find((a) => a.id === state.setAudience) || AUDIENCES[0];
  const q = (id, label, opts, note) => `<label class="sp-q" for="${id}"><span>${label}</span><select id="${id}">${opts}</select>${note ? `<small>${esc(note)}</small>` : ''}</label>`;
  const opt = (id, name, on, extra = '') => `<option value="${esc(id)}" ${on ? 'selected' : ''}>${esc(name)}${extra}</option>`;
  return `<div class="sp-qs">
    ${q('setFrom', 'Which music?', all.map((s) => opt(s.id, `${s.kind === 'crate' ? 'Crate: ' : s.kind === 'folder' ? 'Folder: ' : ''}${s.name}`, s.id === cur.id, ` (${s.count})`)).join(''), all.length > 1 ? '' : 'Your crates and folders show up here.')}
    ${q('setEvent', 'What\'s the event?', EVENTS.map((e) => opt(e.id, e.name, e.id === ev.id)).join(''), ev.blurb)}
    ${q('setAudience', 'Who\'s the crowd?', AUDIENCES.map((a) => opt(a.id, a.name, a.id === au.id)).join(''), au.blurb)}
  </div>`;
}

function setPanelHTML() {
  const items = setItems(), next = nextSetItem(), played = new Set(state.set?.played || []);
  const loaded = new Map(SIDES.map((s) => [decks[s].track?.id, s]));
  const busy = state.setBusy, has = items.length > 0, ai = state.ai.hasKey;
  const genTitle = ai ? 'The AI coach plans a new set from your library, using the length, vibe and description' : 'Quick build: a new set from your library, no internet needed. Connect the AI coach to use the description too.';
  const form = `<section class="sp-form" data-panel="setopts" data-group="set">
    <div class="fold-head">${fold('setopts', 'Set options')}</div>
    <div class="sp-main fold-keep">
      <button class="primary" data-a="generate" ${busy ? 'disabled' : ''} title="${genTitle}">${busy === 'generate' ? '<span class="spinner"></span> Building…' : `${icon('wand', 15)} Generate`}</button>
      <button data-a="refine" ${busy || !has ? 'disabled' : ''} title="Keep the thumbs-up tracks where they are and swap the thumbs-down ones${ai ? ', following what you type below' : ''}">${busy === 'refine' ? '<span class="spinner"></span> Refining…' : `${icon('refresh', 15)} Refine`}</button>
      ${ai ? '' : `<button class="ghost sp-ai" data-a="ai-settings" title="Connect the AI coach">${icon('key', 14)} No AI</button>`}
    </div>
    ${setQuestionsHTML()}
    <div class="sp-opts">
      <label>Length <select id="setMinutes">${[30, 45, 60, 90, 120, 180, 240].map((m) => `<option value="${m}" ${m === state.setMinutes ? 'selected' : ''}>${m < 120 ? `${m} min` : `${m / 60} hours`}</option>`).join('')}</select></label>
      ${setEvent().usesVibe ? `<label>Vibe <select id="setVibe">${VIBES.map((v) => `<option value="${v.id}" ${v.id === state.setVibe ? 'selected' : ''} title="${esc(v.blurb)}">${esc(v.name)}</option>`).join('')}</select></label>` : ''}
    </div>
    <input type="text" id="setIdea" placeholder="Describe the night: sunset rooftop, deep and warm…" value="${esc(state.setIdea)}" aria-label="Describe the night (for Generate)">
    ${has ? `<input type="text" id="refineText" placeholder="${ai ? 'Tell Refine what to change: more vocals in the middle…' : 'Instructions for Refine need the AI coach'}" value="${esc(state.refineText)}" aria-label="What Refine should change" ${ai ? '' : 'disabled'}>` : ''}
    ${decks.left.track && !has ? `<span class="small muted">Generate starts from deck A: ${esc(decks.left.track.title)}</span>` : ''}
  </section>`;
  if (!has) {
    return form + `<section class="sp-sec" data-panel="setlist" data-group="set"><div class="fold-head">${fold('setlist', 'Set list')}</div><div class="empty sp-empty">${icon('list', 30)}<b>Plan a set</b><span>Press Generate for a set that flows, or add tracks yourself with the <b class="plus-chip">+</b> button on any track in the library.</span></div></section>`;
  }
  const votes = items.reduce((c, i) => (c[i.vote > 0 ? 'up' : i.vote < 0 ? 'down' : 'none']++, c), { up: 0, down: 0, none: 0 });
  return form + `<section class="sp-sec" data-panel="setlist" data-group="set"><div class="fold-head">${fold('setlist', 'Set list')}<span class="grow"></span><span class="small muted">${items.length} track${items.length === 1 ? '' : 's'}</span></div><div class="sp-head">
      <div class="sp-title">${state.set.ai ? '<span class="ai-badge">AI</span>' : ''}<b>${esc(state.set.title)}</b><span class="grow"></span><button class="ghost" data-a="clear-set" title="Clear the whole set">Clear</button></div>
      ${state.set.story ? `<p>${esc(state.set.story)}</p>` : ''}
      <p class="muted">${items.length} track${items.length === 1 ? '' : 's'} · about ${setMinutes(items)} min${votes.up || votes.down ? ` · ${votes.up} kept · ${votes.down} to swap` : ''}</p>
      ${next ? `<button class="primary sp-next" data-a="load-next" title="Load the next track in the set on the deck the room isn't hearing">Load next: ${esc(next.track.title)}</button>` : ''}
    </div>
    <ol class="sp-list" aria-label="Set list. Drag rows, or press Alt and an arrow key, to reorder.">` + items.map((i) => {
      const on = loaded.get(i.track.id), t = i.track;
      const cls = [i === next && 'next', played.has(t.id) && 'played', i.vote < 0 && 'down', i.vote > 0 && 'up'].filter(Boolean).join(' ');
      return `<li class="srow ${cls}" data-id="${esc(t.id)}" data-n="${i.n}" draggable="true" tabindex="0" aria-label="${i.n + 1}. ${esc(t.title)}${i.vote > 0 ? ', kept' : i.vote < 0 ? ', to swap' : ''}">
        <span class="grip" title="Drag to move">${icon('grip', 14)}</span>
        <span class="num">${i.n + 1}</span>
        <span class="body">
          <span class="t">${on ? `<span style="color:var(--${on})" title="On deck ${LETTER[on]}">● </span>` : ''}${esc(t.title)}</span>
          <span class="meta">${keyBadge(t)}<span class="n">${fmtBpm(t.bpm)}</span><span class="a">${esc(t.artist)}</span></span>
          ${i.why || i.tip ? `<span class="tip">${i.why ? `<b>${esc(i.why)}</b>` : ''}${i.tip ? ` ${esc(i.tip)}` : ''}</span>` : ''}
        </span>
        <span class="votes">
          <button class="vote up ${i.vote > 0 ? 'on' : ''}" data-vote="1" aria-pressed="${i.vote > 0}" title="Keep it: Refine leaves this track where it is" aria-label="Keep ${esc(t.title)}">${icon('thumb', 15)}</button>
          <button class="vote down ${i.vote < 0 ? 'on' : ''}" data-vote="-1" aria-pressed="${i.vote < 0}" title="Swap it out: Refine replaces this track" aria-label="Swap out ${esc(t.title)}">${icon('thumb', 15, 'style="transform:scale(1,-1)"')}</button>
        </span>
        <span class="acts"><button class="l" data-load="left" title="Load on deck A">A</button><button class="r" data-load="right" title="Load on deck B">B</button><button class="rm" data-a="remove" title="Take out of the set" aria-label="Take ${esc(t.title)} out of the set">${icon('x', 12)}</button></span>
      </li>`;
    }).join('') + '</ol></section>';
}

/** Re-render the panel without losing the text box the DJ is typing in. */
function keepFocus(el, html) {
  const a = el.contains(document.activeElement) ? document.activeElement : null;
  const id = a?.id || null, row = a?.closest?.('.srow')?.dataset.id ?? null;
  const attr = a && ['data-vote', 'data-a', 'data-load', 'data-ptab', 'data-lesson'].find((k) => a.hasAttribute(k));
  const sel = id && a.selectionStart != null ? [a.selectionStart, a.selectionEnd] : null;
  const scroll = $('.tutor-body', el)?.scrollTop;
  el.innerHTML = html;
  if (scroll != null && $('.tutor-body', el)) $('.tutor-body', el).scrollTop = scroll;
  const scope = row != null ? $$('.srow', el).find((r) => r.dataset.id === row) : el;
  const f = id ? $(`#${id}`, el)
    : attr && scope ? $$(`[${attr}]`, scope).find((x) => x.getAttribute(attr) === a.getAttribute(attr)) || (row != null ? scope : null)
    : row != null ? scope : null;
  if (f) { f.focus({ preventScroll: true }); if (sel) try { f.setSelectionRange(...sel); } catch { /* not a text box */ } }
}

function bindSetPanel(el) {
  el.addEventListener('change', (e) => {
    if (e.target.id === 'setMinutes') { state.setMinutes = +e.target.value; store.set('setMinutes', state.setMinutes); }
    if (e.target.id === 'setVibe') { state.setVibe = e.target.value; store.set('setVibe', state.setVibe); }
    if (e.target.id === 'setFrom') { state.setFrom = e.target.value; store.set('setFrom', state.setFrom); }
    if (e.target.id === 'setEvent') { state.setEvent = e.target.value; store.set('setEvent', state.setEvent); renderSetPanel(); }
    if (e.target.id === 'setAudience') { state.setAudience = e.target.value; store.set('setAudience', state.setAudience); renderSetPanel(); }
  });
  el.addEventListener('input', (e) => {
    if (e.target.id === 'setIdea') state.setIdea = e.target.value;
    if (e.target.id === 'refineText') state.refineText = e.target.value;
  });
  el.addEventListener('keydown', (e) => {
    if (e.target.id === 'setIdea' && e.key === 'Enter') { e.preventDefault(); generateSet(); }
    if (e.target.id === 'refineText' && e.key === 'Enter') { e.preventDefault(); refineCurrentSet(); }
    const row = e.target.classList?.contains('srow') ? e.target : null;
    if (!row) return;
    const n = +row.dataset.n;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault(); e.stopPropagation();
      commitSet(moveInSet(state.set, n, n + (e.key === 'ArrowUp' ? -1 : 1)));
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation();
      const rows = $$('.srow', el), i = rows.indexOf(row) + (e.key === 'ArrowUp' ? -1 : 1);
      rows[i]?.focus();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault(); e.stopPropagation();
      const rows = $$('.srow', el), i = rows.indexOf(row);
      commitSet(removeFromSet(state.set, row.dataset.id));
      $$('.srow', el)[Math.min(i, $$('.srow', el).length - 1)]?.focus();
    } else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); loadSetRow(row.dataset.id); }
  });
  // drag to reorder; library tracks dropped here join the set
  let dragN = null;
  const ROW_MIME = 'application/x-cuecoach-setrow';
  el.addEventListener('dragstart', (e) => {
    const row = e.target.closest?.('.srow'); if (!row) return;
    dragN = +row.dataset.n; row.classList.add('dragging');
    e.dataTransfer.setData(ROW_MIME, row.dataset.n); e.dataTransfer.effectAllowed = 'move';
  });
  el.addEventListener('dragend', () => { dragN = null; $$('.srow', el).forEach((r) => r.classList.remove('dragging', 'drop-before', 'drop-after')); el.classList.remove('lib-drop'); });
  const dropSpot = (e) => {
    const rows = $$('.srow', el);
    for (const r of rows) { const b = r.getBoundingClientRect(); if (e.clientY < b.top + b.height / 2) return { row: r, before: true }; }
    return rows.length ? { row: rows[rows.length - 1], before: false } : null;
  };
  el.addEventListener('dragover', (e) => {
    const mine = [...e.dataTransfer.types].includes(ROW_MIME), lib = hasTracks(e);
    if (!mine && !lib) return;
    if (paneTab() !== 'set') return;
    e.preventDefault(); e.dataTransfer.dropEffect = mine ? 'move' : 'copy';
    $$('.srow', el).forEach((r) => r.classList.remove('drop-before', 'drop-after'));
    if (mine) { const s = dropSpot(e); if (s) s.row.classList.add(s.before ? 'drop-before' : 'drop-after'); }
    else el.classList.add('lib-drop');
  });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) { el.classList.remove('lib-drop'); $$('.srow', el).forEach((r) => r.classList.remove('drop-before', 'drop-after')); } });
  el.addEventListener('drop', (e) => {
    el.classList.remove('lib-drop');
    if ([...e.dataTransfer.types].includes(ROW_MIME) && dragN != null) {
      e.preventDefault();
      const s = dropSpot(e); if (!s) return;
      let to = +s.row.dataset.n + (s.before ? 0 : 1);
      if (to > dragN) to -= 1;
      // data-n is the index in the saved list; rows for missing tracks are hidden, so this is exact for visible rows
      commitSet(moveInSet(state.set, dragN, to));
    } else if (hasTracks(e)) {
      e.preventDefault();
      let s = state.set; for (const id of draggedIds(e)) s = addToSet(s, id);
      commitSet(s);
    }
  });
}
function loadSetRow(id) {
  const t = state.tracks.find((x) => x.id === id); if (!t) return;
  const side = !decks.left.buffer ? 'left' : !decks.right.buffer ? 'right' : state.xfader < 0.5 ? 'right' : 'left';
  loadTo(side, t);
}
/** Clicks inside the set tab. Returns true if it handled the click. */
function setPanelClick(e) {
  const b = e.target.closest('button'); if (!b) return false;
  const row = b.closest('.srow'), id = row?.dataset.id;
  const a = b.dataset.a;
  if (a === 'generate') { generateSet(); return true; }
  if (a === 'refine') { refineCurrentSet(); return true; }
  if (a === 'load-next') { loadNextFromSet(); return true; }
  if (a === 'ai-settings') { openAI(); return true; }
  if (a === 'clear-set') { if (confirm('Clear the whole set?')) commitSet(null); return true; }
  if (a === 'remove' && id) { commitSet(removeFromSet(state.set, id)); return true; }
  if (b.dataset.vote && id) { commitSet(voteInSet(state.set, id, +b.dataset.vote)); return true; }
  if (b.dataset.load && id) { const t = state.tracks.find((x) => x.id === id); if (t) loadTo(b.dataset.load, t); return true; }
  return false;
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
  if (state.tab === 'suggested') renderList();
  renderSetPanel();
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
    case 'browsePress': { const tabs = ['suggested', 'all'].filter((t) => t !== 'suggested' || state.f.upNext); state.tab = tabs[(tabs.indexOf(state.tab) + 1) % tabs.length]; return renderLibrary(); }
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
const LIB_ROWS = '#list .trow[data-id]';
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
  ['layout', 'layout', 'Layout', 'Collapse, move or hide sections to suit you'],
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
  if (id === 'layout') return openLayout();
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
  maybeStartTour();
}

boot();
requestAnimationFrame(frame);

