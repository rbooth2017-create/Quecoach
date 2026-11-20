// Cue Coach "Learn": a beginner-first DJ app. Our own two decks, a music library, a coach that fades
// out as you level up. Works with mouse and keyboard; a controller is optional (later).
import { ctx, Deck, beatmatch, synthDemoTrack, estimateGrid, setCrossfader } from './audio.js';
import { beatLen, barLen, fmtTime, timeOfBar } from './engine.js';
import * as lib from './musiclib.js';
import { readTags, TAG_BYTES } from './tags.js';
import { STEPS, currentStep, beatHint, updateAligned, fill, HOLD_S } from './lesson.js';
import { LEVELS, featuresFor, tempoRange, suggestLevelUp, levelIndex } from './levels.js';

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
const LABEL = { left: 'Left', right: 'Right' };
const state = {
  view: 'mix', source: store.get('source', null), sourceName: '', tracks: [],
  query: '', filter: 'all', target: null,
  analysing: null, scanToken: 0, loading: {},
  level: store.get('level', 'starter'), f: null,
  skipped: new Set(), step: -1, aligned: 0, alignLocked: false, lessonDone: false,
  cleanMixes: store.get('cleanMixes', 0), checkUntil: 0, xfader: 0,
};
state.f = featuresFor(state.level);

const decks = {};
function makeDeck(side) {
  const d = new Deck(LABEL[side]);
  // "Listen": a quiet copy of the deck that ignores the crossfader, standing in for headphones.
  d.listenGain = ctx.createGain(); d.listenGain.gain.value = 0;
  d.vol.connect(d.listenGain); d.listenGain.connect(ctx.destination);
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
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3600);
}
function keyBadge(t) {
  const h = lib.keyHue(t?.camelot);
  return h == null ? '<span class="keybadge unknown">Key ?</span>' : `<span class="keybadge" style="background:hsl(${h} 62% 50%)">${esc(t.camelot)}</span>`;
}
const fmtBpm = (b, dp = 1) => (b ? b.toFixed(dp) : '–');
const kbd = (k) => (state.f.keyHints ? k.split(' ').map((x) => `<kbd>${esc(x)}</kbd>`).join(' ') : '');

