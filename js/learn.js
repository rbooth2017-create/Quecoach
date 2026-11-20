// Cue Coach "Learn": a beginner-first DJ app. Two decks, a mixer, a music library and a coach that fades
// out as you level up. Works with mouse and keyboard; a controller is optional (later).
import { ctx, Deck, beatmatch, synthDemoTrack, estimateGrid, setCrossfader } from './audio.js';
import { beatLen, barLen, fmtTime, timeOfBar } from './engine.js';
import * as lib from './musiclib.js';
import { readTags, TAG_BYTES } from './tags.js';
import { STEPS, currentStep, beatHint, updateAligned, fill, HOLD_S } from './lesson.js';
import { LEVELS, featuresFor, tempoRange, suggestLevelUp, levelIndex, eqBands } from './levels.js';
import { JogWheel, jogHTML, dialHTML, setDial, bindDials } from './controls.js';
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
  skipped: new Set(), step: -1, aligned: 0, alignLocked: false, lessonDone: false,
  cleanMixes: store.get('cleanMixes', 0), checkUntil: 0, xfader: 0, jogUsed: false,
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
      </div>
    </div>
    <div class="deckfoot"><span class="role" data-live></span>${keys}<span class="grow"></span>${f.barCounter ? '<span class="barcount" data-bar></span>' : ''}
      <button class="ghost small" data-a="choose" title="Load a different track">${icon('eject', 14)} Change</button></div>`;
  jogs[side] = new JogWheel($('[data-jog]', el), () => decks[side], () => { state.jogUsed = true; $('.jog', el)?.classList.add('used'); });
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
  const s = {
    left: { loaded: !!L.buffer, playing: L.playing, bpm: L.bpm, title: L.track?.title },
    right: { loaded: !!R.buffer, playing: R.playing, bpm: R.bpm, title: R.track?.title },
    bpmDiff: bm ? bm.bpmDiff : null,
    offsetMs: bm && bm.both ? (bm.phase * 60000) / L.bpm : null,
    barOffset: bm && bm.both ? bm.barOffsetBeats : null,
    xfader: state.xfader, alignedFor: 0,
  };
  state.aligned = updateAligned(state.aligned, s, dt);
  if (state.aligned >= HOLD_S) state.alignLocked = true;
  if (!R.playing) state.alignLocked = false;
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
    if (!track.grid || track.grid.approx || !track.analysed) lib.saveAnalysis(track, buffer, estimateGrid(buffer));
    const d = decks[side];
    d.stop();
    d.load(track, buffer, null);
    if (side === 'right') state.alignLocked = false;
    state.target = null;
    if (side === 'left' && !decks.right.buffer && state.f.upNext) state.tab = 'suggested'; // what's next?
  } catch (err) {
    console.error(err); toast(`Couldn't load "${track.title}": ${err.message}`);
  } finally {
    delete state.loading[side]; renderDeck(side); renderLibrary();
  }
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
  el.innerHTML = head + rows.slice(0, MAX_ROWS).map(({ track: t, match: m }) => {
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

// ---------- coach ----------
function renderCoach(s) {
  const el = $('#coach'), f = state.f;
  el.classList.toggle('hidden', !f.lesson);
  if (!f.lesson) { $('#progress').innerHTML = ''; state.coachKey = null; return; }
  const idx = state.lessonDone ? STEPS.length : currentStep(s, state.skipped);
  if (idx === STEPS.length && !state.lessonDone) finishLesson();
  const key = `${idx}|${fmtBpm(s.left.bpm, 2)}|${state.level}`;
  if (key === state.coachKey) return;
  state.coachKey = key; state.step = idx;
  renderProgress(idx);
  if (idx === STEPS.length) {
    const up = suggestLevelUp(state.level, state.cleanMixes);
    el.classList.add('complete');
    el.innerHTML = `<div class="num">${icon('check', 16)}</div><div><h2>You did a mix!</h2><p>Deck B is playing to the room. ${up ? `That's ${state.cleanMixes} clean mixes: you're ready for ${esc(up.name)}.` : 'Do it again to make it feel natural.'}</p></div>
      <div class="side">${up ? `<button class="primary" data-a="levelup" data-level="${up.id}">Try ${esc(up.name)}</button>` : ''}<button class="${up ? '' : 'primary'}" data-a="again">Mix another track</button></div>`;
    return;
  }
  el.classList.remove('complete');
  const st = STEPS[idx];
  el.innerHTML = `<div class="num">${idx + 1}</div><div style="min-width:0"><h2>${esc(st.title)}</h2>${f.lessonDetail ? `<p title="${esc(fill(st.body, s))}">${esc(fill(st.body, s))}</p>` : ''}</div>
    <div class="side">${st.key ? kbd(st.key) : ''}${st.action === 'music' ? `<button class="primary" data-a="music">${icon('search', 15)} Browse music</button>` : ''}<button class="ghost" data-a="skip">Skip</button></div>`;
}

function renderProgress(idx) {
  $('#progress').innerHTML = !state.f.lesson ? '' : `<span>${idx >= STEPS.length ? 'Lesson complete' : `Your first mix · step ${idx + 1} of ${STEPS.length}`}</span><div class="dots">${STEPS.map((_, i) => `<span class="${i < idx ? 'done' : i === idx ? 'now' : ''}"></span>`).join('')}</div>`;
}

function finishLesson() {
  state.lessonDone = true;
  state.cleanMixes = state.skipped.size ? state.cleanMixes : state.cleanMixes + 1; // skipped steps don't count
  store.set('cleanMixes', state.cleanMixes);
}

function mixAgain() {
  // The track on B is now the one in the room; move it to A and start fresh on B.
  const old = decks.right;
  const keep = { track: old.track, buffer: old.buffer, pos: old.position(), tempo: old.tempoPct, playing: old.playing };
  decks.left.stop();
  decks.left.load(keep.track, keep.buffer, null);
  decks.left.setTempo(keep.tempo); decks.left.offset = keep.pos;
  old.stop();
  if (keep.playing) decks.left.play();
  decks.right = makeDeck('right');
  state.xfader = 0; applyXfader();
  state.lessonDone = false; state.skipped.clear(); state.alignLocked = false; state.coachKey = null;
  if (state.f.upNext) state.tab = 'suggested';
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
  const visible = state.f.beatLane || (state.f.beatLaneCheck && performance.now() < state.checkUntil);
  $('#laneCover').classList.toggle('hidden', visible || !state.f.beatLaneCheck);
  $('#lanePanel').classList.toggle('hidden', !state.f.beatLane && !state.f.beatLaneCheck);
  if (!visible || lane.clientWidth === 0) return;
  const { g, w, h } = fitCanvas(lane);
  g.clearRect(0, 0, w, h);
  const cx = w / 2, pps = w / 3.6; // pixels per second of real time
  const rows = { left: h * 0.3, right: h * 0.72 };
  if (hint?.tone === 'ok') { g.fillStyle = colors.ok; g.globalAlpha = 0.18; g.fillRect(cx - 12, 4, 24, h - 8); g.globalAlpha = 1; }
  g.strokeStyle = colors['ink-3']; g.lineWidth = 1.2; g.setLineDash([3, 4]);
  g.beginPath(); g.moveTo(cx, 4); g.lineTo(cx, h - 4); g.stroke(); g.setLineDash([]);
  g.font = '650 11px system-ui, -apple-system, "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const side of SIDES) {
    const d = decks[side], y = rows[side], col = colors[side];
    g.strokeStyle = colors['line-2']; g.lineWidth = 1.5; g.beginPath(); g.moveTo(30, y); g.lineTo(w - 10, y); g.stroke();
    g.fillStyle = col; g.textAlign = 'left'; g.fillText(LETTER[side], 12, y);
    g.textAlign = 'center';
    const grid = d.track?.grid;
    if (!d.buffer || !grid) continue;
    const pos = d.position(), rate = d.rate, bl = beatLen(grid);
    const span = (w / 2 / pps) * rate;
    const k0 = Math.ceil((pos - span - grid.firstDownbeat) / bl), k1 = Math.floor((pos + span - grid.firstDownbeat) / bl);
    for (let k = k0; k <= k1; k++) {
      const t = grid.firstDownbeat + k * bl, x = cx + ((t - pos) / rate) * pps;
      if (x < 34) continue;
      const down = ((k % 4) + 4) % 4 === 0;
      g.globalAlpha = Math.max(0.15, 1 - Math.abs(x - cx) / (w / 2));
      g.fillStyle = col; g.beginPath(); g.arc(x, y, down ? 9 : 5, 0, Math.PI * 2); g.fill();
      if (down) { g.fillStyle = '#fff'; g.fillText('1', x, y + 0.5); }
    }
    g.globalAlpha = 1;
  }
}

function drawWave(side) {
  const d = decks[side], cv = $(`#deck-${side} [data-wave]`);
  if (!cv || !d.peaks || cv.clientWidth === 0) return;
  const { g, w, h } = fitCanvas(cv);
  if (!d._wave || d._wave.length !== Math.floor(w)) {
    const n = Math.floor(w), src = d.peaks.data, cols = new Float32Array(n);
    for (let i = 0; i < n; i++) { let m = 0; const a = Math.floor(i / n * src.length), b = Math.floor((i + 1) / n * src.length); for (let j = a; j < b; j++) if (src[j] > m) m = src[j]; cols[i] = m; }
    d._wave = cols;
  }
  const dur = d.buffer.duration, pos = d.position(), px = (pos / dur) * w, col = colors[side];
  g.clearRect(0, 0, w, h);
  g.fillStyle = col;
  for (let i = 0; i < d._wave.length; i++) {
    const v = Math.max(1, Math.min(1, d._wave[i] * 1.2) * (h / 2 - 3));
    g.globalAlpha = i < px ? 0.3 : 0.85;
    g.fillRect(i, h / 2 - v, 1, v * 2);
  }
  g.globalAlpha = 1;
  if (state.f.phraseMarks && d.track.phrases?.length) {
    g.fillStyle = colors.ink; g.globalAlpha = 0.3;
    for (const p of d.track.phrases) g.fillRect((p.start / dur) * w, 0, 1, h);
    g.globalAlpha = 1;
  }
  g.fillStyle = colors.ink; g.fillRect(px - 1, 0, 2, h);
}

// ---------- every frame ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.2, (now - last) / 1000); last = now;
  const s = mixState(dt);
  const hint = beatHint(s);
  const hel = $('#hint');
  const checking = performance.now() < state.checkUntil;
  if (hint && (state.f.offsetHint || checking)) { hel.className = `hint ${hint.tone}`; hel.textContent = hint.text; }
  else if (hint) { hel.className = 'hint'; hel.textContent = 'Trust your ears'; }
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
function togglePlay(side) { const d = decks[side]; if (!d.buffer) return focusLibrary(side); ctx.resume(); d.toggle(); }
function setEQ(side, band, db, rerender = true) {
  const d = decks[side]; d.eq[band] = db; d.setEQ(band, db);
  if (rerender) { const dial = $(`[data-dial="${side}:${band}"]`); if (dial) setDial(dial, db); }
  $(`[data-cut="${side}:${band}"]`)?.classList.toggle('on', db <= -25);
}
function setListen(side, on) {
  const d = decks[side]; d.listening = on; d.listenGain.gain.value = on ? 0.5 : 0;
  const b = $(`[data-listen="${side}"]`); if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }
}
function moveXfader(x) { state.xfader = Math.max(0, Math.min(1, x)); applyXfader(); }
function check() { if (state.f.beatLaneCheck) state.checkUntil = performance.now() + 3000; }

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
    else if (a === 'restart') d().seek(d().track.grid?.firstDownbeat || 0);
    else if (a === 'slower' || a === 'faster') stepTempo(side, (a === 'faster' ? 1 : -1) * (e.shiftKey ? 1 : FINE));
  });
  el.addEventListener('input', (e) => { if (e.target.dataset.a === 'tempo') d().setTempo(+e.target.value); });
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
  $('#coach').addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'music') { const side = state.step <= 1 ? 'left' : 'right'; focusLibrary(side, side === 'right' && state.f.upNext ? 'suggested' : 'all'); }
    else if (b.dataset.a === 'skip') { state.skipped.add(STEPS[state.step].id); state.coachKey = null; }
    else if (b.dataset.a === 'again') mixAgain();
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
  const rowTrack = (e) => { const row = e.target.closest('.trow[data-id]'); return row && state.tracks.find((x) => x.id === row.dataset.id); };
  $('#list').addEventListener('click', (e) => {
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
    'restart-lesson': () => { state.lessonDone = false; state.skipped.clear(); state.coachKey = null; },
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
    arrowleft: () => !e.repeat && nudge('right', -1),
    arrowright: () => !e.repeat && nudge('right', 1),
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

// ---------- start ----------
async function boot() {
  if (desktop?.platform) document.documentElement.classList.add(desktop.platform);
  applyTheme(store.get('theme', 'auto'));
  bind();
  setLevel(state.level, true);
  renderSource();
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
