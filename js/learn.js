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
import { beatCount } from './deckmath.js';
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
  analysing: null, scanToken: 0, loading: {},
  level: store.get('level', 'starter'), f: null,
  aligned: 0, alignLocked: false, cleanMixes: store.get('cleanMixes', 0), checkUntil: 0, xfader: 0, jogUsed: false,
  // lessons
  lessonId: store.get('lesson', 'decks'), completed: store.get('completed', []), paneOpen: store.get('paneOpen', true),
  ticked: new Set(), did: new Set(), skippedAny: false, lessonDone: false, played: { left: 0, right: 0 }, blend: null,
  // set builder + AI
  set: null, setMinutes: store.get('setMinutes', 60), setVibe: store.get('setVibe', 'journey'), setIdea: '', setBusy: false,
  ai: { hasKey: false }, aiPicks: null, aiBusy: false,
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
  return d;
}
for (const s of SIDES) decks[s] = makeDeck(s);
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
  for (const s of SIDES) clampTempo(s);
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
    <div class="counter" data-counter title="Beat in the bar, and which 4-bar block of the 16-bar phrase you're in">
      <span class="cells beats">${[1, 2, 3, 4].map((n) => `<i>${n}</i>`).join('')}</span>
      <span class="ph">Phrase <b data-phrase>–</b></span>
      <span class="cells blocks">${[1, 2, 3, 4].map((n) => `<i>${n}</i>`).join('')}</span>
      <span class="sec" data-sec></span>
    </div>
    <div class="deckbody">
      <div class="transport">
        <button class="play" data-a="play" aria-label="Play or pause (${side === 'left' ? 'Q' : 'P'})" title="Play / pause">${icon(d.playing ? 'pause' : 'play', 22)}</button>
        <button class="round" data-a="restart" aria-label="Back to the first beat" title="Back to the first beat">${icon('restart', 15)}</button>
        <div class="tlabel">Start</div>
        ${f.hotCues ? `<div class="pads">${cuesFor(t).map((c, i) => `<button class="pad ${c != null ? 'set' : ''}" data-cue="${i}" style="--pc:${CUE_COLORS[i]}" title="${c != null ? `Hot cue ${i + 1}: jump here. Alt-click to clear.` : `Set hot cue ${i + 1} here`}">${i + 1}</button>`).join('')}</div><div class="tlabel" style="margin-top:0">Cues</div>` : ''}
      </div>
      ${jogHTML(side, f.keyHints && !state.jogUsed ? 'Spin me to nudge' : '')}
      <div class="pitch" title="Speed: up is faster">
        <button class="round" data-a="faster" aria-label="Faster">${icon('plus', 15)}</button>
        <input type="range" class="vfader" data-a="tempo" min="-${r}" max="${r}" step="0.05" value="${d.tempoPct}" aria-label="Speed">
        <button class="round" data-a="slower" aria-label="Slower">${icon('minus', 15)}</button>
        <div class="val" data-pct></div>
      </div>
    </div>
    <div class="deckfoot"><span class="role" data-live></span>${keys}<span class="grow"></span>
      ${f.gridEdit && t.grid?.estimated ? `<span class="gridtools" title="Cue Coach worked out this beat grid. If the beats sound off, nudge it.">Grid <button data-grid="-1" aria-label="Move grid earlier">‹</button><button data-grid="1" aria-label="Move grid later">›</button><button data-grid="one" title="Move the &quot;1&quot; to the next beat">1 ›</button></span>` : ''}
      ${f.barCounter ? '<span class="barcount" data-bar></span>' : ''}
      <button class="ghost small" data-a="choose" title="Load a different track">${icon('eject', 14)} Change</button></div>`;
  jogs[side] = new JogWheel($('[data-jog]', el), () => decks[side], (kind) => {
    state.jogUsed = true; $('.jog', el)?.classList.add('used');
    if (kind === 'jog' || kind === 'scrub') state.did.add(kind);
  });
  d._wave = null; // rebuild waveform columns for the new canvas
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
  $('#mixer').innerHTML = `<div class="label">Mixer</div><div class="strips">${strip('left')}${strip('right')}</div>
    <div class="xf"><span style="color:var(--left)">A</span><input type="range" id="xfader" min="0" max="1" step="0.005" value="${state.xfader}" aria-label="Crossfader" title="Crossfader ([ and ])"><span style="color:var(--right)">B</span></div>`;
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
async function loadTo(side, track) {
  if (state.loading[side]) return;
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
    d.bands = bandPeaks(buffer.getChannelData(0), buffer.sampleRate, 150);
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
      if (!(await lib.rekordboxAvailable())) { toast('rekordbox isn\'t connected. It works in the desktop app on a computer with rekordbox.'); renderSource(); return false; }
      state.analysing = { text: 'Reading your rekordbox library…' }; renderSource();
      setTracks(await lib.loadRekordbox(), 'rekordbox', kind);
    } else if (kind === 'folder') {
      if (!lib.canPickFolder()) { $('#dirInput').click(); return false; }
      let handle;
      if (fromGesture) handle = await lib.pickFolder();
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
  renderSource(); renderLibrary();
}

// ---------- library ----------
function renderSource() {
  const a = state.analysing;
  const choice = (kind, ic, label, note, disabled = false) => `<button data-source="${kind}" ${disabled ? 'disabled' : ''}>${icon(ic, 16)}<span>${label}<small>${note}</small></span></button>`;
  $('#source').innerHTML = `
    <span class="status">${a ? `${a.spin ? '<span class="spinner"></span>' : ''}${esc(a.text)}` : state.tracks.length ? `${state.tracks.length} tracks` : ''}</span>
    <button data-a="menu" aria-haspopup="menu" aria-expanded="${state.menuOpen}">${icon(state.source === 'folder' ? 'folder' : state.source === 'rekordbox' ? 'disc' : 'sparkle', 15)} ${esc(state.sourceName || 'Choose music')} ${icon('chevron', 14)}</button>
    ${state.menuOpen ? `<div class="menu" role="menu">
      ${choice('practice', 'sparkle', 'Practice tracks', 'Built in, made for learning')}
      ${choice('folder', 'folder', 'Music folder…', 'MP3, WAV, AIFF, FLAC')}
      ${choice('rekordbox', 'disc', 'rekordbox library', state.rbAvailable ? 'Your tracks, grids and keys' : 'Not connected', !state.rbAvailable)}
    </div>` : ''}`;
}

function renderLibrary() {
  $$('#libTabs button').forEach((b) => { b.classList.toggle('active', b.dataset.tab === state.tab); b.classList.toggle('hidden', b.dataset.tab === 'suggested' && !state.f.upNext); });
  const banner = [];
  if (state.reconnect) banner.push(`Cue Coach needs your OK to read <b>${esc(state.reconnect.name)}</b> again. <button class="primary" data-a="reconnect">Reconnect</button>`);
  if (state.target) banner.push(`Choosing a track for <b style="color:var(--${state.target})">deck ${LETTER[state.target]}</b>. Double-click a track, or use its ${LETTER[state.target]} button. <button class="ghost" data-a="untarget">Cancel</button>`);
  $('#libBanner').innerHTML = banner.join(' ');
  renderList();
}

const MAX_ROWS = 400;
function renderList() {
  const el = $('#list'), ref = decks.left.track, f = state.f;
  if (state.tab === 'set') return renderSet(el);
  if (!state.tracks.length) { el.innerHTML = `<div class="empty">${icon('music', 30)}<b>No music yet</b><span>Choose where your music comes from with the button above.</span></div>`; return; }
  let rows;
  if (state.tab === 'suggested') {
    if (!ref) { el.innerHTML = `<div class="empty">${icon('sparkle', 30)}<b>Suggestions appear here</b><span>Load a track on deck A and Cue Coach will rank what mixes well after it.</span></div>`; return; }
    rows = lib.rankNext(ref, lib.searchTracks(state.tracks, state.query), { exclude: [decks.right.track?.id], limit: 60 });
  } else {
    rows = lib.searchTracks(state.tracks, state.query).map((t) => ({ track: t, match: ref && t.id !== ref.id ? lib.friendlyMatch(ref, t) : null }));
  }
  if (!rows.length) { el.innerHTML = `<div class="empty">${icon('search', 30)}<b>Nothing matches "${esc(state.query)}"</b></div>`; return; }
  const loaded = new Map(SIDES.map((s) => [decks[s].track?.id, s]));
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
    return `<div class="trow ${on ? 'loaded' : ''}" data-id="${esc(t.id)}" title="Double-click to load">${keyBadge(t)}
      <span class="t">${on ? `<span style="color:var(--${on})">● </span>` : ''}${esc(t.title)}</span><span class="a wide">${esc(t.artist)}</span>
      <span class="n">${bpm}</span><span class="n wide muted">${duration(t)}</span><span class="wide" style="display:flex;gap:6px;min-width:0;align-items:center">${matchCell}</span>
      <span class="acts"><button class="l" data-load="left" title="Load on deck A">A</button><button class="r" data-load="right" title="Load on deck B">B</button></span></div>`;
  }).join('') + (rows.length > MAX_ROWS ? `<div class="empty small">Showing ${MAX_ROWS} of ${rows.length}. Search to narrow it down.</div>` : '');
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
  old.stop();
  if (keep.playing) decks.left.play();
  decks.right = makeDeck('right');
  state.xfader = 0; applyXfader();
  if (state.f.upNext) state.tab = 'suggested';
  startLesson(state.lessonId);
  renderDecks(); renderMixer(); renderLibrary();
  toast('The track you mixed in moved to deck A. Pick the next one for deck B.');
}

// ---------- canvases ----------
const lane = $('#lane');
let colors = {};
function readColors() { const cs = getComputedStyle(document.documentElement); for (const k of ['left', 'right', 'ok', 'close', 'warn', 'ink', 'ink-3', 'line-2', 'card', 'card-2']) colors[k] = cs.getPropertyValue(`--${k}`).trim(); }
readColors();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(document.documentElement.dataset.theme));

function fitCanvas(cv) {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}

function drawLane(hint) {
  const L = lesson(), f = state.f;
  const byEar = f.beatLaneCheck || (L.hidesLane && !state.lessonDone);
  const visible = (f.beatLane && !byEar) || (byEar && performance.now() < state.checkUntil);
  $('#laneCover').classList.toggle('hidden', visible || !byEar);
  $('#lanePanel').classList.toggle('hidden', !f.beatLane && !byEar);
  $('#laneTitle').textContent = f.beatDots ? 'Beat lane' : 'Waveforms';
  if (!visible || lane.clientWidth === 0) return;
  const { g, w, h } = fitCanvas(lane);
  g.clearRect(0, 0, w, h);
  const cx = w / 2, pps = w / 4, rowH = h / 2, left = 30;
  if (hint?.tone === 'ok' && f.beatDots) { g.fillStyle = colors.ok; g.globalAlpha = 0.16; g.fillRect(cx - 12, 0, 24, h); g.globalAlpha = 1; }
  g.font = '650 10px system-ui, -apple-system, "Segoe UI", sans-serif'; g.textBaseline = 'middle';
  const dots = { left: [], right: [] }; // beat dots, drawn last so they sit on top
  const waveAlpha = f.beatDots ? 0.38 : 1; // quieter waveform while learning, so the dots stand out
  SIDES.forEach((side, r) => {
    const d = decks[side], top = r * rowH, mid = top + rowH / 2, col = colors[side];
    g.fillStyle = col; g.textAlign = 'left'; g.font = '750 11px system-ui, -apple-system, "Segoe UI", sans-serif'; g.fillText(LETTER[side], 10, mid);
    g.font = '650 10px system-ui, -apple-system, "Segoe UI", sans-serif';
    if (r === 0) { g.fillStyle = colors['line-2']; g.fillRect(left, rowH - 0.5, w - left, 1); }
    if (!d.buffer) return;
    const pos = d.position(), rate = d.rate, dur = d.buffer.duration;
    const tAt = (x) => pos + ((x - cx) / pps) * rate, xAt = (t) => cx + ((t - pos) / rate) * pps;
    // waveform: low end in the deck colour, mids lighter, highs white, like DJ software
    const B = d.bands, amp = rowH / 2 - 3;
    if (B) {
      const layer = (arr, gain, scale, fill, alpha) => {
        g.fillStyle = fill; g.globalAlpha = alpha;
        for (let x = left; x < w; x++) {
          const t = tAt(x); if (t < 0 || t >= dur) continue;
          const i = Math.floor(t * B.rate), v = Math.min(1, Math.max(arr[i] || 0, arr[i + 1] || 0) * gain) * amp * scale;
          if (v > 0.5) g.fillRect(x, mid - v, 1, v * 2);
        }
      };
      layer(B.low, 1.25, 1, col, 0.9 * waveAlpha);
      layer(B.mid, 1.7, 0.7, '#ffffff', 0.42 * waveAlpha);
      layer(B.high, 2.2, 0.45, '#ffffff', 0.75 * waveAlpha);
      g.globalAlpha = 1;
    }
    // beat grid: thin beats, heavier "1"s with bar numbers, a coloured line at each new phrase
    const grid = d.track.grid;
    if (grid) {
      const bl = 60 / grid.bpm, span = (w / 2 / pps) * rate;
      const k0 = Math.ceil((pos - span - grid.firstDownbeat) / bl), k1 = Math.floor((pos + span - grid.firstDownbeat) / bl);
      for (let k = k0; k <= k1; k++) {
        const x = xAt(grid.firstDownbeat + k * bl); if (x < left) continue;
        const down = ((k % 4) + 4) % 4 === 0, bar = Math.floor(k / 4) + 1, phraseStart = down && ((bar - 1) % 16 + 16) % 16 === 0;
        g.fillStyle = phraseStart ? colors.warn : colors.ink;
        g.globalAlpha = phraseStart ? 0.85 : down ? 0.5 : 0.16;
        g.fillRect(Math.round(x) - (down ? 1 : 0), top + 2, down ? 2 : 1, rowH - 4);
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
        if (f.beatDots) dots[side].push({ x, n: ((k % 4) + 4) % 4 + 1 });
      }
      g.globalAlpha = 1;
    }
    // cue markers
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
  const yA = rowH - 22, yB = rowH + 22; // far enough apart that the joining line shows between the dots
  const fade = (x) => Math.max(0.3, 1 - Math.abs(x - cx) / (w * 0.55));
  // connectors first, so the dots sit on top of them
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
      g.fillStyle = '#fff'; g.font = n === 1 ? '800 12px system-ui, -apple-system, "Segoe UI", sans-serif' : '750 10px system-ui, -apple-system, "Segoe UI", sans-serif';
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
  g.fillStyle = colors.ink; g.fillRect(px - 1, 0, 2, h);
}

/** Light up beat 1–4, the phrase number, the 4-bar block within the phrase, and the section name. */
function updateCounter(el, d) {
  const box = $('[data-counter]', el); if (!box) return;
  const c = beatCount(d.track.grid, d.position());
  const key = c ? `${c.beat}|${c.bar}` : 'before';
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.classList.toggle('before', !c);
  $$('.beats i', box).forEach((x, i) => x.classList.toggle('on', !!c && i + 1 === c.beat));
  $$('.blocks i', box).forEach((x, i) => {
    x.classList.toggle('done', !!c && i + 1 < c.block);
    x.classList.toggle('on', !!c && i + 1 === c.block);
    if (c && i + 1 === c.block) x.style.setProperty('--p', c.barInBlock / 4);
  });
  $('[data-phrase]', box).textContent = c ? c.phrase : '–';
  const p = c && d.track.phrases?.find((ph) => d.position() >= ph.start && d.position() < ph.end);
  $('[data-sec]', box).innerHTML = p ? `<i style="background:${phraseColor(p.label)}"></i>${esc(PHRASE_NAMES[p.label] || p.label)}` : '';
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
    if (q('bar') && d.track.grid) {
      const bar = Math.max(1, Math.floor((d.position() - d.track.grid.firstDownbeat) / barLen(d.track.grid)) + 1);
      q('bar').textContent = `Bar ${bar} · phrase ${Math.ceil(bar / 16)} · −${fmtTime(Math.max(0, d.buffer.duration - d.position()))}`;
    }
  }
  const xf = $('#xfader'); if (xf && document.activeElement !== xf) xf.value = state.xfader;
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
// ---------- hot cues ----------
const cueStore = store.get('cues', {});
/** Four pads: your own cues, falling back to rekordbox's hot cues A–D. */
function cuesFor(t) {
  const own = cueStore[t.id] || [];
  return [0, 1, 2, 3].map((i) => (own[i] === false ? null : own[i] ?? (t.cues || []).find((c) => c.num === i && !c.loop)?.time ?? null));
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
  el.addEventListener('contextmenu', (e) => { const pad = e.target.closest('[data-cue]'); if (pad) { e.preventDefault(); hotCue(side, +pad.dataset.cue, true); } });
  el.addEventListener('click', (e) => {
    const cv = e.target.closest('[data-wave]'); if (!cv || !d().buffer) return;
    const r = cv.getBoundingClientRect(), g = d().track.grid;
    let t = ((e.clientX - r.left) / r.width) * d().buffer.duration;
    if (g) t = timeOfBar(g, Math.max(1, Math.round((t - g.firstDownbeat) / barLen(g)) + 1));
    d().seek(t);
  });
  el.addEventListener('dragover', (e) => { e.preventDefault(); $('[data-drop]', el)?.classList.add('dragover'); });
  el.addEventListener('dragleave', () => $('[data-drop]', el)?.classList.remove('dragover'));
  el.addEventListener('drop', (e) => { e.preventDefault(); $('[data-drop]', el)?.classList.remove('dragover'); const f = e.dataTransfer.files[0]; if (f) loadDroppedFile(side, f); });
}

function mixerEvents() {
  const m = $('#mixer');
  bindDials(m, (id, v) => { const [side, band] = id.split(':'); setEQ(side, band, v, false); });
  m.addEventListener('click', (e) => {
    const cut = e.target.closest('[data-cut]');
    if (cut) { const [side, band] = cut.dataset.cut.split(':'); return setEQ(side, band, decks[side].eq[band] <= -25 ? 0 : -30); }
    const l = e.target.closest('[data-listen]'); if (l) setListen(l.dataset.listen, !decks[l.dataset.listen].listening);
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
  $('#themeBtn').addEventListener('click', () => { renderThemes(); $('#themes').showModal(); });
  $('#themeList').addEventListener('click', (e) => { const b = e.target.closest('[data-theme-id]'); if (b) applyTheme(b.dataset.themeId); });
  $('#levelBtn').addEventListener('click', () => { renderLevels(); $('#levels').showModal(); });
  $('#levelList').addEventListener('click', (e) => { const b = e.target.closest('[data-level]'); if (b) { setLevel(b.dataset.level); $('#levels').close(); } });
  $('#checkBtn').addEventListener('click', check);
  $('#lessonsBtn').innerHTML = icon('book', 18); $('#aiBtn').innerHTML = icon('wand', 18);
  $('#lessonsBtn').addEventListener('click', () => setPane(!state.paneOpen));
  $('#aiBtn').addEventListener('click', openAI);
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
    if (e.target.closest('[data-a="menu"]')) { state.menuOpen = !state.menuOpen; renderSource(); return; }
    const b = e.target.closest('[data-source]'); if (b && !b.disabled) useSource(b.dataset.source);
  });
  document.addEventListener('pointerdown', (e) => { if (state.menuOpen && !e.target.closest('#source')) { state.menuOpen = false; renderSource(); } });
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
    const b = e.target.closest('[data-load]'); if (!b) return;
    const t = rowTrack(e); if (t) loadTo(b.dataset.load, t);
  });
  $('#list').addEventListener('dblclick', (e) => {
    if (e.target.closest('[data-load]')) return;
    const t = rowTrack(e); if (t) loadTo(state.target || (decks.left.buffer ? 'right' : 'left'), t);
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
  }[cmd] || (() => {}))();
}

function onKey(e) {
  const typing = !!e.target?.matches?.('input[type=search], input[type=text]');
  if (e.key === 'Escape') { if (typing) e.target.blur(); if (state.target) { state.target = null; renderLibrary(); } return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || !$('#welcomeView').classList.contains('hidden')) return;
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

// ---------- start ----------
async function boot() {
  if (desktop?.platform) document.documentElement.classList.add(desktop.platform);
  applyTheme(store.get('theme', 'auto'));
  bind();
  setLevel(state.level, true);
  renderSource();
  startLesson(state.lessonId);
  aiStatus().then((st) => { state.ai = st; renderAI(); });
  lib.rekordboxAvailable().then((ok) => {
    state.rbAvailable = ok; renderSource();
    if (!ok) { $('#rbChoice').disabled = true; $('#rbChoiceNote').textContent = 'Not connected. Open Cue Coach on a computer with rekordbox.'; }
  });
  if (!state.source) { $('#welcomeView').classList.remove('hidden'); return; }
  const ok = await useSource(state.source, { fromGesture: false });
  if (!ok && state.source !== 'folder') await useSource('practice');
}

boot();
requestAnimationFrame(frame);