// ---------- views ----------
function setView(v, target = null) {
  state.view = v; state.target = target;
  $('#welcomeView').classList.toggle('hidden', v !== 'welcome');
  $('#mixView').classList.toggle('hidden', v !== 'mix');
  $('#musicView').classList.toggle('hidden', v !== 'music');
  $$('nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  $('nav').classList.toggle('hidden', v === 'welcome');
  if (v === 'music') { renderSource(); renderList(); setTimeout(() => $('#search').focus(), 50); }
  if (v === 'mix') { renderDecks(); renderNext(); }
}

// ---------- levels ----------
function setLevel(id, quiet = false) {
  state.level = LEVELS[levelIndex(id)].id; state.f = featuresFor(state.level);
  store.set('level', state.level);
  for (const s of SIDES) clampTempo(s);
  $('#levelBtn').textContent = `${LEVELS[levelIndex(state.level)].name} ▾`;
  renderLevels(); renderDecks(); renderNext(); state.step = -1;
  if (state.view === 'music') renderList();
  if (!quiet) toast(`Level: ${LEVELS[levelIndex(state.level)].name}. ${LEVELS[levelIndex(state.level)].blurb}`);
}
function renderLevels() {
  $('#levelList').innerHTML = LEVELS.map((l) => `<button class="level ${l.id === state.level ? 'active' : ''}" data-level="${l.id}"><b>${esc(l.name)}</b><small>${esc(l.blurb)}</small></button>`).join('');
}
function clampTempo(side) {
  const d = decks[side], r = tempoRange(state.level);
  if (Math.abs(d.tempoPct) > r) d.setTempo(Math.sign(d.tempoPct) * r);
}

// ---------- decks ----------
function deckRole(side) {
  const d = decks[side];
  if (!d.buffer) return state.f.friendlyRoles ? (side === 'left' ? 'Your first track goes here' : 'Your next track goes here') : `Deck ${side === 'left' ? 'A' : 'B'}`;
  const inRoom = d.playing && d.xf.gain.value > 0.3;
  if (!state.f.friendlyRoles) return `Deck ${side === 'left' ? 'A' : 'B'}${inRoom ? ' · on air' : ''}`;
  if (inRoom) return 'In the room';
  if (d.playing && d.listening) return 'Only you can hear this';
  if (d.playing) return 'Playing quietly (crossfader)';
  return 'Ready';
}

function renderDecks() { for (const s of SIDES) renderDeck(s); }

function renderDeck(side) {
  const d = decks[side], el = $(`#deck-${side}`), f = state.f, t = d.track;
  if (state.loading[side]) {
    el.innerHTML = `<div class="role">${LABEL[side]} deck</div><div class="empty-deck"><div class="spinner"></div><span>Loading ${esc(state.loading[side])}…</span></div>`;
    return;
  }
  if (!d.buffer) {
    el.innerHTML = `<div class="role">${LABEL[side]} deck <span class="live">${esc(deckRole(side))}</span></div>
      <div class="empty-deck" data-drop="${side}"><b>No track yet</b><span class="small">Choose one from your music, or drop an audio file here.</span>
      <button class="primary" data-a="choose">Choose a track</button></div>`;
    return;
  }
  const r = tempoRange(state.level);
  const eqBand = (band, label) => `<div class="band"><span>${label}</span><input type="range" min="-30" max="6" step="0.5" value="${d.eq[band]}" data-a="eq" data-band="${band}" aria-label="${label}"><button data-a="kill" data-band="${band}" class="${d.eq[band] <= -25 ? 'on' : ''}">Cut</button></div>`;
  el.innerHTML = `
    <div class="role">${LABEL[side]} deck <span class="live" data-live>${esc(deckRole(side))}</span></div>
    <div class="track-row">${keyBadge(t)}<div class="meta"><div class="title">${esc(t.title)}</div><div class="artist">${esc(t.artist || ' ')}</div></div>
      <div class="bpm"><b data-bpm>${fmtBpm(d.bpm, 2)}</b><span>BPM${t.grid?.estimated ? ' · estimated' : ''}</span></div></div>
    <canvas class="wave" data-wave></canvas>
    <div class="controls">
      <button class="play" data-a="play" aria-label="Play or pause">${d.playing ? '❚❚' : '▶'}</button>
      <div class="speed">
        <label><span>Speed</span><span data-pct></span></label>
        <div class="row"><button class="round" data-a="slower" aria-label="Slower">−</button>
          <input type="range" data-a="tempo" min="-${r}" max="${r}" step="0.05" value="${d.tempoPct}" aria-label="Speed">
          <button class="round" data-a="faster" aria-label="Faster">+</button></div>
      </div>
    </div>
    <div class="nudge">
      <button data-a="nudge" data-dir="-1">‹ Nudge back</button>
      <button class="toggle ${d.listening ? 'on' : ''}" data-a="listen" title="Hear this deck even when the crossfader is away from it">🎧 Listen</button>
      <button data-a="nudge" data-dir="1">Nudge forward ›</button>
    </div>
    ${f.keyHints ? `<div class="small muted">Keys: ${side === 'left' ? `${kbd('Q')} play` : `${kbd('P')} play · ${kbd('↑ ↓')} speed · ${kbd('← →')} nudge`}</div>` : ''}
    ${f.fullEQ ? `<div class="eq">${eqBand('high', 'High')}${eqBand('mid', 'Mid')}${eqBand('low', 'Bass')}</div>` : f.bassEQ ? `<div class="eq">${eqBand('low', 'Bass')}</div>` : ''}
    <div class="controls small"><span class="muted">Volume</span><input type="range" data-a="vol" min="0" max="1" step="0.01" value="${d.vol.gain.value}" aria-label="Volume" style="max-width:180px">
      ${f.barCounter ? '<span class="barcount" data-bar></span>' : ''}
      <span style="margin-left:auto"></span><button class="ghost small" data-a="choose">Change track</button></div>`;
  d._wave = null; // rebuild waveform columns for the new canvas
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
  if (state.view === 'music') setView('mix');
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
    toast(`${track.title} is on the ${side} deck`);
  } catch (err) {
    console.error(err); toast(`Couldn't load "${track.title}": ${err.message}`);
  } finally {
    delete state.loading[side]; renderDeck(side); renderNext(); if (state.view === 'music') renderList();
  }
}

async function loadDroppedFile(side, file) {
  if (!lib.isAudioFile(file.name)) return toast('That isn\'t an audio file we can play.');
  const meta = { name: file.name, relPath: file.name, size: file.size, lastModified: file.lastModified };
  const t = lib.trackFromFile(meta, readTags(await file.slice(0, TAG_BYTES).arrayBuffer()));
  t.source = 'file';
  Object.defineProperty(t, 'file', { value: async () => file, enumerable: false });
  loadTo(side, t);
}

// ---------- music sources ----------
async function useSource(kind, { fromGesture = true } = {}) {
  const token = ++state.scanToken;
  try {
    if (kind === 'practice') {
      setTracks(lib.practiceLibrary(), 'Practice tracks', kind);
    } else if (kind === 'rekordbox') {
      if (!(await lib.rekordboxAvailable())) { toast('rekordbox isn\'t connected. Open Cue Coach from the desktop app so it can read your library.'); return false; }
      state.analysing = { text: 'Reading your rekordbox library…' }; renderSource();
      setTracks(await lib.loadRekordbox(), 'rekordbox library', kind);
    } else if (kind === 'folder') {
      if (!lib.canPickFolder()) { $('#dirInput').click(); return false; }
      let handle;
      if (fromGesture) handle = await lib.pickFolder();
      else {
        const saved = await lib.savedFolder();
        if (!saved) return false;
        if (saved.permission !== 'granted') { state.reconnect = saved.handle; renderSource(); return false; }
        handle = saved.handle;
      }
      await scanFolder(handle, token);
    }
    store.set('source', kind); state.source = kind;
    return true;
  } catch (err) {
    if (err.name !== 'AbortError') { console.error(err); toast(`Couldn't open your music: ${err.message}`); }
    return false;
  } finally { if (token === state.scanToken && state.analysing && !state.analysing.spin) { state.analysing = null; renderSource(); } }
}

async function scanFolder(handle, token) {
  state.reconnect = null;
  state.analysing = { text: `Reading ${handle.name}…` }; renderSource();
  const tracks = await lib.scanFolder(handle, (n) => { if (token === state.scanToken) { state.analysing = { text: `Reading ${handle.name}: ${n} tracks found…` }; renderSource(); } });
  if (token !== state.scanToken) return;
  if (!tracks.length) toast(`No audio files found in ${handle.name}.`);
  setTracks(tracks, handle.name, 'folder');
  analyse(tracks, token);
}

function analyse(tracks, token) {
  const todo = tracks.filter((t) => !t.analysed && t.file);
  if (!todo.length) { state.analysing = null; renderSource(); return; }
  let done = 0;
  state.analysing = { text: `Working out beats: 0 of ${todo.length}`, spin: true }; renderSource();
  let pending = false;
  lib.analyseInBackground(todo, {
    decode: (ab) => ctx.decodeAudioData(ab),
    estimate: estimateGrid,
    shouldStop: () => token !== state.scanToken,
    onTrack: () => {
      done++;
      state.analysing = done >= todo.length ? null : { text: `Working out beats: ${done} of ${todo.length}`, spin: true };
      if (!pending) { pending = true; setTimeout(() => { pending = false; renderSource(); if (state.view === 'music') renderList(); renderNext(); }, 400); }
    },
  }).then(() => { if (token === state.scanToken) { state.analysing = null; renderSource(); } });
}

function setTracks(tracks, name, kind) {
  state.tracks = tracks; state.sourceName = name; state.source = kind;
  renderSource(); renderList(); renderNext();
}

function renderSource() {
  const el = $('#source'); if (!el) return;
  const a = state.analysing;
  const choices = `<div class="row" style="display:flex;gap:8px;flex-wrap:wrap">
      <button data-source="practice" class="${state.source === 'practice' ? 'chip active' : 'chip'}">Practice tracks</button>
      <button data-source="folder" class="${state.source === 'folder' ? 'chip active' : 'chip'}">Music folder…</button>
      <button data-source="rekordbox" class="${state.source === 'rekordbox' ? 'chip active' : 'chip'}">rekordbox</button></div>`;
  el.innerHTML = `<div><b>${esc(state.sourceName || 'No music yet')}</b>
      <div class="status">${a ? `${a.spin ? '<span class="spinner"></span>' : ''}${esc(a.text)}` : state.tracks.length ? `${state.tracks.length} tracks` : 'Pick where your music comes from'}</div>
      ${state.reconnect ? `<button class="primary" data-a="reconnect" style="margin-top:8px">Reconnect ${esc(state.reconnect.name)}</button>` : ''}
      ${state.target ? `<div class="small" style="margin-top:6px">Choosing a track for the <b style="color:var(--${state.target})">${state.target} deck</b></div>` : ''}</div>${choices}`;
}

// ---------- music list ----------
const MAX_ROWS = 300;
function renderList() {
  const el = $('#list'); if (!el) return;
  const ref = decks.left.track;
  const f = state.f;
  $$('#chips .chip').forEach((c) => c.classList.toggle('active', c.dataset.filter === state.filter));
  let rows = lib.searchTracks(state.tracks, state.query);
  let matches = null;
  if (ref) matches = new Map(rows.map((t) => [t.id, t.id === ref.id ? null : lib.friendlyMatch(ref, t)]));
  if (state.filter === 'match' && ref) rows = lib.rankNext(ref, rows, { exclude: [decks.right.track?.id], limit: MAX_ROWS }).map((r) => r.track);
  if (!state.tracks.length) { el.innerHTML = '<div class="empty">Choose where your music comes from above.</div>'; return; }
  if (!rows.length) { el.innerHTML = `<div class="empty">Nothing matches "${esc(state.query)}".</div>`; return; }
  const loadedIds = new Set(SIDES.map((s) => decks[s].track?.id).filter(Boolean));
  const head = `<div class="trow head"><span>Key</span><span>Track</span><span>BPM</span><span class="hide-sm">${ref ? 'With left deck' : ''}</span><span></span></div>`;
  el.innerHTML = head + rows.slice(0, MAX_ROWS).map((t) => {
    const m = matches?.get(t.id);
    const matchCell = !m ? '' : f.matchLabels
      ? `<span class="match ${m.level}" title="${esc(m.why.join(' · '))}">${m.label}</span>`
      : `<span class="small muted">${m.pitch.pct != null ? `${m.pitch.pct >= 0 ? '+' : ''}${m.pitch.pct.toFixed(1)}%` : ''}</span>`;
    const bpm = t.bpm ? `${t.bpm.toFixed(1)}${t.analysed ? '' : '<span class="muted small"> ~</span>'}` : '<span class="muted">…</span>';
    return `<div class="trow ${loadedIds.has(t.id) ? 'loaded' : ''}" data-id="${esc(t.id)}">${keyBadge(t)}
      <div style="min-width:0"><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist)}${t.genre ? ` · ${esc(t.genre)}` : ''}</div></div>
      <span class="n">${bpm}</span><span class="hide-sm">${matchCell}</span>
      <span class="acts"><button class="l" data-load="left">Left</button><button class="r" data-load="right">Right</button></span></div>`;
  }).join('') + (rows.length > MAX_ROWS ? `<div class="empty small">Showing ${MAX_ROWS} of ${rows.length}. Search to narrow it down.</div>` : '');
}

// ---------- up next ----------
function renderNext() {
  const el = $('#next'); if (!el) return;
  el.classList.toggle('hidden', !state.f.upNext);
  const ref = decks.left.track;
  if (!ref) { el.innerHTML = '<h3>Up next</h3><div class="muted">Put a track on the left deck and we\'ll suggest what mixes well after it.</div>'; return; }
  const picks = lib.rankNext(ref, state.tracks, { exclude: [decks.right.track?.id], limit: 3 });
  if (!picks.length) { el.innerHTML = '<h3>Up next</h3><div class="muted">No suggestions yet. Add more music or wait for the beats to be worked out.</div>'; return; }
  const f = state.f;
  el.innerHTML = `<h3>Up next · mixes well after "${esc(ref.title)}"</h3><div class="next-list">${picks.map(({ track: t, match: m }) => `
    <div class="pick">${f.matchLabels ? `<span class="match ${m.level}">${m.label}</span>` : ''}
      <div class="t">${esc(t.title)}</div><div class="small muted">${esc(t.artist)}</div>
      <div class="why">${keyBadge(t)} ${fmtBpm(t.bpm)} BPM${f.matchReasons ? ` · ${esc(m.why.join(' · '))}` : ''}</div>
      <button data-pick="${esc(t.id)}">Load on right</button></div>`).join('')}</div>`;
}

// ---------- coach ----------
function renderCoach(s) {
  const el = $('#coach'), f = state.f;
  el.classList.toggle('hidden', !f.lesson);
  if (!f.lesson) { $('#progress').innerHTML = ''; state.coachKey = null; return; }
  let idx = state.lessonDone ? STEPS.length : currentStep(s, state.skipped);
  if (idx === STEPS.length && !state.lessonDone) finishLesson();
  const key = `${idx}|${fmtBpm(s.left.bpm)}|${state.level}`;
  if (key === state.coachKey) return;
  state.coachKey = key; state.step = idx;
  renderProgress(idx);
  if (idx === STEPS.length) {
    const up = suggestLevelUp(state.level, state.cleanMixes);
    el.classList.add('complete');
    el.innerHTML = `<div class="num">✓</div><div><h2>You did a mix!</h2><p>The right track is playing to the room. ${up ? `That's ${state.cleanMixes} clean mixes: you're ready for <b>${esc(up.name)}</b>.` : 'Do it again to make it feel natural.'}</p></div>
      <div class="side">${up ? `<button class="primary" data-a="levelup" data-level="${up.id}">Try ${esc(up.name)}</button>` : ''}<button class="${up ? '' : 'primary'}" data-a="again">Mix another track</button></div>`;
    return;
  }
  el.classList.remove('complete');
  const st = STEPS[idx];
  el.innerHTML = `<div class="num">${idx + 1}</div><div><h2>${esc(st.title)}</h2>${f.lessonDetail ? `<p>${esc(fill(st.body, s))}</p>` : ''}</div>
    <div class="side">${st.key ? kbd(st.key) : ''}${st.action === 'music' ? `<button class="primary" data-a="music">Open music</button>` : ''}<button class="ghost" data-a="skip">Skip</button></div>`;
}

function renderProgress(idx) {
  const el = $('#progress');
  if (!state.f.lesson || state.view === 'welcome') { el.innerHTML = ''; return; }
  el.innerHTML = `<span>${idx >= STEPS.length ? 'Lesson complete' : `Step ${idx + 1} of ${STEPS.length}`}</span><div class="dots">${STEPS.map((_, i) => `<span class="${i < idx ? 'done' : i === idx ? 'now' : ''}"></span>`).join('')}</div>`;
}

function finishLesson() {
  state.lessonDone = true;
  state.cleanMixes = state.skipped.size ? state.cleanMixes : state.cleanMixes + 1; // skipped steps don't count
  store.set('cleanMixes', state.cleanMixes);
}

function mixAgain() {
  // The right track is now the one in the room; move on with a fresh right deck.
  const old = decks.right;
  const keep = { track: old.track, buffer: old.buffer, pos: old.position(), tempo: old.tempoPct, playing: old.playing };
  decks.left.stop();
  decks.left.load(keep.track, keep.buffer, null);
  decks.left.setTempo(keep.tempo); decks.left.offset = keep.pos;
  old.stop();
  if (keep.playing) decks.left.play();
  decks.right = makeDeck('right');
  state.xfader = 0; $('#xfader').value = 0; applyXfader();
  state.lessonDone = false; state.skipped.clear(); state.alignLocked = false; state.coachKey = null;
  renderDecks(); renderNext();
  toast('The track you mixed in is now on the left. Pick the next one for the right deck.');
}

// ---------- beat lane ----------
const lane = $('#lane');
let colors = {};
function readColors() { const cs = getComputedStyle(document.documentElement); for (const k of ['left', 'right', 'ok', 'ink', 'ink-3', 'line-2', 'card']) colors[k] = cs.getPropertyValue(`--${k}`).trim(); }
readColors();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); for (const s of SIDES) decks[s]._wave = null; });

function fitCanvas(cv) {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}

function drawLane(hint) {
  const visible = state.f.beatLane || (state.f.beatLaneCheck && performance.now() < state.checkUntil);
  $('#laneCover').classList.toggle('hidden', visible || !state.f.beatLaneCheck);
  lane.closest('.card').classList.toggle('hidden', !state.f.beatLane && !state.f.beatLaneCheck);
  if (!visible || lane.clientWidth === 0) return;
  const { g, w, h } = fitCanvas(lane);
  g.clearRect(0, 0, w, h);
  const cx = w / 2, pps = w / 3.2; // pixels per second of real time
  const rows = { left: h * 0.3, right: h * 0.7 };
  if (hint?.tone === 'ok') { g.fillStyle = colors.ok; g.globalAlpha = 0.18; g.fillRect(cx - 14, 8, 28, h - 16); g.globalAlpha = 1; }
  g.strokeStyle = colors['ink-3']; g.lineWidth = 1.5; g.setLineDash([4, 5]);
  g.beginPath(); g.moveTo(cx, 6); g.lineTo(cx, h - 6); g.stroke(); g.setLineDash([]);
  g.font = '600 12px ui-rounded, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const side of SIDES) {
    const d = decks[side], y = rows[side], col = colors[side];
    g.strokeStyle = colors['line-2']; g.lineWidth = 2; g.beginPath(); g.moveTo(12, y); g.lineTo(w - 12, y); g.stroke();
    g.fillStyle = colors['ink-3']; g.textAlign = 'left';
    g.fillText(LABEL[side], 14, y - 18);
    g.textAlign = 'center';
    const grid = d.track?.grid;
    if (!d.buffer || !grid) { g.fillText('empty', cx, y - 18); continue; }
    const pos = d.position(), rate = d.rate, bl = beatLen(grid);
    const span = (w / 2 / pps) * rate;
    const k0 = Math.ceil((pos - span - grid.firstDownbeat) / bl), k1 = Math.floor((pos + span - grid.firstDownbeat) / bl);
    for (let k = k0; k <= k1; k++) {
      const t = grid.firstDownbeat + k * bl, x = cx + ((t - pos) / rate) * pps;
      const down = ((k % 4) + 4) % 4 === 0;
      g.globalAlpha = Math.max(0.15, 1 - Math.abs(x - cx) / (w / 2));
      g.fillStyle = col; g.beginPath(); g.arc(x, y, down ? 11 : 6, 0, Math.PI * 2); g.fill();
      if (down) { g.fillStyle = '#fff'; g.fillText('1', x, y + 0.5); }
    }
    g.globalAlpha = 1;
  }
}

// ---------- waveforms ----------
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
  for (let i = 0; i < d._wave.length; i++) {
    const v = Math.min(1, d._wave[i] * 1.2) * (h / 2 - 3);
    g.fillStyle = col; g.globalAlpha = i < px ? 0.35 : 0.9;
    g.fillRect(i, h / 2 - v, 1, v * 2);
  }
  g.globalAlpha = 1;
  if (state.f.phraseMarks && d.track.phrases?.length) {
    g.fillStyle = colors.ink; g.globalAlpha = 0.35;
    for (const p of d.track.phrases) g.fillRect((p.start / dur) * w, 0, 1, h);
    g.globalAlpha = 1;
  }
  g.fillStyle = colors.ink; g.fillRect(px - 1, 0, 2, h);
}

// ---------- every frame ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.2, (now - last) / 1000); last = now;
  if (state.view === 'mix') {
    const s = mixState(dt);
    const hint = beatHint(s);
    const hel = $('#hint');
    const checking = performance.now() < state.checkUntil;
    if (hint && (state.f.offsetHint || checking)) { hel.className = `hint ${hint.tone}`; hel.textContent = hint.text; }
    else if (hint) { hel.className = 'hint'; hel.textContent = 'Trust your ears'; }
    else { hel.className = 'hint'; hel.textContent = 'Play both decks to compare beats'; }
    drawLane(hint);
    renderCoach(s);
    for (const side of SIDES) {
      const d = decks[side], el = $(`#deck-${side}`);
      if (!d.buffer) continue;
      drawWave(side);
      const q = (k) => $(`[data-${k}]`, el);
      if (q('bpm')) q('bpm').textContent = fmtBpm(d.bpm, 2);
      if (q('pct')) q('pct').textContent = state.f.pitchPercent ? `${d.tempoPct >= 0 ? '+' : ''}${d.tempoPct.toFixed(2)}%` : `${fmtBpm(d.bpm, 2)} BPM`;
      if (q('live')) q('live').textContent = deckRole(side);
      const play = $('[data-a="play"]', el); if (play) play.textContent = d.playing ? '❚❚' : '▶';
      const slider = $('input[data-a="tempo"]', el); if (slider && document.activeElement !== slider) slider.value = d.tempoPct;
      if (q('bar') && d.track.grid) {
        const bar = Math.max(1, Math.floor((d.position() - d.track.grid.firstDownbeat) / barLen(d.track.grid)) + 1);
        q('bar').textContent = `Bar ${bar} · phrase ${Math.ceil(bar / 16)} · ${fmtTime(Math.max(0, d.buffer.duration - d.position()))} left`;
      }
    }
  }
  requestAnimationFrame(frame);
}

// ---------- events ----------
function deckEvents(side) {
  const el = $(`#deck-${side}`);
  const d = () => decks[side];
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'choose') return setView('music', side);
    if (!d().buffer) return;
    if (a === 'play') { ctx.resume(); d().toggle(); }
    else if (a === 'slower' || a === 'faster') stepTempo(side, (a === 'faster' ? 1 : -1) * (e.shiftKey ? 1 : FINE));
    else if (a === 'listen') { d().listening = !d().listening; d().listenGain.gain.value = d().listening ? 0.5 : 0; b.classList.toggle('on', d().listening); }
    else if (a === 'kill') { const band = b.dataset.band; setEQ(side, band, d().eq[band] <= -25 ? 0 : -30); }
  });
  el.addEventListener('input', (e) => {
    const a = e.target.dataset.a;
    if (a === 'tempo') d().setTempo(+e.target.value);
    else if (a === 'vol') d().setVolume(+e.target.value);
    else if (a === 'eq') setEQ(side, e.target.dataset.band, +e.target.value, false);
  });
  // Press and hold to nudge, like pushing a jog wheel.
  el.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-a="nudge"]'); if (!b || !d().buffer) return;
    nudge(side, +b.dataset.dir);
    const stop = () => { nudge(side, 0); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); };
    window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop);
  });
  el.addEventListener('click', (e) => {
    const cv = e.target.closest('[data-wave]'); if (!cv || !d().buffer) return;
    const r = cv.getBoundingClientRect(), g = d().track.grid;
    let t = ((e.clientX - r.left) / r.width) * d().buffer.duration;
    if (g) t = timeOfBar(g, Math.max(1, Math.round((t - g.firstDownbeat) / barLen(g)) + 1));
    d().seek(t);
  });
  el.addEventListener('dragover', (e) => { e.preventDefault(); $('.empty-deck', el)?.classList.add('dragover'); });
  el.addEventListener('dragleave', () => $('.empty-deck', el)?.classList.remove('dragover'));
  el.addEventListener('drop', (e) => { e.preventDefault(); $('.empty-deck', el)?.classList.remove('dragover'); const f = e.dataTransfer.files[0]; if (f) loadDroppedFile(side, f); });
}

function stepTempo(side, delta) {
  const d = decks[side], r = tempoRange(state.level);
  if (!d.buffer) return;
  d.setTempo(Math.max(-r, Math.min(r, Math.round((d.tempoPct + delta) * 100) / 100)));
}
function nudge(side, dir) { const d = decks[side]; if (d.buffer) d.setBend(dir * 0.04); }
function setEQ(side, band, db, rerender = true) {
  const d = decks[side]; d.eq[band] = db; d.setEQ(band, db);
  if (rerender) {
    const el = $(`#deck-${side}`);
    const slider = $(`input[data-a="eq"][data-band="${band}"]`, el); if (slider) slider.value = db;
    $(`[data-a="kill"][data-band="${band}"]`, el)?.classList.toggle('on', db <= -25);
  }
}

function check() {
  if (!state.f.beatLaneCheck) return;
  state.checkUntil = performance.now() + 3000;
}

function bind() {
  SIDES.forEach(deckEvents);
  $$('nav button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#xfader').addEventListener('input', (e) => { state.xfader = +e.target.value; applyXfader(); });
  $('#helpBtn').addEventListener('click', () => $('#help').showModal());
  $('#levelBtn').addEventListener('click', () => { renderLevels(); $('#levels').showModal(); });
  $('#levelList').addEventListener('click', (e) => { const b = e.target.closest('[data-level]'); if (b) { setLevel(b.dataset.level); $('#levels').close(); } });
  $('#checkBtn').addEventListener('click', check);
  $('#coach').addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'music') setView('music', state.step <= 1 ? 'left' : 'right');
    else if (b.dataset.a === 'skip') { state.skipped.add(STEPS[state.step].id); state.coachKey = null; }
    else if (b.dataset.a === 'again') mixAgain();
    else if (b.dataset.a === 'levelup') { state.cleanMixes = 0; store.set('cleanMixes', 0); setLevel(b.dataset.level); mixAgain(); }
  });
  $('#next').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]'); if (!b) return;
    const t = state.tracks.find((x) => x.id === b.dataset.pick); if (t) loadTo('right', t);
  });
  $('#welcomeView').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-source]'); if (!b || b.disabled) return;
    if (await useSource(b.dataset.source)) setView(b.dataset.source === 'practice' ? 'mix' : 'music', 'left');
  });
  $('#source').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-source]');
    if (b) return useSource(b.dataset.source);
    if (e.target.closest('[data-a="reconnect"]')) {
      const h = state.reconnect;
      if ((await h.requestPermission({ mode: 'read' })) === 'granted') { store.set('source', 'folder'); scanFolder(h, ++state.scanToken); }
    }
  });
  $('#dirInput').addEventListener('change', async (e) => {
    const files = [...e.target.files]; if (!files.length) return;
    const token = ++state.scanToken;
    state.analysing = { text: `Reading ${files.length} files…` }; renderSource();
    const tracks = await lib.tracksFromFileList(files);
    const name = files[0].webkitRelativePath?.split('/')[0] || 'Music folder';
    setTracks(tracks, name, 'folder'); analyse(tracks, token);
    if (state.view === 'welcome') setView('music', 'left');
  });
  $('#search').addEventListener('input', (e) => { state.query = e.target.value; renderList(); });
  $('#chips').addEventListener('click', (e) => {
    const c = e.target.closest('[data-filter]'); if (!c) return;
    if (c.dataset.filter === 'match' && !decks.left.track) return toast('Load a track on the left deck first.');
    state.filter = c.dataset.filter; renderList();
  });
  $('#list').addEventListener('click', (e) => {
    const row = e.target.closest('.trow[data-id]'); if (!row) return;
    const t = state.tracks.find((x) => x.id === row.dataset.id); if (!t) return;
    const side = e.target.closest('[data-load]')?.dataset.load || state.target || (decks.left.buffer ? 'right' : 'left');
    loadTo(side, t);
  });
  window.addEventListener('resize', () => { for (const s of SIDES) decks[s]._wave = null; });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') nudge('right', 0); });
}

function onKey(e) {
  const typing = !!e.target?.matches?.('input[type=search], input[type=text]');
  if (e.key === 'Escape' && typing) { e.target.blur(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || state.view === 'welcome') return;
  const k = e.key.toLowerCase();
  const act = {
    q: () => { ctx.resume(); decks.left.buffer && decks.left.toggle(); },
    p: () => { ctx.resume(); decks.right.buffer && decks.right.toggle(); },
    arrowup: () => stepTempo('right', e.shiftKey ? 1 : FINE),
    arrowdown: () => stepTempo('right', e.shiftKey ? -1 : -FINE),
    arrowleft: () => !e.repeat && nudge('right', -1),
    arrowright: () => !e.repeat && nudge('right', 1),
    '[': () => { state.xfader = Math.max(0, state.xfader - 0.05); $('#xfader').value = state.xfader; applyXfader(); },
    ']': () => { state.xfader = Math.min(1, state.xfader + 0.05); $('#xfader').value = state.xfader; applyXfader(); },
    '/': () => setView('music'),
    m: () => setView(state.view === 'mix' ? 'music' : 'mix'),
    c: check,
    '?': () => $('#help').showModal(),
  }[k];
  if (!act) return;
  if (e.target?.matches?.('input[type=range]') && k.startsWith('arrow')) e.target.blur();
  e.preventDefault(); act();
}

// ---------- start ----------
async function boot() {
  bind();
  setLevel(state.level, true);
  lib.rekordboxAvailable().then((ok) => {
    const b = $('#rbChoice');
    if (!ok) { b.disabled = true; $('#rbChoiceNote').textContent = 'rekordbox isn\'t connected right now. It works when you open Cue Coach from the desktop app on a computer with rekordbox.'; }
  });
  if (!state.source) return setView('welcome');
  setView('mix');
  const ok = await useSource(state.source, { fromGesture: false });
  if (!ok && state.source === 'folder') { setView('music'); toast('Click "Reconnect" to read your music folder again.'); }
  else if (!ok) { await useSource('practice'); }
}

boot();
requestAnimationFrame(frame);
